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
function mergeCanvasSettings(saved) {
  const out = { ...DEFAULT_CANVAS_SETTINGS };
  if (saved && typeof saved === "object") {
    for (const key of Object.keys(out)) {
      const v = saved[key];
      if (v !== undefined)
        out[key] = v;
    }
  }
  return out;
}
var DEFAULT_CANVAS_SETTINGS;
var init_types = __esm(() => {
  DEFAULT_CANVAS_SETTINGS = {
    secondSidebarEnabled: true,
    resizeSidebars: true,
    mirrorCompactPosition: true,
    showTabLabels: "follow",
    consistentIconSize: true,
    moveControlsToOuterEdge: false,
    keepTabListVisible: false,
    sidebarShadowsDesktop: true,
    sidebarShadowsMobile: false,
    chatReflow: true,
    layoutPersistence: true,
    slashCommandsEnabled: true,
    drawerTabDrag: true,
    mainDrawerTabOverrideVh: undefined,
    secondaryDrawerTabOverrideVh: undefined,
    debugMode: false
  };
});

// src/dom/lumiverse.ts
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
  injectStyles("canvas-ux-secondary-mobile", SECONDARY_MOBILE_CSS);
  injectStyles("canvas-moved-active-toggle", `
    .sidebar-ux-panel-content [data-canvas-moved]:not([data-canvas-active]) {
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
  /* Active tab indicator: bottom underline, top corners rounded.
     Matches main sidebar's mobile .tabBtnActive exactly.
     Same specificity as the desktop rule so it overrides on mobile. */
  .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary);
    border-radius: 8px 8px 0 0;
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
  const w = Math.ceil(widthPx);
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
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(widthCssVar));
  const rawWidth = initialWidth && initialWidth > 0 ? initialWidth : isFinite(cssVarWidth) && cssVarWidth > 0 ? cssVarWidth : defaultWidth;
  const initWidth = fullViewportWidth ? window.innerWidth : Math.ceil(clampSidebarWidth(rawWidth));
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
    width: ${fullViewportWidth ? "100vw" : `var(${widthCssVar}, ${defaultWidth}px)`};
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
    for (let i = 0;i < kids.length; i++) {
      const c = kids[i];
      if (isTabListElement(c))
        last = c;
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
    return;
  }
  applyTabListPin(!!getSettings().keepTabListVisible, { force: true });
}
function applyTabListPin(enabled, opts) {
  if (isMobileViewport()) {
    if (enabled && !opts?.force)
      return;
    const el = getSecondaryTabList() ?? getPinnedTabList();
    if (el?.classList.contains(TAB_LIST_PINNED_CLASS) || _pinHost || _pinSpacer) {
      unpinTabList(el);
    }
    return;
  }
  if (!enabled) {
    const el = getSecondaryTabList() ?? getPinnedTabList();
    const hasPinState = !!el?.classList.contains(TAB_LIST_PINNED_CLASS) || !!_pinHost || !!_pinSpacer;
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
  const kids = _pinHost.children ? Array.from(_pinHost.children) : Array.from(_pinHost.childNodes).filter((c) => c.nodeType === 1 || isTabListElement(c));
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
    setIfDifferent(drawer.style, "flexDirection", "");
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
  init_mobile_exclusion();
  init_secondary();
  init_styles();
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

// src/tabs/activation-handoff.ts
async function captureSourceList(side, h) {
  if (side === "primary") {
    const _findStore = h?.findStoreData ?? findStoreData;
    const _getTabs = h?.getDrawerTabs ?? getDrawerTabs;
    const _getSidebar = h?.getMainSidebar ?? getMainSidebar;
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
    const storeIds = _getTabs().map((t) => t.id).filter(Boolean);
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
      await new Promise((r) => requestAnimationFrame(() => r()));
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
    const _getSidebarForFilter = h?.getMainSidebar ?? getMainSidebar;
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
  return Array.from(btns).map((b) => b.getAttribute("data-tab-id")).filter(Boolean);
}
async function isMovedTabActiveInSource(tabId, side, h, preMoveSourceActiveTab) {
  if (preMoveSourceActiveTab !== undefined) {
    return preMoveSourceActiveTab;
  }
  if (side === "primary") {
    await new Promise((r) => Promise.resolve().then(() => r()));
    return (h?.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer)(tabId);
  }
  return (h?.getActiveSecondaryTabId ?? getActiveSecondaryTabId)() === tabId;
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
async function activateInPrimary(tabId, h) {
  const _findBtn = h?.findMainTabButton ?? findMainTabButton;
  const _findStore = h?.findStoreData ?? findStoreData;
  const _getTabs = h?.getDrawerTabs ?? getDrawerTabs;
  const _getPanel = h?.getMainPanelContent ?? getMainPanelContent;
  let resolvedId = tabId;
  const directBtn = _findBtn(tabId);
  if (!directBtn) {
    _findStore(true);
    const tabs = _getTabs();
    const bySegment = tabs.find((t) => t.id.includes(`:tab:${tabId}:`) || t.id === tabId);
    if (bySegment) {
      resolvedId = bySegment.id;
    }
  }
  const mainBtn = directBtn ?? _findBtn(resolvedId);
  if (mainBtn) {
    mainBtn.click();
    const stickSidebar = (h?.getMainSidebar ?? getMainSidebar)();
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
  }
}
function activateInSecondary(tabId, h) {
  if (!h) {
    showSecondaryTab(tabId);
    return;
  }
  const _setSecondaryTabId = h?.setActiveSecondaryTabId ?? setActiveSecondaryTabId;
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
async function runHandoff({ tabId, source, destination, sourceList, preMoveSourceActiveTab, _testHooks: h }) {
  const wasActive = await isMovedTabActiveInSource(tabId, source, h, preMoveSourceActiveTab);
  const replacementId = pickSourceReplacement(tabId, sourceList);
  const isMobile = (h?.isMobileViewport ?? isMobileViewport)();
  dlog(`[canvas-debug] HANDOFF_DECIDE movedTab=${tabId} source=${source} destination=${destination} ` + `wasActive=${wasActive} replacement=${replacementId ?? "NONE"} mobile=${isMobile} ` + `activateSource=${wasActive && replacementId !== null} activateDestination=${!isMobile}`);
  const above = replacementId !== null ? sourceList.indexOf(replacementId) < sourceList.indexOf(tabId) ? replacementId : null : null;
  const below = replacementId !== null ? sourceList.indexOf(replacementId) > sourceList.indexOf(tabId) ? replacementId : null : null;
  dlog(`[canvas-debug] HANDOFF_REPLACE_PICK source=${source} movedTab=${tabId} ` + `above=${above ?? "NONE"} below=${below ?? "NONE"} picked=${replacementId ?? "NONE"}`);
  if (wasActive && replacementId !== null) {
    try {
      if (source === "primary") {
        await activateInPrimary(replacementId, h);
      } else {
        activateInSecondary(replacementId, h);
      }
    } catch (err) {
      dlog(`[canvas-debug] HANDOFF_ERROR gate=source source=${source} replacement=${replacementId} err=${err}`);
    }
  }
  if (!isMobile) {
    dlog(`[canvas-debug] HANDOFF_DEST_ACTIVATE destination=${destination} tabId=${tabId} ` + `method=${destination === "primary" ? "click-main-button" : "setActiveSecondaryTabId+data-canvas-active"} ` + `skippedMobile=${isMobile}`);
    try {
      if (destination === "primary") {
        await activateInPrimary(tabId, h);
      } else {
        activateInSecondary(tabId, h);
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
  init_active_tab();
  init_buttons();
  init_store();
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
async function assignToSecondary(tabId) {
  const deferActivation = isRestoringFromLayout() || isSuppressAutoActivation();
  let tab = drawerObserver.getTab(tabId);
  let iconSvg;
  let iconUrl;
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
    iconUrl = storeTab.iconUrl;
    shortName = storeTab.shortName;
  } else {
    iconSvg = tab.button.querySelector("svg")?.outerHTML;
  }
  const resolvedId = tab.tabId;
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`);
  const _isExtensionTab = !!tab.extensionId && tab.extensionId !== "unknown";
  if (_isExtensionTab) {
    setTabAssignment(resolvedId, "secondary");
    hideMainTabButton(resolvedId);
    if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
      await openSecondarySidebar();
      _state = "open";
    }
    const _secondaryContentEarly = document.querySelector(".sidebar-ux-panel-content");
    const _bareIdEarly = resolvedId.includes(":") ? resolvedId.replace(/:\d+$/, "").split(":").pop() ?? resolvedId : resolvedId;
    const _existingRoot = _secondaryContentEarly?.querySelector(`[data-canvas-moved="${CSS.escape(resolvedId)}"]`) ?? _secondaryContentEarly?.querySelector(`[data-canvas-moved="${CSS.escape(_bareIdEarly)}"]`);
    if (_existingRoot) {
      const _storeTabForButton = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
      addSecondaryTabButton({
        id: resolvedId,
        title: tab.title || _storeTabForButton?.title || resolvedId,
        root: _existingRoot,
        iconSvg: iconSvg || tab.button?.querySelector("svg")?.outerHTML || _storeTabForButton?.iconSvg,
        shortName: shortName || readMainButtonShortName(tab.button) || _storeTabForButton?.shortName
      });
      updateDrawerTabVisibility();
    } else {
      const _secondaryWrapper = getSecondaryWrapper();
      const _secondaryContent = _secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
      const _storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
      if (_storeTab?.root && _secondaryContent) {
        const _root = _storeTab.root;
        if (_root.parentElement !== _secondaryContent) {
          _secondaryContent.appendChild(_root);
        }
        _root.setAttribute("data-canvas-moved", resolvedId);
        if (!deferActivation) {
          for (const _child of Array.from(_secondaryContent.children)) {
            if (_child instanceof HTMLElement) {
              if (_child === _root) {
                _child.setAttribute("data-canvas-active", "");
              } else {
                _child.removeAttribute("data-canvas-active");
              }
            }
          }
        }
        addSecondaryTabButton({
          id: resolvedId,
          title: tab.title || _storeTab.title || resolvedId,
          root: _root,
          iconSvg: tab.button?.querySelector("svg")?.outerHTML || _storeTab.iconSvg,
          shortName: readMainButtonShortName(tab.button) || _storeTab.shortName
        });
        updateDrawerTabVisibility();
      }
    }
    if (!isMobileViewport() && !deferActivation) {
      _activeTabId = resolvedId;
      _state = "tab_active";
      setActiveSecondaryTabId(resolvedId);
    }
    const _headerTitle = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
    if (_headerTitle && !deferActivation) {
      _headerTitle.textContent = tab.title || _existingRoot?.getAttribute("data-tab-title") || resolvedId;
    }
  } else {
    const _secondaryWrapper = getSecondaryWrapper();
    const _secondaryContent = _secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
    const _storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!_storeTab} hasSecondaryContent=${!!_secondaryContent}`);
    let _root = _storeTab?.root;
    if (!_root && !_isExtensionTab) {
      const _mainContent = document.querySelector('[class*="_panelContent_"]');
      const _firstChild = _mainContent?.children[0];
      if (_mainContent) {
        for (const _child of Array.from(_mainContent.children)) {
          if (_child.getAttribute("data-tab-id") === resolvedId || _child.getAttribute("data-tab-title") === tab.title || (_child.textContent?.includes(tab.title ?? "") ?? false)) {
            _root = _child;
            break;
          }
        }
        if (!_root && _mainContent.children.length > 0 && (_firstChild?.getAttribute("data-tab-id") === resolvedId || _firstChild?.getAttribute("data-tab-title") === tab.title)) {
          _root = _firstChild;
        }
      }
    }
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} rootFound=${!!_root} rootTagId=${_root?.getAttribute("data-tab-id") ?? "null"}`);
    const wSpindle = getHostBridge();
    const wSpindleUi = wSpindle?.ui;
    const _alreadyInSecondary = _secondaryContent?.querySelector(`[data-canvas-moved="${CSS.escape(resolvedId)}"]`);
    if (_alreadyInSecondary) {
      dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_EARLY_RETURN tab=${resolvedId} branch=ALREADY_IN_SECONDARY`);
      const _title2 = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || _storeTab?.title || resolvedId;
      addSecondaryTabButton({
        id: resolvedId,
        title: _title2,
        root: _alreadyInSecondary,
        iconSvg: tab.button?.querySelector("svg")?.outerHTML || _alreadyInSecondary.querySelector("svg")?.outerHTML,
        shortName: readMainButtonShortName(tab.button) || _storeTab?.shortName
      });
      updateDrawerTabVisibility();
      setTabAssignment(resolvedId, "secondary");
      hideMainTabButton(resolvedId);
      if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
        await openSecondarySidebar();
        if (!deferActivation) {
          _state = "tab_active";
          _activeTabId = resolvedId;
          setActiveSecondaryTabId(resolvedId);
        }
      }
      const _headerTitle2 = _secondaryWrapper?.querySelector(".sidebar-ux-panel-title");
      if (_headerTitle2 && !deferActivation)
        _headerTitle2.textContent = _title2;
      if (!isMobileViewport() && !deferActivation) {
        showSecondaryTab(resolvedId);
      }
      persistLayout();
      return;
    }
    if (!_root || !_secondaryContent) {
      if (_secondaryContent && !_root && wSpindleUi?.getBuiltInTabRoot && wSpindleUi?.requestTabLocation) {
        await ensureBuiltInTabActiveInMain(resolvedId);
        await new Promise((r) => requestAnimationFrame(() => r()));
        const _lazyRoot = wSpindleUi.getBuiltInTabRoot(tabId);
        if (!_lazyRoot) {
          dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=EARLY_RETURN getBuiltInTabRootReturned=undefined`);
          dwarn("[SecondaryDrawer] assignToSecondary: built-in tabId not registered (stale or renamed). Skipping restore.", { tabId, resolvedId });
          return;
        }
        dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element`);
        _root = _lazyRoot;
        await new Promise((r) => requestAnimationFrame(() => r()));
        wSpindleUi.requestTabLocation(tabId, { kind: "container", containerId: "canvas-secondary-drawer" });
      } else {
        dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=BRIDGE_MISSING hasGetBuiltInTabRoot=${!!wSpindleUi?.getBuiltInTabRoot} hasRequestTabLocation=${!!wSpindleUi?.requestTabLocation} hasSecondaryContent=${!!_secondaryContent}`);
        if (!_isExtensionTab) {
          dwarn("[SecondaryDrawer] assignToSecondary: built-in tab cannot be auto-restored (root not in DOM, not in store, host bridge missing).", {
            tabId,
            resolvedId
          });
        }
        return;
      }
    }
    if (_root.parentElement !== _secondaryContent) {
      _secondaryContent.appendChild(_root);
    }
    _root.setAttribute("data-canvas-moved", resolvedId);
    if (!deferActivation) {
      for (const _child of Array.from(_secondaryContent.children)) {
        if (_child instanceof HTMLElement) {
          if (_child === _root) {
            _child.setAttribute("data-canvas-active", "");
          } else {
            _child.removeAttribute("data-canvas-active");
          }
        }
      }
    }
    const _title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || _storeTab?.title || resolvedId;
    const _iconSvg = tab.button?.querySelector("svg")?.outerHTML || _root?.querySelector("svg")?.outerHTML;
    const _shortName = readMainButtonShortName(tab.button) || _storeTab?.shortName;
    addSecondaryTabButton({
      id: resolvedId,
      title: _title,
      root: _root,
      iconSvg: _iconSvg,
      shortName: _shortName
    });
    updateDrawerTabVisibility();
    setTabAssignment(resolvedId, "secondary");
    hideMainTabButton(resolvedId);
    if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
      await openSecondarySidebar();
      if (!deferActivation) {
        _state = "tab_active";
        _activeTabId = resolvedId;
        setActiveSecondaryTabId(resolvedId);
      }
    }
    const _headerTitle = _secondaryWrapper?.querySelector(".sidebar-ux-panel-title");
    if (_headerTitle && !deferActivation)
      _headerTitle.textContent = _title;
  }
  if (!isMobileViewport() && !deferActivation) {
    showSecondaryTab(resolvedId);
  }
  persistLayout();
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
  const _secondaryContentForUnassign = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
  if (_secondaryContentForUnassign) {
    const _movedRoot = _secondaryContentForUnassign.querySelector(`[data-canvas-moved="${CSS.escape(resolvedShowId)}"]:not([data-canvas-secondary])`);
    if (_movedRoot) {
      const _mainContent = document.querySelector('[class*="_panelContent_"]');
      if (_mainContent && _movedRoot.parentElement !== _mainContent) {
        _mainContent.appendChild(_movedRoot);
      }
      _movedRoot.removeAttribute("data-canvas-moved");
      _movedRoot.removeAttribute("data-canvas-active");
    }
  }
  deleteTabAssignment(tabId);
  if (resolvedShowId !== tabId) {
    deleteTabAssignment(resolvedShowId);
  }
  removeSecondaryTabButton(tabId);
  if (getActiveSecondaryTabId() === tabId) {
    showSecondaryTab(null);
  }
  showMainTabButton(resolvedShowId);
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

