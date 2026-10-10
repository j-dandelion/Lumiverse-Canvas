import type { Side } from '../core/model'
import { browserVisible, folderFor, folderContaining, itemId, organizationFor, type Folder } from '../core/organization'
import { dispatch, dispatchBatch, getHost, getModel, onModelChanged } from '../recon/dispatch'
import { getMainMirrorPanel, getMainMirrorTabList, openCanvasMainDrawer } from '../sidebar/main-mirror-drawer'
import { getSecondaryPanel, getSecondaryTabList, openSecondarySidebar } from '../sidebar/secondary'
import { DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import { getFullCatalog } from './configure-catalog'
import { BUILTIN_ICON_SVGS } from './builtin-icons'
import { isShowTabLabels } from '../sidebar/drawer-sync'
import { getSettings, isOsModeEnabled } from '../settings/state'
import { isGhostPresentationPending } from './ghost-presentation'
import { folderIconSvg } from './folder-icons'
import { observeExplicitHostNavigation } from './host-navigation'
import { installOrganizationDrag, isOrganizationDragActive } from './organization-drag'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'

let stop: (() => void) | null = null
let observer: MutationObserver | null = null
let scheduled = false
let observed = new WeakSet<Element>()
const signatures = new WeakMap<Element, string>()

export function injectFolderStyles(): void {
  if (document.getElementById('canvas-folder-styles')) return
  const style = document.createElement('style'); style.id = 'canvas-folder-styles'
  style.textContent = `
    [data-canvas-folder-member] { display:none !important; }
    .canvas-folder-button { width:100%;height:48px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:0;border-radius:8px;background:transparent;color:var(--lumiverse-text-muted);cursor:pointer;transition:background .15s,color .15s; }
    .canvas-folder-button:hover { background:var(--lumiverse-primary-010);color:var(--lumiverse-text); }
    .canvas-folder-button.sidebar-ux-tab-active { background:var(--lumiverse-primary-015);color:var(--lumiverse-primary); }
    .canvas-folder-button.sidebar-ux-tab-labeled { height:56px; }
    .canvas-folder-button .sidebar-ux-tab-label { font-size:calc(10px * var(--lumiverse-font-scale,1));max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .canvas-tab-divider { width:28px;height:1px;margin:8px auto;flex-shrink:0;background:var(--lumiverse-border,var(--lumiverse-primary-020)); }
    html.sidebar-ux-location-top .canvas-tab-divider,html.sidebar-ux-location-bottom .canvas-tab-divider,[data-strip-axis="horizontal"] .canvas-tab-divider { width:1px;height:28px;margin:0 4px; }
    .sidebar-ux-panel[data-canvas-folder-browser] > .sidebar-ux-panel-content { display:none !important; }
    .canvas-folder-browser { flex:1;min-height:0;overflow:auto;padding:12px;color:var(--lumiverse-text); }
    .canvas-folder-toolbar { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:var(--lumiverse-text-muted);font-size:calc(12px * var(--lumiverse-font-scale,1)); }
    .canvas-folder-actions { display:flex;gap:4px; }
    .canvas-folder-toolbar button { display:flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;border:0;background:transparent;color:inherit;padding:6px 8px;border-radius:6px;cursor:pointer; }
    .canvas-folder-toolbar button[aria-pressed="true"],.canvas-folder-toolbar button:hover { background:var(--lumiverse-primary-010);color:var(--lumiverse-text); }
    .canvas-folder-items { display:flex;flex-direction:column; }
    .canvas-folder-items[data-view="grid"] { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:8px; }
    .canvas-folder-child { display:flex;align-items:center;gap:12px;text-align:left;width:100%;min-width:0;padding:12px;border:0;border-bottom:1px solid var(--lumiverse-border,var(--lumiverse-primary-010));border-radius:0;background:transparent;color:var(--lumiverse-text);cursor:pointer; }
    .canvas-folder-child:hover { background:var(--lumiverse-primary-008); }
    [data-view="grid"] .canvas-folder-child { border:1px solid var(--lumiverse-border,var(--lumiverse-primary-010));border-radius:8px;align-items:flex-start; }
    .canvas-folder-child svg { width:20px;height:20px;flex-shrink:0; }
    .canvas-folder-copy { display:flex;flex-direction:column;gap:4px;flex:1;min-width:0; }
    .canvas-folder-copy strong { font-size:calc(13px * var(--lumiverse-font-scale,1));font-weight:500;overflow-wrap:anywhere; }
    .canvas-folder-copy small,.canvas-folder-closed,.canvas-folder-empty { color:var(--lumiverse-text-muted);font-size:calc(12px * var(--lumiverse-font-scale,1)); }
    .canvas-folder-empty { padding:24px 12px;text-align:center; }
    [data-canvas-folder-browser] [data-canvas-os-minimize] { display:none !important; }
    .canvas-folder-button:focus-visible,.canvas-folder-child:focus-visible,.canvas-folder-toolbar button:focus-visible { outline:2px solid var(--lumiverse-primary);outline-offset:-2px; }
    .canvas-organization-error { position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:12000;padding:12px 16px;border:1px solid var(--lumiverse-border);border-radius:8px;background:var(--lumiverse-bg);color:var(--lumiverse-text); }
    .canvas-organization-insert-before { box-shadow:inset 0 2px var(--lumiverse-primary); }
    .canvas-organization-insert-after { box-shadow:inset 0 -2px var(--lumiverse-primary); }
    html.sidebar-ux-location-top .canvas-organization-insert-before,html.sidebar-ux-location-bottom .canvas-organization-insert-before { box-shadow:inset 2px 0 var(--lumiverse-primary); }
    html.sidebar-ux-location-top .canvas-organization-insert-after,html.sidebar-ux-location-bottom .canvas-organization-insert-after { box-shadow:inset -2px 0 var(--lumiverse-primary); }
    .canvas-folder-drop { outline:2px solid var(--lumiverse-primary);outline-offset:-2px; }
    .canvas-os-start-menu__drawer-label { display:block;padding:6px 12px;color:var(--lumiverse-text-muted);font-size:11px; }
    .canvas-os-start-menu__folder { display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:var(--lumiverse-text);font:inherit;text-align:left;cursor:pointer; }
    .canvas-os-start-menu__folder:hover { background:var(--lumiverse-primary-008); }
    .canvas-os-start-menu__folder > span:nth-child(2) { flex:1; }
    .canvas-os-start-menu__folder svg { display:block;width:18px;height:18px;color:var(--lumiverse-text-muted); }
    .canvas-os-start-menu__folder-children { margin-left:18px;padding-left:6px;border-left:1px solid var(--lumiverse-primary-015); }
    @media(max-width:600px) {
      .sidebar-ux-main-mirror-wrapper .canvas-tab-divider,.sidebar-ux-secondary-wrapper .canvas-tab-divider { width:1px;height:28px;margin:0 4px; }
    }
    @media(prefers-reduced-motion:reduce) { .canvas-folder-button { transition:none; } }
  `
  document.head.appendChild(style)
}

export async function browseFolder(side: Side, id: string): Promise<void> {
  const generation = currentLifecycleGeneration()
  const model = getModel(); if (!model || !folderFor(model, side, id)) return
  await dispatchBatch([{ t: 'browseFolder', side, id }, { t: 'setDrawer', side, open: true }])
  if (!isLifecycleCurrent(generation)) return
  if (side === 'primary') openCanvasMainDrawer(); else openSecondarySidebar()
  renderFolders()
}
export async function launchFolderChild(key: string, side: Side): Promise<void> {
  const generation = currentLifecycleGeneration()
  const host = getHost(), model = getModel(), live = host?.resolve(key)
  if (!host || !model || !live) return
  if (isOsModeEnabled()) {
    const actions = await import('../os/actions')
    if (!isLifecycleCurrent(generation)) return
    await actions.openWindowInOwningDrawerByLiveId(live)
  } else {
    await dispatchBatch([{ t: 'activate', key, side }, { t: 'setDrawer', side, open: true }])
    if (!isLifecycleCurrent(generation)) return
    await host.activate(side, live)
    if (!isLifecycleCurrent(generation)) return
    if (side === 'primary') openCanvasMainDrawer(); else openSecondarySidebar()
  }
  if (!isLifecycleCurrent(generation)) return
  renderFolders()
  const panel = side === 'primary' ? getMainMirrorPanel() : getSecondaryPanel()
  const focus = panel?.querySelector<HTMLElement>('.sidebar-ux-panel-title'); if (focus) { focus.tabIndex = -1; focus.focus() }
}
const configure = (id?: string) => { const generation = currentLifecycleGeneration(); void import('./configure-modal').then(m => { if (isLifecycleCurrent(generation)) void m.openConfigureTabsModal(id) }) }
function selectableChildren(folder: Folder): string[] {
  const model = getModel(), host = getHost(); if (!model || !host) return []
  return folder.children.flatMap(ref => ref.key && browserVisible(model, ref.key) && host.resolve(ref.key) && host.findKey(host.resolve(ref.key)!) && !isGhostPresentationPending(ref.key) ? [ref.key] : [])
}

/** Diff only Canvas-owned strip nodes; native hidden mounting anchors stay untouched. */
export function renderOrganizationStrip(side: Side): void {
  const model = getModel(), host = getHost(); if (!model?.organization || !host) return
  const list = side === 'primary' ? getMainMirrorTabList() : getSecondaryTabList(); if (!list) return
  const main = list.querySelector<HTMLElement>('.sidebar-ux-tab-list-main') ?? list
  const buttons = Array.from(main.querySelectorAll<HTMLElement>('button[data-tab-id]'))
  const sideOrganization = organizationFor(model)[side]
  for (const button of buttons) {
    const live = button.getAttribute('data-tab-id'), key = live ? host.findKey(live) : null
    if (key) button.classList.toggle('sidebar-ux-tab-active', model.drawers[side].open && model.active[side] === key)
    if (key && folderContaining(model, side, key)) {
      button.setAttribute('data-canvas-folder-member', '')
      button.removeAttribute('data-canvas-organization')
    } else {
      button.removeAttribute('data-canvas-folder-member')
      const root = sideOrganization.find(item => item.type === 'tab' && item.key === key)
      if (root) button.setAttribute('data-canvas-organization', itemId(root))
      else button.removeAttribute('data-canvas-organization')
    }
  }
  const desired: HTMLElement[] = []
  const wanted = new Set<string>()
  for (const item of organizationFor(model)[side]) {
    const id = itemId(item)
    if (item.type === 'tab') {
      const button = buttons.find(btn => item.key && host.findKey(btn.getAttribute('data-tab-id') ?? '') === item.key)
      if (button) { button.setAttribute('data-canvas-organization', id); desired.push(button) }
      continue
    }
    wanted.add(id)
    let node = Array.from(main.children).find(el => el.getAttribute('data-canvas-organization') === id) as HTMLElement | undefined
    if (!node) {
      node = document.createElement(item.type === 'folder' ? 'button' : 'div'); node.setAttribute('data-canvas-organization', id)
      if (item.type === 'folder') {
        const button = node as HTMLButtonElement; button.type = 'button'
        button.addEventListener('click', ev => { ev.stopPropagation(); void browseFolder(side, item.id) })
        button.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); void import('./tab-context-menu').then(m => m.showOrganizationMenu(ev.clientX, ev.clientY, side, id, button)) })
        wireLongPress(button)
      } else {
        node.setAttribute('role', 'separator')
        node.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); void import('./tab-context-menu').then(m => m.showOrganizationMenu(ev.clientX, ev.clientY, side, id, node)) })
        wireLongPress(node)
      }
    }
    if (item.type === 'divider') { node.className = 'canvas-tab-divider'; node.title = item.label ?? ''; node.setAttribute('aria-label', item.label || 'Divider') }
    else {
      const keys = selectableChildren(item), labeled = isShowTabLabels(), active = model.drawers[side].open && (model.folderBrowser?.[side] === item.id || item.children.some(ref => ref.key === model.active[side]))
      node.className = `canvas-folder-button ${side === 'primary' ? 'sidebar-ux-main-tab-mirror-btn' : 'sidebar-ux-tab-btn'}${labeled ? ' sidebar-ux-tab-labeled' : ''}${active ? ' sidebar-ux-tab-active' : ''}`
      node.style.display = keys.length || model.folderBrowser?.[side] === item.id ? '' : 'none'
      node.title = `${item.name} (${keys.length} ${keys.length === 1 ? 'tab' : 'tabs'})`; node.setAttribute('aria-label', node.title)
      const html = folderIconSvg(item)
      if (node.getAttribute('data-folder-icon') !== html) { node.innerHTML = html; node.setAttribute('data-folder-icon', html) }
      let label = node.querySelector<HTMLElement>('.sidebar-ux-tab-label')
      if (labeled && !label) { label = document.createElement('span'); label.className = 'sidebar-ux-tab-label'; node.appendChild(label) }
      if (label) { if (label.textContent !== item.name) label.textContent = item.name; label.hidden = !labeled }
    }
    desired.push(node)
  }
  for (const el of Array.from(main.querySelectorAll<HTMLElement>('[data-canvas-organization]'))) if (!wanted.has(el.getAttribute('data-canvas-organization')!)) el.remove()
  // Hidden child buttons are retained after their representative; they are
  // Canvas nodes, never React anchors. Settings/Start docks are excluded.
  desired.push(...buttons.filter(button => button.hasAttribute('data-canvas-folder-member')))
  let cursor: ChildNode | null = main.firstChild
  for (const node of desired) { if (node !== cursor) main.insertBefore(node, cursor); cursor = node.nextSibling }
}

