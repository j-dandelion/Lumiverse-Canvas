// S2 flat renderer (2026-09): the Canvas main-drawer tab strip is rendered
// from the OWNED MODEL (dispatch.getModel()), not cloned from host buttons.
//
// Replaces the host-clone parity layer (collectHostTabButtons /
// syncMirrorButtonsInto / mirror-key heal / adoptMainMirror*) with a single
// idempotent diff step keyed by model TabKey:
//
//   model commit (dispatch.onModelChanged) → renderMainMirrorTabs()
//     order   = model.primary (hidden keys kept in place)
//     hidden  = model.hidden  — never hides ALL regular keys
//                              (keeps the first; WORKFLOW gotcha)
//     active  = model.active.primary — open-only highlight; host
//               `tabBtnActive` is NEVER consulted (staleness, active-tab.ts)
//     chrome  = live host twin READ-ONLY (icon/title/label); untagged twins
//               resolve via findMainTabButton's title fallback, twin-less
//               keys render title-derived chrome and converge later
//
// Renders on every model commit plus explicit renderMainMirrorTabs() calls
// at remount sites (apply/reconcile pin, side flips). The host sidebar
// observer (main-tab-pin.attachSidebarObserver) feeds twin-chrome deltas
// (icons/labels/tagging settle late) through the same rAF-coalesced path.
//
// Click = direct host twin click (instant content; Q1) + dispatchActivate
// intent + open/title; toggle-close compares against the MODEL active.
// Contextmenu forwards a synthetic event to the host twin (Lumiverse menu +
// Canvas "Move to second drawer" inject on that path). Settings stays
// bottom-pinned host chrome (Q5): docked in the list's bottom section,
// click forwards to the host Settings button, never a Canvas tab.

import type { TabKey } from '../core/model'
import {
  parseBuiltinKey,
  parseExtensionKey,
} from '../core/model'
import { getModel, getHost, onModelChanged, dispatchActivateByLiveId, dispatch } from '../recon/dispatch'
import { isOsModeEnabled } from '../settings/state'
import { minimizeWindowByLiveId, openWindowInDrawerByLiveId } from '../os/actions'
import { isHidden, visibleKeys } from '../core/select'
import { getMainSidebar } from '../dom/lumiverse'
import { isShowTabLabels } from './drawer-sync'
import {
  getMainMirrorTabList,
  isCanvasMainOpen,
  setCanvasMainTitle,
  onMainMirrorTabActivated,
  closeCanvasMainDrawer,
} from './main-mirror-drawer'
import {
  findMainTabButton,
  isSettingsButton,
  deriveShortName,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'

/** Canvas-owned tab list class (also on shell tab list when pinned). */
export const MAIN_MIRROR_LIST_CLASS = 'sidebar-ux-main-tab-list-mirror'

/** Mirror button class (also carries data-tab-id for shared pin-host CSS). */
export const MAIN_MIRROR_BTN_CLASS = 'sidebar-ux-main-tab-mirror-btn'

/**
 * Scrollable upper section of the main-mirror strip (built-in + extension tabs).
 * Matches Lumiverse `.tabListWrap` / `.tabList` — flex:1 so Settings can pin
 * to the bottom of the strip.
 */
export const MAIN_MIRROR_LIST_MAIN_CLASS = 'sidebar-ux-tab-list-main'

/**
 * Bottom section for the Settings mirror — matches Lumiverse `.sidebarBottom`
 * (margin-top auto via flex parent + border-top separator).
 */
export const MAIN_MIRROR_LIST_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'

/** Fixed mirror key for the Settings chrome button (not a model TabKey). */
const SETTINGS_MIRROR_KEY = '__canvas-settings__'

/** Renderer subscription handle (null = not subscribed). */
let _unsubModelChanged: (() => void) | null = null

/** rAF coalesce for observation-driven re-renders (twin chrome deltas). */
let _renderRaf: number | null = null

// ---------------------------------------------------------------------------
// Key / chrome helpers (moved verbatim from main-tab-pin.ts — pure tech)
// ---------------------------------------------------------------------------

/** Direct child with class (no CSS :scope — works under test stubs). */
function directChildByClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement
    if (el.classList?.contains?.(className) || String(el.className || '').includes(className)) {
      return el
    }
  }
  return null
}