// src/tabs/assignment.ts
var exports_assignment = {};
__export(exports_assignment, {
  setTabAssignment: () => setTabAssignment,
  setActiveSecondaryTabId: () => setActiveSecondaryTabId,
  isTabActiveInMainDrawer: () => isTabActiveInMainDrawer,
  hasTabAssignment: () => hasTabAssignment,
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
async function ensureBuiltInTabActiveInMain(tabId, h = {}) {
  const _isActive = h.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer;
  const _findBtn = h.findMainTabButton ?? findMainTabButton;
  const _isMobile = h.isMobileViewport ?? isMobileViewport;
  const _getRoot = h.getBuiltInTabRoot ?? (() => {
    return;
  });
  const _dlog = h.dlog ?? (() => {});
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
  await new Promise((r) => requestAnimationFrame(() => r()));
  const root = _getRoot(tabId);
  _dlog(`[canvas-debug] ENSURE_ACTIVE_DONE tab=${tabId} rootAfter=${root?.tagName ?? "null"}`);
  if (!root) {
    _dlog(`[tabmove] ensure-active: post-click root still null for "${tabId}"; ` + `move will fall through to host lazy-mount`);
  }
}
function watchForContainerPass3Reset(bridge, tabId, builtInRoot, afterLoc) {
  queueMicrotask(() => {
    const microLoc = bridge.ui.getTabLocation?.(tabId) ?? null;
    const microContainer = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
    const rootInContainer = microContainer?.contains(builtInRoot) ?? false;
    if (afterLoc?.kind === "container" && microLoc?.kind === "main-drawer") {
      dwarn(`[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ` + `${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to ` + `main-drawer because the target container is missing from Lumiverse's ` + `containers store. Fix: ensure the secondary drawer's panel content ` + `element is registered via bridge.containers.registerContainer BEFORE ` + `the move. (See secondary.tsx:308 — the call exists but may be failing silently.)`);
    }
  });
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
    let builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId);
    if (!builtInRoot) {
      await ensureBuiltInTabActiveInMain(tabId);
      await new Promise((r) => requestAnimationFrame(() => r()));
      builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId);
    }
    if (builtInRoot && bridge) {
      builtInRoot.setAttribute("data-canvas-moved", tabId);
      builtInRoot.setAttribute("data-canvas-active", "");
      if (preMoveActiveTab)
        armMainDrawerActiveRestore(tabId);
      await new Promise((r) => requestAnimationFrame(() => r()));
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
      bridge.ui.requestTabLocation(tabId, { kind: "container", containerId: "canvas-secondary-drawer" });
      const afterLoc = bridge.ui.getTabLocation?.(tabId) ?? null;
      watchForContainerPass3Reset(bridge, tabId, builtInRoot, afterLoc);
      if (_restoreObserver) {
        await new Promise((r) => requestAnimationFrame(() => r()));
        _restoreObserver.disconnect();
        _restoreObserver = null;
      }
      setTabAssignment(tabId, "secondary");
      hideMainTabButton(tabId);
      addBuiltInSecondaryButton(bridge, tabId, builtInRoot);
      updateDrawerTabVisibility();
      if (!isSecondarySidebarOpen() && !isMobileViewport())
        openSecondarySidebar();
      await runHandoff({ tabId, source: "primary", destination: "secondary", sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab });
      persistLayout();
      return;
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

// src/sidebar/drawer-sync.ts
var exports_drawer_sync = {};
__export(exports_drawer_sync, {
  syncSecondaryTabLabels: () => syncSecondaryTabLabels,
  syncDrawerTabSettings: () => syncDrawerTabSettings,
  stopSideChangeWatcher: () => stopSideChangeWatcher,
  stopDrawerTabStyleObserver: () => stopDrawerTabStyleObserver,
  stopDrawerTabResizeWatcher: () => stopDrawerTabResizeWatcher,
  stopDrawerTabClassObserver: () => stopDrawerTabClassObserver,
  startSideChangeWatcher: () => startSideChangeWatcher,
  restoreSecondaryTabButtons: () => restoreSecondaryTabButtons,
  isShowTabLabels: () => isShowTabLabels,
  checkSideChanged: () => checkSideChanged
});
function isShowTabLabels() {
  const mode = getSettings().showTabLabels;
  if (mode === "show")
    return true;
  if (mode === "hide")
    return false;
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

// src/tabs/tab-context-menu.ts
function hideAssignmentMenu() {
  if (_contextMenu) {
    _contextMenu.remove();
    _contextMenu = null;
  }
  _lastContextMenuTarget = null;
}
function showAssignmentMenu(x, y, tabId, tabTitle, originatingTarget) {
  if (_showAssignmentMenuOverride) {
    _showAssignmentMenuOverride(x, y, tabId, tabTitle, originatingTarget);
    return;
  }
  if (!_contextMenu) {
    _contextMenu = createAssignmentContextMenu();
    document.body.appendChild(_contextMenu);
  }
  _contextMenu.innerHTML = "";
  const currentSidebar = getTabSidebar(tabId);
  let label;
  let targetSidebar;
  if (currentSidebar === "secondary" && isSecondarySidebarOpen()) {
    label = "Move to main drawer";
    targetSidebar = "primary";
  } else if (currentSidebar === "secondary" && !isSecondarySidebarOpen()) {
    label = "Open in second drawer";
    targetSidebar = "secondary";
  } else {
    label = "Move to second drawer";
    targetSidebar = "secondary";
  }
  const item = createAssignmentContextMenuItem(label, () => {
    Promise.resolve().then(() => (init_assignment(), exports_assignment)).then((m) => m.assignTab(tabId, targetSidebar));
  });
  _contextMenu.appendChild(item);
  _contextMenu.style.left = `${x}px`;
  _contextMenu.style.top = `${y}px`;
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
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
    hideAssignmentMenu();
  });
  return item;
}
var _showAssignmentMenuOverride = null, _contextMenu = null, _lastContextMenuTarget = null;
var init_tab_context_menu = __esm(() => {
  init_assignment();
  init_secondary();
});

// src/tabs/buttons.ts
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
  const byId = sidebar.querySelector(`button[data-tab-id="${cssEscape(tabId)}"]`);
  if (byId)
    return byId;
  const byTitle = sidebar.querySelector(`button[title="${cssEscape(tabId)}"]`);
  if (byTitle) {
    byTitle.setAttribute("data-tab-id", tabId);
    return byTitle;
  }
  const tabs = getDrawerTabs();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) {
    dwarn(`findMainTabButton: no tab in store for id="${tabId}", known tabs=`, tabs.map((t) => ({ id: t.id, title: t.title })));
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
function cssEscape(value) {
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
  return allButtons.find((b) => b.style.display !== "none" && b.className.includes("tabBtn") && !b.className.includes("tabBtnExtension") && !isSettingsButton(b)) ?? null;
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
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAssignmentMenu(e.clientX, e.clientY, tab.id, tab.title, btn);
  });
  tabList.appendChild(btn);
}
function removeSecondaryTabButton(tabId) {
  const btn = getSecondaryTabList()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`) ?? getSecondaryWrapper()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`);
  btn?.remove();
}
function updateDrawerTabVisibility() {
  const drawerTab = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
  if (!drawerTab)
    return;
  if (getSettings().keepTabListVisible) {
    drawerTab.style.display = "none";
    return;
  }
  const hasSecondaryTabs = [...getTabAssignments()].some(([, s]) => s === "secondary");
  drawerTab.style.display = hasSecondaryTabs ? "flex" : "none";
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

// src/sidebar/main-tab-pin.ts
var exports_main_tab_pin = {};
__export(exports_main_tab_pin, {
  reconcileMainTabListPin: () => reconcileMainTabListPin,
  isMainTabListPinActive: () => isMainTabListPinActive,
  getActiveMainMirrorKey: () => getActiveMainMirrorKey,
  applyMainTabListPin: () => applyMainTabListPin,
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
    return;
  }
  reconcileMainMirrorDrawer();
  const on = !!getSettings().keepTabListVisible;
  if (!on) {
    teardownMainPin();
    return;
  }
  _enabled = true;
  ensureObservers();
  reconcileMainMirror();
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
  const mode = getSettings().showTabLabels;
  if (mode === "show")
    return true;
  if (mode === "hide")
    return false;
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
  const tabId = mirror.getAttribute("data-tab-id") || mirror.getAttribute("title") || mirror.getAttribute("aria-label") || "";
  const title = mirror.getAttribute("title") || mirror.getAttribute("aria-label") || tabId;
  if (!tabId) {
    dwarn("[main-mirror] contextmenu: no tabId/title on mirror button");
    return;
  }
  dlog("[main-mirror] contextmenu", {
    tabId,
    title,
    x: e.clientX,
    y: e.clientY
  });
  showAssignmentMenu(e.clientX, e.clientY, tabId, title, mirror);
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
  init_tab_context_menu();
  _mirrorToHost = new WeakMap;
});