export function renderFolders(): void {
  const model = getModel(), host = getHost(); if (!model || !host || typeof document === 'undefined') return
  injectFolderStyles()
  if (model.organization) {
    const org = organizationFor(model)
    const resolve = (ref: import('../core/organization').TabReference) => {
      const key = ref.key ? host.findKey(ref.key) : host.findKey(ref.tabId ?? '')
      return key ? { key } : ref
    }
    const map = (side: Side) => org[side].map(item => item.type === 'tab' ? { type: 'tab' as const, ...resolve(item) } : item.type === 'folder' ? { ...item, children: item.children.map(resolve) } : item)
    const healed = { version: 1 as const, primary: map('primary'), secondary: map('secondary') }
    if (JSON.stringify(healed) !== JSON.stringify(org)) { void dispatch({ t: 'setOrganization', organization: healed }); return }
  }
  const catalog = getFullCatalog()
  for (const side of ['primary', 'secondary'] as const) {
    renderOrganizationStrip(side)
    const panel = side === 'primary' ? getMainMirrorPanel() : getSecondaryPanel(); if (!panel) continue
    const folder = folderFor(model, side, model.folderBrowser?.[side])
    let browser = panel.querySelector<HTMLElement>('.canvas-folder-browser')
    if (!folder) {
      const hadFocus = !!browser?.contains(document.activeElement)
      panel.removeAttribute('data-canvas-folder-browser'); browser?.remove(); signatures.delete(panel)
      if (hadFocus) { const title = panel.querySelector<HTMLElement>('.sidebar-ux-panel-title'); if (title) { title.tabIndex = -1; title.focus() } }
      continue
    }
    panel.setAttribute('data-canvas-folder-browser', folder.id)
    const title = panel.querySelector('.sidebar-ux-panel-title'); if (title && title.textContent !== folder.name) title.textContent = folder.name
    const keys = selectableChildren(folder)
    const signature = JSON.stringify([folder, keys, keys.map(key => [host.resolve(key), model.closed.includes(key)]), catalog.map(tab => [tab.id, tab.title, tab.description])])
    if (signatures.get(panel) === signature && browser) continue
    const hadFocus = !!browser?.contains(document.activeElement)
    const focused = hadFocus ? document.activeElement?.getAttribute('data-folder-child') : null
    const focusedAction = hadFocus ? document.activeElement?.getAttribute('data-folder-action') : null
    browser?.remove(); browser = document.createElement('div'); browser.className = 'canvas-folder-browser'
    const toolbar = document.createElement('div'); toolbar.className = 'canvas-folder-toolbar'
    const count = document.createElement('span'); count.textContent = `${keys.length} ${keys.length === 1 ? 'tab' : 'tabs'}`
    const actions = document.createElement('div'); actions.className = 'canvas-folder-actions'; actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Folder view')
    for (const view of ['list', 'grid'] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${view === 'list' ? '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>' : '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'}</svg>`; button.title = `${view === 'list' ? 'List' : 'Grid'} view`; button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed', String((folder.view ?? 'list') === view))
      button.setAttribute('data-folder-action', view)
      button.addEventListener('click', () => { const current = getModel(); if (!current) return; const org = organizationFor(current); void dispatch({ t: 'setOrganization', organization: { ...org, [side]: org[side].map(item => item.type === 'folder' && item.id === folder.id ? { ...item, view } : item) } }) }); actions.appendChild(button)
    }
    const edit = document.createElement('button'); edit.type = 'button'; edit.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 2 2 3 4-1 1 4 3 2-2 3 1 4-4 1-2 3-3-2-4 1-1-4-3-2 2-3-1-4 4-1Z"/><circle cx="12" cy="12" r="3"/></svg>'; edit.title = 'Configure tabs'; edit.setAttribute('aria-label', edit.title); edit.addEventListener('click', () => configure(folder.id)); actions.appendChild(edit)
    toolbar.append(count, actions); browser.appendChild(toolbar)
    const items = document.createElement('div'); items.className = 'canvas-folder-items'; items.setAttribute('data-view', folder.view ?? 'list')
    for (const key of keys) {
      const id = host.resolve(key)!, tab = catalog.find(t => t.id === id), button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-folder-child'; button.setAttribute('data-folder-child', key)
      const icon = document.createElement('span'); icon.innerHTML = tab?.iconSvg ?? BUILTIN_ICON_SVGS[id] ?? ''; button.appendChild(icon)
      const copy = document.createElement('span'); copy.className = 'canvas-folder-copy'; const name = document.createElement('strong'); name.textContent = tab?.title ?? id; copy.appendChild(name)
      if (tab?.description) { const description = document.createElement('small'); description.textContent = tab.description; copy.appendChild(description) }
      button.appendChild(copy)
      const status = document.createElement('span'); status.className = 'canvas-folder-closed'; status.textContent = isOsModeEnabled() && model.closed.includes(key) ? 'Closed' : '›'; button.appendChild(status)
      button.addEventListener('click', () => { void launchFolderChild(key, side) });
      button.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); void import('./tab-context-menu').then(m => m.showAssignmentMenu(ev.clientX, ev.clientY, id, tab?.title ?? id, button)) }); wireLongPress(button); items.appendChild(button)
    }
    if (!keys.length) { const empty = document.createElement('div'); empty.className = 'canvas-folder-empty'; empty.textContent = 'This folder has no visible tabs right now.'; items.appendChild(empty) }
    browser.appendChild(items); panel.appendChild(browser); signatures.set(panel, signature)
    const focusTarget = focused
      ? Array.from(browser.querySelectorAll<HTMLElement>('[data-folder-child]')).find(el => el.getAttribute('data-folder-child') === focused)
      : focusedAction ? browser.querySelector<HTMLElement>(`[data-folder-action="${CSS.escape(focusedAction)}"]`) : null
    if (hadFocus) (focusTarget ?? browser.querySelector<HTMLElement>('button'))?.focus()
  }
}

export function mountFolders(): () => void {
  const generation = currentLifecycleGeneration()
  observed = new WeakSet<Element>()
  const schedule = () => { if (isOrganizationDragActive() || scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; if (!isOrganizationDragActive() && isLifecycleCurrent(generation)) { const model = getModel(); if (model && !model.organization) void dispatch({ t: 'setOrganization', organization: organizationFor(model) }); else renderFolders() } }) }
  const stopNavigation = observeExplicitHostNavigation()
  const stopDrag = installOrganizationDrag()
  stop?.(); stop = onModelChanged(schedule)
  observer = new MutationObserver(schedule)
  const watch = () => { for (const list of [getMainMirrorTabList(), getSecondaryTabList()]) if (list && !observed.has(list)) { observed.add(list); observer?.observe(list, { childList: true, subtree: true }) }; schedule() }
  document.addEventListener(DRAWER_SHELL_CREATED_EVENT, watch); watch()
  return () => { stopNavigation(); stopDrag(); stop?.(); stop = null; observer?.disconnect(); observer = null; document.removeEventListener(DRAWER_SHELL_CREATED_EVENT, watch); document.getElementById('canvas-folder-styles')?.remove(); for (const el of document.querySelectorAll('[data-canvas-folder-member],[data-canvas-folder-browser]')) { el.removeAttribute('data-canvas-folder-member'); el.removeAttribute('data-canvas-folder-browser') }; document.querySelectorAll('.canvas-folder-browser,[data-canvas-organization]').forEach(el => el.remove()) }
}

function wireLongPress(node: HTMLElement): void {
  let timer: ReturnType<typeof setTimeout> | null = null, x = 0, y = 0, suppress = false
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  node.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    clear(); x = event.clientX; y = event.clientY
    const generation = currentLifecycleGeneration()
    timer = setTimeout(() => { if (!node.isConnected || !isLifecycleCurrent(generation)) return; suppress = true; node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })) }, 450)
  })
  node.addEventListener('pointermove', event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 6) clear() })
  node.addEventListener('pointerup', clear); node.addEventListener('pointercancel', clear)
  node.addEventListener('click', event => { if (!suppress) return; suppress = false; event.preventDefault(); event.stopImmediatePropagation() }, true)
}