/**
 * Host-shaped strip: scrollable main + bottom Settings dock.
 * Outer list is flex column / full height (pinned top+bottom); main takes
 * remaining space; bottom stays at the end with a top border separator.
 */
export function ensureMirrorListStructure(list: HTMLElement): {
  main: HTMLElement
  bottom: HTMLElement
} {
  let main = directChildByClass(list, MAIN_MIRROR_LIST_MAIN_CLASS)
  let bottom = directChildByClass(list, MAIN_MIRROR_LIST_BOTTOM_CLASS)

  if (!main) {
    main = document.createElement('div')
    main.className = MAIN_MIRROR_LIST_MAIN_CLASS
    list.insertBefore(main, list.firstChild)
  }
  if (!bottom) {
    bottom = document.createElement('div')
    bottom.className = MAIN_MIRROR_LIST_BOTTOM_CLASS
    list.appendChild(bottom)
  }

  // Adopt any legacy flat mirror buttons into main before reordering sections.
  for (const child of Array.from(list.children)) {
    if (
      child !== main &&
      child !== bottom &&
      (child as HTMLElement).classList?.contains(MAIN_MIRROR_BTN_CLASS)
    ) {
      main.appendChild(child)
    }
  }

  // Canonical order: main then bottom (only structural children).
  if (list.firstChild !== main) list.insertBefore(main, list.firstChild)
  if (main.nextSibling !== bottom) list.appendChild(bottom)

  // Outer list fills the pin host; scroll lives in main so Settings stays docked.
  if (list.style.overflowY !== 'hidden') list.style.overflowY = 'hidden'
  if (list.style.minHeight !== '0') list.style.minHeight = '0'

  if (main.style.flex !== '1 1 auto') main.style.flex = '1 1 auto'
  if (main.style.minHeight !== '0') main.style.minHeight = '0'
  if (main.style.display !== 'flex') main.style.display = 'flex'
  if (main.style.flexDirection !== 'column') main.style.flexDirection = 'column'
  // Host .tabList uses gap: 2px (ViewportDrawer.module.css) — not the
  // outer .sidebar gap of 4px (that only spaces tabListWrap vs bottom).
  if (main.style.gap !== '2px') main.style.gap = '2px'
  if (main.style.overflowY !== 'auto') main.style.overflowY = 'auto'
  if (main.style.overflowX !== 'hidden') main.style.overflowX = 'hidden'
  if (main.style.scrollbarWidth !== 'none') main.style.scrollbarWidth = 'none'

  if (bottom.style.flexShrink !== '0') bottom.style.flexShrink = '0'
  if (bottom.style.flexDirection !== 'column') bottom.style.flexDirection = 'column'
  if (bottom.style.gap !== '2px') bottom.style.gap = '2px'
  // Match ViewportDrawer.module.css .sidebarBottom
  if (bottom.style.marginTop !== 'auto') bottom.style.marginTop = 'auto'
  if (bottom.style.paddingTop !== '8px') bottom.style.paddingTop = '8px'
  if (bottom.style.borderTop !== '1px solid var(--lumiverse-primary-020)') {
    bottom.style.borderTop = '1px solid var(--lumiverse-primary-020)'
  }

  return { main, bottom }
}

/** Best-effort display title for a model TabKey (used when no twin exists). */
function keyTitle(key: TabKey): string | null {
  const builtin = parseBuiltinKey(key)
  if (builtin) return builtin
  const ext = parseExtensionKey(key)
  if (ext) return ext.tabName
  return null
}

/** Twin lookup for a model key, resolving suffix drift per render. */
function twinForKey(key: TabKey): { liveId: string | null; btn: HTMLElement | null } {
  const host = getHost()
  const liveId = host ? host.resolve(key) : null
  if (liveId) {
    const btn = findMainTabButton(liveId) as HTMLElement | null
    if (btn) return { liveId, btn }
  }
  // Twin missing via id (untagged twin / registry lag) — try the title
  // fallback directly so the twin can still supply chrome before the
  // tagger runs.
  const title = keyTitle(key)
  if (title) {
    const btn = findMainTabButton(title) as HTMLElement | null
    return { liveId, btn }
  }
  return { liveId, btn: null }
}