// src/sidebar/panel-header-sync.ts
var exports_panel_header_sync = {};
__export(exports_panel_header_sync, {
  syncPanelHeaderFromMain: () => syncPanelHeaderFromMain,
  stopPanelHeaderObservers: () => stopPanelHeaderObservers,
  resetPanelHeaderSyncCache: () => resetPanelHeaderSyncCache
});
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
    document.querySelectorAll(".sidebar-ux-secondary-wrapper, .sidebar-ux-main-mirror-wrapper").forEach((n) => add(n));
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
  const allStamped = cacheKey === _lastWrittenHeaderVars && targets.every((t) => !!t.style.getPropertyValue("--sidebar-ux-panel-header-h"));
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
  setCanvasMainTitle: () => setCanvasMainTitle,
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
  Promise.resolve().then(() => (init_reflow(), exports_reflow)).then((m) => m.updateChatReflow());
}
function bumpResizeHandles() {
  Promise.resolve().then(() => (init_handles(), exports_handles)).then((m) => m.mountResizeHandles());
}
function persistCanvasMainOpenState() {
  Promise.resolve().then(() => (init_persist(), exports_persist)).then((m) => m.persistOpenState());
}
function applyMainMirrorRestoredWidth(widthPx) {
  const w = Math.ceil(clampSidebarWidth(widthPx));
  if (!(w > 0))
    return;
  document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${w}px`);
  if (_shell && !_open) {
    _shell.wrapper.style.transform = `translateX(${closedTransformPx(_shell.side, w)}px)`;
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
  Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m) => m.reconcileMainTabListPin());
  bumpReflow();
  persistCanvasMainOpenState();
}
function closeCanvasMainDrawer() {
  if (!_shell || !_active)
    return;
  if (!_open)
    return;
  const side = _shell.side;
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420);
  dlog(`[main-mirror] close side=${side} closedTx=${closedTransformPx(side, w)}`);
  animateWrapper(_shell.wrapper, closedTransformPx(side, w));
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
}
function __resetMainMirrorForTest() {
  teardownMainMirror();
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
  _shell = createDrawerShell({
    owner: "main",
    side,
    widthCssVar: MAIN_MIRROR_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: seedW,
    initialOpen: opts.initialOpen,
    title: "Drawer",
    drawerTabDisplay: "none",
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
  Promise.resolve().then(() => (init_drawer_sync(), exports_drawer_sync)).then((m) => m.syncDrawerTabSettings());
  Promise.resolve().then(() => (init_panel_header_sync(), exports_panel_header_sync)).then((m) => {
    m.resetPanelHeaderSyncCache();
    m.syncPanelHeaderFromMain(() => _shell?.wrapper ?? null);
  });
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
    const s = hostContent.style;
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
      s.removeProperty(prop);
    }
    if (!restorePending) {
      for (const prop of ["visibility", "opacity", "pointer-events"]) {
        s.removeProperty(prop);
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
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then((m) => {
      m.stampPanelBodyHide();
    }).catch(() => {});
  }
}
function ensureHostContentParkedPublic() {
  ensureHostContentParked();
}
function restoreHostContent() {
  if (_contentEl) {
    const s = _contentEl.style;
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
      s.removeProperty(prop);
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
  const tickMs = () => typeof document !== "undefined" && document.documentElement.classList.contains("sidebar-ux-main-restore-pending") ? 50 : 500;
  const tick = () => {
    _reparkTimer = null;
    if (!_active || !_shell)
      return;
    const el = resolveHostPanelContent();
    if (el && el.parentElement !== _shell.content) {
      dlog("[main-mirror] re-park: React moved panelContent back to host");
      ensureHostContentParked();
    }
    _reparkTimer = setTimeout(tick, tickMs());
  };
  _reparkTimer = setTimeout(tick, tickMs());
}
function stopReparkWatch() {
  if (_reparkTimer !== null) {
    clearTimeout(_reparkTimer);
    _reparkTimer = null;
  }
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
    for (const h of Array.from(handles))
      h.remove();
    _shell.wrapper.remove();
    _shell = null;
  }
  if (!opts?.keepWidthVar) {
    const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0);
    if (w > 0) {
      const wrapper = getMainWrapper();
      if (wrapper) {
        wrapper.style.setProperty("--drawer-panel-w", `${Math.ceil(clampSidebarWidth(w))}px`, "important");
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
var CONTENT_MARK_ATTR = "data-canvas-main-panel-content", _active = false, _open = false, _shell = null, _pinSpacer2 = null, _tabListRestoreParent = null, _tabListRestoreNext = null, _contentEl = null, _contentRestoreParent = null, _contentRestoreNext = null, _mountedSide = null, _reparkTimer = null;
var init_main_mirror_drawer = __esm(() => {
  init_store();
  init_state();
  init_log();
  init_animation();
  init_drawer_shell();
  init_mobile_exclusion();
  init_tab_position();
  init_styles();
});

// src/resize/handles.ts
var exports_handles = {};
__export(exports_handles, {
  refreshResizeHandles: () => refreshResizeHandles,
  mountResizeHandles: () => mountResizeHandles,
  isPointerResizeActive: () => isPointerResizeActive,
  createResizeHandle: () => createResizeHandle
});
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
  handle.addEventListener("pointerdown", (e) => {
    if (enabled && !enabled())
      return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
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
    const onMove = (e2) => {
      const delta = direction === "right" ? e2.clientX - startX : startX - e2.clientX;
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
  const nodes = document.querySelectorAll('[class*="_panelContent_"],' + "[data-canvas-main-panel-content]," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *");
  for (const node of Array.from(nodes)) {
    const el = node;
    el.setAttribute(RESTORE_HIDE_ATTR, "1");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("pointer-events", "none", "important");
  }
}
function clearPanelBodyHide() {
  if (typeof document === "undefined")
    return;
  const nodes = document.querySelectorAll(`[${RESTORE_HIDE_ATTR}]`);
  for (const node of Array.from(nodes)) {
    const el = node;
    el.removeAttribute(RESTORE_HIDE_ATTR);
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
    for (const m of mutations) {
      if (m.type === "childList") {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && (isPanelBodyNode(n) || n.querySelector?.('[class*="_panelContent_"], [data-canvas-main-panel-content]'))) {
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
  const wrapper = _wrapper;
  if (!wrapper)
    return;
  wrapper.style.setProperty("visibility", "hidden", "important");
  wrapper.style.setProperty("opacity", "0", "important");
  stampPanelBodyHide();
}
function unsuppressMainDrawer() {
  if (_unsuppressTimer) {
    clearTimeout(_unsuppressTimer);
    _unsuppressTimer = null;
  }
  stopPanelHideObserver();
  clearPanelBodyHide();
  document.documentElement.classList.remove(RESTORE_PENDING_CLASS);
  const wrapper = _wrapper;
  if (wrapper) {
    wrapper.style.removeProperty("visibility");
    wrapper.style.removeProperty("opacity");
  }
}
function isMainDrawerRestorePending() {
  return typeof document !== "undefined" && document.documentElement.classList.contains(RESTORE_PENDING_CLASS);
}
function isPrimaryTabActive(targetTabId) {
  const sidebar = _sidebar || document.querySelector('[data-spindle-mount="sidebar"]');
  const active = sidebar?.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
  if (active) {
    const id = active.getAttribute("data-tab-id") || "";
    const title = active.getAttribute("title") || "";
    if (id === targetTabId || title === targetTabId)
      return true;
    if (id && (targetTabId.endsWith(`:${id}`) || targetTabId.includes(`:tab:${id}:`) || targetTabId.includes(`:tab:${id}`))) {
      return true;
    }
  }
  const mirrorActive = document.querySelector(`.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active[data-tab-id="${CSS.escape(targetTabId)}"],` + `.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active[title="${CSS.escape(targetTabId)}"]`);
  return !!mirrorActive;
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
    Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m) => {
      const title = tabBtn?.getAttribute("title") || tabBtn?.getAttribute("aria-label") || targetTabId;
      m.activateMainMirrorFromRestore(tabBtn, title);
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
    stampPanelBodyHide();
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m) => {
      m.ensureHostContentParkedPublic();
    }).catch(() => {});
    if (targetTabId) {
      if (!isPrimaryTabActive(targetTabId)) {
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
    const finish = () => {
      stampPanelBodyHide();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          unsuppressMainDrawer();
        });
      });
    };
    const poll = () => {
      if (_stopped) {
        unsuppressMainDrawer();
        return;
      }
      stampPanelBodyHide();
      if (!targetTabId) {
        finish();
        return;
      }
      if (isPrimaryTabActive(targetTabId)) {
        stable++;
        if (stable === 1) {
          Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m) => {
            m.ensureHostContentParkedPublic();
          }).catch(() => {});
        }
        if (stable >= RESTORE_ACTIVE_STABLE_POLLS) {
          finish();
          return;
        }
      } else {
        stable = 0;
        if (polls % 3 === 0) {
          clickRestoredPrimaryTab(targetTabId, preferMirror);
          Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m) => {
            m.ensureHostContentParkedPublic();
          }).catch(() => {});
        }
      }
      polls++;
      if (polls >= RESTORE_TAB_POLL_MAX) {
        clickRestoredPrimaryTab(targetTabId, preferMirror);
        finish();
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
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "class") {
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
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "class") {
          const target = m.target;
          if (target.className && /tabBtn/.test(target.className)) {
            pushCurrentState();
            break;
          }
        } else if (m.type === "childList") {
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
  if (isPrimaryTabActive(targetTabId))
    return;
  const keepVisible = !!getSettings().keepTabListVisible;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  clickRestoredPrimaryTab(targetTabId, keepVisible && !isMobile);
}
function restoreMainDrawerFromDom(targetOpen, targetTabId, targetWidthPx) {
  if (_stopped)
    return;
  const drawer = getMainDrawer();
  const wrapper = _wrapper || drawer;
  if (!wrapper) {
    dlog("main-persist restore: no wrapper in DOM, cannot restore");
    unsuppressMainDrawer();
    return;
  }
  const clampedWidth = typeof targetWidthPx === "number" && targetWidthPx > 0 ? clampSidebarWidth(targetWidthPx) : null;
  const keepVisible = !!getSettings().keepTabListVisible;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  if (keepVisible && !isMobile) {
    Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m) => {
      if (_stopped) {
        unsuppressMainDrawer();
        return;
      }
      if (clampedWidth !== null) {
        m.applyMainMirrorRestoredWidth(clampedWidth);
      }
      if (targetOpen) {
        m.openCanvasMainDrawer();
        scheduleRestoreTabThenUnsuppress(targetTabId, true);
      } else {
        m.closeCanvasMainDrawer();
        unsuppressMainDrawer();
      }
    });
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
var RESIZE_DEBOUNCE_MS = 300, MOUNT_QUIET_MS = 500, UNSUPPRESS_TIMEOUT_MS = 3000, RESTORE_TAB_CLICK_MS = 0, RESTORE_PENDING_CLASS = "sidebar-ux-main-restore-pending", RESTORE_GUARD_STYLE_ID = "sidebar-ux-main-restore-guard", RESTORE_HIDE_ATTR = "data-canvas-restore-hide", RESTORE_ACTIVE_STABLE_POLLS = 1, _wrapper = null, _sidebar = null, _classObserver = null, _tabObserver = null, _resizeObserver = null, _resizeDebounce = null, _stopped = true, _lastSeenOpen = null, _lastSeenTabId = null, _unsuppressTimer = null, _panelHideObserver = null, _panelHideRaf = null, RESTORE_TAB_POLL_MAX = 50, RESTORE_TAB_POLL_MS = 16;
var init_main_persist = __esm(() => {
  init_persist();
  init_state();
  init_log();
  init_handles();
  init_mobile_exclusion();
  init_persist_polling();
  init_persist_polling();
});

// src/sidebar/mobile-exclusion.ts
function syncCssVarToDrawerWidth() {
  const el = document.documentElement;
  if (isMobileViewport()) {
    const current = parseFloat(el.style.getPropertyValue(SECONDARY_WIDTH_VAR));
    if (isFinite(current) && _desktopCssVarValue === null) {
      _desktopCssVarValue = current;
    }
    el.style.setProperty(SECONDARY_WIDTH_VAR, `${window.innerWidth}px`);
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
  _mediaQuery = window.matchMedia("(max-width: 600px)");
  function _updateDrawerWidth() {
    cancelWrapperAnimation();
    const wrapper2 = getSecondaryWrapper();
    const drawer = wrapper2?.querySelector(".sidebar-ux-drawer");
    if (!drawer)
      return;
    if (isMobileViewport()) {
      drawer.style.width = "100vw";
    } else {
      drawer.style.width = `var(${SECONDARY_WIDTH_VAR}, 420px)`;
    }
    syncCssVarToDrawerWidth();
    if (wrapper2) {
      const closedPx = getClosedTransformPx();
      wrapper2.style.transform = isSecondarySidebarOpen() ? "translateX(0)" : `translateX(${closedPx}px)`;
    }
  }
  _onMediaChange = (e) => {
    if (e.matches) {
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
      Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m) => m.reconcileTabListPin());
      Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m) => m.reconcileMainTabListPin());
    } else {
      _updateDrawerWidth();
      document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
      Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m) => m.reconcileTabListPin());
      Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m) => m.reconcileMainTabListPin());
    }
  };
  _mediaQuery.addEventListener("change", _onMediaChange);
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
    if (_mediaQuery && _onMediaChange) {
      _mediaQuery.removeEventListener("change", _onMediaChange);
    }
    _mediaQuery = null;
    _onMediaChange = null;
    document.getElementById("canvas-ux-secondary-mobile")?.remove();
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
  };
}
var _desktopCssVarValue = null, _resizeRafId = null, _lastDiagLog = 0, DIAG_THROTTLE_MS = 500, BODY_CLASS_PRIMARY = "canvas-ux-mobile-primary-open", BODY_CLASS_SECONDARY = "canvas-ux-mobile-secondary-open", _mediaQuery = null, _onMediaChange = null;
var init_mobile_exclusion = __esm(() => {
  init_log();
  init_main_persist();
  init_secondary();
  init_animation();
});

// src/chat/reflow.ts
var exports_reflow = {};
__export(exports_reflow, {
  updateChatReflow: () => updateChatReflow,
  startReflowObserver: () => startReflowObserver,
  setChatMargin: () => setChatMargin,
  scheduleReflow: () => scheduleReflow,
  injectReflowStyles: () => injectReflowStyles,
  clearChatMargins: () => clearChatMargins
});
function setChatMargin(side, px) {
  const varName = side === "left" ? "--sidebar-ux-chat-ml" : "--sidebar-ux-chat-mr";
  document.documentElement.style.setProperty(varName, `${px}px`);
}
function clearChatMargins() {
  const root = document.documentElement;
  root.style.removeProperty("--sidebar-ux-chat-ml");
  root.style.removeProperty("--sidebar-ux-chat-mr");
}
function injectReflowStyles() {
  injectStyles("sidebar-ux-reflow", `
    [class*="_chatColumn_"],
    [data-component="LandingPage"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    @media (max-width: 600px) {
      [class*="_chatColumn_"],
      [data-component="LandingPage"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
        transition: none !important;
      }
    }
  `);
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
function getDockInsets() {
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
    return;
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
    if (mainWidth === 0 && getSettings().keepTabListVisible) {
      mainWidth = TAB_LIST_WIDTH_PX;
    }
  }
  let secondaryWidth = isSecondarySidebarOpen() ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420 : 0;
  if (secondaryWidth === 0 && getSettings().keepTabListVisible && getSecondaryTabList()) {
    secondaryWidth = TAB_LIST_WIDTH_PX;
  }
  const dockInsets = getDockInsets();
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
  setChatMargin("right", rightMargin);
  setChatMargin("left", leftMargin);
}
function _onMediaChangeImpl(e) {
  if (e.matches) {
    clearChatMargins();
  } else {
    updateChatReflow();
  }
}
function startReflowObserver() {
  injectReflowStyles();
  let cancelled = false;
  const observer = new MutationObserver((mutations) => {
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
  const _appElForRoute = document.querySelector("[data-app-root]");
  if (_appElForRoute && !cancelled) {
    const _routeObserver = new MutationObserver(() => {
      if (!cancelled)
        scheduleReflow();
    });
    _routeObserver.observe(_appElForRoute, { childList: true, subtree: true });
    scheduleReflow();
  }
  const stopTagObserver = startTagObserver();
  _mediaQuery2 = window.matchMedia("(max-width: 600px)");
  _onMediaChange2 = _onMediaChangeImpl;
  _mediaQuery2.addEventListener("change", _onMediaChange2);
  return () => {
    cancelled = true;
    observer.disconnect();
    if (_reflowRaf !== null) {
      cancelAnimationFrame(_reflowRaf);
      _reflowRaf = null;
    }
    stopTagObserver();
    if (_mediaQuery2 && _onMediaChange2) {
      _mediaQuery2.removeEventListener("change", _onMediaChange2);
    }
    _mediaQuery2 = null;
    _onMediaChange2 = null;
  };
}
var _reflowRaf = null, _mediaQuery2 = null, _onMediaChange2 = null;
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
  syncDrawerTabSettings();
  updateDrawerTabVisibility();
  syncPanelHeaderFromMain2();
  updateChatReflow();
  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar === "secondary") {
      const tabs = getDrawerTabs();
      const tab = tabs.find((t) => t.id === tabId);
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
  const w = Math.ceil(readWidthCssVar(SECONDARY_WIDTH_VAR, 420));
  return closedTransformPx(secondarySide2, w);
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
  const handles = document.querySelectorAll(".sidebar-ux-resize-handle");
  for (const h of Array.from(handles)) {
    if (h.parentElement && h.parentElement.classList.contains("sidebar-ux-drawer")) {
      h.remove();
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

// src/layout/apply.ts
function cancelApplyLayoutInterval() {
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
}
function isTabFullyRestored(tabId) {
  if (!hasTabAssignment(tabId))
    return false;
  const _secondaryContent = document.querySelector(".sidebar-ux-panel-content");
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
  if (layout.secondary?.width && !isMobileViewport()) {
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
  if (layout.detachedTabs?.length) {
    const stripSuffix = (id) => {
      const lastColon = id.lastIndexOf(":");
      if (lastColon <= 0)
        return id;
      const tail = id.slice(lastColon + 1);
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id;
    };
    setRestoringFromLayout(true);
    setSuppressAutoActivation(true);
    let _restoreFinished = false;
    const _assigningIds = new Set;
    const resolveRestoredActiveTabId = () => {
      const saved = layout.secondary?.activeTabId;
      if (saved) {
        if (hasTabAssignment(saved))
          return saved;
        const prefix = stripSuffix(saved);
        const matches = layout.detachedTabs.map((dt) => dt.tabId).filter((id) => hasTabAssignment(id) && stripSuffix(id) === prefix);
        if (matches.length === 1) {
          if (layout.secondary)
            layout.secondary.activeTabId = matches[0];
          return matches[0];
        }
      }
      const fallback = layout.detachedTabs.find((dt) => hasTabAssignment(dt.tabId));
      return fallback?.tabId ?? null;
    };
    const finishRestore = () => {
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
      const restoredId = resolveRestoredActiveTabId();
      if (restoredId) {
        showSecondaryTab(restoredId);
      }
      const mobileExcluded = isMobileViewport() && isMainDrawerOpen();
      const _hasDetachedTabs = (layout.detachedTabs?.length ?? 0) > 0;
      const savedOpen = layout.secondary?.open;
      const _shouldBeOpen = savedOpen !== undefined ? savedOpen === true : _hasDetachedTabs;
      if (mobileExcluded && isSecondarySidebarOpen()) {
        enforceExclusionOnOpen("primary");
      } else if (_shouldBeOpen && !isSecondarySidebarOpen()) {
        openSecondarySidebar();
      } else if (!_shouldBeOpen && isSecondarySidebarOpen()) {
        closeSecondarySidebar();
      }
      if (_hasDetachedTabs) {
        updateDrawerTabVisibility();
      }
      const primaryTabId = typeof layout.primary?.tabId === "string" ? layout.primary.tabId : null;
      if (primaryTabId && layout.primary?.open !== false) {
        Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then((m) => {
          m.ensureRestoredPrimaryTab(primaryTabId);
        });
      }
      setRestoringFromLayout(false);
      setSuppressAutoActivation(false);
    };
    const kickAssign = (tabId) => {
      if (_restoreFinished || _assigningIds.has(tabId))
        return;
      _assigningIds.add(tabId);
      assignToSecondary(tabId).catch((err) => {
        dwarn(`applyLayout: assignToSecondary(${tabId}) failed:`, err);
      }).finally(() => {
        _assigningIds.delete(tabId);
        if (_restoreFinished)
          return;
        const remaining = attemptRestore();
        if (remaining === 0)
          finishRestore();
      });
    };
    const attemptRestore = () => {
      if (_restoreFinished)
        return 0;
      let remaining = 0;
      for (let i = 0;i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i];
        const _alreadyAssigned = hasTabAssignment(dt.tabId);
        const _fullyRestored = _alreadyAssigned ? isTabFullyRestored(dt.tabId) : false;
        if (_alreadyAssigned && _fullyRestored)
          continue;
        remaining++;
        const tabs = getDrawerTabs();
        let tab = tabs.find((t) => t.id === dt.tabId);
        if (!tab) {
          const storedPrefix = stripSuffix(dt.tabId);
          const candidates = tabs.filter((t) => stripSuffix(t.id) === storedPrefix);
          if (candidates.length === 1) {
            tab = candidates[0];
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`);
            const prevId = dt.tabId;
            layout.detachedTabs[i] = { ...dt, tabId: tab.id };
            const savedActive = layout.secondary?.activeTabId;
            if (savedActive && (savedActive === prevId || stripSuffix(savedActive) === stripSuffix(prevId))) {
              layout.secondary = { ...layout.secondary, activeTabId: tab.id };
            }
          } else if (candidates.length > 1) {
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`);
          }
        }
        if (tab) {
          kickAssign(tab.id);
        } else {
          const mainBtn = findMainTabButton(dt.tabId);
          if (mainBtn) {
            const liveTabId = mainBtn.getAttribute("data-tab-id") || dt.tabId;
            kickAssign(liveTabId);
            dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}"`);
          } else {
            const knownIds = tabs.map((t) => t.id);
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(", ")}. Layout may be stale.`);
          }
        }
      }
      return remaining;
    };
    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
    if (sidebar) {
      _restoreObserver = new MutationObserver(() => {
        const remaining = attemptRestore();
        if (remaining === 0)
          finishRestore();
      });
      _restoreObserver.observe(sidebar, { childList: true, subtree: true });
    } else {
      queueMicrotask(() => {
        const remaining = attemptRestore();
        if (remaining === 0)
          finishRestore();
      });
    }
    _restoreTimeoutHandle = setTimeout(() => {
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
  }
}
var _restoreObserver = null, _restoreTimeoutHandle = null, _restoreTimeoutMs = 1e4;
var init_apply = __esm(() => {
  init_store();
  init_secondary();
  init_assignment();
  init_secondary_drawer();
  init_buttons();
  init_log();
  init_mobile_exclusion();
});

// src/layout/persist.ts
var exports_persist = {};
__export(exports_persist, {
  snapshotLayout: () => snapshotLayout,
  setMainDrawerState: () => setMainDrawerState,
  setBackendCtx: () => setBackendCtx,
  persistOpenState: () => persistOpenState,
  persistLayout: () => persistLayout,
  loadSavedLayout: () => loadSavedLayout,
  isLoadInProgress: () => isLoadInProgress,
  getBackendCtx: () => getBackendCtx,
  flushPendingSaves: () => flushPendingSaves,
  cancelLayoutSave: () => cancelLayoutSave,
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
function flushPendingSaves() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
  cancelSettingsSave();
  const layout = { ...snapshotLayout(), settings: getSettings() };
  backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
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
    if (isFinite(fromVar) && fromVar > 0)
      return fromVar;
  }
  const hostW = getMainDrawerWidth();
  return hostW > 0 ? hostW : 420;
}
function snapshotLayout() {
  const assignments = Array.from(getTabAssignments().entries());
  const secondaryAssignments = assignments.filter(([_, side]) => side === "secondary");
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
      const tab = tabs.find((t) => t.id === tabId);
      return { tabId, tabTitle: tab?.title || tabId, sidebar: side };
    })
  };
  return result;
}
function isPersistenceEnabled() {
  return getSettings().layoutPersistence;
}
function persistOpenState() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
  cancelSettingsSave();
  const layout = { ...snapshotLayout(), settings: getSettings() };
  backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
}
function persistLayout() {
  const backendCtx = getBackendCtx();
  if (!backendCtx)
    return;
  if (!isPersistenceEnabled())
    return;
  if (_loadInProgress)
    return;
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
  }
  cancelSettingsSave();
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null;
    const layout = { ...snapshotLayout(), settings: getSettings() };
    backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
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
  if (!layout || !layout.primary) {
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ unsuppressMainDrawer: unsuppressMainDrawer2 }) => {
      unsuppressMainDrawer2();
    });
    return;
  }
  Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ restoreMainDrawerFromDom: restoreMainDrawerFromDom2 }) => {
    restoreMainDrawerFromDom2(layout.primary.open === true, typeof layout.primary.tabId === "string" ? layout.primary.tabId : null, typeof layout.primary.width === "number" ? layout.primary.width : undefined);
  });
}
var CANVAS_VERSION = "1.7.2.9", _backendCtx = null, _saveLayoutTimer = null, _loadInProgress = false, _mainDrawerOpen = false, _mainDrawerTabId = null;
var init_persist = __esm(() => {
  init_store();
  init_secondary();
  init_styles();
  init_assignment();
  init_active_tab();
  init_state();
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
function normalizeCanvasSettings(s) {
  if (s.keepTabListVisible && !s.moveControlsToOuterEdge) {
    return { ...s, keepTabListVisible: false };
  }
  return s;
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
    const v = patch[key];
    if (v !== undefined)
      next[key] = v;
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
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null;
    const layoutSnapshot = _settings.layoutPersistence ? snapshotLayout() : _lastLoadedLayout ?? { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 }, detachedTabs: [] };
    const layout = { ...layoutSnapshot, settings: _settings };
    dlog(`persistSettings: debounced firing (layoutPersistence=${_settings.layoutPersistence}, snapshot.primary.open=${layout.primary.open}, snapshot.secondary.open=${layout.secondary.open})`);
    backendCtx.sendToBackend({ type: "SAVE_LAYOUT", layout });
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
    const fiberKey = Object.keys(sidebar).find((k) => k.startsWith("__reactFiber$"));
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
            state.forEach((t, i) => console.log(`  [${i}] id=${t.id} title=${t.title}`));
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
    for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 5); i--) {
      console.log(`Scanning down from ancestor at position ${i}...`);
      scan(ancestors[i], 0, 30);
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
    return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  const u = cmd.usage?.trim();
  if (u && !/[<>]/.test(u)) {
    return u.startsWith("/") ? u : `/${u}`;
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
  for (let i = 0;i < matches.length; i++) {
    const usage = (matches[i].usage ?? `/${matches[i].name}`).toLowerCase();
    if (usage.length > textLower.length && usage.startsWith(textLower)) {
      return i;
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
  injectStyles(STYLE_ID, `
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
var GHOST_ID = "canvas-slash-ghost", STYLE_ID = "canvas-slash-ghost-styles", _ctx = null;
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
    rows.forEach((row, i) => {
      const isActive = i === activeIndex;
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
    el.innerHTML = currentOptions.map((c, i) => {
      const label = escapeHtml2(c.usage ?? "/" + c.name);
      const desc = escapeHtml2(c.description ?? "");
      const owner = escapeHtml2(c.owner);
      const isActive = i === activeIndex;
      return `<div id="canvas-slash-opt-${i}" class="canvas-slash-opt"` + ` role="option" aria-selected="${isActive}" data-active="${isActive}"` + ` data-cmd="${escapeAttr(c.name)}">` + `<span class="canvas-slash-opt-body">` + `<span class="canvas-slash-opt-name">${label}</span>` + `<span class="canvas-slash-opt-desc">${desc}</span>` + `</span>` + `<span class="canvas-slash-opt-source">${owner}</span>` + `</div>`;
    }).join("");
    el.querySelectorAll(".canvas-slash-opt").forEach((row, i) => {
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      row.addEventListener("mouseenter", () => setActiveIndex(i));
      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentAnchor)
          return;
        const cmd = currentOptions[i];
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
  const setActiveIndex = (i) => {
    if (currentOptions.length === 0) {
      activeIndex = -1;
      updateActiveDom();
      notifyActive();
      return;
    }
    const clamped = Math.max(0, Math.min(currentOptions.length - 1, i));
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
  outsideDismissListener = (e) => {
    if (!_currentController)
      return;
    const target = e.target;
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
  injectStyles(STYLE_ID2, `
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
function escapeHtml2(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c] ?? c);
}
function escapeAttr(s) {
  return escapeHtml2(s);
}
var SUGGEST_ID = "canvas-slash-suggest", STYLE_ID2 = "canvas-slash-suggest-styles", _currentController = null, outsideDismissListener = null, currentAnchor = null, currentEl = null;
var init_suggest = __esm(() => {
  init_ghost_text();
  init_intent();
});

// src/dom/selectors.ts
var SELECTOR_TEXTAREA = 'textarea[name="chat-message"]', SELECTOR_SEND_BTN = 'button[class*="sendBtn"]';

// src/slash/intercept.ts
function installIntercept(_ctx2, callbacks) {
  const keydownHandler = (e) => {
    const target = e.target;
    if (!target || target.tagName !== "TEXTAREA")
      return;
    if (target.getAttribute("name") !== "chat-message")
      return;
    const ta = target;
    const popupVisible = isSuggestVisible();
    if (e.key === "Escape") {
      if (popupVisible) {
        e.preventDefault();
        e.stopPropagation();
        hideSuggest();
      }
      return;
    }
    if (e.isComposing)
      return;
    const ctrl = popupVisible ? getSuggestController() : null;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!ctrl)
        return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      ctrl.setActiveIndex(e.key === "ArrowDown" ? ctrl.getActiveIndex() + 1 : ctrl.getActiveIndex() - 1);
      return;
    }
    if (e.key === "ArrowRight") {
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
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      applySuggestion(ta, suggestionLabel(activeCmd));
      hideSuggest();
      callbacks.onTextChange(ta.value);
      return;
    }
    if (e.key === "Tab") {
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
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
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
    if (e.key === "Enter" && !e.shiftKey) {
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
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          hideSuggest();
          ta.focus();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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
  const compositionEndHandler = (e) => {
    _isComposing = false;
    const target = e.target;
    if (!target || target.tagName !== "TEXTAREA")
      return;
    if (target.getAttribute("name") !== "chat-message")
      return;
    const ta = target;
    queueMicrotask(() => callbacks.onTextChange(ta.value));
  };
  document.addEventListener("compositionstart", compositionStartHandler, true);
  document.addEventListener("compositionend", compositionEndHandler, true);
  const clickHandler = (e) => {
    const target = e.target;
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
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    setSkipNextTextChange();
    setControlledValue(ta, "");
    hideSuggest();
    callbacks.onParsed(parsed, ta);
  };
  document.addEventListener("click", clickHandler, true);
  const touchHandler = (e) => {
    const target = e.target;
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
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    setSkipNextTextChange();
    setControlledValue(ta, "");
    hideSuggest();
    callbacks.onParsed(parsed, ta);
  };
  document.addEventListener("touchend", touchHandler, true);
  const inputHandler = (e) => {
    const target = e.target;
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
      const lines = cmds.map((c) => `${c.usage ?? "/" + c.name}  —  ${c.description}`);
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
  return candidates.filter((c) => c.toLowerCase().startsWith(lower));
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
  const chunks = trimmed.split(",").map((c) => c.trim()).filter((c) => c !== "");
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
    const parts = normalized.split("-").filter((p) => p !== "");
    let from;
    let to;
    if (parts.length === 1) {
      const n = parseIntStrict(parts[0]);
      if (n === null)
        return { kind: "error", reason: `Invalid number: "${parts[0]}"` };
      from = n;
      to = n;
    } else if (parts.length === 2) {
      const a = parseIntStrict(parts[0]);
      const b = parseIntStrict(parts[1]);
      if (a === null)
        return { kind: "error", reason: `Invalid number: "${parts[0]}"` };
      if (b === null)
        return { kind: "error", reason: `Invalid number: "${parts[1]}"` };
      from = Math.min(a, b);
      to = Math.max(a, b);
    } else {
      return { kind: "error", reason: `Malformed range: "${chunk}"` };
    }
    if (from < 0)
      return { kind: "error", reason: "Negative indices not allowed" };
    if (to - from + 1 > MAX_INDICES) {
      return { kind: "error", reason: `Range too large (max ${MAX_INDICES} indices)` };
    }
    for (let i = from;i <= to; i++)
      indices.add(i);
  }
  if (indices.size === 0)
    return { kind: "error", reason: "No valid indices parsed" };
  return { kind: "range", indices };
}
function parseIntStrict(s) {
  if (!/^\d+$/.test(s))
    return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0)
    return null;
  return n;
}
var MAX_INDICES = 999999;

// src/slash/commands/select/extract.ts
function parseIndexFromText(text) {
  if (typeof text !== "string")
    return null;
  const trimmed = text.trim();
  const m = INDEX_RE.exec(trimmed);
  if (!m)
    return null;
  const n = parseInt(m[1], 10);
  if (!Number.isSafeInteger(n) || n < 0)
    return null;
  return n;
}
function readIndexInChat(row) {
  if (!row)
    return null;
  const pill = row.querySelector('[class*="metaPill"]');
  if (pill) {
    const seg = pill.querySelector('[class*="metaSegment"]');
    if (seg) {
      const n = parseIndexFromText(seg.textContent);
      if (n !== null)
        return n;
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
        const n = message.index_in_chat;
        if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) {
          return n;
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
  for (const i of indices) {
    if (!matchedIndices.has(i))
      missingIndices.push(i);
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
  const t = text.trim();
  if (!t)
    return "";
  if (t.length > 1 && t[0].toLowerCase() === t[1].toLowerCase()) {
    return t.slice(1).trim();
  }
  return t;
}
function cacheValid(chatId) {
  return _cache !== null && _cache.chatId === chatId && Date.now() - _cache.fetchedAt < CACHE_TTL_MS2;
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
        _cache = { chatId, names: [], fetchedAt: Date.now() - CACHE_TTL_MS2 + 1500 };
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
    for (const m of mutations) {
      for (const node of m.addedNodes) {
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
    for (const m of mutations) {
      for (const node of m.addedNodes) {
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
          if (label && !names.some((n) => n.toLowerCase() === label.toLowerCase())) {
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
  for (let i = 0;i < 100; i++) {
    await new Promise((r) => requestAnimationFrame(r));
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
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      ctx.toast("success", `Switched to persona: ${personaName}`);
    }
  };
}
var CACHE_TTL_MS2 = 60000, _cache = null, _warming = false;
var init_persona = () => {};

// src/slash/microtask.ts
function defer(fn) {
  return new Promise((resolve, reject) => {
    if (typeof MessageChannel === "function") {
      const ch = new MessageChannel;
      ch.port1.onmessage = () => {
        try {
          Promise.resolve(fn()).then(resolve, reject);
        } catch (e) {
          reject(e);
        }
      };
      ch.port2.postMessage(null);
    } else {
      queueMicrotask(() => {
        try {
          Promise.resolve(fn()).then(resolve, reject);
        } catch (e) {
          reject(e);
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.toast("error", `/${cmd.name} failed: ${msg}`);
    dwarn(`${cmd.name} failed:`, e);
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
  injectStyles(STYLE_ID3, `
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
var STYLE_ID3 = "canvas-slash-toast-styles", nextId = 0, listeners, toasts, _toastTimers, mounted = false, toastHostEl = null, toastEventHandler = null;
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
`, debugFeature, _chatReflowTeardown = null, chatReflowFeature, secondSidebarFeature, resizeSidebarsFeature, drawerSyncFeature, consistentIconSizeFeature, shadowsDesktopFeature, shadowsMobileFeature, layoutPersistenceFeature, _slashImpl, slashFeature, tabPositionFeature, keepTabListVisibleFeature, FEATURES;
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
  init_buttons();
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
      const initialWidth = layout?.secondary?.width;
      const initialOpen = layout?.secondary?.open === true;
      mountSecondarySidebar({ initialWidth, initialOpen });
      return tearDownSecondarySidebar;
    },
    apply(prev, next) {
      if (prev.secondSidebarEnabled === next.secondSidebarEnabled)
        return;
      if (next.secondSidebarEnabled) {
        if (!getSecondaryWrapper()) {
          const layout = getLastLoadedLayout();
          const initialWidth = layout?.secondary?.width;
          const initialOpen = layout?.secondary?.open === true;
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
      if (prev.showTabLabels !== next.showTabLabels) {
        syncSecondaryTabLabels();
      }
    }
  };
  consistentIconSizeFeature = {
    id: "consistentIconSize",
    mount() {
      if (getSettings().consistentIconSize)
        injectDrawerTabStyles();
    },
    apply(prev, next) {
      if (prev.consistentIconSize === next.consistentIconSize)
        return;
      if (!next.consistentIconSize) {
        document.getElementById("sidebar-ux-icon-size-styles")?.remove();
      } else {
        injectDrawerTabStyles();
      }
    }
  };
  shadowsDesktopFeature = {
    id: "sidebarShadowsDesktop",
    init() {
      if (!getSettings().sidebarShadowsDesktop) {
        injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss("min", 601));
      }
    },
    apply(prev, next) {
      if (prev.sidebarShadowsDesktop === next.sidebarShadowsDesktop)
        return;
      if (next.sidebarShadowsDesktop) {
        document.getElementById(SHADOW_DISABLE_DESKTOP_ID)?.remove();
      } else {
        injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss("min", 601));
      }
    }
  };
  shadowsMobileFeature = {
    id: "sidebarShadowsMobile",
    init() {
      if (!getSettings().sidebarShadowsMobile) {
        injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss("max", 600));
      }
    },
    apply(prev, next) {
      if (prev.sidebarShadowsMobile === next.sidebarShadowsMobile)
        return;
      if (next.sidebarShadowsMobile) {
        document.getElementById(SHADOW_DISABLE_MOBILE_ID)?.remove();
      } else {
        injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss("max", 600));
      }
    }
  };
  layoutPersistenceFeature = {
    id: "layoutPersistence",
    apply(prev, next) {
      if (prev.layoutPersistence === true && next.layoutPersistence === false) {
        cancelLayoutSave();
      }
    }
  };
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
      updateChatReflow();
      return () => {
        applyTabListPin(false, { force: true });
        applyMainTabListPin(false, { force: true });
        updateDrawerTabVisibility();
        updateChatReflow();
      };
    },
    apply(_prev, next) {
      const on = !!next.keepTabListVisible && !!next.moveControlsToOuterEdge;
      applyTabListPin(on, { force: true });
      applyMainTabListPin(on, { force: true });
      updateDrawerTabVisibility();
      updateChatReflow();
    }
  };
  FEATURES = [
    debugFeature,
    chatReflowFeature,
    secondSidebarFeature,
    resizeSidebarsFeature,
    drawerSyncFeature,
    consistentIconSizeFeature,
    shadowsDesktopFeature,
    shadowsMobileFeature,
    layoutPersistenceFeature,
    slashFeature,
    tabPositionFeature,
    keepTabListVisibleFeature,
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
function buildShowLabelsControl(value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "sidebar-ux-panel-segmented";
  const opts = [
    { value: "follow", label: "Follow" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" }
  ];
  for (const o3 of opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar-ux-panel-segmented-btn" + (value === o3.value ? " sidebar-ux-panel-segmented-btn-active" : "");
    btn.textContent = o3.label;
    btn.addEventListener("click", () => onChange(o3.value));
    wrap.appendChild(btn);
  }
  return wrap;
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
    .sidebar-ux-panel-footer {
      margin-top: 18px;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      text-align: center;
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
    const h3 = document.createElement("h4");
    h3.className = "sidebar-ux-panel-section-title";
    h3.textContent = title;
    sec.appendChild(h3);
    return sec;
  };
  const sec1 = section("Chat & Layout");
  const chat = makeToggle(() => getSettings().chatReflow, (v3) => setSettings({ chatReflow: v3 }));
  sec1.appendChild(buildSettingRow({
    label: "Center the chat in the visible area",
    hint: "Shifts the chat column by the open-drawer widths so neither sidebar covers it.",
    control: chat.btn
  }));
  const persist = makeToggle(() => getSettings().layoutPersistence, (v3) => setSettings({ layoutPersistence: v3 }));
  sec1.appendChild(buildSettingRow({
    label: "Remember layout across sessions",
    hint: "Persists open/closed state, widths, and tab assignments to layout.json.",
    control: persist.btn
  }));
  const slash = makeToggle(() => getSettings().slashCommandsEnabled, (v3) => setSettings({ slashCommandsEnabled: v3 }));
  sec1.appendChild(buildSettingRow({
    label: "Enable slash commands",
    hint: "When on, typing / in the chat input opens the slash-command menu. When off, / is treated as plain text and no command parsing runs.",
    control: slash.btn
  }));
  const secSidebars = section("Sidebars");
  const moveControlsToOuter = makeToggle(() => getSettings().moveControlsToOuterEdge, (v3) => setSettings({ moveControlsToOuterEdge: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Move tab controls to outer edge",
    hint: "Moves the list of tab buttons to be along the edge of the screen instead of the edge of the chat area. Required for “Keep tab lists visible”.",
    control: moveControlsToOuter.btn
  }));
  const keepTabListVisible = makeToggle(() => getSettings().keepTabListVisible, (v3) => setSettings({ keepTabListVisible: v3 }), { disabled: () => !getSettings().moveControlsToOuterEdge });
  const keepTabListVisibleRow = buildSettingRow({
    label: "Keep tab lists visible",
    hint: "Requires “Move tab controls to outer edge”. Pins tab buttons to the screen edge when a drawer is closed so you can switch tabs without opening it. Applies to the main drawer and, when enabled, the second drawer.",
    control: keepTabListVisible.btn,
    disabled: !getSettings().moveControlsToOuterEdge
  });
  secSidebars.appendChild(keepTabListVisibleRow);
  const resizeSidebars = makeToggle(() => getSettings().resizeSidebars, (v3) => setSettings({ resizeSidebars: v3 }), { disabled: () => !getSettings().secondSidebarEnabled });
  secSidebars.appendChild(buildSettingRow({
    label: "Drag to resize sidebars",
    hint: "Adds a 4px grab handle on the inner edge of both drawers.",
    control: resizeSidebars.btn,
    disabled: !getSettings().secondSidebarEnabled
  }));
  const shadowsDesktop = makeToggle(() => getSettings().sidebarShadowsDesktop, (v3) => setSettings({ sidebarShadowsDesktop: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Sidebar shadows (desktop)",
    hint: "Show box-shadow on sidebars when the viewport is wider than 600px.",
    control: shadowsDesktop.btn
  }));
  const shadowsMobile = makeToggle(() => getSettings().sidebarShadowsMobile, (v3) => setSettings({ sidebarShadowsMobile: v3 }));
  secSidebars.appendChild(buildSettingRow({
    label: "Sidebar shadows (mobile)",
    hint: "Show box-shadow on sidebars when the viewport is 600px or narrower.",
    control: shadowsMobile.btn
  }));
  const sec2 = section("Second drawer");
  const master = makeToggle(() => getSettings().secondSidebarEnabled, (v3) => setSettings({ secondSidebarEnabled: v3 }));
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
  let showLabelsWrap;
  let showLabelsRow;
  const buildShowLabelsSeg = () => buildShowLabelsControl(getSettings().showTabLabels, (v3) => setSettings({ showTabLabels: v3 }));
  showLabelsWrap = buildShowLabelsSeg();
  showLabelsRow = buildSettingRow({
    label: "Tab labels in the second drawer",
    hint: `"Follow" mirrors Lumiverse's main sidebar setting. "Show" / "Hide" override it.`,
    control: showLabelsWrap,
    disabled: !getSettings().secondSidebarEnabled
  });
  sec2.appendChild(showLabelsRow);
  const iconSize = makeToggle(() => getSettings().consistentIconSize, (v3) => setSettings({ consistentIconSize: v3 }));
  sec2.appendChild(buildSettingRow({
    label: "Force 20×20 icon size on tab buttons",
    hint: "Fixes tabs that ship icons without intrinsic dimensions (some extensions render at 0×0 by default).",
    control: iconSize.btn
  }));
  const sec4 = section("Debug");
  const debugMode = makeToggle(() => getSettings().debugMode, (v3) => setSettings({ debugMode: v3 }));
  sec4.appendChild(buildSettingRow({
    label: "Debug mode",
    hint: "Enables [Canvas] console output and installs window.__canvasDebug() for in-browser fiber tree inspection. Useful when filing a bug report.",
    control: debugMode.btn
  }));
  const footer = document.createElement("div");
  footer.className = "sidebar-ux-panel-footer";
  footer.textContent = "Canvas settings persist to layout.json (300ms debounce).";
  root.appendChild(sec1);
  root.appendChild(secSidebars);
  root.appendChild(sec2);
  root.appendChild(sec4);
  root.appendChild(footer);
  const refresh = () => {
    master.refresh();
    moveControlsToOuter.refresh();
    keepTabListVisible.refresh();
    resizeSidebars.refresh();
    compact.refresh();
    iconSize.refresh();
    chat.refresh();
    persist.refresh();
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
    for (const row of [resizeSidebars, compact]) {
      const d3 = !getSettings().secondSidebarEnabled;
      row.btn.disabled = d3;
      row.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      row.btn.parentElement?.classList.toggle("sidebar-ux-panel-row-disabled", d3);
    }
    showLabelsRow.classList.toggle("sidebar-ux-panel-row-disabled", !getSettings().secondSidebarEnabled);
    const newSeg = buildShowLabelsSeg();
    showLabelsWrap.replaceWith(newSeg);
    showLabelsWrap = newSeg;
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
init_secondary();
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
  if (info.currentSidebar === "secondary" && isSecondarySidebarOpen()) {
    label = "Move to main drawer";
    targetSidebar = "primary";
  } else if (info.currentSidebar === "secondary" && !isSecondarySidebarOpen()) {
    label = "Open in second drawer";
    targetSidebar = "secondary";
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
      dlog("[tabmove] docCtxCapture: main-mirror btn — Canvas menu handles it");
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
  const h3 = _handlers;
  if (h3.docCtxCapture)
    document.removeEventListener("contextmenu", h3.docCtxCapture, true);
  if (h3.docClick)
    document.removeEventListener("click", h3.docClick);
  if (h3.docScroll)
    document.removeEventListener("scroll", h3.docScroll, true);
  if (h3.docKey)
    document.removeEventListener("keydown", h3.docKey);
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
    registerCleanup(() => {
      teardownSecondaryDrawer();
    });
    if (layout && getSettings().secondSidebarEnabled) {
      applyLayout(layout).catch((err) => {
        dwarn("Canvas: applyLayout failed:", err);
      });
    }
    applyMainDrawer(layout);
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
