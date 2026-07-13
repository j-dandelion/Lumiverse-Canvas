var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/types.ts
function normalizeCanvasSettingsFields(s) {
  if (s.keepTabListVisible && !s.moveControlsToOuterEdge) {
    return { ...s, keepTabListVisible: false, hideDrawerOpenCloseButtons: false };
  }
  if (s.hideDrawerOpenCloseButtons && !s.keepTabListVisible) {
    return { ...s, hideDrawerOpenCloseButtons: false };
  }
  return s;
}
function mergeCanvasSettings(saved) {
  const out = { ...DEFAULT_CANVAS_SETTINGS };
  if (saved && typeof saved === "object") {
    for (const key of Object.keys(out)) {
      const v = saved[key];
      if (v !== undefined)
        out[key] = v;
    }
    const raw = saved;
    if (saved.drawerShadowsDesktop === undefined && typeof raw.sidebarShadowsDesktop === "boolean") {
      out.drawerShadowsDesktop = raw.sidebarShadowsDesktop;
    }
    if (saved.drawerShadowsMobile === undefined && typeof raw.sidebarShadowsMobile === "boolean") {
      out.drawerShadowsMobile = raw.sidebarShadowsMobile;
    }
    const hasNewLayoutFacet = saved.persistDrawerOpenState !== undefined || saved.persistDrawerWidth !== undefined;
    if (!hasNewLayoutFacet && typeof raw.layoutPersistence === "boolean") {
      out.persistDrawerOpenState = raw.layoutPersistence;
      out.persistDrawerWidth = raw.layoutPersistence;
    }
  }
  return normalizeCanvasSettingsFields(out);
}
var DEFAULT_CANVAS_SETTINGS;
var init_types = __esm(() => {
  DEFAULT_CANVAS_SETTINGS = {
    secondSidebarEnabled: true,
    resizeSidebars: true,
    mirrorCompactPosition: true,
    moveControlsToOuterEdge: false,
    keepTabListVisible: false,
    hideDrawerOpenCloseButtons: false,
    drawerShadowsDesktop: true,
    drawerShadowsMobile: false,
    chatReflow: true,
    slashCommandsEnabled: true,
    persistDrawerOpenState: true,
    persistDrawerWidth: true,
    drawerTabDrag: true,
    mainDrawerTabOverrideVh: undefined,
    secondaryDrawerTabOverrideVh: undefined,
    debugMode: false
  };
});

// src/dom/lumiverse.ts
var exports_lumiverse = {};
__export(exports_lumiverse, {
  getMainWrapper: () => getMainWrapper,
  getMainSidebar: () => getMainSidebar,
  getMainPanelHeader: () => getMainPanelHeader,
  getMainPanelContent: () => getMainPanelContent,
  getMainPanel: () => getMainPanel,
  getMainDrawerWidth: () => getMainDrawerWidth,
  getMainDrawer: () => getMainDrawer,
  getChatColumn: () => getChatColumn
});
function getMainSidebar() {
  return document.querySelector('[data-spindle-mount="sidebar"]');
}
function getMainDrawer() {
  const sidebar = getMainSidebar();
  return sidebar?.parentElement;
}
function getMainPanel() {
  const sidebar = getMainSidebar();
  return sidebar?.parentElement?.querySelector('[class*="_panel_"]');
}
function getMainPanelContent() {
  const panel = getMainPanel();
  return panel?.querySelector('[class*="_panelContent_"]');
}
function getMainPanelHeader() {
  const panel = getMainPanel();
  if (!panel)
    return null;
  const byClass = panel.querySelector('[class*="_panelHeader_"]');
  if (byClass)
    return byClass;
  for (let i = 0;i < panel.children.length; i++) {
    const child = panel.children[i];
    if (!child.className || !String(child.className).includes("_panelContent_")) {
      return child;
    }
  }
  return null;
}
function getMainWrapper() {
  const sidebar = getMainSidebar();
  return sidebar?.closest('[class*="_wrapper_"]');
}
function getChatColumn() {
  const body = document.querySelector('[class*="_body_"][data-chat-constrained]') || document.querySelector('[class*="_body_"]');
  if (!body)
    return null;
  const candidates = body.querySelectorAll('[class*="_chatColumn_"]');
  if (candidates.length === 1)
    return candidates[0];
  for (const el of body.children) {
    if (el.querySelector('[class*="_chatToolbar_"]')) {
      return el;
    }
  }
  return null;
}
function getMainDrawerWidth() {
  const drawer = getMainDrawer();
  if (!drawer)
    return 420;
  return drawer.getBoundingClientRect().width;
}

// src/dom/fiber.ts
function findFiberKey(el) {
  const key = Object.keys(el).find((k) => FIBER_PREFIXES.some((prefix) => k.startsWith(prefix)));
  return key ?? null;
}
function getFiberFromElement(el) {
  const key = findFiberKey(el);
  if (!key)
    return null;
  const fiber = el[key];
  return fiber != null ? fiber : null;
}
var FIBER_PREFIXES;
var init_fiber = __esm(() => {
  FIBER_PREFIXES = ["__reactFiber$", "__preact"];
});

// src/store/index.ts
function asDrawerStore(store) {
  return store;
}
function getActiveModal(force = false) {
  if (force)
    findStoreData(true);
  else
    findStoreData();
  const store = _storeSnapshotCache;
  if (!store)
    return null;
  const v = store["activeModal"];
  if (typeof v === "string")
    return v;
  return null;
}
function scanForStoreData(fiber, depth, maxDepth, visited, force) {
  if (!fiber || depth > maxDepth || visited.has(fiber))
    return;
  visited.add(fiber);
  let hook = fiber.memoizedState;
  let hookIdx = 0;
  while (hook && hookIdx < 30) {
    const state = hook.memoizedState;
    if ((force || !_drawerTabsCache) && Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === "object") {
      const firstKeys = Object.keys(state[0]);
      if (firstKeys.includes("id") && firstKeys.includes("title") && firstKeys.includes("root") && firstKeys.includes("badge") && !firstKeys.includes("edge") && !firstKeys.includes("x")) {
        _drawerTabsCache = state;
      }
    }
    if ((force || !_storeSnapshotCache) && state && typeof state === "object" && !Array.isArray(state)) {
      const keys = Object.keys(state);
      if (keys.includes("drawerOpen") || keys.includes("drawerTabs")) {
        _storeSnapshotCache = state;
      }
    }
    if (!force && _drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now();
      return;
    }
    hook = hook.next;
    hookIdx++;
  }
  scanForStoreData(fiber.child, depth + 1, maxDepth, visited, force);
  scanForStoreData(fiber.sibling, depth, maxDepth, visited, force);
}
function findStoreData(force = false) {
  const now = Date.now();
  if (!force && _drawerTabsCache && _storeSnapshotCache && now - _cacheTimestamp < CACHE_TTL_MS)
    return;
  if (typeof document === "undefined")
    return;
  const sidebar = getMainSidebar();
  if (!sidebar)
    return;
  const rootFiber = getFiberFromElement(sidebar);
  if (!rootFiber)
    return;
  let fiber = rootFiber;
  const ancestors = [];
  while (fiber) {
    ancestors.push(fiber);
    fiber = fiber.return;
  }
  if (force) {
    const visited2 = new Set;
    for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 5); i--) {
      scanForStoreData(ancestors[i], 0, 30, visited2, true);
    }
    _cacheTimestamp = Date.now();
    return;
  }
  const visited = new Set;
  for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 5); i--) {
    scanForStoreData(ancestors[i], 0, 30, visited, false);
    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now();
      break;
    }
  }
}
function getDrawerTabs() {
  findStoreData();
  if (_drawerTabsCache)
    return _drawerTabsCache;
  dlog("getDrawerTabs: drawerTabs not found in fiber tree (returning empty)");
  return [];
}
function getStoreSnapshot() {
  findStoreData();
  return _storeSnapshotCache;
}
function isMainDrawerOpen() {
  const wrapper = getMainWrapper();
  if (wrapper) {
    return wrapper.classList.toString().includes("wrapperOpen");
  }
  const store = getStoreSnapshot();
  if (store) {
    const snapshot = asDrawerStore(store);
    if (typeof snapshot.drawerOpen === "boolean") {
      return snapshot.drawerOpen;
    }
  }
  return false;
}
function getMainDrawerSide() {
  const wrapper = getMainWrapper();
  if (wrapper) {
    return wrapper.classList.toString().includes("wrapperLeft") ? "left" : "right";
  }
  const store = getStoreSnapshot();
  if (store) {
    const snapshot = asDrawerStore(store);
    if (snapshot.drawerSettings) {
      return snapshot.drawerSettings.side || "right";
    }
  }
  return "right";
}
var _drawerTabsCache = null, _storeSnapshotCache = null, _cacheTimestamp = 0, CACHE_TTL_MS = 3000;
var init_store = __esm(() => {
  init_fiber();
  init_log();
});

// src/dom/host-bridge.ts
function getHostBridge() {
  if (typeof window === "undefined")
    return null;
  const ctx = window.spindle;
  if (!ctx)
    return null;
  return {
    ui: ctx.ui,
    containers: ctx.containers
  };
}

// src/dom/wait-for.ts
function waitForElement(getElement, label, maxFrames = MAX_WAIT_FRAMES) {
  let attempts = 0;
  return new Promise((resolve) => {
    const check = () => {
      const el = getElement();
      if (el) {
        resolve(el);
        return;
      }
      if (++attempts > maxFrames) {
        dwarn(`waitForElement: ${label} not found after ${maxFrames} frames (~5s), giving up`);
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}
var MAX_WAIT_FRAMES = 300;
var init_wait_for = __esm(() => {
  init_log();
});

// src/chat/tag-buttons.ts
function scheduleTagMainSidebarButtons() {
  if (_tagMainSidebarButtonsRaf !== null)
    return;
  _tagMainSidebarButtonsRaf = requestAnimationFrame(() => {
    _tagMainSidebarButtonsRaf = null;
    tagMainSidebarButtons();
  });
}
function tagMainSidebarButtons() {
  const sidebar = getMainSidebar();
  if (!sidebar)
    return 0;
  findStoreData(true);
  const tabs = getDrawerTabs();
  if (tabs.length === 0)
    return 0;
  let tagged = 0;
  const buttons = sidebar.querySelectorAll("button[title]");
  for (const btn of buttons) {
    const existing = btn.getAttribute("data-tab-id");
    if (existing)
      continue;
    const btnTitle = btn.getAttribute("title");
    if (!btnTitle)
      continue;
    const tab = tabs.find((t) => t.title === btnTitle);
    if (tab) {
      btn.setAttribute("data-tab-id", tab.id);
      tagged++;
    }
  }
  if (tagged > 0)
    dlog(`tagMainSidebarButtons: tagged ${tagged} button(s)`);
  return tagged;
}
function startTagObserver() {
  const sidebarObserver = new MutationObserver(() => scheduleTagMainSidebarButtons());
  waitForElement(getMainSidebar, "main sidebar").then((sidebar) => {
    if (sidebar) {
      sidebarObserver.observe(sidebar, { childList: true, subtree: true });
      tagMainSidebarButtons();
    }
  });
  return () => {
    sidebarObserver.disconnect();
  };
}
var _tagMainSidebarButtonsRaf = null;
var init_tag_buttons = __esm(() => {
  init_store();
  init_wait_for();
  init_log();
});

// src/debug/styles.ts
function injectStyles(id, css) {
  if (typeof document === "undefined" || !document.head)
    return;
  const existing = document.getElementById?.(id);
  if (existing) {
    if (existing.textContent !== css)
      existing.textContent = css;
    return;
  }
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

// src/dom/clamp.ts
function clampSidebarWidth(px) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(window.innerWidth * MAX_SIDEBAR_WIDTH_FRAC, px));
}
var MIN_SIDEBAR_WIDTH = 200, MAX_SIDEBAR_WIDTH_FRAC = 0.8;

// src/sidebar/animation.ts
function parseTranslateX(transform) {
  if (!transform || transform === "none")
    return 0;
  const m = transform.match(/translateX\(\s*(-?[\d.]+)\s*px\s*\)/);
  if (m)
    return parseFloat(m[1]) || 0;
  const n = transform.match(/-?[\d.]+/);
  return n ? parseFloat(n[0]) || 0 : 0;
}
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function animFrame(wrapper, state, now) {
  if (state.start === null)
    state.start = now;
  const elapsed = now - state.start;
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1);
  const eased = easeOutCubic(progress);
  const val = state.from + (state.to - state.from) * eased;
  wrapper.style.transform = `translateX(${val}px)`;
  if (progress < 1) {
    state.raf = requestAnimationFrame((t) => animFrame(wrapper, state, t));
  } else {
    state.raf = null;
    state.start = null;
    const done = state.onComplete;
    state.onComplete = null;
    if (done) {
      try {
        done();
      } catch {}
    }
  }
}
function cancelWrapperAnimation(wrapper) {
  const target = wrapper ?? _lastWrapper;
  if (!target)
    return;
  const state = _anims.get(target);
  if (state?.raf != null) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
    state.start = null;
    state.onComplete = null;
  }
}
function animateWrapper(wrapper, targetPx, onComplete) {
  _lastWrapper = wrapper;
  let state = _anims.get(wrapper);
  if (!state) {
    state = { raf: null, start: null, from: 0, to: 0, onComplete: null };
    _anims.set(wrapper, state);
  }
  const current = parseTranslateX(wrapper.style.transform);
  state.from = current;
  state.to = targetPx;
  state.start = null;
  state.onComplete = onComplete ?? null;
  if (state.raf !== null)
    cancelAnimationFrame(state.raf);
  if (current === targetPx) {
    wrapper.style.transform = `translateX(${targetPx}px)`;
    state.raf = null;
    const done = state.onComplete;
    state.onComplete = null;
    if (done) {
      try {
        done();
      } catch {}
    }
    return;
  }
  state.raf = requestAnimationFrame((t) => animFrame(wrapper, state, t));
}
var ANIM_DURATION_MS = 350, _anims, _lastWrapper = null;
var init_animation = __esm(() => {
  _anims = new WeakMap;
});

// src/sidebar/styles.ts
function injectDrawerTabStyles() {
  injectStyles("sidebar-ux-drawer-tab-styles", `
    .sidebar-ux-drawer-tab {
      flex-shrink: 0;
      align-self: flex-start;
      width: var(--sidebar-ux-drawer-tab-w, 48px);
      height: var(--sidebar-ux-drawer-tab-h, auto);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sidebar-ux-drawer-tab-gap, 8px);
      padding-top: var(--sidebar-ux-drawer-tab-pt, 16px);
      padding-right: var(--sidebar-ux-drawer-tab-pr, 8px);
      padding-bottom: var(--sidebar-ux-drawer-tab-pb, 20px);
      padding-left: var(--sidebar-ux-drawer-tab-pl, 8px);
      border: var(--sidebar-ux-drawer-tab-border, 1px solid var(--lumiverse-border-hover));
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .sidebar-ux-drawer-tab:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--lumiverse-primary);
    }
    /* Icon container — matches main drawer .extIconSvg
       (ViewportDrawer.module.css:284-290). */
    .sidebar-ux-tab-list button[data-tab-id] > span:first-child {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    /* Label typography — matches main drawer .tabLabel
       (ViewportDrawer.module.css:241-252). */
    .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label {
      font-size: calc(9px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 48px;
      flex-shrink: 0;
    }
    /* Base button color — matches main drawer .tabBtn
       (ViewportDrawer.module.css:213). */
    /* Tab-list button chrome — under secondary wrapper (unpinned) or the
       body-level pin host (secondary reparent + main mirror strip).
       Main mirror buttons use .sidebar-ux-main-tab-mirror-btn (may lack
       data-tab-id until the host tagger runs). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
      color: var(--lumiverse-text-muted);
      border-radius: 8px;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      /* Square tabs matching Lumiverse tabBtn (48) / tabBtnLabeled (56).
         Host .tabBtn has no padding — only explicit height. */
      width: 100%;
      height: 48px;
      flex-shrink: 0;
      gap: 1px;
      padding: 0;
      box-sizing: border-box;
      transition: all 0.2s ease;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-labeled,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-labeled {
      height: 56px;
    }
    /* Label color — matches main drawer .tabLabel
       (ViewportDrawer.module.css:245). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
      color: var(--lumiverse-text-dim);
    }
    /* Per-tab hover — mirrors Lumiverse's .tabBtn:hover
       (ViewportDrawer.module.css:222-225). Rounded corners. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover {
      background: var(--lumiverse-primary-015);
      color: var(--lumiverse-text);
      border-radius: 8px;
    }
    /* Hover icon color is set on the SVG itself (not only inherited from
       the button) so removing .sidebar-ux-tab-active mid-hover does not
       flash purple: without this, the SVG briefly inherits the active
       button color (primary) and transitions 0.2s back to text/white. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover svg,
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active:hover svg {
      color: var(--lumiverse-text);
    }
    /* Smooth color transition for SVG icons (matches the tabBtn
       transition: all 0.2s ease which only covers the button). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn svg {
      transition: color 0.2s ease;
    }
    /* Smooth color transition for labels. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
      transition: color 0.2s ease, opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
    }
    /* Per-tab active state — mirrors Lumiverse's .tabBtnActive
       (ViewportDrawer.module.css:227-237) exactly: box-shadow
       indicator + directional border-radius. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      /* !important so leftover inline styles cannot kill the fill */
      background: var(--lumiverse-primary-020, rgba(139, 92, 246, 0.2)) !important;
      color: var(--lumiverse-primary, #a78bfa) !important;
      box-shadow: inset 3px 0 0 var(--lumiverse-primary, #a78bfa) !important;
      border-radius: 0 8px 8px 0;
    }
    .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host.sidebar-ux-side-left .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      box-shadow: inset -3px 0 0 var(--lumiverse-primary, #a78bfa) !important;
      border-radius: 8px 0 0 8px;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active .sidebar-ux-tab-label {
      color: var(--lumiverse-primary);
    }
  `);
  injectStyles("sidebar-ux-icon-size-styles", `
    .sidebar-ux-tab-list button[data-tab-id] > span > svg,
    .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `);
  injectStyles("sidebar-ux-shadow-close-suppress", `
    .sidebar-ux-secondary-wrapper[data-drawer-open="false"] > .sidebar-ux-drawer {
      box-shadow: none !important;
    }
  `);
  injectStyles("canvas-ux-secondary-mobile", SECONDARY_MOBILE_CSS);
  injectStyles("canvas-moved-active-toggle", `
    .sidebar-ux-secondary-wrapper .sidebar-ux-panel-content [data-canvas-moved]:not([data-canvas-active]) {
      display: none !important;
    }
  `);
  injectStyles("canvas-main-mirror-tab-list-structure", `
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list.sidebar-ux-main-tab-list-mirror,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list.sidebar-ux-main-tab-list-mirror {
      overflow-y: hidden;
      min-height: 0;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-main,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-main {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      /* Host .tabList gap is 2px, not sidebar's 4px. */
      gap: 2px;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-width: none;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-main::-webkit-scrollbar,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-main::-webkit-scrollbar {
      display: none;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-bottom,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-bottom {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: auto;
      padding-top: 8px;
      border-top: 1px solid var(--lumiverse-primary-020);
    }
  `);
}
var SECONDARY_WIDTH_VAR = "--sidebar-ux-secondary-w", MAIN_MIRROR_WIDTH_VAR = "--sidebar-ux-main-mirror-w", CANVAS_MAIN_ACTIVE_CLASS = "sidebar-ux-canvas-main-active", CANVAS_MAIN_OPEN_CLASS = "sidebar-ux-canvas-main-open", TAB_LIST_WIDTH_PX = 56, SECONDARY_MOBILE_CSS = `
@media (max-width: 600px) {
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer {
    flex-direction: column !important;
    overflow: hidden !important;
  }
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    width: 100% !important;
    flex-direction: row !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    border-bottom: 1px solid var(--lumiverse-primary-020) !important;
    border-left: none !important;
    border-right: none !important;
    padding: 6px 8px !important;
  }
  /* Hide webkit scrollbar */
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list::-webkit-scrollbar {
    display: none !important;
  }
  /* Tab buttons: uniform width on mobile horizontal layout.
     Matches main sidebar's mobile tabBtnLabeled size (52×48). */
  .sidebar-ux-tab-list button[data-tab-id] {
    width: 52px !important;
    min-width: 0;
    flex-shrink: 0;
    padding: 6px 4px !important;
  }
  .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled {
    width: 52px !important;
    height: 48px !important;
  }
  /* Active tab: bottom underline on mobile. Must match
     .sidebar-ux-side-left specificity and use !important —
     desktop rules set inset 3px/–3px with !important and
     would otherwise win. */
  .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-right .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
    border-radius: 8px 8px 0 0 !important;
  }
  /* Hide secondary's drawerTab when primary is open on mobile */
  body.canvas-ux-mobile-primary-open .sidebar-ux-drawer-tab {
    display: none !important;
    pointer-events: none !important;
  }
  /* Hide main's drawerTab when secondary is open on mobile */
  body.canvas-ux-mobile-secondary-open [class*="drawerTab"] {
    display: none !important;
    pointer-events: none !important;
  }
    /* Host main drawer on mobile: oversize by 1px to match the +1px oversize
     on Canvas secondary drawers.  Under fractional zoom/AA the host's
     --app-scaled-viewport-width resolves ~1px short of the visual viewport,
     leaving a 1px underfill gap when the drawer is open (translateX(0)).
     Adding 1px to the width via calc() fills that gap.
     The extra 1px is harmless on desktop (@media >600px scoped below). */
  [class*="wrapperLeft"],
  [class*="wrapperRight"] {
    --drawer-panel-w: calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px) !important;
  }
  /* Backdrop: full-viewport overlay that darkens the screen (including the
     safe area at the top) when the secondary drawer is open on mobile.
     Mirrors Lumiverse's main-drawer .backdrop element
     (ViewportDrawer.module.css:101-109 + ViewportDrawer.tsx:174-184).
     The secondary wrapper itself stays at top: env(safe-area-inset-top)
     so the drawer tab aligns vertically with the main drawer tab; the
     backdrop is a SEPARATE fixed-position layer behind the wrapper that
     fills the entire viewport (inset:0), so the safe-area-inset-top zone
     is also darkened. Body class is toggled by setMobileOpenClass() in
     mobile-exclusion.ts:99-110 (called from openSecondarySidebar /
     closeSecondarySidebar). pointer-events: none — purely visual, so
     chat/touch interactions underneath are unaffected (the user closes
     via the X button in the secondary header). */
  body.canvas-ux-mobile-secondary-open::before {
    content: '';
    position: fixed;
    inset: 0;
    background: var(--lumiverse-fill-heavy);
    z-index: 9989;
    pointer-events: none;
  }
}
`;
var init_styles = () => {};

// src/sidebar/drawer-shell.ts
function closedTransformPx(side, widthPx) {
  const w = Math.ceil(widthPx) + 1;
  return side === "left" ? -w : w;
}
function readWidthCssVar(varName, fallback = 420) {
  try {
    const style = document.documentElement?.style;
    if (!style?.getPropertyValue)
      return fallback;
    const n = parseFloat(style.getPropertyValue(varName));
    return isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}
function readUiScale() {
  try {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lumiverse-ui-scale")) || 1;
  } catch {
    return 1;
  }
}
function createDrawerShell(options) {
  const {
    owner,
    side,
    widthCssVar,
    defaultWidth = 420,
    initialWidth,
    initialOpen = false,
    fullViewportWidth = false,
    title: titleText = "Drawer",
    drawerTabDisplay = "none",
    onDrawerTabClick,
    onHeaderClose
  } = options;
  const wrapperClass = owner === "secondary" ? "sidebar-ux-secondary-wrapper" : "sidebar-ux-main-mirror-wrapper";
  const wrapper = document.createElement("div");
  wrapper.className = `${wrapperClass} sidebar-ux-side-${side}`;
  wrapper.setAttribute("data-drawer-owner", owner);
  wrapper.dataset.drawerOpen = initialOpen ? "true" : "false";
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(widthCssVar));
  const rawWidth = initialWidth && initialWidth > 0 ? initialWidth : isFinite(cssVarWidth) && cssVarWidth > 0 ? cssVarWidth : defaultWidth;
  const initWidth = fullViewportWidth ? Math.round(window.innerWidth / readUiScale()) : Math.ceil(clampSidebarWidth(rawWidth));
  document.documentElement.style.setProperty(widthCssVar, `${initWidth}px`);
  const initWrapperTransform = initialOpen ? "translateX(0)" : `translateX(${closedTransformPx(side, initWidth)}px)`;
  wrapper.style.cssText = `
    position: fixed;
    top: env(safe-area-inset-top, 0px); bottom: env(safe-area-inset-bottom, 0px);
    z-index: 9990;
    display: flex;
    align-items: stretch;
    pointer-events: none;
    transform: ${initWrapperTransform};
    ${side === "left" ? `left: 0; flex-direction: row-reverse;` : `right: 0; flex-direction: row;`};
  `;
  injectDrawerTabStyles();
  const drawerTab = document.createElement("button");
  drawerTab.className = "sidebar-ux-drawer-tab";
  drawerTab.style.cssText = `
    display: ${drawerTabDisplay};
    border-${side === "left" ? "left" : "right"}: none;
    border-radius: ${side === "left" ? "0 12px 12px 0" : "12px 0 0 12px"};
  `;
  const iconWrapper = document.createElement("div");
  iconWrapper.className = "sidebar-ux-drawer-tab-icon";
  iconWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
  drawerTab.appendChild(iconWrapper);
  if (onDrawerTabClick) {
    drawerTab.addEventListener("click", onDrawerTabClick);
  }
  const drawer = document.createElement("div");
  drawer.className = "sidebar-ux-drawer";
  drawer.style.cssText = `
    width: ${fullViewportWidth ? "calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)" : `var(${widthCssVar}, ${defaultWidth}px)`};
    height: 100%;
    position: relative;
    display: flex;
    background: var(--lumiverse-bg-deep);
    box-shadow: var(--lumiverse-shadow-xl);
    pointer-events: auto;
    isolation: isolate;
    flex-direction: ${side === "right" ? "row" : "row-reverse"};
  `;
  const tabList = document.createElement("div");
  tabList.className = "sidebar-ux-tab-list";
  tabList.style.cssText = `
    width: 56px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    gap: 4px;
    overflow-y: auto;
    scrollbar-width: none;
    border-${side === "right" ? "right" : "left"}: 1px solid var(--lumiverse-primary-020);
    background: color-mix(in srgb, var(--lumiverse-primary) 6%, var(--lumiverse-bg-deep));
  `;
  const panel = document.createElement("div");
  panel.className = "sidebar-ux-panel";
  panel.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  `;
  const header = document.createElement("div");
  header.className = "sidebar-ux-panel-header";
  header.style.cssText = `
    min-height: var(--sidebar-ux-panel-header-h, 48px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sidebar-ux-panel-header-pt, 12px) 16px var(--sidebar-ux-panel-header-pb, 12px);
    border-bottom: var(--sidebar-ux-panel-header-border-bottom, 1px solid var(--lumiverse-primary-015));
    background: var(--sidebar-ux-panel-header-bg, var(--lumiverse-primary-008, rgba(255, 255, 255, 0.02)));
    flex-shrink: 0;
  `;
  const title = document.createElement("h2");
  title.className = "sidebar-ux-panel-title";
  title.style.cssText = `
    margin: 0;
    font-size: var(--sidebar-ux-panel-header-font-size, calc(15px * var(--lumiverse-font-scale, 1)));
    font-weight: 600;
    color: var(--lumiverse-text);
  `;
  title.textContent = titleText;
  const closeBtn = document.createElement("button");
  closeBtn.className = "sidebar-ux-close-btn";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText = `
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--lumiverse-text-muted);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease;
  `;
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  if (onHeaderClose) {
    closeBtn.addEventListener("click", onHeaderClose);
  }
  header.appendChild(title);
  header.appendChild(closeBtn);
  const content = document.createElement("div");
  content.className = "sidebar-ux-panel-content";
  content.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    --sidebar-ux-content-pt: 12px;
    --sidebar-ux-content-pr: 12px;
    --sidebar-ux-content-pb: 40px;
    --sidebar-ux-content-pl: 12px;
    padding: var(--sidebar-ux-content-pt) var(--sidebar-ux-content-pr) var(--sidebar-ux-content-pb) var(--sidebar-ux-content-pl);
    position: relative;
  `;
  panel.appendChild(header);
  panel.appendChild(content);
  drawer.appendChild(tabList);
  drawer.appendChild(panel);
  wrapper.appendChild(drawerTab);
  wrapper.appendChild(drawer);
  return {
    wrapper,
    drawerTab,
    drawer,
    tabList,
    panel,
    header,
    title,
    closeBtn,
    content,
    side,
    widthCssVar,
    owner
  };
}
var init_drawer_shell = __esm(() => {
  init_styles();
});

// src/sidebar/cleanup.ts
function registerCleanup(fn) {
  _cleanupFns.push(fn);
}
function cleanupAll() {
  for (const fn of _cleanupFns) {
    try {
      fn();
    } catch (err) {
      dwarn("Cleanup error:", err);
    }
  }
  _cleanupFns.length = 0;
  try {
    clearTabAssignments();
  } catch (err) {
    dwarn("clearTabAssignments error:", err);
  }
}
var _cleanupFns;
var init_cleanup = __esm(() => {
  init_log();
  init_assignment();
  _cleanupFns = [];
});

// src/tabs/active-tab.ts
function getActiveTabId() {
  findStoreData(true);
  const store = getStoreSnapshot();
  if (store && typeof store.drawerOpen === "boolean") {
    if (!store.drawerOpen)
      return { state: "closed" };
    if (typeof store.drawerTab === "string") {
      return { state: "active", id: store.drawerTab };
    }
  }
  const sidebar = getMainSidebar();
  if (!sidebar)
    return { state: "unknown" };
  const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]');
  if (!activeBtn)
    return { state: "unknown" };
  const activeTitle = activeBtn.getAttribute("title") || "";
  if (!activeTitle)
    return { state: "unknown" };
  const tabs = getDrawerTabs();
  const tab = tabs.find((t) => t.title === activeTitle);
  if (tab)
    return { state: "active", id: tab.id };
  return { state: "active", id: activeTitle };
}
function isTabActiveInMainDrawer(tabId) {
  const active = getActiveTabId();
  if (active.state === "active" && active.id === tabId)
    return true;
  const sidebar = getMainSidebar();
  if (sidebar) {
    const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]');
    const activeTabId = activeBtn?.getAttribute("data-tab-id") ?? null;
    if (activeTabId === tabId)
      return true;
  }
  return false;
}
function getActiveSecondaryTabId() {
  return _activeSecondaryTabId;
}
function setActiveSecondaryTabId(tabId) {
  _activeSecondaryTabId = tabId;
}
var _activeSecondaryTabId = null;
var init_active_tab = __esm(() => {
  init_store();
});

// src/sidebar/strip-gutter.ts
var exports_strip_gutter = {};
__export(exports_strip_gutter, {
  updateStripGutters: () => updateStripGutters,
  injectStripGutterStyles: () => injectStripGutterStyles,
  computeStripGutters: () => computeStripGutters,
  clearStripGutters: () => clearStripGutters,
  STRIP_R_VAR: () => STRIP_R_VAR,
  STRIP_L_VAR: () => STRIP_L_VAR,
  STRIP_GUTTER_CLASS: () => STRIP_GUTTER_CLASS
});
function getDockInsets() {
  const appEl = document.querySelector("[data-app-root]");
  if (!appEl)
    return { left: 0, right: 0 };
  const left = parseFloat(appEl.style.getPropertyValue("--spindle-dock-left")) || 0;
  const right = parseFloat(appEl.style.getPropertyValue("--spindle-dock-right")) || 0;
  return { left, right };
}
function injectStripGutterStyles() {
  injectStyles(STYLE_ID, `
    /* Static keep-tabs chrome for Welcome only — no transition.
       Chat column is owned by chat reflow (higher-churn open/close margins). */
    html.${STRIP_GUTTER_CLASS} [data-component="LandingPage"] {
      margin-left: var(${STRIP_L_VAR}, 0px) !important;
      margin-right: var(${STRIP_R_VAR}, 0px) !important;
    }
    @media (max-width: 600px) {
      html.${STRIP_GUTTER_CLASS} [data-component="LandingPage"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
    }
  `);
}
function stopStripGutterObservers() {
  if (_dockObserver) {
    _dockObserver.disconnect();
    _dockObserver = null;
  }
  if (_mediaQuery && _onMediaChange) {
    _mediaQuery.removeEventListener("change", _onMediaChange);
  }
  _mediaQuery = null;
  _onMediaChange = null;
}
function clearStripGutterVars() {
  const root = document.documentElement;
  root.classList.remove(STRIP_GUTTER_CLASS);
  root.style.removeProperty(STRIP_L_VAR);
  root.style.removeProperty(STRIP_R_VAR);
}
function ensureStripGutterObservers() {
  if (!_dockObserver) {
    const appEl = document.querySelector("[data-app-root]");
    if (appEl) {
      _dockObserver = new MutationObserver(() => {
        updateStripGutters();
      });
      _dockObserver.observe(appEl, { attributes: true, attributeFilter: ["style"] });
    }
  }
  if (!_mediaQuery) {
    _mediaQuery = window.matchMedia("(max-width: 600px)");
    _onMediaChange = (e) => {
      if (e.matches) {
        clearStripGutterVars();
      } else {
        updateStripGutters();
      }
    };
    _mediaQuery.addEventListener("change", _onMediaChange);
  }
}
function computeStripGutters() {
  const mainSide = getMainDrawerSide();
  const mainBase = TAB_LIST_WIDTH_PX;
  const secondaryBase = hasSecondaryAssignedTabs() ? TAB_LIST_WIDTH_PX : 0;
  let leftBase = 0;
  let rightBase = 0;
  if (mainSide === "left") {
    leftBase = mainBase;
    rightBase = secondaryBase;
  } else {
    rightBase = mainBase;
    leftBase = secondaryBase;
  }
  const dock = getDockInsets();
  return {
    left: Math.max(0, leftBase - dock.left),
    right: Math.max(0, rightBase - dock.right)
  };
}
function clearStripGutters() {
  clearStripGutterVars();
  stopStripGutterObservers();
}
function updateStripGutters() {
  if (isMobileViewport()) {
    clearStripGutterVars();
    return;
  }
  if (!isKeepTabListVisibleEnabled()) {
    clearStripGutters();
    return;
  }
  injectStripGutterStyles();
  ensureStripGutterObservers();
  const { left, right } = computeStripGutters();
  const root = document.documentElement;
  root.classList.add(STRIP_GUTTER_CLASS);
  root.style.setProperty(STRIP_L_VAR, `${left}px`);
  root.style.setProperty(STRIP_R_VAR, `${right}px`);
}
var STRIP_GUTTER_CLASS = "sidebar-ux-strip-gutters", STRIP_L_VAR = "--sidebar-ux-strip-l", STRIP_R_VAR = "--sidebar-ux-strip-r", STYLE_ID = "sidebar-ux-strip-gutter", _dockObserver = null, _mediaQuery = null, _onMediaChange = null;
var init_strip_gutter = __esm(() => {
  init_store();
  init_state();
  init_assignment();
  init_mobile_exclusion();
  init_styles();
});

// src/sidebar/main-tab-pin.ts
var exports_main_tab_pin = {};
__export(exports_main_tab_pin, {
  reconcileMainTabListPin: () => reconcileMainTabListPin,
  isMainTabListPinActive: () => isMainTabListPinActive,
  getActiveMainMirrorKey: () => getActiveMainMirrorKey,
  applyMainTabListPin: () => applyMainTabListPin,
  adoptMainMirrorHostActivation: () => adoptMainMirrorHostActivation,
  activateMainMirrorFromRestore: () => activateMainMirrorFromRestore,
  __resetMainTabPinForTest: () => __resetMainTabPinForTest,
  MAIN_MIRROR_LIST_MAIN_CLASS: () => MAIN_MIRROR_LIST_MAIN_CLASS,
  MAIN_MIRROR_LIST_CLASS: () => MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_LIST_BOTTOM_CLASS: () => MAIN_MIRROR_LIST_BOTTOM_CLASS,
  MAIN_MIRROR_BTN_CLASS: () => MAIN_MIRROR_BTN_CLASS
});
function applyMainTabListPin(enabled, opts) {
  if (isMobileViewport()) {
    if (enabled && !opts?.force)
      return;
    teardownMainPin();
    return;
  }
  if (!enabled) {
    teardownMainPin();
    return;
  }
  applyMainMirrorDrawer(true, { force: !!opts?.force });
  if (_enabled && !opts?.force) {
    scheduleReconcile();
    return;
  }
  _enabled = true;
  ensureObservers();
  reconcileMainMirror();
}
function reconcileMainTabListPin() {
  if (isMobileViewport()) {
    applyMainTabListPin(false, { force: true });
    Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
    return;
  }
  reconcileMainMirrorDrawer();
  const on = !!getSettings().keepTabListVisible;
  if (!on) {
    teardownMainPin();
    Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
    return;
  }
  _enabled = true;
  ensureObservers();
  reconcileMainMirror();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
}
function isMainTabListPinActive() {
  return _enabled && isMainMirrorActive();
}
function __resetMainTabPinForTest() {
  stopObservers();
  _enabled = false;
  _reconcileRaf = null;
  _observedSidebar = null;
  _activeMainMirrorKey = null;
  __resetMainMirrorForTest();
  destroyMainPinHost();
}
function getActiveMainMirrorKey() {
  return _activeMainMirrorKey;
}
function activateMainMirrorFromRestore(hostBtn, title) {
  const resolvedTitle = title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined;
  if (hostBtn && hostBtn.isConnected) {
    _activeMainMirrorKey = hostButtonKey(hostBtn);
    try {
      hostBtn.click();
    } catch {}
  } else if (resolvedTitle) {
    _activeMainMirrorKey = `title__${resolvedTitle}`;
  }
  onMainMirrorTabActivated(resolvedTitle);
}
function adoptMainMirrorHostActivation(hostBtn, title, opts) {
  if (!_enabled || !isMainMirrorActive())
    return;
  const resolvedTitle = title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined;
  if (hostBtn && hostBtn.isConnected) {
    _activeMainMirrorKey = hostButtonKey(hostBtn);
  } else if (resolvedTitle) {
    _activeMainMirrorKey = `title__${resolvedTitle}`;
  }
  const shouldOpen = opts?.open !== false;
  if (shouldOpen) {
    onMainMirrorTabActivated(resolvedTitle);
  } else if (resolvedTitle) {
    setCanvasMainTitle(resolvedTitle);
  }
  scheduleReconcile();
  dlog("[main-mirror] adopt host activation", {
    key: _activeMainMirrorKey,
    title: resolvedTitle,
    open: shouldOpen
  });
}
function teardownMainPin() {
  _enabled = false;
  _activeMainMirrorKey = null;
  stopObservers();
  applyMainMirrorDrawer(false, { force: true });
  destroyMainPinHost();
}
function scheduleReconcile() {
  if (_reconcileRaf !== null)
    return;
  _reconcileRaf = requestAnimationFrame(() => {
    _reconcileRaf = null;
    if (_enabled)
      reconcileMainMirror();
  });
}
function reconcileMainMirror() {
  if (!_enabled)
    return;
  const side = getMainDrawerSide();
  ensureMainPinHost(side);
  const list = resolveMirrorList();
  if (!list)
    return;
  if (!list.classList.contains(MAIN_MIRROR_LIST_CLASS)) {
    list.classList.add(MAIN_MIRROR_LIST_CLASS);
  }
  if (!list.classList.contains(TAB_LIST_PINNED_CLASS)) {
    list.classList.add(TAB_LIST_PINNED_CLASS);
  }
  const host = ensureMainPinHost(side);
  if (host && host.style.display === "none") {
    host.style.display = "";
  }
  const sidebar = getMainSidebar();
  if (!sidebar) {
    while (list.firstChild)
      list.removeChild(list.firstChild);
    return;
  }
  if (sidebar !== _observedSidebar) {
    attachSidebarObserver(sidebar);
  }
  const { main: mainSection, bottom: bottomSection } = ensureMirrorListStructure(list);
  const hostButtons = collectHostTabButtons(sidebar);
  const regularButtons = hostButtons.filter((b) => !isSettingsButton(b));
  const settingsButtons = hostButtons.filter((b) => isSettingsButton(b));
  const wantedKeys = new Set(hostButtons.map((b) => hostButtonKey(b)));
  if (_activeMainMirrorKey != null && !wantedKeys.has(_activeMainMirrorKey)) {
    const hostActiveBtn = hostButtons.find((b) => hostHasTabBtnActive(b)) ?? null;
    const prevKey = _activeMainMirrorKey;
    if (hostActiveBtn && !isSettingsButton(hostActiveBtn)) {
      _activeMainMirrorKey = hostButtonKey(hostActiveBtn);
      const t = hostActiveBtn.getAttribute("title") || hostActiveBtn.getAttribute("aria-label") || "";
      if (t)
        setCanvasMainTitle(t);
    } else {
      _activeMainMirrorKey = null;
    }
    dlog("[main-mirror] stale active key healed", {
      prevKey,
      nextKey: _activeMainMirrorKey
    });
  }
  for (const btn of Array.from(list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`))) {
    const key = btn.getAttribute("data-mirror-key") || "";
    if (!wantedKeys.has(key)) {
      btn.remove();
    }
  }
  syncMirrorButtonsInto(mainSection, regularButtons, list);
  if (settingsButtons.length > 0) {
    bottomSection.style.display = "flex";
    syncMirrorButtonsInto(bottomSection, settingsButtons, list);
  } else {
    bottomSection.style.display = "none";
    while (bottomSection.firstChild)
      bottomSection.removeChild(bottomSection.firstChild);
  }
  dlog("[main-mirror] reconcile tabs", {
    hostCount: hostButtons.length,
    regularCount: regularButtons.length,
    settingsCount: settingsButtons.length,
    mirrorCount: list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`).length,
    open: isCanvasMainOpen(),
    activeKeys: hostButtons.filter((b) => String(b.className || "").includes("tabBtnActive")).map((b) => hostButtonKey(b))
  });
}
function directChildByClass(parent, className) {
  for (const child of Array.from(parent.children)) {
    const el = child;
    if (el.classList?.contains?.(className) || String(el.className || "").includes(className)) {
      return el;
    }
  }
  return null;
}
function ensureMirrorListStructure(list) {
  let main = directChildByClass(list, MAIN_MIRROR_LIST_MAIN_CLASS);
  let bottom = directChildByClass(list, MAIN_MIRROR_LIST_BOTTOM_CLASS);
  if (!main) {
    main = document.createElement("div");
    main.className = MAIN_MIRROR_LIST_MAIN_CLASS;
    list.insertBefore(main, list.firstChild);
  }
  if (!bottom) {
    bottom = document.createElement("div");
    bottom.className = MAIN_MIRROR_LIST_BOTTOM_CLASS;
    list.appendChild(bottom);
  }
  for (const child of Array.from(list.children)) {
    if (child !== main && child !== bottom && child.classList?.contains(MAIN_MIRROR_BTN_CLASS)) {
      main.appendChild(child);
    }
  }
  if (list.firstChild !== main)
    list.insertBefore(main, list.firstChild);
  if (main.nextSibling !== bottom)
    list.appendChild(bottom);
  if (list.style.overflowY !== "hidden")
    list.style.overflowY = "hidden";
  if (list.style.minHeight !== "0")
    list.style.minHeight = "0";
  if (main.style.flex !== "1 1 auto")
    main.style.flex = "1 1 auto";
  if (main.style.minHeight !== "0")
    main.style.minHeight = "0";
  if (main.style.display !== "flex")
    main.style.display = "flex";
  if (main.style.flexDirection !== "column")
    main.style.flexDirection = "column";
  if (main.style.gap !== "2px")
    main.style.gap = "2px";
  if (main.style.overflowY !== "auto")
    main.style.overflowY = "auto";
  if (main.style.overflowX !== "hidden")
    main.style.overflowX = "hidden";
  if (main.style.scrollbarWidth !== "none")
    main.style.scrollbarWidth = "none";
  if (bottom.style.flexShrink !== "0")
    bottom.style.flexShrink = "0";
  if (bottom.style.flexDirection !== "column")
    bottom.style.flexDirection = "column";
  if (bottom.style.gap !== "2px")
    bottom.style.gap = "2px";
  if (bottom.style.marginTop !== "auto")
    bottom.style.marginTop = "auto";
  if (bottom.style.paddingTop !== "8px")
    bottom.style.paddingTop = "8px";
  if (bottom.style.borderTop !== "1px solid var(--lumiverse-primary-020)") {
    bottom.style.borderTop = "1px solid var(--lumiverse-primary-020)";
  }
  return { main, bottom };
}
function syncMirrorButtonsInto(container, hostButtons, listRoot) {
  let insertBefore = container.firstChild;
  for (const hostBtn of hostButtons) {
    const key = hostButtonKey(hostBtn);
    let mirror = listRoot.querySelector(`button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(key)}"]`);
    if (!mirror) {
      mirror = document.createElement("button");
      mirror.type = "button";
      mirror.classList.add(MAIN_MIRROR_BTN_CLASS);
      mirror.setAttribute("data-mirror-key", key);
      mirror.addEventListener("click", onMirrorClick);
      mirror.addEventListener("contextmenu", onMirrorContextMenu);
      container.insertBefore(mirror, insertBefore);
    } else if (mirror.parentElement !== container || mirror !== insertBefore) {
      container.insertBefore(mirror, insertBefore);
    }
    syncMirrorFromHost(mirror, hostBtn);
    _mirrorToHost.set(mirror, hostBtn);
    insertBefore = mirror.nextSibling;
  }
  for (const child of Array.from(container.children)) {
    const el = child;
    if (!el.classList.contains(MAIN_MIRROR_BTN_CLASS)) {
      container.removeChild(el);
      continue;
    }
    const key = el.getAttribute("data-mirror-key") || "";
    if (!hostButtons.some((b) => hostButtonKey(b) === key)) {
      container.removeChild(el);
    }
  }
}
function resolveMirrorLabeled(hostBtn) {
  return hostBtn.classList.contains("tabBtnLabeled") || String(hostBtn.className || "").includes("tabBtnLabeled");
}
function applyMirrorButtonChrome(btn, labeled) {
  const height = labeled ? "56px" : "48px";
  if (btn.style.height === height && btn.style.gap === "1px") {
    btn.style.background = "";
    btn.style.boxShadow = "";
    btn.style.color = "";
    btn.style.borderRadius = "";
    return;
  }
  btn.style.width = "100%";
  btn.style.height = height;
  btn.style.flexShrink = "0";
  btn.style.display = "flex";
  btn.style.flexDirection = "column";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.gap = "1px";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.transition = "all 0.2s ease";
  btn.style.padding = "0";
  btn.style.boxSizing = "border-box";
  btn.style.background = "";
  btn.style.boxShadow = "";
  btn.style.color = "";
  btn.style.borderRadius = "";
}
function resolveMirrorList() {
  const fromShell = getMainMirrorTabList();
  if (fromShell)
    return fromShell;
  const side = getMainDrawerSide();
  const host = ensureMainPinHost(side);
  if (!host)
    return null;
  let list = host.querySelector(`.${MAIN_MIRROR_LIST_CLASS}`);
  if (!list) {
    list = host.querySelector(".sidebar-ux-tab-list");
  }
  if (!list) {
    list = document.createElement("div");
    list.classList.add("sidebar-ux-tab-list");
    list.classList.add(MAIN_MIRROR_LIST_CLASS);
    list.classList.add(TAB_LIST_PINNED_CLASS);
    host.appendChild(list);
  }
  return list;
}
function collectHostTabButtons(sidebar) {
  const buttons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]'));
  return buttons.filter((b) => {
    if (b.style.display === "none")
      return false;
    if (!String(b.className || "").includes("tabBtn"))
      return false;
    return true;
  });
}
function hostButtonKey(btn) {
  const id = btn.getAttribute("data-tab-id");
  if (id)
    return `id__${id}`;
  const title = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
  if (title)
    return `title__${title}`;
  return `node__${btn.tagName}__${btn.className}`;
}
function mirrorButtonKey(mirror) {
  const id = mirror.getAttribute("data-tab-id");
  if (id)
    return `id__${id}`;
  const title = mirror.getAttribute("title") || mirror.getAttribute("aria-label") || "";
  if (title)
    return `title__${title}`;
  const dataKey = mirror.getAttribute("data-mirror-key");
  if (dataKey)
    return dataKey;
  return `node__${mirror.tagName}__${mirror.className}`;
}
function hostHasTabBtnActive(host) {
  if (!host)
    return false;
  return host.classList.contains("tabBtnActive") || String(host.className || "").includes("tabBtnActive");
}
function syncMirrorFromHost(mirror, hostBtn) {
  const tabId = hostBtn.getAttribute("data-tab-id");
  if (tabId)
    mirror.setAttribute("data-tab-id", tabId);
  else
    mirror.removeAttribute("data-tab-id");
  const title = hostBtn.getAttribute("title") || hostBtn.getAttribute("aria-label") || "";
  if (title) {
    mirror.setAttribute("title", title);
    mirror.setAttribute("aria-label", title);
  }
  const key = hostButtonKey(hostBtn);
  const hostActive = hostHasTabBtnActive(hostBtn);
  const canvasActive = _activeMainMirrorKey != null && key === _activeMainMirrorKey;
  const showActive = isCanvasMainOpen() && (_activeMainMirrorKey != null ? canvasActive : hostActive);
  const wasActive = mirror.classList.contains("sidebar-ux-tab-active");
  mirror.classList.toggle("sidebar-ux-tab-active", showActive);
  if (showActive !== wasActive) {
    dlog("[main-mirror] active toggle", {
      title: mirror.getAttribute("title"),
      showActive,
      hostActive,
      canvasActive,
      canvasKey: _activeMainMirrorKey,
      open: isCanvasMainOpen()
    });
  }
  const labeled = resolveMirrorLabeled(hostBtn);
  mirror.classList.toggle("sidebar-ux-tab-labeled", labeled);
  const nextHtml = buildMirrorInnerHtml(hostBtn, labeled);
  if (mirror.getAttribute("data-mirror-html") !== nextHtml) {
    mirror.setAttribute("data-mirror-html", nextHtml);
    mirror.innerHTML = nextHtml;
  }
  applyMirrorButtonChrome(mirror, labeled);
}
function buildMirrorInnerHtml(hostBtn, labeled) {
  const parts = [];
  const svg = hostBtn.querySelector("svg");
  if (svg) {
    parts.push(`<span>${svg.outerHTML}</span>`);
  }
  const label = hostBtn.querySelector('span[class*="tabLabel"]');
  const text = label ? (label.textContent || "").trim() : "";
  if (labeled && text) {
    parts.push(`<span class="sidebar-ux-tab-label" style="opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease">${escapeHtml(text)}</span>`);
  }
  return parts.join("");
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cssAttrEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}
function onMirrorClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const mirror = ev.currentTarget;
  const title = mirror.getAttribute("title") || mirror.getAttribute("aria-label") || undefined;
  const hostBtn = _mirrorToHost.get(mirror);
  const key = hostBtn ? hostButtonKey(hostBtn) : mirrorButtonKey(mirror);
  const settingsHost = hostBtn && hostBtn.isConnected ? hostBtn : null;
  const isSettings = settingsHost != null && isSettingsButton(settingsHost) || isSettingsButton(mirror);
  if (isSettings) {
    dlog("[main-mirror] click → settings (host only, no canvas tab)", { key });
    let target = settingsHost;
    if (!target || !target.isConnected) {
      reconcileMainMirror();
      target = _mirrorToHost.get(mirror) ?? null;
    }
    if (target && target.isConnected) {
      try {
        target.click();
      } catch {}
    }
    return;
  }
  const wasActive = _activeMainMirrorKey != null ? key === _activeMainMirrorKey : mirror.classList.contains("sidebar-ux-tab-active") || hostHasTabBtnActive(hostBtn);
  if (isCanvasMainOpen() && wasActive) {
    dlog("[main-mirror] click → close (active tab)", { title, key });
    closeCanvasMainDrawer();
    return;
  }
  dlog("[main-mirror] click", {
    title,
    key,
    hostConnected: !!(hostBtn && hostBtn.isConnected),
    open: isCanvasMainOpen()
  });
  if (!hostBtn || !hostBtn.isConnected) {
    reconcileMainMirror();
    const again = _mirrorToHost.get(mirror);
    if (again && again.isConnected) {
      _activeMainMirrorKey = hostButtonKey(again);
      try {
        again.click();
      } catch {}
    } else {
      _activeMainMirrorKey = key;
    }
    onMainMirrorTabActivated(title);
    return;
  }
  try {
    hostBtn.click();
  } catch {}
  _activeMainMirrorKey = key;
  onMainMirrorTabActivated(title);
}
function onMirrorContextMenu(ev) {
  const e = ev;
  e.preventDefault();
  e.stopPropagation();
  const mirror = e.currentTarget;
  let hostBtn = _mirrorToHost.get(mirror);
  const settingsHost = hostBtn && hostBtn.isConnected ? hostBtn : null;
  const isSettings = settingsHost != null && isSettingsButton(settingsHost) || isSettingsButton(mirror);
  if (isSettings) {
    dlog("[main-mirror] contextmenu → settings (no host forward)");
    return;
  }
  if (!hostBtn || !hostBtn.isConnected) {
    reconcileMainMirror();
    hostBtn = _mirrorToHost.get(mirror);
  }
  if (!hostBtn || !hostBtn.isConnected) {
    dwarn("[main-mirror] contextmenu: no connected host twin", {
      title: mirror.getAttribute("title")
    });
    return;
  }
  dlog("[main-mirror] contextmenu → host forward", {
    title: hostBtn.getAttribute("title") || mirror.getAttribute("title"),
    x: e.clientX,
    y: e.clientY
  });
  try {
    hostBtn.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: e.clientX,
      clientY: e.clientY,
      button: 2,
      buttons: 2
    }));
  } catch (err) {
    dwarn("[main-mirror] contextmenu: host dispatch failed", err);
  }
}
function ensureObservers() {
  const sidebar = getMainSidebar();
  if (sidebar)
    attachSidebarObserver(sidebar);
}
function attachSidebarObserver(sidebar) {
  if (_sidebarObserver && _observedSidebar === sidebar)
    return;
  if (_sidebarObserver) {
    _sidebarObserver.disconnect();
    _sidebarObserver = null;
  }
  _observedSidebar = sidebar;
  if (typeof MutationObserver === "undefined")
    return;
  _sidebarObserver = new MutationObserver(() => scheduleReconcile());
  _sidebarObserver.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-tab-id", "title", "aria-label"]
  });
}
function stopObservers() {
  if (_sidebarObserver) {
    _sidebarObserver.disconnect();
    _sidebarObserver = null;
  }
  _observedSidebar = null;
  if (_reconcileRaf !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(_reconcileRaf);
    _reconcileRaf = null;
  }
}
var MAIN_MIRROR_LIST_CLASS = "sidebar-ux-main-tab-list-mirror", MAIN_MIRROR_BTN_CLASS = "sidebar-ux-main-tab-mirror-btn", MAIN_MIRROR_LIST_MAIN_CLASS = "sidebar-ux-tab-list-main", MAIN_MIRROR_LIST_BOTTOM_CLASS = "sidebar-ux-tab-list-bottom", _enabled = false, _sidebarObserver = null, _reconcileRaf = null, _observedSidebar = null, _activeMainMirrorKey = null, _mirrorToHost;
var init_main_tab_pin = __esm(() => {
  init_store();
  init_state();
  init_log();
  init_mobile_exclusion();
  init_main_mirror_drawer();
  init_tab_position();
  init_buttons();
  _mirrorToHost = new WeakMap;
});

// src/sidebar/drawer-observer.ts
class DrawerObserver {
  observer = null;
  tabs = new Map;
  tabHandlers = [];
  unregHandlers = [];
  start() {
    const sidebar = getMainSidebar();
    if (!sidebar) {
      console.warn("[DrawerObserver] main sidebar not found");
      return;
    }
    this.scanExistingTabs(sidebar);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              this.handleAddedNode(node);
            }
          }
          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              this.handleRemovedNode(node);
            }
          }
        }
      }
    });
    this.observer.observe(sidebar, { childList: true, subtree: true });
    registerCleanup(() => this.stop());
  }
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.tabs.clear();
  }
  onTabRegistered(handler) {
    this.tabHandlers.push(handler);
    return () => {
      const idx = this.tabHandlers.indexOf(handler);
      if (idx >= 0)
        this.tabHandlers.splice(idx, 1);
    };
  }
  onTabUnregistered(handler) {
    this.unregHandlers.push(handler);
    return () => {
      const idx = this.unregHandlers.indexOf(handler);
      if (idx >= 0)
        this.unregHandlers.splice(idx, 1);
    };
  }
  getTab(tabId) {
    return this.tabs.get(tabId) || null;
  }
  getAllTabs() {
    return Array.from(this.tabs.values());
  }
  scanExistingTabs(sidebar) {
    const buttons = sidebar.querySelectorAll("[data-tab-id]");
    for (const btn of buttons) {
      if (btn instanceof HTMLElement) {
        this.registerTab(btn);
      }
    }
  }
  handleAddedNode(node) {
    if (node.hasAttribute?.("data-tab-id")) {
      this.registerTab(node);
    }
    const buttons = node.querySelectorAll?.("[data-tab-id]");
    if (buttons) {
      for (const btn of buttons) {
        if (btn instanceof HTMLElement) {
          this.registerTab(btn);
        }
      }
    }
  }
  handleRemovedNode(node) {
    if (node instanceof HTMLElement && node.hasAttribute?.("data-tab-id")) {
      const tabId = node.getAttribute("data-tab-id") || "";
      if (this.tabs.has(tabId)) {
        this.tabs.delete(tabId);
        for (const h of this.unregHandlers)
          h(tabId);
      }
    }
    const buttons = node.querySelectorAll?.("[data-tab-id]");
    if (buttons) {
      for (const btn of buttons) {
        if (btn instanceof HTMLElement) {
          const tabId = btn.getAttribute("data-tab-id") || "";
          if (this.tabs.has(tabId)) {
            this.tabs.delete(tabId);
            for (const h of this.unregHandlers)
              h(tabId);
          }
        }
      }
    }
  }
  registerTab(button) {
    const tabId = button.getAttribute("data-tab-id") || "";
    if (!tabId || this.tabs.has(tabId))
      return;
    const parts = tabId.split(":");
    const extensionId = parts[2] || "unknown";
    const tab = {
      tabId,
      button,
      extensionId,
      title: button.getAttribute("title") || button.textContent?.trim() || ""
    };
    this.tabs.set(tabId, tab);
    for (const h of this.tabHandlers)
      h(tab);
  }
}
var drawerObserver;
var init_drawer_observer = __esm(() => {
  init_cleanup();
  drawerObserver = new DrawerObserver;
});

// src/tabs/builtin-move.ts
var exports_builtin_move = {};
__export(exports_builtin_move, {
  moveBuiltInTabToSecondaryContainer: () => moveBuiltInTabToSecondaryContainer
});
async function moveBuiltInTabToSecondaryContainer(opts) {
  const { tabId, deferActivation = false } = opts;
  const bridge = getHostBridge();
  const ui = bridge?.ui;
  if (!ui?.getBuiltInTabRoot || !ui.requestTabLocation) {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=BRIDGE_MISSING ` + `hasGetBuiltInTabRoot=${!!ui?.getBuiltInTabRoot} hasRequestTabLocation=${!!ui?.requestTabLocation}`);
    return;
  }
  let root = opts.root;
  if (!root) {
    root = ui.getBuiltInTabRoot(tabId);
  }
  if (!root) {
    const { ensureBuiltInTabActiveInMain } = await Promise.resolve().then(() => (init_assignment(), exports_assignment));
    await ensureBuiltInTabActiveInMain(tabId, {
      getBuiltInTabRoot: (id) => ui.getBuiltInTabRoot?.(id),
      dlog
    });
    await new Promise((r) => requestAnimationFrame(() => r()));
    root = ui.getBuiltInTabRoot(tabId);
    if (!root) {
      dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=EARLY_RETURN getBuiltInTabRootReturned=undefined`);
      dwarn("[SecondaryDrawer] assignToSecondary: built-in tabId not registered (stale or renamed). Skipping restore.", { tabId });
      return;
    }
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element`);
  } else {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_BRIDGE_ROOT tab=${tabId} branch=ROOT_READY via=opts-or-getBuiltInTabRoot`);
  }
  root.setAttribute("data-canvas-moved", tabId);
  if (!deferActivation) {
    root.setAttribute("data-canvas-active", "");
  }
  await new Promise((r) => requestAnimationFrame(() => r()));
  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} branch=REQUEST_TAB_LOCATION`);
  ui.requestTabLocation(tabId, {
    kind: "container",
    containerId: "canvas-secondary-drawer"
  });
  const afterLoc = ui.getTabLocation?.(tabId) ?? null;
  watchForContainerPass3Reset(bridge, tabId, root, afterLoc);
  return root;
}
function watchForContainerPass3Reset(bridge, tabId, builtInRoot, afterLoc) {
  queueMicrotask(() => {
    try {
      const microLoc = bridge.ui.getTabLocation?.(tabId) ?? null;
      const microContainer = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
      const rootInContainer = typeof microContainer?.contains === "function" ? microContainer.contains(builtInRoot) : false;
      if (afterLoc?.kind === "container" && microLoc?.kind === "main-drawer") {
        dwarn(`[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to main-drawer because the target container is missing from Lumiverse's containers store. Fix: ensure the secondary drawer's panel content element is registered via bridge.containers.registerContainer BEFORE ` + `the move. (See secondary.tsx — the call exists but may be failing silently.)`);
      }
    } catch {}
  });
}
var init_builtin_move = __esm(() => {
  init_log();
  init_secondary();
});

// src/sidebar/secondary-drawer.ts
var exports_secondary_drawer = {};
__export(exports_secondary_drawer, {
  unassignFromSecondary: () => unassignFromSecondary,
  teardownSecondaryDrawer: () => teardownSecondaryDrawer,
  setSuppressAutoActivation: () => setSuppressAutoActivation,
  setRestoringFromLayout: () => setRestoringFromLayout,
  isSuppressAutoActivation: () => isSuppressAutoActivation,
  isRestoringFromLayout: () => isRestoringFromLayout,
  initSecondaryDrawer: () => initSecondaryDrawer,
  getSecondaryDrawerState: () => getSecondaryDrawerState,
  getActiveSecondaryTab: () => getActiveSecondaryTab,
  assignToSecondary: () => assignToSecondary,
  activateSecondaryTab: () => activateSecondaryTab
});
function setRestoringFromLayout(value) {
  _restoringFromLayout = value;
}
function isRestoringFromLayout() {
  return _restoringFromLayout;
}
function setSuppressAutoActivation(value) {
  _suppressAutoActivation = value;
}
function isSuppressAutoActivation() {
  return _suppressAutoActivation;
}
function findStoreTab(tabIdOrTitle) {
  findStoreData(true);
  const tabs = getDrawerTabs();
  return tabs.find((t) => t.id === tabIdOrTitle) || tabs.find((t) => t.title === tabIdOrTitle) || null;
}
function initSecondaryDrawer(_ctx) {
  drawerObserver.onTabUnregistered((tabId) => {
    if (getTabAssignments().has(tabId)) {
      if (_restoringFromLayout)
        return;
      deleteTabAssignment(tabId);
      removeSecondaryTabButton(tabId);
      persistLayout();
      if (_activeTabId === tabId) {
        _activeTabId = null;
        _state = getTabAssignments().size > 0 ? "open" : "closed";
        if (_state === "closed") {
          closeSecondarySidebar();
          updateDrawerTabVisibility();
        }
      }
    }
  });
}
async function finalizeAssignToSecondary(opts) {
  const {
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment = true,
    openOnClosed = true,
    setActiveWhenReady = true,
    showAndPersist = true
  } = opts;
  addSecondaryTabButton({
    id: resolvedId,
    title,
    root,
    iconSvg,
    shortName
  });
  updateDrawerTabVisibility();
  if (wireAssignment) {
    setTabAssignment(resolvedId, "secondary");
    hideMainTabButton(resolvedId);
  }
  if (openOnClosed && _state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar();
    if (!deferActivation) {
      _state = "tab_active";
      _activeTabId = resolvedId;
      setActiveSecondaryTabId(resolvedId);
    }
  } else if (setActiveWhenReady && !isMobileViewport() && !deferActivation) {
    _activeTabId = resolvedId;
    _state = "tab_active";
    setActiveSecondaryTabId(resolvedId);
  }
  const headerTitle = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = title;
  }
  if (showAndPersist) {
    if (!isMobileViewport() && !deferActivation) {
      showSecondaryTab(resolvedId);
    }
    persistLayout();
  }
}
async function assignExtensionTabToSecondary(ctx) {
  const { tabId, tab, resolvedId, iconSvg, shortName, deferActivation } = ctx;
  setTabAssignment(resolvedId, "secondary");
  hideMainTabButton(resolvedId);
  if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar();
    _state = "open";
  }
  const secondaryContent = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content") ?? null;
  const bareId = resolvedId.includes(":") ? resolvedId.replace(/:\d+$/, "").split(":").pop() ?? resolvedId : resolvedId;
  const existingRoot = secondaryContent?.querySelector(`[data-canvas-moved="${CSS.escape(resolvedId)}"]`) ?? secondaryContent?.querySelector(`[data-canvas-moved="${CSS.escape(bareId)}"]`);
  if (existingRoot) {
    const storeTabForButton = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
    await finalizeAssignToSecondary({
      resolvedId,
      title: tab.title || storeTabForButton?.title || resolvedId,
      root: existingRoot,
      iconSvg: iconSvg || tab.button?.querySelector("svg")?.outerHTML || storeTabForButton?.iconSvg,
      shortName: shortName || readMainButtonShortName(tab.button) || storeTabForButton?.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      setActiveWhenReady: true
    });
    return;
  }
  const secondaryWrapper = getSecondaryWrapper();
  const secondaryContentMain = secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
  if (storeTab?.root && secondaryContentMain) {
    const root = storeTab.root;
    if (root.parentElement !== secondaryContentMain) {
      secondaryContentMain.appendChild(root);
    }
    root.setAttribute("data-canvas-moved", resolvedId);
    if (!deferActivation) {
      for (const child of Array.from(secondaryContentMain.children)) {
        if (child instanceof HTMLElement) {
          if (child === root) {
            child.setAttribute("data-canvas-active", "");
          } else {
            child.removeAttribute("data-canvas-active");
          }
        }
      }
    }
    await finalizeAssignToSecondary({
      resolvedId,
      title: tab.title || storeTab.title || resolvedId,
      root,
      iconSvg: tab.button?.querySelector("svg")?.outerHTML || storeTab.iconSvg,
      shortName: readMainButtonShortName(tab.button) || storeTab.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      setActiveWhenReady: true
    });
    return;
  }
  if (!isMobileViewport() && !deferActivation) {
    _activeTabId = resolvedId;
    _state = "tab_active";
    setActiveSecondaryTabId(resolvedId);
  }
  const headerTitle = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = tab.title || resolvedId;
  }
  if (!isMobileViewport() && !deferActivation) {
    showSecondaryTab(resolvedId);
  }
  persistLayout();
}
async function assignBuiltInTabToSecondary(ctx) {
  const { tabId, tab, resolvedId, deferActivation } = ctx;
  const secondaryWrapper = getSecondaryWrapper();
  const secondaryContent = secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
  const wSpindle = getHostBridge();
  const wSpindleUi = wSpindle?.ui;
  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!storeTab} ` + `hasSecondaryContent=${!!secondaryContent}`);
  let alreadyInSecondary = null;
  if (secondaryContent) {
    const idsToTry = resolvedId !== tabId ? [resolvedId, tabId] : [resolvedId];
    for (const id of idsToTry) {
      alreadyInSecondary = secondaryContent.querySelector(`[data-canvas-moved="${CSS.escape(id)}"]`);
      if (alreadyInSecondary)
        break;
    }
  }
  if (alreadyInSecondary) {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_EARLY_RETURN tab=${resolvedId} branch=ALREADY_IN_SECONDARY`);
    const title2 = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId;
    await finalizeAssignToSecondary({
      resolvedId,
      title: title2,
      root: alreadyInSecondary,
      iconSvg: tab.button?.querySelector("svg")?.outerHTML || alreadyInSecondary.querySelector("svg")?.outerHTML,
      shortName: readMainButtonShortName(tab.button) || storeTab?.shortName,
      deferActivation,
      wireAssignment: true,
      openOnClosed: true,
      setActiveWhenReady: false
    });
    return;
  }
  if (!secondaryContent) {
    dwarn("[SecondaryDrawer] assignToSecondary: secondary content missing; cannot place built-in.", {
      tabId,
      resolvedId
    });
    return;
  }
  const bridgeRoot = wSpindleUi?.getBuiltInTabRoot?.(tabId);
  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} ` + `rootFound=${!!bridgeRoot} rootTagId=${bridgeRoot?.getAttribute("data-tab-id") ?? "null"} via=getBuiltInTabRoot`);
  let root;
  let placedViaHost = false;
  if (wSpindleUi?.getBuiltInTabRoot && wSpindleUi?.requestTabLocation) {
    const { moveBuiltInTabToSecondaryContainer: moveBuiltInTabToSecondaryContainer2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
    root = await moveBuiltInTabToSecondaryContainer2({
      tabId,
      deferActivation,
      root: bridgeRoot
    });
    placedViaHost = !!root;
  }
  if (!root && storeTab?.root) {
    root = storeTab.root;
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root);
    }
    root.setAttribute("data-canvas-moved", resolvedId);
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_STORE_REPARENT tab=${resolvedId} branch=STORE_ROOT`);
  }
  if (!root) {
    if (!wSpindleUi?.getBuiltInTabRoot || !wSpindleUi?.requestTabLocation) {
      dwarn("[SecondaryDrawer] assignToSecondary: built-in tab cannot be auto-restored (host bridge missing, no store root).", {
        tabId,
        resolvedId
      });
    }
    return;
  }
  if (!deferActivation) {
    for (const child of Array.from(secondaryContent.children)) {
      if (child instanceof HTMLElement) {
        if (child === root || child.getAttribute("data-canvas-moved") === resolvedId) {
          child.setAttribute("data-canvas-active", "");
        } else if (child.hasAttribute("data-canvas-moved")) {
          child.removeAttribute("data-canvas-active");
        }
      }
    }
  }
  const title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId;
  const iconSvg = tab.button?.querySelector("svg")?.outerHTML || root.querySelector("svg")?.outerHTML;
  const shortName = readMainButtonShortName(tab.button) || storeTab?.shortName;
  if (placedViaHost) {
    try {
      const m = await Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer));
      if (m.isMainMirrorActive())
        m.ensureHostContentParkedPublic();
    } catch {}
  }
  await finalizeAssignToSecondary({
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment: true,
    openOnClosed: true,
    setActiveWhenReady: false
  });
}
async function assignToSecondary(tabId) {
  const deferActivation = isRestoringFromLayout() || isSuppressAutoActivation();
  let tab = drawerObserver.getTab(tabId);
  let iconSvg;
  let shortName;
  if (!tab) {
    const storeTab = findStoreTab(tabId);
    if (!storeTab) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} not found in DrawerObserver or store`);
      return;
    }
    const button = findMainTabButton(storeTab.title);
    if (!button) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} found in store but no main sidebar button (title="${storeTab.title}")`);
      return;
    }
    tab = {
      tabId: storeTab.id,
      button,
      extensionId: storeTab.extensionId,
      title: storeTab.title
    };
    iconSvg = storeTab.iconSvg;
    shortName = storeTab.shortName;
  } else {
    iconSvg = tab.button.querySelector("svg")?.outerHTML;
  }
  const resolvedId = tab.tabId;
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`);
  const ctx = { tabId, tab, resolvedId, iconSvg, shortName, deferActivation };
  const isExtensionTab = !!tab.extensionId && tab.extensionId !== "unknown";
  if (isExtensionTab) {
    await assignExtensionTabToSecondary(ctx);
  } else {
    await assignBuiltInTabToSecondary(ctx);
  }
}
async function unassignFromSecondary(tabId) {
  dlog(`[SecondaryDrawer] unassigning ${tabId} from secondary`);
  let resolvedShowId = tabId;
  let resolvedExtId;
  findStoreData(true);
  const _tabs = getDrawerTabs();
  const _bySegment = _tabs.find((t) => t.id.includes(`:tab:${tabId}:`) || t.id === tabId);
  if (_bySegment) {
    resolvedShowId = _bySegment.id;
    resolvedExtId = _bySegment.extensionId;
  } else {
    const storeTab = findStoreTab(tabId);
    if (storeTab) {
      resolvedShowId = storeTab.id;
      resolvedExtId = storeTab.extensionId;
    } else {
      dwarn(`[SecondaryDrawer] unassign: could not resolve bare id "${tabId}" to composite id; known tabs=`, _tabs.map((t) => ({ id: t.id, title: t.title })));
    }
  }
  const bridge = getHostBridge();
  const bridgeUi = bridge?.ui;
  const bridgeRoot = bridgeUi?.getBuiltInTabRoot?.(tabId) || (resolvedShowId !== tabId ? bridgeUi?.getBuiltInTabRoot?.(resolvedShowId) : undefined);
  const isBuiltIn = bridgeRoot != null;
  if (isBuiltIn && bridgeUi?.requestTabLocation) {
    const hostTabId = bridgeRoot?.getAttribute?.("data-tab-id") || tabId;
    try {
      bridgeUi.requestTabLocation(hostTabId, { kind: "main-drawer" });
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassign: requestTabLocation(main-drawer) failed for ${hostTabId}:`, err);
    }
  }
  const _secondaryContentForUnassign = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
  let _movedRoot = null;
  if (_secondaryContentForUnassign) {
    const idsToTry = resolvedShowId !== tabId ? [resolvedShowId, tabId] : [resolvedShowId];
    for (const id of idsToTry) {
      _movedRoot = _secondaryContentForUnassign.querySelector(`[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`);
      if (_movedRoot)
        break;
    }
  }
  if (isBuiltIn) {
    const clearAttrs = (el) => {
      if (!el)
        return;
      el.removeAttribute("data-canvas-moved");
      el.removeAttribute("data-canvas-active");
    };
    clearAttrs(_movedRoot);
    clearAttrs(bridgeRoot);
    if (!_movedRoot && typeof document !== "undefined") {
      const idsToTry = resolvedShowId !== tabId ? [resolvedShowId, tabId] : [resolvedShowId];
      for (const id of idsToTry) {
        const residual = document.querySelector(`[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`);
        if (residual) {
          clearAttrs(residual);
          break;
        }
      }
    }
  } else if (_movedRoot) {
    const { getMainPanelContent: getMainPanelContent2 } = await Promise.resolve().then(() => exports_lumiverse);
    const _mainContent = getMainPanelContent2();
    if (_mainContent && _movedRoot.parentElement !== _mainContent) {
      _mainContent.appendChild(_movedRoot);
    }
    _movedRoot.removeAttribute("data-canvas-moved");
    _movedRoot.removeAttribute("data-canvas-active");
  } else if (typeof document !== "undefined") {
    const idsToTry = resolvedShowId !== tabId ? [resolvedShowId, tabId] : [resolvedShowId];
    for (const id of idsToTry) {
      const residual = document.querySelector(`[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`);
      if (residual) {
        residual.removeAttribute("data-canvas-moved");
        residual.removeAttribute("data-canvas-active");
        break;
      }
    }
  }
  deleteTabAssignment(tabId);
  if (resolvedShowId !== tabId) {
    deleteTabAssignment(resolvedShowId);
  }
  removeSecondaryTabButton(tabId);
  const activeId = getActiveSecondaryTabId();
  if (activeId === tabId || activeId === resolvedShowId) {
    _activeTabId = null;
    setActiveSecondaryTabId(null);
    clearSecondaryTabButtonActive();
  }
  showMainTabButton(resolvedShowId);
  try {
    const m = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
    m.reconcileMainTabListPin();
  } catch {}
  if (getTabAssignments().size === 0) {
    _state = "closed";
    _activeTabId = null;
    closeSecondarySidebar();
    updateDrawerTabVisibility();
  }
  persistLayout();
}
function activateSecondaryTab(tabId) {
  _activeTabId = tabId;
  _state = "tab_active";
  showSecondaryTab(tabId);
}
function getActiveSecondaryTab() {
  return _activeTabId;
}
function getSecondaryDrawerState() {
  return _state;
}
function teardownSecondaryDrawer() {
  _state = "closed";
  _activeTabId = null;
}
var _state = "closed", _activeTabId = null, _restoringFromLayout = false, _suppressAutoActivation = false;
var init_secondary_drawer = __esm(() => {
  init_drawer_observer();
  init_buttons();
  init_assignment();
  init_active_tab();
  init_persist();
  init_secondary();
  init_store();
  init_log();
  init_mobile_exclusion();
});

// src/sidebar/drawer-sync.ts
function isShowTabLabels() {
  const store = getStoreSnapshot();
  if (store) {
    const snapshot = asDrawerStore(store);
    if (snapshot.drawerSettings) {
      return !!snapshot.drawerSettings.showTabLabels;
    }
  }
  const sidebar = getMainSidebar();
  if (sidebar) {
    const labeledBtn = sidebar.querySelector('button[class*="tabBtnLabeled"]');
    if (labeledBtn)
      return true;
  }
  return false;
}
function syncDrawerTabSettings() {
  if (_syncPending)
    return;
  _syncPending = true;
  requestAnimationFrame(() => {
    _syncPending = false;
    _runSyncDrawerTabSettings();
  });
}
function _runSyncDrawerTabSettings() {
  const drawerTab = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
  const mainMirrorWrapperEarly = getMainMirrorWrapper();
  if (!drawerTab && !mainMirrorWrapperEarly)
    return;
  let mainDrawerTab = null;
  const mainWrapper = getMainWrapper();
  if (mainWrapper) {
    mainDrawerTab = mainWrapper.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)');
  }
  if (!mainDrawerTab) {
    mainDrawerTab = document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)');
  }
  if (!mainDrawerTab) {
    requestAnimationFrame(() => _runSyncDrawerTabSettings());
    return;
  }
  const w = mainDrawerTab.offsetWidth;
  const h = mainDrawerTab.offsetHeight;
  if (w < 16 || w > 120 || h < 16 || h > 400) {
    dlog(`[drawer-sync] main drawer tab dimensions look wrong (w=${w} h=${h}), skipping mirror`);
    return;
  }
  if (!_mainDrawerTabResizeObserver) {
    _mainDrawerTabResizeObserver = new ResizeObserver(() => {
      syncDrawerTabSettings();
    });
    _mainDrawerTabResizeObserver.observe(mainDrawerTab);
    registerCleanup(stopDrawerTabResizeWatcher);
  }
  if (!_mainDrawerTabClassObserver) {
    _mainDrawerTabClassObserver = new MutationObserver(() => {
      syncDrawerTabSettings();
    });
    _mainDrawerTabClassObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ["class"] });
    registerCleanup(stopDrawerTabClassObserver);
  }
  if (!_mainDrawerTabStyleObserver) {
    _mainDrawerTabStyleObserver = new MutationObserver(() => {
      syncDrawerTabSettings();
    });
    _mainDrawerTabStyleObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ["style"] });
    registerCleanup(stopDrawerTabStyleObserver);
  }
  const secondaryWrapper = getSecondaryWrapper();
  const mainMirrorWrapper = getMainMirrorWrapper();
  const mainStyle = getComputedStyle(mainDrawerTab);
  const newVars = [
    `${mainDrawerTab.offsetWidth}px`,
    `${mainDrawerTab.offsetHeight}px`,
    mainStyle.paddingTop,
    mainStyle.paddingRight,
    mainStyle.paddingBottom,
    mainStyle.paddingLeft,
    mainStyle.gap,
    `${mainStyle.borderTopWidth} solid var(--lumiverse-border-hover)`
  ].join("|");
  if (newVars !== _lastWrittenDrawerTabVars) {
    _lastWrittenDrawerTabVars = newVars;
    const parts = newVars.split("|");
    const stamp = (wrapper) => {
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-w", parts[0]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-h", parts[1]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-pt", parts[2]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-pr", parts[3]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-pb", parts[4]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-pl", parts[5]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-gap", parts[6]);
      wrapper.style.setProperty("--sidebar-ux-drawer-tab-border", parts[7]);
    };
    if (secondaryWrapper)
      stamp(secondaryWrapper);
    if (mainMirrorWrapper)
      stamp(mainMirrorWrapper);
  } else {
    if (mainMirrorWrapper && !mainMirrorWrapper.style.getPropertyValue("--sidebar-ux-drawer-tab-w")) {
      const parts = newVars.split("|");
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-w", parts[0]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-h", parts[1]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-pt", parts[2]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-pr", parts[3]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-pb", parts[4]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-pl", parts[5]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-gap", parts[6]);
      mainMirrorWrapper.style.setProperty("--sidebar-ux-drawer-tab-border", parts[7]);
    }
  }
  const mainParent = mainDrawerTab.parentElement;
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0;
  const mainMarginStyle = mainDrawerTab.style.marginTop;
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0;
  if (_lastKnownVerticalPos !== posVh) {
    const settings = getSettings();
    if (settings.mirrorCompactPosition) {
      if (drawerTab)
        drawerTab.style.marginTop = `${posVh}vh`;
      const mainMirrorTab2 = mainMirrorWrapper?.querySelector(".sidebar-ux-drawer-tab");
      if (mainMirrorTab2)
        mainMirrorTab2.style.marginTop = `${posVh}vh`;
    } else if (settings.secondaryDrawerTabOverrideVh === undefined) {
      if (drawerTab)
        drawerTab.style.marginTop = "";
    }
    _lastKnownVerticalPos = posVh;
  }
  if (drawerTab) {
    drawerTab.classList.toggle("sidebar-ux-drawer-tab--active", isSecondarySidebarOpen());
  }
  const mainMirrorTab = mainMirrorWrapper?.querySelector(".sidebar-ux-drawer-tab");
  if (mainMirrorTab && isMainMirrorActive()) {
    mainMirrorTab.classList.toggle("sidebar-ux-drawer-tab--active", isCanvasMainOpen());
  }
  syncSecondaryTabLabels();
}
function syncSecondaryTabLabels() {
  const showLabels = isShowTabLabels();
  const cacheKey = showLabels ? "show" : "hide";
  if (cacheKey === _lastWrittenLabelsKey)
    return;
  _lastWrittenLabelsKey = cacheKey;
  const roots = [];
  const secondary = getSecondaryWrapper();
  if (secondary)
    roots.push(secondary);
  const mainMirror = getMainMirrorWrapper();
  if (mainMirror)
    roots.push(mainMirror);
  if (typeof document.querySelectorAll === "function") {
    for (const host of Array.from(document.querySelectorAll(".sidebar-ux-tab-list-pin-host"))) {
      roots.push(host);
    }
  }
  for (const root of roots) {
    const labels = root.querySelectorAll(".sidebar-ux-tab-label");
    for (const label of labels) {
      label.style.opacity = showLabels ? "1" : "0";
      label.style.height = showLabels ? "auto" : "0";
      label.style.marginTop = showLabels ? "1px" : "0";
      const btn = label.closest("button[data-tab-id], button.sidebar-ux-main-tab-mirror-btn");
      if (btn) {
        btn.classList.toggle("sidebar-ux-tab-labeled", showLabels);
        btn.style.height = showLabels ? "56px" : "48px";
      }
    }
  }
}
function checkSideChanged() {
  const currentSide = getMainDrawerSide();
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    const wasOpen = isSecondarySidebarOpen();
    unmountSecondarySidebar();
    _lastWrittenDrawerTabVars = null;
    _lastWrittenLabelsKey = null;
    _lastKnownVerticalPos = null;
    stopDrawerTabResizeWatcher();
    stopDrawerTabClassObserver();
    stopDrawerTabStyleObserver();
    findStoreData(true);
    mountSecondarySidebar({ initialOpen: wasOpen });
    Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m) => m.reconcileMainTabListPin());
    restoreSecondaryTabButtons();
    Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer)).then(({ assignToSecondary: assignToSecondary2 }) => {
      for (const [tabId, side] of getTabAssignments()) {
        if (side === "secondary")
          assignToSecondary2(tabId).catch(() => {});
      }
    });
    updateDrawerTabVisibility();
    const activeTabId = getActiveSecondaryTabId();
    if (activeTabId !== null) {
      const assignments = getTabAssignments();
      if (assignments.get(activeTabId) === "secondary") {
        showSecondaryTab(activeTabId);
      }
    }
  }
  _lastKnownSide = currentSide;
  syncDrawerTabSettings();
}
function restoreSecondaryTabButtons() {
  const tabs = getDrawerTabs();
  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar !== "secondary")
      continue;
    let tab = tabs && tabs.find((t) => t.id === tabId);
    if (!tab && tabs) {
      const stripSuffix = (id) => {
        const lastColon = id.lastIndexOf(":");
        if (lastColon <= 0)
          return id;
        const tail = id.slice(lastColon + 1);
        return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id;
      };
      const storedPrefix = stripSuffix(tabId);
      const candidates = tabs.filter((t) => stripSuffix(t.id) === storedPrefix);
      if (candidates.length === 1) {
        tab = candidates[0];
        dlog(`restoreSecondaryTabButtons: suffix-drift fallback matched stored "${tabId}" -> live "${tab.id}"`);
      }
    }
    if (tab) {
      addSecondaryTabButton(tab);
      continue;
    }
    const mainBtn = findMainTabButton(tabId);
    if (mainBtn) {
      const id = mainBtn.getAttribute("data-tab-id") || tabId;
      const title = mainBtn.getAttribute("title") || tabId;
      const svg = mainBtn.querySelector("svg")?.outerHTML;
      addSecondaryTabButton({
        id,
        title,
        root: undefined,
        iconSvg: svg
      });
      dlog(`restoreSecondaryTabButtons: DOM-fallback restored tab "${id}" from main sidebar button`);
    } else {
      dwarn(`restoreSecondaryTabButtons: tab "${tabId}" not found in store or main sidebar`);
    }
  }
}
function startSideChangeWatcher() {
  if (_sideObserver !== null)
    return;
  _lastKnownSide = getMainDrawerSide();
  const wrapper = getMainWrapper();
  if (!wrapper) {
    dwarn("startSideChangeWatcher: no main wrapper found; side changes will not be detected until the wrapper appears");
    return;
  }
  _sideObserver = new MutationObserver(() => {
    checkSideChanged();
  });
  _sideObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
  registerCleanup(() => stopSideChangeWatcher());
}
function stopSideChangeWatcher() {
  if (_sideObserver === null)
    return;
  _sideObserver.disconnect();
  _sideObserver = null;
}
function stopDrawerTabResizeWatcher() {
  if (_mainDrawerTabResizeObserver) {
    _mainDrawerTabResizeObserver.disconnect();
    _mainDrawerTabResizeObserver = null;
  }
}
function stopDrawerTabClassObserver() {
  if (_mainDrawerTabClassObserver) {
    _mainDrawerTabClassObserver.disconnect();
    _mainDrawerTabClassObserver = null;
  }
}
function stopDrawerTabStyleObserver() {
  if (_mainDrawerTabStyleObserver) {
    _mainDrawerTabStyleObserver.disconnect();
    _mainDrawerTabStyleObserver = null;
  }
}
var _lastKnownSide = null, _lastKnownVerticalPos = null, _mainDrawerTabResizeObserver = null, _mainDrawerTabClassObserver = null, _mainDrawerTabStyleObserver = null, _syncPending = false, _lastWrittenDrawerTabVars = null, _lastWrittenLabelsKey = null, _sideObserver = null;
var init_drawer_sync = __esm(() => {
  init_store();
  init_log();
  init_secondary();
  init_main_mirror_drawer();
  init_assignment();
  init_cleanup();
  init_state();
  init_buttons();
  init_active_tab();
});

// src/dom/host-settings.ts
function scanForHostSettings(fiber, depth, maxDepth, visited) {
  if (!fiber || depth > maxDepth || visited.has(fiber))
    return;
  visited.add(fiber);
  let hook = fiber.memoizedState;
  let hookIdx = 0;
  while (hook && hookIdx < 40) {
    const state = hook.memoizedState;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      const keys = Object.keys(state);
      const hasDrawerSettings = keys.includes("drawerSettings");
      const hasSetSetting = keys.includes("setSetting") && typeof state.setSetting === "function";
      if (hasDrawerSettings) {
        _cachedDrawerSettings = state.drawerSettings;
      }
      if (hasSetSetting) {
        _cachedSetSetting = state.setSetting;
      }
      if (hasDrawerSettings && hasSetSetting) {
        _cacheTimestamp2 = Date.now();
        return;
      }
    }
    hook = hook.next;
    hookIdx++;
  }
  scanForHostSettings(fiber.child, depth + 1, maxDepth, visited);
  scanForHostSettings(fiber.sibling, depth, maxDepth, visited);
}
function findHostSettings(force = false) {
  const now = Date.now();
  if (!force && _cachedSetSetting && _cachedDrawerSettings && now - _cacheTimestamp2 < CACHE_TTL_MS2) {
    return;
  }
  if (_testSetSetting) {
    if (_cachedDrawerSettings)
      return;
    _cachedDrawerSettings = { tabOrder: [], hiddenTabIds: [], side: "right" };
    return;
  }
  if (typeof document === "undefined")
    return;
  const sidebar = getMainSidebar();
  if (!sidebar)
    return;
  const rootFiber = getFiberFromElement(sidebar);
  if (!rootFiber)
    return;
  let fiber = rootFiber;
  const ancestors = [];
  while (fiber) {
    ancestors.push(fiber);
    fiber = fiber.return;
  }
  const visited = new Set;
  for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 5); i--) {
    scanForHostSettings(ancestors[i], 0, 30, visited);
    if (_cachedSetSetting && _cachedDrawerSettings) {
      _cacheTimestamp2 = Date.now();
      break;
    }
  }
}
function getHostDrawerSettings() {
  findHostSettings();
  return _cachedDrawerSettings;
}
function patchHostDrawerSettings(partial) {
  findHostSettings();
  if (_testSetSetting) {
    const current2 = getHostDrawerSettings() ?? {};
    _testSetSetting("drawerSettings", { ...current2, ...partial });
    findStoreData(true);
    return true;
  }
  if (!_cachedSetSetting) {
    dlog("patchHostDrawerSettings: setSetting not available (NO-GO)");
    return false;
  }
  const current = _cachedDrawerSettings ?? {};
  _cachedSetSetting("drawerSettings", { ...current, ...partial });
  findStoreData(true);
  return true;
}
function isHostDrawerSettingsWritable() {
  if (_testSetSetting)
    return true;
  findHostSettings();
  return _cachedSetSetting !== null;
}
var _cachedDrawerSettings = null, _cachedSetSetting = null, _cacheTimestamp2 = 0, CACHE_TTL_MS2 = 3000, _testSetSetting = null;
var init_host_settings = __esm(() => {
  init_fiber();
  init_log();
  init_store();
});

// node_modules/.pnpm/preact@10.29.2/node_modules/preact/dist/preact.module.js
function m(n2, l2) {
  for (var u2 in l2)
    n2[u2] = l2[u2];
  return n2;
}
function b(n2) {
  n2 && n2.parentNode && n2.parentNode.removeChild(n2);
}
function k(l2, u2, t2) {
  var i2, r2, o2, e2 = {};
  for (o2 in u2)
    o2 == "key" ? i2 = u2[o2] : o2 == "ref" ? r2 = u2[o2] : e2[o2] = u2[o2];
  if (arguments.length > 2 && (e2.children = arguments.length > 3 ? n.call(arguments, 2) : t2), typeof l2 == "function" && l2.defaultProps != null)
    for (o2 in l2.defaultProps)
      e2[o2] === undefined && (e2[o2] = l2.defaultProps[o2]);
  return x(l2, e2, i2, r2, null);
}
function x(n2, t2, i2, r2, o2) {
  var e2 = { type: n2, props: t2, key: i2, ref: r2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: undefined, __v: o2 == null ? ++u : o2, __i: -1, __u: 0 };
  return o2 == null && l.vnode != null && l.vnode(e2), e2;
}
function S(n2) {
  return n2.children;
}
function C(n2, l2) {
  this.props = n2, this.context = l2;
}
function $(n2, l2) {
  if (l2 == null)
    return n2.__ ? $(n2.__, n2.__i + 1) : null;
  for (var u2;l2 < n2.__k.length; l2++)
    if ((u2 = n2.__k[l2]) != null && u2.__e != null)
      return u2.__e;
  return typeof n2.type == "function" ? $(n2) : null;
}
function I(n2) {
  if (n2.__P && n2.__d) {
    var u2 = n2.__v, t2 = u2.__e, i2 = [], r2 = [], o2 = m({}, u2);
    o2.__v = u2.__v + 1, l.vnode && l.vnode(o2), q(n2.__P, o2, u2, n2.__n, n2.__P.namespaceURI, 32 & u2.__u ? [t2] : null, i2, t2 == null ? $(u2) : t2, !!(32 & u2.__u), r2), o2.__v = u2.__v, o2.__.__k[o2.__i] = o2, D(i2, o2, r2), u2.__e = u2.__ = null, o2.__e != t2 && P(o2);
  }
}
function P(n2) {
  if ((n2 = n2.__) != null && n2.__c != null)
    return n2.__e = n2.__c.base = null, n2.__k.some(function(l2) {
      if (l2 != null && l2.__e != null)
        return n2.__e = n2.__c.base = l2.__e;
    }), P(n2);
}
function A(n2) {
  (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
}
function H() {
  try {
    for (var n2, l2 = 1;i.length; )
      i.length > l2 && i.sort(e), n2 = i.shift(), l2 = i.length, I(n2);
  } finally {
    i.length = H.__r = 0;
  }
}
function L(n2, l2, u2, t2, i2, r2, o2, e2, f2, c2, a2) {
  var s2, h2, p2, v2, y2, _2, g2, m2 = t2 && t2.__k || w, b2 = l2.length;
  for (f2 = T(u2, l2, m2, f2, b2), s2 = 0;s2 < b2; s2++)
    (p2 = u2.__k[s2]) != null && (h2 = p2.__i != -1 && m2[p2.__i] || d, p2.__i = s2, _2 = q(n2, p2, h2, i2, r2, o2, e2, f2, c2, a2), v2 = p2.__e, p2.ref && h2.ref != p2.ref && (h2.ref && J(h2.ref, null, p2), a2.push(p2.ref, p2.__c || v2, p2)), y2 == null && v2 != null && (y2 = v2), (g2 = !!(4 & p2.__u)) || h2.__k === p2.__k ? (f2 = j(p2, f2, n2, g2), g2 && h2.__e && (h2.__e = null)) : typeof p2.type == "function" && _2 !== undefined ? f2 = _2 : v2 && (f2 = v2.nextSibling), p2.__u &= -7);
  return u2.__e = y2, f2;
}
function T(n2, l2, u2, t2, i2) {
  var r2, o2, e2, f2, c2, a2 = u2.length, s2 = a2, h2 = 0;
  for (n2.__k = new Array(i2), r2 = 0;r2 < i2; r2++)
    (o2 = l2[r2]) != null && typeof o2 != "boolean" && typeof o2 != "function" ? (typeof o2 == "string" || typeof o2 == "number" || typeof o2 == "bigint" || o2.constructor == String ? o2 = n2.__k[r2] = x(null, o2, null, null, null) : g(o2) ? o2 = n2.__k[r2] = x(S, { children: o2 }, null, null, null) : o2.constructor === undefined && o2.__b > 0 ? o2 = n2.__k[r2] = x(o2.type, o2.props, o2.key, o2.ref ? o2.ref : null, o2.__v) : n2.__k[r2] = o2, f2 = r2 + h2, o2.__ = n2, o2.__b = n2.__b + 1, e2 = null, (c2 = o2.__i = O(o2, u2, f2, s2)) != -1 && (s2--, (e2 = u2[c2]) && (e2.__u |= 2)), e2 == null || e2.__v == null ? (c2 == -1 && (i2 > a2 ? h2-- : i2 < a2 && h2++), typeof o2.type != "function" && (o2.__u |= 4)) : c2 != f2 && (c2 == f2 - 1 ? h2-- : c2 == f2 + 1 ? h2++ : (c2 > f2 ? h2-- : h2++, o2.__u |= 4))) : n2.__k[r2] = null;
  if (s2)
    for (r2 = 0;r2 < a2; r2++)
      (e2 = u2[r2]) != null && (2 & e2.__u) == 0 && (e2.__e == t2 && (t2 = $(e2)), K(e2, e2));
  return t2;
}
function j(n2, l2, u2, t2) {
  var i2, r2;
  if (typeof n2.type == "function") {
    for (i2 = n2.__k, r2 = 0;i2 && r2 < i2.length; r2++)
      i2[r2] && (i2[r2].__ = n2, l2 = j(i2[r2], l2, u2, t2));
    return l2;
  }
  n2.__e != l2 && (t2 && (l2 && n2.type && !l2.parentNode && (l2 = $(n2)), u2.insertBefore(n2.__e, l2 || null)), l2 = n2.__e);
  do {
    l2 = l2 && l2.nextSibling;
  } while (l2 != null && l2.nodeType == 8);
  return l2;
}
function O(n2, l2, u2, t2) {
  var i2, r2, o2, e2 = n2.key, f2 = n2.type, c2 = l2[u2], a2 = c2 != null && (2 & c2.__u) == 0;
  if (c2 === null && e2 == null || a2 && e2 == c2.key && f2 == c2.type)
    return u2;
  if (t2 > (a2 ? 1 : 0)) {
    for (i2 = u2 - 1, r2 = u2 + 1;i2 >= 0 || r2 < l2.length; )
      if ((c2 = l2[o2 = i2 >= 0 ? i2-- : r2++]) != null && (2 & c2.__u) == 0 && e2 == c2.key && f2 == c2.type)
        return o2;
  }
  return -1;
}
function z(n2, l2, u2) {
  l2[0] == "-" ? n2.setProperty(l2, u2 == null ? "" : u2) : n2[l2] = u2 == null ? "" : typeof u2 != "number" || _.test(l2) ? u2 : u2 + "px";
}
function N(n2, l2, u2, t2, i2) {
  var r2, o2;
  n:
    if (l2 == "style")
      if (typeof u2 == "string")
        n2.style.cssText = u2;
      else {
        if (typeof t2 == "string" && (n2.style.cssText = t2 = ""), t2)
          for (l2 in t2)
            u2 && l2 in u2 || z(n2.style, l2, "");
        if (u2)
          for (l2 in u2)
            t2 && u2[l2] == t2[l2] || z(n2.style, l2, u2[l2]);
      }
    else if (l2[0] == "o" && l2[1] == "n")
      r2 = l2 != (l2 = l2.replace(s, "$1")), o2 = l2.toLowerCase(), l2 = o2 in n2 || l2 == "onFocusOut" || l2 == "onFocusIn" ? o2.slice(2) : l2.slice(2), n2.l || (n2.l = {}), n2.l[l2 + r2] = u2, u2 ? t2 ? u2[a] = t2[a] : (u2[a] = h, n2.addEventListener(l2, r2 ? v : p, r2)) : n2.removeEventListener(l2, r2 ? v : p, r2);
    else {
      if (i2 == "http://www.w3.org/2000/svg")
        l2 = l2.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if (l2 != "width" && l2 != "height" && l2 != "href" && l2 != "list" && l2 != "form" && l2 != "tabIndex" && l2 != "download" && l2 != "rowSpan" && l2 != "colSpan" && l2 != "role" && l2 != "popover" && l2 in n2)
        try {
          n2[l2] = u2 == null ? "" : u2;
          break n;
        } catch (n3) {}
      typeof u2 == "function" || (u2 == null || u2 === false && l2[4] != "-" ? n2.removeAttribute(l2) : n2.setAttribute(l2, l2 == "popover" && u2 == 1 ? "" : u2));
    }
}
function V(n2) {
  return function(u2) {
    if (this.l) {
      var t2 = this.l[u2.type + n2];
      if (u2[c] == null)
        u2[c] = h++;
      else if (u2[c] < t2[a])
        return;
      return t2(l.event ? l.event(u2) : u2);
    }
  };
}
function q(n2, u2, t2, i2, r2, o2, e2, f2, c2, a2) {
  var s2, h2, p2, v2, y2, d2, _2, k2, x2, M, $2, I2, P2, A2, H2, T2 = u2.type;
  if (u2.constructor !== undefined)
    return null;
  128 & t2.__u && (c2 = !!(32 & t2.__u), o2 = [f2 = u2.__e = t2.__e]), (s2 = l.__b) && s2(u2);
  n:
    if (typeof T2 == "function")
      try {
        if (k2 = u2.props, x2 = T2.prototype && T2.prototype.render, M = (s2 = T2.contextType) && i2[s2.__c], $2 = s2 ? M ? M.props.value : s2.__ : i2, t2.__c ? _2 = (h2 = u2.__c = t2.__c).__ = h2.__E : (x2 ? u2.__c = h2 = new T2(k2, $2) : (u2.__c = h2 = new C(k2, $2), h2.constructor = T2, h2.render = Q), M && M.sub(h2), h2.state || (h2.state = {}), h2.__n = i2, p2 = h2.__d = true, h2.__h = [], h2._sb = []), x2 && h2.__s == null && (h2.__s = h2.state), x2 && T2.getDerivedStateFromProps != null && (h2.__s == h2.state && (h2.__s = m({}, h2.__s)), m(h2.__s, T2.getDerivedStateFromProps(k2, h2.__s))), v2 = h2.props, y2 = h2.state, h2.__v = u2, p2)
          x2 && T2.getDerivedStateFromProps == null && h2.componentWillMount != null && h2.componentWillMount(), x2 && h2.componentDidMount != null && h2.__h.push(h2.componentDidMount);
        else {
          if (x2 && T2.getDerivedStateFromProps == null && k2 !== v2 && h2.componentWillReceiveProps != null && h2.componentWillReceiveProps(k2, $2), u2.__v == t2.__v || !h2.__e && h2.shouldComponentUpdate != null && h2.shouldComponentUpdate(k2, h2.__s, $2) === false) {
            u2.__v != t2.__v && (h2.props = k2, h2.state = h2.__s, h2.__d = false), u2.__e = t2.__e, u2.__k = t2.__k, u2.__k.some(function(n3) {
              n3 && (n3.__ = u2);
            }), w.push.apply(h2.__h, h2._sb), h2._sb = [], h2.__h.length && e2.push(h2);
            break n;
          }
          h2.componentWillUpdate != null && h2.componentWillUpdate(k2, h2.__s, $2), x2 && h2.componentDidUpdate != null && h2.__h.push(function() {
            h2.componentDidUpdate(v2, y2, d2);
          });
        }
        if (h2.context = $2, h2.props = k2, h2.__P = n2, h2.__e = false, I2 = l.__r, P2 = 0, x2)
          h2.state = h2.__s, h2.__d = false, I2 && I2(u2), s2 = h2.render(h2.props, h2.state, h2.context), w.push.apply(h2.__h, h2._sb), h2._sb = [];
        else
          do {
            h2.__d = false, I2 && I2(u2), s2 = h2.render(h2.props, h2.state, h2.context), h2.state = h2.__s;
          } while (h2.__d && ++P2 < 25);
        h2.state = h2.__s, h2.getChildContext != null && (i2 = m(m({}, i2), h2.getChildContext())), x2 && !p2 && h2.getSnapshotBeforeUpdate != null && (d2 = h2.getSnapshotBeforeUpdate(v2, y2)), A2 = s2 != null && s2.type === S && s2.key == null ? E(s2.props.children) : s2, f2 = L(n2, g(A2) ? A2 : [A2], u2, t2, i2, r2, o2, e2, f2, c2, a2), h2.base = u2.__e, u2.__u &= -161, h2.__h.length && e2.push(h2), _2 && (h2.__E = h2.__ = null);
      } catch (n3) {
        if (u2.__v = null, c2 || o2 != null)
          if (n3.then) {
            for (u2.__u |= c2 ? 160 : 128;f2 && f2.nodeType == 8 && f2.nextSibling; )
              f2 = f2.nextSibling;
            o2[o2.indexOf(f2)] = null, u2.__e = f2;
          } else {
            for (H2 = o2.length;H2--; )
              b(o2[H2]);
            B(u2);
          }
        else
          u2.__e = t2.__e, u2.__k = t2.__k, n3.then || B(u2);
        l.__e(n3, u2, t2);
      }
    else
      o2 == null && u2.__v == t2.__v ? (u2.__k = t2.__k, u2.__e = t2.__e) : f2 = u2.__e = G(t2.__e, u2, t2, i2, r2, o2, e2, c2, a2);
  return (s2 = l.diffed) && s2(u2), 128 & u2.__u ? undefined : f2;
}
function B(n2) {
  n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
}
function D(n2, u2, t2) {
  for (var i2 = 0;i2 < t2.length; i2++)
    J(t2[i2], t2[++i2], t2[++i2]);
  l.__c && l.__c(u2, n2), n2.some(function(u3) {
    try {
      n2 = u3.__h, u3.__h = [], n2.some(function(n3) {
        n3.call(u3);
      });
    } catch (n3) {
      l.__e(n3, u3.__v);
    }
  });
}
function E(n2) {
  return typeof n2 != "object" || n2 == null || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : n2.constructor !== undefined ? null : m({}, n2);
}
function G(u2, t2, i2, r2, o2, e2, f2, c2, a2) {
  var s2, h2, p2, v2, y2, w2, _2, m2 = i2.props || d, k2 = t2.props, x2 = t2.type;
  if (x2 == "svg" ? o2 = "http://www.w3.org/2000/svg" : x2 == "math" ? o2 = "http://www.w3.org/1998/Math/MathML" : o2 || (o2 = "http://www.w3.org/1999/xhtml"), e2 != null) {
    for (s2 = 0;s2 < e2.length; s2++)
      if ((y2 = e2[s2]) && "setAttribute" in y2 == !!x2 && (x2 ? y2.localName == x2 : y2.nodeType == 3)) {
        u2 = y2, e2[s2] = null;
        break;
      }
  }
  if (u2 == null) {
    if (x2 == null)
      return document.createTextNode(k2);
    u2 = document.createElementNS(o2, x2, k2.is && k2), c2 && (l.__m && l.__m(t2, e2), c2 = false), e2 = null;
  }
  if (x2 == null)
    m2 === k2 || c2 && u2.data == k2 || (u2.data = k2);
  else {
    if (e2 = x2 == "textarea" && k2.defaultValue != null ? null : e2 && n.call(u2.childNodes), !c2 && e2 != null)
      for (m2 = {}, s2 = 0;s2 < u2.attributes.length; s2++)
        m2[(y2 = u2.attributes[s2]).name] = y2.value;
    for (s2 in m2)
      y2 = m2[s2], s2 == "dangerouslySetInnerHTML" ? p2 = y2 : s2 == "children" || (s2 in k2) || s2 == "value" && ("defaultValue" in k2) || s2 == "checked" && ("defaultChecked" in k2) || N(u2, s2, null, y2, o2);
    for (s2 in k2)
      y2 = k2[s2], s2 == "children" ? v2 = y2 : s2 == "dangerouslySetInnerHTML" ? h2 = y2 : s2 == "value" ? w2 = y2 : s2 == "checked" ? _2 = y2 : c2 && typeof y2 != "function" || m2[s2] === y2 || N(u2, s2, y2, m2[s2], o2);
    if (h2)
      c2 || p2 && (h2.__html == p2.__html || h2.__html == u2.innerHTML) || (u2.innerHTML = h2.__html), t2.__k = [];
    else if (p2 && (u2.innerHTML = ""), L(t2.type == "template" ? u2.content : u2, g(v2) ? v2 : [v2], t2, i2, r2, x2 == "foreignObject" ? "http://www.w3.org/1999/xhtml" : o2, e2, f2, e2 ? e2[0] : i2.__k && $(i2, 0), c2, a2), e2 != null)
      for (s2 = e2.length;s2--; )
        b(e2[s2]);
    c2 && x2 != "textarea" || (s2 = "value", x2 == "progress" && w2 == null ? u2.removeAttribute("value") : w2 != null && (w2 !== u2[s2] || x2 == "progress" && !w2 || x2 == "option" && w2 != m2[s2]) && N(u2, s2, w2, m2[s2], o2), s2 = "checked", _2 != null && _2 != u2[s2] && N(u2, s2, _2, m2[s2], o2));
  }
  return u2;
}
function J(n2, u2, t2) {
  try {
    if (typeof n2 == "function") {
      var i2 = typeof n2.__u == "function";
      i2 && n2.__u(), i2 && u2 == null || (n2.__u = n2(u2));
    } else
      n2.current = u2;
  } catch (n3) {
    l.__e(n3, t2);
  }
}
function K(n2, u2, t2) {
  var i2, r2;
  if (l.unmount && l.unmount(n2), (i2 = n2.ref) && (i2.current && i2.current != n2.__e || J(i2, null, u2)), (i2 = n2.__c) != null) {
    if (i2.componentWillUnmount)
      try {
        i2.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u2);
      }
    i2.base = i2.__P = null;
  }
  if (i2 = n2.__k)
    for (r2 = 0;r2 < i2.length; r2++)
      i2[r2] && K(i2[r2], u2, t2 || typeof n2.type != "function");
  t2 || b(n2.__e), n2.__c = n2.__ = n2.__e = undefined;
}
function Q(n2, l2, u2) {
  return this.constructor(n2, u2);
}
function R(u2, t2, i2) {
  var r2, o2, e2, f2;
  t2 == document && (t2 = document.documentElement), l.__ && l.__(u2, t2), o2 = (r2 = typeof i2 == "function") ? null : i2 && i2.__k || t2.__k, e2 = [], f2 = [], q(t2, u2 = (!r2 && i2 || t2).__k = k(S, null, [u2]), o2 || d, d, t2.namespaceURI, !r2 && i2 ? [i2] : o2 ? null : t2.firstChild ? n.call(t2.childNodes) : null, e2, !r2 && i2 ? i2 : o2 ? o2.__e : t2.firstChild, r2, f2), D(e2, u2, f2);
}
var n, l, u, t, i, r, o, e, f, c, a, s, h, p, v, y, d, w, _, g;
var init_preact_module = __esm(() => {
  d = {};
  w = [];
  _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  g = Array.isArray;
  n = w.slice, l = { __e: function(n2, l2, u2, t2) {
    for (var i2, r2, o2;l2 = l2.__; )
      if ((i2 = l2.__c) && !i2.__)
        try {
          if ((r2 = i2.constructor) && r2.getDerivedStateFromError != null && (i2.setState(r2.getDerivedStateFromError(n2)), o2 = i2.__d), i2.componentDidCatch != null && (i2.componentDidCatch(n2, t2 || {}), o2 = i2.__d), o2)
            return i2.__E = i2;
        } catch (l3) {
          n2 = l3;
        }
    throw n2;
  } }, u = 0, t = function(n2) {
    return n2 != null && n2.constructor === undefined;
  }, C.prototype.setState = function(n2, l2) {
    var u2;
    u2 = this.__s != null && this.__s != this.state ? this.__s : this.__s = m({}, this.state), typeof n2 == "function" && (n2 = n2(m({}, u2), this.props)), n2 && m(u2, n2), n2 != null && this.__v && (l2 && this._sb.push(l2), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l2) {
    return n2.__v.__b - l2.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;
});

// node_modules/.pnpm/preact@10.29.2/node_modules/preact/hooks/dist/hooks.module.js
function p2(n2, t3) {
  c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
  var u3 = r2.__H || (r2.__H = { __: [], __h: [] });
  return n2 >= u3.__.length && u3.__.push({}), u3.__[n2];
}
function d2(n2) {
  return o2 = 1, h2(D2, n2);
}
function h2(n2, u3, i3) {
  var o3 = p2(t2++, 2);
  if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u3) : D2(undefined, u3), function(n3) {
    var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
    t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
  }], o3.__c = r2, !r2.__f)) {
    var f3 = function(n3, t3, r3) {
      if (!o3.__c.__H)
        return true;
      var u4 = o3.__c.__H.__.filter(function(n4) {
        return n4.__c;
      });
      if (u4.every(function(n4) {
        return !n4.__N;
      }))
        return !c3 || c3.call(this, n3, t3, r3);
      var i4 = o3.__c.props !== n3;
      return u4.some(function(n4) {
        if (n4.__N) {
          var t4 = n4.__[0];
          n4.__ = n4.__N, n4.__N = undefined, t4 !== n4.__[0] && (i4 = true);
        }
      }), c3 && c3.call(this, n3, t3, r3) || i4;
    };
    r2.__f = true;
    var { shouldComponentUpdate: c3, componentWillUpdate: e3 } = r2;
    r2.componentWillUpdate = function(n3, t3, r3) {
      if (this.__e) {
        var u4 = c3;
        c3 = undefined, f3(n3, t3, r3), c3 = u4;
      }
      e3 && e3.call(this, n3, t3, r3);
    }, r2.shouldComponentUpdate = f3;
  }
  return o3.__N || o3.__;
}
function y2(n2, u3) {
  var i3 = p2(t2++, 3);
  !c2.__s && C2(i3.__H, u3) && (i3.__ = n2, i3.u = u3, r2.__H.__h.push(i3));
}
function A2(n2) {
  return o2 = 5, T2(function() {
    return { current: n2 };
  }, []);
}
function T2(n2, r3) {
  var u3 = p2(t2++, 7);
  return C2(u3.__H, r3) && (u3.__ = n2(), u3.__H = r3, u3.__h = n2), u3.__;
}
function q2(n2, t3) {
  return o2 = 8, T2(function() {
    return n2;
  }, t3);
}
function j2() {
  for (var n2;n2 = f2.shift(); ) {
    var t3 = n2.__H;
    if (n2.__P && t3)
      try {
        t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
      } catch (r3) {
        t3.__h = [], c2.__e(r3, n2.__v);
      }
  }
}
function w2(n2) {
  var t3, r3 = function() {
    clearTimeout(u3), k2 && cancelAnimationFrame(t3), setTimeout(n2);
  }, u3 = setTimeout(r3, 35);
  k2 && (t3 = requestAnimationFrame(r3));
}
function z2(n2) {
  var t3 = r2, u3 = n2.__c;
  typeof u3 == "function" && (n2.__c = undefined, u3()), r2 = t3;
}
function B2(n2) {
  var t3 = r2;
  n2.__c = n2.__(), r2 = t3;
}
function C2(n2, t3) {
  return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
    return t4 !== n2[r3];
  });
}
function D2(n2, t3) {
  return typeof t3 == "function" ? t3(n2) : t3;
}
var t2, r2, u2, i2, o2 = 0, f2, c2, e2, a2, v2, l2, m2, s2, k2;
var init_hooks_module = __esm(() => {
  init_preact_module();
  f2 = [];
  c2 = l;
  e2 = c2.__b;
  a2 = c2.__r;
  v2 = c2.diffed;
  l2 = c2.__c;
  m2 = c2.unmount;
  s2 = c2.__;
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i3 = (r2 = n2.__c).__H;
    i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.some(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = undefined;
    })) : (i3.__h.some(z2), i3.__h.some(B2), i3.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v2 && v2(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (f2.push(t3) !== 1 && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
      n3.u && (n3.__H = n3.u), n3.u = undefined;
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.some(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = undefined, t3 && c2.__e(t3, r3.__v));
  };
  k2 = typeof requestAnimationFrame == "function";
});

// src/tabs/configure-catalog.ts
function humanizeTabId(id) {
  const known = BUILTIN_TAB_TITLES[id];
  if (known)
    return known;
  const words = id.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[-_\s]+/).map((w3) => w3.charAt(0).toUpperCase() + w3.slice(1).toLowerCase());
  return words.join(" ");
}
function getBuiltinCatalog() {
  return BUILTIN_TAB_IDS.map((id) => ({
    id,
    kind: "builtin",
    title: humanizeTabId(id),
    description: BUILTIN_TAB_DESCRIPTIONS[id] || undefined,
    hideLocked: CORE_HIDE_LOCKED.has(id)
  }));
}
function getExtensionCatalog() {
  const tabs = getDrawerTabs();
  if (!tabs || tabs.length === 0)
    return [];
  return tabs.map((t3) => ({
    id: t3.id,
    kind: "extension",
    title: t3.title || humanizeTabId(t3.id),
    description: t3.description || `Open ${t3.title || t3.id} extension tab`,
    hideLocked: false,
    extensionId: t3.extensionId || undefined,
    iconSvg: t3.iconSvg || undefined,
    iconUrl: t3.iconUrl || undefined
  }));
}
function getFullCatalog() {
  return [...getBuiltinCatalog(), ...getExtensionCatalog()];
}
function isHideLocked(tabId) {
  return CORE_HIDE_LOCKED.has(tabId);
}
var BUILTIN_TAB_IDS, CORE_HIDE_LOCKED, BUILTIN_TAB_TITLES, BUILTIN_TAB_DESCRIPTIONS;
var init_configure_catalog = __esm(() => {
  init_store();
  BUILTIN_TAB_IDS = [
    "profile",
    "presets",
    "loom",
    "weaver",
    "connections",
    "browser",
    "characters",
    "personas",
    "multiplayer",
    "lorebook",
    "cortex",
    "databank",
    "create",
    "ooc",
    "prompt",
    "council",
    "summary",
    "feedback",
    "worldinfo",
    "imagegen",
    "wallpaper",
    "regex",
    "branches",
    "theme",
    "spindle"
  ];
  CORE_HIDE_LOCKED = new Set([
    "profile",
    "presets",
    "loom",
    "characters",
    "personas",
    "branches",
    "spindle",
    "theme",
    "lorebook"
  ]);
  BUILTIN_TAB_TITLES = {
    profile: "Profile",
    presets: "Reasoning",
    loom: "Loom",
    weaver: "Weaver",
    connections: "Connections",
    browser: "Pack Browser",
    characters: "Characters",
    personas: "Personas",
    multiplayer: "Multiplayer",
    lorebook: "Lorebook",
    cortex: "Memory Cortex",
    databank: "Databank",
    create: "Creator Workshop",
    ooc: "OOC",
    prompt: "Composition",
    council: "Council",
    summary: "Summary",
    feedback: "Council Feedback",
    worldinfo: "World Info",
    imagegen: "Image Generation",
    wallpaper: "Wallpaper",
    regex: "Regex Scripts",
    branches: "Branch Tree",
    theme: "Theme",
    spindle: "Extensions"
  };
  BUILTIN_TAB_DESCRIPTIONS = {
    profile: "View and edit the active character",
    presets: "Configure reasoning, chain-of-thought, and prompt behavior",
    loom: "Configure narrative structure and story beats",
    weaver: "Craft a character from your idea",
    connections: "Manage API connections and providers",
    browser: "Browse and manage content packs",
    characters: "Browse and manage your character cards",
    personas: "Manage your user personas",
    multiplayer: "Host or join a room and chat with bots alongside friends",
    lorebook: "Edit world book and lorebook entries",
    cortex: "View and manage memory cortex entries",
    databank: "Upload and manage reference documents for AI context",
    create: "Create and edit Lumia items and Loom presets",
    ooc: "Out-of-character comment display settings",
    prompt: "Pick Lumia and Loom content, Sovereign Hand, and context filters",
    council: "Configure the Lumia Council and tool functions",
    summary: "Configure context summarization and truncation",
    feedback: "View the latest council execution results",
    worldinfo: "View currently activated world info entries",
    imagegen: "Configure and control AI scene generation",
    wallpaper: "Set global or per-chat background wallpapers",
    regex: "Create and manage regex find/replace scripts",
    branches: "View and navigate the chat branch history",
    theme: "Customize colors, accent, and visual style",
    spindle: "Manage Spindle extensions"
  };
});

// src/tabs/configure-model.ts
var exports_configure_model = {};
__export(exports_configure_model, {
  swapDrawerSide: () => swapDrawerSide,
  setHidden: () => setHidden,
  reorderWithin: () => reorderWithin,
  partitionDisplayLists: () => partitionDisplayLists,
  moveTab: () => moveTab,
  leftColumnIsSecondary: () => leftColumnIsSecondary,
  isDraftDirty: () => isDraftDirty,
  encodeHostTabOrder: () => encodeHostTabOrder,
  createDraft: () => createDraft
});
function partitionOrderByCatalog(tabOrder, catalog) {
  const builtinOrder = [];
  const extensionOrder = [];
  const seen = new Set;
  for (const id of tabOrder) {
    if (seen.has(id))
      continue;
    seen.add(id);
    if (_builtinIdSet.has(id)) {
      builtinOrder.push(id);
    } else {
      extensionOrder.push(id);
    }
  }
  for (const tab of catalog) {
    if (!seen.has(tab.id)) {
      seen.add(tab.id);
      if (tab.kind === "builtin") {
        builtinOrder.push(tab.id);
      } else {
        extensionOrder.push(tab.id);
      }
    }
  }
  return { builtinOrder, extensionOrder };
}
function resolveSide(tabId, assignments) {
  return assignments.get(tabId) ?? "primary";
}
function syncKindOrders(draft) {
  const builtinOrder = [];
  const extensionOrder = [];
  const seen = new Set;
  const all = [...draft.primaryIds, ...draft.secondaryIds];
  for (const id of all) {
    if (seen.has(id))
      continue;
    seen.add(id);
    if (_builtinIdSet.has(id)) {
      builtinOrder.push(id);
    } else {
      extensionOrder.push(id);
    }
  }
  return { builtinOrder, extensionOrder };
}
function createDraft(input) {
  const { catalog, tabOrder, hiddenTabIds, drawerSide, assignments } = input;
  const { builtinOrder, extensionOrder } = partitionOrderByCatalog(tabOrder, catalog);
  const hiddenSet = new Set(hiddenTabIds);
  const allOrdered = [...builtinOrder, ...extensionOrder];
  const primaryIds = [];
  const secondaryIds = [];
  for (const id of allOrdered) {
    const side = resolveSide(id, assignments);
    if (side === "primary") {
      primaryIds.push(id);
    } else {
      secondaryIds.push(id);
    }
  }
  return {
    drawerSide,
    primaryIds,
    secondaryIds,
    builtinOrder,
    extensionOrder,
    hiddenIds: hiddenSet
  };
}
function encodeHostTabOrder(draft) {
  return [...draft.builtinOrder, ...draft.extensionOrder];
}
function isDraftDirty(draft, base) {
  const order = encodeHostTabOrder(draft);
  if (order.length !== base.tabOrder.length)
    return true;
  for (let i3 = 0;i3 < order.length; i3++) {
    if (order[i3] !== base.tabOrder[i3])
      return true;
  }
  if (draft.hiddenIds.size !== base.hiddenTabIds.length)
    return true;
  for (const id of draft.hiddenIds) {
    if (!base.hiddenTabIds.includes(id))
      return true;
  }
  if (draft.drawerSide !== base.drawerSide)
    return true;
  for (const id of draft.primaryIds) {
    const baseSide = base.assignments.get(id) ?? "primary";
    if (baseSide !== "primary")
      return true;
  }
  for (const id of draft.secondaryIds) {
    const baseSide = base.assignments.get(id) ?? "primary";
    if (baseSide !== "secondary")
      return true;
  }
  return false;
}
function swapDrawerSide(draft) {
  return { ...draft, drawerSide: draft.drawerSide === "left" ? "right" : "left" };
}
function moveTab(draft, tabId, to, index) {
  const fromList = draft.primaryIds.includes(tabId) ? "primaryIds" : "secondaryIds";
  const toList = to === "primary" ? "primaryIds" : "secondaryIds";
  const source = [...draft[fromList]];
  const srcIdx = source.indexOf(tabId);
  if (srcIdx === -1)
    return draft;
  source.splice(srcIdx, 1);
  const target = [...draft[toList]];
  const insertAt = index < 0 ? target.length : Math.min(index, target.length);
  target.splice(insertAt, 0, tabId);
  const next = { ...draft, [fromList]: source, [toList]: target };
  const { builtinOrder, extensionOrder } = syncKindOrders(next);
  return { ...next, builtinOrder, extensionOrder };
}
function reorderWithin(draft, side, fromIndex, toIndex) {
  const isSecondaryList = draft.drawerSide === "right" && side === "left" || draft.drawerSide === "left" && side === "right";
  const listKey = isSecondaryList ? "secondaryIds" : "primaryIds";
  const list = [...draft[listKey]];
  if (fromIndex < 0 || fromIndex >= list.length)
    return draft;
  const [moved] = list.splice(fromIndex, 1);
  const insertAt = toIndex < 0 ? list.length : Math.min(toIndex, list.length);
  list.splice(insertAt, 0, moved);
  const next = { ...draft, [listKey]: list };
  const { builtinOrder, extensionOrder } = syncKindOrders(next);
  return { ...next, builtinOrder, extensionOrder };
}
function setHidden(draft, tabId, hidden) {
  if (isHideLocked(tabId))
    return draft;
  const next = new Set(draft.hiddenIds);
  if (hidden) {
    next.add(tabId);
  } else {
    next.delete(tabId);
  }
  return { ...draft, hiddenIds: next };
}
function partitionDisplayLists(draft, catalog) {
  const catalogById = new Map(catalog.map((t3) => [t3.id, t3]));
  const primary = [];
  const secondary = [];
  for (const id of draft.secondaryIds) {
    const tab = catalogById.get(id);
    if (!tab)
      continue;
    secondary.push(tab);
  }
  for (const id of draft.primaryIds) {
    const tab = catalogById.get(id);
    if (!tab)
      continue;
    primary.push(tab);
  }
  return { primary, secondary };
}
function leftColumnIsSecondary(drawerSide) {
  return drawerSide === "right";
}
var _builtinIdSet;
var init_configure_model = __esm(() => {
  init_configure_catalog();
  _builtinIdSet = new Set(BUILTIN_TAB_IDS);
});

// src/tabs/configure-commit.ts
var exports_configure_commit = {};
__export(exports_configure_commit, {
  isConfigureBatchActive: () => isConfigureBatchActive,
  commitConfigureDraft: () => commitConfigureDraft
});
function computeDeltas(draft) {
  const currentAssignments = getTabAssignments();
  const toSecondary = [];
  const toPrimary = [];
  for (const id of draft.primaryIds) {
    const currentSide = currentAssignments.get(id) ?? "primary";
    if (currentSide === "secondary") {
      toPrimary.push(id);
    }
  }
  for (const id of draft.secondaryIds) {
    const currentSide = currentAssignments.get(id) ?? "primary";
    if (currentSide !== "secondary") {
      toSecondary.push(id);
    }
  }
  return { toSecondary, toPrimary };
}
function isConfigureBatchActive() {
  return _batchActive;
}
async function commitConfigureDraft(draft, _base) {
  if (_batchActive)
    return { ok: false, error: "Commit already in progress" };
  _batchActive = true;
  try {
    const { toSecondary, toPrimary } = computeDeltas(draft);
    setSuppressAutoActivation(true);
    const hostWriteOk = patchHostDrawerSettings({
      tabOrder: encodeHostTabOrder(draft),
      hiddenTabIds: [...draft.hiddenIds],
      side: draft.drawerSide
    });
    if (!hostWriteOk) {
      dwarn("[configure-commit] patchHostDrawerSettings returned false; " + "host order/hide/side may not persist. Continuing with DOM moves.");
    }
    const movePromises = [];
    for (const tabId of toSecondary) {
      movePromises.push(moveTabToSecondaryQuiet(tabId).catch((err) => {
        dwarn(`[configure-commit] moveTabToSecondaryQuiet failed for "${tabId}":`, err);
      }));
    }
    for (const tabId of toPrimary) {
      movePromises.push(moveTabToPrimaryQuiet(tabId).catch((err) => {
        dwarn(`[configure-commit] moveTabToPrimaryQuiet failed for "${tabId}":`, err);
      }));
    }
    await Promise.all(movePromises);
    reorderSecondaryTabButtons(draft.secondaryIds);
    applyHiddenTabIdsToSecondary(draft.hiddenIds);
    applyHiddenTabIdsToMirror(draft.hiddenIds);
    updateDrawerTabVisibility();
    try {
      const mm = await Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer));
      mm.updateMainMirrorDrawerTabVisibility?.();
    } catch (err) {
      dwarn("[configure-commit] updateMainMirrorDrawerTabVisibility failed:", err);
    }
    try {
      const tp = await Promise.resolve().then(() => (init_tab_position(), exports_tab_position));
      tp.reconcileTabListPin();
    } catch (err) {
      dwarn("[configure-commit] reconcileTabListPin failed:", err);
    }
    try {
      const mp = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
      mp.reconcileMainTabListPin();
    } catch (err) {
      dwarn("[configure-commit] reconcileMainTabListPin failed:", err);
    }
    persistLayout();
    findStoreData(true);
    dlog("[configure-commit] commit successful", {
      toSecondary: toSecondary.length,
      toPrimary: toPrimary.length,
      hidden: draft.hiddenIds.size
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dwarn("[configure-commit] commit failed:", msg);
    return { ok: false, error: msg };
  } finally {
    setSuppressAutoActivation(false);
    _batchActive = false;
  }
}
function findDrawerTab(tabId) {
  findStoreData(true);
  const tabs = getDrawerTabs();
  return tabs.find((t3) => t3.id === tabId) || tabs.find((t3) => t3.id.includes(`:tab:${tabId}:`) || t3.id.endsWith(`:${tabId}`)) || tabs.find((t3) => t3.title === tabId);
}
async function moveTabToSecondaryQuiet(tabId) {
  const bridge = getHostBridge();
  const ui = bridge?.ui;
  const isBuiltIn = !!ui?.getBuiltInTabRoot?.(tabId);
  if (isBuiltIn) {
    const { moveBuiltInTabToSecondaryContainer: moveBuiltInTabToSecondaryContainer2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
    const root = await moveBuiltInTabToSecondaryContainer2({ tabId, deferActivation: true });
    setTabAssignment(tabId, "secondary");
    hideMainTabButton(tabId);
    if (root) {
      const storeTab = findDrawerTab(tabId);
      const title = ui?.getBuiltInTabTitle?.(tabId) || storeTab?.title || tabId;
      addSecondaryTabButton({
        id: tabId,
        title,
        root,
        iconSvg: storeTab?.iconSvg,
        iconUrl: storeTab?.iconUrl,
        shortName: ui?.getBuiltInTabTitle?.(tabId) ? undefined : storeTab?.shortName
      });
    } else {
      dwarn(`[configure-commit] built-in "${tabId}" move returned no root; assignment recorded.`);
    }
  } else {
    const storeTab = findDrawerTab(tabId);
    if (!storeTab?.root) {
      dwarn(`[configure-commit] extension "${tabId}" not found in store; skipping move to secondary`);
      return;
    }
    setTabAssignment(tabId, "secondary");
    hideMainTabButton(tabId);
    const secondaryContent = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
    if (secondaryContent && storeTab.root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(storeTab.root);
    }
    storeTab.root.setAttribute("data-canvas-moved", tabId);
    addSecondaryTabButton({
      id: tabId,
      title: storeTab.title,
      root: storeTab.root,
      iconSvg: storeTab.iconSvg,
      iconUrl: storeTab.iconUrl,
      shortName: storeTab.shortName
    });
    updateDrawerTabVisibility();
  }
}
async function moveTabToPrimaryQuiet(tabId) {
  const bridge = getHostBridge();
  const ui = bridge?.ui;
  const isBuiltIn = !!ui?.getBuiltInTabRoot?.(tabId);
  if (isBuiltIn) {
    if (ui?.requestTabLocation) {
      try {
        ui.requestTabLocation(tabId, { kind: "main-drawer" });
      } catch (err) {
        dwarn(`[configure-commit] requestTabLocation(main-drawer) failed for "${tabId}":`, err);
      }
    }
    deleteTabAssignment(tabId);
    showMainTabButton(tabId);
    removeSecondaryTabButton(tabId);
  } else {
    deleteTabAssignment(tabId);
    showMainTabButton(tabId);
    removeSecondaryTabButton(tabId);
    const storeTab = findDrawerTab(tabId);
    if (storeTab?.root) {
      try {
        const { getMainPanelContent: getMainPanelContent2 } = await Promise.resolve().then(() => exports_lumiverse);
        const mainContent = getMainPanelContent2();
        if (mainContent && storeTab.root.parentElement !== mainContent) {
          mainContent.appendChild(storeTab.root);
        }
      } catch (err) {
        dwarn(`[configure-commit] reparent "${tabId}" to main panel failed:`, err);
      }
      storeTab.root.removeAttribute("data-canvas-moved");
      storeTab.root.removeAttribute("data-canvas-active");
    }
  }
  updateDrawerTabVisibility();
}
var _batchActive = false;
var init_configure_commit = __esm(() => {
  init_configure_model();
  init_assignment();
  init_buttons();
  init_host_settings();
  init_secondary_drawer();
  init_persist();
  init_log();
  init_store();
  init_secondary();
});

// node_modules/.pnpm/preact@10.29.2/node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
function u3(e3, t3, n2, o3, i3, u4) {
  t3 || (t3 = {});
  var a3, c3, p3 = t3;
  if ("ref" in p3)
    for (c3 in p3 = {}, t3)
      c3 == "ref" ? a3 = t3[c3] : p3[c3] = t3[c3];
  var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: undefined, __v: --f3, __i: -1, __u: 0, __source: i3, __self: u4 };
  if (typeof e3 == "function" && (a3 = e3.defaultProps))
    for (c3 in a3)
      p3[c3] === undefined && (p3[c3] = a3[c3]);
  return l.vnode && l.vnode(l3), l3;
}
var f3 = 0;
var init_jsxRuntime_module = __esm(() => {
  init_preact_module();
  init_preact_module();
});

// src/layout/dual-session-profile.ts
function captureSessionDualProfileFromLive() {
  const assignments = Array.from(getTabAssignments().entries());
  const secondaryAssignments = assignments.filter(([_2, side]) => side === "secondary");
  const tabs = getDrawerTabs();
  const profile = {
    detachedTabs: secondaryAssignments.map(([tabId]) => {
      const tab = tabs.find((t3) => t3.id === tabId);
      return { tabId, tabTitle: tab?.title || tabId, sidebar: "secondary" };
    }),
    activeTabId: getActiveSecondaryTabId()
  };
  _sessionProfile = profile;
  return profile;
}
function getSessionDualProfile() {
  return _sessionProfile;
}
async function restoreSessionDualProfile(profile) {
  if (!profile || profile.detachedTabs.length === 0)
    return;
  const sd = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
  sd.setSuppressAutoActivation(true);
  try {
    for (const dt of profile.detachedTabs) {
      try {
        await sd.assignToSecondary(dt.tabId);
      } catch (err) {
        dwarn(`restoreSessionDualProfile: assignToSecondary("${dt.tabId}") failed:`, err);
      }
    }
    if (profile.activeTabId) {
      showSecondaryTab(profile.activeTabId);
    }
  } finally {
    sd.setSuppressAutoActivation(false);
  }
}
var _sessionProfile = null;
var init_dual_session_profile = __esm(() => {
  init_assignment();
  init_active_tab();
  init_store();
  init_buttons();
  init_log();
});

// src/layout/vanilla-baseline.ts
function getVanillaBaseline() {
  return _baseline;
}
function clearVanillaBaseline() {
  _baseline = null;
}
function readVanillaHostState() {
  const settings = getHostDrawerSettings() ?? {};
  const host = {
    side: settings.side || getMainDrawerSide(),
    tabOrder: Array.isArray(settings.tabOrder) ? settings.tabOrder.slice() : [],
    hiddenTabIds: Array.isArray(settings.hiddenTabIds) ? settings.hiddenTabIds.slice() : [],
    showTabLabels: typeof settings.showTabLabels === "boolean" ? settings.showTabLabels : undefined
  };
  const mainOpen = isMainDrawerOpen();
  let mainActiveTabId = null;
  if (mainOpen) {
    const active = getActiveTabId();
    if (active.state === "active") {
      mainActiveTabId = active.id;
    } else {
      mainActiveTabId = readHostActiveTabIdFromDom();
    }
  }
  return { host, mainOpen, mainActiveTabId };
}
function captureVanillaBaseline() {
  if (_baseline) {
    return { baseline: _baseline, captured: false };
  }
  const state = readVanillaHostState();
  _baseline = {
    ...state,
    capturedAt: Date.now()
  };
  dlog("[vanilla-baseline] captured:", {
    side: _baseline.host.side,
    tabOrderLen: _baseline.host.tabOrder.length,
    hiddenLen: _baseline.host.hiddenTabIds.length,
    showTabLabels: _baseline.host.showTabLabels,
    mainOpen: _baseline.mainOpen,
    mainActiveTabId: _baseline.mainActiveTabId
  });
  return { baseline: _baseline, captured: true };
}
async function restoreVanillaBaseline(baseline) {
  if (!isHostDrawerSettingsWritable()) {
    dwarn("[vanilla-baseline] restore skipped: host bridge NO-GO");
    return { ok: false, reason: "no-go" };
  }
  const partial = {
    side: baseline.host.side,
    tabOrder: baseline.host.tabOrder.slice(),
    hiddenTabIds: baseline.host.hiddenTabIds.slice()
  };
  if (typeof baseline.host.showTabLabels === "boolean") {
    partial.showTabLabels = baseline.host.showTabLabels;
  }
  const hostOk = patchHostDrawerSettings(partial);
  if (!hostOk) {
    dwarn("[vanilla-baseline] patchHostDrawerSettings returned false");
    return { ok: false, reason: "no-go" };
  }
  const mainRestored = await restoreMainDrawerState(baseline.mainOpen, baseline.mainActiveTabId);
  if (!mainRestored.ok) {
    dwarn("[vanilla-baseline] main drawer restore partial:", mainRestored.reason);
    return { ok: false, reason: "partial", details: mainRestored.reason };
  }
  dlog("[vanilla-baseline] restored host + main drawer state", {
    side: baseline.host.side,
    mainOpen: baseline.mainOpen,
    mainActiveTabId: baseline.mainActiveTabId
  });
  return { ok: true };
}
function readHostActiveTabIdFromDom() {
  if (typeof document === "undefined")
    return null;
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
  if (!sidebar)
    return null;
  const active = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
  if (!active)
    return null;
  return active.getAttribute("data-tab-id") || active.getAttribute("title") || null;
}
async function restoreMainDrawerState(targetOpen, targetActiveTabId) {
  let targetTabId = targetActiveTabId;
  if (targetTabId) {
    const valid = isTabKnownAndVisible(targetTabId);
    if (!valid)
      targetTabId = pickSafeFallbackTabId();
  }
  if (targetOpen && !targetTabId) {
    targetTabId = pickSafeFallbackTabId();
  }
  try {
    const mainPersist = await Promise.resolve().then(() => (init_main_persist(), exports_main_persist));
    mainPersist.restoreMainDrawerFromDom(targetOpen, targetTabId, undefined, { restoreOpen: true, restoreWidth: true });
  } catch (err) {
    return { ok: false, reason: `restoreMainDrawerFromDom threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}
function isTabKnownAndVisible(tabId) {
  const tabs = getDrawerTabs();
  if (!tabs.some((t3) => t3.id === tabId)) {
    const bare = tabId.replace(/:\d+$/, "").split(":").pop() || tabId;
    if (!tabs.some((t3) => t3.id === bare))
      return false;
  }
  const settings = getHostDrawerSettings();
  const hidden = settings?.hiddenTabIds;
  if (Array.isArray(hidden) && hidden.includes(tabId))
    return false;
  if (typeof document !== "undefined") {
    const btn = findHostTabButton(tabId);
    if (btn && btn.style.display === "none")
      return false;
  }
  return true;
}
function pickSafeFallbackTabId() {
  const tabs = getDrawerTabs();
  if (tabs.length > 0) {
    const hidden = getHostDrawerSettings()?.hiddenTabIds;
    const hiddenArr = Array.isArray(hidden) ? hidden : [];
    for (const t3 of tabs) {
      if (!hiddenArr.includes(t3.id))
        return t3.id;
    }
  }
  if (typeof document === "undefined")
    return null;
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
  if (!sidebar)
    return null;
  for (const btn of Array.from(sidebar.querySelectorAll("button[data-tab-id], button[title]"))) {
    const el = btn;
    if (el.style.display === "none")
      continue;
    const id = el.getAttribute("data-tab-id") || el.getAttribute("title");
    if (id)
      return id;
  }
  return null;
}
function findHostTabButton(tabId) {
  if (typeof document === "undefined")
    return null;
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
  if (!sidebar)
    return null;
  const exact = sidebar.querySelector(`button[data-tab-id="${cssEscape(tabId)}"]`);
  if (exact)
    return exact;
  const title = sidebar.querySelector(`button[title="${cssEscape(tabId)}"]`);
  if (title)
    return title;
  if (tabId.includes(":")) {
    const bare = tabId.replace(/:\d+$/, "").split(":").pop();
    if (bare) {
      return sidebar.querySelector(`button[data-tab-id="${cssEscape(bare)}"]`);
    }
  }
  return null;
}
function cssEscape(s3) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s3);
  }
  return s3.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
var _baseline = null;
var init_vanilla_baseline = __esm(() => {
  init_host_settings();
  init_store();
  init_active_tab();
  init_store();
  init_log();
});

// src/settings/second-drawer-mode.ts
var exports_second_drawer_mode = {};
__export(exports_second_drawer_mode, {
  requestSecondDrawerMode: () => requestSecondDrawerMode
});
function injectDialogStyles() {
  injectStyles(STYLE_ID2, `
    #${HOST_ID} {
      position: fixed;
      inset: 0;
      /* Above Configure Tabs overlay (12000) and drag clone (13000). */
      z-index: 14000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvas-mode-switch-fade 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    #${HOST_ID} .canvas-mode-switch-backdrop {
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--lumiverse-fill-heavy, rgba(0,0,0,0.45)) 85%, transparent);
    }
    #${HOST_ID} .canvas-mode-switch-card {
      position: relative;
      z-index: 1;
      width: min(380px, 100%);
      background: var(--lumiverse-bg-elevated, var(--lumiverse-bg-deep, #1a1a1a));
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md, 12px);
      box-shadow: var(--lumiverse-shadow-md, 0 12px 32px rgba(0,0,0,0.5));
      padding: 16px;
      box-sizing: border-box;
      animation: canvas-mode-switch-in 120ms ease-out;
    }
    #${HOST_ID} .canvas-mode-switch-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    #${HOST_ID} .canvas-mode-switch-title {
      margin: 0;
      font-size: calc(15px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-mode-switch-desc {
      margin: 0 0 14px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      line-height: 1.4;
      color: var(--lumiverse-text-muted);
    }
    #${HOST_ID} .canvas-mode-switch-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${HOST_ID} .canvas-mode-switch-option {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050, transparent);
      color: var(--lumiverse-text);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    #${HOST_ID} .canvas-mode-switch-option:hover:not(:disabled) {
      background: var(--lumiverse-primary-020, rgba(66,165,245,0.12));
      border-color: var(--lumiverse-primary, #42a5f5);
    }
    #${HOST_ID} .canvas-mode-switch-option:disabled {
      opacity: 0.55;
      cursor: default;
    }
    #${HOST_ID} .canvas-mode-switch-option-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-mode-switch-option-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    @keyframes canvas-mode-switch-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes canvas-mode-switch-in {
      from { opacity: 0; transform: scale(0.92); }
      to { opacity: 1; transform: scale(1); }
    }
  `);
}
function makeOptionButton(label, hint) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "canvas-mode-switch-option";
  const labelEl = document.createElement("div");
  labelEl.className = "canvas-mode-switch-option-label";
  labelEl.textContent = label;
  const hintEl = document.createElement("div");
  hintEl.className = "canvas-mode-switch-option-hint";
  hintEl.textContent = hint;
  btn.appendChild(labelEl);
  btn.appendChild(hintEl);
  return btn;
}
function cleanupDialogListeners() {
  if (_dialogKeydown) {
    document.removeEventListener("keydown", _dialogKeydown);
    _dialogKeydown = null;
  }
}
function hideModeSwitchDialog() {
  cleanupDialogListeners();
  if (_dialogHost) {
    _dialogHost.remove();
    _dialogHost = null;
  }
}
function showModeSwitchDialog() {
  return new Promise((resolve) => {
    injectDialogStyles();
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    const backdrop = document.createElement("div");
    backdrop.className = "canvas-mode-switch-backdrop";
    backdrop.addEventListener("click", () => {
      resolve("cancel");
      hideModeSwitchDialog();
    });
    const card = document.createElement("div");
    card.className = "canvas-mode-switch-card";
    card.addEventListener("click", (e3) => e3.stopPropagation());
    const header = document.createElement("div");
    header.className = "canvas-mode-switch-header";
    const title = document.createElement("h3");
    title.className = "canvas-mode-switch-title";
    title.textContent = "Unsaved configure changes";
    header.appendChild(title);
    const desc = document.createElement("p");
    desc.className = "canvas-mode-switch-desc";
    desc.textContent = "You have unsaved changes in the Configure Tabs dialog. Choose what to do before disabling the second drawer.";
    const options = document.createElement("div");
    options.className = "canvas-mode-switch-options";
    const applyBtn = makeOptionButton("Apply and switch", "Save current tab arrangement, then disable the second drawer.");
    const discardBtn = makeOptionButton("Discard and switch", "Discard unsaved changes, then disable the second drawer.");
    const cancelBtn = makeOptionButton("Cancel", "Stay in Configure Tabs without disabling the second drawer.");
    const setBusy = (busy) => {
      applyBtn.disabled = busy;
      discardBtn.disabled = busy;
      cancelBtn.disabled = busy;
    };
    applyBtn.addEventListener("click", () => {
      if (applyBtn.disabled)
        return;
      setBusy(true);
      resolve("apply");
      hideModeSwitchDialog();
    });
    discardBtn.addEventListener("click", () => {
      if (discardBtn.disabled)
        return;
      setBusy(true);
      resolve("discard");
      hideModeSwitchDialog();
    });
    cancelBtn.addEventListener("click", () => {
      resolve("cancel");
      hideModeSwitchDialog();
    });
    options.appendChild(applyBtn);
    options.appendChild(discardBtn);
    options.appendChild(cancelBtn);
    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(options);
    host.appendChild(backdrop);
    host.appendChild(card);
    _dialogKeydown = (e3) => {
      if (e3.key !== "Escape")
        return;
      if (applyBtn.disabled)
        return;
      e3.preventDefault();
      e3.stopPropagation();
      resolve("cancel");
      hideModeSwitchDialog();
    };
    document.addEventListener("keydown", _dialogKeydown);
    document.body.appendChild(host);
    _dialogHost = host;
    cancelBtn.focus();
  });
}
async function finishDisable() {
  const profile = captureSessionDualProfileFromLive();
  dlog("[second-drawer-mode] captured session dual profile:", {
    tabs: profile.detachedTabs.length,
    active: profile.activeTabId
  });
  const last = getLastLoadedLayout();
  if (last) {
    const merged = { ...last };
    merged.detachedTabs = profile.detachedTabs;
    if (merged.secondary) {
      merged.secondary = { ...merged.secondary, activeTabId: profile.activeTabId };
    } else {
      merged.secondary = { activeTabId: profile.activeTabId, open: false, width: 420 };
    }
    setLastLoadedLayout(merged);
  } else {
    setLastLoadedLayout({
      detachedTabs: profile.detachedTabs,
      secondary: { activeTabId: profile.activeTabId, open: false, width: 420 },
      primary: { open: false, width: 420, tabId: null }
    });
  }
  flushPendingSaves();
  try {
    syncLastLoadedFromPersistedLayout();
  } catch {}
  setSettings({ secondSidebarEnabled: false });
  const baseline = getVanillaBaseline();
  if (baseline) {
    const result = await restoreVanillaBaseline(baseline);
    if (result.ok) {
      dlog("[second-drawer-mode] vanilla baseline restored; clearing");
      clearVanillaBaseline();
    } else {
      dwarn("[second-drawer-mode] vanilla baseline restore did not complete cleanly; " + "baseline retained for retry. reason=" + result.reason + (result.reason === "partial" ? ` details=${result.details}` : ""));
    }
  }
  try {
    const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
    if (m3.isConfigureTabsModalOpen()) {
      m3.refreshConfigureDraftFromLive();
    }
  } catch {}
}
async function requestSecondDrawerMode(next) {
  if (next) {
    if (getSettings().secondSidebarEnabled)
      return;
    const capture = captureVanillaBaseline();
    dlog("[second-drawer-mode] vanilla baseline capture:", {
      captured: capture.captured,
      side: capture.baseline.host.side,
      mainOpen: capture.baseline.mainOpen
    });
    setSettings({ secondSidebarEnabled: true });
    const profile = getSessionDualProfile();
    cancelSettingsSave();
    cancelLayoutSave();
    const layout = getLastLoadedLayout();
    if (layout && Array.isArray(layout.detachedTabs) && layout.detachedTabs.length > 0) {
      dlog("[second-drawer-mode] applyLayout(lastLoaded) for re-enable:", {
        tabs: layout.detachedTabs.length
      });
      try {
        await applyLayout(layout);
      } catch (err) {
        dwarn("[second-drawer-mode] applyLayout on re-enable failed:", err);
      }
    } else if (profile && profile.detachedTabs.length > 0) {
      dlog("[second-drawer-mode] re-enable falling back to session dual profile:", {
        tabs: profile.detachedTabs.length,
        active: profile.activeTabId
      });
      try {
        await restoreSessionDualProfile(profile);
      } catch (err) {
        dwarn("[second-drawer-mode] restoreSessionDualProfile fallback failed:", err);
      }
    }
    try {
      const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
      if (m3.isConfigureTabsModalOpen()) {
        m3.refreshConfigureDraftFromLive();
      }
    } catch {}
  } else {
    if (!getSettings().secondSidebarEnabled)
      return;
    let userChoice = "clean";
    try {
      const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
      if (m3.isConfigureTabsModalOpen()) {
        const draft = m3.getConfigureDraftRef();
        const base = m3.getConfigureBaseRef();
        if (draft && base) {
          const { isDraftDirty: isDraftDirty2 } = await Promise.resolve().then(() => (init_configure_model(), exports_configure_model));
          if (isDraftDirty2(draft, base)) {
            userChoice = await showModeSwitchDialog();
          }
        }
      }
    } catch (err) {
      dwarn("[second-drawer-mode] error checking modal state:", err);
    }
    if (userChoice === "cancel")
      return;
    if (userChoice === "apply") {
      try {
        const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
        const draft = m3.getConfigureDraftRef();
        const base = m3.getConfigureBaseRef();
        if (draft && base) {
          const { commitConfigureDraft: commitConfigureDraft2 } = await Promise.resolve().then(() => (init_configure_commit(), exports_configure_commit));
          const result = await commitConfigureDraft2(draft, base);
          if (!result.ok) {
            dwarn("[second-drawer-mode] commit failed on mode switch:", result.error);
          }
        }
      } catch (err) {
        dwarn("[second-drawer-mode] error applying draft on mode switch:", err);
      }
    } else if (userChoice === "discard") {}
    await finishDisable();
  }
}
var HOST_ID = "canvas-mode-switch-dialog", STYLE_ID2 = "canvas-mode-switch-dialog-styles", _dialogHost = null, _dialogKeydown = null;
var init_second_drawer_mode = __esm(() => {
  init_state();
  init_persist();
  init_dual_session_profile();
  init_vanilla_baseline();
  init_log();
});

// src/tabs/configure-modal.tsx
var exports_configure_modal = {};
__export(exports_configure_modal, {
  refreshConfigureDraftFromLive: () => refreshConfigureDraftFromLive,
  openConfigureTabsModal: () => openConfigureTabsModal,
  isConfigureTabsModalOpen: () => isConfigureTabsModalOpen,
  getConfigureDraftRef: () => getConfigureDraftRef,
  getConfigureBaseRef: () => getConfigureBaseRef,
  forceUnmountConfigureTabsModal: () => forceUnmountConfigureTabsModal,
  closeConfigureTabsModal: () => closeConfigureTabsModal
});
function injectModalStyles() {
  if (typeof document === "undefined")
    return;
  const existing = document.getElementById(MODAL_STYLE_ID);
  if (existing)
    existing.remove();
  const style = document.createElement("style");
  style.id = MODAL_STYLE_ID;
  style.textContent = `
    /* ── Overlay (host ModalShell backdrop) ── */
    .canvas-configure-tabs-overlay {
      position: fixed;
      inset: 0;
      bottom: calc(0px - var(--ios-viewport-offset, 0px));
      z-index: 12000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      width: var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1)));
      height: var(--app-scaled-viewport-height, calc(100vh / var(--lumiverse-ui-scale, 1)));
      background: var(--lumiverse-modal-backdrop, rgba(0, 0, 0, 0.6));
      animation: canvasConfigureFadeIn 150ms ease-out;
    }
    [data-glass] .canvas-configure-tabs-overlay {
      backdrop-filter: blur(var(--lcs-glass-soft-blur, 6px));
    }
    @keyframes canvasConfigureFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Dialog (host ModalShell.modal) ── */
    .canvas-configure-tabs-dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(720px, calc(100vw - 32px));
      max-height: 85vh;
      background: var(--lumiverse-gradient-modal, var(--lumiverse-bg, #1a1a2e));
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: var(--lumiverse-radius-xl, 16px);
      box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.4)),
        0 0 40px var(--lumiverse-primary-020, rgba(74, 158, 255, 0.12));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvasConfigureDialogEnter 200ms cubic-bezier(0.4, 0, 0.2, 1) both;
      overflow: hidden;
    }
    [data-glass] .canvas-configure-tabs-dialog {
      box-shadow: var(--lumiverse-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.5));
    }
    @keyframes canvasConfigureDialogEnter {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* ── Close X (absolute, host CloseButton style) ── */
    .canvas-configure-tabs-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--lumiverse-text-muted, #888);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .canvas-configure-tabs-close:hover {
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
    }
    .canvas-configure-tabs-close svg {
      width: 16px;
      height: 16px;
    }

    /* ── Header (host .header: column layout) ── */
    .canvas-configure-tabs-header {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
      padding: 16px 20px 12px 20px;
      border-bottom: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .canvas-configure-tabs-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .canvas-configure-tabs-header h2 {
      margin: 0;
      font-size: calc(16px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      color: var(--lumiverse-text, #eee);
      letter-spacing: -0.01em;
    }
    .canvas-configure-tabs-subtitle {
      margin: 4px 0 0;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }
    .canvas-configure-tabs-swap-btn {
      flex-shrink: 0;
      padding: 5px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 6px;
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .canvas-configure-tabs-swap-btn:hover {
      background: var(--lumiverse-fill-strong, rgba(255,255,255,0.12));
    }

    /* ── Second-drawer enable toggle (compact label + switch) ── */
    .canvas-configure-tabs-second-drawer-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .canvas-configure-tabs-second-drawer-toggle-label {
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim, #888);
      white-space: nowrap;
      user-select: none;
      cursor: pointer;
    }
    .canvas-configure-tabs-second-drawer-toggle-label:hover {
      color: var(--lumiverse-text, #eee);
    }

    /* ── Body (host .body: flex column with gap, overflow-y auto) ── */
    .canvas-configure-tabs-body {
      display: flex;
      flex-direction: row;
      gap: 7px;
      flex: 1;
      min-height: 0;
      padding: 12px 20px 20px;
      max-height: min(70vh, 760px);
      overflow-y: auto;
    }

    /* ── Column = one host .section ── */
    .canvas-configure-tabs-column {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      width: 50%;
    }

    /* ── Section header (host .sectionHeader: column gap 4px) ── */
    .canvas-configure-tabs-section-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .canvas-configure-tabs-section-title {
      margin: 0;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--lumiverse-text-secondary, #aaa);
    }
    .canvas-configure-tabs-section-desc {
      margin: 0;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }

    /* ── Tab list (host .list: gap 8px, no extra padding) ── */
    .canvas-configure-tabs-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      /* Keep cards clear of the scrollbar track (not underlay). */
      scrollbar-gutter: stable;
      padding-right: 10px;
    }

    /* ── Drag overlay clone (follows pointer) ── */
    .canvas-configure-tabs-overlay-clone {
      position: fixed;
      z-index: 13000;
      pointer-events: none;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 8%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
      box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.45),
        0 0 0 1px var(--lumiverse-primary-040, var(--lumiverse-primary, #4a9eff));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      opacity: 1;
      will-change: left, top;
      cursor: grabbing;
    }

    /* ── Row card (host .row) ── */
    .canvas-configure-tabs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)) 92%, white 8%);
      touch-action: manipulation;
      user-select: none;
    }
    .canvas-configure-tabs-row.row-locked {
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 6%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
    }
    .canvas-configure-tabs-row.row-hidden {
      opacity: 0.6;
    }
    /* Placeholder left in list while the floating clone follows the pointer */
    .canvas-configure-tabs-row.row-dragging {
      opacity: 0.35;
    }

    /* ── Drag handle (host GripVertical style) ── */
    .canvas-configure-tabs-drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 22px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--lumiverse-text-dim, #888);
      border-radius: 6px;
      cursor: grab;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .canvas-configure-tabs-drag-handle:hover {
      color: var(--lumiverse-text, #eee);
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
    }
    .canvas-configure-tabs-drag-handle:active {
      cursor: grabbing;
    }
    .canvas-configure-tabs-drag-handle svg {
      width: 16px;
      height: 16px;
    }

    /* ── Icon wrap (host .iconWrap) ── */
    .canvas-configure-tabs-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      border-radius: 8px;
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
      color: var(--lumiverse-primary, #4a9eff);
      overflow: hidden;
    }
    .canvas-configure-tabs-icon-wrap svg {
      width: 16px;
      height: 16px;
    }
    .canvas-configure-tabs-icon-wrap img {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }

    /* ── Row info (host .rowInfo: icon + copy) ── */
    .canvas-configure-tabs-row-info {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
      flex: 1 1 auto;
    }

    /* ── Copy block ── */
    .canvas-configure-tabs-copy {
      min-width: 0;
    }
    .canvas-configure-tabs-row-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .canvas-configure-tabs-row-title {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      color: var(--lumiverse-text, #eee);
    }
    .canvas-configure-tabs-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
      color: var(--lumiverse-primary, #4a9eff);
      font-size: calc(10px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .canvas-configure-tabs-badge-muted {
      background: color-mix(in srgb, var(--lumiverse-text-dim, #888) 18%, transparent);
      color: var(--lumiverse-text-secondary, #aaa);
    }
    .canvas-configure-tabs-row-description {
      margin: 2px 0 0;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }

    /* ── Toggle switch ── */
    .canvas-configure-tabs-toggle {
      position: relative;
      flex-shrink: 0;
      width: 36px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 10px;
      background: var(--lumiverse-border, #555);
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast, 120ms ease);
      touch-action: manipulation;
    }
    .canvas-configure-tabs-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--lumiverse-transition-fast, 120ms ease);
    }
    .canvas-configure-tabs-toggle.toggle-on {
      background: var(--lumiverse-primary, #4a9eff);
    }
    .canvas-configure-tabs-toggle.toggle-on::after {
      transform: translateX(16px);
    }
    .canvas-configure-tabs-toggle:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ── Empty column hint ── */
    .canvas-configure-tabs-empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--lumiverse-text-muted, #666);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
    }

    /* ── Footer ── */
    .canvas-configure-tabs-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 20px;
      border-top: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-footer-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .canvas-configure-tabs-footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ── Body — single column (second drawer disabled) ── */
    .canvas-configure-tabs-body--single .canvas-configure-tabs-column {
      width: 100%;
    }
    .canvas-configure-tabs-btn {
      padding: 6px 16px;
      border-radius: 8px;
      border: 1px solid var(--lumiverse-border, #333);
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
    }
    .canvas-configure-tabs-btn:hover {
      background: var(--lumiverse-fill-strong, rgba(255,255,255,0.12));
    }
    .canvas-configure-tabs-btn-primary {
      background: var(--lumiverse-primary, #4a9eff);
      border-color: var(--lumiverse-primary, #4a9eff);
      color: white;
    }
    .canvas-configure-tabs-btn-primary:hover {
      opacity: 0.9;
    }
    .canvas-configure-tabs-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .canvas-configure-tabs-error {
      padding: 6px 20px;
      color: var(--lumiverse-error, #e54545);
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      text-align: right;
    }

    /* ── Responsive: stack columns when narrow ── */
    @media (max-width: 720px) {
      .canvas-configure-tabs-body {
        flex-direction: column;
        max-height: min(90vh, 800px);
      }
      .canvas-configure-tabs-column {
        width: 100%;
      }
    }
    @media (max-width: 640px) {
      .canvas-configure-tabs-dialog {
        width: min(100vw - 16px, 720px);
      }
      .canvas-configure-tabs-header-row {
        flex-wrap: wrap;
      }
      .canvas-configure-tabs-header {
        padding-left: 12px;
        padding-right: 12px;
        padding-top: 14px;
        padding-bottom: 10px;
      }
      .canvas-configure-tabs-body {
        padding-left: 12px;
        padding-right: 12px;
        padding-top: 12px;
        padding-bottom: 14px;
      }
      .canvas-configure-tabs-row {
        align-items: flex-start;
      }
    }
    @media (max-width: 480px) {
      .canvas-configure-tabs-overlay {
        padding: 10px;
      }
    }
  `;
  document.head.appendChild(style);
}
function clearDragState() {
  if (_dragOverlay) {
    _dragOverlay.remove();
    _dragOverlay = null;
  }
  if (_dragTabId) {
    for (const r3 of document.querySelectorAll(".canvas-configure-tabs-row")) {
      if (r3.getAttribute("data-tab-id") === _dragTabId) {
        r3.classList.remove("row-dragging");
        r3.style.transform = "";
        r3.style.transition = "";
      }
    }
  }
  if (_dragMoveHandler) {
    document.removeEventListener("pointermove", _dragMoveHandler);
    _dragMoveHandler = null;
  }
  if (_dragUpHandler) {
    document.removeEventListener("pointerup", _dragUpHandler);
    document.removeEventListener("pointercancel", _dragUpHandler);
    _dragUpHandler = null;
  }
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  _dragActive = false;
  _lastDropTarget = null;
  _flipRects = null;
  _dragTabId = null;
  _dragFromSide = null;
}
function snapshotFLIPRects() {
  const rects = new Map;
  for (const el of document.querySelectorAll(".canvas-configure-tabs-row")) {
    const id = el.getAttribute("data-tab-id");
    if (id)
      rects.set(id, el.getBoundingClientRect());
  }
  return rects;
}
function applyFLIP(prevRects, excludeTabId) {
  const animated = [];
  const rows = document.querySelectorAll(".canvas-configure-tabs-row");
  for (const el of rows) {
    const id = el.getAttribute("data-tab-id");
    if (!id || id === excludeTabId || !prevRects.has(id))
      continue;
    const prev = prevRects.get(id);
    const curr = el.getBoundingClientRect();
    const deltaY = prev.top - curr.top;
    if (Math.abs(deltaY) <= 0.5)
      continue;
    const node = el;
    node.style.transition = "none";
    node.style.transform = `translateY(${deltaY}px)`;
    animated.push(node);
  }
  if (animated.length === 0)
    return;
  document.body.offsetHeight;
  requestAnimationFrame(() => {
    for (const node of animated) {
      node.style.transition = "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)";
      node.style.transform = "";
    }
    setTimeout(() => {
      for (const node of animated) {
        node.style.transition = "";
      }
    }, 220);
  });
}
function createDragOverlay(sourceRow) {
  const overlay = sourceRow.cloneNode(true);
  overlay.className = "canvas-configure-tabs-overlay-clone";
  const rect = sourceRow.getBoundingClientRect();
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.left = rect.left + "px";
  overlay.style.top = rect.top + "px";
  const toggle = overlay.querySelector(".canvas-configure-tabs-toggle");
  if (toggle)
    toggle.style.pointerEvents = "none";
  document.body.appendChild(overlay);
  return overlay;
}
function hitTestDropTarget(x2, y3) {
  const lists = document.querySelectorAll(".canvas-configure-tabs-list");
  for (const list of lists) {
    const listRect = list.getBoundingClientRect();
    if (x2 < listRect.left || x2 > listRect.right)
      continue;
    if (y3 < listRect.top - 8 || y3 > listRect.bottom + 8)
      continue;
    const side = list.getAttribute("data-side");
    if (!side)
      continue;
    const rows = Array.from(list.querySelectorAll(".canvas-configure-tabs-row")).filter((r3) => r3.getAttribute("data-tab-id") !== _dragTabId);
    if (rows.length === 0)
      return { side, index: 0 };
    for (let i3 = 0;i3 < rows.length; i3++) {
      const rowRect = rows[i3].getBoundingClientRect();
      const mid = rowRect.top + rowRect.height / 2;
      if (y3 < mid)
        return { side, index: i3 };
    }
    return { side, index: rows.length };
  }
  return null;
}
function performDragMove(tabId, toSide, toIndex) {
  if (!_draftRef)
    return;
  const fromSide = _draftRef.primaryIds.includes(tabId) ? "primary" : "secondary";
  const fromIds = fromSide === "primary" ? _draftRef.primaryIds : _draftRef.secondaryIds;
  const fromIdx = fromIds.indexOf(tabId);
  if (fromIdx === -1)
    return;
  if (fromSide === toSide && toIndex === fromIdx)
    return;
  const prevRects = snapshotFLIPRects();
  if (fromSide === toSide) {
    const spatialSide = leftColumnIsSecondary(_draftRef.drawerSide) ? fromSide === "primary" ? "right" : "left" : fromSide === "primary" ? "left" : "right";
    _draftRef = reorderWithin(_draftRef, spatialSide, fromIdx, toIndex);
  } else {
    _draftRef = moveTab(_draftRef, tabId, toSide, toIndex);
  }
  _dragFromSide = toSide;
  renderModal(_draftRef, _catalogRef, null, false);
  applyFLIP(prevRects, tabId);
  for (const r3 of document.querySelectorAll(".canvas-configure-tabs-row")) {
    if (r3.getAttribute("data-tab-id") === tabId) {
      r3.classList.add("row-dragging");
      break;
    }
  }
}
function cancelDrag() {
  clearDragState();
}
async function autoCommit() {
  const prev = _commitPromise;
  const myWork = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {}
    }
    if (!_draftRef || !_baseSnapshotRef)
      return { ok: true };
    if (!isDraftDirty(_draftRef, _baseSnapshotRef))
      return { ok: true };
    const result = await commitConfigureDraft(_draftRef, _baseSnapshotRef);
    if (result.ok) {
      try {
        const fresh = buildLiveDraftAndBase();
        _draftRef = fresh.draft;
        _baseSnapshotRef = fresh.base;
      } catch {}
      if (_draftRef) {
        renderModal(_draftRef, _catalogRef, null, false);
      }
    } else {
      if (_draftRef) {
        renderModal(_draftRef, _catalogRef, result.error, false);
      }
    }
    return result;
  })();
  _commitPromise = myWork.then((r3) => r3).catch(() => ({ ok: false, error: "auto-commit failed" }));
  await myWork;
}
function ConfigureTabsModalInner(props) {
  const {
    draft,
    catalog,
    primaryTabs,
    secondaryTabs,
    commitError,
    committing,
    secondDrawerEnabled,
    onSwapSide,
    onToggleHide,
    onToggleSecondDrawer,
    onCancel,
    onDone
  } = props;
  const leftIsSecondaryVal = leftColumnIsSecondary(draft.drawerSide);
  const committingRef = A2(committing);
  committingRef.current = committing;
  const cancelRef = A2(onCancel);
  cancelRef.current = onCancel;
  y2(() => {
    const handler = (e3) => {
      if (e3.key === "Escape") {
        if (_dragActive || _dragTabId) {
          cancelDrag();
          return;
        }
        if (!committingRef.current)
          cancelRef.current();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const handlePointerDown = q2((e3, tabId, side) => {
    const target = e3.currentTarget;
    if (!target.classList.contains("canvas-configure-tabs-drag-handle"))
      return;
    e3.preventDefault();
    _dragTabId = tabId;
    _dragFromSide = side;
    _dragActive = false;
    _dragStartX = e3.clientX;
    _dragStartY = e3.clientY;
    _lastDropTarget = null;
    const onMove = (ev) => {
      const dx = ev.clientX - _dragStartX;
      const dy = ev.clientY - _dragStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!_dragActive) {
        if (dist < 4)
          return;
        _dragActive = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        const sourceRow = target.closest(".canvas-configure-tabs-row");
        if (sourceRow) {
          const rowRect = sourceRow.getBoundingClientRect();
          _dragOffsetX = ev.clientX - rowRect.left;
          _dragOffsetY = ev.clientY - rowRect.top;
          sourceRow.classList.add("row-dragging");
          _dragOverlay = createDragOverlay(sourceRow);
        }
      }
      if (_dragOverlay) {
        _dragOverlay.style.left = `${ev.clientX - _dragOffsetX}px`;
        _dragOverlay.style.top = `${ev.clientY - _dragOffsetY}px`;
      }
      const target_ = hitTestDropTarget(ev.clientX, ev.clientY);
      if (!target_)
        return;
      const prev = _lastDropTarget;
      if (prev && prev.side === target_.side && prev.index === target_.index)
        return;
      _lastDropTarget = target_;
      performDragMove(tabId, target_.side, target_.index);
    };
    const onUp = (_ev) => {
      clearDragState();
      autoCommit();
    };
    _dragMoveHandler = onMove;
    _dragUpHandler = onUp;
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, []);
  const renderIcon = (tab) => {
    if (tab.kind === "builtin") {
      const svg = BUILTIN_ICON_SVGS[tab.id];
      if (svg) {
        return /* @__PURE__ */ u3("span", {
          class: "canvas-configure-tabs-icon-wrap",
          dangerouslySetInnerHTML: { __html: svg }
        }, undefined, false, undefined, this);
      }
    }
    if (tab.kind === "extension" && tab.iconSvg) {
      return /* @__PURE__ */ u3("span", {
        class: "canvas-configure-tabs-icon-wrap",
        dangerouslySetInnerHTML: { __html: tab.iconSvg }
      }, undefined, false, undefined, this);
    }
    if (tab.kind === "extension" && tab.iconUrl) {
      return /* @__PURE__ */ u3("span", {
        class: "canvas-configure-tabs-icon-wrap",
        children: /* @__PURE__ */ u3("img", {
          src: tab.iconUrl,
          alt: ""
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    }
    return /* @__PURE__ */ u3("span", {
      class: "canvas-configure-tabs-icon-wrap",
      style: "font-size:15px;font-weight:600;",
      children: tab.title.charAt(0)
    }, undefined, false, undefined, this);
  };
  const renderTabRow = (tab, index, side) => {
    const isHidden = draft.hiddenIds.has(tab.id);
    const isLocked = tab.hideLocked;
    const isCore = tab.kind === "builtin" && tab.hideLocked;
    const description = isLocked ? "Always visible so you can still reach core app sections." : tab.description || "";
    return /* @__PURE__ */ u3("div", {
      class: `canvas-configure-tabs-row${isHidden ? " row-hidden" : ""}${isLocked ? " row-locked" : ""}`,
      "data-tab-id": tab.id,
      "data-row-index": index,
      children: [
        /* @__PURE__ */ u3("span", {
          class: "canvas-configure-tabs-drag-handle",
          title: "Drag to reorder",
          onPointerDown: (e3) => handlePointerDown(e3, tab.id, side),
          children: /* @__PURE__ */ u3("svg", {
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1.5",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            children: [
              /* @__PURE__ */ u3("circle", {
                cx: "9",
                cy: "5",
                r: "1.5"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("circle", {
                cx: "9",
                cy: "12",
                r: "1.5"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("circle", {
                cx: "9",
                cy: "19",
                r: "1.5"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("circle", {
                cx: "15",
                cy: "5",
                r: "1.5"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("circle", {
                cx: "15",
                cy: "12",
                r: "1.5"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ u3("circle", {
                cx: "15",
                cy: "19",
                r: "1.5"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-row-info",
          children: [
            renderIcon(tab),
            /* @__PURE__ */ u3("div", {
              class: "canvas-configure-tabs-copy",
              children: [
                /* @__PURE__ */ u3("div", {
                  class: "canvas-configure-tabs-row-title-wrap",
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "canvas-configure-tabs-row-title",
                      children: tab.title
                    }, undefined, false, undefined, this),
                    isCore && /* @__PURE__ */ u3("span", {
                      class: "canvas-configure-tabs-badge",
                      children: "Core"
                    }, undefined, false, undefined, this),
                    tab.kind === "extension" && /* @__PURE__ */ u3("span", {
                      class: "canvas-configure-tabs-badge canvas-configure-tabs-badge-muted",
                      children: "Extension"
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                description && /* @__PURE__ */ u3("p", {
                  class: "canvas-configure-tabs-row-description",
                  children: description
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ u3("button", {
          class: `canvas-configure-tabs-toggle${!isHidden ? " toggle-on" : ""}`,
          disabled: isLocked,
          title: isLocked ? "Cannot hide this tab" : isHidden ? "Show tab" : "Hide tab",
          onClick: (e3) => {
            e3.stopPropagation();
            onToggleHide(tab.id, !isHidden);
          },
          onPointerDown: (e3) => e3.stopPropagation(),
          onMouseDown: (e3) => e3.stopPropagation()
        }, undefined, false, undefined, this)
      ]
    }, tab.id, true, undefined, this);
  };
  const primaryDesc = leftIsSecondaryVal ? "Tabs shown in the right sidebar drawer." : "Tabs shown in the left sidebar drawer.";
  const secondaryDesc = leftIsSecondaryVal ? "Tabs shown in the left sidebar drawer." : "Tabs shown in the right sidebar drawer.";
  const renderColumnHeader = (title, desc) => /* @__PURE__ */ u3("div", {
    class: "canvas-configure-tabs-section-header",
    children: [
      /* @__PURE__ */ u3("h3", {
        class: "canvas-configure-tabs-section-title",
        children: title
      }, undefined, false, undefined, this),
      /* @__PURE__ */ u3("p", {
        class: "canvas-configure-tabs-section-desc",
        children: desc
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
  const renderColumn = (tabs, side, sectionHeader) => /* @__PURE__ */ u3("div", {
    class: "canvas-configure-tabs-column",
    children: [
      sectionHeader,
      /* @__PURE__ */ u3("div", {
        class: "canvas-configure-tabs-list",
        "data-side": side,
        children: tabs.length === 0 ? /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-empty",
          children: "No tabs assigned"
        }, undefined, false, undefined, this) : tabs.map((tab, i3) => renderTabRow(tab, i3, side))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
  const leftColumn = renderColumn(leftIsSecondaryVal ? secondaryTabs : primaryTabs, leftIsSecondaryVal ? "secondary" : "primary", renderColumnHeader(leftIsSecondaryVal ? "Second Drawer Tabs" : "Main Drawer Tabs", leftIsSecondaryVal ? secondaryDesc : primaryDesc));
  const rightColumn = renderColumn(leftIsSecondaryVal ? primaryTabs : secondaryTabs, leftIsSecondaryVal ? "primary" : "secondary", renderColumnHeader(leftIsSecondaryVal ? "Main Drawer Tabs" : "Second Drawer Tabs", leftIsSecondaryVal ? primaryDesc : secondaryDesc));
  return /* @__PURE__ */ u3("div", {
    class: "canvas-configure-tabs-overlay",
    onClick: (e3) => {
      if (e3.target === e3.currentTarget)
        onCancel();
    },
    children: /* @__PURE__ */ u3("div", {
      class: "canvas-configure-tabs-dialog",
      onClick: (e3) => e3.stopPropagation(),
      children: [
        /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-header",
          children: [
            /* @__PURE__ */ u3("div", {
              class: "canvas-configure-tabs-header-row",
              children: [
                /* @__PURE__ */ u3("h2", {
                  children: "Configure Tabs"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3("div", {
                  class: "canvas-configure-tabs-header-actions",
                  children: /* @__PURE__ */ u3("button", {
                    class: "canvas-configure-tabs-close",
                    type: "button",
                    title: "Close",
                    onClick: () => onCancel(),
                    onPointerDown: (e3) => e3.stopPropagation(),
                    children: /* @__PURE__ */ u3("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      stroke: "currentColor",
                      "stroke-width": "2",
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                      children: [
                        /* @__PURE__ */ u3("line", {
                          x1: "18",
                          y1: "6",
                          x2: "6",
                          y2: "18"
                        }, undefined, false, undefined, this),
                        /* @__PURE__ */ u3("line", {
                          x1: "6",
                          y1: "6",
                          x2: "18",
                          y2: "18"
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ u3("p", {
              class: "canvas-configure-tabs-subtitle",
              children: "Drag to reorder sidebar tabs. Toggle to hide optional tabs; core tabs always remain visible."
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        secondDrawerEnabled ? /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-body",
          children: [
            leftColumn,
            rightColumn
          ]
        }, undefined, true, undefined, this) : /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-body canvas-configure-tabs-body--single",
          children: renderColumn(primaryTabs, "primary", renderColumnHeader("Drawer Tabs", "Tabs in the sidebar drawer."))
        }, undefined, false, undefined, this),
        commitError && /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-error",
          children: commitError
        }, undefined, false, undefined, this),
        /* @__PURE__ */ u3("div", {
          class: "canvas-configure-tabs-footer",
          children: [
            /* @__PURE__ */ u3("div", {
              class: "canvas-configure-tabs-footer-left",
              children: [
                /* @__PURE__ */ u3("div", {
                  class: "canvas-configure-tabs-second-drawer-toggle",
                  children: [
                    /* @__PURE__ */ u3("span", {
                      class: "canvas-configure-tabs-second-drawer-toggle-label",
                      onClick: () => onToggleSecondDrawer(),
                      children: "Enable second drawer"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ u3("button", {
                      class: `canvas-configure-tabs-toggle${secondDrawerEnabled ? " toggle-on" : ""}`,
                      onClick: (e3) => {
                        e3.stopPropagation();
                        onToggleSecondDrawer();
                      }
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                secondDrawerEnabled && /* @__PURE__ */ u3("button", {
                  class: "canvas-configure-tabs-swap-btn",
                  onClick: onSwapSide,
                  children: "Swap drawer locations"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ u3("div", {
              class: "canvas-configure-tabs-footer-right",
              children: [
                /* @__PURE__ */ u3("button", {
                  class: "canvas-configure-tabs-btn",
                  onClick: onCancel,
                  disabled: committing,
                  children: "Cancel"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ u3("button", {
                  class: "canvas-configure-tabs-btn canvas-configure-tabs-btn-primary",
                  onClick: onDone,
                  disabled: committing,
                  children: committing ? "Applying…" : "Done"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function buildLiveDraftAndBase() {
  const catalog = getFullCatalog();
  const hostSettings = getHostDrawerSettings();
  const currentAssignments = new Map(getTabAssignments());
  const drawerSide = hostSettings?.side || getMainDrawerSide();
  const draft = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: currentAssignments
  });
  const base = {
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: new Map(currentAssignments)
  };
  return { draft, base, catalog };
}
function openConfigureTabsModal() {
  if (typeof document === "undefined")
    return;
  if (_modalContainer) {
    _modalContainer.style.display = "flex";
    return;
  }
  injectModalStyles();
  document.body.style.overflow = "hidden";
  const { draft, base, catalog } = buildLiveDraftAndBase();
  _draftRef = draft;
  _baseSnapshotRef = base;
  _modalContainer = document.createElement("div");
  _modalContainer.id = "canvas-configure-tabs-modal";
  document.body.appendChild(_modalContainer);
  renderModal(draft, catalog, null, false);
}
function refreshConfigureDraftFromLive() {
  if (!_modalContainer)
    return;
  const { draft, base, catalog } = buildLiveDraftAndBase();
  _draftRef = draft;
  _baseSnapshotRef = base;
  renderModal(draft, catalog, null, false);
}
function closeConfigureTabsModal(_opts) {
  if (!_modalContainer)
    return true;
  unmountModal();
  return true;
}
function getConfigureDraftRef() {
  return _draftRef;
}
function getConfigureBaseRef() {
  return _baseSnapshotRef;
}
function forceUnmountConfigureTabsModal() {
  unmountModal();
}
function isConfigureTabsModalOpen() {
  return _modalContainer !== null && _modalContainer.isConnected;
}
function renderModal(draft, catalog, commitError, committing) {
  _catalogRef = catalog;
  if (!_modalContainer)
    return;
  const { primary, secondary } = partitionDisplayLists(draft, catalog);
  R(/* @__PURE__ */ u3(ConfigureTabsModalInner, {
    draft,
    catalog,
    primaryTabs: primary,
    secondaryTabs: secondary,
    commitError,
    committing,
    secondDrawerEnabled: getSettings().secondSidebarEnabled,
    onSwapSide: () => {
      if (!_draftRef)
        return;
      const next = swapDrawerSide(_draftRef);
      _draftRef = next;
      renderModal(next, catalog, null, false);
      autoCommit();
    },
    onToggleHide: (tabId, hidden) => {
      if (!_draftRef)
        return;
      const next = setHidden(_draftRef, tabId, hidden);
      _draftRef = next;
      renderModal(next, catalog, null, false);
      autoCommit();
    },
    onToggleSecondDrawer: () => {
      Promise.resolve().then(() => (init_second_drawer_mode(), exports_second_drawer_mode)).then((m3) => {
        m3.requestSecondDrawerMode(!getSettings().secondSidebarEnabled);
      }).catch((err) => {
        dwarn("[configure-modal] second-drawer-mode import failed:", err);
      });
    },
    onCancel: () => {
      closeConfigureTabsModal();
    },
    onDone: async () => {
      if (!_draftRef || !_baseSnapshotRef)
        return;
      if (isDraftDirty(_draftRef, _baseSnapshotRef)) {
        renderModal(_draftRef, catalog, null, true);
        const result = await commitConfigureDraft(_draftRef, _baseSnapshotRef);
        if (!result.ok) {
          renderModal(_draftRef, catalog, result.error, false);
          return;
        }
      }
      unmountModal();
    }
  }, undefined, false, undefined, this), _modalContainer);
}
function unmountModal() {
  if (!_modalContainer)
    return;
  R(null, _modalContainer);
  _modalContainer.remove();
  _modalContainer = null;
  _draftRef = null;
  _baseSnapshotRef = null;
  clearDragState();
  document.body.style.overflow = "";
}
var _modalContainer = null, _draftRef = null, _baseSnapshotRef = null, _dragTabId = null, _dragFromSide = null, _dragActive = false, _dragOverlay = null, _dragOffsetX = 0, _dragOffsetY = 0, _dragStartX = 0, _dragStartY = 0, _lastDropTarget = null, _flipRects = null, _dragMoveHandler = null, _dragUpHandler = null, _commitPromise = null, BUILTIN_ICON_SVGS, MODAL_STYLE_ID = "canvas-configure-tabs-styles", _catalogRef;
var init_configure_modal = __esm(() => {
  init_preact_module();
  init_hooks_module();
  init_configure_model();
  init_configure_catalog();
  init_host_settings();
  init_store();
  init_assignment();
  init_configure_commit();
  init_state();
  init_log();
  init_jsxRuntime_module();
  BUILTIN_ICON_SVGS = {
    profile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    presets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2.5a.5.5 0 0 0-.8-.4L15 7l2 2 4.9-5.7a.5.5 0 0 0 .1-.5Z"/><path d="m3 15 3 3"/><path d="M6 12v3h3"/><path d="m15 6-3-3"/><path d="m12 3 3 3-4 4"/><path d="M5 18l-2 2"/></svg>`,
    loom: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="4"/><circle cx="12" cy="6" r="4"/><path d="M12 2v4"/><path d="m15 9 3-3"/><path d="m9 9-3-3"/><path d="M12 14v4"/><path d="m15 15 3 3"/><path d="m9 15-3 3"/></svg>`,
    weaver: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg>`,
    connections: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`,
    browser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5.08 8.7-5"/><path d="M12 22V12"/></svg>`,
    characters: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    personas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h.01M12 12h.01M18 12h.01"/><path d="M20 6H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6l2 4 2-4h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"/></svg>`,
    multiplayer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>`,
    lorebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2"/><path d="M9 9h6M9 13h6"/></svg>`,
    cortex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M11.5 10.5h1"/></svg>`,
    databank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`,
    create: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 2H12l-2.5 5.5L7 11h5l-3 11 7-9h-4l3.5-5.5z"/></svg>`,
    ooc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
    prompt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    council: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    summary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h-5l-5 5v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M9 2v4h6"/><line x1="9" x2="15" y1="11" y2="11"/><line x1="9" x2="15" y1="15" y2="15"/><line x1="9" x2="11" y1="19" y2="19"/></svg>`,
    feedback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/><path d="M10.5 13.5a3.5 3.5 0 0 0 3 0"/></svg>`,
    worldinfo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    imagegen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    wallpaper: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/></svg>`,
    regex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2z"/><path d="M16 10V6"/><path d="M18 12c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/><path d="M10 12H6"/><path d="M12 14l-2 3"/><path d="M12 10l-2-3"/><path d="M4 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
    branches: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    theme: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.6 1.5-1.5 0-.4-.15-.7-.4-1-.25-.3-.6-.5-1-.5-1.2 0-2.1-.9-2.1-2s.9-2 2-2h1.5c1.9 0 3.5-1.6 3.5-3.5 0-1.2-.6-2.3-1.5-3 .4-.3.7-.7.9-1.1.4-.8 1-1.4 1.9-1.4z"/></svg>`,
    spindle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.98.98 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.706 2.404 2.404 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.404 2.404 0 0 1 1.998 12c0-.617.236-1.233.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.98.98 0 0 1 .276-.837l1.61-1.611a2.404 2.404 0 0 1 1.705-.706 2.404 2.404 0 0 1 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02Z"/></svg>`
  };
  _catalogRef = [];
});

// src/tabs/tab-context-menu.ts
function hideAssignmentMenu() {
  if (_contextMenu) {
    _contextMenu.remove();
    _contextMenu = null;
  }
  _lastContextMenuTarget = null;
}
function showAssignmentMenu(x2, y3, tabId, tabTitle, originatingTarget) {
  if (_showAssignmentMenuOverride) {
    _showAssignmentMenuOverride(x2, y3, tabId, tabTitle, originatingTarget);
    return;
  }
  const secondEnabled = getSettings().secondSidebarEnabled;
  const currentSidebar = getTabSidebar(tabId);
  const onSecondary = currentSidebar === "secondary";
  const moveLabel = onSecondary ? "Move to main drawer" : "Move to second drawer";
  const moveSidebar = onSecondary ? "primary" : "secondary";
  const canShowMove = moveSidebar === "primary" || secondEnabled;
  if (!_contextMenu) {
    _contextMenu = createAssignmentContextMenu();
    document.body.appendChild(_contextMenu);
  }
  _contextMenu.innerHTML = "";
  const showLabels = isShowTabLabels();
  const toggleLabel = showLabels ? "Hide labels" : "Show labels";
  const toggleItem = createAssignmentContextMenuItem(toggleLabel, () => {
    const next = !showLabels;
    const ok = patchHostDrawerSettings({ showTabLabels: next });
    if (ok && next) {
      syncSecondaryTabLabels();
    }
  });
  _contextMenu.appendChild(toggleItem);
  const configureItem = createAssignmentContextMenuItem("Configure tabs", () => {
    openConfigureTabsModal();
  });
  _contextMenu.appendChild(configureItem);
  if (canShowMove) {
    const divider = createDivider();
    _contextMenu.appendChild(divider);
    const moveItem = createAssignmentContextMenuItem(moveLabel, () => {
      Promise.resolve().then(() => (init_assignment(), exports_assignment)).then((m3) => m3.assignTab(tabId, moveSidebar));
    });
    _contextMenu.appendChild(moveItem);
  }
  _contextMenu.style.left = `${x2}px`;
  _contextMenu.style.top = `${y3}px`;
  _contextMenu.style.display = "block";
  _lastContextMenuTarget = originatingTarget ?? null;
  requestAnimationFrame(() => {
    const rect = _contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      _contextMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      _contextMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}
function createAssignmentContextMenu() {
  injectAssignmentContextMenuStyles();
  const menu = document.createElement("div");
  menu.className = "canvas-tab-context-menu";
  menu.style.cssText = `
    position: fixed;
    z-index: 11000;
    min-width: 180px;
    padding: 4px;
    background: var(--lumiverse-bg-deep);
    border: 1px solid var(--lumiverse-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
    animation: contextMenuIn 120ms ease-out forwards;
    transform-origin: top left;
    display: none;
  `;
  return menu;
}
function createDivider() {
  const div = document.createElement("div");
  div.setAttribute("role", "separator");
  div.style.cssText = `
    height: 1px;
    margin: 4px 8px;
    background: var(--lumiverse-border);
    flex-shrink: 0;
  `;
  return div;
}
function injectAssignmentContextMenuStyles() {
  injectStyles("canvas-ux-context-menu-styles", `
    @keyframes contextMenuIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @media not (pointer: coarse) {
      body[data-glass] .canvas-tab-context-menu {
        background: color-mix(in srgb, var(--lumiverse-bg-deep) 80%, transparent) !important;
        backdrop-filter: blur(var(--lcs-glass-blur, 8px));
      }
    }
  `);
}
function createAssignmentContextMenuItem(label, onClick, opts) {
  const item = document.createElement("button");
  item.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: ${opts?.danger ? "var(--lumiverse-error, #e54545)" : "var(--lumiverse-text)"};
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    font-family: inherit;
    cursor: pointer;
    transition: background 120ms ease;
    text-align: left;
  `;
  item.textContent = label;
  item.addEventListener("mouseenter", () => {
    item.style.background = opts?.danger ? "var(--lumiverse-danger-015)" : "var(--lumiverse-fill, rgba(255, 255, 255, 0.06))";
  });
  item.addEventListener("mouseleave", () => {
    item.style.background = "none";
  });
  item.addEventListener("click", (e3) => {
    e3.stopPropagation();
    onClick();
    hideAssignmentMenu();
  });
  return item;
}
var _showAssignmentMenuOverride = null, _contextMenu = null, _lastContextMenuTarget = null;
var init_tab_context_menu = __esm(() => {
  init_assignment();
  init_state();
  init_drawer_sync();
  init_host_settings();
  init_configure_modal();
});

// src/tabs/buttons.ts
var exports_buttons = {};
__export(exports_buttons, {
  updateDrawerTabVisibility: () => updateDrawerTabVisibility,
  showSecondaryTab: () => showSecondaryTab,
  showMainTabButton: () => showMainTabButton,
  reorderSecondaryTabButtons: () => reorderSecondaryTabButtons,
  removeSecondaryTabButton: () => removeSecondaryTabButton,
  readMainButtonShortName: () => readMainButtonShortName,
  isSettingsButton: () => isSettingsButton,
  hideMainTabButton: () => hideMainTabButton,
  findSafeFallbackButton: () => findSafeFallbackButton,
  findMainTabButton: () => findMainTabButton,
  deriveShortName: () => deriveShortName,
  cssEscape: () => cssEscape2,
  clearSecondaryTabButtonActive: () => clearSecondaryTabButtonActive,
  applyHiddenTabIdsToSecondary: () => applyHiddenTabIdsToSecondary,
  applyHiddenTabIdsToMirror: () => applyHiddenTabIdsToMirror,
  addSecondaryTabButton: () => addSecondaryTabButton,
  __setShowMainTabButtonForTest: () => __setShowMainTabButtonForTest,
  __setHideMainTabButtonForTest: () => __setHideMainTabButtonForTest
});
function __setHideMainTabButtonForTest(fn) {
  _hideMainTabButtonOverride = fn;
}
function __setShowMainTabButtonForTest(fn) {
  _showMainTabButtonOverride = fn;
}
function hideMainTabButton(tabId) {
  if (_hideMainTabButtonOverride) {
    _hideMainTabButtonOverride(tabId);
    return;
  }
  const btn = findMainTabButton(tabId);
  if (btn)
    btn.style.display = "none";
}
function showMainTabButton(tabId) {
  if (_showMainTabButtonOverride) {
    _showMainTabButtonOverride(tabId);
    return;
  }
  const btn = findMainTabButton(tabId);
  if (btn)
    btn.style.display = "";
}
function findMainTabButton(tabId) {
  const sidebar = getMainSidebar();
  if (!sidebar) {
    dwarn("findMainTabButton: no sidebar found");
    return null;
  }
  const byId = sidebar.querySelector(`button[data-tab-id="${cssEscape2(tabId)}"]`);
  if (byId)
    return byId;
  const byTitle = sidebar.querySelector(`button[title="${cssEscape2(tabId)}"]`);
  if (byTitle) {
    byTitle.setAttribute("data-tab-id", tabId);
    return byTitle;
  }
  const tabs = getDrawerTabs();
  const tab = tabs.find((t3) => t3.id === tabId);
  if (!tab) {
    dwarn(`findMainTabButton: no tab in store for id="${tabId}", known tabs=`, tabs.map((t3) => ({ id: t3.id, title: t3.title })));
    return null;
  }
  const buttons = sidebar.querySelectorAll("button[title]");
  for (const btn of buttons) {
    if (btn.getAttribute("title") === tab.title) {
      btn.setAttribute("data-tab-id", tab.id);
      return btn;
    }
  }
  dwarn(`findMainTabButton: no button for id="${tabId}" (title="${tab.title}") found among ${buttons.length} buttons`);
  return null;
}
function cssEscape2(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}
function isSettingsButton(btn) {
  const cls = (btn.className || "").toString();
  if (cls.includes("tabBtnSettings"))
    return true;
  const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
  const title = (btn.getAttribute("title") || "").toLowerCase();
  if (aria.includes("settings") || aria.includes("preferences"))
    return true;
  if (title.includes("settings") || title.includes("preferences"))
    return true;
  return false;
}
function findSafeFallbackButton(sidebar) {
  const allButtons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]'));
  return allButtons.find((b2) => b2.style.display !== "none" && b2.className.includes("tabBtn") && !b2.className.includes("tabBtnExtension") && !isSettingsButton(b2)) ?? null;
}
function deriveShortName(title, shortName) {
  if (shortName)
    return shortName;
  return title.length > 8 ? title.slice(0, 7) + "…" : title;
}
function readMainButtonShortName(mainBtn) {
  if (!mainBtn)
    return;
  const label = mainBtn.querySelector('span[class*="tabLabel"]');
  if (label && label.textContent)
    return label.textContent.trim();
  return;
}
function addSecondaryTabButton(tab) {
  const tabList = getSecondaryTabList();
  const _bareId = tab.id.includes(":") ? tab.id.replace(/:\d+$/, "").split(":").pop() ?? tab.id : tab.id;
  const alreadyHasButton = !!(tabList && (tabList.querySelector(`[data-tab-id="${CSS.escape(tab.id)}"]`) || tabList.querySelector(`[data-tab-id="${CSS.escape(_bareId)}"]`)));
  if (!tabList || alreadyHasButton)
    return;
  const showLabels = isShowTabLabels();
  dlog(`addSecondaryTabButton: id=${tab.id} title="${tab.title}" iconSvg=${!!tab.iconSvg} iconUrl=${!!tab.iconUrl} shortName="${tab.shortName}" showLabels=${showLabels}`);
  const btn = document.createElement("button");
  btn.setAttribute("data-tab-id", tab.id);
  btn.setAttribute("title", tab.title);
  if (showLabels)
    btn.classList.add("sidebar-ux-tab-labeled");
  btn.style.cssText = `
    width: 100%;
    height: ${showLabels ? "56px" : "48px"};
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  `;
  const iconWrap = document.createElement("span");
  if (tab.iconSvg) {
    iconWrap.innerHTML = tab.iconSvg;
  } else if (tab.iconUrl) {
    const img = document.createElement("img");
    img.src = tab.iconUrl;
    img.alt = "";
    img.width = 20;
    img.height = 20;
    img.style.borderRadius = "2px";
    iconWrap.appendChild(img);
  } else {
    iconWrap.innerHTML = PUZZLE_ICON_SVG;
  }
  btn.appendChild(iconWrap);
  const labelSpan = document.createElement("span");
  labelSpan.className = "sidebar-ux-tab-label";
  labelSpan.textContent = deriveShortName(tab.title, tab.shortName);
  labelSpan.style.cssText = `
    opacity: ${showLabels ? "1" : "0"};
    height: ${showLabels ? "auto" : "0"};
    margin-top: ${showLabels ? "1px" : "0"};
    transition: opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
  `;
  btn.appendChild(labelSpan);
  btn.addEventListener("click", () => {
    if (isSecondarySidebarOpen()) {
      if (getActiveSecondaryTabId() === tab.id) {
        closeSecondarySidebar();
      } else {
        showSecondaryTab(tab.id);
      }
    } else {
      openSecondarySidebar();
      showSecondaryTab(tab.id);
    }
  });
  btn.addEventListener("contextmenu", (e3) => {
    e3.preventDefault();
    e3.stopPropagation();
    showAssignmentMenu(e3.clientX, e3.clientY, tab.id, tab.title, btn);
  });
  tabList.appendChild(btn);
  Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
}
function removeSecondaryTabButton(tabId) {
  const btn = getSecondaryTabList()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`) ?? getSecondaryWrapper()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`);
  btn?.remove();
  Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
}
function reorderSecondaryTabButtons(ids) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  for (const id of ids) {
    const btn = tabList.querySelector(`[data-tab-id="${CSS.escape(id)}"]`);
    if (btn) {
      tabList.appendChild(btn);
    }
  }
}
function applyHiddenTabIdsToSecondary(hiddenIds) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  for (const btn of Array.from(tabList.querySelectorAll("button[data-tab-id]"))) {
    const tid = btn.getAttribute("data-tab-id") || "";
    if (hiddenIds.has(tid)) {
      btn.style.display = "none";
    } else {
      btn.style.display = "";
    }
  }
}
function applyHiddenTabIdsToMirror(hiddenIds) {
  Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
    const list = m3.getMainMirrorTabList();
    if (!list)
      return;
    for (const btn of Array.from(list.querySelectorAll("button[data-tab-id]"))) {
      const tid = btn.getAttribute("data-tab-id") || "";
      if (hiddenIds.has(tid)) {
        btn.style.display = "none";
      } else {
        btn.style.display = "";
      }
    }
  });
}
function _isMobileViewport() {
  if (typeof window === "undefined" || !window.matchMedia)
    return false;
  return window.matchMedia("(max-width: 600px)").matches;
}
function updateDrawerTabVisibility() {
  const drawerTab = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
  if (!drawerTab)
    return;
  const hasSecondaryTabs = [...getTabAssignments()].some(([, s3]) => s3 === "secondary");
  if (_isMobileViewport()) {
    drawerTab.style.display = hasSecondaryTabs ? "flex" : "none";
    return;
  }
  if (isHideDrawerOpenCloseButtonsEnabled()) {
    drawerTab.style.display = "none";
    return;
  }
  drawerTab.style.display = hasSecondaryTabs ? "flex" : "none";
}
function clearSecondaryTabButtonActive() {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  for (const btn of tabList.querySelectorAll("button.sidebar-ux-tab-active")) {
    btn.classList.remove("sidebar-ux-tab-active");
  }
}
function showSecondaryTab(tabId) {
  setActiveSecondaryTabId(tabId);
  persistLayout();
  const secondaryContent = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
  const movedRoots = secondaryContent ? Array.from(secondaryContent.querySelectorAll("[data-canvas-moved]")) : [];
  let activeTitle = findMainTabButton(tabId)?.getAttribute("title") || "";
  for (const root of movedRoots) {
    const tid = root.getAttribute("data-canvas-moved") || "";
    if (tid === tabId) {
      root.setAttribute("data-canvas-active", "");
      const mainBtn = findMainTabButton(tid);
      if (mainBtn)
        activeTitle = mainBtn.getAttribute("title") || "";
    } else {
      root.removeAttribute("data-canvas-active");
    }
  }
  if (activeTitle) {
    const title = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
    if (title)
      title.textContent = activeTitle;
  }
  const allBtns = getSecondaryTabList()?.querySelectorAll("button[data-tab-id]");
  if (allBtns) {
    for (const btn of allBtns) {
      const isActive = btn.getAttribute("data-tab-id") === tabId;
      btn.classList.toggle("sidebar-ux-tab-active", isActive);
      btn.style.color = "";
      btn.style.background = "";
      btn.style.boxShadow = "";
      btn.style.borderRadius = "";
      const label = btn.querySelector(".sidebar-ux-tab-label");
      if (label)
        label.style.color = "";
    }
  }
}
var _hideMainTabButtonOverride = null, _showMainTabButtonOverride = null;
var init_buttons = __esm(() => {
  init_store();
  init_log();
  init_drawer_sync();
  init_secondary();
  init_state();
  init_assignment();
  init_tab_context_menu();
  init_persist();
});

// src/tabs/activation-handoff.ts
async function captureSourceList(side, h4) {
  if (side === "primary") {
    const _findStore = h4?.findStoreData ?? findStoreData;
    const _getTabs = h4?.getDrawerTabs ?? getDrawerTabs;
    const _getSidebar = h4?.getMainSidebar ?? getMainSidebar;
    const mainSidebar = _getSidebar();
    const domIds = [];
    if (mainSidebar) {
      const btns2 = mainSidebar.querySelectorAll("button[data-tab-id]");
      for (const btn of btns2) {
        const id = btn.getAttribute("data-tab-id");
        if (id)
          domIds.push(id);
      }
    }
    _findStore(true);
    const storeIds = _getTabs().map((t3) => t3.id).filter(Boolean);
    const merged = [];
    const seen = new Set;
    for (const id of domIds) {
      if (!seen.has(id)) {
        merged.push(id);
        seen.add(id);
      }
    }
    for (const id of storeIds) {
      if (!seen.has(id)) {
        merged.push(id);
        seen.add(id);
      }
    }
    if (merged.length === 0) {
      await new Promise((r3) => requestAnimationFrame(() => r3()));
      const retrySidebar = _getSidebar();
      if (retrySidebar) {
        const btns2 = retrySidebar.querySelectorAll("button[data-tab-id]");
        for (const btn of btns2) {
          const id = btn.getAttribute("data-tab-id");
          if (id && !seen.has(id)) {
            merged.push(id);
            seen.add(id);
          }
        }
      }
    }
    const _getSidebarForFilter = h4?.getMainSidebar ?? getMainSidebar;
    const mainSidebarEl = _getSidebarForFilter();
    if (mainSidebarEl) {
      const filtered = [];
      const filteredOut = [];
      for (const id of merged) {
        const btn = mainSidebarEl.querySelector(`button[data-tab-id="${id}"]`);
        if (btn && btn.style.display === "none") {
          filteredOut.push(id);
          continue;
        }
        filtered.push(id);
      }
      return filtered;
    }
    return merged;
  }
  const list = getSecondaryTabList();
  const btns = list ? list.querySelectorAll("button[data-tab-id]") : document.querySelectorAll(".sidebar-ux-tab-list button[data-tab-id]");
  return Array.from(btns).map((b2) => b2.getAttribute("data-tab-id")).filter(Boolean);
}
async function isMovedTabActiveInSource(tabId, side, h4, preMoveSourceActiveTab) {
  if (preMoveSourceActiveTab !== undefined) {
    return preMoveSourceActiveTab;
  }
  if (side === "primary") {
    await new Promise((r3) => Promise.resolve().then(() => r3()));
    return (h4?.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer)(tabId);
  }
  return (h4?.getActiveSecondaryTabId ?? getActiveSecondaryTabId)() === tabId;
}
function pickSourceReplacement(tabId, sourceList) {
  const idx = sourceList.indexOf(tabId);
  if (idx === -1)
    return sourceList.length > 0 ? sourceList[0] : null;
  if (idx > 0)
    return sourceList[idx - 1];
  if (idx < sourceList.length - 1)
    return sourceList[idx + 1];
  return null;
}
async function activateInPrimary(tabId, h4) {
  const _findBtn = h4?.findMainTabButton ?? findMainTabButton;
  const _findStore = h4?.findStoreData ?? findStoreData;
  const _getTabs = h4?.getDrawerTabs ?? getDrawerTabs;
  const _getPanel = h4?.getMainPanelContent ?? getMainPanelContent;
  let resolvedId = tabId;
  const directBtn = _findBtn(tabId);
  if (!directBtn) {
    _findStore(true);
    const tabs = _getTabs();
    const bySegment = tabs.find((t3) => t3.id.includes(`:tab:${tabId}:`) || t3.id === tabId);
    if (bySegment) {
      resolvedId = bySegment.id;
    }
  }
  const mainBtn = directBtn ?? _findBtn(resolvedId);
  if (mainBtn) {
    mainBtn.click();
    const stickSidebar = (h4?.getMainSidebar ?? getMainSidebar)();
    let stickObserver = null;
    if (stickSidebar && typeof MutationObserver !== "undefined") {
      stickObserver = new MutationObserver(() => {
        const currentActive = stickSidebar.querySelector('button[class*="tabBtnActive"]');
        const currentActiveId = currentActive?.getAttribute("data-tab-id");
        if (currentActiveId && currentActiveId !== resolvedId) {
          if (stickObserver) {
            stickObserver.disconnect();
            stickObserver = null;
          }
          mainBtn.click();
        }
      });
      stickObserver.observe(stickSidebar, { attributes: true, attributeFilter: ["class"], subtree: true });
      setTimeout(() => {
        if (stickObserver) {
          stickObserver.disconnect();
          stickObserver = null;
        }
      }, 200);
    }
    await new Promise((resolve) => {
      setTimeout(() => {
        const active = mainBtn.className.includes("tabBtnActive");
        const wUiForCheck = getHostBridge()?.ui;
        const rootForCheck = wUiForCheck?.getBuiltInTabRoot?.(resolvedId);
        const mainPanelContentForCheck = _getPanel();
        const rootInMain = rootForCheck && mainPanelContentForCheck ? mainPanelContentForCheck.contains(rootForCheck) : null;
        const rootChildCount = rootForCheck ? rootForCheck.children.length : null;
        const rootComputedDisplay = rootForCheck ? getComputedStyle(rootForCheck).display : null;
        const rootRect = rootForCheck ? rootForCheck.getBoundingClientRect() : null;
        if (!active) {
          mainBtn.click();
        }
        if (active && rootInMain === false && rootForCheck && mainPanelContentForCheck) {
          if (!mainPanelContentForCheck.contains(rootForCheck)) {
            mainPanelContentForCheck.appendChild(rootForCheck);
          }
        }
        resolve();
      }, 100);
    });
    const title = mainBtn.getAttribute("title") || mainBtn.getAttribute("aria-label") || undefined;
    adoptMainMirrorHostActivation(mainBtn, title);
  }
}
function activateInSecondary(tabId, h4) {
  if (!h4) {
    showSecondaryTab(tabId);
    return;
  }
  const _setSecondaryTabId = h4?.setActiveSecondaryTabId ?? setActiveSecondaryTabId;
  _setSecondaryTabId(tabId);
  const secondaryContent = document.querySelector(".sidebar-ux-panel-content");
  if (secondaryContent) {
    const movedRoots = Array.from(secondaryContent.querySelectorAll("[data-canvas-moved]:not([data-canvas-secondary])"));
    for (const root of movedRoots) {
      const tid = root.getAttribute("data-canvas-moved") || "";
      if (tid === tabId) {
        root.setAttribute("data-canvas-active", "");
      } else {
        root.removeAttribute("data-canvas-active");
      }
    }
  }
}
async function runHandoff({ tabId, source, destination, sourceList, preMoveSourceActiveTab, _testHooks: h4 }) {
  const wasActive = await isMovedTabActiveInSource(tabId, source, h4, preMoveSourceActiveTab);
  const replacementId = pickSourceReplacement(tabId, sourceList);
  const isMobile = (h4?.isMobileViewport ?? isMobileViewport)();
  dlog(`[canvas-debug] HANDOFF_DECIDE movedTab=${tabId} source=${source} destination=${destination} ` + `wasActive=${wasActive} replacement=${replacementId ?? "NONE"} mobile=${isMobile} ` + `activateSource=${wasActive && replacementId !== null} activateDestination=${!isMobile}`);
  const above = replacementId !== null ? sourceList.indexOf(replacementId) < sourceList.indexOf(tabId) ? replacementId : null : null;
  const below = replacementId !== null ? sourceList.indexOf(replacementId) > sourceList.indexOf(tabId) ? replacementId : null : null;
  dlog(`[canvas-debug] HANDOFF_REPLACE_PICK source=${source} movedTab=${tabId} ` + `above=${above ?? "NONE"} below=${below ?? "NONE"} picked=${replacementId ?? "NONE"}`);
  if (wasActive && replacementId !== null) {
    try {
      if (source === "primary") {
        await activateInPrimary(replacementId, h4);
      } else {
        activateInSecondary(replacementId, h4);
      }
    } catch (err) {
      dlog(`[canvas-debug] HANDOFF_ERROR gate=source source=${source} replacement=${replacementId} err=${err}`);
    }
  }
  if (!isMobile) {
    dlog(`[canvas-debug] HANDOFF_DEST_ACTIVATE destination=${destination} tabId=${tabId} ` + `method=${destination === "primary" ? "click-main-button" : "setActiveSecondaryTabId+data-canvas-active"} ` + `skippedMobile=${isMobile}`);
    try {
      if (destination === "primary") {
        await activateInPrimary(tabId, h4);
      } else {
        activateInSecondary(tabId, h4);
      }
    } catch (err) {
      dlog(`[canvas-debug] HANDOFF_ERROR gate=destination destination=${destination} tabId=${tabId} err=${err}`);
    }
  }
}
var init_activation_handoff = __esm(() => {
  init_log();
  init_mobile_exclusion();
  init_secondary();
  init_main_tab_pin();
  init_active_tab();
  init_buttons();
  init_store();
});

// src/tabs/assignment.ts
var exports_assignment = {};
__export(exports_assignment, {
  setTabAssignment: () => setTabAssignment,
  setActiveSecondaryTabId: () => setActiveSecondaryTabId,
  isTabActiveInMainDrawer: () => isTabActiveInMainDrawer,
  hasTabAssignment: () => hasTabAssignment,
  hasSecondaryAssignedTabs: () => hasSecondaryAssignedTabs,
  getTabSidebar: () => getTabSidebar,
  getTabAssignments: () => getTabAssignments,
  getActiveSecondaryTabId: () => getActiveSecondaryTabId,
  ensureBuiltInTabActiveInMain: () => ensureBuiltInTabActiveInMain,
  deleteTabAssignment: () => deleteTabAssignment,
  clearTabAssignments: () => clearTabAssignments,
  assignTab: () => assignTab
});
function getTabAssignments() {
  return _tabAssignments;
}
function hasTabAssignment(tabId) {
  return _tabAssignments.has(tabId);
}
function clearTabAssignments() {
  _tabAssignments.clear();
}
function hasSecondaryAssignedTabs() {
  for (const side of _tabAssignments.values()) {
    if (side === "secondary")
      return true;
  }
  return false;
}
function setTabAssignment(tabId, panelId) {
  _tabAssignments.set(tabId, panelId);
}
function deleteTabAssignment(tabId) {
  _tabAssignments.delete(tabId);
}
function getTabSidebar(tabId) {
  return _tabAssignments.get(tabId) || "primary";
}
function armMainDrawerActiveRestore(tabId) {
  if (isMobileViewport())
    return;
  const sidebar = getMainSidebar();
  if (!sidebar)
    return;
  const restoreBtn = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
  const restoreActiveId = restoreBtn?.getAttribute("data-tab-id") ?? null;
  if (!restoreBtn || !restoreActiveId || restoreActiveId === tabId)
    return;
  let observer = new MutationObserver(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    restoreBtn.click();
  });
  observer.observe(sidebar, { attributes: true, attributeFilter: ["class"], subtree: true });
  setTimeout(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, 200);
}
async function ensureBuiltInTabActiveInMain(tabId, h4 = {}) {
  const _isActive = h4.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer;
  const _findBtn = h4.findMainTabButton ?? findMainTabButton;
  const _isMobile = h4.isMobileViewport ?? isMobileViewport;
  const _getRoot = h4.getBuiltInTabRoot ?? (() => {
    return;
  });
  const _dlog = h4.dlog ?? (() => {});
  _dlog(`[canvas-debug] ENSURE_ACTIVE_BEGIN tab=${tabId} isActive=${_isActive(tabId)} mobile=${_isMobile()}`);
  const _isActiveResult = _isActive(tabId);
  if (_isActiveResult)
    return;
  const _isMobileResult = _isMobile();
  if (_isMobileResult) {
    _dlog(`[tabmove] ensure-active: mobile, skipping pre-activation for "${tabId}"`);
    return;
  }
  const btn = _findBtn(tabId);
  if (!btn) {
    _dlog(`[tabmove] ensure-active: main button-not-found for "${tabId}", ` + `relying on host lazy-mount`);
    return;
  }
  _dlog(`[canvas-debug] ENSURE_ACTIVE_CLICK tab=${tabId}`);
  btn.click();
  await new Promise((r3) => requestAnimationFrame(() => r3()));
  const root = _getRoot(tabId);
  _dlog(`[canvas-debug] ENSURE_ACTIVE_DONE tab=${tabId} rootAfter=${root?.tagName ?? "null"}`);
  if (!root) {
    _dlog(`[tabmove] ensure-active: post-click root still null for "${tabId}"; ` + `move will fall through to host lazy-mount`);
  }
}
function addBuiltInSecondaryButton(bridge, tabId, builtInRoot) {
  const mainBtn = findMainTabButton(tabId);
  const title = bridge.ui.getBuiltInTabTitle?.(tabId) || mainBtn?.getAttribute("title") || tabId;
  const iconSvg = mainBtn?.querySelector("svg")?.outerHTML ?? builtInRoot.querySelector("svg")?.outerHTML;
  const shortName = readMainButtonShortName(mainBtn);
  addSecondaryTabButton({ id: tabId, title, root: builtInRoot, iconSvg, shortName });
}
async function assignTab(tabId, sidebar) {
  if (sidebar === "secondary") {
    const _preClickSidebar = getMainSidebar();
    const _preClickActiveBtn = _preClickSidebar?.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
    const _origActiveTabId = _preClickActiveBtn?.getAttribute("data-tab-id") || _preClickActiveBtn?.getAttribute("title") || null;
    const preMoveSourceList = await captureSourceList("primary");
    const preMoveActiveTab = isTabActiveInMainDrawer(tabId);
    const bridge = getHostBridge();
    if (bridge?.ui.getBuiltInTabRoot && bridge.ui.requestTabLocation) {
      if (preMoveActiveTab)
        armMainDrawerActiveRestore(tabId);
      let _restoreObserver = null;
      if (!preMoveActiveTab && _origActiveTabId && _preClickActiveBtn && _preClickSidebar) {
        _restoreObserver = new MutationObserver(() => {
          const active = _preClickSidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
          const activeId = active?.getAttribute("data-tab-id") || active?.getAttribute("title") || null;
          if (activeId && activeId !== _origActiveTabId) {
            _preClickActiveBtn.click();
          }
        });
        _restoreObserver.observe(_preClickSidebar, {
          attributes: true,
          attributeFilter: ["class"],
          subtree: true
        });
      }
      const { moveBuiltInTabToSecondaryContainer: moveBuiltInTabToSecondaryContainer2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
      const builtInRoot = await moveBuiltInTabToSecondaryContainer2({ tabId });
      if (_restoreObserver) {
        await new Promise((r3) => requestAnimationFrame(() => r3()));
        _restoreObserver.disconnect();
        _restoreObserver = null;
      }
      if (builtInRoot) {
        setTabAssignment(tabId, "secondary");
        hideMainTabButton(tabId);
        addBuiltInSecondaryButton(bridge, tabId, builtInRoot);
        updateDrawerTabVisibility();
        if (!isSecondarySidebarOpen() && !isMobileViewport())
          openSecondarySidebar();
        await runHandoff({
          tabId,
          source: "primary",
          destination: "secondary",
          sourceList: preMoveSourceList,
          preMoveSourceActiveTab: preMoveActiveTab
        });
        try {
          const m3 = await Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer));
          if (m3.isMainMirrorActive())
            m3.ensureHostContentParkedPublic();
        } catch {}
        persistLayout();
        return;
      }
    }
    if (!bridge) {
      dwarn(`[tabmove] no host bridge; tabId="${tabId}" treated as extension. Built-in move requires the spindle loader.`);
    }
    const { assignToSecondary: assignToSecondary2 } = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    await assignToSecondary2(tabId);
    await runHandoff({ tabId, source: "primary", destination: "secondary", sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab });
  } else {
    const bridge = getHostBridge();
    if (bridge?.ui.getBuiltInTabRoot?.(tabId) && bridge.ui.requestTabLocation) {
      bridge.ui.requestTabLocation(tabId, { kind: "main-drawer" });
    }
    const { unassignFromSecondary: unassignFromSecondary2 } = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    const preMoveSourceList = await captureSourceList("secondary");
    const preMoveActiveTab = getActiveSecondaryTabId() === tabId;
    await unassignFromSecondary2(tabId);
    await runHandoff({ tabId, source: "secondary", destination: "primary", sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab });
  }
}
var _tabAssignments;
var init_assignment = __esm(() => {
  init_log();
  init_mobile_exclusion();
  init_secondary();
  init_buttons();
  init_persist();
  init_activation_handoff();
  init_active_tab();
  _tabAssignments = new Map;
});

// src/sidebar/tab-position.ts
var exports_tab_position = {};
__export(exports_tab_position, {
  reconcileTabListPin: () => reconcileTabListPin,
  isTabListPinned: () => isTabListPinned,
  getTabListPosition: () => getTabListPosition,
  getPinnedTabList: () => getPinnedTabList,
  getMainPinHost: () => getMainPinHost,
  ensureMainPinHost: () => ensureMainPinHost,
  destroyMainPinHost: () => destroyMainPinHost,
  clearPinnedTabListChrome: () => clearPinnedTabListChrome,
  applyTabListPosition: () => applyTabListPosition,
  applyTabListPin: () => applyTabListPin,
  applyPinnedTabListChrome: () => applyPinnedTabListChrome,
  __setPinHostForTest: () => __setPinHostForTest,
  __setMainPinHostForTest: () => __setMainPinHostForTest,
  __resetPinStateForTest: () => __resetPinStateForTest,
  __getPinHostForTest: () => __getPinHostForTest,
  __getMainPinHostForTest: () => __getMainPinHostForTest,
  TAB_LIST_WIDTH_PX: () => TAB_LIST_WIDTH_PX,
  TAB_LIST_SPACER_CLASS: () => TAB_LIST_SPACER_CLASS,
  TAB_LIST_PIN_HOST_CLASS: () => TAB_LIST_PIN_HOST_CLASS,
  TAB_LIST_PINNED_CLASS: () => TAB_LIST_PINNED_CLASS,
  PIN_OWNER_SECONDARY: () => PIN_OWNER_SECONDARY,
  PIN_OWNER_MAIN: () => PIN_OWNER_MAIN
});
function getPinnedTabList() {
  if (!_pinHost)
    return null;
  const kids = _pinHost.children;
  if (kids && kids.length) {
    let last = null;
    for (let i3 = 0;i3 < kids.length; i3++) {
      const c3 = kids[i3];
      if (isTabListElement(c3))
        last = c3;
    }
    if (last)
      return last;
  }
  return _pinHost.querySelector?.(".sidebar-ux-tab-list") ?? null;
}
function isTabListElement(el) {
  if (!el)
    return false;
  const cn = el.className;
  if (typeof cn === "string") {
    const tokens = cn.split(/\s+/).filter(Boolean);
    if (tokens.includes("sidebar-ux-tab-list") || tokens.includes(TAB_LIST_PINNED_CLASS)) {
      return true;
    }
  }
  const cls = el.classList;
  if (typeof cls?.contains === "function") {
    return cls.contains("sidebar-ux-tab-list") || cls.contains(TAB_LIST_PINNED_CLASS);
  }
  return false;
}
function __getPinHostForTest() {
  return _pinHost;
}
function __setPinHostForTest(host) {
  _pinHost = host;
}
function __getMainPinHostForTest() {
  return _mainPinHost;
}
function __setMainPinHostForTest(host) {
  _mainPinHost = host;
}
function __resetPinStateForTest() {
  _pinHost = null;
  _pinSpacer = null;
  _restoreParent = null;
  _restoreNext = null;
  _mainPinHost = null;
}
function getMainPinHost() {
  return _mainPinHost;
}
function ensureMainPinHost(side) {
  if (typeof document === "undefined" || !document.body)
    return null;
  if (!_mainPinHost) {
    _mainPinHost = document.createElement("div");
    document.body.appendChild(_mainPinHost);
  }
  sweepStrayPinHosts();
  applyPinHostChrome(_mainPinHost, side, PIN_OWNER_MAIN);
  return _mainPinHost;
}
function destroyMainPinHost() {
  if (_mainPinHost) {
    while (_mainPinHost.firstChild) {
      _mainPinHost.removeChild(_mainPinHost.firstChild);
    }
    _mainPinHost.remove();
    _mainPinHost = null;
  }
  sweepStrayPinHosts();
}
function applyPinHostChrome(host, side, owner) {
  host.className = `${TAB_LIST_PIN_HOST_CLASS} sidebar-ux-side-${side}`;
  host.setAttribute("data-pin-owner", owner);
  setIfDifferent(host.style, "position", "fixed");
  setIfDifferent(host.style, "top", SAFE_TOP);
  setIfDifferent(host.style, "bottom", SAFE_BOTTOM);
  setIfDifferent(host.style, "zIndex", PIN_Z_INDEX);
  setIfDifferent(host.style, "width", `${TAB_LIST_WIDTH_PX}px`);
  setIfDifferent(host.style, "pointerEvents", "none");
  if (side === "right") {
    setIfDifferent(host.style, "right", "0");
    setIfDifferent(host.style, "left", "");
  } else {
    setIfDifferent(host.style, "left", "0");
    setIfDifferent(host.style, "right", "");
  }
}
function setIfDifferent(el, prop, val) {
  if (el[prop] !== val) {
    el[prop] = val;
  }
}
function applyFlexAndBorder(drawer, tabList, wantFlex) {
  setIfDifferent(drawer.style, "flexDirection", wantFlex);
  const wantBorder = wantFlex === "row" ? "right" : "left";
  setIfDifferent(tabList.style, "borderTop", "none");
  setIfDifferent(tabList.style, "borderBottom", "none");
  if (wantBorder === "right") {
    setIfDifferent(tabList.style, "borderRight", "1px solid var(--lumiverse-primary-020)");
    setIfDifferent(tabList.style, "borderLeft", "none");
  } else {
    setIfDifferent(tabList.style, "borderLeft", "1px solid var(--lumiverse-primary-020)");
    setIfDifferent(tabList.style, "borderRight", "none");
  }
}
function applyPanelChatBorder(panel, drawerSide, enabled) {
  const chatSide = drawerSide === "left" ? "right" : "left";
  if (enabled) {
    if (chatSide === "right") {
      setIfDifferent(panel.style, "borderRight", CHAT_FACING_BORDER);
      setIfDifferent(panel.style, "borderLeft", "none");
    } else {
      setIfDifferent(panel.style, "borderLeft", CHAT_FACING_BORDER);
      setIfDifferent(panel.style, "borderRight", "none");
    }
  } else {
    setIfDifferent(panel.style, "borderRight", "none");
    setIfDifferent(panel.style, "borderLeft", "none");
  }
  setIfDifferent(panel.style, "borderTop", "none");
  setIfDifferent(panel.style, "borderBottom", "none");
}
function wantsChatFacingPanelBorder(outerEdgeEnabled) {
  return outerEdgeEnabled || !!getSettings().keepTabListVisible;
}
function applyTabListPosition(enabled, opts) {
  if (isMobileViewport())
    return;
  const side = getMainDrawerSide();
  const chatBorder = wantsChatFacingPanelBorder(enabled);
  const drawer = opts?.drawer ?? getSecondaryDrawer();
  const tabList = opts?.tabList ?? getSecondaryTabList();
  const panel = opts?.panel ?? getSecondaryPanel();
  if (drawer && tabList) {
    const pinned = typeof tabList.classList?.contains === "function" && tabList.classList.contains(TAB_LIST_PINNED_CLASS);
    const secondaryDrawerSide = side === "left" ? "right" : "left";
    if (!pinned) {
      const defaultFlex = secondaryDrawerSide === "left" ? "row-reverse" : "row";
      const toggledFlex = secondaryDrawerSide === "left" ? "row" : "row-reverse";
      const wantFlex = enabled ? toggledFlex : defaultFlex;
      applyFlexAndBorder(drawer, tabList, wantFlex);
    }
    if (panel)
      applyPanelChatBorder(panel, secondaryDrawerSide, chatBorder);
  }
  const mainDrawer = opts?.mainDrawer ?? getMainDrawer();
  const mainTabList = opts?.mainTabList ?? getMainSidebar();
  const mainPanel = opts?.mainPanel ?? getMainPanel();
  if (mainDrawer && mainTabList) {
    const mainDefaultFlex = side === "left" ? "row-reverse" : "row";
    const mainToggledFlex = side === "left" ? "row" : "row-reverse";
    const mainWantFlex = enabled ? mainToggledFlex : mainDefaultFlex;
    applyFlexAndBorder(mainDrawer, mainTabList, mainWantFlex);
    if (mainPanel)
      applyPanelChatBorder(mainPanel, side, chatBorder);
  }
}
function getTabListPosition(opts) {
  const empty = {
    drawerDir: "",
    tabListBorderLeft: "",
    tabListBorderRight: "",
    handleLeft: "",
    handleRight: "",
    mainDrawerDir: "",
    mainTabListBorderLeft: "",
    mainTabListBorderRight: ""
  };
  const drawer = opts?.drawer ?? null;
  const tabList = opts?.tabList ?? null;
  const handle = opts?.handle ?? null;
  const mainDrawer = opts?.mainDrawer ?? getMainDrawer();
  const mainTabList = opts?.mainTabList ?? getMainSidebar();
  return {
    drawerDir: drawer?.style.flexDirection || "",
    tabListBorderLeft: tabList?.style.borderLeft || "",
    tabListBorderRight: tabList?.style.borderRight || "",
    handleLeft: handle?.style.left || "",
    handleRight: handle?.style.right || "",
    mainDrawerDir: mainDrawer?.style.flexDirection || "",
    mainTabListBorderLeft: mainTabList?.style.borderLeft || "",
    mainTabListBorderRight: mainTabList?.style.borderRight || ""
  };
}
function isTabListPinned(tabList) {
  const el = tabList ?? getSecondaryTabList() ?? getPinnedTabList();
  return !!el?.classList.contains(TAB_LIST_PINNED_CLASS);
}
function reconcileTabListPin() {
  if (isMobileViewport()) {
    applyTabListPin(false, { force: true });
    Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
    return;
  }
  const want = !!getSettings().keepTabListVisible && hasSecondaryAssignedTabs();
  applyTabListPin(want, { force: true });
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
}
function applyTabListPin(enabled, opts) {
  if (isMobileViewport()) {
    if (enabled && !opts?.force)
      return;
    const el = getSecondaryTabList() ?? getPinnedTabList();
    if (el?.classList?.contains(TAB_LIST_PINNED_CLASS) || _pinHost || _pinSpacer) {
      unpinTabList(el);
    }
    return;
  }
  const wantPin = enabled && hasSecondaryAssignedTabs();
  if (!wantPin) {
    const el = getSecondaryTabList() ?? getPinnedTabList();
    const hasPinState = !!el?.classList?.contains(TAB_LIST_PINNED_CLASS) || !!_pinHost || !!_pinSpacer;
    if (!hasPinState) {
      if (opts?.force)
        destroyPinChrome();
      return;
    }
    unpinTabList(el);
    return;
  }
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  const isPinned = tabList.classList.contains(TAB_LIST_PINNED_CLASS);
  if (isPinned && !opts?.force)
    return;
  pinTabList(tabList);
}
function secondarySide() {
  return getMainDrawerSide() === "left" ? "right" : "left";
}
function ensurePinHost(side) {
  if (typeof document === "undefined" || !document.body)
    return null;
  if (!_pinHost) {
    _pinHost = document.createElement("div");
    document.body.appendChild(_pinHost);
  }
  sweepStrayPinHosts();
  applyPinHostChrome(_pinHost, side, PIN_OWNER_SECONDARY);
  return _pinHost;
}
function sweepStrayPinHosts() {
  if (typeof document === "undefined" || !document.querySelectorAll)
    return;
  const hosts = document.querySelectorAll(`.${TAB_LIST_PIN_HOST_CLASS}`);
  for (const host of Array.from(hosts)) {
    if (host !== _pinHost && host !== _mainPinHost) {
      host.remove();
    }
  }
}
function removeOrphanTabListsFromHost(keep) {
  if (!_pinHost)
    return;
  const kids = _pinHost.children ? Array.from(_pinHost.children) : Array.from(_pinHost.childNodes).filter((c3) => c3.nodeType === 1 || isTabListElement(c3));
  for (const child of kids) {
    if (child === keep)
      continue;
    if (isTabListElement(child)) {
      _pinHost.removeChild(child);
    }
  }
}
function applyPinnedTabListChrome(tabList, side) {
  const innerBorderSide = side === "right" ? "left" : "right";
  tabList.classList.add(TAB_LIST_PINNED_CLASS);
  setIfDifferent(tabList.style, "position", "fixed");
  setIfDifferent(tabList.style, "top", SAFE_TOP);
  setIfDifferent(tabList.style, "bottom", SAFE_BOTTOM);
  setIfDifferent(tabList.style, "zIndex", PIN_Z_INDEX);
  setIfDifferent(tabList.style, "width", `${TAB_LIST_WIDTH_PX}px`);
  setIfDifferent(tabList.style, "pointerEvents", "auto");
  if (side === "right") {
    setIfDifferent(tabList.style, "right", "0");
    setIfDifferent(tabList.style, "left", "");
  } else {
    setIfDifferent(tabList.style, "left", "0");
    setIfDifferent(tabList.style, "right", "");
  }
  if (innerBorderSide === "right") {
    setIfDifferent(tabList.style, "borderRight", INNER_BORDER);
    setIfDifferent(tabList.style, "borderLeft", "none");
  } else {
    setIfDifferent(tabList.style, "borderLeft", INNER_BORDER);
    setIfDifferent(tabList.style, "borderRight", "none");
  }
}
function clearPinnedTabListChrome(tabList) {
  tabList.classList.remove(TAB_LIST_PINNED_CLASS);
  setIfDifferent(tabList.style, "position", "");
  setIfDifferent(tabList.style, "top", "");
  setIfDifferent(tabList.style, "bottom", "");
  setIfDifferent(tabList.style, "left", "");
  setIfDifferent(tabList.style, "right", "");
  setIfDifferent(tabList.style, "zIndex", "");
  setIfDifferent(tabList.style, "pointerEvents", "");
  setIfDifferent(tabList.style, "width", `${TAB_LIST_WIDTH_PX}px`);
  setIfDifferent(tabList.style, "borderLeft", "");
  setIfDifferent(tabList.style, "borderRight", "");
}
function pinTabList(tabList) {
  const drawer = getSecondaryDrawer();
  const panel = getSecondaryPanel();
  const side = secondarySide();
  const parent = tabList.parentElement;
  if (parent && parent !== _pinHost) {
    _restoreParent = parent;
    _restoreNext = tabList.nextSibling;
    if (!_pinSpacer) {
      _pinSpacer = document.createElement("div");
      _pinSpacer.className = TAB_LIST_SPACER_CLASS;
      _pinSpacer.setAttribute("aria-hidden", "true");
      setIfDifferent(_pinSpacer.style, "width", `${TAB_LIST_WIDTH_PX}px`);
      setIfDifferent(_pinSpacer.style, "flexShrink", "0");
    }
    if (_pinSpacer.parentElement !== parent) {
      parent.insertBefore(_pinSpacer, _restoreNext);
    }
    const host = ensurePinHost(side);
    if (host && tabList.parentElement !== host) {
      removeOrphanTabListsFromHost(tabList);
      host.appendChild(tabList);
    }
    removeOrphanTabListsFromHost(tabList);
  } else if (_pinHost) {
    applyPinHostChrome(_pinHost, side, PIN_OWNER_SECONDARY);
    removeOrphanTabListsFromHost(tabList);
  }
  applyPinnedTabListChrome(tabList, side);
  if (drawer) {
    const flexDirection = side === "right" ? "row-reverse" : "row";
    setIfDifferent(drawer.style, "flexDirection", flexDirection);
  }
  if (panel) {
    applyPanelChatBorder(panel, side, true);
  }
}
function unpinTabList(tabList) {
  if (tabList) {
    clearPinnedTabListChrome(tabList);
    if (_restoreParent && tabList.parentElement === _pinHost) {
      if (_pinSpacer?.parentElement === _restoreParent) {
        _restoreParent.insertBefore(tabList, _pinSpacer);
      } else if (_restoreNext && _restoreNext.parentNode === _restoreParent) {
        _restoreParent.insertBefore(tabList, _restoreNext);
      } else {
        const panel = getSecondaryPanel();
        if (panel && panel.parentElement === _restoreParent) {
          _restoreParent.insertBefore(tabList, panel);
        } else {
          _restoreParent.appendChild(tabList);
        }
      }
    }
  }
  destroyPinChrome();
  applyTabListPosition(getSettings().moveControlsToOuterEdge);
}
function destroyPinChrome() {
  if (_pinSpacer) {
    _pinSpacer.remove();
    _pinSpacer = null;
  }
  _restoreParent = null;
  _restoreNext = null;
  if (_pinHost) {
    if (_pinHost.childNodes.length > 0) {
      const drawer = getSecondaryDrawer();
      const panel = getSecondaryPanel();
      while (_pinHost.firstChild) {
        const child = _pinHost.removeChild(_pinHost.firstChild);
        if (drawer && panel) {
          drawer.insertBefore(child, panel);
        } else if (drawer) {
          drawer.appendChild(child);
        }
      }
    }
    _pinHost.remove();
    _pinHost = null;
  }
  sweepStrayPinHosts();
}
var TAB_LIST_PINNED_CLASS = "sidebar-ux-tab-list--pinned", TAB_LIST_PIN_HOST_CLASS = "sidebar-ux-tab-list-pin-host", PIN_OWNER_SECONDARY = "secondary", PIN_OWNER_MAIN = "main", TAB_LIST_SPACER_CLASS = "sidebar-ux-tab-list-spacer", PIN_Z_INDEX = "10000", SAFE_TOP = "env(safe-area-inset-top, 0px)", SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)", INNER_BORDER = "1px solid var(--lumiverse-primary-020)", CHAT_FACING_BORDER = "1px solid var(--lumiverse-primary-020)", _pinHost = null, _pinSpacer = null, _restoreParent = null, _restoreNext = null, _mainPinHost = null;
var init_tab_position = __esm(() => {
  init_store();
  init_state();
  init_assignment();
  init_mobile_exclusion();
  init_secondary();
  init_styles();
});

// src/sidebar/panel-header-sync.ts
function syncPanelHeaderFromMain(getWrapper) {
  if (getWrapper)
    _getPrimaryWrapper = getWrapper;
  if (_syncPanelHeaderPending)
    return;
  _syncPanelHeaderPending = true;
  requestAnimationFrame(() => {
    _syncPanelHeaderPending = false;
    _runSyncPanelHeaderFromMain();
  });
}
function collectHeaderVarTargets(primary) {
  const out = [];
  const seen = new Set;
  const add = (el) => {
    if (!el || seen.has(el))
      return;
    seen.add(el);
    out.push(el);
  };
  add(primary);
  if (typeof document !== "undefined" && document.querySelectorAll) {
    document.querySelectorAll(".sidebar-ux-secondary-wrapper, .sidebar-ux-main-mirror-wrapper").forEach((n2) => add(n2));
  }
  return out;
}
function applyHeaderVars(target, vars) {
  target.style.setProperty("--sidebar-ux-panel-header-h", vars.height);
  target.style.setProperty("--sidebar-ux-panel-header-pt", vars.paddingTop);
  target.style.setProperty("--sidebar-ux-panel-header-pb", vars.paddingBottom);
  if (vars.fontSize) {
    target.style.setProperty("--sidebar-ux-panel-header-font-size", vars.fontSize);
  }
  target.style.setProperty("--sidebar-ux-panel-header-border-bottom", vars.borderBottom);
  target.style.setProperty("--sidebar-ux-panel-header-bg", vars.background);
}
function _runSyncPanelHeaderFromMain() {
  const primary = _getPrimaryWrapper ? _getPrimaryWrapper() : null;
  const targets = collectHeaderVarTargets(primary);
  if (targets.length === 0)
    return;
  const mainHeader = getMainPanelHeader();
  if (!mainHeader)
    return;
  if (!_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver = new ResizeObserver(() => {
      syncPanelHeaderFromMain();
    });
    _mainPanelHeaderResizeObserver.observe(mainHeader);
    registerCleanup(stopPanelHeaderObservers);
  }
  if (!_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver = new MutationObserver(() => {
      syncPanelHeaderFromMain();
    });
    _mainPanelHeaderAttrObserver.observe(mainHeader, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    registerCleanup(stopPanelHeaderObservers);
  }
  const headerStyle = getComputedStyle(mainHeader);
  const titleEl = findHeaderTitleElement(mainHeader);
  const titleStyle = titleEl ? getComputedStyle(titleEl) : null;
  const height = `${mainHeader.offsetHeight}px`;
  const paddingTop = headerStyle.paddingTop;
  const paddingBottom = headerStyle.paddingBottom;
  const fontSize = titleStyle?.fontSize || "";
  const borderBottom = headerStyle.borderBottomWidth === "0px" ? "0px" : `${headerStyle.borderBottomWidth} ${headerStyle.borderBottomStyle} ${headerStyle.borderBottomColor}`;
  const background = headerStyle.backgroundColor;
  const vars = { height, paddingTop, paddingBottom, fontSize, borderBottom, background };
  const cacheKey = [height, paddingTop, paddingBottom, fontSize, borderBottom, background].join("|");
  const allStamped = cacheKey === _lastWrittenHeaderVars && targets.every((t3) => !!t3.style.getPropertyValue("--sidebar-ux-panel-header-h"));
  if (allStamped)
    return;
  _lastWrittenHeaderVars = cacheKey;
  for (const target of targets) {
    applyHeaderVars(target, vars);
  }
}
function findHeaderTitleElement(header) {
  for (const tag of ["H1", "H2", "H3"]) {
    const byTag = header.querySelector(tag);
    if (byTag)
      return byTag;
  }
  const byClass = header.querySelector('[class*="title"], [class*="Title"]');
  if (byClass)
    return byClass;
  if (header.children.length > 0)
    return header.children[0];
  return null;
}
function stopPanelHeaderObservers() {
  if (_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver.disconnect();
    _mainPanelHeaderResizeObserver = null;
  }
  if (_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver.disconnect();
    _mainPanelHeaderAttrObserver = null;
  }
}
function resetPanelHeaderSyncCache() {
  _lastWrittenHeaderVars = null;
}
var _lastWrittenHeaderVars = null, _mainPanelHeaderResizeObserver = null, _mainPanelHeaderAttrObserver = null, _syncPanelHeaderPending = false, _getPrimaryWrapper = null;
var init_panel_header_sync = __esm(() => {
  init_cleanup();
});

// src/sidebar/main-mirror-drawer.ts
var exports_main_mirror_drawer = {};
__export(exports_main_mirror_drawer, {
  updateMainMirrorDrawerTabVisibility: () => updateMainMirrorDrawerTabVisibility,
  setCanvasMainTitle: () => setCanvasMainTitle,
  restartReparkWatch: () => restartReparkWatch,
  reconcileMainMirrorDrawer: () => reconcileMainMirrorDrawer,
  openCanvasMainDrawer: () => openCanvasMainDrawer,
  onMainMirrorTabActivated: () => onMainMirrorTabActivated,
  isMainMirrorActive: () => isMainMirrorActive,
  isCanvasMainOpen: () => isCanvasMainOpen,
  getMainMirrorWrapper: () => getMainMirrorWrapper,
  getMainMirrorWidthVar: () => getMainMirrorWidthVar,
  getMainMirrorTitleEl: () => getMainMirrorTitleEl,
  getMainMirrorTabList: () => getMainMirrorTabList,
  getMainMirrorPanelContent: () => getMainMirrorPanelContent,
  getMainMirrorDrawer: () => getMainMirrorDrawer,
  ensureHostContentParkedPublic: () => ensureHostContentParkedPublic,
  closeCanvasMainDrawer: () => closeCanvasMainDrawer,
  applyMainMirrorRestoredWidth: () => applyMainMirrorRestoredWidth,
  applyMainMirrorDrawer: () => applyMainMirrorDrawer,
  __resetMainMirrorForTest: () => __resetMainMirrorForTest,
  __getReparkIdleCountForTest: () => __getReparkIdleCountForTest,
  MAIN_MIRROR_WIDTH_VAR: () => MAIN_MIRROR_WIDTH_VAR
});
function getMainMirrorWidthVar() {
  return MAIN_MIRROR_WIDTH_VAR;
}
function isMainMirrorActive() {
  return _active && !isMobileViewport();
}
function isCanvasMainOpen() {
  return _open && isMainMirrorActive();
}
function getMainMirrorWrapper() {
  return _shell?.wrapper ?? null;
}
function getMainMirrorDrawer() {
  return _shell?.drawer ?? null;
}
function getMainMirrorTabList() {
  if (!_shell)
    return null;
  const host = ensureMainPinHost(getMainDrawerSide());
  if (host) {
    const pinned = host.querySelector(".sidebar-ux-tab-list");
    if (pinned)
      return pinned;
  }
  return _shell.tabList;
}
function getMainMirrorPanelContent() {
  return _shell?.content ?? null;
}
function getMainMirrorTitleEl() {
  return _shell?.title ?? null;
}
function applyMainMirrorDrawer(enabled, opts) {
  if (isMobileViewport()) {
    if (_active || opts?.force)
      teardownMainMirror();
    return;
  }
  if (!enabled) {
    teardownMainMirror();
    return;
  }
  const side = getMainDrawerSide();
  if (_active && _shell && _mountedSide === side && !opts?.force) {
    ensureHostContentParked();
    return;
  }
  if (_active && (_mountedSide !== side || opts?.force)) {
    const wasOpen = _open;
    teardownMainMirror({ keepWidthVar: true });
    mountMainMirror({ initialOpen: opts?.initialOpen ?? wasOpen });
    return;
  }
  mountMainMirror({
    initialOpen: opts?.initialOpen ?? false
  });
}
function reconcileMainMirrorDrawer(opts) {
  if (isMobileViewport()) {
    applyMainMirrorDrawer(false, { force: true });
    return;
  }
  const on = !!getSettings().keepTabListVisible;
  if (!on) {
    applyMainMirrorDrawer(false, { force: true });
    return;
  }
  applyMainMirrorDrawer(true, {
    force: false,
    initialOpen: opts?.initialOpen
  });
  if (opts?.initialOpen !== undefined && _active && !_open && opts.initialOpen) {
    openCanvasMainDrawer();
  }
}
function bumpReflow() {
  updateChatReflow();
}
function bumpResizeHandles() {
  mountResizeHandles();
}
function persistCanvasMainOpenState() {
  persistOpenState();
}
function applyMainMirrorRestoredWidth(widthPx) {
  const w3 = Math.ceil(clampSidebarWidth(widthPx));
  if (!(w3 > 0))
    return;
  document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${w3}px`);
  if (_shell && !_open) {
    _shell.wrapper.style.transform = `translateX(${closedTransformPx(_shell.side, w3)}px)`;
  }
}
function openCanvasMainDrawer() {
  if (!_shell || !_active)
    return;
  ensureHostContentParked();
  if (_open) {
    dlog("[main-mirror] open (already open)");
    _shell.wrapper.style.transform = "translateX(0)";
    return;
  }
  dlog(`[main-mirror] open side=${_shell.side}`);
  _open = true;
  document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS);
  _shell.drawerTab.classList.add("sidebar-ux-drawer-tab--active");
  animateWrapper(_shell.wrapper, 0);
  Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => m3.reconcileMainTabListPin()).catch((err) => {
    dwarn(`[main-mirror] reconcileMainTabListPin failed: ${err}`);
  });
  bumpReflow();
  persistCanvasMainOpenState();
  restartReparkWatch();
}
function closeCanvasMainDrawer() {
  if (!_shell || !_active)
    return;
  if (!_open)
    return;
  const side = _shell.side;
  const w3 = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420);
  dlog(`[main-mirror] close side=${side} closedTx=${closedTransformPx(side, w3)}`);
  animateWrapper(_shell.wrapper, closedTransformPx(side, w3));
  _open = false;
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS);
  _shell.drawerTab.classList.remove("sidebar-ux-drawer-tab--active");
  clearMainMirrorActiveHighlights();
  bumpReflow();
  persistCanvasMainOpenState();
}
function clearMainMirrorActiveHighlights() {
  const list = getMainMirrorTabList();
  if (!list)
    return;
  for (const btn of list.querySelectorAll("button.sidebar-ux-tab-active")) {
    btn.classList.remove("sidebar-ux-tab-active");
  }
}
function setCanvasMainTitle(text) {
  if (_shell?.title)
    _shell.title.textContent = text || "Drawer";
}
function onMainMirrorTabActivated(title) {
  if (!_active)
    return;
  if (title)
    setCanvasMainTitle(title);
  ensureHostContentParked();
  openCanvasMainDrawer();
  requestAnimationFrame(() => ensureHostContentParked());
  restartReparkWatch();
}
function __resetMainMirrorForTest() {
  teardownMainMirror();
}
function __getReparkIdleCountForTest() {
  return _reparkIdleCount;
}
function updateMainMirrorDrawerTabVisibility() {
  if (!_shell || !_active)
    return;
  if (isMobileViewport())
    return;
  _shell.drawerTab.style.display = isHideDrawerOpenCloseButtonsEnabled() ? "none" : "flex";
}
function injectHostHideStyles() {
  const id = "sidebar-ux-host-main-hide";
  const css = `
    /* Hide host main drawer chrome while Canvas owns main UX.
     * opacity:0 is required: host panelContent often has
     * visibility:visible and would paint through visibility:hidden alone. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      /* Avoid transform trapping any leftover fixed descendants. */
      transform: none !important;
      transition: none !important;
    }
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="drawerTab"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Any host panel body still under the host tree (mid tab-switch
     * remount before repark) must not paint through. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="_panelContent_"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /*
     * Host panelContent parked in the Canvas shell fills the content slot
     * like a secondary-drawer tab root — in normal flow, not position:fixed.
     *
     * Skip visibility/opacity force while html.sidebar-ux-main-restore-pending
     * (see main-persist restore guard). Otherwise visibility:visible !important
     * paints profile content through a parent with visibility:hidden.
     */
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [${CONTENT_MARK_ATTR}] {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow: auto;
      position: relative !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
    }
    html:not(.sidebar-ux-main-restore-pending)
      .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [${CONTENT_MARK_ATTR}] {
      visibility: visible !important;
      pointer-events: auto !important;
      opacity: 1 !important;
    }
  `;
  if (typeof document === "undefined" || !document.head)
    return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
function mountMainMirror(opts) {
  injectHostHideStyles();
  document.documentElement.classList.add(CANVAS_MAIN_ACTIVE_CLASS);
  const side = getMainDrawerSide();
  let seedW;
  try {
    const hostW = getMainDrawerWidth();
    seedW = hostW > 0 ? hostW : undefined;
  } catch {
    seedW = undefined;
  }
  const hideTab = !!getSettings().hideDrawerOpenCloseButtons && !!getSettings().keepTabListVisible;
  _shell = createDrawerShell({
    owner: "main",
    side,
    widthCssVar: MAIN_MIRROR_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: seedW,
    initialOpen: opts.initialOpen,
    title: "Drawer",
    drawerTabDisplay: hideTab ? "none" : "flex",
    onDrawerTabClick: () => {
      if (_open)
        closeCanvasMainDrawer();
      else
        openCanvasMainDrawer();
    },
    onHeaderClose: () => closeCanvasMainDrawer()
  });
  _shell.content.style.display = "flex";
  _shell.content.style.flexDirection = "column";
  _shell.content.style.padding = "0";
  _shell.content.setAttribute("data-canvas-main-content-slot", "1");
  document.body.appendChild(_shell.wrapper);
  _active = true;
  _open = opts.initialOpen;
  _mountedSide = side;
  if (_open) {
    document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS);
    _shell.drawerTab.classList.add("sidebar-ux-drawer-tab--active");
  } else {
    document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS);
    _shell.drawerTab.classList.remove("sidebar-ux-drawer-tab--active");
  }
  pinShellTabList(side);
  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    mainDrawer: _shell.drawer,
    mainTabList: getMainMirrorTabList() ?? _shell.tabList,
    mainPanel: _shell.panel
  });
  ensureHostContentParked();
  startReparkWatch();
  if (!_open && isMainDrawerOpen()) {
    openCanvasMainDrawer();
  }
  syncDrawerTabSettings();
  resetPanelHeaderSyncCache();
  syncPanelHeaderFromMain(() => _shell?.wrapper ?? null);
  bumpResizeHandles();
  bumpReflow();
}
function pinShellTabList(side) {
  if (!_shell)
    return;
  const tabList = _shell.tabList;
  const host = ensureMainPinHost(side);
  if (!host)
    return;
  if (tabList.parentElement && tabList.parentElement !== host) {
    _tabListRestoreParent = tabList.parentElement;
    _tabListRestoreNext = tabList.nextSibling;
    if (!_pinSpacer2) {
      _pinSpacer2 = document.createElement("div");
      _pinSpacer2.className = TAB_LIST_SPACER_CLASS;
      _pinSpacer2.setAttribute("aria-hidden", "true");
      _pinSpacer2.style.width = `${TAB_LIST_WIDTH_PX}px`;
      _pinSpacer2.style.flexShrink = "0";
      _tabListRestoreParent.insertBefore(_pinSpacer2, _tabListRestoreNext);
    }
    host.appendChild(tabList);
  }
  applyPinnedTabListChrome(tabList, side);
}
function unpinShellTabList() {
  if (!_shell)
    return;
  const tabList = _shell.tabList;
  clearPinnedTabListChrome(tabList);
  if (_tabListRestoreParent && tabList.parentElement !== _tabListRestoreParent) {
    _tabListRestoreParent.insertBefore(tabList, _tabListRestoreNext);
  }
  if (_pinSpacer2) {
    _pinSpacer2.remove();
    _pinSpacer2 = null;
  }
  _tabListRestoreParent = null;
  _tabListRestoreNext = null;
  destroyMainPinHost();
}
function resolveHostPanelContent() {
  if (_contentEl?.isConnected)
    return _contentEl;
  const fromHost = getMainPanelContent();
  if (fromHost)
    return fromHost;
  if (typeof document === "undefined")
    return null;
  return document.querySelector(`[${CONTENT_MARK_ATTR}]`);
}
function ensureHostContentParked() {
  if (!_shell || !_active)
    return;
  const slot = _shell.content;
  const hostContent = resolveHostPanelContent();
  if (!hostContent || !slot.isConnected) {
    dlog(`[main-mirror] park skip hostContent=${!!hostContent} slot=${!!slot?.isConnected}`);
    return;
  }
  _contentEl = hostContent;
  hostContent.setAttribute(CONTENT_MARK_ATTR, "1");
  const restorePending = typeof document !== "undefined" && document.documentElement.classList.contains("sidebar-ux-main-restore-pending");
  if (hostContent.parentElement !== slot) {
    if (!_contentRestoreParent) {
      _contentRestoreParent = hostContent.parentElement;
      _contentRestoreNext = hostContent.nextSibling;
    }
    const s3 = hostContent.style;
    for (const prop of [
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "position",
      "z-index",
      "margin",
      "box-sizing",
      "overflow",
      "background"
    ]) {
      s3.removeProperty(prop);
    }
    if (!restorePending) {
      for (const prop of ["visibility", "opacity", "pointer-events"]) {
        s3.removeProperty(prop);
      }
    }
    slot.appendChild(hostContent);
    dlog("[main-mirror] parked panelContent in shell.content (secondary-style)");
  }
  const wrap = getMainWrapper();
  if (wrap) {
    wrap.style.setProperty("transform", "none", "important");
    wrap.style.setProperty("transition", "none", "important");
    wrap.style.setProperty("visibility", "hidden", "important");
    wrap.style.setProperty("pointer-events", "none", "important");
  }
  if (restorePending) {
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then((m3) => {
      m3.stampPanelBodyHide();
    }).catch((err) => {
      dwarn(`[main-mirror] stampPanelBodyHide failed: ${err}`);
    });
  }
}
function ensureHostContentParkedPublic() {
  ensureHostContentParked();
}
function restoreHostContent() {
  if (_contentEl) {
    const s3 = _contentEl.style;
    for (const prop of [
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "position",
      "z-index",
      "visibility",
      "opacity",
      "pointer-events",
      "margin",
      "box-sizing",
      "overflow",
      "background"
    ]) {
      s3.removeProperty(prop);
    }
    if (_contentRestoreParent && _contentEl.parentElement !== _contentRestoreParent) {
      try {
        _contentRestoreParent.insertBefore(_contentEl, _contentRestoreNext);
      } catch {
        try {
          _contentRestoreParent.appendChild(_contentEl);
        } catch {}
      }
    }
    _contentEl.removeAttribute(CONTENT_MARK_ATTR);
  }
  _contentEl = null;
  _contentRestoreParent = null;
  _contentRestoreNext = null;
}
function startReparkWatch() {
  stopReparkWatch();
  _reparkIdleCount = 0;
  const tickMs = () => typeof document !== "undefined" && document.documentElement.classList.contains("sidebar-ux-main-restore-pending") ? 50 : 500;
  const tick = () => {
    _reparkTimer = null;
    if (!_active || !_shell)
      return;
    const el = resolveHostPanelContent();
    if (el && el.parentElement !== _shell.content) {
      dlog("[main-mirror] re-park: React moved panelContent back to host");
      ensureHostContentParked();
      _reparkIdleCount = 0;
    } else {
      _reparkIdleCount++;
      if (_reparkIdleCount >= REPARK_IDLE_STOP_COUNT) {
        dlog("[main-mirror] repark watch idle-stopped");
        return;
      }
    }
    _reparkTimer = setTimeout(tick, tickMs());
  };
  _reparkTimer = setTimeout(tick, tickMs());
}
function restartReparkWatch() {
  if (_active && _shell)
    startReparkWatch();
}
function stopReparkWatch() {
  if (_reparkTimer !== null) {
    clearTimeout(_reparkTimer);
    _reparkTimer = null;
  }
  _reparkIdleCount = 0;
}
function clearHostWrapperInline() {
  const wrap = getMainWrapper();
  if (!wrap)
    return;
  for (const prop of ["transform", "transition", "visibility", "pointer-events", "z-index"]) {
    wrap.style.removeProperty(prop);
  }
}
function teardownMainMirror(opts) {
  stopReparkWatch();
  restoreHostContent();
  clearHostWrapperInline();
  unpinShellTabList();
  if (_shell) {
    const handles = _shell.drawer.querySelectorAll(".sidebar-ux-resize-handle");
    for (const h4 of Array.from(handles))
      h4.remove();
    _shell.wrapper.remove();
    _shell = null;
  }
  if (!opts?.keepWidthVar) {
    const w3 = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0);
    if (w3 > 0) {
      const wrapper = getMainWrapper();
      if (wrapper) {
        wrapper.style.setProperty("--drawer-panel-w", `${Math.ceil(clampSidebarWidth(w3))}px`, "important");
      }
    }
    document.documentElement.style.removeProperty(MAIN_MIRROR_WIDTH_VAR);
  }
  document.documentElement.classList.remove(CANVAS_MAIN_ACTIVE_CLASS);
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS);
  _active = false;
  _open = false;
  _mountedSide = null;
  bumpReflow();
}
var CONTENT_MARK_ATTR = "data-canvas-main-panel-content", _active = false, _open = false, _shell = null, _pinSpacer2 = null, _tabListRestoreParent = null, _tabListRestoreNext = null, _contentEl = null, _contentRestoreParent = null, _contentRestoreNext = null, _mountedSide = null, _reparkTimer = null, _reparkIdleCount = 0, REPARK_IDLE_STOP_COUNT = 10;
var init_main_mirror_drawer = __esm(() => {
  init_store();
  init_state();
  init_state();
  init_log();
  init_animation();
  init_drawer_shell();
  init_mobile_exclusion();
  init_tab_position();
  init_styles();
  init_persist();
  init_reflow();
  init_handles();
  init_drawer_sync();
  init_panel_header_sync();
});

// src/resize/handles.ts
function isPointerResizeActive() {
  return window.matchMedia("(pointer: coarse)").matches;
}
function createResizeHandle(direction, onResize, onResizeEnd, enabled) {
  const handle = document.createElement("div");
  handle.className = "sidebar-ux-resize-handle";
  handle.style.cssText = `
    position: absolute;
    top: 0; bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 99999;
    touch-action: none;
    background: transparent;
    transition: background 0.15s ease;
  `;
  handle.addEventListener("mouseenter", () => {
    handle.style.background = "var(--lumiverse-primary-015, rgba(255, 255, 255, 0.06))";
  });
  handle.addEventListener("mouseleave", () => {
    if (!_resizeDragging)
      handle.style.background = "transparent";
  });
  let startX = 0;
  let startWidth = 0;
  handle.addEventListener("pointerdown", (e3) => {
    if (enabled && !enabled())
      return;
    e3.preventDefault();
    e3.stopPropagation();
    startX = e3.clientX;
    startWidth = handle.parentElement?.getBoundingClientRect().width || 420;
    _resizeDragging = true;
    handle.style.background = "var(--lumiverse-primary-020, rgba(255, 255, 255, 0.1))";
    let dragOverlay = null;
    const drawer = handle.closest(".sidebar-ux-drawer");
    const contentArea = drawer?.querySelector(".sidebar-ux-panel-content");
    if (contentArea) {
      dragOverlay = document.createElement("div");
      dragOverlay.style.cssText = `
        position: absolute;
        inset: 0;
        z-index: 99999;
        cursor: col-resize;
        pointer-events: auto;
        background: transparent;
      `;
      contentArea.appendChild(dragOverlay);
    }
    const onMove = (e4) => {
      const delta = direction === "right" ? e4.clientX - startX : startX - e4.clientX;
      onResize(startWidth, delta);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      _resizeDragging = false;
      handle.style.background = "transparent";
      dragOverlay?.remove();
      onResizeEnd();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  return handle;
}
function mountResizeHandles() {
  if (isPointerResizeActive())
    return;
  if (isMainMirrorActive()) {
    const mirrorDrawer = getMainMirrorDrawer();
    if (mirrorDrawer && !mirrorDrawer.querySelector(".sidebar-ux-resize-handle")) {
      const mainSide = getMainDrawerSide();
      const mainDirection = mainSide === "left" ? "right" : "left";
      const handle = createResizeHandle(mainDirection, (startWidth, delta) => {
        const newWidth = clampSidebarWidth(startWidth + delta);
        document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${newWidth}px`);
        scheduleReflow();
      }, () => {
        persistLayout();
      }, () => isCanvasMainOpen());
      handle.style.cssText += `
        ${mainSide === "left" ? "right" : "left"}: -4px;
      `;
      mirrorDrawer.appendChild(handle);
      applyTabListPosition(getSettings().moveControlsToOuterEdge, {
        mainDrawer: mirrorDrawer,
        mainTabList: mirrorDrawer.querySelector(".sidebar-ux-tab-list") ?? document.querySelector('.sidebar-ux-tab-list-pin-host[data-pin-owner="main"] .sidebar-ux-tab-list'),
        mainPanel: mirrorDrawer.querySelector(".sidebar-ux-panel")
      });
    }
  } else {
    const mainDrawer = getMainDrawer();
    if (mainDrawer && !mainDrawer.querySelector(".sidebar-ux-resize-handle")) {
      const mainSide = getMainDrawerSide();
      const mainDirection = mainSide === "left" ? "right" : "left";
      const handle = createResizeHandle(mainDirection, (startWidth, delta) => {
        const newWidth = clampSidebarWidth(startWidth + delta);
        const drawer = getMainDrawer();
        const wrapper = getMainWrapper();
        if (drawer) {
          drawer.style.width = `${newWidth}px`;
        }
        if (wrapper) {
          wrapper.style.setProperty("--drawer-panel-w", `${newWidth}px`, "important");
        }
        scheduleReflow();
      }, () => {
        const width = getMainDrawerWidth();
        persistLayout();
      }, () => isMainDrawerOpen());
      handle.style.cssText += `
        ${mainSide === "left" ? `left: calc(var(--drawer-panel-w, 420px) - 4px);` : `right: calc(var(--drawer-panel-w, 420px) - 4px);`}
      `;
      mainDrawer.appendChild(handle);
      applyTabListPosition(getSettings().moveControlsToOuterEdge, {
        mainDrawer,
        mainTabList: getMainSidebar()
      });
    }
  }
  const secondaryWrapper = getSecondaryWrapper();
  if (secondaryWrapper) {
    const secondaryDrawer = secondaryWrapper.querySelector(".sidebar-ux-drawer");
    if (secondaryDrawer && !secondaryDrawer.querySelector(".sidebar-ux-resize-handle")) {
      const mainSide = getMainDrawerSide();
      const secondarySide2 = mainSide === "left" ? "right" : "left";
      const secondaryDirection = secondarySide2 === "right" ? "left" : "right";
      const handle = createResizeHandle(secondaryDirection, (startWidth, delta) => {
        const newWidth = clampSidebarWidth(startWidth + delta);
        document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${newWidth}px`);
        scheduleReflow();
      }, () => {
        const width = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420;
        persistLayout();
      }, () => isSecondarySidebarOpen());
      handle.style.cssText += `
        ${secondarySide2 === "left" ? "right" : "left"}: -4px;
      `;
      secondaryDrawer.appendChild(handle);
      applyTabListPosition(getSettings().moveControlsToOuterEdge, {
        drawer: secondaryDrawer,
        tabList: secondaryDrawer.querySelector(".sidebar-ux-tab-list"),
        handle
      });
    }
  }
}
function refreshResizeHandles() {
  if (isPointerResizeActive())
    return;
  const mainDrawer = getMainDrawer();
  const existingMain = mainDrawer?.querySelector(".sidebar-ux-resize-handle");
  if (getSettings().resizeSidebars) {
    if (mainDrawer && !existingMain) {
      mountResizeHandles();
    }
  } else {
    if (existingMain)
      existingMain.remove();
  }
  const secondaryWrapper = getSecondaryWrapper();
  const secondaryDrawer = secondaryWrapper?.querySelector(".sidebar-ux-drawer");
  const existingSecondary = secondaryDrawer?.querySelector(".sidebar-ux-resize-handle");
  if (getSettings().resizeSidebars) {
    if (secondaryDrawer && !existingSecondary) {
      mountResizeHandles();
    }
  } else {
    if (existingSecondary)
      existingSecondary.remove();
  }
}
var _resizeDragging = false;
var init_handles = __esm(() => {
  init_store();
  init_reflow();
  init_secondary();
  init_main_mirror_drawer();
  init_persist();
  init_state();
  init_tab_position();
});

// src/sidebar/persist-polling.ts
function _cleanupDomPoll() {
  if (_domPollObserver) {
    _domPollObserver.disconnect();
    _domPollObserver = null;
  }
  if (_domPollTimer) {
    clearTimeout(_domPollTimer);
    _domPollTimer = null;
  }
}
function waitForDrawerDOM(stoppedRef, initObservers) {
  if (_domPollObserver || _domPollTimer)
    return;
  const initIfReady = () => {
    const drawer = getMainDrawer();
    if (!drawer || stoppedRef.value)
      return false;
    _cleanupDomPoll();
    dlog("main-persist: host DOM appeared, initializing observers");
    initObservers(drawer);
    return true;
  };
  if (initIfReady())
    return;
  _domPollObserver = new MutationObserver(() => {
    if (initIfReady()) {
      _domPollObserver?.disconnect();
      _domPollObserver = null;
    }
  });
  _domPollObserver.observe(document.body, { childList: true, subtree: true });
  _domPollTimer = setTimeout(() => {
    dlog("main-persist: DOM poll timed out; host drawer never appeared");
    _cleanupDomPoll();
  }, DOM_POLL_TIMEOUT_MS);
}
function cleanupDomPoll() {
  _cleanupDomPoll();
}
var DOM_POLL_TIMEOUT_MS = 5000, _domPollTimer = null, _domPollObserver = null;
var init_persist_polling = __esm(() => {
  init_log();
});

// src/sidebar/main-persist.ts
var exports_main_persist = {};
__export(exports_main_persist, {
  waitForDrawerDOM: () => waitForDrawerDOM,
  unsuppressMainDrawer: () => unsuppressMainDrawer,
  suppressMainDrawer: () => suppressMainDrawer,
  stopMainDrawerPersistence: () => stopMainDrawerPersistence,
  startMainDrawerPersistence: () => startMainDrawerPersistence,
  stampPanelBodyHide: () => stampPanelBodyHide,
  restoreMainDrawerFromDom: () => restoreMainDrawerFromDom,
  isMainDrawerRestorePending: () => isMainDrawerRestorePending,
  isHostPrimaryTabActive: () => isHostPrimaryTabActive,
  findDrawerToggleButton: () => findDrawerToggleButton,
  ensureRestoredPrimaryTab: () => ensureRestoredPrimaryTab,
  cleanupDomPoll: () => cleanupDomPoll,
  beginMainDrawerRestoreGuard: () => beginMainDrawerRestoreGuard
});
function readWrapperOpen(wrapper) {
  return wrapper.classList.toString().includes("wrapperOpen");
}
function readActiveTabId(sidebar) {
  const active = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
  if (!active)
    return null;
  return active.getAttribute("data-tab-id") || active.getAttribute("title") || null;
}
function ensureRestoreGuardStyles() {
  if (typeof document === "undefined")
    return;
  if (document.getElementById(RESTORE_GUARD_STYLE_ID))
    return;
  const el = document.createElement("style");
  el.id = RESTORE_GUARD_STYLE_ID;
  el.textContent = `
    html.${RESTORE_PENDING_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]),
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Panel bodies anywhere — host tree, parked in shell, or mid-reparent. */
    html.${RESTORE_PENDING_CLASS} [class*="_panelContent_"],
    html.${RESTORE_PENDING_CLASS} [data-canvas-main-panel-content],
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > * {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="main"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(el);
}
function isPanelBodyNode(el) {
  if (!(el instanceof HTMLElement))
    return false;
  const cls = String(el.className || "");
  if (cls.includes("_panelContent_"))
    return true;
  if (el.hasAttribute("data-canvas-main-panel-content"))
    return true;
  if (cls.includes("sidebar-ux-panel-content") && el.closest(".sidebar-ux-main-mirror-wrapper")) {
    return true;
  }
  return false;
}
function stampPanelBodyHide() {
  if (typeof document === "undefined")
    return;
  if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS))
    return;
  const nodes = document.querySelectorAll(PANEL_BODY_HIDE_SELECTOR);
  for (const node of Array.from(nodes)) {
    const el = node;
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("pointer-events", "none", "important");
  }
}
function clearPanelBodyHide() {
  if (typeof document === "undefined")
    return;
  const nodes = document.querySelectorAll(PANEL_BODY_HIDE_SELECTOR);
  for (const node of Array.from(nodes)) {
    const el = node;
    el.style.removeProperty("visibility");
    el.style.removeProperty("opacity");
    el.style.removeProperty("pointer-events");
  }
}
function scheduleStampPanelBodyHide() {
  if (_panelHideRaf != null)
    return;
  _panelHideRaf = requestAnimationFrame(() => {
    _panelHideRaf = null;
    stampPanelBodyHide();
  });
}
function startPanelHideObserver() {
  if (typeof document === "undefined" || _panelHideObserver)
    return;
  stampPanelBodyHide();
  _panelHideObserver = new MutationObserver((mutations) => {
    if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS))
      return;
    let needs = false;
    for (const m3 of mutations) {
      if (m3.type === "childList") {
        for (const n2 of Array.from(m3.addedNodes)) {
          if (n2 instanceof Element && (isPanelBodyNode(n2) || n2.querySelector?.('[class*="_panelContent_"], [data-canvas-main-panel-content]'))) {
            needs = true;
            break;
          }
        }
      }
      if (needs)
        break;
    }
    if (needs)
      scheduleStampPanelBodyHide();
  });
  _panelHideObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
function stopPanelHideObserver() {
  if (_panelHideObserver) {
    _panelHideObserver.disconnect();
    _panelHideObserver = null;
  }
  if (_panelHideRaf != null) {
    cancelAnimationFrame(_panelHideRaf);
    _panelHideRaf = null;
  }
}
function armUnsuppressTimeout() {
  if (_unsuppressTimer)
    clearTimeout(_unsuppressTimer);
  _unsuppressTimer = setTimeout(() => {
    unsuppressMainDrawer();
    dlog("main-persist: unsuppress timeout fired (restore may have failed)");
  }, UNSUPPRESS_TIMEOUT_MS);
}
function beginMainDrawerRestoreGuard() {
  ensureRestoreGuardStyles();
  document.documentElement.classList.add(RESTORE_PENDING_CLASS);
  startPanelHideObserver();
  stampPanelBodyHide();
  armUnsuppressTimeout();
}
function suppressMainDrawer() {
  beginMainDrawerRestoreGuard();
  stampPanelBodyHide();
}
function unsuppressMainDrawer() {
  if (_unsuppressTimer) {
    clearTimeout(_unsuppressTimer);
    _unsuppressTimer = null;
  }
  stopContentSettleWatch();
  stopPanelHideObserver();
  clearPanelBodyHide();
  document.documentElement.classList.remove(RESTORE_PENDING_CLASS);
}
function isMainDrawerRestorePending() {
  return typeof document !== "undefined" && document.documentElement.classList.contains(RESTORE_PENDING_CLASS);
}
function isHostPrimaryTabActive(targetTabId) {
  const sidebar = _sidebar || document.querySelector('[data-spindle-mount="sidebar"]');
  const active = sidebar?.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
  if (!active)
    return false;
  const id = active.getAttribute("data-tab-id") || "";
  const title = active.getAttribute("title") || "";
  if (id === targetTabId || title === targetTabId)
    return true;
  if (id && (targetTabId.endsWith(`:${id}`) || targetTabId.includes(`:tab:${id}`))) {
    return true;
  }
  return false;
}
function resolveMainPanelBody() {
  if (typeof document === "undefined")
    return null;
  const marked = document.querySelector("[data-canvas-main-panel-content]");
  if (marked)
    return marked;
  const shellPanel = document.querySelector('.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content [class*="_panelContent_"],' + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [data-canvas-main-panel-content]," + '.sidebar-ux-main-mirror-wrapper [class*="_panelContent_"]');
  if (shellPanel)
    return shellPanel;
  return document.querySelector('[class*="_panelContent_"]');
}
function stopContentSettleWatch() {
  if (_contentSettleObserver) {
    _contentSettleObserver.disconnect();
    _contentSettleObserver = null;
  }
  if (_contentQuietTimer != null) {
    clearTimeout(_contentQuietTimer);
    _contentQuietTimer = null;
  }
  if (_contentFallbackTimer != null) {
    clearTimeout(_contentFallbackTimer);
    _contentFallbackTimer = null;
  }
}
function resolveContentSettleRoot() {
  if (typeof document === "undefined")
    return null;
  const shellSlot = document.querySelector(".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content");
  if (shellSlot)
    return shellSlot;
  const panel = resolveMainPanelBody();
  if (panel?.parentElement instanceof HTMLElement)
    return panel.parentElement;
  return panel;
}
function startContentSettleWatch(onSettled) {
  stopContentSettleWatch();
  let settled = false;
  const settle = (reason) => {
    if (settled)
      return;
    settled = true;
    stopContentSettleWatch();
    onSettled(reason);
  };
  const root = resolveContentSettleRoot();
  if (!root) {
    _contentFallbackTimer = setTimeout(() => settle("fallback"), RESTORE_CONTENT_FALLBACK_MS);
    return;
  }
  let sawMutation = false;
  _contentSettleObserver = new MutationObserver(() => {
    if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS))
      return;
    sawMutation = true;
    if (_contentQuietTimer != null)
      clearTimeout(_contentQuietTimer);
    if (_contentFallbackTimer != null) {
      clearTimeout(_contentFallbackTimer);
      _contentFallbackTimer = null;
    }
    _contentQuietTimer = setTimeout(() => settle("mutation-quiet"), RESTORE_CONTENT_QUIET_MS);
    stampPanelBodyHide();
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
      m3.ensureHostContentParkedPublic();
    }).catch(() => {});
  });
  _contentSettleObserver.observe(root, { childList: true, subtree: true });
  _contentFallbackTimer = setTimeout(() => {
    if (!sawMutation)
      settle("fallback");
  }, RESTORE_CONTENT_FALLBACK_MS);
}
function clickRestoredPrimaryTab(targetTabId, preferMirror) {
  if (!targetTabId)
    return false;
  const sidebar = _sidebar || document.querySelector('[data-spindle-mount="sidebar"]');
  let tabBtn = sidebar?.querySelector(`button[data-tab-id="${CSS.escape(targetTabId)}"]`);
  if (!tabBtn) {
    tabBtn = sidebar?.querySelector(`button[title="${CSS.escape(targetTabId)}"]`);
  }
  if (!tabBtn && targetTabId.includes(":")) {
    const bare = targetTabId.replace(/:\d+$/, "").split(":").pop();
    if (bare) {
      tabBtn = sidebar?.querySelector(`button[data-tab-id="${CSS.escape(bare)}"]`);
    }
  }
  if (preferMirror || document.documentElement.classList.contains("sidebar-ux-canvas-main-active")) {
    Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => {
      const title = tabBtn?.getAttribute("title") || tabBtn?.getAttribute("aria-label") || targetTabId;
      m3.activateMainMirrorFromRestore(tabBtn, title);
    }).catch((err) => {
      dlog(`main-persist restore: activateMainMirrorFromRestore failed: ${err}`);
      if (tabBtn) {
        try {
          tabBtn.click();
        } catch {}
      }
    });
    if (tabBtn || document.querySelector(".sidebar-ux-main-tab-mirror-btn")) {
      return true;
    }
  }
  if (!tabBtn) {
    dlog(`main-persist restore: no button for tabId="${targetTabId}"`);
    return false;
  }
  try {
    tabBtn.click();
    return true;
  } catch (err) {
    dlog(`main-persist restore: tab click threw: ${err}`);
    return false;
  }
}
function scheduleRestoreTabThenUnsuppress(targetTabId, preferMirror, fallbackClickFirstHostTab = false) {
  const run = () => {
    if (_stopped) {
      unsuppressMainDrawer();
      return;
    }
    let mirrorMod = null;
    let mirrorLoaded = false;
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
      mirrorMod = m3;
      mirrorLoaded = true;
      m3.ensureHostContentParkedPublic();
    }).catch(() => {});
    const reparkIfNeeded = () => {
      if (mirrorLoaded && mirrorMod) {
        mirrorMod.ensureHostContentParkedPublic();
      }
    };
    const isMirrorMode = preferMirror || document.documentElement.classList.contains("sidebar-ux-canvas-main-active");
    if (!isMirrorMode) {
      stampPanelBodyHide();
    }
    if (targetTabId) {
      if (!isHostPrimaryTabActive(targetTabId)) {
        clickRestoredPrimaryTab(targetTabId, preferMirror);
      }
    } else if (fallbackClickFirstHostTab) {
      const sidebar = _sidebar || document.querySelector('[data-spindle-mount="sidebar"]');
      const first = sidebar?.querySelector('button[class*="tabBtn"]');
      if (first) {
        try {
          first.click();
        } catch (err) {
          dlog(`main-persist restore: first-tab click threw: ${err}`);
        }
      }
    }
    let polls = 0;
    let stable = 0;
    let contentSettled = false;
    let watchingContent = false;
    let finished = false;
    const finish = (reason) => {
      if (finished)
        return;
      finished = true;
      stopContentSettleWatch();
      if (!isMirrorMode) {
        stampPanelBodyHide();
      }
      dlog(`main-persist restore: unsuppress (${reason})`);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          unsuppressMainDrawer();
        });
      });
    };
    const tryFinish = () => {
      if (finished)
        return;
      if (!targetTabId) {
        finish("no-target-tab");
        return;
      }
      if (stable >= RESTORE_HOST_STABLE_POLLS && contentSettled) {
        finish("host-active+content-settled");
      }
    };
    const beginContentWatch = () => {
      if (watchingContent || finished)
        return;
      watchingContent = true;
      reparkIfNeeded();
      if (!isMirrorMode) {
        stampPanelBodyHide();
      }
      startContentSettleWatch((settleReason) => {
        contentSettled = true;
        dlog(`main-persist restore: content settled (${settleReason})`);
        tryFinish();
      });
    };
    const poll = () => {
      if (_stopped) {
        unsuppressMainDrawer();
        return;
      }
      if (finished)
        return;
      if (!targetTabId) {
        finish("no-target-tab");
        return;
      }
      if (isHostPrimaryTabActive(targetTabId)) {
        stable++;
        if (stable === 1) {
          beginContentWatch();
        }
        tryFinish();
        if (finished)
          return;
      } else {
        stable = 0;
        contentSettled = false;
        watchingContent = false;
        stopContentSettleWatch();
        if (polls % 3 === 0) {
          clickRestoredPrimaryTab(targetTabId, preferMirror);
          reparkIfNeeded();
        }
      }
      polls++;
      if (polls >= RESTORE_TAB_POLL_MAX) {
        clickRestoredPrimaryTab(targetTabId, preferMirror);
        finish(contentSettled ? "poll-max-content-ok" : "poll-max");
        return;
      }
      setTimeout(poll, RESTORE_TAB_POLL_MS);
    };
    requestAnimationFrame(() => poll());
  };
  if (RESTORE_TAB_CLICK_MS > 0) {
    setTimeout(run, RESTORE_TAB_CLICK_MS);
  } else {
    run();
  }
}
function findDrawerToggleButton(wrapper) {
  const buttons = wrapper.querySelectorAll(":scope > button");
  for (const btn of buttons) {
    if (/drawerTab/i.test(btn.className)) {
      return btn;
    }
  }
  return null;
}
function pushCurrentState() {
  if (!_wrapper)
    return;
  const canvasMain = !!getSettings().keepTabListVisible && typeof window !== "undefined" && window.innerWidth > 600;
  const open = canvasMain ? document.documentElement.classList.contains("sidebar-ux-canvas-main-open") : readWrapperOpen(_wrapper);
  const tabId = _sidebar ? readActiveTabId(_sidebar) : null;
  if (open === _lastSeenOpen && tabId === _lastSeenTabId)
    return;
  _lastSeenOpen = open;
  _lastSeenTabId = tabId;
  setMainDrawerState(open, tabId);
  if (!canvasMain || tabId !== null) {
    persistOpenState();
  }
}
function _initObservers(drawer) {
  let wrapper = drawer;
  const parent = drawer.parentElement;
  if (parent && parent.classList.toString().match(/wrapper/i)) {
    wrapper = parent;
  }
  const grandparent = parent?.parentElement;
  if (grandparent && grandparent.classList.toString().match(/wrapper/i)) {
    wrapper = grandparent;
  }
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
  _wrapper = wrapper;
  _sidebar = sidebar;
  _lastSeenOpen = readWrapperOpen(wrapper);
  _lastSeenTabId = sidebar ? readActiveTabId(sidebar) : null;
  suppressMainDrawer();
  setMainDrawerState(_lastSeenOpen, _lastSeenTabId);
  _classObserver = new MutationObserver((mutations) => {
    if (_stopped)
      return;
    for (const m3 of mutations) {
      if (m3.type === "attributes" && m3.attributeName === "class") {
        pushCurrentState();
        if (wrapper) {
          const isOpen = readWrapperOpen(wrapper);
          enforceExclusionOnOpen("primary");
          setMobileOpenClass("primary", isOpen);
        }
        break;
      }
    }
  });
  _classObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
  if (sidebar) {
    _tabObserver = new MutationObserver((mutations) => {
      if (_stopped)
        return;
      for (const m3 of mutations) {
        if (m3.type === "attributes" && m3.attributeName === "class") {
          const target = m3.target;
          if (target.className && /tabBtn/.test(target.className)) {
            pushCurrentState();
            break;
          }
        } else if (m3.type === "childList") {
          pushCurrentState();
          break;
        }
      }
    });
    _tabObserver.observe(sidebar, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true
    });
  }
  let mountedAt = Date.now();
  _resizeObserver = new ResizeObserver(() => {
    if (_stopped)
      return;
    if (Date.now() - mountedAt < MOUNT_QUIET_MS)
      return;
    if (_resizeDebounce)
      clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => {
      if (_stopped)
        return;
      persistLayout();
    }, RESIZE_DEBOUNCE_MS);
  });
  _resizeObserver.observe(wrapper);
}
function startMainDrawerPersistence() {
  if (!_stopped)
    return;
  _stopped = false;
  const drawer = getMainDrawer();
  if (!drawer) {
    waitForDrawerDOM({ get value() {
      return _stopped;
    } }, _initObservers);
    return;
  }
  _initObservers(drawer);
}
function ensureRestoredPrimaryTab(targetTabId) {
  if (!targetTabId || _stopped)
    return;
  const keepVisible = !!getSettings().keepTabListVisible;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  clickRestoredPrimaryTab(targetTabId, keepVisible && !isMobile);
}
function restoreMainDrawerFromDom(targetOpen, targetTabId, targetWidthPx, opts) {
  if (_stopped)
    return;
  const restoreOpen = opts?.restoreOpen !== false;
  const restoreWidth = opts?.restoreWidth !== false;
  const drawer = getMainDrawer();
  const wrapper = _wrapper || drawer;
  if (!wrapper) {
    dlog("main-persist restore: no wrapper in DOM, cannot restore");
    unsuppressMainDrawer();
    return;
  }
  const clampedWidth = restoreWidth && typeof targetWidthPx === "number" && targetWidthPx > 0 ? clampSidebarWidth(targetWidthPx) : null;
  const keepVisible = !!getSettings().keepTabListVisible;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  if (keepVisible && !isMobile) {
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
      if (_stopped) {
        unsuppressMainDrawer();
        return;
      }
      if (clampedWidth !== null) {
        m3.applyMainMirrorRestoredWidth(clampedWidth);
      }
      if (!restoreOpen) {
        unsuppressMainDrawer();
        return;
      }
      if (targetOpen) {
        m3.openCanvasMainDrawer();
        scheduleRestoreTabThenUnsuppress(targetTabId, true);
      } else {
        m3.closeCanvasMainDrawer();
        unsuppressMainDrawer();
      }
    });
    return;
  }
  if (!restoreOpen) {
    const currentOpen2 = readWrapperOpen(wrapper);
    if (currentOpen2 && clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`;
        wrapper.style.setProperty("--drawer-panel-w", `${clampedWidth}px`, "important");
      }
    }
    unsuppressMainDrawer();
    return;
  }
  const currentOpen = readWrapperOpen(wrapper);
  if (currentOpen === targetOpen) {
    if (targetOpen && clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`;
        wrapper.style.setProperty("--drawer-panel-w", `${clampedWidth}px`, "important");
      }
    }
    if (targetOpen) {
      scheduleRestoreTabThenUnsuppress(targetTabId, false);
    } else {
      unsuppressMainDrawer();
    }
    return;
  }
  if (targetOpen) {
    if (clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`;
        wrapper.style.setProperty("--drawer-panel-w", `${clampedWidth}px`, "important");
      }
    }
    scheduleRestoreTabThenUnsuppress(targetTabId, false, true);
  } else {
    const toggleBtn = findDrawerToggleButton(wrapper);
    if (toggleBtn) {
      try {
        toggleBtn.click();
      } catch (err) {
        dlog(`main-persist restore: toggleBtn.click() threw: ${err}`);
      }
    }
    unsuppressMainDrawer();
  }
}
function stopMainDrawerPersistence() {
  if (_stopped)
    return;
  _stopped = true;
  if (_classObserver) {
    _classObserver.disconnect();
    _classObserver = null;
  }
  if (_tabObserver) {
    _tabObserver.disconnect();
    _tabObserver = null;
  }
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  if (_resizeDebounce) {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = null;
  }
  cleanupDomPoll();
  unsuppressMainDrawer();
  document.getElementById(RESTORE_GUARD_STYLE_ID)?.remove();
  _wrapper = null;
  _sidebar = null;
  _lastSeenOpen = null;
  _lastSeenTabId = null;
}
var RESIZE_DEBOUNCE_MS = 300, MOUNT_QUIET_MS = 500, UNSUPPRESS_TIMEOUT_MS = 3000, RESTORE_TAB_CLICK_MS = 0, RESTORE_PENDING_CLASS = "sidebar-ux-main-restore-pending", RESTORE_GUARD_STYLE_ID = "sidebar-ux-main-restore-guard", RESTORE_HOST_STABLE_POLLS = 2, RESTORE_CONTENT_QUIET_MS = 40, RESTORE_CONTENT_FALLBACK_MS = 50, _wrapper = null, _sidebar = null, _classObserver = null, _tabObserver = null, _resizeObserver = null, _resizeDebounce = null, _stopped = true, _lastSeenOpen = null, _lastSeenTabId = null, _unsuppressTimer = null, _panelHideObserver = null, _panelHideRaf = null, _contentSettleObserver = null, _contentQuietTimer = null, _contentFallbackTimer = null, PANEL_BODY_HIDE_SELECTOR, RESTORE_TAB_POLL_MAX = 50, RESTORE_TAB_POLL_MS = 16;
var init_main_persist = __esm(() => {
  init_persist();
  init_state();
  init_log();
  init_handles();
  init_mobile_exclusion();
  init_persist_polling();
  init_persist_polling();
  PANEL_BODY_HIDE_SELECTOR = '[class*="_panelContent_"],' + "[data-canvas-main-panel-content]," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *";
});

// src/sidebar/mobile-exclusion.ts
function syncCssVarToDrawerWidth() {
  const el = document.documentElement;
  if (isMobileViewport()) {
    const current = parseFloat(el.style.getPropertyValue(SECONDARY_WIDTH_VAR));
    if (isFinite(current) && _desktopCssVarValue === null) {
      _desktopCssVarValue = current;
    }
    const drawer = getSecondaryDrawer();
    const measured = drawer?.offsetWidth ?? 0;
    if (measured > 0) {
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${measured}px`);
    } else {
      const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lumiverse-ui-scale")) || 1;
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${Math.round(window.innerWidth / uiScale)}px`);
    }
  } else {
    if (_desktopCssVarValue !== null) {
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${_desktopCssVarValue}px`);
      _desktopCssVarValue = null;
    } else {
      el.style.removeProperty(SECONDARY_WIDTH_VAR);
    }
  }
}
function isMobileViewport() {
  return window.matchMedia("(max-width: 600px)").matches;
}
function _logDiag(event) {
  const now = Date.now();
  if (now - _lastDiagLog < DIAG_THROTTLE_MS)
    return;
  _lastDiagLog = now;
  dlog(`mobile-exclusion ${event} | innerWidth=${window.innerWidth} ` + `isMobile=${isMobileViewport()} ` + `sidebarOpen=${isSecondarySidebarOpen()} ` + `cssVar=${document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)} ` + `transform=${getSecondaryWrapper()?.style.transform ?? "null"}`);
}
function setMobileOpenClass(which, open) {
  if (!isMobileViewport()) {
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
    return;
  }
  if (open) {
    document.body.classList.add(which === "primary" ? BODY_CLASS_PRIMARY : BODY_CLASS_SECONDARY);
  } else {
    document.body.classList.remove(which === "primary" ? BODY_CLASS_PRIMARY : BODY_CLASS_SECONDARY);
  }
}
function _closeMainDrawer() {
  const wrapper = getMainWrapper();
  if (!wrapper)
    return;
  if (!wrapper.classList.toString().includes("wrapperOpen"))
    return;
  const btn = findDrawerToggleButton(wrapper);
  if (btn) {
    try {
      btn.click();
    } catch {}
  }
}
function enforceExclusionOnOpen(which) {
  if (!isMobileViewport())
    return;
  if (which === "secondary") {
    _closeMainDrawer();
  } else {
    syncCssVarToDrawerWidth();
    if (isSecondarySidebarOpen()) {
      closeSecondarySidebar({ silent: true });
    }
  }
}
function startMobileExclusion() {
  _mediaQuery2 = window.matchMedia("(max-width: 600px)");
  function _updateDrawerWidth() {
    cancelWrapperAnimation();
    const wrapper2 = getSecondaryWrapper();
    const drawer = wrapper2?.querySelector(".sidebar-ux-drawer");
    if (!drawer)
      return;
    if (isMobileViewport()) {
      drawer.style.width = "calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)";
    } else {
      drawer.style.width = `var(${SECONDARY_WIDTH_VAR}, 420px)`;
    }
    syncCssVarToDrawerWidth();
    if (wrapper2) {
      const closedPx = getClosedTransformPx();
      wrapper2.style.transform = isSecondarySidebarOpen() ? "translateX(0)" : `translateX(${closedPx}px)`;
    }
  }
  _onMediaChange2 = (e3) => {
    if (e3.matches) {
      _updateDrawerWidth();
      if (isSecondarySidebarOpen()) {
        closeSecondarySidebar({ silent: true });
        setMobileOpenClass("secondary", false);
      }
      const wrapper2 = getMainWrapper();
      if (wrapper2) {
        const isOpen = wrapper2.classList.toString().includes("wrapperOpen");
        setMobileOpenClass("primary", isOpen);
      }
      Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
      Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => m3.reconcileMainTabListPin());
    } else {
      _updateDrawerWidth();
      document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
      Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
      Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => m3.reconcileMainTabListPin());
    }
    Promise.resolve().then(() => (init_buttons(), exports_buttons)).then((m3) => m3.updateDrawerTabVisibility());
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => m3.updateMainMirrorDrawerTabVisibility());
  };
  _mediaQuery2.addEventListener("change", _onMediaChange2);
  const _onResize = () => {
    if (!isMobileViewport())
      return;
    if (_resizeRafId !== null)
      return;
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = null;
      _logDiag("resize-tick");
      _updateDrawerWidth();
    });
  };
  window.addEventListener("resize", _onResize);
  if (isMobileViewport()) {
    _updateDrawerWidth();
  }
  if (isMobileViewport() && isSecondarySidebarOpen()) {
    closeSecondarySidebar({ silent: true });
    setMobileOpenClass("secondary", false);
  }
  const wrapper = getMainWrapper();
  if (wrapper) {
    const isOpen = wrapper.classList.toString().includes("wrapperOpen");
    setMobileOpenClass("primary", isOpen);
  }
  return () => {
    if (_resizeRafId !== null) {
      cancelAnimationFrame(_resizeRafId);
      _resizeRafId = null;
    }
    window.removeEventListener("resize", _onResize);
    if (_mediaQuery2 && _onMediaChange2) {
      _mediaQuery2.removeEventListener("change", _onMediaChange2);
    }
    _mediaQuery2 = null;
    _onMediaChange2 = null;
    document.getElementById("canvas-ux-secondary-mobile")?.remove();
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
  };
}
var _desktopCssVarValue = null, _resizeRafId = null, _lastDiagLog = 0, DIAG_THROTTLE_MS = 500, BODY_CLASS_PRIMARY = "canvas-ux-mobile-primary-open", BODY_CLASS_SECONDARY = "canvas-ux-mobile-secondary-open", _mediaQuery2 = null, _onMediaChange2 = null;
var init_mobile_exclusion = __esm(() => {
  init_log();
  init_main_persist();
  init_secondary();
  init_animation();
});

// src/chat/reflow.ts
function setChatMargin(side, px) {
  const chat = getChatColumn();
  if (!chat)
    return;
  const varName = side === "left" ? "--sidebar-ux-chat-ml" : "--sidebar-ux-chat-mr";
  chat.style.setProperty(varName, `${px}px`);
}
function clearChatMargins() {
  const chat = getChatColumn();
  if (chat) {
    chat.style.removeProperty("--sidebar-ux-chat-ml");
    chat.style.removeProperty("--sidebar-ux-chat-mr");
  }
  const root = document.documentElement;
  root.style.removeProperty("--sidebar-ux-chat-ml");
  root.style.removeProperty("--sidebar-ux-chat-mr");
}
function injectReflowStyles() {
  injectStyles("sidebar-ux-reflow", `
    [class*="_chatColumn_"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    @media (max-width: 600px) {
      [class*="_chatColumn_"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
        transition: none !important;
      }
    }
  `);
}
function computeContentLaneInsets() {
  if (isMobileViewport()) {
    return { left: 0, right: 0 };
  }
  const mainSide = getMainDrawerSide();
  let mainWidth;
  if (isMainMirrorActive()) {
    if (isCanvasMainOpen()) {
      mainWidth = parseFloat(document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR)) || 420;
    } else {
      mainWidth = TAB_LIST_WIDTH_PX;
    }
  } else {
    const mainOpen = isMainDrawerOpen();
    mainWidth = mainOpen ? getMainDrawerWidth() : 0;
    if (mainWidth === 0 && isKeepTabListVisibleEnabled()) {
      mainWidth = TAB_LIST_WIDTH_PX;
    }
  }
  let secondaryWidth = isSecondarySidebarOpen() ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420 : 0;
  if (secondaryWidth === 0 && isKeepTabListVisibleEnabled() && getSecondaryTabList()) {
    secondaryWidth = TAB_LIST_WIDTH_PX;
  }
  const dockInsets = getDockInsets2();
  let rightMargin;
  let leftMargin;
  if (mainSide === "left") {
    rightMargin = secondaryWidth;
    leftMargin = mainWidth;
  } else {
    rightMargin = mainWidth;
    leftMargin = secondaryWidth;
  }
  rightMargin = Math.max(0, rightMargin - dockInsets.right);
  leftMargin = Math.max(0, leftMargin - dockInsets.left);
  return { left: leftMargin, right: rightMargin };
}
function publishContentLaneInsets() {
  const insets = computeContentLaneInsets();
  const root = document.documentElement;
  root.style.setProperty(CONTENT_INSET_L_VAR, `${insets.left}px`);
  root.style.setProperty(CONTENT_INSET_R_VAR, `${insets.right}px`);
}
function scheduleReflow() {
  if (_reflowRaf !== null) {
    return;
  }
  _reflowRaf = requestAnimationFrame(() => {
    _reflowRaf = null;
    updateChatReflow();
  });
}
function getDockInsets2() {
  const appEl = document.querySelector("[data-app-root]");
  if (!appEl)
    return { left: 0, right: 0 };
  const left = parseFloat(appEl.style.getPropertyValue("--spindle-dock-left")) || 0;
  const right = parseFloat(appEl.style.getPropertyValue("--spindle-dock-right")) || 0;
  return { left, right };
}
function updateChatReflow() {
  if (isMobileViewport()) {
    clearChatMargins();
    publishContentLaneInsets();
    return;
  }
  const insets = computeContentLaneInsets();
  setChatMargin("right", insets.right);
  setChatMargin("left", insets.left);
  publishContentLaneInsets();
}
function _onMediaChangeImpl(e3) {
  if (e3.matches) {
    clearChatMargins();
    publishContentLaneInsets();
  } else {
    updateChatReflow();
  }
}
function startReflowObserver() {
  injectReflowStyles();
  let cancelled = false;
  const observer = new MutationObserver(() => {
    scheduleReflow();
  });
  waitForElement(getMainWrapper, "main wrapper").then((wrapper) => {
    if (wrapper && !cancelled) {
      observer.observe(wrapper, { attributes: true, attributeFilter: ["class", "style"] });
      updateChatReflow();
    }
  });
  const appEl = document.querySelector("[data-app-root]");
  if (appEl && !cancelled) {
    observer.observe(appEl, { attributes: true, attributeFilter: ["style"] });
  }
  let _chatObserver = null;
  const _appElForChat = document.querySelector("[data-app-root]");
  if (_appElForChat && !cancelled) {
    _chatObserver = new MutationObserver(() => {
      if (!cancelled && getChatColumn()) {
        scheduleReflow();
      }
    });
    _chatObserver.observe(_appElForChat, { childList: true, subtree: true });
    if (getChatColumn()) {
      scheduleReflow();
    }
  }
  const stopTagObserver = startTagObserver();
  _mediaQuery3 = window.matchMedia("(max-width: 600px)");
  _onMediaChange3 = _onMediaChangeImpl;
  _mediaQuery3.addEventListener("change", _onMediaChange3);
  return () => {
    cancelled = true;
    observer.disconnect();
    _chatObserver?.disconnect();
    _chatObserver = null;
    if (_reflowRaf !== null) {
      cancelAnimationFrame(_reflowRaf);
      _reflowRaf = null;
    }
    stopTagObserver();
    if (_mediaQuery3 && _onMediaChange3) {
      _mediaQuery3.removeEventListener("change", _onMediaChange3);
    }
    _mediaQuery3 = null;
    _onMediaChange3 = null;
  };
}
var CONTENT_INSET_L_VAR = "--sidebar-ux-content-inset-l", CONTENT_INSET_R_VAR = "--sidebar-ux-content-inset-r", _reflowRaf = null, _mediaQuery3 = null, _onMediaChange3 = null;
var init_reflow = __esm(() => {
  init_store();
  init_secondary();
  init_tag_buttons();
  init_wait_for();
  init_mobile_exclusion();
  init_state();
  init_styles();
  init_main_mirror_drawer();
});

// src/sidebar/secondary.tsx
function syncPanelHeaderFromMain2() {
  syncPanelHeaderFromMain(() => _secondaryWrapper);
}
function getSecondaryWrapper() {
  return _secondaryWrapper;
}
function getSecondaryDrawer() {
  return _secondaryWrapper?.querySelector(".sidebar-ux-drawer");
}
function getSecondaryTabList() {
  if (!_secondaryWrapper)
    return null;
  const inWrapper = _secondaryWrapper.querySelector(".sidebar-ux-tab-list");
  if (inWrapper)
    return inWrapper;
  return getPinnedTabList();
}
function getSecondaryPanel() {
  return _secondaryWrapper?.querySelector(".sidebar-ux-panel");
}
function isSecondarySidebarOpen() {
  return _secondarySidebarOpen;
}
function unmountSecondarySidebar() {
  applyTabListPin(false, { force: true });
  if (_secondaryWrapper) {
    _secondaryWrapper.remove();
    _secondaryWrapper = null;
  }
  _secondarySidebarOpen = false;
  stopPanelHeaderObservers();
  resetPanelHeaderSyncCache();
}
function createSecondarySidebar(options) {
  const side = getMainDrawerSide() === "left" ? "right" : "left";
  const onMobile = isMobileViewport();
  const shell = createDrawerShell({
    owner: "secondary",
    side,
    widthCssVar: SECONDARY_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: options?.initialWidth,
    initialOpen: options?.initialOpen === true,
    fullViewportWidth: onMobile,
    title: "Second drawer",
    drawerTabDisplay: "none",
    onDrawerTabClick: () => {
      if (_secondarySidebarOpen)
        closeSecondarySidebar();
      else
        openSecondarySidebar();
    },
    onHeaderClose: () => closeSecondarySidebar()
  });
  try {
    const wSpindle = getHostBridge();
    const wContainers = wSpindle?.containers;
    if (wContainers?.registerContainer) {
      wContainers.registerContainer({
        id: "canvas-secondary-drawer",
        side,
        element: shell.content
      });
    } else {
      dwarn(`[tabmove] createSecondarySidebar: registerContainer SKIPPED — ` + `window.spindle.containers.registerContainer not available. ` + `Built-in tab moves will silently fail (ContainerTabContent Pass 3 resets to main-drawer).`);
    }
  } catch (err) {
    dwarn(`[tabmove] createSecondarySidebar: registerContainer THREW:`, err);
  }
  _secondaryDrawer = shell.drawer;
  return shell.wrapper;
}
function openSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer)
    return;
  if (_secondarySidebarOpen)
    return;
  enforceExclusionOnOpen("secondary");
  animateWrapper(_secondaryWrapper, 0);
  _secondarySidebarOpen = true;
  _secondaryWrapper.dataset.drawerOpen = "true";
  syncDrawerTabSettings();
  updateDrawerTabVisibility();
  syncPanelHeaderFromMain2();
  updateChatReflow();
  Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer)).then(({ assignToSecondary: assignToSecondary2 }) => {
    setSuppressAutoActivation(true);
    const promises = Array.from(getTabAssignments()).filter(([, side]) => side === "secondary").map(([tabId]) => assignToSecondary2(tabId).catch(() => {}));
    Promise.all(promises).finally(() => setSuppressAutoActivation(false));
  });
  persistOpenState();
  setMobileOpenClass("secondary", true);
}
function closeSecondarySidebar(options) {
  if (!_secondaryWrapper || !_secondaryDrawer)
    return;
  animateWrapper(_secondaryWrapper, getClosedTransformPx());
  _secondarySidebarOpen = false;
  _secondaryWrapper.dataset.drawerOpen = "false";
  syncDrawerTabSettings();
  updateDrawerTabVisibility();
  syncPanelHeaderFromMain2();
  updateChatReflow();
  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar === "secondary") {
      const tabs = getDrawerTabs();
      const tab = tabs.find((t3) => t3.id === tabId);
      if (tab?.root)
        tab.root.removeAttribute("data-canvas-active");
    }
  }
  const tabList = getSecondaryTabList();
  if (tabList) {
    for (const btn of tabList.querySelectorAll("button.sidebar-ux-tab-active")) {
      btn.classList.remove("sidebar-ux-tab-active");
    }
  }
  if (!options?.silent) {
    persistOpenState();
  }
  setMobileOpenClass("secondary", false);
}
function getClosedTransformPx() {
  const secondarySide2 = getMainDrawerSide() === "left" ? "right" : "left";
  const measured = getSecondaryDrawer()?.offsetWidth ?? 0;
  const fromVar = Math.ceil(readWidthCssVar(SECONDARY_WIDTH_VAR, 420));
  const w3 = Math.max(measured, fromVar);
  return closedTransformPx(secondarySide2, w3);
}
function mountSecondarySidebar(options) {
  if (_secondaryWrapper)
    return;
  _secondaryWrapper = createSecondarySidebar(options);
  document.body.appendChild(_secondaryWrapper);
  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _secondaryWrapper.querySelector(".sidebar-ux-drawer"),
    tabList: _secondaryWrapper.querySelector(".sidebar-ux-tab-list"),
    handle: _secondaryWrapper.querySelector(".sidebar-ux-resize-handle")
  });
  reconcileTabListPin();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true;
  }
  syncDrawerTabSettings();
  syncPanelHeaderFromMain2();
  mountResizeHandles();
}
function tearDownSecondarySidebar() {
  applyTabListPin(false, { force: true });
  if (_secondaryWrapper) {
    const sidebar = getMainSidebar();
    if (sidebar) {
      const fallbackBtn = findSafeFallbackButton(sidebar);
      if (fallbackBtn) {
        for (const [tabId, side] of getTabAssignments()) {
          if (side === "secondary" && isTabActiveInMainDrawer(tabId)) {
            fallbackBtn.click();
            break;
          }
        }
      }
    }
    const _wSpindleUi = getHostBridge()?.ui;
    const _mainPanelContent = getMainPanelContent();
    for (const [tabId] of Array.from(getTabAssignments())) {
      const _isBuiltIn = _wSpindleUi?.getBuiltInTabRoot?.(tabId) != null;
      if (_isBuiltIn && _wSpindleUi?.requestTabLocation) {
        try {
          _wSpindleUi.requestTabLocation(tabId, { kind: "main-drawer" });
        } catch (err) {
          dwarn(`[tabmove] teardown: requestTabLocation failed for tabId=${tabId}:`, err);
        }
      }
      if (!_isBuiltIn) {
        const _movedRoot = _secondaryWrapper?.querySelector(`.sidebar-ux-panel-content [data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`);
        if (_movedRoot && _mainPanelContent && _movedRoot.parentElement !== _mainPanelContent) {
          _mainPanelContent.appendChild(_movedRoot);
        }
        if (_movedRoot) {
          _movedRoot.removeAttribute("data-canvas-moved");
          _movedRoot.removeAttribute("data-canvas-active");
          _movedRoot.style.removeProperty("position");
          _movedRoot.style.removeProperty("inset");
          _movedRoot.style.removeProperty("display");
        }
      }
      showMainTabButton(tabId);
    }
    clearTabAssignments();
    try {
      const wContainers = getHostBridge()?.containers;
      wContainers?.unregisterContainer?.("canvas-secondary-drawer");
    } catch (err) {
      dwarn("[tabmove] teardown: unregisterContainer failed:", err);
    }
    _secondaryWrapper.remove();
    _secondaryWrapper = null;
  }
  _secondarySidebarOpen = false;
  setMobileOpenClass("secondary", false);
  updateChatReflow();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
  const handles = document.querySelectorAll(".sidebar-ux-resize-handle");
  for (const h4 of Array.from(handles)) {
    if (h4.parentElement && h4.parentElement.classList.contains("sidebar-ux-drawer")) {
      h4.remove();
    }
  }
  stopPanelHeaderObservers();
  resetPanelHeaderSyncCache();
}
var PUZZLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>`, _secondarySidebarOpen = false, _secondaryWrapper = null, _secondaryDrawer = null;
var init_secondary = __esm(() => {
  init_store();
  init_reflow();
  init_drawer_sync();
  init_handles();
  init_assignment();
  init_buttons();
  init_persist();
  init_mobile_exclusion();
  init_animation();
  init_styles();
  init_tab_position();
  init_state();
  init_log();
  init_panel_header_sync();
  init_secondary_drawer();
  init_drawer_shell();
  init_styles();
  init_animation();
});

// src/layout/parse-layout.ts
function isPlainObject(v3) {
  return typeof v3 === "object" && v3 !== null && !Array.isArray(v3);
}
function parseLayoutBlob(input) {
  if (!isPlainObject(input)) {
    dlog("parseLayoutBlob: top-level is not an object");
    return null;
  }
  const out = {
    detachedTabs: []
  };
  if (typeof input.version === "string")
    out.version = input.version;
  if ("settings" in input)
    out.settings = input.settings;
  if (isPlainObject(input.primary)) {
    const p3 = input.primary;
    const primary = {};
    if (typeof p3.open === "boolean")
      primary.open = p3.open;
    if (typeof p3.width === "number" && isFinite(p3.width))
      primary.width = p3.width;
    if (p3.tabId === null || typeof p3.tabId === "string")
      primary.tabId = p3.tabId;
    out.primary = primary;
  }
  if (isPlainObject(input.secondary)) {
    const s3 = input.secondary;
    const secondary = {};
    if (typeof s3.open === "boolean")
      secondary.open = s3.open;
    if (typeof s3.width === "number" && isFinite(s3.width))
      secondary.width = s3.width;
    if (s3.activeTabId === null || typeof s3.activeTabId === "string") {
      secondary.activeTabId = s3.activeTabId;
    }
    out.secondary = secondary;
  }
  if (Array.isArray(input.detachedTabs)) {
    for (const row of input.detachedTabs) {
      if (!isPlainObject(row)) {
        dlog("parseLayoutBlob: dropping non-object detachedTabs entry");
        continue;
      }
      if (typeof row.tabId !== "string" || !row.tabId) {
        dlog("parseLayoutBlob: dropping detachedTabs entry without string tabId");
        continue;
      }
      out.detachedTabs.push(row);
    }
  } else if (input.detachedTabs !== undefined) {
    dlog("parseLayoutBlob: detachedTabs is not an array; treating as empty");
  }
  for (const key of Object.keys(input)) {
    if (key === "primary" || key === "secondary" || key === "detachedTabs" || key === "version" || key === "settings") {
      continue;
    }
    out[key] = input[key];
  }
  return out;
}
var init_parse_layout = __esm(() => {
  init_log();
});

// src/layout/tab-id-heal.ts
function stripTabIdSuffix(id) {
  return id.replace(/:\d+$/, "");
}
function pairStoredToLiveIds(storedIds, liveIds) {
  const result = new Map;
  const available = new Set(liveIds);
  for (const stored of storedIds) {
    if (available.has(stored)) {
      result.set(stored, stored);
      available.delete(stored);
    }
  }
  const leftoverStored = storedIds.filter((s3) => !result.has(s3));
  const byPrefix = new Map;
  for (const stored of leftoverStored) {
    const prefix = stripTabIdSuffix(stored);
    let g2 = byPrefix.get(prefix);
    if (!g2) {
      g2 = { stored: [], live: [] };
      byPrefix.set(prefix, g2);
    }
    g2.stored.push(stored);
  }
  for (const live of available) {
    const prefix = stripTabIdSuffix(live);
    const g2 = byPrefix.get(prefix);
    if (g2)
      g2.live.push(live);
  }
  for (const [, g2] of byPrefix) {
    g2.stored.sort();
    g2.live.sort();
    const n2 = Math.min(g2.stored.length, g2.live.length);
    for (let i3 = 0;i3 < n2; i3++) {
      result.set(g2.stored[i3], g2.live[i3]);
      available.delete(g2.live[i3]);
    }
    for (let i3 = n2;i3 < g2.stored.length; i3++) {
      result.set(g2.stored[i3], null);
    }
  }
  for (const stored of storedIds) {
    if (!result.has(stored))
      result.set(stored, null);
  }
  return result;
}

// src/layout/apply.ts
function isLayoutRestoreActive() {
  return _layoutRestoreActive;
}
function resolveRestoreDone() {
  const done = _restoreDone;
  _restoreDone = null;
  _layoutRestoreActive = false;
  if (done)
    done();
}
function cancelApplyLayoutInterval() {
  _restoreGeneration++;
  if (_restoreObserver !== null) {
    _restoreObserver.disconnect();
    _restoreObserver = null;
  }
  if (_restoreTimeoutHandle !== null) {
    clearTimeout(_restoreTimeoutHandle);
    _restoreTimeoutHandle = null;
  }
  setRestoringFromLayout(false);
  setSuppressAutoActivation(false);
  resolveRestoreDone();
}
function isTabFullyRestored(tabId) {
  if (!hasTabAssignment(tabId))
    return false;
  const _secondaryContent = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content") ?? null;
  if (!_secondaryContent)
    return false;
  const _bareId = tabId.includes(":") ? tabId.replace(/:\d+$/, "").split(":").pop() ?? tabId : tabId;
  const _roots = _secondaryContent.querySelectorAll("[data-canvas-moved]");
  for (const _r of Array.from(_roots)) {
    const _moved = _r.getAttribute("data-canvas-moved");
    if (_moved === tabId || _moved === _bareId)
      return true;
  }
  return false;
}
async function applyLayout(layout) {
  if (!layout)
    return;
  const parsed = parseLayoutBlob(layout);
  if (!parsed) {
    dwarn("applyLayout: layout blob failed validation; no-op");
    return;
  }
  if (layout && typeof layout === "object") {
    layout.detachedTabs = parsed.detachedTabs;
    if (parsed.primary) {
      layout.primary = { ...layout.primary || {}, ...parsed.primary };
    }
    if (parsed.secondary) {
      layout.secondary = { ...layout.secondary || {}, ...parsed.secondary };
    }
  } else {
    layout = parsed;
  }
  cancelApplyLayoutInterval();
  const settings = getSettings();
  const restoreWidth = !!settings.persistDrawerWidth;
  const restoreTabs = true;
  const restoreOpen = !!settings.persistDrawerOpenState;
  if (restoreWidth && layout.secondary?.width && !isMobileViewport()) {
    const clamped = Math.max(200, Math.min(window.innerWidth * 0.8, layout.secondary.width));
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${clamped}px`);
    if (getSecondaryWrapper() && !isSecondarySidebarOpen()) {
      const currentTransform = getSecondaryWrapper().style.transform?.match(/-?[\d.]+/)?.[0];
      const desiredClosed = getMainDrawerSide() === "right" ? -clamped : clamped;
      if (currentTransform !== String(desiredClosed)) {
        animateWrapper(getSecondaryWrapper(), desiredClosed);
      }
    }
  }
  const applySecondaryOpenState = () => {
    if (!restoreOpen)
      return;
    const mobileExcluded = isMobileViewport() && isMainDrawerOpen();
    const savedOpen = layout.secondary?.open === true;
    const hasSecondaryTabs = getTabAssignments().size > 0;
    const shouldBeOpen = savedOpen && hasSecondaryTabs;
    if (mobileExcluded && isSecondarySidebarOpen()) {
      enforceExclusionOnOpen("primary");
    } else if (shouldBeOpen && !isSecondarySidebarOpen()) {
      openSecondarySidebar();
    } else if (!shouldBeOpen && isSecondarySidebarOpen()) {
      closeSecondarySidebar();
      updateDrawerTabVisibility();
    }
  };
  if (restoreTabs) {
    return new Promise((resolve) => {
      _restoreDone = resolve;
      _layoutRestoreActive = true;
      const stripSuffix = stripTabIdSuffix;
      setRestoringFromLayout(true);
      setSuppressAutoActivation(true);
      const restoreGen = _restoreGeneration;
      const isCurrentRestore = () => restoreGen === _restoreGeneration;
      let _restoreFinished = false;
      const _assigningIds = new Set;
      const _settledIds = new Set;
      const resolveRestoredActiveTabId = () => {
        const detached = layout.detachedTabs ?? [];
        const saved = layout.secondary?.activeTabId;
        if (saved) {
          if (hasTabAssignment(saved))
            return saved;
          const prefix = stripSuffix(saved);
          const matches = detached.map((dt) => dt.tabId).filter((id) => hasTabAssignment(id) && stripSuffix(id) === prefix);
          if (matches.length === 1) {
            if (layout.secondary)
              layout.secondary.activeTabId = matches[0];
            return matches[0];
          }
        }
        const fallback = detached.find((dt) => hasTabAssignment(dt.tabId));
        return fallback?.tabId ?? null;
      };
      const finishRestore = () => {
        if (!isCurrentRestore())
          return;
        if (_restoreFinished)
          return;
        _restoreFinished = true;
        if (_restoreObserver !== null) {
          _restoreObserver.disconnect();
          _restoreObserver = null;
        }
        if (_restoreTimeoutHandle !== null) {
          clearTimeout(_restoreTimeoutHandle);
          _restoreTimeoutHandle = null;
        }
        if (restoreTabs) {
          const restoredId = resolveRestoredActiveTabId();
          if (restoredId) {
            showSecondaryTab(restoredId);
          }
        }
        applySecondaryOpenState();
        if (!isSecondarySidebarOpen()) {
          clearSecondaryTabButtonActive();
        }
        updateDrawerTabVisibility();
        if (restoreOpen) {
          const primaryTabId = typeof layout.primary?.tabId === "string" ? layout.primary.tabId : null;
          if (primaryTabId && layout.primary?.open !== false) {
            Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then((m3) => {
              m3.ensureRestoredPrimaryTab(primaryTabId);
            }).catch((err) => {
              dwarn("applyLayout: ensureRestoredPrimaryTab failed:", err);
            });
          }
        }
        if (!isCurrentRestore())
          return;
        setRestoringFromLayout(false);
        setSuppressAutoActivation(false);
        resolveRestoreDone();
      };
      const unassignUnwantedSecondary = async () => {
        const wantedList = (layout.detachedTabs ?? []).map((dt) => dt.tabId).filter(Boolean);
        const liveSecondary = new Set;
        for (const [id, panel] of getTabAssignments()) {
          if (panel === "secondary")
            liveSecondary.add(id);
        }
        if (liveSecondary.size === 0)
          return;
        const keep = new Set;
        for (const wanted of wantedList) {
          if (liveSecondary.has(wanted)) {
            keep.add(wanted);
            continue;
          }
          const prefix = stripSuffix(wanted);
          const candidates = [...liveSecondary].filter((id) => stripSuffix(id) === prefix);
          if (candidates.length === 1) {
            keep.add(candidates[0]);
          }
        }
        const extras = [...liveSecondary].filter((id) => !keep.has(id));
        for (const id of extras) {
          if (!hasTabAssignment(id))
            continue;
          try {
            await unassignFromSecondary(id);
            dlog(`applyLayout: unassigned extra secondary tab "${id}" (not in saved layout)`);
          } catch (err) {
            dwarn(`applyLayout: unassignFromSecondary(${id}) failed:`, err);
          }
        }
      };
      const kickAssign = (tabId) => {
        if (!isCurrentRestore() || _restoreFinished || _assigningIds.has(tabId) || _settledIds.has(tabId))
          return;
        _assigningIds.add(tabId);
        assignToSecondary(tabId).catch((err) => {
          dwarn(`applyLayout: assignToSecondary(${tabId}) failed:`, err);
        }).finally(() => {
          _assigningIds.delete(tabId);
          _settledIds.add(tabId);
          if (!isCurrentRestore() || _restoreFinished)
            return;
          const remaining = attemptRestore();
          if (remaining === 0)
            finishRestore();
        });
      };
      const attemptRestore = () => {
        if (!isCurrentRestore() || _restoreFinished)
          return 0;
        const detached = layout.detachedTabs ?? [];
        if (detached.length === 0)
          return 0;
        const tabs = getDrawerTabs();
        const liveIds = tabs.map((t3) => t3.id);
        const storedIds = detached.map((dt) => dt.tabId);
        const pairs = pairStoredToLiveIds(storedIds, liveIds);
        let remaining = 0;
        for (let i3 = 0;i3 < detached.length; i3++) {
          const dt = detached[i3];
          const pairedLive = pairs.get(dt.tabId) ?? null;
          const liveIdForCheck = pairedLive && pairedLive !== dt.tabId ? pairedLive : dt.tabId;
          const _alreadyAssigned = hasTabAssignment(liveIdForCheck);
          const _fullyRestored = _alreadyAssigned ? isTabFullyRestored(liveIdForCheck) : false;
          if (_alreadyAssigned && _fullyRestored)
            continue;
          remaining++;
          if (_settledIds.has(liveIdForCheck) || _assigningIds.has(liveIdForCheck))
            continue;
          let tab = tabs.find((t3) => t3.id === liveIdForCheck) || tabs.find((t3) => t3.id === dt.tabId) || (pairedLive ? tabs.find((t3) => t3.id === pairedLive) : undefined) || null;
          if (tab && tab.id !== dt.tabId) {
            dlog(`applyLayout: suffix-drift bipartite matched stored "${dt.tabId}" → live "${tab.id}"`);
            const prevId = dt.tabId;
            layout.detachedTabs[i3] = { ...dt, tabId: tab.id };
            const savedActive = layout.secondary?.activeTabId;
            if (savedActive && (savedActive === prevId || stripSuffix(savedActive) === stripSuffix(prevId))) {
              layout.secondary = { ...layout.secondary, activeTabId: tab.id };
            }
          } else if (!tab && !pairedLive) {
            const prefix = stripSuffix(dt.tabId);
            const samePrefixLive = liveIds.filter((id) => stripSuffix(id) === prefix);
            if (samePrefixLive.length > 1) {
              dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" unmatched after bipartite pairing (${samePrefixLive.length} live candidates for prefix "${prefix}").`);
            }
          }
          if (tab) {
            kickAssign(tab.id);
          } else {
            let mainBtn = findMainTabButton(dt.tabId);
            if (!mainBtn) {
              const prefix = stripSuffix(dt.tabId);
              const allBtns = document.querySelectorAll("[data-tab-id]");
              const prefixHits = [];
              for (const el of Array.from(allBtns)) {
                const id = el.getAttribute("data-tab-id");
                if (id && stripSuffix(id) === prefix)
                  prefixHits.push(el);
              }
              if (prefixHits.length === 1) {
                mainBtn = prefixHits[0];
              } else if (prefixHits.length > 1) {
                const sorted = prefixHits.map((el) => el.getAttribute("data-tab-id")).sort();
                const groupStored = storedIds.filter((s3) => stripSuffix(s3) === prefix).sort();
                const idx = groupStored.indexOf(dt.tabId);
                const pick = idx >= 0 && idx < sorted.length ? sorted[idx] : null;
                if (pick) {
                  mainBtn = document.querySelector(`[data-tab-id="${CSS.escape(pick)}"]`);
                }
              }
            }
            if (mainBtn) {
              const liveTabId = mainBtn.getAttribute("data-tab-id") || dt.tabId;
              kickAssign(liveTabId);
              dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}"`);
            } else {
              const knownIds = tabs.map((t3) => t3.id);
              dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(", ")}. Layout may be stale.`);
            }
          }
        }
        return remaining;
      };
      const startAssignPhase = () => {
        if (!isCurrentRestore() || _restoreFinished)
          return;
        const detachedLen = layout.detachedTabs?.length ?? 0;
        if (detachedLen === 0) {
          finishRestore();
          return;
        }
        const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
        if (sidebar) {
          _restoreObserver = new MutationObserver(() => {
            if (!isCurrentRestore())
              return;
            _settledIds.clear();
            const remaining = attemptRestore();
            if (remaining === 0)
              finishRestore();
          });
          _restoreObserver.observe(sidebar, { childList: true, subtree: true });
        } else {
          queueMicrotask(() => {
            if (!isCurrentRestore() || _restoreFinished)
              return;
            const remaining = attemptRestore();
            if (remaining === 0)
              finishRestore();
          });
        }
        _restoreTimeoutHandle = setTimeout(() => {
          if (!isCurrentRestore())
            return;
          attemptRestore();
          finishRestore();
        }, _restoreTimeoutMs);
        const initialRemaining = attemptRestore();
        if (initialRemaining === 0) {
          finishRestore();
        } else {
          const followUp = attemptRestore();
          if (followUp === 0)
            finishRestore();
        }
      };
      unassignUnwantedSecondary().catch((err) => {
        dwarn("applyLayout: unassignUnwantedSecondary failed:", err);
      }).then(() => {
        if (!isCurrentRestore())
          return;
        startAssignPhase();
      });
    });
  } else if (restoreOpen) {
    applySecondaryOpenState();
  }
}
var _restoreObserver = null, _restoreTimeoutHandle = null, _restoreTimeoutMs = 1e4, _restoreDone = null, _layoutRestoreActive = false, _restoreGeneration = 0;
var init_apply = __esm(() => {
  init_store();
  init_secondary();
  init_assignment();
  init_secondary_drawer();
  init_buttons();
  init_log();
  init_mobile_exclusion();
  init_state();
  init_parse_layout();
});

// src/layout/persist.ts
var exports_persist = {};
__export(exports_persist, {
  syncLastLoadedFromPersistedLayout: () => syncLastLoadedFromPersistedLayout,
  snapshotLayout: () => snapshotLayout,
  setMainDrawerState: () => setMainDrawerState,
  setBackendCtx: () => setBackendCtx,
  persistOpenState: () => persistOpenState,
  persistLayout: () => persistLayout,
  loadSavedLayout: () => loadSavedLayout,
  isWidthPersistenceEnabled: () => isWidthPersistenceEnabled,
  isPersistenceEnabled: () => isPersistenceEnabled,
  isOpenStatePersistenceEnabled: () => isOpenStatePersistenceEnabled,
  isLoadInProgress: () => isLoadInProgress,
  isLayoutRestoreActive: () => isLayoutRestoreActive,
  isAnyLayoutPersistenceEnabled: () => isAnyLayoutPersistenceEnabled,
  getBackendCtx: () => getBackendCtx,
  flushPendingSaves: () => flushPendingSaves,
  cancelLayoutSave: () => cancelLayoutSave,
  buildPersistedLayout: () => buildPersistedLayout,
  applyMainDrawer: () => applyMainDrawer,
  applyLayout: () => applyLayout,
  CANVAS_VERSION: () => CANVAS_VERSION
});
function getBackendCtx() {
  return _backendCtx;
}
function setBackendCtx(ctx) {
  _backendCtx = ctx;
}
function isLoadInProgress() {
  return _loadInProgress;
}
function cancelLayoutSave() {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
}
function writeLayoutToBackend(layout) {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
  setLastLoadedLayout(layout);
}
function syncLastLoadedFromPersistedLayout() {
  setLastLoadedLayout({ ...buildPersistedLayout(), settings: getSettings() });
}
function flushPendingSaves() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isAnyLayoutPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
  cancelSettingsSave();
  const layout = { ...buildPersistedLayout(), settings: getSettings() };
  writeLayoutToBackend(layout);
}
function setMainDrawerState(open, tabId) {
  _mainDrawerOpen = open;
  _mainDrawerTabId = tabId;
}
function isCanvasMainModeDom() {
  try {
    return typeof document !== "undefined" && document.documentElement.classList.contains(CANVAS_MAIN_ACTIVE_CLASS);
  } catch {
    return false;
  }
}
function readPrimaryOpen() {
  if (isCanvasMainModeDom()) {
    return document.documentElement.classList.contains(CANVAS_MAIN_OPEN_CLASS);
  }
  return _mainDrawerOpen;
}
function readPrimaryWidth() {
  if (isCanvasMainModeDom()) {
    const fromVar = parseFloat(document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR));
    if (isFinite(fromVar) && fromVar > 0) {
      _lastKnownPrimaryWidth = fromVar;
      return fromVar;
    }
    if (_lastKnownPrimaryWidth != null && _lastKnownPrimaryWidth > 0) {
      return _lastKnownPrimaryWidth;
    }
    return 420;
  }
  const hostW = getMainDrawerWidth();
  if (hostW > 0) {
    _lastKnownPrimaryWidth = hostW;
    return hostW;
  }
  if (_lastKnownPrimaryWidth != null && _lastKnownPrimaryWidth > 0) {
    return _lastKnownPrimaryWidth;
  }
  return 420;
}
function snapshotLayout() {
  const assignments = Array.from(getTabAssignments().entries());
  const secondaryAssignments = assignments.filter(([_2, side]) => side === "secondary");
  const result = {
    version: CANVAS_VERSION,
    primary: {
      open: readPrimaryOpen(),
      width: readPrimaryWidth(),
      tabId: _mainDrawerTabId
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
      activeTabId: getActiveSecondaryTabId()
    },
    detachedTabs: secondaryAssignments.map(([tabId, side]) => {
      const tabs = getDrawerTabs();
      const tab = tabs.find((t3) => t3.id === tabId);
      return { tabId, tabTitle: tab?.title || tabId, sidebar: side };
    })
  };
  return result;
}
function isAnyLayoutPersistenceEnabled() {
  return true;
}
function isPersistenceEnabled() {
  return true;
}
function buildPersistedLayout() {
  const live = snapshotLayout();
  const last = getLastLoadedLayout();
  const base = {
    primary: last?.primary ?? { open: false, width: 420 },
    secondary: last?.secondary ?? { open: false, width: 420 },
    detachedTabs: last?.detachedTabs ?? []
  };
  const s3 = getSettings();
  const tabsLive = s3.secondSidebarEnabled;
  return {
    version: live.version,
    primary: {
      open: s3.persistDrawerOpenState ? live.primary.open : base.primary.open ?? false,
      width: s3.persistDrawerWidth ? live.primary.width : base.primary.width ?? 420,
      tabId: s3.persistDrawerOpenState ? live.primary.tabId : base.primary.tabId ?? null
    },
    secondary: {
      open: s3.persistDrawerOpenState ? live.secondary.open : base.secondary.open ?? false,
      width: s3.persistDrawerWidth ? live.secondary.width : base.secondary.width ?? 420,
      activeTabId: tabsLive ? live.secondary.activeTabId : base.secondary.activeTabId
    },
    detachedTabs: tabsLive ? live.detachedTabs : base.detachedTabs ?? []
  };
}
function persistOpenState() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isAnyLayoutPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (isLayoutRestoreActive())
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
  cancelSettingsSave();
  const layout = { ...buildPersistedLayout(), settings: getSettings() };
  writeLayoutToBackend(layout);
}
function persistLayout() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isAnyLayoutPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (isLayoutRestoreActive())
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
  }
  cancelSettingsSave();
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null;
    if (isLayoutRestoreActive())
      return;
    const layout = { ...buildPersistedLayout(), settings: getSettings() };
    writeLayoutToBackend(layout);
  }, 500);
}
function loadSavedLayout() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return Promise.resolve(null);
  _loadInProgress = true;
  return new Promise((resolve) => {
    let settled = false;
    const handler = (payload) => {
      if (payload.type === "LAYOUT_DATA") {
        if (settled)
          return;
        settled = true;
        _loadInProgress = false;
        clearTimeout(timeoutId);
        if (typeof unsub === "function")
          unsub();
        resolve(payload.layout);
      }
    };
    const unsub = backendCtx.onBackendMessage(handler);
    backendCtx.sendToBackend({ type: "LOAD_LAYOUT" });
    const timeoutId = setTimeout(() => {
      if (settled)
        return;
      settled = true;
      _loadInProgress = false;
      if (typeof unsub === "function")
        unsub();
      resolve(null);
    }, 2000);
  });
}
function applyMainDrawer(layout) {
  const restoreOpen = isOpenStatePersistenceEnabled();
  const restoreWidth = isWidthPersistenceEnabled();
  if (layout != null) {
    const parsed = parseLayoutBlob(layout);
    if (!parsed) {
      dwarn("applyMainDrawer: layout blob failed validation; unsuppress only");
      Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ unsuppressMainDrawer: unsuppressMainDrawer2 }) => {
        unsuppressMainDrawer2();
      }).catch((err) => {
        dwarn("applyMainDrawer: unsuppressMainDrawer failed:", err);
      });
      return;
    }
    layout = parsed;
  }
  if (!restoreOpen && !restoreWidth) {
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ unsuppressMainDrawer: unsuppressMainDrawer2 }) => {
      unsuppressMainDrawer2();
    }).catch((err) => {
      dwarn("applyMainDrawer: unsuppressMainDrawer failed:", err);
    });
    return;
  }
  if (!layout || !layout.primary) {
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ unsuppressMainDrawer: unsuppressMainDrawer2 }) => {
      unsuppressMainDrawer2();
    }).catch((err) => {
      dwarn("applyMainDrawer: unsuppressMainDrawer failed:", err);
    });
    return;
  }
  Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ restoreMainDrawerFromDom: restoreMainDrawerFromDom2 }) => {
    restoreMainDrawerFromDom2(layout.primary.open === true, typeof layout.primary.tabId === "string" ? layout.primary.tabId : null, restoreWidth && typeof layout.primary.width === "number" ? layout.primary.width : undefined, { restoreOpen, restoreWidth });
  }).catch((err) => {
    dwarn("applyMainDrawer: restoreMainDrawerFromDom failed:", err);
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ unsuppressMainDrawer: unsuppressMainDrawer2 }) => {
      unsuppressMainDrawer2();
    }).catch((e22) => {
      dwarn("applyMainDrawer: unsuppress after restore failure also failed:", e22);
    });
  });
}
function isOpenStatePersistenceEnabled() {
  return !!getSettings().persistDrawerOpenState;
}
function isWidthPersistenceEnabled() {
  return !!getSettings().persistDrawerWidth;
}
var CANVAS_VERSION = "1.7.2.9", _backendCtx = null, _saveLayoutTimer = null, _loadInProgress = false, _mainDrawerOpen = false, _mainDrawerTabId = null, _lastKnownPrimaryWidth = null;
var init_persist = __esm(() => {
  init_store();
  init_secondary();
  init_styles();
  init_assignment();
  init_active_tab();
  init_state();
  init_log();
  init_parse_layout();
  init_apply();
  init_apply();
});

// src/debug/log.ts
function setDebug(value) {
  DEBUG = value;
  Promise.resolve().then(() => (init_persist(), exports_persist)).then(({ getBackendCtx: getBackendCtx2 }) => {
    const ctx = getBackendCtx2();
    if (ctx?.sendToBackend) {
      ctx.sendToBackend({ type: "SET_DEBUG", debug: value });
    }
  }).catch(() => {});
}
function dlog(...args) {
  if (!DEBUG)
    return;
  console.log("[Canvas]", ...args);
}
function dwarn(...args) {
  if (!DEBUG)
    return;
  console.warn("[Canvas]", ...args);
}
var DEBUG;
var init_log = __esm(() => {
  DEBUG = (() => {
    try {
      return localStorage.getItem("sidebarUxDebug") === "1";
    } catch {
      return false;
    }
  })();
});

// src/settings/state.ts
function resetHydrationGuard() {
  _userHasTouchedSettings = false;
}
function getSettings() {
  return _settings;
}
function setLastLoadedLayout(layout) {
  _lastLoadedLayout = layout;
}
function getLastLoadedLayout() {
  return _lastLoadedLayout;
}
function setPanelRefresh(fn) {
  _panelRefresh = fn;
}
function normalizeCanvasSettings(s3) {
  return normalizeCanvasSettingsFields(s3);
}
function isKeepTabListVisibleEnabled(s3 = _settings) {
  return !!s3.keepTabListVisible && !!s3.moveControlsToOuterEdge;
}
function isHideDrawerOpenCloseButtonsEnabled(s3 = _settings) {
  return !!s3.hideDrawerOpenCloseButtons && isKeepTabListVisibleEnabled(s3);
}
function hydrateSettings(raw) {
  if (_userHasTouchedSettings)
    return;
  _settings = normalizeCanvasSettings(mergeCanvasSettings(raw ?? null));
}
function setSettings(patch) {
  _userHasTouchedSettings = true;
  const prev = _settings;
  const next = { ...prev };
  for (const key of Object.keys(patch)) {
    const v3 = patch[key];
    if (v3 !== undefined)
      next[key] = v3;
  }
  _settings = normalizeCanvasSettings(next);
  setDebug(_settings.debugMode);
  applySettings(prev, _settings);
  refreshSettingsPanel();
  persistSettings();
}
function refreshSettingsPanel() {
  if (_panelRefresh)
    _panelRefresh();
}
function persistSettings() {
  const backendCtx = getBackendCtx();
  if (!backendCtx) {
    dlog("persistSettings: no backendCtx, skipping");
    return;
  }
  if (isLoadInProgress()) {
    dlog("persistSettings: load in progress, skipping");
    return;
  }
  if (isLayoutRestoreActive()) {
    dlog("persistSettings: layout restore active, skipping");
    return;
  }
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null;
    const layoutSnapshot = buildPersistedLayout();
    const layout = { ...layoutSnapshot, settings: _settings };
    dlog(`persistSettings: debounced firing (open=${_settings.persistDrawerOpenState}, width=${_settings.persistDrawerWidth}, snapshot.primary.open=${layout.primary.open}, snapshot.secondary.open=${layout.secondary.open})`);
    backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
    setLastLoadedLayout(layout);
  }, 100);
}
function cancelSettingsSave() {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = null;
  }
}
var _settings, _lastLoadedLayout = null, _saveSettingsTimer = null, _userHasTouchedSettings = false, _panelRefresh = null;
var init_state = __esm(() => {
  init_types();
  init_log();
  init_panel();
  init_persist();
  _settings = mergeCanvasSettings(null);
});

// src/debug/fiber-scan.ts
function installDebugEscapeHatch() {
  window.__canvasDebug = function() {
    console.log("=== Canvas Fiber Scan ===");
    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
    if (!sidebar) {
      console.log("No sidebar found");
      return;
    }
    const fiberKey = Object.keys(sidebar).find((k3) => k3.startsWith("__reactFiber$"));
    if (!fiberKey) {
      console.log("No fiber key");
      return;
    }
    const visited = new Set;
    function scan(fiber2, depth, maxDepth) {
      if (!fiber2 || depth > maxDepth || visited.has(fiber2))
        return;
      visited.add(fiber2);
      let hook = fiber2.memoizedState;
      let hookIdx = 0;
      while (hook && hookIdx < 30) {
        const state = hook.memoizedState;
        if (Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === "object") {
          const firstKeys = Object.keys(state[0]);
          if (firstKeys.includes("id") && firstKeys.includes("title") && firstKeys.includes("root")) {
            console.log(`*** FOUND drawerTabs at depth=${depth} hook=${hookIdx}: ${state.length} tabs ***`);
            state.forEach((t3, i3) => console.log(`  [${i3}] id=${t3.id} title=${t3.title}`));
          }
        }
        if (state && typeof state === "object" && !Array.isArray(state)) {
          const keys = Object.keys(state);
          if (keys.includes("drawerOpen") || keys.includes("drawerTabs")) {
            console.log(`*** FOUND store snapshot at depth=${depth} hook=${hookIdx}: ${keys.length} keys ***`);
            console.log(keys.slice(0, 25));
          }
        }
        hook = hook.next;
        hookIdx++;
      }
      scan(fiber2.child, depth + 1, maxDepth);
      scan(fiber2.sibling, depth, maxDepth);
    }
    console.log("Walking UP from sidebar to find ancestors...");
    const rootFiber = getFiberFromElement(sidebar);
    let fiber = rootFiber;
    const ancestors = [];
    while (fiber) {
      ancestors.push(fiber);
      fiber = fiber.return;
    }
    console.log(`Found ${ancestors.length} ancestors`);
    for (let i3 = ancestors.length - 1;i3 >= Math.max(0, ancestors.length - 5); i3--) {
      console.log(`Scanning down from ancestor at position ${i3}...`);
      scan(ancestors[i3], 0, 30);
    }
    console.log("Done");
  };
}
var init_fiber_scan = __esm(() => {
  init_fiber();
});

// src/slash/registry.ts
class CommandRegistry {
  commands = new Map;
  register(command) {
    this.commands.set(command.name, command);
    return () => {
      if (this.commands.get(command.name) === command) {
        this.commands.delete(command.name);
      }
    };
  }
  lookup(name) {
    return this.commands.get(name);
  }
  list() {
    return Array.from(this.commands.values()).sort((a3, b2) => a3.name.localeCompare(b2.name));
  }
  clear() {
    this.commands.clear();
  }
}

// src/slash/parse.ts
function parseCommand(input) {
  if (!input.startsWith("/"))
    return null;
  if (input.length === 1)
    return null;
  const match = /^\/(\S+)(?:\s+(.*))?$/.exec(input);
  if (!match)
    return null;
  const name = match[1];
  if (!/^[a-z][a-z0-9_-]*$/i.test(name))
    return null;
  return { name, args: match[2] ?? "" };
}

// src/slash/intent.ts
function setIntent(command, source) {
  _intent = { command, committedAt: Date.now(), source };
}
function getIntent() {
  if (!_intent)
    return null;
  if (Date.now() - _intent.committedAt > INTENT_TTL_MS) {
    _intent = null;
    return null;
  }
  return _intent;
}
function clearIntent() {
  _intent = null;
}
function reconcileWithTextarea(text) {
  if (!_intent)
    return;
  if (text.startsWith("/" + _intent.command.name))
    return;
  _intent = null;
}
var _intent = null, INTENT_TTL_MS;
var init_intent = __esm(() => {
  INTENT_TTL_MS = 5 * 60 * 1000;
});

// src/slash/positioning.ts
function position(el, anchor) {
  const rect = anchor.getBoundingClientRect();
  const spaceAbove = rect.top;
  const elHeight = el.offsetHeight;
  const top = spaceAbove > elHeight + VIEWPORT_MARGIN ? rect.top - elHeight - 4 : rect.bottom + 4;
  el.style.top = `${top}px`;
  const elWidth = el.offsetWidth;
  const maxLeft = window.innerWidth - elWidth - VIEWPORT_MARGIN;
  el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))}px`;
  el.style.minWidth = `${rect.width}px`;
}
function attachViewportListeners(getAnchor, getEl) {
  if (!visualViewportListener) {
    visualViewportListener = () => {
      const anchor = getAnchor();
      const el = getEl();
      if (anchor && el)
        position(el, anchor);
    };
    window.visualViewport?.addEventListener("resize", visualViewportListener);
  }
  if (!scrollListener) {
    scrollListener = () => {
      const anchor = getAnchor();
      const el = getEl();
      if (anchor && el)
        position(el, anchor);
    };
    window.addEventListener("scroll", scrollListener, true);
  }
  if (!resizeListener) {
    resizeListener = () => {
      const anchor = getAnchor();
      const el = getEl();
      if (anchor && el)
        position(el, anchor);
    };
    window.addEventListener("resize", resizeListener);
  }
}
function detachViewportListeners() {
  if (visualViewportListener) {
    window.visualViewport?.removeEventListener("resize", visualViewportListener);
    visualViewportListener = null;
  }
  if (scrollListener) {
    window.removeEventListener("scroll", scrollListener, true);
    scrollListener = null;
  }
  if (resizeListener) {
    window.removeEventListener("resize", resizeListener);
    resizeListener = null;
  }
}
var VIEWPORT_MARGIN = 8, visualViewportListener = null, scrollListener = null, resizeListener = null;

// src/slash/dom-utils.ts
function applySuggestion(ta, label) {
  const normalized = label.startsWith("/") ? label : `/${label}`;
  _skipNextTextChange = true;
  setControlledValue(ta, `${normalized} `);
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function suggestionLabel(cmd) {
  const u4 = cmd.usage?.trim();
  if (u4 && !/[<>]/.test(u4)) {
    return u4.startsWith("/") ? u4 : `/${u4}`;
  }
  return `/${cmd.name}`;
}
function setControlledValue(ta, value) {
  const proto = Object.getPrototypeOf(ta);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) {
    desc.set.call(ta, value);
  } else {
    ta.value = value;
  }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
function setSkipNextTextChange() {
  _skipNextTextChange = true;
}
function consumeSkipNextTextChange() {
  if (_skipNextTextChange) {
    _skipNextTextChange = false;
    return true;
  }
  return false;
}
function resetSkipNextTextChange() {
  _skipNextTextChange = false;
}
function isValidSlashContext(ta) {
  return ta.value.startsWith("/");
}
function findCompletionCandidateIndex(matches, text) {
  if (!text.includes(" "))
    return -1;
  const argPart = text.slice(text.indexOf(" ") + 1);
  if (argPart.trim().length === 0)
    return -1;
  const textLower = text.toLowerCase();
  for (let i3 = 0;i3 < matches.length; i3++) {
    const usage = (matches[i3].usage ?? `/${matches[i3].name}`).toLowerCase();
    if (usage.length > textLower.length && usage.startsWith(textLower)) {
      return i3;
    }
  }
  return -1;
}
function textareaHasUsage(ta, activeCmd) {
  const usage = (activeCmd.usage ?? `/${activeCmd.name}`).toLowerCase();
  const value = ta.value.toLowerCase();
  if (value.length > usage.length && value.startsWith(usage)) {
    const nextChar = ta.value[usage.length];
    return /\s/.test(nextChar);
  }
  return false;
}
function shouldHideForNonMatchingArgs(text, hasCompletionCandidate) {
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx < 0)
    return false;
  const argPart = text.slice(spaceIdx + 1);
  if (argPart.trim().length === 0)
    return false;
  return !hasCompletionCandidate;
}
function resolveActiveIndex(matches, text, lastSticky) {
  const completionIdx = findCompletionCandidateIndex(matches, text);
  if (completionIdx >= 0) {
    return { activeIndex: completionIdx, nextSticky: completionIdx };
  }
  if (lastSticky != null && lastSticky >= 0 && lastSticky < matches.length && text.includes(" ") && text.slice(text.indexOf(" ") + 1).trim().length > 0) {
    return { activeIndex: lastSticky, nextSticky: lastSticky };
  }
  return { activeIndex: 0, nextSticky: null };
}
var _skipNextTextChange = false;

// src/slash/ghost-text.ts
function setGhost(ta, payload) {
  if (!payload) {
    hideGhost();
    return;
  }
  const suffix = ghostSuffixLocal(payload.fullArg, payload.typedPrefix);
  _ctx = {
    ta,
    fullArg: payload.fullArg,
    range: payload.range,
    typedPrefix: payload.typedPrefix,
    visible: false
  };
  if (!suffix) {
    removeOverlay();
    return;
  }
  injectGhostStyles();
  _ctx.visible = true;
  renderGhostOverlay(ta, suffix, payload.range.end);
}
function hasGhost() {
  return _ctx?.visible === true;
}
function acceptGhost(ta) {
  if (!_ctx?.visible)
    return false;
  const { fullArg, range } = _ctx;
  const value = ta.value;
  const start = Math.max(0, Math.min(range.start, value.length));
  const end = Math.max(start, Math.min(range.end, value.length));
  let next = value.slice(0, start) + fullArg + value.slice(end);
  if (!next.endsWith(" "))
    next += " ";
  setSkipNextTextChange();
  setControlledValue(ta, next);
  ta.setSelectionRange(next.length, next.length);
  hideGhost();
  return true;
}
function hideGhost() {
  _ctx = null;
  removeOverlay();
}
function removeOverlay() {
  const el = document.getElementById(GHOST_ID);
  if (el)
    el.remove();
}
function ghostSuffixLocal(full, typedPrefix) {
  if (!full.toLowerCase().startsWith(typedPrefix.toLowerCase()))
    return null;
  if (full.length <= typedPrefix.length)
    return null;
  return full.slice(typedPrefix.length);
}
function renderGhostOverlay(ta, suffix, caretPos) {
  let el = document.getElementById(GHOST_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = GHOST_ID;
    el.setAttribute("data-canvas-slash", "ghost");
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  const style = window.getComputedStyle(ta);
  const taRect = ta.getBoundingClientRect();
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  el.style.left = `${taRect.left + borderLeft}px`;
  el.style.top = `${taRect.top + borderTop}px`;
  el.style.width = `${ta.clientWidth}px`;
  el.style.height = `${ta.clientHeight}px`;
  el.style.boxSizing = "border-box";
  el.style.margin = "0";
  el.style.border = "none";
  el.style.paddingTop = style.paddingTop;
  el.style.paddingRight = style.paddingRight;
  el.style.paddingBottom = style.paddingBottom;
  el.style.paddingLeft = style.paddingLeft;
  el.style.font = style.font;
  el.style.fontFamily = style.fontFamily;
  el.style.fontSize = style.fontSize;
  el.style.fontWeight = style.fontWeight;
  el.style.fontStyle = style.fontStyle;
  el.style.fontVariant = style.fontVariant;
  el.style.lineHeight = style.lineHeight;
  el.style.letterSpacing = style.letterSpacing;
  el.style.textTransform = style.textTransform;
  el.style.textAlign = style.textAlign;
  el.style.textIndent = style.textIndent;
  el.style.wordSpacing = style.wordSpacing;
  el.style.direction = style.direction;
  el.style.whiteSpace = "pre-wrap";
  el.style.wordWrap = "break-word";
  el.style.overflowWrap = style.overflowWrap || "break-word";
  el.style.wordBreak = style.wordBreak;
  el.style.tabSize = style.tabSize;
  el.style.MozTabSize = style.getPropertyValue("tab-size") || style.tabSize;
  el.style.overflow = "hidden";
  el.scrollTop = ta.scrollTop;
  el.scrollLeft = ta.scrollLeft;
  const clamped = Math.max(0, Math.min(caretPos, ta.value.length));
  const before = ta.value.slice(0, clamped);
  const pre = document.createElement("span");
  pre.className = "canvas-slash-ghost-pre";
  pre.textContent = before;
  const ghost = document.createElement("span");
  ghost.className = "canvas-slash-ghost-suffix";
  ghost.textContent = suffix;
  el.replaceChildren(pre, ghost);
}
function injectGhostStyles() {
  injectStyles(STYLE_ID3, `
    #${GHOST_ID} {
      position: fixed;
      z-index: 10004; /* below suggest (10005), above toast */
      pointer-events: none;
      user-select: none;
      color: transparent;
    }
    #${GHOST_ID} .canvas-slash-ghost-pre {
      color: transparent;
    }
    #${GHOST_ID} .canvas-slash-ghost-suffix {
      color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, #888));
      opacity: 0.65;
    }
  `);
}
var GHOST_ID = "canvas-slash-ghost", STYLE_ID3 = "canvas-slash-ghost-styles", _ctx = null;
var init_ghost_text = () => {};

// src/slash/suggest.ts
function showSuggest(textarea, options, initialActiveIndex = 0, onActiveIndexChange) {
  if (options.length === 0) {
    hideSuggest();
    return makeNoopController();
  }
  injectSuggestStyles();
  applyTextareaAriaBaseline(textarea);
  const el = getOrCreate();
  el.setAttribute("role", "listbox");
  currentAnchor = textarea;
  currentEl = el;
  let currentOptions = options;
  let activeIndex = options.length > 0 ? Math.max(0, Math.min(options.length - 1, initialActiveIndex)) : 0;
  let visible = true;
  const notifyActive = () => {
    const cmd = activeIndex >= 0 && activeIndex < currentOptions.length ? currentOptions[activeIndex] : null;
    onActiveIndexChange?.(activeIndex, cmd);
  };
  const updateActiveDom = () => {
    const rows = el.querySelectorAll(".canvas-slash-opt");
    rows.forEach((row, i3) => {
      const isActive = i3 === activeIndex;
      row.setAttribute("data-active", isActive ? "true" : "false");
      row.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    textarea.setAttribute("aria-expanded", "true");
    if (activeIndex >= 0 && activeIndex < rows.length) {
      textarea.setAttribute("aria-activedescendant", `canvas-slash-opt-${activeIndex}`);
    } else {
      textarea.removeAttribute("aria-activedescendant");
    }
  };
  const renderRows = () => {
    el.innerHTML = currentOptions.map((c3, i3) => {
      const label = escapeHtml2(c3.usage ?? "/" + c3.name);
      const desc = escapeHtml2(c3.description ?? "");
      const owner = escapeHtml2(c3.owner);
      const isActive = i3 === activeIndex;
      return `<div id="canvas-slash-opt-${i3}" class="canvas-slash-opt"` + ` role="option" aria-selected="${isActive}" data-active="${isActive}"` + ` data-cmd="${escapeAttr(c3.name)}">` + `<span class="canvas-slash-opt-body">` + `<span class="canvas-slash-opt-name">${label}</span>` + `<span class="canvas-slash-opt-desc">${desc}</span>` + `</span>` + `<span class="canvas-slash-opt-source">${owner}</span>` + `</div>`;
    }).join("");
    el.querySelectorAll(".canvas-slash-opt").forEach((row, i3) => {
      row.addEventListener("mousedown", (e3) => {
        e3.preventDefault();
      });
      row.addEventListener("mouseenter", () => setActiveIndex(i3));
      row.addEventListener("click", (e3) => {
        e3.preventDefault();
        e3.stopPropagation();
        if (!currentAnchor)
          return;
        const cmd = currentOptions[i3];
        if (!cmd)
          return;
        if (!isValidSlashContext(currentAnchor)) {
          hideSuggest();
          return;
        }
        if (textareaHasUsage(currentAnchor, cmd)) {
          hideSuggest();
          return;
        }
        const label = suggestionLabel(cmd);
        applySuggestion(currentAnchor, label);
        const parsed = parseCommand(label);
        if (parsed)
          setIntent(parsed, "click");
        hideSuggest();
        window.dispatchEvent(new CustomEvent("canvas:slash-completions-changed"));
      });
    });
    updateActiveDom();
  };
  const setActiveIndex = (i3) => {
    if (currentOptions.length === 0) {
      activeIndex = -1;
      updateActiveDom();
      notifyActive();
      return;
    }
    const clamped = Math.max(0, Math.min(currentOptions.length - 1, i3));
    if (clamped === activeIndex)
      return;
    activeIndex = clamped;
    updateActiveDom();
    scrollActiveIntoView();
    notifyActive();
  };
  const scrollActiveIntoView = () => {
    if (activeIndex < 0)
      return;
    const row = el.querySelector(`#canvas-slash-opt-${activeIndex}`);
    row?.scrollIntoView({ block: "nearest" });
  };
  const getActiveCommand = () => {
    if (activeIndex < 0 || activeIndex >= currentOptions.length)
      return null;
    return currentOptions[activeIndex];
  };
  renderRows();
  position(el, textarea);
  attachViewportListeners(() => currentAnchor, () => currentEl);
  attachOutsideDismiss();
  _currentController = {
    setActiveIndex,
    getActiveIndex: () => activeIndex,
    getActiveCommand,
    scrollActiveIntoView,
    isVisible: () => visible
  };
  return _currentController;
}
function hideSuggest() {
  const el = document.getElementById(SUGGEST_ID);
  if (el)
    el.remove();
  detachViewportListeners();
  detachOutsideDismiss();
  currentAnchor = null;
  currentEl = null;
  _currentController = null;
  hideGhost();
}
function isSuggestVisible() {
  return _currentController?.isVisible() === true;
}
function getSuggestController() {
  return _currentController;
}
function makeNoopController() {
  return {
    setActiveIndex: () => {},
    getActiveIndex: () => -1,
    getActiveCommand: () => null,
    scrollActiveIntoView: () => {},
    isVisible: () => false
  };
}
function getOrCreate() {
  let el = document.getElementById(SUGGEST_ID);
  if (el)
    return el;
  el = document.createElement("div");
  el.id = SUGGEST_ID;
  el.setAttribute("data-canvas-slash", "suggest");
  document.body.appendChild(el);
  return el;
}
function attachOutsideDismiss() {
  if (outsideDismissListener)
    return;
  outsideDismissListener = (e3) => {
    if (!_currentController)
      return;
    const target = e3.target;
    if (!(target instanceof Node))
      return;
    if (currentEl?.contains(target))
      return;
    hideSuggest();
  };
  document.addEventListener("mousedown", outsideDismissListener);
  document.addEventListener("pointerdown", outsideDismissListener);
  document.addEventListener("contextmenu", outsideDismissListener);
}
function detachOutsideDismiss() {
  if (!outsideDismissListener)
    return;
  document.removeEventListener("mousedown", outsideDismissListener);
  document.removeEventListener("pointerdown", outsideDismissListener);
  document.removeEventListener("contextmenu", outsideDismissListener);
  outsideDismissListener = null;
}
function applyTextareaAriaBaseline(textarea) {
  if (textarea.getAttribute("role") !== "combobox") {
    textarea.setAttribute("role", "combobox");
    textarea.setAttribute("aria-autocomplete", "list");
    textarea.setAttribute("aria-haspopup", "listbox");
    textarea.setAttribute("aria-controls", SUGGEST_ID);
  }
}
function injectSuggestStyles() {
  injectStyles(STYLE_ID4, `
    #${SUGGEST_ID} {
      position: fixed;
      z-index: 10005; /* above Lumiverse modals (10001-10003) and toast (10004) */
      background: var(--lumiverse-bg-elevated);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 200px;
      max-width: min(420px, calc(100vw - 16px));
      max-height: min(240px, calc(35vh / var(--lumiverse-ui-scale, 1)));
      overflow-y: auto;
      font-family: var(--lumiverse-font-family);
      color: var(--lumiverse-text);
      box-shadow: var(--lumiverse-shadow-md);
      animation: canvas-slash-suggest-fade 160ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    #${SUGGEST_ID} .canvas-slash-opt {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--lumiverse-radius);
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text);
      cursor: pointer;
      user-select: none;
      transition: background 120ms ease;
    }
    #${SUGGEST_ID} .canvas-slash-opt:hover {
      background: var(--lumiverse-fill-subtle);
    }
    #${SUGGEST_ID} .canvas-slash-opt[data-active="true"] {
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-text);
    }
    #${SUGGEST_ID} .canvas-slash-opt[data-active="true"] .canvas-slash-opt-name {
      color: var(--lumiverse-primary);
    }
    #${SUGGEST_ID} .canvas-slash-opt-body {
      display: flex;
      flex-direction: column;
      gap: 1px;
      flex: 1;
      min-width: 0;
    }
    #${SUGGEST_ID} .canvas-slash-opt-name {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      color: var(--lumiverse-text);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${SUGGEST_ID} .canvas-slash-opt-desc {
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${SUGGEST_ID} .canvas-slash-opt-source {
      font-size: calc(10px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      padding: 2px 6px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-fill-subtle);
      flex-shrink: 0;
      max-width: 80px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes canvas-slash-suggest-fade {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `);
}
function escapeHtml2(s3) {
  return s3.replace(/[&<>"']/g, (c3) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c3] ?? c3);
}
function escapeAttr(s3) {
  return escapeHtml2(s3);
}
var SUGGEST_ID = "canvas-slash-suggest", STYLE_ID4 = "canvas-slash-suggest-styles", _currentController = null, outsideDismissListener = null, currentAnchor = null, currentEl = null;
var init_suggest = __esm(() => {
  init_ghost_text();
  init_intent();
});

// src/dom/selectors.ts
var SELECTOR_TEXTAREA = 'textarea[name="chat-message"]', SELECTOR_SEND_BTN = 'button[class*="sendBtn"]';

// src/slash/intercept.ts
function installIntercept(_ctx2, callbacks) {
  const keydownHandler = (e3) => {
    const target = e3.target;
    if (!target || target.tagName !== "TEXTAREA")
      return;
    if (target.getAttribute("name") !== "chat-message")
      return;
    const ta = target;
    const popupVisible = isSuggestVisible();
    if (e3.key === "Escape") {
      if (popupVisible) {
        e3.preventDefault();
        e3.stopPropagation();
        hideSuggest();
      }
      return;
    }
    if (e3.isComposing)
      return;
    const ctrl = popupVisible ? getSuggestController() : null;
    if (e3.key === "ArrowDown" || e3.key === "ArrowUp") {
      if (!ctrl)
        return;
      e3.preventDefault();
      e3.stopPropagation();
      e3.stopImmediatePropagation();
      ctrl.setActiveIndex(e3.key === "ArrowDown" ? ctrl.getActiveIndex() + 1 : ctrl.getActiveIndex() - 1);
      return;
    }
    if (e3.key === "ArrowRight") {
      if (!popupVisible || !ctrl)
        return;
      if (ta.selectionStart !== ta.value.length || ta.selectionEnd !== ta.value.length) {
        return;
      }
      if (!isValidSlashContext(ta)) {
        hideSuggest();
        return;
      }
      if (hasGhost() && acceptGhost(ta)) {
        e3.preventDefault();
        e3.stopPropagation();
        e3.stopImmediatePropagation();
        hideSuggest();
        callbacks.onTextChange(ta.value);
        return;
      }
      const activeCmd = ctrl.getActiveCommand();
      if (!activeCmd)
        return;
      if (textareaHasUsage(ta, activeCmd)) {
        hideSuggest();
        return;
      }
      e3.preventDefault();
      e3.stopPropagation();
      e3.stopImmediatePropagation();
      applySuggestion(ta, suggestionLabel(activeCmd));
      hideSuggest();
      callbacks.onTextChange(ta.value);
      return;
    }
    if (e3.key === "Tab") {
      if (!ctrl)
        return;
      const activeCmd = ctrl.getActiveCommand();
      if (!activeCmd) {
        hideSuggest();
        return;
      }
      if (!isValidSlashContext(ta)) {
        hideSuggest();
        return;
      }
      if (textareaHasUsage(ta, activeCmd)) {
        hideSuggest();
        return;
      }
      e3.preventDefault();
      e3.stopPropagation();
      e3.stopImmediatePropagation();
      if (hasGhost() && acceptGhost(ta)) {
        hideSuggest();
        callbacks.onTextChange(ta.value);
        return;
      }
      applySuggestion(ta, suggestionLabel(activeCmd));
      hideSuggest();
      callbacks.onTextChange(ta.value);
      return;
    }
    if (e3.key === "Enter" && !e3.shiftKey) {
      if (popupVisible) {
        if (!ctrl) {
          hideSuggest();
          return;
        }
        const activeCmd = ctrl.getActiveCommand();
        if (!activeCmd) {
          hideSuggest();
          return;
        }
        if (!isValidSlashContext(ta)) {
          hideSuggest();
          return;
        }
        if (textareaHasUsage(ta, activeCmd)) {
          e3.preventDefault();
          e3.stopPropagation();
          e3.stopImmediatePropagation();
          hideSuggest();
          ta.focus();
          return;
        }
        e3.preventDefault();
        e3.stopPropagation();
        e3.stopImmediatePropagation();
        if (hasGhost() && acceptGhost(ta)) {
          const parsed3 = parseCommand(ta.value.trimEnd());
          if (parsed3)
            setIntent(parsed3, "enter-popup");
          hideSuggest();
          ta.focus();
          callbacks.onTextChange(ta.value);
          return;
        }
        const label = suggestionLabel(activeCmd);
        applySuggestion(ta, label);
        const parsed2 = parseCommand(label);
        if (parsed2)
          setIntent(parsed2, "enter-popup");
        hideSuggest();
        ta.focus();
        callbacks.onTextChange(ta.value);
        return;
      }
      clearIntent();
      const parsed = parseCommand(ta.value);
      if (parsed) {
        e3.preventDefault();
        e3.stopPropagation();
        e3.stopImmediatePropagation();
        setSkipNextTextChange();
        setControlledValue(ta, "");
        hideSuggest();
        callbacks.onParsed(parsed, ta);
        return;
      }
    }
  };
  document.addEventListener("keydown", keydownHandler, true);
  const compositionStartHandler = () => {
    _isComposing = true;
  };
  const compositionEndHandler = (e3) => {
    _isComposing = false;
    const target = e3.target;
    if (!target || target.tagName !== "TEXTAREA")
      return;
    if (target.getAttribute("name") !== "chat-message")
      return;
    const ta = target;
    queueMicrotask(() => callbacks.onTextChange(ta.value));
  };
  document.addEventListener("compositionstart", compositionStartHandler, true);
  document.addEventListener("compositionend", compositionEndHandler, true);
  const clickHandler = (e3) => {
    const target = e3.target;
    if (!target)
      return;
    if (!target.closest(SELECTOR_SEND_BTN))
      return;
    const ta = document.querySelector(SELECTOR_TEXTAREA);
    if (!ta)
      return;
    let parsed = null;
    const intent = getIntent();
    if (intent) {
      const cmdPrefix = "/" + intent.command.name;
      if (ta.value.startsWith(cmdPrefix)) {
        const args = ta.value.startsWith(cmdPrefix + " ") ? ta.value.slice(cmdPrefix.length + 1) : intent.command.args;
        parsed = { name: intent.command.name, args };
      } else if (ta.value.trim() === "" || ta.value === "/") {
        parsed = intent.command;
      }
      clearIntent();
    }
    if (!parsed) {
      parsed = parseCommand(ta.value);
    }
    if (!parsed)
      return;
    e3.preventDefault();
    e3.stopPropagation();
    e3.stopImmediatePropagation();
    setSkipNextTextChange();
    setControlledValue(ta, "");
    hideSuggest();
    callbacks.onParsed(parsed, ta);
  };
  document.addEventListener("click", clickHandler, true);
  const touchHandler = (e3) => {
    const target = e3.target;
    if (!target)
      return;
    if (!target.closest(SELECTOR_SEND_BTN))
      return;
    const ta = document.querySelector(SELECTOR_TEXTAREA);
    if (!ta)
      return;
    let parsed = null;
    const intent = getIntent();
    if (intent) {
      const cmdPrefix = "/" + intent.command.name;
      if (ta.value.startsWith(cmdPrefix)) {
        const args = ta.value.startsWith(cmdPrefix + " ") ? ta.value.slice(cmdPrefix.length + 1) : intent.command.args;
        parsed = { name: intent.command.name, args };
      } else if (ta.value.trim() === "" || ta.value === "/") {
        parsed = intent.command;
      }
      clearIntent();
    }
    if (!parsed) {
      parsed = parseCommand(ta.value);
    }
    if (!parsed)
      return;
    e3.preventDefault();
    e3.stopPropagation();
    e3.stopImmediatePropagation();
    setSkipNextTextChange();
    setControlledValue(ta, "");
    hideSuggest();
    callbacks.onParsed(parsed, ta);
  };
  document.addEventListener("touchend", touchHandler, true);
  const inputHandler = (e3) => {
    const target = e3.target;
    if (!target || target.tagName !== "TEXTAREA")
      return;
    if (target.getAttribute("name") !== "chat-message")
      return;
    if (_isComposing)
      return;
    if (consumeSkipNextTextChange()) {
      return;
    }
    const value = target.value;
    reconcileWithTextarea(value);
    callbacks.onTextChange(value);
  };
  document.addEventListener("input", inputHandler, true);
  return () => {
    document.removeEventListener("keydown", keydownHandler, true);
    document.removeEventListener("click", clickHandler, true);
    document.removeEventListener("touchend", touchHandler, true);
    document.removeEventListener("input", inputHandler, true);
    document.removeEventListener("compositionstart", compositionStartHandler, true);
    document.removeEventListener("compositionend", compositionEndHandler, true);
    _isComposing = false;
    resetSkipNextTextChange();
    clearIntent();
    hideSuggest();
  };
}
var _isComposing = false;
var init_intercept = __esm(() => {
  init_intent();
  init_suggest();
  init_ghost_text();
});

// src/slash/builtin-help.ts
function makeHelpCommand(registry) {
  return {
    name: "help",
    description: "List all available slash commands",
    usage: "/help",
    owner: "canvas",
    category: "meta",
    handler: (_args, ctx) => {
      const cmds = registry.list();
      const lines = cmds.map((c3) => `${c3.usage ?? "/" + c3.name}  —  ${c3.description}`);
      ctx.toast("info", lines.join(`
`));
    }
  };
}

// src/slash/arg-completions.ts
function commandNameToken(text) {
  if (!text.startsWith("/"))
    return null;
  const spaceIdx = text.indexOf(" ");
  const end = spaceIdx >= 0 ? spaceIdx : text.length;
  const start = 1;
  return {
    start,
    end,
    typedPrefix: text.slice(start, end)
  };
}
function parseArgMode(text) {
  if (!text.startsWith("/"))
    return null;
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx < 0)
    return null;
  const cmdName = text.slice(1, spaceIdx);
  if (!cmdName)
    return null;
  let argStart = spaceIdx + 1;
  while (argStart < text.length && /\s/.test(text[argStart])) {
    argStart++;
  }
  const argEnd = text.length;
  const argPrefix = text.slice(argStart, argEnd);
  return { cmdName, argPrefix, argStart, argEnd };
}
function filterPrefix(candidates, prefix) {
  if (prefix === "")
    return candidates.slice();
  const lower = prefix.toLowerCase();
  return candidates.filter((c3) => c3.toLowerCase().startsWith(lower));
}
function pickActive(candidates, activeIndex) {
  if (candidates.length === 0)
    return null;
  if (activeIndex < 0 || activeIndex >= candidates.length)
    return null;
  return candidates[activeIndex] ?? null;
}

// src/slash/commands/select/parser.ts
function parseSelectArgs(input) {
  if (typeof input !== "string")
    return { kind: "error", reason: "Input is not a string" };
  let trimmed = input.trim();
  const prefixMatch = /(?:^|\s)\/select(?=\s|$|\d)/i.exec(trimmed);
  if (prefixMatch) {
    trimmed = trimmed.slice(prefixMatch[0].length).replace(/^\s+/, "");
  }
  if (trimmed === "")
    return { kind: "error", reason: "No range provided" };
  if (/^all$/i.test(trimmed))
    return { kind: "all" };
  if (/^clear$/i.test(trimmed))
    return { kind: "clear" };
  const chunks = trimmed.split(",").map((c3) => c3.trim()).filter((c3) => c3 !== "");
  if (chunks.length === 0)
    return { kind: "error", reason: "No range provided" };
  const indices = new Set;
  for (const chunk of chunks) {
    if (chunk.startsWith("-") || chunk.endsWith("-")) {
      return { kind: "error", reason: `Malformed range: "${chunk}"` };
    }
    if (chunk.includes("--")) {
      return { kind: "error", reason: `Malformed range: "${chunk}"` };
    }
    const normalized = chunk.replace(/\s+/g, "-");
    const parts = normalized.split("-").filter((p3) => p3 !== "");
    let from;
    let to;
    if (parts.length === 1) {
      const n2 = parseIntStrict(parts[0]);
      if (n2 === null)
        return { kind: "error", reason: `Invalid number: "${parts[0]}"` };
      from = n2;
      to = n2;
    } else if (parts.length === 2) {
      const a3 = parseIntStrict(parts[0]);
      const b2 = parseIntStrict(parts[1]);
      if (a3 === null)
        return { kind: "error", reason: `Invalid number: "${parts[0]}"` };
      if (b2 === null)
        return { kind: "error", reason: `Invalid number: "${parts[1]}"` };
      from = Math.min(a3, b2);
      to = Math.max(a3, b2);
    } else {
      return { kind: "error", reason: `Malformed range: "${chunk}"` };
    }
    if (from < 0)
      return { kind: "error", reason: "Negative indices not allowed" };
    if (to - from + 1 > MAX_INDICES) {
      return { kind: "error", reason: `Range too large (max ${MAX_INDICES} indices)` };
    }
    for (let i3 = from;i3 <= to; i3++)
      indices.add(i3);
  }
  if (indices.size === 0)
    return { kind: "error", reason: "No valid indices parsed" };
  return { kind: "range", indices };
}
function parseIntStrict(s3) {
  if (!/^\d+$/.test(s3))
    return null;
  const n2 = Number(s3);
  if (!Number.isSafeInteger(n2) || n2 < 0)
    return null;
  return n2;
}
var MAX_INDICES = 999999;

// src/slash/commands/select/extract.ts
function parseIndexFromText(text) {
  if (typeof text !== "string")
    return null;
  const trimmed = text.trim();
  const m3 = INDEX_RE.exec(trimmed);
  if (!m3)
    return null;
  const n2 = parseInt(m3[1], 10);
  if (!Number.isSafeInteger(n2) || n2 < 0)
    return null;
  return n2;
}
function readIndexInChat(row) {
  if (!row)
    return null;
  const pill = row.querySelector('[class*="metaPill"]');
  if (pill) {
    const seg = pill.querySelector('[class*="metaSegment"]');
    if (seg) {
      const n2 = parseIndexFromText(seg.textContent);
      if (n2 !== null)
        return n2;
    }
  }
  return readIndexInChatFromFiber(row);
}
function readIndexInChatFromFiber(row) {
  const rootFiber = getFiberFromElement(row);
  if (!rootFiber)
    return null;
  let fiber = rootFiber;
  let depth = 0;
  const MAX_DEPTH = 20;
  while (fiber && depth < MAX_DEPTH) {
    const props = fiber.memoizedProps || fiber.pendingProps;
    if (props && typeof props === "object" && "message" in props) {
      const message = props.message;
      if (message && typeof message === "object" && "index_in_chat" in message) {
        const n2 = message.index_in_chat;
        if (typeof n2 === "number" && Number.isSafeInteger(n2) && n2 >= 0) {
          return n2;
        }
      }
    }
    fiber = fiber.return;
    depth++;
  }
  return null;
}
var INDEX_RE;
var init_extract = __esm(() => {
  init_fiber();
  INDEX_RE = /^#(\d+)/;
});

// src/slash/commands/select/selection.ts
function isSelectModeActive() {
  return document.querySelector(`[${SELECT_MODE_ATTR}="true"]`) !== null;
}
function ensureSelectMode() {
  if (isSelectModeActive())
    return;
  const candidates = document.querySelectorAll(SELECTOR_SELECT_TOGGLE);
  if (candidates.length === 0)
    return;
  for (const btn of Array.from(candidates)) {
    if (btn.closest(`[${SELECT_MODE_ATTR}]`)) {
      btn.click();
      return;
    }
  }
  candidates[0].click();
}
function clearSelection() {
  if (!isSelectModeActive())
    return;
  const candidates = document.querySelectorAll(SELECTOR_SELECT_TOGGLE);
  for (const btn of Array.from(candidates)) {
    if (btn.closest(`[${SELECT_MODE_ATTR}]`)) {
      btn.click();
      return;
    }
  }
  candidates[0]?.click();
}
function waitForSelectModeActive(timeoutMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isSelectModeActive()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
async function selectByVisualIndices(indices) {
  if (indices.size === 0) {
    clearSelection();
    return { matched: 0, unreadable: 0, missingIndices: [] };
  }
  ensureSelectMode();
  const ready = await waitForSelectModeActive();
  if (!ready) {
    dwarn("selectByVisualIndices: select mode did not activate within timeout");
    return { matched: 0, unreadable: 0, missingIndices: Array.from(indices) };
  }
  const matchedIndices = new Set;
  let unreadable = 0;
  let clicked = 0;
  const rows = document.querySelectorAll(SELECTOR_MESSAGE_ROW);
  for (const row of Array.from(rows)) {
    const idx = readIndexInChat(row);
    if (idx === null) {
      unreadable++;
      continue;
    }
    const shouldBeSelected = indices.has(idx);
    const isCurrentlySelected = /(?:^|\s|_)selected(?:_|$|\s)/.test(row.className);
    if (shouldBeSelected === isCurrentlySelected) {
      if (shouldBeSelected)
        matchedIndices.add(idx);
      continue;
    }
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    clicked++;
    if (shouldBeSelected)
      matchedIndices.add(idx);
  }
  const missingIndices = [];
  for (const i3 of indices) {
    if (!matchedIndices.has(i3))
      missingIndices.push(i3);
  }
  return { matched: matchedIndices.size, unreadable, missingIndices };
}
var SELECTOR_SELECT_TOGGLE = 'button[class*="toolbarBtn"]', SELECTOR_MESSAGE_ROW = '[data-component="BubbleMessage"]', SELECT_MODE_ATTR = "data-select-mode";
var init_selection = __esm(() => {
  init_extract();
  init_log();
});

// src/slash/commands/select/index.ts
function makeSelectCommands() {
  return [
    {
      name: "select",
      description: "Select a range of messages (Example: /select 15-30)",
      usage: "/select",
      owner: "canvas",
      category: "select",
      getArgCompletions: (prefix) => filterPrefix(SELECT_ARG_KEYWORDS, prefix),
      handler: async (args, ctx) => {
        const raw = args._raw ?? "";
        const parsed = parseSelectArgs(raw);
        if (!parsed) {
          ctx.toast("error", "Usage: /select <range>");
          return;
        }
        if (parsed.kind === "error") {
          ctx.toast("error", `Invalid /select args: ${parsed.reason}`);
          return;
        }
        switch (parsed.kind) {
          case "all":
            return handleAll(ctx);
          case "clear":
            return handleClear(ctx);
          case "range":
            return handleRange(ctx, parsed.indices);
        }
      }
    },
    {
      name: "select-all",
      description: "Select all loaded messages",
      usage: "/select-all",
      owner: "canvas",
      category: "select",
      handler: async (_args, ctx) => handleAll(ctx)
    },
    {
      name: "select-clear",
      description: "Clear the current selection",
      usage: "/select-clear",
      owner: "canvas",
      category: "select",
      handler: async (_args, ctx) => handleClear(ctx)
    }
  ];
}
async function handleAll(ctx) {
  const indices = new Set;
  const rows = document.querySelectorAll(SELECTOR_MESSAGE_ROW2);
  for (const row of Array.from(rows)) {
    const idx = readIndexInChat(row);
    if (idx !== null)
      indices.add(idx);
  }
  if (indices.size === 0) {
    ctx.toast("info", "No loaded messages to select");
    return;
  }
  const result = await selectByVisualIndices(indices);
  toastResult(ctx, result, "Selected all loaded messages");
}
function handleClear(ctx) {
  if (!isSelectModeActive()) {
    ctx.toast("info", "No active selection to clear");
    return;
  }
  clearSelection();
  ctx.toast("info", "Selection cleared");
}
async function handleRange(ctx, indices) {
  if (indices.size === 0) {
    ctx.toast("error", "Empty range");
    return;
  }
  const result = await selectByVisualIndices(indices);
  toastResult(ctx, result, null);
}
function toastResult(ctx, result, fallback) {
  const { matched, missingIndices, unreadable } = result;
  if (matched === 0) {
    if (missingIndices.length > 0) {
      ctx.toast("info", `None of the ${missingIndices.length} requested messages are loaded.`);
    } else if (unreadable > 0) {
      ctx.toast("error", `Could not read an index from ${unreadable} row(s)`);
    } else {
      ctx.toast("info", fallback ?? "No selection performed");
    }
    return;
  }
  if (missingIndices.length > 0) {
    ctx.toast("info", `Selected ${matched} messages. ${missingIndices.length} out of range.`);
  } else {
    ctx.toast("success", fallback ?? `Selected ${matched} messages`);
  }
}
var SELECTOR_MESSAGE_ROW2 = '[data-component="BubbleMessage"]', SELECT_ARG_KEYWORDS;
var init_select = __esm(() => {
  init_extract();
  init_selection();
  SELECT_ARG_KEYWORDS = ["all", "clear"];
});

// src/slash/commands/newchat/index.ts
function findToolsButton() {
  const selectors = [
    'button[title*="tools" i]',
    'button[title*="Tools" i]',
    'button[class*="actionBtn"]',
    "button svg"
  ];
  for (const selector of selectors) {
    const buttons = document.querySelectorAll(selector);
    for (const el of buttons) {
      const btn = el.closest("button") || el;
      if (btn instanceof HTMLElement) {
        const title = btn.getAttribute("title")?.toLowerCase() || "";
        const text = btn.textContent?.toLowerCase() || "";
        if (title.includes("tools") || text.includes("tools")) {
          return btn;
        }
      }
    }
  }
  const allButtons = document.querySelectorAll("button");
  for (const btn of Array.from(allButtons)) {
    const title = btn.getAttribute("title")?.toLowerCase() || "";
    const text = btn.textContent?.toLowerCase() || "";
    if (title.includes("tools") || text.includes("tools")) {
      return btn;
    }
  }
  return null;
}
function findNewChatButtonInPopover() {
  const buttons = document.querySelectorAll("button");
  for (const btn of Array.from(buttons)) {
    const text = btn.textContent?.trim().toLowerCase() || "";
    if (text.includes("new chat") || text.includes("newchat")) {
      const parent = btn.closest('[class*="popover"]') || btn.closest('[class*="popRow"]');
      if (parent) {
        return btn;
      }
    }
  }
  const svgButtons = document.querySelectorAll("button svg");
  for (const svg of Array.from(svgButtons)) {
    const btn = svg.closest("button");
    if (btn instanceof HTMLElement) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (text.includes("new chat") || text.includes("newchat")) {
        return btn;
      }
    }
  }
  return null;
}
function makeNewChatCommand() {
  return {
    name: "new-chat",
    description: "Start a new chat with the currently selected character",
    usage: "/new-chat",
    owner: "canvas",
    category: "chat",
    handler: async (_args, ctx) => {
      ctx.setText("");
      const toolsButton = findToolsButton();
      if (!toolsButton) {
        ctx.toast("error", "Could not find tools button");
        return;
      }
      toolsButton.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const newChatButton = findNewChatButtonInPopover();
      if (!newChatButton) {
        ctx.toast("error", "Could not find New Chat button in popover");
        return;
      }
      newChatButton.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      ctx.toast("success", "New chat started");
    }
  };
}

// src/slash/commands/persona/index.ts
function extractPersonaLabel(text) {
  const t3 = text.trim();
  if (!t3)
    return "";
  if (t3.length > 1 && t3[0].toLowerCase() === t3[1].toLowerCase()) {
    return t3.slice(1).trim();
  }
  return t3;
}
function cacheValid(chatId) {
  return _cache !== null && _cache.chatId === chatId && Date.now() - _cache.fetchedAt < CACHE_TTL_MS3;
}
function getCachedNames(chatId) {
  if (cacheValid(chatId))
    return _cache.names;
  return [];
}
function warmPersonaCache(chatId) {
  if (_warming)
    return;
  if (cacheValid(chatId))
    return;
  const personaButton = findPersonaButton();
  if (!personaButton)
    return;
  _warming = true;
  const stop = capturePersonaPopoverNames((names) => {
    _cache = { chatId, names, fetchedAt: Date.now() };
    _warming = false;
    window.dispatchEvent(new CustomEvent("canvas:slash-completions-changed"));
  });
  personaButton.click();
  setTimeout(() => {
    if (_warming) {
      _warming = false;
      stop();
      if (!cacheValid(chatId)) {
        _cache = { chatId, names: [], fetchedAt: Date.now() - CACHE_TTL_MS3 + 1500 };
      }
    }
  }, 500);
}
function findPersonaButton() {
  const allButtons = document.querySelectorAll("button");
  for (const btn of Array.from(allButtons)) {
    const title = btn.getAttribute("title") || "";
    const titleLower = title.toLowerCase();
    if ((titleLower.includes("switch persona") || titleLower.includes("send as persona")) && !titleLower.startsWith("personas")) {
      return btn;
    }
  }
  return null;
}
function hidePopoversAsTheyAppear() {
  let resolved = false;
  const observer = new MutationObserver((mutations) => {
    if (resolved)
      return;
    for (const m3 of mutations) {
      for (const node of m3.addedNodes) {
        if (!(node instanceof HTMLElement))
          continue;
        if (node.getAttribute("data-canvas-slash"))
          continue;
        if (node.matches?.('[class*="popover"]')) {
          node.style.display = "none";
          resolved = true;
          observer.disconnect();
          return;
        }
        const child = node.querySelector?.('[class*="popover"]:not([data-canvas-slash])');
        if (child) {
          child.style.display = "none";
          resolved = true;
          observer.disconnect();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => {
    if (!resolved)
      observer.disconnect();
  }, 500);
  return () => {
    resolved = true;
    observer.disconnect();
  };
}
function capturePersonaPopoverNames(onNames) {
  let resolved = false;
  const observer = new MutationObserver((mutations) => {
    if (resolved)
      return;
    for (const m3 of mutations) {
      for (const node of m3.addedNodes) {
        if (!(node instanceof HTMLElement))
          continue;
        if (node.getAttribute("data-canvas-slash"))
          continue;
        let popover = null;
        if (node.matches?.('[class*="popover"]')) {
          popover = node;
        } else {
          popover = node.querySelector?.('[class*="popover"]:not([data-canvas-slash])') ?? null;
        }
        if (!popover)
          continue;
        const names = [];
        const buttons = popover.querySelectorAll("button");
        for (const btn of Array.from(buttons)) {
          const raw = (btn.textContent ?? "").trim();
          if (!raw)
            continue;
          const lower = raw.toLowerCase();
          if (lower.includes("clear") || lower.includes("manage") || lower.includes("select")) {
            continue;
          }
          const label = extractPersonaLabel(raw);
          if (label && !names.some((n2) => n2.toLowerCase() === label.toLowerCase())) {
            names.push(label);
          }
        }
        popover.style.display = "none";
        resolved = true;
        observer.disconnect();
        onNames(names);
        try {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        } catch {}
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => {
    if (!resolved)
      observer.disconnect();
  }, 500);
  return () => {
    resolved = true;
    observer.disconnect();
  };
}
async function findPersonaItemByName(name) {
  const lower = name.toLowerCase();
  for (let i3 = 0;i3 < 100; i3++) {
    await new Promise((r3) => requestAnimationFrame(r3));
    const buttons = document.querySelectorAll("button");
    for (const btn of Array.from(buttons)) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (text === lower) {
        return btn;
      }
      if (text.length > 1 && text.substring(1) === lower) {
        return btn;
      }
      if (text.length > 1 && text.substring(1).startsWith(lower)) {
        const withoutPrefix = text.substring(1);
        if (!withoutPrefix.includes("clear") && !withoutPrefix.includes("manage") && !withoutPrefix.includes("select")) {
          return btn;
        }
      }
    }
  }
  return null;
}
function makePersonaCommand() {
  return {
    name: "persona",
    description: "Switch the active persona in the current chat (Example: /persona Bob)",
    usage: "/persona",
    owner: "canvas",
    category: "chat",
    getArgCompletions: (prefix, ctx) => {
      warmPersonaCache(ctx.chatId);
      return filterPrefix(getCachedNames(ctx.chatId), prefix);
    },
    handler: async (args, ctx) => {
      const personaName = args._raw?.trim();
      if (!personaName) {
        ctx.toast("error", "Usage: /persona <name>");
        ctx.setText("");
        return;
      }
      ctx.setText("");
      const personaButton = findPersonaButton();
      if (!personaButton) {
        ctx.toast("error", "Could not find persona button");
        return;
      }
      hidePopoversAsTheyAppear();
      personaButton.click();
      const target = await findPersonaItemByName(personaName);
      if (!target) {
        ctx.toast("error", `Persona not found: ${personaName}`);
        return;
      }
      target.click();
      await new Promise((r3) => requestAnimationFrame(r3));
      await new Promise((r3) => requestAnimationFrame(r3));
      ctx.toast("success", `Switched to persona: ${personaName}`);
    }
  };
}
var CACHE_TTL_MS3 = 60000, _cache = null, _warming = false;
var init_persona = () => {};

// src/slash/microtask.ts
function defer(fn) {
  return new Promise((resolve, reject) => {
    if (typeof MessageChannel === "function") {
      const ch = new MessageChannel;
      ch.port1.onmessage = () => {
        try {
          Promise.resolve(fn()).then(resolve, reject);
        } catch (e3) {
          reject(e3);
        }
      };
      ch.port2.postMessage(null);
    } else {
      queueMicrotask(() => {
        try {
          Promise.resolve(fn()).then(resolve, reject);
        } catch (e3) {
          reject(e3);
        }
      });
    }
  });
}

// src/slash/dispatch.ts
async function dispatchCommand(parsed, ctx, registry) {
  const cmd = registry.lookup(parsed.name);
  if (!cmd) {
    ctx.toast("error", `Unknown command: /${parsed.name}. Try /help.`);
    return;
  }
  const args = parseSimpleArgs(parsed.args);
  try {
    await defer(() => cmd.handler(args, ctx));
  } catch (e3) {
    const msg = e3 instanceof Error ? e3.message : String(e3);
    ctx.toast("error", `/${cmd.name} failed: ${msg}`);
    dwarn(`${cmd.name} failed:`, e3);
  }
}
function parseSimpleArgs(raw) {
  const out = {};
  if (!raw)
    return out;
  out._raw = raw;
  return out;
}
var init_dispatch = __esm(() => {
  init_log();
});

// src/slash/toast.tsx
function pushToast(kind, text) {
  const id = ++nextId;
  toasts = [...toasts, { id, kind, text }];
  listeners.forEach((l3) => l3(toasts));
  const timer = setTimeout(() => {
    _toastTimers.delete(timer);
    toasts = toasts.filter((t3) => t3.id !== id);
    listeners.forEach((l3) => l3(toasts));
  }, 4000);
  _toastTimers.add(timer);
}
function ToastSurface() {
  const [list, setList] = d2(toasts);
  y2(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return /* @__PURE__ */ u3("div", {
    class: "canvas-slash-toast-surface",
    "data-canvas-slash": "toast-surface",
    children: list.map((t3) => /* @__PURE__ */ u3("div", {
      class: `canvas-slash-toast canvas-slash-toast--${t3.kind}`,
      "data-kind": t3.kind,
      children: t3.text
    }, t3.id, false, undefined, this))
  }, undefined, false, undefined, this);
}
function handleToastEvent(e3) {
  const { kind, text } = e3.detail;
  pushToast(kind, text);
}
function mountToastSurface() {
  if (mounted)
    return unmountToastSurface;
  mounted = true;
  injectToastStyles();
  toastHostEl = document.createElement("div");
  toastHostEl.id = "canvas-slash-toast-host";
  document.body.appendChild(toastHostEl);
  R(k(ToastSurface, {}), toastHostEl);
  toastEventHandler = handleToastEvent;
  window.addEventListener("canvas:slash-toast", toastEventHandler);
  return unmountToastSurface;
}
function unmountToastSurface() {
  for (const timer of _toastTimers)
    clearTimeout(timer);
  _toastTimers.clear();
  if (toastHostEl) {
    toastHostEl.remove();
    toastHostEl = null;
  }
  if (toastEventHandler) {
    window.removeEventListener("canvas:slash-toast", toastEventHandler);
    toastEventHandler = null;
  }
  mounted = false;
  toasts = [];
}
function injectToastStyles() {
  injectStyles(STYLE_ID5, `
    .canvas-slash-toast-surface {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 10004;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 400px;
      pointer-events: none;
    }
    .canvas-slash-toast {
      background: var(--lumiverse-bg-elevated);
      border: 1px solid var(--lumiverse-border);
      border-left-width: 3px;
      border-left-style: solid;
      border-radius: var(--lumiverse-radius);
      padding: 8px 12px;
      font-family: var(--lumiverse-font-family);
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text);
      white-space: pre-wrap;
      box-shadow: var(--lumiverse-shadow-md);
      pointer-events: auto;
    }
    .canvas-slash-toast--error  { border-left-color: var(--lumiverse-danger); }
    .canvas-slash-toast--success { border-left-color: var(--lumiverse-success); }
    /* --lumiverse-info is referenced with a #42a5f5 fallback in core modals
       (InputArea.tsx:2705, RegexEditorModal.module.css, etc.). Preserved
       here for consistency; the var is not defined in variables.css. */
    .canvas-slash-toast--info   { border-left-color: var(--lumiverse-info, #42a5f5); }
  `);
}
var STYLE_ID5 = "canvas-slash-toast-styles", nextId = 0, listeners, toasts, _toastTimers, mounted = false, toastHostEl = null, toastEventHandler = null;
var init_toast = __esm(() => {
  init_preact_module();
  init_hooks_module();
  init_jsxRuntime_module();
  listeners = new Set;
  toasts = [];
  _toastTimers = new Set;
});

// src/slash/runtime.ts
function isSlashCommandDef(x2) {
  return typeof x2 === "object" && x2 !== null && "name" in x2 && typeof x2.name === "string" && "description" in x2 && typeof x2.description === "string" && "owner" in x2 && typeof x2.owner === "string" && "handler" in x2 && typeof x2.handler === "function";
}
function argCompletionRows(cmd, candidates) {
  return candidates.map((c3) => ({
    name: c3,
    description: "Complete argument",
    owner: cmd.owner,
    usage: `/${cmd.name} ${c3}`,
    handler: cmd.handler,
    category: cmd.category
  }));
}
function attachSlashRuntime(ctx) {
  const registry = new CommandRegistry;
  registry.register(makeHelpCommand(registry));
  for (const cmd of makeSelectCommands()) {
    registry.register(cmd);
  }
  registry.register(makeNewChatCommand());
  registry.register(makePersonaCommand());
  const unregisterByName = new Map;
  let lastActiveIndex = null;
  const slashCtx = {
    get chatId() {
      return ctx.getActiveChat()?.chatId ?? "";
    },
    setText: (text) => {
      const ta = document.querySelector(SELECTOR_TEXTAREA);
      if (!ta)
        return;
      setControlledValue(ta, text);
    },
    toast: (kind, text) => {
      window.dispatchEvent(new CustomEvent("canvas:slash-toast", { detail: { kind, text } }));
    }
  };
  const syncGhost = (ta, fullArg, start, end, typedPrefix) => {
    if (!fullArg) {
      hideGhost();
      return;
    }
    setGhost(ta, {
      fullArg,
      range: { start, end },
      typedPrefix
    });
  };
  const onTextChange = (text) => {
    if (!text.startsWith("/")) {
      hideSuggest();
      lastActiveIndex = null;
      return;
    }
    const argMode = parseArgMode(text);
    if (argMode) {
      const cmd = registry.lookup(argMode.cmdName) ?? registry.lookup(argMode.cmdName.toLowerCase());
      if (cmd?.getArgCompletions) {
        const candidates = cmd.getArgCompletions(argMode.argPrefix, {
          chatId: slashCtx.chatId
        });
        if (candidates.length === 0) {
          hideSuggest();
          lastActiveIndex = null;
          return;
        }
        const ta2 = document.querySelector(SELECTOR_TEXTAREA);
        if (!ta2)
          return;
        let activeIndex2 = 0;
        if (lastActiveIndex != null && lastActiveIndex >= 0 && lastActiveIndex < candidates.length && argMode.argPrefix.trim().length > 0) {
          activeIndex2 = lastActiveIndex;
        }
        lastActiveIndex = activeIndex2;
        const rows = argCompletionRows(cmd, candidates);
        showSuggest(ta2, rows, activeIndex2, (i3, activeCmd2) => {
          lastActiveIndex = i3;
          const fullArg2 = activeCmd2?.name ?? pickActive(candidates, i3);
          syncGhost(ta2, fullArg2, argMode.argStart, argMode.argEnd, argMode.argPrefix);
        });
        const fullArg = pickActive(candidates, activeIndex2);
        syncGhost(ta2, fullArg, argMode.argStart, argMode.argEnd, argMode.argPrefix);
        return;
      }
      if (cmd && !cmd.getArgCompletions) {
        hideSuggest();
        lastActiveIndex = null;
        return;
      }
    }
    const prefix = text.split(/\s/)[0].slice(1).toLowerCase();
    const matches = registry.list().filter((c3) => c3.name.toLowerCase().startsWith(prefix));
    if (matches.length === 0) {
      hideSuggest();
      lastActiveIndex = null;
      return;
    }
    const ta = document.querySelector(SELECTOR_TEXTAREA);
    if (!ta)
      return;
    const completionIdx = findCompletionCandidateIndex(matches, text);
    if (shouldHideForNonMatchingArgs(text, completionIdx >= 0)) {
      hideSuggest();
      lastActiveIndex = null;
      return;
    }
    const token = commandNameToken(text);
    if (!token) {
      hideSuggest();
      lastActiveIndex = null;
      return;
    }
    const { activeIndex, nextSticky } = resolveActiveIndex(matches, text, lastActiveIndex);
    lastActiveIndex = nextSticky;
    const activeCmd = matches[activeIndex] ?? null;
    showSuggest(ta, matches, activeIndex, (i3, cmd) => {
      lastActiveIndex = i3;
      syncGhost(ta, cmd?.name ?? null, token.start, token.end, token.typedPrefix);
    });
    syncGhost(ta, activeCmd?.name ?? null, token.start, token.end, token.typedPrefix);
  };
  const detachIntercept = installIntercept(ctx, {
    onParsed: (parsed) => {
      dispatchCommand(parsed, slashCtx, registry);
    },
    onTextChange
  });
  const unmountToast = mountToastSurface();
  const registerListener = (e3) => {
    const detail = e3.detail;
    if (isSlashCommandDef(detail?.command)) {
      const prior = unregisterByName.get(detail.command.name);
      if (prior)
        prior();
      const cleanup = registry.register(detail.command);
      unregisterByName.set(detail.command.name, cleanup);
    }
  };
  window.addEventListener("canvas:slash-register", registerListener);
  const unregisterListener = (e3) => {
    const detail = e3.detail;
    if (detail && typeof detail.name === "string") {
      const cleanup = unregisterByName.get(detail.name);
      if (cleanup) {
        cleanup();
        unregisterByName.delete(detail.name);
      }
    }
  };
  window.addEventListener("canvas:slash-unregister", unregisterListener);
  const completionsChangedListener = () => {
    const ta = document.querySelector(SELECTOR_TEXTAREA);
    if (!ta)
      return;
    if (!ta.value.startsWith("/"))
      return;
    onTextChange(ta.value);
  };
  window.addEventListener("canvas:slash-completions-changed", completionsChangedListener);
  return () => {
    unmountToast();
    detachIntercept();
    window.removeEventListener("canvas:slash-register", registerListener);
    window.removeEventListener("canvas:slash-unregister", unregisterListener);
    window.removeEventListener("canvas:slash-completions-changed", completionsChangedListener);
    unregisterByName.clear();
    registry.clear();
    hideGhost();
  };
}
var init_runtime = __esm(() => {
  init_intercept();
  init_select();
  init_persona();
  init_suggest();
  init_dispatch();
  init_toast();
  init_ghost_text();
});

// src/drawerTabPosition/apply.ts
function applyDrawerTabPosition(settings, mainTab, secondaryTab) {
  if (mainTab && settings.mainDrawerTabOverrideVh !== undefined) {
    mainTab.style.marginTop = `${settings.mainDrawerTabOverrideVh}vh`;
  }
  if (secondaryTab && settings.secondaryDrawerTabOverrideVh !== undefined) {
    secondaryTab.style.marginTop = `${settings.secondaryDrawerTabOverrideVh}vh`;
  }
}

// src/drawerTabPosition/drag.ts
function pxToClampedVh(deltaPx, viewportHeight, currentVh, min = 0, max = 70) {
  const deltaVh = deltaPx / viewportHeight * 100;
  const newVh = currentVh + deltaVh;
  return Math.round(Math.min(max, Math.max(min, newVh)) * 10) / 10;
}
function parseVhFromStyle(s3) {
  if (!s3)
    return;
  const num = parseFloat(s3);
  return isNaN(num) ? undefined : num;
}
function readCurrentVh(el) {
  const inline = el.style.marginTop;
  if (inline) {
    if (inline.endsWith("vh"))
      return parseFloat(inline);
    if (inline.endsWith("px"))
      return parseFloat(inline) / window.innerHeight * 100;
    return parseFloat(inline);
  }
  const computed = getComputedStyle(el).marginTop;
  const px = parseFloat(computed);
  if (isNaN(px))
    return 0;
  return px / window.innerHeight * 100;
}
function installDrawerTabDrag(el, role, onCommit, onLiveUpdate) {
  el.setAttribute("aria-label", "Drag to reposition");
  el.style.touchAction = "none";
  let startY = 0;
  let currentVh = 0;
  let isPointerDown = false;
  let hasCrossedThreshold = false;
  let dragInstalled = false;
  let pendingClickRemoval = null;
  const captureClick = (e3) => {
    e3.stopImmediatePropagation();
  };
  const removeCaptureClickNow = () => {
    if (dragInstalled) {
      el.removeEventListener("click", captureClick, true);
      dragInstalled = false;
    }
    if (pendingClickRemoval !== null) {
      clearTimeout(pendingClickRemoval);
      pendingClickRemoval = null;
    }
  };
  const onPointerDown = (e3) => {
    e3.preventDefault();
    isPointerDown = true;
    hasCrossedThreshold = false;
    startY = e3.clientY;
    currentVh = readCurrentVh(el);
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e3) => {
    if (!isPointerDown)
      return;
    const delta = e3.clientY - startY;
    if (!hasCrossedThreshold) {
      if (Math.abs(delta) < 10)
        return;
      hasCrossedThreshold = true;
      if (!dragInstalled) {
        el.addEventListener("click", captureClick, true);
        dragInstalled = true;
      }
    }
    const newVh = pxToClampedVh(delta, window.innerHeight, currentVh);
    el.style.marginTop = `${newVh}vh`;
    el.setAttribute("aria-label", `Position: ${newVh}vh`);
    onLiveUpdate?.(newVh);
  };
  const cleanup = () => {
    if (dragInstalled) {
      if (pendingClickRemoval !== null)
        clearTimeout(pendingClickRemoval);
      pendingClickRemoval = setTimeout(() => {
        if (dragInstalled) {
          el.removeEventListener("click", captureClick, true);
          dragInstalled = false;
        }
        pendingClickRemoval = null;
      }, 0);
    }
    isPointerDown = false;
    hasCrossedThreshold = false;
    el.setAttribute("aria-label", "Drag to reposition");
    document.body.style.userSelect = "";
    startY = 0;
  };
  const onPointerUp = () => {
    if (hasCrossedThreshold) {
      const finalVh = parseVhFromStyle(el.style.marginTop) ?? currentVh;
      dlog(`[drawerTabDrag] ${role} pointerup finalVh=${finalVh}vh → onCommit`);
      onCommit(finalVh);
    }
    cleanup();
  };
  const onPointerCancel = () => {
    cleanup();
  };
  el.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  return () => {
    removeCaptureClickNow();
    el.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    cleanup();
  };
}
var init_drag = __esm(() => {
  init_log();
});

// src/drawerTabPosition/index.ts
var init_drawerTabPosition = __esm(() => {
  init_drag();
});

// src/features/drawer-tab-position.ts
function getMainDrawerTab() {
  const canvasMain = document.querySelector(".sidebar-ux-main-mirror-wrapper .sidebar-ux-drawer-tab");
  if (canvasMain && document.documentElement.classList.contains("sidebar-ux-canvas-main-active")) {
    return canvasMain;
  }
  return document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)');
}
function getSecondaryDrawerTab() {
  return getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
}
var _dragInstalled, drawerTabDragFeature;
var init_drawer_tab_position = __esm(() => {
  init_state();
  init_cleanup();
  init_secondary();
  init_drawerTabPosition();
  init_drag();
  _dragInstalled = new WeakSet;
  drawerTabDragFeature = {
    id: "drawerTabDrag",
    init(_ctx2) {
      if (!getSettings().drawerTabDrag)
        return;
      const observer = new MutationObserver(() => {
        const mainTab2 = getMainDrawerTab();
        if (mainTab2 && !_dragInstalled.has(mainTab2)) {
          _dragInstalled.add(mainTab2);
          const teardown = installDrawerTabDrag(mainTab2, "main", (vh) => {
            setSettings({ mainDrawerTabOverrideVh: vh });
          });
          registerCleanup(teardown);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      registerCleanup(() => observer.disconnect());
      const mainTab = getMainDrawerTab();
      if (mainTab && !_dragInstalled.has(mainTab)) {
        _dragInstalled.add(mainTab);
        const teardown = installDrawerTabDrag(mainTab, "main", (vh) => {
          setSettings({ mainDrawerTabOverrideVh: vh });
        });
        registerCleanup(teardown);
      }
    },
    mount(_ctx2) {
      if (!getSettings().drawerTabDrag)
        return;
      const secondaryTab = getSecondaryDrawerTab();
      if (secondaryTab && !_dragInstalled.has(secondaryTab)) {
        _dragInstalled.add(secondaryTab);
        const teardown = installDrawerTabDrag(secondaryTab, "secondary", (vh) => {
          const settings = getSettings();
          if (settings.mirrorCompactPosition) {
            setSettings({
              secondaryDrawerTabOverrideVh: vh,
              mainDrawerTabOverrideVh: vh
            });
          } else {
            setSettings({ secondaryDrawerTabOverrideVh: vh });
          }
        }, (vh) => {
          if (!getSettings().mirrorCompactPosition)
            return;
          const mainTab = getMainDrawerTab();
          if (mainTab)
            mainTab.style.marginTop = `${vh}vh`;
        });
        registerCleanup(teardown);
      }
      applyDrawerTabPosition(getSettings(), getMainDrawerTab(), getSecondaryDrawerTab());
    },
    apply(prev, next) {
      if (prev.drawerTabDrag === next.drawerTabDrag && prev.mainDrawerTabOverrideVh === next.mainDrawerTabOverrideVh && prev.secondaryDrawerTabOverrideVh === next.secondaryDrawerTabOverrideVh)
        return;
      applyDrawerTabPosition(next, getMainDrawerTab(), getSecondaryDrawerTab());
    }
  };
});

// src/features/registry.ts
function makeLayoutFacetFeature(id) {
  return {
    id,
    apply(prev, next) {
      if (prev[id] === true && next[id] === false) {
        cancelLayoutSave();
      }
    }
  };
}
function makeSlashFeature(attach) {
  let active = null;
  const slashFeature = {
    id: "slashCommandsEnabled",
    mount(ctx) {
      if (typeof window !== "undefined" && window.__slashCommandsActive)
        return;
      if (active)
        return active;
      active = attach(ctx);
      return active;
    },
    apply(_prev, next, ctx) {
      if (typeof window !== "undefined" && window.__slashCommandsActive)
        return;
      if (next.slashCommandsEnabled) {
        if (!active) {
          active = attach(ctx);
        }
      } else {
        if (active) {
          const detach = active;
          active = null;
          detach();
        }
      }
    }
  };
  const disableListener = () => {
    if (active) {
      const detach = active;
      active = null;
      detach();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("canvas:slash-disable", disableListener);
  }
  return {
    feature: slashFeature,
    alwaysCleanup() {
      if (active) {
        active();
        active = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("canvas:slash-disable", disableListener);
      }
    },
    getActiveDetach: () => active
  };
}
function slashAlwaysCleanup() {
  _slashImpl.alwaysCleanup();
}
function alwaysCleanups() {
  return [
    unmountToastSurface,
    cancelApplyLayoutInterval,
    slashAlwaysCleanup
  ];
}
var SHADOW_DISABLE_DESKTOP_ID = "sidebar-ux-shadow-disable-desktop", SHADOW_DISABLE_MOBILE_ID = "sidebar-ux-shadow-disable-mobile", shadowDisableCss = (media, width) => `
  @media (${media}-width: ${width}px) {
    .sidebar-ux-drawer, :has(> [data-spindle-mount="sidebar"]) {
      box-shadow: none !important;
    }
  }
`, debugFeature, _chatReflowTeardown = null, chatReflowFeature, secondSidebarFeature, resizeSidebarsFeature, drawerSyncFeature, shadowsDesktopFeature, shadowsMobileFeature, persistDrawerOpenStateFeature, persistDrawerWidthFeature, _slashImpl, slashFeature, tabPositionFeature, keepTabListVisibleFeature, hideDrawerOpenCloseButtonsFeature, FEATURES;
var init_registry = __esm(() => {
  init_state();
  init_log();
  init_fiber_scan();
  init_reflow();
  init_cleanup();
  init_secondary();
  init_handles();
  init_drawer_sync();
  init_persist();
  init_apply();
  init_runtime();
  init_toast();
  init_tab_position();
  init_main_tab_pin();
  init_strip_gutter();
  init_buttons();
  init_main_mirror_drawer();
  init_drawer_tab_position();
  debugFeature = {
    id: "debugMode",
    apply(prev, next) {
      if (prev.debugMode === next.debugMode)
        return;
      setDebug(next.debugMode);
      if (next.debugMode) {
        installDebugEscapeHatch();
      } else {
        delete window.__canvasDebug;
      }
    }
  };
  chatReflowFeature = {
    id: "chatReflow",
    mount() {
      if (!getSettings().chatReflow)
        return;
      if (_chatReflowTeardown)
        return _chatReflowTeardown;
      _chatReflowTeardown = startReflowObserver();
      return _chatReflowTeardown;
    },
    apply(prev, next) {
      if (prev.chatReflow === next.chatReflow)
        return;
      if (next.chatReflow) {
        injectReflowStyles();
        updateChatReflow();
        if (!_chatReflowTeardown) {
          _chatReflowTeardown = startReflowObserver();
          registerCleanup(_chatReflowTeardown);
        }
      } else {
        document.getElementById("sidebar-ux-reflow")?.remove();
        clearChatMargins();
      }
    }
  };
  secondSidebarFeature = {
    id: "secondSidebarEnabled",
    mount(_ctx2, layout) {
      const s3 = getSettings();
      const initialWidth = s3.persistDrawerWidth ? layout?.secondary?.width : undefined;
      const hasTabsToRestore = (layout?.detachedTabs?.length ?? 0) > 0;
      const initialOpen = !!(s3.persistDrawerOpenState && layout?.secondary?.open === true && hasTabsToRestore);
      mountSecondarySidebar({ initialWidth, initialOpen });
      const teardown = () => {
        tearDownSecondarySidebar();
      };
      return teardown;
    },
    apply(prev, next) {
      if (prev.secondSidebarEnabled === next.secondSidebarEnabled)
        return;
      if (next.secondSidebarEnabled) {
        if (!getSecondaryWrapper()) {
          const s3 = getSettings();
          const layout = getLastLoadedLayout();
          const initialWidth = s3.persistDrawerWidth ? layout?.secondary?.width : undefined;
          const hasTabsToRestore = (layout?.detachedTabs?.length ?? 0) > 0;
          const initialOpen = !!(s3.persistDrawerOpenState && layout?.secondary?.open === true && hasTabsToRestore);
          mountSecondarySidebar({ initialWidth, initialOpen });
          if (layout)
            applyLayout(layout);
        }
      } else {
        tearDownSecondarySidebar();
      }
    }
  };
  resizeSidebarsFeature = {
    id: "resizeSidebars",
    mount() {
      mountResizeHandles();
      return () => {
        getMainDrawer()?.querySelector(".sidebar-ux-resize-handle")?.remove();
        const sec = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer");
        sec?.querySelector(".sidebar-ux-resize-handle")?.remove();
      };
    },
    apply() {
      refreshResizeHandles();
    }
  };
  drawerSyncFeature = {
    id: "mirrorCompactPosition",
    mount() {
      if (getSettings().mirrorCompactPosition)
        syncDrawerTabSettings();
    },
    apply(prev, next) {
      if (prev.mirrorCompactPosition !== next.mirrorCompactPosition) {
        if (next.mirrorCompactPosition) {
          syncDrawerTabSettings();
        } else {
          const drawerTab = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
          if (drawerTab)
            drawerTab.style.marginTop = "";
        }
      }
    }
  };
  shadowsDesktopFeature = {
    id: "drawerShadowsDesktop",
    init() {
      if (!getSettings().drawerShadowsDesktop) {
        injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss("min", 601));
      }
    },
    apply(prev, next) {
      if (prev.drawerShadowsDesktop === next.drawerShadowsDesktop)
        return;
      if (next.drawerShadowsDesktop) {
        document.getElementById(SHADOW_DISABLE_DESKTOP_ID)?.remove();
      } else {
        injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss("min", 601));
      }
    }
  };
  shadowsMobileFeature = {
    id: "drawerShadowsMobile",
    init() {
      if (!getSettings().drawerShadowsMobile) {
        injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss("max", 600));
      }
    },
    apply(prev, next) {
      if (prev.drawerShadowsMobile === next.drawerShadowsMobile)
        return;
      if (next.drawerShadowsMobile) {
        document.getElementById(SHADOW_DISABLE_MOBILE_ID)?.remove();
      } else {
        injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss("max", 600));
      }
    }
  };
  persistDrawerOpenStateFeature = makeLayoutFacetFeature("persistDrawerOpenState");
  persistDrawerWidthFeature = makeLayoutFacetFeature("persistDrawerWidth");
  _slashImpl = makeSlashFeature(attachSlashRuntime);
  slashFeature = _slashImpl.feature;
  tabPositionFeature = {
    id: "moveControlsToOuterEdge",
    init() {
      applyTabListPosition(getSettings().moveControlsToOuterEdge);
    },
    apply(prev, next) {
      if (prev.moveControlsToOuterEdge === next.moveControlsToOuterEdge)
        return;
      applyTabListPosition(next.moveControlsToOuterEdge);
    }
  };
  keepTabListVisibleFeature = {
    id: "keepTabListVisible",
    mount(_ctx2, _layout) {
      const on = !!getSettings().keepTabListVisible && !!getSettings().moveControlsToOuterEdge;
      if (on) {
        reconcileTabListPin();
        reconcileMainTabListPin();
      } else {
        applyTabListPin(false, { force: true });
        applyMainTabListPin(false, { force: true });
      }
      updateDrawerTabVisibility();
      updateStripGutters();
      updateChatReflow();
      return () => {
        applyTabListPin(false, { force: true });
        applyMainTabListPin(false, { force: true });
        updateDrawerTabVisibility();
        clearStripGutters();
        updateChatReflow();
      };
    },
    apply(_prev, next) {
      const on = !!next.keepTabListVisible && !!next.moveControlsToOuterEdge;
      applyTabListPin(on, { force: true });
      applyMainTabListPin(on, { force: true });
      updateDrawerTabVisibility();
      if (on) {
        updateStripGutters();
      } else {
        clearStripGutters();
      }
      updateChatReflow();
    }
  };
  hideDrawerOpenCloseButtonsFeature = {
    id: "hideDrawerOpenCloseButtons",
    mount() {
      updateDrawerTabVisibility();
      updateMainMirrorDrawerTabVisibility();
      return () => {
        updateDrawerTabVisibility();
        updateMainMirrorDrawerTabVisibility();
      };
    },
    apply() {
      updateDrawerTabVisibility();
      updateMainMirrorDrawerTabVisibility();
    }
  };
  FEATURES = [
    debugFeature,
    chatReflowFeature,
    secondSidebarFeature,
    resizeSidebarsFeature,
    drawerSyncFeature,
    shadowsDesktopFeature,
    shadowsMobileFeature,
    persistDrawerOpenStateFeature,
    persistDrawerWidthFeature,
    slashFeature,
    tabPositionFeature,
    keepTabListVisibleFeature,
    hideDrawerOpenCloseButtonsFeature,
    drawerTabDragFeature
  ];
});

// src/settings/render.ts
function buildSettingRow(args) {
  const row = document.createElement("div");
  row.className = "sidebar-ux-panel-row";
  if (args.disabled)
    row.classList.add("sidebar-ux-panel-row-disabled");
  const text = document.createElement("div");
  text.className = "sidebar-ux-panel-row-text";
  const label = document.createElement("div");
  label.className = "sidebar-ux-panel-row-label";
  label.textContent = args.label;
  text.appendChild(label);
  if (args.hint) {
    const hint = document.createElement("div");
    hint.className = "sidebar-ux-panel-row-hint";
    hint.textContent = args.hint;
    text.appendChild(hint);
  }
  row.appendChild(text);
  row.appendChild(args.control);
  return row;
}
function buildToggleControl(value, onChange, disabled) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sidebar-ux-panel-toggle" + (value ? " sidebar-ux-panel-toggle-on" : "");
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(value));
  const knob = document.createElement("span");
  knob.className = "sidebar-ux-panel-toggle-knob";
  btn.appendChild(knob);
  btn.addEventListener("click", () => {
    if (disabled && disabled())
      return;
    const current = btn.getAttribute("aria-checked") === "true";
    onChange(!current);
  });
  return btn;
}

// src/settings/panel.ts
function injectPanelStyles() {
  injectStyles(PANEL_STYLE_ID, `
    .sidebar-ux-panel-root {
      font-family: var(--lumiverse-font-family, sans-serif);
      color: var(--lumiverse-text);
      padding: 4px 0 24px;
    }
    .sidebar-ux-panel-header {
      padding: 4px 0 12px;
      margin: 0;
    }
    .sidebar-ux-panel-header-title {
      margin: 0;
      font-size: calc(18px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-section {
      margin-top: 18px;
    }
    .sidebar-ux-panel-section-title {
      margin: 0 0 8px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050);
      margin-bottom: 6px;
      transition: opacity 0.15s ease;
    }
    .sidebar-ux-panel-row-disabled {
      opacity: 0.45;
    }
    .sidebar-ux-panel-row-text { flex: 1; min-width: 0; }
    .sidebar-ux-panel-row-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-row-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-toggle {
      flex-shrink: 0;
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--lumiverse-fill-strong, rgba(0,0,0,0.3));
      border: 1px solid var(--lumiverse-border);
      cursor: pointer;
      padding: 0;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .sidebar-ux-panel-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lumiverse-text);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .sidebar-ux-panel-toggle-on {
      background: var(--lumiverse-primary);
      border-color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-toggle-on .sidebar-ux-panel-toggle-knob {
      transform: translateX(16px);
      background: white;
    }
    .sidebar-ux-panel-toggle:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    .sidebar-ux-panel-segmented {
      display: inline-flex;
      flex-shrink: 0;
      border: 1px solid var(--lumiverse-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--lumiverse-fill, rgba(0,0,0,0.15));
    }
    .sidebar-ux-panel-segmented-btn {
      padding: 4px 10px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      color: var(--lumiverse-text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .sidebar-ux-panel-segmented-btn:not(:last-child) {
      border-right: 1px solid var(--lumiverse-border);
    }
    .sidebar-ux-panel-segmented-btn-active {
      background: var(--lumiverse-primary);
      color: white;
    }
  `);
}
function buildSettingsPanelDOM() {
  injectPanelStyles();
  const root = document.createElement("div");
  root.className = "sidebar-ux-panel-root";
  const header = document.createElement("div");
  header.className = "sidebar-ux-panel-header";
  const headerTitle = document.createElement("h2");
  headerTitle.className = "sidebar-ux-panel-header-title";
  headerTitle.textContent = "Canvas - Enhanced UI";
  header.appendChild(headerTitle);
  root.appendChild(header);
  const makeToggle = (getValue, setValue, opts = {}) => {
    const btn = buildToggleControl(getValue(), (next) => setValue(next), opts.disabled);
    const refresh2 = () => {
      const v3 = getValue();
      btn.classList.toggle("sidebar-ux-panel-toggle-on", v3);
      btn.setAttribute("aria-checked", String(v3));
    };
    return { btn, refresh: refresh2 };
  };
  const section = (title) => {
    const sec = document.createElement("div");
    sec.className = "sidebar-ux-panel-section";
    const h4 = document.createElement("h4");
    h4.className = "sidebar-ux-panel-section-title";
    h4.textContent = title;
    sec.appendChild(h4);
    return sec;
  };
  const sec1 = section("Chat");
  const chat = makeToggle(() => getSettings().chatReflow, (v3) => setSettings({ chatReflow: v3 }));
  sec1.appendChild(buildSettingRow({
    label: "Center the chat in the visible area",
    hint: "Shifts the chat column by the open-drawer widths so neither drawer covers it.",
    control: chat.btn
  }));
  const slash = makeToggle(() => getSettings().slashCommandsEnabled, (v3) => setSettings({ slashCommandsEnabled: v3 }));
  sec1.appendChild(buildSettingRow({
    label: "Enable slash commands",
    hint: "When on, typing / in the chat input opens the slash-command menu.",
    control: slash.btn
  }));
  const secLayout = section("Layout");
  const persistOpen = makeToggle(() => getSettings().persistDrawerOpenState, (v3) => setSettings({ persistDrawerOpenState: v3 }));
  secLayout.appendChild(buildSettingRow({
    label: "Remember drawer open/close state",
    hint: "Persist drawer open/closed state (and active tab) across sessions.",
    control: persistOpen.btn
  }));
  const persistWidth = makeToggle(() => getSettings().persistDrawerWidth, (v3) => setSettings({ persistDrawerWidth: v3 }));
  secLayout.appendChild(buildSettingRow({
    label: "Remember resized drawer width",
    hint: "Persist drawer widths across sessions.",
    control: persistWidth.btn
  }));
  const secSidebars = section("Drawers");
  const moveControlsToOuter = makeToggle(() => getSettings().moveControlsToOuterEdge, (v3) => setSettings({ moveControlsToOuterEdge: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Move tab controls to outer edge",
    hint: 'Moves the list of tab buttons to be along the edge of the screen instead of the edge of the chat area. Required for "Keep tab controls visible".',
    control: moveControlsToOuter.btn
  }));
  const keepTabListVisible = makeToggle(() => getSettings().keepTabListVisible, (v3) => setSettings({ keepTabListVisible: v3 }), { disabled: () => !getSettings().moveControlsToOuterEdge });
  const keepTabListVisibleRow = buildSettingRow({
    label: "Keep tab controls visible",
    hint: 'Pins tab buttons to the screen edge when a drawer is closed so you can switch tabs without opening it. Requires "Move tab controls to outer edge". Desktop only.',
    control: keepTabListVisible.btn,
    disabled: !getSettings().moveControlsToOuterEdge
  });
  secSidebars.appendChild(keepTabListVisibleRow);
  const hideDrawerTabToggle = makeToggle(() => getSettings().hideDrawerOpenCloseButtons, (v3) => setSettings({ hideDrawerOpenCloseButtons: v3 }), { disabled: () => !getSettings().keepTabListVisible });
  const hideDrawerTabToggleRow = buildSettingRow({
    label: "Hide drawer open/close buttons",
    hint: 'Hides the small button that open/closes the drawer. Requires "Keep tab controls visible".',
    control: hideDrawerTabToggle.btn,
    disabled: !getSettings().keepTabListVisible
  });
  secSidebars.appendChild(hideDrawerTabToggleRow);
  const resizeSidebars = makeToggle(() => getSettings().resizeSidebars, (v3) => setSettings({ resizeSidebars: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Drag to resize drawers",
    hint: "Adds a 4px grab handle on the inner edge of both drawers.",
    control: resizeSidebars.btn
  }));
  const shadowsDesktop = makeToggle(() => getSettings().drawerShadowsDesktop, (v3) => setSettings({ drawerShadowsDesktop: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Drawer shadows (desktop)",
    hint: "Show box-shadow on drawers when the viewport is wider than 600px.",
    control: shadowsDesktop.btn
  }));
  const shadowsMobile = makeToggle(() => getSettings().drawerShadowsMobile, (v3) => setSettings({ drawerShadowsMobile: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Drawer shadows (mobile)",
    hint: "Show box-shadow on drawers when the viewport is 600px or narrower.",
    control: shadowsMobile.btn
  }));
  const sec2 = section("Second drawer");
  const master = makeToggle(() => getSettings().secondSidebarEnabled, (v3) => {
    Promise.resolve().then(() => (init_second_drawer_mode(), exports_second_drawer_mode)).then((m3) => {
      m3.requestSecondDrawerMode(v3);
    }).catch((err) => {
      dwarn("[settings-panel] second-drawer-mode import failed:", err);
      setSettings({ secondSidebarEnabled: v3 });
    });
  });
  sec2.appendChild(buildSettingRow({
    label: "Enable second drawer",
    hint: "Adds a second drawer to the opposite side of the main one. Master switch for all sub-features below.",
    control: master.btn
  }));
  const compact = makeToggle(() => getSettings().mirrorCompactPosition, (v3) => setSettings({ mirrorCompactPosition: v3 }), { disabled: () => !getSettings().secondSidebarEnabled });
  sec2.appendChild(buildSettingRow({
    label: "Mirror compact mode + vertical position",
    hint: "Matches the main drawer's compact/vertical tab position on the secondary drawer.",
    control: compact.btn,
    disabled: !getSettings().secondSidebarEnabled
  }));
  const sec4 = section("Debug");
  const debugMode = makeToggle(() => getSettings().debugMode, (v3) => setSettings({ debugMode: v3 }));
  sec4.appendChild(buildSettingRow({
    label: "Debug mode",
    hint: "Enables [Canvas] console output and installs window.__canvasDebug() for in-browser fiber tree inspection. Useful when filing a bug report.",
    control: debugMode.btn
  }));
  root.appendChild(sec1);
  root.appendChild(secLayout);
  root.appendChild(secSidebars);
  root.appendChild(sec2);
  root.appendChild(sec4);
  const refresh = () => {
    master.refresh();
    moveControlsToOuter.refresh();
    keepTabListVisible.refresh();
    hideDrawerTabToggle.refresh();
    resizeSidebars.refresh();
    compact.refresh();
    chat.refresh();
    persistOpen.refresh();
    persistWidth.refresh();
    slash.refresh();
    debugMode.refresh();
    shadowsDesktop.refresh();
    shadowsMobile.refresh();
    {
      const d3 = !getSettings().moveControlsToOuterEdge;
      keepTabListVisible.btn.disabled = d3;
      keepTabListVisible.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      keepTabListVisibleRow.classList.toggle("sidebar-ux-panel-row-disabled", d3);
    }
    {
      const d3 = !getSettings().keepTabListVisible;
      hideDrawerTabToggle.btn.disabled = d3;
      hideDrawerTabToggle.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      hideDrawerTabToggleRow.classList.toggle("sidebar-ux-panel-row-disabled", d3);
    }
    for (const row of [compact]) {
      const d3 = !getSettings().secondSidebarEnabled;
      row.btn.disabled = d3;
      row.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      row.btn.parentElement?.classList.toggle("sidebar-ux-panel-row-disabled", d3);
    }
  };
  return { root, refresh };
}
function mountSettingsPanel(ctx) {
  try {
    if (!ctx?.ui?.mount) {
      dwarn("mountSettingsPanel: ctx.ui.mount unavailable; settings panel will not be registered");
      return;
    }
    _settingsPanelCtx = ctx;
    const host = ctx.ui.mount("settings_extensions");
    if (!host)
      return;
    host.replaceChildren();
    const { root, refresh } = buildSettingsPanelDOM();
    host.appendChild(root);
    setPanelRefresh(refresh);
    dlog('Settings panel mounted into data-spindle-mount="settings_extensions"');
  } catch (err) {
    dwarn("mountSettingsPanel failed:", err);
  }
}
function applySettings(prev, next) {
  if (!_settingsPanelCtx)
    return;
  for (const feature of FEATURES) {
    if (!feature.apply)
      continue;
    if (prev[feature.id] === next[feature.id])
      continue;
    feature.apply(prev, next, _settingsPanelCtx);
  }
}
var _settingsPanelCtx = null, PANEL_STYLE_ID = "sidebar-ux-panel-styles";
var init_panel = __esm(() => {
  init_state();
  init_log();
  init_registry();
});

// src/setup.ts
init_panel();
init_persist();
init_assignment();
init_buttons();
init_tag_buttons();
init_apply();
init_state();
init_registry();
init_cleanup();
init_main_persist();
init_mobile_exclusion();
init_drawer_sync();
init_drawer_observer();
init_secondary_drawer();

// src/context-menu/index.ts
init_store();
init_assignment();
init_state();
init_tab_context_menu();
init_buttons();
init_log();
function clampMenuToViewport(menu) {
  const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lumiverse-ui-scale")) || 1;
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.right > vw - 8) {
    menu.style.left = `${(vw - rect.width - 8) / uiScale}px`;
  }
  if (rect.bottom > vh - 8) {
    menu.style.top = `${(vh - rect.height - 8) / uiScale}px`;
  }
}
var _pendingTabInfo = null;
var _injected = false;
var _observer = null;
function findLumiverseContextMenu() {
  const last = document.body.lastElementChild;
  if (!last || last.tagName !== "DIV")
    return null;
  const style = getComputedStyle(last);
  if (style.position !== "fixed")
    return null;
  if (style.zIndex !== "11000")
    return null;
  if (!last.querySelector("button"))
    return null;
  return last;
}
function startObserver() {
  if (_observer)
    return;
  _observer = new MutationObserver(() => {
    if (_injected || !_pendingTabInfo)
      return;
    requestAnimationFrame(() => {
      if (_injected || !_pendingTabInfo)
        return;
      const menu = findLumiverseContextMenu();
      if (!menu)
        return;
      injectCanvasItem(menu, _pendingTabInfo);
      _injected = true;
      _pendingTabInfo = null;
      stopObserver();
    });
  });
  _observer.observe(document.body, { childList: true });
}
function stopObserver() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
}
function injectCanvasItem(menu, info) {
  let label;
  let targetSidebar;
  if (info.currentSidebar === "secondary") {
    label = "Move to main drawer";
    targetSidebar = "primary";
  } else {
    label = "Move to second drawer";
    targetSidebar = "secondary";
  }
  dlog(`[tabmove] injectCanvasItem: tabId="${info.tabId}" currentSidebar=${info.currentSidebar} -> target=${targetSidebar} label="${label}"`);
  if (targetSidebar === "secondary" && !getSettings().secondSidebarEnabled) {
    dwarn(`[tabmove] injectCanvasItem: ABORTED — secondSidebarEnabled=false, item not injected for tabId="${info.tabId}"`);
    return;
  }
  const divider = document.createElement("div");
  divider.style.cssText = "height:1px;margin:4px 8px;background:var(--lumiverse-border)";
  menu.appendChild(divider);
  const refBtn = menu.querySelector("button");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  if (refBtn) {
    const rs = getComputedStyle(refBtn);
    btn.style.cssText = [
      "display",
      "alignItems",
      "gap",
      "width",
      "padding",
      "border",
      "borderRadius",
      "background",
      "fontFamily",
      "cursor",
      "transition",
      "textAlign"
    ].map((p3) => `${p3.replace(/([A-Z])/g, "-$1").toLowerCase()}:${rs.getPropertyValue(p3.replace(/([A-Z])/g, "-$1").toLowerCase())}`).join(";");
    btn.style.color = "var(--lumiverse-text)";
    btn.style.fontSize = "calc(12.5px * var(--lumiverse-font-scale, 1))";
  } else {
    btn.style.cssText = `
      display:flex;align-items:center;gap:8px;width:100%;
      padding:8px 12px;border:none;border-radius:6px;background:none;
      color:var(--lumiverse-text);
      font-size:calc(12.5px * var(--lumiverse-font-scale, 1));
      font-family:inherit;cursor:pointer;transition:background 120ms ease;
      text-align:left;
    `;
  }
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "var(--lumiverse-fill, rgba(255, 255, 255, 0.06))";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "none";
  });
  btn.addEventListener("click", (e3) => {
    e3.stopPropagation();
    dlog(`[tabmove] context-menu CLICK: tabId="${info.tabId}" target=${targetSidebar} label="${label}"`);
    assignTab(info.tabId, targetSidebar);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  menu.appendChild(btn);
  clampMenuToViewport(menu);
}
var _contextMenuListenersActive = false;
var _handlers = { docCtxCapture: null, docClick: null, docScroll: null, docKey: null };
function startContextMenuListener() {
  if (_contextMenuListenersActive)
    return;
  const docCtxCapture = (e3) => {
    const evt = e3;
    hideAssignmentMenu();
    const target = evt.target;
    const tabBtn = target?.closest?.("button[title]");
    if (!tabBtn) {
      _pendingTabInfo = null;
      return;
    }
    if (isSettingsButton(tabBtn)) {
      _pendingTabInfo = null;
      return;
    }
    if (tabBtn.classList.contains("sidebar-ux-main-tab-mirror-btn")) {
      dlog("[tabmove] docCtxCapture: main-mirror btn — host forward handles it");
      _pendingTabInfo = null;
      return;
    }
    const sidebar = getMainSidebar();
    if (!sidebar || !sidebar.contains(tabBtn)) {
      dlog("[tabmove] docCtxCapture: skip (not in host sidebar)", {
        title: tabBtn.getAttribute("title"),
        classes: tabBtn.className
      });
      _pendingTabInfo = null;
      return;
    }
    const title = tabBtn.getAttribute("title") || "";
    const dataTabId = tabBtn.getAttribute("data-tab-id");
    let tabId;
    if (dataTabId) {
      tabId = dataTabId;
    } else {
      findStoreData(true);
      const tabs = getDrawerTabs();
      const matchedTab = tabs.find((t3) => t3.title === title);
      tabId = matchedTab?.id || title;
    }
    const currentSidebar = getTabSidebar(tabId);
    dlog(`[tabmove] docCtxCapture: tabBtn title="${title}" data-tab-id="${dataTabId || "(none)"}" ` + `-> resolved tabId="${tabId}" currentSidebar=${currentSidebar} ` + `(source=${dataTabId ? "data-tab-id" : "store-title-fallback"})`);
    _pendingTabInfo = { tabId, currentSidebar, btn: tabBtn };
    _injected = false;
    startObserver();
  };
  const docClick = (e3) => {
    hideAssignmentMenu();
  };
  const docScroll = () => hideAssignmentMenu();
  const docKey = (e3) => {
    if (e3.key === "Escape")
      hideAssignmentMenu();
  };
  document.addEventListener("contextmenu", docCtxCapture, true);
  document.addEventListener("click", docClick);
  document.addEventListener("scroll", docScroll, true);
  document.addEventListener("keydown", docKey);
  _handlers = { docCtxCapture, docClick, docScroll, docKey };
  _contextMenuListenersActive = true;
}
function stopContextMenuListener() {
  if (!_contextMenuListenersActive)
    return;
  const h4 = _handlers;
  if (h4.docCtxCapture)
    document.removeEventListener("contextmenu", h4.docCtxCapture, true);
  if (h4.docClick)
    document.removeEventListener("click", h4.docClick);
  if (h4.docScroll)
    document.removeEventListener("scroll", h4.docScroll, true);
  if (h4.docKey)
    document.removeEventListener("keydown", h4.docKey);
  _handlers = { docCtxCapture: null, docClick: null, docScroll: null, docKey: null };
  _contextMenuListenersActive = false;
  stopObserver();
  _pendingTabInfo = null;
  _injected = false;
  hideAssignmentMenu();
}

// src/setup.ts
init_log();
init_fiber_scan();

// src/tabs/configure-intercept.ts
init_log();
var _interceptActive = false;
var _clickHandler = null;
function startConfigureTabsIntercept() {
  if (_interceptActive)
    return;
  _interceptActive = true;
  _clickHandler = (e3) => {
    if (!_interceptActive)
      return;
    const menu = findLumiverseContextMenu();
    if (!menu)
      return;
    const buttons = menu.querySelectorAll("button");
    const configureBtn = buttons.length >= 2 ? buttons[1] : null;
    if (!configureBtn)
      return;
    const target = e3.target;
    if (!target)
      return;
    const clickedConfigureBtn = configureBtn.contains(target) || configureBtn === target;
    if (!clickedConfigureBtn)
      return;
    e3.preventDefault();
    e3.stopPropagation();
    e3.stopImmediatePropagation();
    dismissHostContextMenu();
    dlog("[configure-intercept] intercepted Configure Tabs click, opening modal");
    Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal)).then((m3) => {
      m3.openConfigureTabsModal();
    }).catch((err) => {
      dwarn("[configure-intercept] Failed to open configure modal:", err);
    });
  };
  document.addEventListener("click", _clickHandler, true);
}
function stopConfigureTabsIntercept() {
  if (!_interceptActive)
    return;
  _interceptActive = false;
  if (_clickHandler) {
    document.removeEventListener("click", _clickHandler, true);
    _clickHandler = null;
  }
}
function dismissHostContextMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true
  }));
}

// src/modals/weaver-lane.ts
init_store();
init_reflow();
init_log();
var WEAVER_LANE_STYLE_ID = "canvas-weaver-lane-styles";
var WEAVER_LANE_ATTR = "data-canvas-weaver-lane";
var _observer2 = null;
var _rafId = null;
var _active2 = false;
function injectWeaverLaneStyles() {
  injectStyles(WEAVER_LANE_STYLE_ID, `
    [${WEAVER_LANE_ATTR}="1"] {
      inset: unset !important;
      top: 0 !important;
      bottom: 0 !important;
      left: var(--sidebar-ux-content-inset-l, 0px) !important;
      right: var(--sidebar-ux-content-inset-r, 0px) !important;
      width: auto !important;
    }
  `);
}
function applyWeaverLane() {
  if (!_active2)
    return;
  const modal = getActiveModal();
  try {
    publishContentLaneInsets();
  } catch (err) {
    dwarn("[weaver-lane] publishContentLaneInsets failed:", err);
  }
  if (modal === "weaver") {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && !dialog.hasAttribute(WEAVER_LANE_ATTR)) {
      dialog.setAttribute(WEAVER_LANE_ATTR, "1");
    }
  } else {
    const tagged = document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`);
    if (tagged) {
      tagged.removeAttribute(WEAVER_LANE_ATTR);
    }
  }
}
function scheduleApply() {
  if (_rafId !== null)
    return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    applyWeaverLane();
  });
}
function startWeaverLane() {
  if (_observer2) {
    return () => {};
  }
  injectWeaverLaneStyles();
  _active2 = true;
  scheduleApply();
  _observer2 = new MutationObserver((mutations) => {
    if (!_active2)
      return;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        scheduleApply();
        break;
      }
    }
  });
  _observer2.observe(document.body, { childList: true, subtree: true });
  return () => {
    _active2 = false;
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    if (_observer2) {
      _observer2.disconnect();
      _observer2 = null;
    }
    const tagged = document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`);
    if (tagged) {
      tagged.removeAttribute(WEAVER_LANE_ATTR);
    }
  };
}

// src/setup.ts
function setup(ctx) {
  setBackendCtx(ctx);
  beginMainDrawerRestoreGuard();
  const flushOnUnload = () => {
    try {
      flushPendingSaves();
    } catch (err) {
      dwarn("flushPendingSaves on unload failed:", err);
    }
  };
  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("beforeunload", flushOnUnload);
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden")
      flushOnUnload();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  registerCleanup(() => {
    window.removeEventListener("pagehide", flushOnUnload);
    window.removeEventListener("beforeunload", flushOnUnload);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });
  registerCleanup(() => {
    document.getElementById("canvas-ux-context-menu-styles")?.remove();
    document.getElementById("sidebar-ux-reflow")?.remove();
    document.getElementById("canvas-ux-secondary-mobile")?.remove();
    document.getElementById("sidebar-ux-shadow-disable-desktop")?.remove();
    document.getElementById("sidebar-ux-shadow-disable-mobile")?.remove();
  });
  registerCleanup(cancelLayoutSave);
  mountSettingsPanel(ctx);
  for (const teardown of alwaysCleanups()) {
    registerCleanup(teardown);
  }
  loadSavedLayout().then(async (layout) => {
    if (layout?.version && layout.version !== CANVAS_VERSION) {
      dwarn(`Layout was saved by v${layout.version}, running v${CANVAS_VERSION}. ` + `Hard-refresh (Ctrl+F5) to load the updated extension.`);
    }
    resetHydrationGuard();
    hydrateSettings(layout?.settings);
    setDebug(getSettings().debugMode);
    setLastLoadedLayout(layout);
    refreshSettingsPanel();
    if (getSettings().debugMode)
      installDebugEscapeHatch();
    beginMainDrawerRestoreGuard();
    for (const feature of FEATURES) {
      feature.init?.(ctx);
    }
    for (const feature of FEATURES) {
      if (!feature.mount)
        continue;
      if (!getSettings()[feature.id])
        continue;
      const teardown = feature.mount(ctx, layout);
      if (typeof teardown === "function")
        registerCleanup(teardown);
    }
    startSideChangeWatcher();
    startMainDrawerPersistence();
    registerCleanup(stopMainDrawerPersistence);
    registerCleanup(startMobileExclusion());
    drawerObserver.onTabRegistered(() => {
      tagMainSidebarButtons();
    });
    drawerObserver.onTabUnregistered((tabId) => {
      if (getTabAssignments().has(tabId)) {
        if (isRestoringFromLayout())
          return;
        deleteTabAssignment(tabId);
        removeSecondaryTabButton(tabId);
        persistLayout();
      }
    });
    drawerObserver.start();
    initSecondaryDrawer(ctx);
    startContextMenuListener();
    registerCleanup(stopContextMenuListener);
    startConfigureTabsIntercept();
    registerCleanup(stopConfigureTabsIntercept);
    registerCleanup(startWeaverLane());
    registerCleanup(() => {
      teardownSecondaryDrawer();
    });
    const s3 = getSettings();
    const restoreOpen = !!s3.persistDrawerOpenState;
    const restoreWidth = !!s3.persistDrawerWidth;
    const restoreAny = restoreOpen || restoreWidth || true;
    if (layout && restoreAny && s3.secondSidebarEnabled) {
      applyLayout(layout).catch((err) => {
        dwarn("Canvas: applyLayout failed:", err);
      });
    }
    if (restoreOpen || restoreWidth) {
      applyMainDrawer(layout);
    } else {
      unsuppressMainDrawer();
    }
  }).catch((err) => {
    dwarn("Canvas: loadSavedLayout failed, mounting with defaults:", err);
    try {
      unsuppressMainDrawer();
    } catch {}
  });
  return cleanupAll;
}
export {
  setup
};