/** Twin resolution from an existing mirror button (click/contextmenu paths). */
function twinForMirror(mirror: HTMLElement): { liveId: string | null; btn: HTMLElement | null } {
  const liveId = mirror.getAttribute('data-tab-id')
  if (liveId) {
    const btn = findMainTabButton(liveId) as HTMLElement | null
    if (btn) return { liveId, btn }
  }
  const key = mirror.getAttribute('data-mirror-key')
  if (key && !key.startsWith('__')) {
    return twinForKey(key as TabKey)
  }
  if (key === SETTINGS_MIRROR_KEY) {
    const btn = findSettingsTwin()
    return { liveId: btn?.getAttribute('data-tab-id') ?? null, btn }
  }
  return { liveId: liveId ?? null, btn: null }
}

/**
 * Whether mirror buttons should use labeled (56px) geometry.
 *
 * Prefer host-settings `showTabLabels` (via isShowTabLabels — includes the
 * optimistic cache after Hide/Show). Host button `tabBtnLabeled` lags React
 * commit after hide; on activate/reconcile that stale class re-applied 56px
 * height with empty label DOM ("grow again even when there's no label").
 *
 * Settings is host chrome (gear only) — never labeled, even when tabs show
 * short names. Title/aria-label still say "Settings" for a11y/tooltips.
 */
function resolveMirrorLabeled(twin: HTMLElement | null, isSettings: boolean): boolean {
  if (isSettings) return false
  void twin
  return isShowTabLabels()
}

/**
 * Match secondary tab button geometry: square 48px (icon-only) / 56px (labeled).
 * Secondary sets these as inline styles at create time; keep main in lockstep.
 *
 * Do NOT set inline background/boxShadow/color — CSS drives hover +
 * .sidebar-ux-tab-active (inline background:transparent was killing the
 * active highlight).
 */
function applyMirrorButtonChrome(btn: HTMLElement, labeled: boolean): void {
  const height = labeled ? '56px' : '48px'
  // Only rewrite when height (or base chrome) drifted — avoid layout thrash.
  if (btn.style.height === height && btn.style.gap === '1px') {
    // Still clear any leftover paint overrides so active CSS can apply.
    btn.style.background = ''
    btn.style.boxShadow = ''
    btn.style.color = ''
    btn.style.borderRadius = ''
    return
  }
  btn.style.width = '100%'
  btn.style.height = height
  btn.style.flexShrink = '0'
  btn.style.display = 'flex'
  btn.style.flexDirection = 'column'
  btn.style.alignItems = 'center'
  btn.style.justifyContent = 'center'
  btn.style.gap = '1px'
  btn.style.border = 'none'
  btn.style.cursor = 'pointer'
  btn.style.transition = 'all 0.2s ease'
  // Host .tabBtn has no horizontal padding (ViewportDrawer.module.css).
  btn.style.padding = '0'
  btn.style.boxSizing = 'border-box'
  // Let stylesheet control fill / active chrome.
  btn.style.background = ''
  btn.style.boxShadow = ''
  btn.style.color = ''
  btn.style.borderRadius = ''
}

function buildMirrorInnerHtml(twin: HTMLElement | null, labeled: boolean, isSettings: boolean, fallbackTitle: string): string {
  const parts: string[] = []
  const svg = twin?.querySelector('svg') ?? null
  if (svg) {
    parts.push(`<span>${svg.outerHTML}</span>`)
  }
  // Host only mounts .tabLabel when showTabLabels is on — and can lag after
  // Canvas Show. Prefer host short name; fall back to title/key-derived short
  // name so main-mirror can rebuild labels before the twin settles.
  // Omit the span entirely when unlabeled (zero-height still costs 1px flex gap).
  // Settings never gets a short-name label (host keeps it icon-only).
  if (labeled && !isSettings) {
    const hostLabel = twin?.querySelector('span[class*="tabLabel"]') as HTMLElement | null
    const fromHost = hostLabel ? (hostLabel.textContent || '').trim() : ''
    const text = fromHost || (fallbackTitle ? deriveShortName(fallbackTitle) : '')
    if (text) {
      parts.push(
        `<span class="sidebar-ux-tab-label" style="opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease">${escapeHtml(text)}</span>`,
      )
    }
  }
  // S7: extension tab badge (host `dt.badge` → span.tabBadge in
  // ViewportDrawer.tsx). Copied AFTER the label to match host DOM order; the
  // CSS-module class is document-global so the clone styles identically
  // inside the mirror. Freshness is observer-driven — twin badge mutations
  // hit the sidebar observer (childList+subtree) → scheduleReconcile →
  // re-render, and the data-mirror-html cache rewrites only on change.
  // NEVER copy the data-spindle-mount span — the loader's document-first
  // match would re-portal the extension mount into the mirror (§7 veto:
  // don't steal drawer_tab mounts).
  const badge = twin?.querySelector('span[class*="tabBadge"]') as HTMLElement | null
  if (badge) {
    parts.push(badge.outerHTML)
  }
  return parts.join('')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cssAttrEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Scan the host sidebar for the Settings chrome button (bottom dock). */
function findSettingsTwin(): HTMLElement | null {
  const sidebar = getMainSidebar()
  if (!sidebar) return null
  const buttons = Array.from(
    sidebar.querySelectorAll('button[class*="tabBtn"]'),
  ) as HTMLElement[]
  for (const btn of buttons) {
    if (isSettingsButton(btn)) return btn
  }
  return null
}

/**
 * Create/order/sync ONE mirror button into `container` for `mirrorKey`.
 * Returns the button (found or created), placed before `insertBefore`.
 */
function ensureMirrorButton(
  container: HTMLElement,
  listRoot: HTMLElement,
  mirrorKey: string,
  insertBefore: ChildNode | null,
): HTMLElement {
  let mirror = listRoot.querySelector(
    `button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(mirrorKey)}"]`,
  ) as HTMLElement | null
  if (!mirror) {
    mirror = document.createElement('button')
    ;(mirror as HTMLButtonElement).type = 'button'
    mirror.classList.add(MAIN_MIRROR_BTN_CLASS)
    mirror.setAttribute('data-mirror-key', mirrorKey)
    mirror.addEventListener('click', onMirrorClick)
    // Canvas-owned context menu (host Lumiverse menu only fires on host
    // React buttons — mirror strip is outside the host sidebar).
    mirror.addEventListener('contextmenu', onMirrorContextMenu)
    container.insertBefore(mirror, insertBefore)
  } else if (mirror.parentElement !== container || mirror !== insertBefore) {
    container.insertBefore(mirror, insertBefore)
  }
  return mirror
}

/**
 * Idempotent model-keyed diff render into the Canvas main shell tab list.
 * Safe under test stubs (no APIs beyond the clone layer's vocabulary).
 */
export function renderMainMirrorTabs(): void {
  const list = getMainMirrorTabList()
  if (!list) return

  // Mark as main mirror list for tests / CSS (idempotent; also stamped by
  // the pin-chrome reconcile, but explicit renders must not depend on it).
  if (!list.classList.contains(MAIN_MIRROR_LIST_CLASS)) {
    list.classList.add(MAIN_MIRROR_LIST_CLASS)
  }

  const { main: mainSection, bottom: bottomSection } = ensureMirrorListStructure(list)

  const model = getModel()
  if (!model) {
    // Pre-model (boot, tests): leave any existing content untouched — the
    // teardown path clears the shell wholesale.
    return
  }

  const open = isCanvasMainOpen()
  const activeKey = model.active.primary

  // Never-hide-all guard (WORKFLOW gotcha): if EVERY regular primary key is
  // hidden, keep the first visible so the strip never renders empty. OS
  // mode suspends the guard: all windows minimized/closed → an empty strip
  // is the correct collapsed-drawer look (D7), the Start button remains.
  const regularKeys = model.primary
  const hiddenCount = regularKeys.filter((k) => isHidden(model, k)).length
  const forceVisibleKey: TabKey | null =
    regularKeys.length > 0 && hiddenCount >= regularKeys.length && !isOsModeEnabled()
      ? regularKeys[0]!
      : null

  // Built-in / extension tabs: scrollable top section in MODEL order.
  let insertBefore: ChildNode | null = mainSection.firstChild
  for (const key of regularKeys) {
    const twin = twinForKey(key)
    const mirror = ensureMirrorButton(mainSection, list, key, insertBefore)
    insertBefore = mirror.nextSibling

    // data-tab-id from the resolved live id (suffix-drift dead), removed when
    // the key cannot resolve this round (late-register transient).
    if (twin.liveId) mirror.setAttribute('data-tab-id', twin.liveId)
    else mirror.removeAttribute('data-tab-id')

    // Chrome read-only from the twin (deps: title, icon, label mount).
    const fallbackTitle = keyTitle(key) ?? twin.btn?.getAttribute('title') ?? ''
    const title =
      twin.btn?.getAttribute('title') ||
      twin.btn?.getAttribute('aria-label') ||
      fallbackTitle
    if (title) {
      mirror.setAttribute('title', title)
      mirror.setAttribute('aria-label', title)
    }

    // Hidden from the MODEL (exact TabKey match; multi-instance siblings
    // have distinct keys — more precise than the live-id pairing path).
    // OS mode (D3): closed windows hide their strip button the same way —
    // membership in model.closed (the Start menu keeps listing them, D6).
    const hidden = (isHidden(model, key) || model.closed.includes(key)) && key !== forceVisibleKey
    mirror.style.display = hidden ? 'none' : ''

    // Active from the MODEL — open-only highlight; never host tabBtnActive.
    const showActive = open && activeKey === key && !hidden
    mirror.classList.toggle('sidebar-ux-tab-active', showActive)

    const labeled = resolveMirrorLabeled(twin.btn, false)
    mirror.classList.toggle('sidebar-ux-tab-labeled', labeled)
    const nextHtml = buildMirrorInnerHtml(twin.btn, labeled, false, title)
    if (mirror.getAttribute('data-mirror-html') !== nextHtml) {
      mirror.setAttribute('data-mirror-html', nextHtml)
      mirror.innerHTML = nextHtml
    }
    applyMirrorButtonChrome(mirror, labeled)
  }

  // Drop stale mirror buttons anywhere under the list (main + bottom).
  const wantedKeys = new Set<string>(regularKeys)
  for (const btn of Array.from(
    list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`),
  ) as HTMLElement[]) {
    const key = btn.getAttribute('data-mirror-key') || ''
    if (!wantedKeys.has(key) && key !== SETTINGS_MIRROR_KEY) {
      btn.remove()
    }
  }

  // Remove extra non-mirror nodes left in the main section (shouldn't happen).
  for (const child of Array.from(mainSection.children)) {
    const el = child as HTMLElement
    if (!el.classList.contains(MAIN_MIRROR_BTN_CLASS)) {
      mainSection.removeChild(el)
    }
  }

  // Settings: pinned to strip bottom with separator (host .sidebarBottom).
  const settingsTwin = findSettingsTwin()
  if (settingsTwin) {
    bottomSection.style.display = 'flex'
    const settingsMirror = ensureMirrorButton(
      bottomSection,
      list,
      SETTINGS_MIRROR_KEY,
      bottomSection.firstChild,
    )
    const title = settingsTwin.getAttribute('title') || settingsTwin.getAttribute('aria-label') || 'Settings'
    const settingsTwinId = settingsTwin.getAttribute('data-tab-id') || ''
    if (settingsTwinId) settingsMirror.setAttribute('data-tab-id', settingsTwinId)
    else settingsMirror.removeAttribute('data-tab-id')
    settingsMirror.setAttribute('title', title)
    settingsMirror.setAttribute('aria-label', title)
    settingsMirror.classList.remove('sidebar-ux-tab-active')
    settingsMirror.classList.remove('sidebar-ux-tab-labeled')
    const settingsHtml = buildMirrorInnerHtml(settingsTwin, false, true, title)
    if (settingsMirror.getAttribute('data-mirror-html') !== settingsHtml) {
      settingsMirror.setAttribute('data-mirror-html', settingsHtml)
      settingsMirror.innerHTML = settingsHtml
    }
    applyMirrorButtonChrome(settingsMirror, false)
  } else {
    bottomSection.style.display = 'none'
    while (bottomSection.firstChild) bottomSection.removeChild(bottomSection.firstChild)
  }

  // Header title (Q4): from the host twin of the resolved live id, read-only.
  // Non-null activeKey only — mount seeds the shell with 'Drawer'.
  if (open && activeKey !== null && visibleKeys(model, 'primary').length > 0) {
    const twin = twinForKey(activeKey)
    const title =
      twin.btn?.getAttribute('title') ||
      twin.btn?.getAttribute('aria-label') ||
      keyTitle(activeKey) ||
      ''
    if (title) setCanvasMainTitle(title)
  }

  dlog('[main-renderer] render tabs', {
    order: Array.from(
      list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`),
    ).map((b) => (b as HTMLElement).getAttribute('data-mirror-key') || '?'),
    activeKey,
    open,
    hidden: model.hidden.length,
  })
}

// ---------------------------------------------------------------------------
// Interaction (click / contextmenu) — replaces onMirrorClick
// ---------------------------------------------------------------------------

/** Local mobile check (avoids a static import cycle with mobile-exclusion →
 *  secondary; same pattern as tabs/buttons.ts). */
function _isMobileRenderer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(max-width: 600px)').matches
}

function onMirrorClick(ev: Event): void {
  ev.preventDefault()
  ev.stopPropagation()
  const mirror = ev.currentTarget as HTMLElement
  const key = mirror.getAttribute('data-mirror-key') || ''
  const title =
    mirror.getAttribute('title') ||
    mirror.getAttribute('aria-label') ||
    undefined

  const twin = twinForMirror(mirror)
  const isSettings =
    key === SETTINGS_MIRROR_KEY ||
    isSettingsButton(mirror) ||
    (twin.btn != null && isSettingsButton(twin.btn))
  if (isSettings) {
    dlog('[main-renderer] click → settings (host only, no canvas tab)', { key })
    let target = twin.btn && twin.btn.isConnected ? twin.btn : null
    if (!target) {
      renderMainMirrorTabs()
      target = twinForMirror(mirror).btn
    }
    if (target && target.isConnected) {
      try {
        target.click()
      } catch {
        /* host may throw during teardown */
      }
    }
    return
  }

  // Toggle-close parity: compare against the MODEL active — never a parallel
  // mirror key (that machinery is gone). Falls through when closed so a
  // closed-drawer click on the active tab opens (secondary parity).
  //
  // OS mode (D4, spec §4.3): clicking the displayed window's strip button
  // MINIMIZES it — deactivate the active window + collapse the drawer
  // (the action's setDrawer close provides animation + persist + reflow);
  // the strip button stays. Non-OS keeps the toggle-close behavior.
  //
  // Mobile: active-tab taps do NOT toggle-close. The main shell is
  // full-bleed there, so its rightmost tab row sits where the opposite
  // drawer's handle appears when this drawer closes — a follow-up tap landed
  // on that handle (live report 2026-09-12, tap-diag). The X button + edge
  // handles remain the mobile close affordances.
  const model = getModel()
  if (isCanvasMainOpen() && !_isMobileRenderer() && model != null && model.active.primary === key) {
    if (isOsModeEnabled()) {
      const liveId = twin.liveId ?? mirror.getAttribute('data-tab-id')
      if (liveId) {
        dlog('[main-renderer] click → minimize (OS mode, active tab)', { title, key })
        void minimizeWindowByLiveId(liveId, 'primary')
        return
      }
    }
    dlog('[main-renderer] click → close (active tab)', { title, key })
    closeCanvasMainDrawer()
    return
  }

  // OS mode (D4): clicking a minimized/closed window's strip button routes
  // through the window-state action — one proven path for D19 auto-open,
  // host content activation, and chrome convergence. The ad-hoc activate
  // path below is the non-OS flow (and cannot recover the main content: the
  // primary diffActive is model-derived).
  if (isOsModeEnabled() && key && !key.startsWith('__')) {
    const osLiveId = twin.liveId ?? mirror.getAttribute('data-tab-id') ?? null
    if (osLiveId) {
      dlog('[main-renderer] click → OS open window', { title, key })
      void openWindowInDrawerByLiveId(osLiveId, 'primary').catch(() => {})
      return
    }
  }

  // Q1: direct host twin click (instant content — the queue's diffActive
  // echo is idempotent: an "already active" host click is a no-op re-render)
  // + model activation dispatch (the model becomes the highlight/title
  // source on its commit render).
  if (twin.btn && twin.btn.isConnected) {
    try {
      twin.btn.click()
    } catch {
      /* host may throw during teardown */
    }
  }

  const liveId = twin.liveId ?? mirror.getAttribute('data-tab-id') ?? null
  if (liveId) {
    void dispatchActivateByLiveId(liveId, 'primary').catch(() => {})
  } else if (key && !key.startsWith('__')) {
    // Unresolved this round — activate by model key directly.
    void dispatch({ t: 'activate', key: key as TabKey, side: 'primary' }).catch(() => {})
  }
  onMainMirrorTabActivated(title)
}

/**
 * Right-click on mirror tabs → forward to host twin so Lumiverse opens its
 * ContextMenu (Configure tabs, Hide/Show labels). Canvas injects "Move to
 * second drawer" via context-menu/index.ts on the synthetic host path.
 * Settings is never forwarded.
 */
function onMirrorContextMenu(ev: Event): void {
  const e = ev as MouseEvent
  e.preventDefault()
  e.stopPropagation()
  const mirror = e.currentTarget as HTMLElement
  const key = mirror.getAttribute('data-mirror-key') || ''

  // Settings is host chrome only — never forward contextmenu / open menu.
  const isSettings =
    key === SETTINGS_MIRROR_KEY ||
    isSettingsButton(mirror)
  if (isSettings) {
    dlog('[main-renderer] contextmenu → settings (no host forward)')
    return
  }

  let twin = twinForMirror(mirror)
  if ((!twin.btn || !twin.btn.isConnected) && !key.startsWith('__')) {
    // Twin went missing between renders — refresh chrome, re-resolve.
    renderMainMirrorTabs()
    twin = twinForMirror(mirror)
  }
  if (!twin.btn || !twin.btn.isConnected) {
    dwarn('[main-renderer] contextmenu: no connected host twin', {
      title: mirror.getAttribute('title'),
    })
    return
  }

  dlog('[main-renderer] contextmenu → host forward', {
    title: twin.btn.getAttribute('title') || mirror.getAttribute('title'),
    x: e.clientX,
    y: e.clientY,
  })
  try {
    twin.btn.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: e.clientX,
        clientY: e.clientY,
        button: 2,
        buttons: 2,
      }),
    )
  } catch (err) {
    dwarn('[main-renderer] contextmenu: host dispatch failed', err)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** rAF-coalesced render (host-observer / chrome-delta driven). */
export function scheduleMainMirrorRender(): void {
  if (_renderRaf !== null) return
  if (typeof requestAnimationFrame !== 'function') {
    renderMainMirrorTabs()
    return
  }
  _renderRaf = requestAnimationFrame(() => {
    _renderRaf = null
    try {
      renderMainMirrorTabs()
    } catch {
      /* render must never throw into the observer callback */
    }
  })
}

/**
 * Subscribe the renderer to model commits. Idempotent — call at every
 * remount site (apply/reconcile pin); also performs an immediate render so
 * a freshly (re)mounted shell list is filled without waiting for the next
 * commit.
 */
export function initMainRenderer(): void {
  if (!_unsubModelChanged) {
    _unsubModelChanged = onModelChanged(() => scheduleMainMirrorRender())
  }
  renderMainMirrorTabs()
}

/** Full renderer teardown (mirror teardown / test reset). */
export function teardownMainRenderer(): void {
  if (_unsubModelChanged) {
    _unsubModelChanged()
    _unsubModelChanged = null
  }
  if (_renderRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_renderRaf)
  }
  _renderRaf = null
}
