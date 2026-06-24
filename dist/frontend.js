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
  dwarn("Could not find drawerTabs in fiber tree");
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

// src/dom/clamp.ts
function clampSidebarWidth(px) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(window.innerWidth * MAX_SIDEBAR_WIDTH_FRAC, px));
}
var MIN_SIDEBAR_WIDTH = 200, MAX_SIDEBAR_WIDTH_FRAC = 0.8;

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
  if (document.getElementById(id))
    return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

// src/sidebar/tab-position.ts
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
  const borderVal = "1px solid var(--lumiverse-bg-070)";
  if (enabled) {
    if (chatSide === "right") {
      setIfDifferent(panel.style, "borderRight", borderVal);
      setIfDifferent(panel.style, "borderLeft", "none");
    } else {
      setIfDifferent(panel.style, "borderLeft", borderVal);
      setIfDifferent(panel.style, "borderRight", "none");
    }
  } else {
    setIfDifferent(panel.style, "borderRight", "none");
    setIfDifferent(panel.style, "borderLeft", "none");
  }
  setIfDifferent(panel.style, "borderTop", "none");
  setIfDifferent(panel.style, "borderBottom", "none");
}
function applyTabListPosition(enabled, opts) {
  if (isMobileViewport())
    return;
  const side = getMainDrawerSide();
  const drawer = opts?.drawer ?? getSecondaryDrawer();
  const tabList = opts?.tabList ?? getSecondaryTabList();
  const panel = opts?.panel ?? getSecondaryPanel();
  if (drawer && tabList) {
    const secondaryDrawerSide = side === "left" ? "right" : "left";
    const defaultFlex = secondaryDrawerSide === "left" ? "row-reverse" : "row";
    const toggledFlex = secondaryDrawerSide === "left" ? "row" : "row-reverse";
    const wantFlex = enabled ? toggledFlex : defaultFlex;
    applyFlexAndBorder(drawer, tabList, wantFlex);
    if (panel)
      applyPanelChatBorder(panel, secondaryDrawerSide, enabled);
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
      applyPanelChatBorder(mainPanel, side, enabled);
  }
}
var init_tab_position = __esm(() => {
  init_store();
  init_mobile_exclusion();
  init_secondary();
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
  const secondaryWrapper = getSecondaryWrapper();
  if (secondaryWrapper) {
    const secondaryDrawer = secondaryWrapper.querySelector(".sidebar-ux-drawer");
    if (secondaryDrawer && !secondaryDrawer.querySelector(".sidebar-ux-resize-handle")) {
      const mainSide = getMainDrawerSide();
      const secondarySide = mainSide === "left" ? "right" : "left";
      const secondaryDirection = secondarySide === "right" ? "left" : "right";
      const handle = createResizeHandle(secondaryDirection, (startWidth, delta) => {
        const newWidth = clampSidebarWidth(startWidth + delta);
        document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${newWidth}px`);
        scheduleReflow();
      }, () => {
        const width = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420;
        persistLayout();
      }, () => isSecondarySidebarOpen());
      handle.style.cssText += `
        ${secondarySide === "left" ? "right" : "left"}: -4px;
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
  restoreMainDrawerFromDom: () => restoreMainDrawerFromDom,
  findDrawerToggleButton: () => findDrawerToggleButton,
  cleanupDomPoll: () => cleanupDomPoll
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
function suppressMainDrawer() {
  const wrapper = _wrapper;
  if (!wrapper)
    return;
  wrapper.style.setProperty("visibility", "hidden", "important");
  if (_unsuppressTimer)
    clearTimeout(_unsuppressTimer);
  _unsuppressTimer = setTimeout(() => {
    unsuppressMainDrawer();
    dlog("main-persist: unsuppress timeout fired (restore may have failed)");
  }, UNSUPPRESS_TIMEOUT_MS);
}
function unsuppressMainDrawer() {
  if (_unsuppressTimer) {
    clearTimeout(_unsuppressTimer);
    _unsuppressTimer = null;
  }
  const wrapper = _wrapper;
  if (!wrapper)
    return;
  wrapper.style.removeProperty("visibility");
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
  const open = readWrapperOpen(_wrapper);
  const tabId = _sidebar ? readActiveTabId(_sidebar) : null;
  if (open === _lastSeenOpen && tabId === _lastSeenTabId)
    return;
  _lastSeenOpen = open;
  _lastSeenTabId = tabId;
  setMainDrawerState(open, tabId);
  persistOpenState();
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
  const currentOpen = readWrapperOpen(wrapper);
  if (currentOpen === targetOpen) {
    if (targetOpen && clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`;
        wrapper.style.setProperty("--drawer-panel-w", `${clampedWidth}px`, "important");
      }
    }
    unsuppressMainDrawer();
    return;
  }
  if (targetOpen) {
    if (clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`;
        wrapper.style.setProperty("--drawer-panel-w", `${clampedWidth}px`, "important");
      }
    }
    const sidebar = _sidebar || document.querySelector('[data-spindle-mount="sidebar"]');
    const tabBtn = sidebar?.querySelector('button[class*="tabBtn"]');
    if (tabBtn) {
      unsuppressMainDrawer();
      try {
        tabBtn.click();
      } catch (err) {
        dlog(`main-persist restore: tabBtn.click() threw: ${err}`);
      }
    } else {
      unsuppressMainDrawer();
    }
  } else {
    const toggleBtn = findDrawerToggleButton(wrapper);
    if (toggleBtn) {
      unsuppressMainDrawer();
      try {
        toggleBtn.click();
      } catch (err) {
        dlog(`main-persist restore: toggleBtn.click() threw: ${err}`);
      }
    } else {
      unsuppressMainDrawer();
    }
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
  _wrapper = null;
  _sidebar = null;
  _lastSeenOpen = null;
  _lastSeenTabId = null;
  if (_unsuppressTimer) {
    clearTimeout(_unsuppressTimer);
    _unsuppressTimer = null;
  }
}
var RESIZE_DEBOUNCE_MS = 300, MOUNT_QUIET_MS = 500, UNSUPPRESS_TIMEOUT_MS = 3000, _wrapper = null, _sidebar = null, _classObserver = null, _tabObserver = null, _resizeObserver = null, _resizeDebounce = null, _stopped = true, _lastSeenOpen = null, _lastSeenTabId = null, _unsuppressTimer = null;
var init_main_persist = __esm(() => {
  init_persist();
  init_log();
  init_handles();
  init_mobile_exclusion();
  init_persist_polling();
  init_persist_polling();
});

// src/sidebar/animation.ts
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function animFrame(wrapper, now) {
  if (_animStart === null)
    _animStart = now;
  const elapsed = now - _animStart;
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1);
  const eased = easeOutCubic(progress);
  const val = _animFrom + (_animTo - _animFrom) * eased;
  wrapper.style.transform = `translateX(${val}px)`;
  if (progress < 1) {
    _animRaf = requestAnimationFrame((t) => animFrame(wrapper, t));
  } else {
    _animRaf = null;
    _animStart = null;
  }
}
function cancelWrapperAnimation() {
  if (_animRaf !== null) {
    cancelAnimationFrame(_animRaf);
    _animRaf = null;
    _animStart = null;
  }
}
function animateWrapper(wrapper, targetPx) {
  const current = wrapper ? parseFloat(wrapper.style.transform?.match(/-?[\d.]+/)?.[0] || "0") : 0;
  _animFrom = current;
  _animTo = targetPx;
  _animStart = null;
  if (_animRaf !== null)
    cancelAnimationFrame(_animRaf);
  _animRaf = requestAnimationFrame((t) => animFrame(wrapper, t));
}
var ANIM_DURATION_MS = 350, _animRaf = null, _animStart = null, _animFrom = 0, _animTo = 0;

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
    } else {
      _updateDrawerWidth();
      document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
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
});

// src/chat/reflow.ts
function setChatMargin(side, px) {
  const chat = getChatColumn();
  if (!chat)
    return;
  const varName = side === "left" ? "--sidebar-ux-chat-ml" : "--sidebar-ux-chat-mr";
  chat.style.setProperty(varName, `${px}px`);
}
function clearChatMargins(chat) {
  if (!chat)
    return;
  chat.style.removeProperty("--sidebar-ux-chat-ml");
  chat.style.removeProperty("--sidebar-ux-chat-mr");
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
    clearChatMargins(getChatColumn());
    return;
  }
  const mainSide = getMainDrawerSide();
  const mainOpen = isMainDrawerOpen();
  const mainWidth = mainOpen ? getMainDrawerWidth() : 0;
  const secondaryWidth = isSecondarySidebarOpen() ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420 : 0;
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
    clearChatMargins(getChatColumn());
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
  const _appElForChat = document.querySelector("[data-app-root]");
  if (_appElForChat && !cancelled) {
    const _chatObserver = new MutationObserver(() => {
      const _chat = getChatColumn();
      if (_chat && !cancelled) {
        scheduleReflow();
      }
    });
    _chatObserver.observe(_appElForChat, { childList: true, subtree: true });
    if (getChatColumn()) {
      scheduleReflow();
    }
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
  const tabList = getSecondaryWrapper()?.querySelector(".sidebar-ux-tab-list");
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
    if (!isSecondarySidebarOpen())
      openSecondarySidebar();
    showSecondaryTab(tab.id);
  });
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAssignmentMenu(e.clientX, e.clientY, tab.id, tab.title, btn);
  });
  tabList.appendChild(btn);
}
function removeSecondaryTabButton(tabId) {
  const btn = getSecondaryWrapper()?.querySelector(`[data-tab-id="${tabId}"]`);
  btn?.remove();
}
function updateDrawerTabVisibility() {
  const drawerTab = getSecondaryWrapper()?.querySelector(".sidebar-ux-drawer-tab");
  if (!drawerTab)
    return;
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
  const allBtns = getSecondaryWrapper()?.querySelectorAll(".sidebar-ux-tab-list button[data-tab-id]");
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
  init_assignment();
  init_tab_context_menu();
  init_persist();
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
  const btns = document.querySelectorAll(".sidebar-ux-tab-list button[data-tab-id]");
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
  setRestoringFromLayout: () => setRestoringFromLayout,
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
    if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport()) {
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
        for (const _child of Array.from(_secondaryContent.children)) {
          if (_child instanceof HTMLElement) {
            if (_child === _root) {
              _child.setAttribute("data-canvas-active", "");
            } else {
              _child.removeAttribute("data-canvas-active");
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
    if (!isMobileViewport()) {
      _activeTabId = resolvedId;
      _state = "tab_active";
      setActiveSecondaryTabId(resolvedId);
    }
    const _headerTitle = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
    if (_headerTitle) {
      _headerTitle.textContent = tab.title || _existingRoot?.getAttribute("data-tab-title") || resolvedId;
    }
  } else {
    const _secondaryWrapper = getSecondaryWrapper();
    const _secondaryContent = _secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
    const _storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
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
    const wSpindle = getHostBridge();
    const wSpindleUi = wSpindle?.ui;
    if (!_root || !_secondaryContent) {
      if (_secondaryContent && !_root && wSpindleUi?.getBuiltInTabRoot && wSpindleUi?.requestTabLocation) {
        const _lazyRoot = wSpindleUi.getBuiltInTabRoot(tabId);
        if (!_lazyRoot) {
          dwarn("[SecondaryDrawer] assignToSecondary: built-in tabId not registered (stale or renamed). Skipping restore.", { tabId, resolvedId });
          return;
        }
        _root = _lazyRoot;
        wSpindleUi.requestTabLocation(tabId, { kind: "container", containerId: "canvas-secondary-drawer" });
      } else {
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
    for (const _child of Array.from(_secondaryContent.children)) {
      if (_child instanceof HTMLElement) {
        if (_child === _root) {
          _child.setAttribute("data-canvas-active", "");
        } else {
          _child.removeAttribute("data-canvas-active");
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
    if (_state === "closed" && !isSecondarySidebarOpen() && !isMobileViewport()) {
      await openSecondarySidebar();
      _state = "tab_active";
      _activeTabId = resolvedId;
      setActiveSecondaryTabId(resolvedId);
    }
    const _headerTitle = _secondaryWrapper?.querySelector(".sidebar-ux-panel-title");
    if (_headerTitle)
      _headerTitle.textContent = _title;
  }
  const _finalPanelB = document.querySelector(".sidebar-ux-panel-content");
  const _finalTabListB = document.querySelector(".sidebar-ux-tab-list");
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
var _state = "closed", _activeTabId = null, _restoringFromLayout = false;
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
    const bridge = getHostBridge();
    const builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId);
    if (builtInRoot && bridge) {
      builtInRoot.setAttribute("data-canvas-moved", tabId);
      builtInRoot.setAttribute("data-canvas-active", "");
      armMainDrawerActiveRestore(tabId);
      const preMoveSourceList2 = await captureSourceList("primary");
      const preMoveActiveTab2 = isTabActiveInMainDrawer(tabId);
      bridge.ui.requestTabLocation(tabId, { kind: "container", containerId: "canvas-secondary-drawer" });
      const afterLoc = bridge.ui.getTabLocation?.(tabId) ?? null;
      watchForContainerPass3Reset(bridge, tabId, builtInRoot, afterLoc);
      setTabAssignment(tabId, "secondary");
      hideMainTabButton(tabId);
      addBuiltInSecondaryButton(bridge, tabId, builtInRoot);
      updateDrawerTabVisibility();
      if (!isSecondarySidebarOpen() && !isMobileViewport())
        openSecondarySidebar();
      await runHandoff({ tabId, source: "primary", destination: "secondary", sourceList: preMoveSourceList2, preMoveSourceActiveTab: preMoveActiveTab2 });
      persistLayout();
      return;
    }
    if (!bridge) {
      dwarn(`[tabmove] no host bridge; tabId="${tabId}" treated as extension. Built-in move requires the spindle loader.`);
    }
    const { assignToSecondary: assignToSecondary2 } = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    const preMoveSourceList = await captureSourceList("primary");
    const preMoveActiveTab = isTabActiveInMainDrawer(tabId);
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
  if (!drawerTab) {
    return;
  }
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
  if (secondaryWrapper) {
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
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-w", parts[0]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-h", parts[1]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-pt", parts[2]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-pr", parts[3]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-pb", parts[4]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-pl", parts[5]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-gap", parts[6]);
      secondaryWrapper.style.setProperty("--sidebar-ux-drawer-tab-border", parts[7]);
    }
  }
  const mainParent = mainDrawerTab.parentElement;
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0;
  const mainMarginStyle = mainDrawerTab.style.marginTop;
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0;
  if (_lastKnownVerticalPos !== posVh) {
    const settings = getSettings();
    if (settings.mirrorCompactPosition) {
      drawerTab.style.marginTop = `${posVh}vh`;
    } else if (settings.secondaryDrawerTabOverrideVh === undefined) {
      drawerTab.style.marginTop = "";
    }
    _lastKnownVerticalPos = posVh;
  }
  drawerTab.classList.toggle("sidebar-ux-drawer-tab--active", isSecondarySidebarOpen());
  syncSecondaryTabLabels();
}
function syncSecondaryTabLabels() {
  const showLabels = isShowTabLabels();
  const cacheKey = showLabels ? "show" : "hide";
  if (cacheKey === _lastWrittenLabelsKey)
    return;
  _lastWrittenLabelsKey = cacheKey;
  const labels = getSecondaryWrapper()?.querySelectorAll(".sidebar-ux-tab-label");
  if (!labels)
    return;
  for (const label of labels) {
    label.style.opacity = showLabels ? "1" : "0";
    label.style.height = showLabels ? "auto" : "0";
    label.style.marginTop = showLabels ? "1px" : "0";
    const btn = label.closest("button[data-tab-id]:not(.sidebar-ux-tab-secondary-canvas)");
    if (btn)
      btn.classList.toggle("sidebar-ux-tab-labeled", showLabels);
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
  init_assignment();
  init_cleanup();
  init_state();
  init_buttons();
  init_active_tab();
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
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] {
      color: var(--lumiverse-text-muted);
      border-radius: 8px;
    }
    /* Label color — matches main drawer .tabLabel
       (ViewportDrawer.module.css:245). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label {
      color: var(--lumiverse-text-dim);
    }
    /* Per-tab hover — mirrors Lumiverse's .tabBtn:hover
       (ViewportDrawer.module.css:222-225). Rounded corners. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover {
      background: var(--lumiverse-primary-015);
      color: var(--lumiverse-text);
      border-radius: 8px;
    }
    /* Active tab hover: icon turns white, label stays colored.
       Target the SVG directly so we only change the icon color. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg {
      color: var(--lumiverse-text);
    }
    /* Smooth color transition for SVG icons (matches the tabBtn
       transition: all 0.2s ease which only covers the button). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] svg {
      transition: color 0.2s ease;
    }
    /* Smooth color transition for labels. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label {
      transition: color 0.2s ease, opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
    }
    /* Per-tab active state — mirrors Lumiverse's .tabBtnActive
       (ViewportDrawer.module.css:227-237) exactly: box-shadow
       indicator + directional border-radius. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-primary);
      box-shadow: inset 3px 0 0 var(--lumiverse-primary);
      border-radius: 0 8px 8px 0;
    }
    .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
      box-shadow: inset -3px 0 0 var(--lumiverse-primary);
      border-radius: 8px 0 0 8px;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label {
      color: var(--lumiverse-primary);
    }
  `);
  injectStyles("sidebar-ux-icon-size-styles", `
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
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
}
var SECONDARY_WIDTH_VAR = "--sidebar-ux-secondary-w", SECONDARY_MOBILE_CSS = `
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

// src/sidebar/panel-header-sync.ts
function syncPanelHeaderFromMain(getWrapper) {
  if (_syncPanelHeaderPending)
    return;
  _syncPanelHeaderPending = true;
  requestAnimationFrame(() => {
    _syncPanelHeaderPending = false;
    _runSyncPanelHeaderFromMain(getWrapper);
  });
}
function _runSyncPanelHeaderFromMain(getWrapper) {
  const secondaryWrapper = getWrapper();
  if (!secondaryWrapper)
    return;
  const mainHeader = getMainPanelHeader();
  if (!mainHeader)
    return;
  if (!_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver = new ResizeObserver(() => {
      syncPanelHeaderFromMain(getWrapper);
    });
    _mainPanelHeaderResizeObserver.observe(mainHeader);
    registerCleanup(stopPanelHeaderObservers);
  }
  if (!_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver = new MutationObserver(() => {
      syncPanelHeaderFromMain(getWrapper);
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
  const cacheKey = [height, paddingTop, paddingBottom, fontSize, borderBottom, background].join("|");
  if (cacheKey === _lastWrittenHeaderVars)
    return;
  _lastWrittenHeaderVars = cacheKey;
  secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-h", height);
  secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-pt", paddingTop);
  secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-pb", paddingBottom);
  if (fontSize) {
    secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-font-size", fontSize);
  }
  secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-border-bottom", borderBottom);
  secondaryWrapper.style.setProperty("--sidebar-ux-panel-header-bg", background);
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
var _lastWrittenHeaderVars = null, _mainPanelHeaderResizeObserver = null, _mainPanelHeaderAttrObserver = null, _syncPanelHeaderPending = false;
var init_panel_header_sync = __esm(() => {
  init_cleanup();
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
  return _secondaryWrapper?.querySelector(".sidebar-ux-tab-list");
}
function getSecondaryPanel() {
  return _secondaryWrapper?.querySelector(".sidebar-ux-panel");
}
function isSecondarySidebarOpen() {
  return _secondarySidebarOpen;
}
function unmountSecondarySidebar() {
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
  const wrapper = document.createElement("div");
  wrapper.className = `sidebar-ux-secondary-wrapper sidebar-ux-side-${side}`;
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR));
  const rawWidth = options?.initialWidth && options.initialWidth > 0 ? options.initialWidth : isFinite(cssVarWidth) ? cssVarWidth : 420;
  const onMobile = isMobileViewport();
  const initWidth = onMobile ? window.innerWidth : Math.ceil(clampSidebarWidth(rawWidth));
  document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${initWidth}px`);
  const initialOpen = options?.initialOpen === true;
  const initWrapperTransform = initialOpen ? "translateX(0)" : `translateX(${getMainDrawerSide() === "right" ? -initWidth : initWidth}px)`;
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
    display: none;
    border-${side === "left" ? "left" : "right"}: none;
    border-radius: ${side === "left" ? "0 12px 12px 0" : "12px 0 0 12px"};
  `;
  const iconWrapper = document.createElement("div");
  iconWrapper.className = "sidebar-ux-drawer-tab-icon";
  iconWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
  drawerTab.appendChild(iconWrapper);
  drawerTab.addEventListener("click", () => {
    if (_secondarySidebarOpen)
      closeSecondarySidebar();
    else
      openSecondarySidebar();
  });
  const drawer = document.createElement("div");
  drawer.className = "sidebar-ux-drawer";
  drawer.style.cssText = `
    width: ${isMobileViewport() ? "100vw" : `var(${SECONDARY_WIDTH_VAR}, 420px)`};
    height: 100%;
    position: relative;
    display: flex;
    background: var(--lumiverse-bg-deep);
    box-shadow: var(--lumiverse-shadow-xl);
    pointer-events: auto;
    /* overflow intentionally not set (defaults to visible) so the resize
       handle's 4px overhang on the inner edge isn't clipped. Children
       (sidebar, panel, content) handle their own overflow containment. */
    isolation: isolate;
    flex-direction: ${side === "right" ? "row" : "row-reverse"};
  `;
  const sidebar = document.createElement("div");
  sidebar.className = "sidebar-ux-tab-list";
  sidebar.style.cssText = `
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
  title.textContent = "Second drawer";
  const closeBtn = document.createElement("button");
  closeBtn.className = "sidebar-ux-close-btn";
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: var(--lumiverse-text-dim);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  closeBtn.addEventListener("click", () => closeSecondarySidebar());
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
  drawer.appendChild(sidebar);
  drawer.appendChild(panel);
  wrapper.appendChild(drawerTab);
  wrapper.appendChild(drawer);
  try {
    const wSpindle = getHostBridge();
    const wContainers = wSpindle?.containers;
    if (wContainers?.registerContainer) {
      wContainers.registerContainer({
        id: "canvas-secondary-drawer",
        side,
        element: content
      });
    } else {
      dwarn(`[tabmove] createSecondarySidebar: registerContainer SKIPPED — ` + `window.spindle.containers.registerContainer not available. ` + `Built-in tab moves will silently fail (ContainerTabContent Pass 3 resets to main-drawer).`);
    }
  } catch (err) {
    dwarn(`[tabmove] createSecondarySidebar: registerContainer THREW:`, err);
  }
  _secondaryDrawer = drawer;
  return wrapper;
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
    for (const [tabId, side] of getTabAssignments()) {
      if (side === "secondary")
        assignToSecondary2(tabId).catch(() => {});
    }
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
  if (!options?.silent) {
    persistOpenState();
  }
  setMobileOpenClass("secondary", false);
}
function getClosedTransformPx() {
  const w = Math.ceil(parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420);
  return getMainDrawerSide() === "right" ? -w : w;
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
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true;
  }
  syncDrawerTabSettings();
  syncPanelHeaderFromMain2();
  mountResizeHandles();
}
function tearDownSecondarySidebar() {
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
      showMainTabButton(tabId);
    }
    clearTabAssignments();
    _secondaryWrapper.remove();
    _secondaryWrapper = null;
  }
  _secondarySidebarOpen = false;
  setMobileOpenClass("secondary", false);
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
  init_styles();
  init_tab_position();
  init_state();
  init_log();
  init_panel_header_sync();
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
    const attemptRestore = () => {
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
        let usedFallback = false;
        if (!tab) {
          const storedPrefix = stripSuffix(dt.tabId);
          const candidates = tabs.filter((t) => stripSuffix(t.id) === storedPrefix);
          if (candidates.length === 1) {
            tab = candidates[0];
            usedFallback = true;
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`);
            layout.detachedTabs[i] = { ...dt, tabId: tab.id };
          } else if (candidates.length > 1) {
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`);
          }
        }
        if (tab) {
          assignToSecondary(tab.id).catch((err) => {
            dwarn(`applyLayout: assignToSecondary(${tab.id}) failed:`, err);
          });
        } else {
          const mainBtn = findMainTabButton(dt.tabId);
          if (mainBtn) {
            const liveTabId = mainBtn.getAttribute("data-tab-id") || dt.tabId;
            assignToSecondary(liveTabId).catch((err) => {
              dwarn(`applyLayout: LumiScript fallback assignToSecondary(${liveTabId}) failed:`, err);
            });
            dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}"`);
          } else {
            const knownIds = tabs.map((t) => t.id);
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(", ")}. Layout may be stale.`);
          }
        }
      }
      return remaining;
    };
    const finishRestore = () => {
      if (_restoreObserver !== null) {
        _restoreObserver.disconnect();
        _restoreObserver = null;
      }
      if (_restoreTimeoutHandle !== null) {
        clearTimeout(_restoreTimeoutHandle);
        _restoreTimeoutHandle = null;
      }
      setRestoringFromLayout(false);
      const savedActive = layout.secondary?.activeTabId;
      const restored = savedActive && hasTabAssignment(savedActive) ? { tabId: savedActive } : layout.detachedTabs.find((dt) => hasTabAssignment(dt.tabId));
      if (restored) {
        showSecondaryTab(restored.tabId);
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
    if (initialRemaining === 0)
      finishRestore();
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
function snapshotLayout() {
  const assignments = Array.from(getTabAssignments().entries());
  const secondaryAssignments = assignments.filter(([_, side]) => side === "secondary");
  const result = {
    version: CANVAS_VERSION,
    primary: {
      open: _mainDrawerOpen,
      width: getMainDrawerWidth(),
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
  return new Promise((resolve) => {
    let settled = false;
    const handler = (payload) => {
      if (payload.type === "LAYOUT_DATA") {
        if (settled)
          return;
        settled = true;
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
      if (typeof unsub === "function")
        unsub();
      resolve(null);
    }, 2000);
  });
}
function applyMainDrawer(layout) {
  if (!layout || !layout.primary) {
    return;
  }
  Promise.resolve().then(() => (init_main_persist(), exports_main_persist)).then(({ restoreMainDrawerFromDom: restoreMainDrawerFromDom2 }) => {
    restoreMainDrawerFromDom2(layout.primary.open === true, typeof layout.primary.tabId === "string" ? layout.primary.tabId : null, typeof layout.primary.width === "number" ? layout.primary.width : undefined);
  });
}
var CANVAS_VERSION = "", _backendCtx = null, _saveLayoutTimer = null, _mainDrawerOpen = false, _mainDrawerTabId = null;
var init_persist = __esm(() => {
  init_store();
  init_secondary();
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
function hydrateSettings(raw) {
  if (_userHasTouchedSettings)
    return;
  _settings = mergeCanvasSettings(raw ?? null);
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
  _settings = next;
  setDebug(next.debugMode);
  applySettings(prev, next);
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
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null;
    const layoutSnapshot = _settings.layoutPersistence ? snapshotLayout() : { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 }, detachedTabs: [] };
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

// src/slash/suggest.ts
function showSuggest(textarea, options, initialActiveIndex = 0) {
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
      const label = escapeHtml(c.usage ?? "/" + c.name);
      const desc = escapeHtml(c.description ?? "");
      const owner = escapeHtml(c.owner);
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
        const label = cmd.usage ?? `/${cmd.name}`;
        applySuggestion(currentAnchor, label);
        const parsed = parseCommand(label);
        if (parsed)
          setIntent(parsed, "click");
        hideSuggest();
      });
    });
    updateActiveDom();
  };
  const setActiveIndex = (i) => {
    if (currentOptions.length === 0) {
      activeIndex = -1;
      updateActiveDom();
      return;
    }
    const clamped = Math.max(0, Math.min(currentOptions.length - 1, i));
    if (clamped === activeIndex)
      return;
    activeIndex = clamped;
    updateActiveDom();
    scrollActiveIntoView();
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
  injectStyles(STYLE_ID, `
    #${SUGGEST_ID} {
      position: fixed;
      z-index: 10005; /* above Lumiverse modals (10001-10003) and toast (now 9980) */
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
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c] ?? c);
}
function escapeAttr(s) {
  return escapeHtml(s);
}
var SUGGEST_ID = "canvas-slash-suggest", STYLE_ID = "canvas-slash-suggest-styles", _currentController = null, outsideDismissListener = null, currentAnchor = null, currentEl = null;
var init_suggest = __esm(() => {
  init_intent();
});

// src/dom/selectors.ts
var SELECTOR_TEXTAREA = 'textarea[name="chat-message"]', SELECTOR_SEND_BTN = 'button[class*="sendBtn"]';

// src/slash/intercept.ts
function installIntercept(_ctx, callbacks) {
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
      const label = activeCmd.usage ?? `/${activeCmd.name}`;
      applySuggestion(ta, label);
      hideSuggest();
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
        const label = activeCmd.usage ?? `/${activeCmd.name}`;
        applySuggestion(ta, label);
        const parsed2 = parseCommand(label);
        if (parsed2)
          setIntent(parsed2, "enter-popup");
        hideSuggest();
        ta.focus();
        return;
      }
      clearIntent();
      const parsed = parseCommand(ta.value);
      if (parsed) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        requestAnimationFrame(() => {
          ta.value = "";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        });
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
    requestAnimationFrame(() => {
      ta.value = "";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    hideSuggest();
    callbacks.onParsed(parsed, ta);
  };
  document.addEventListener("click", clickHandler, true);
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
      usage: "/select all",
      owner: "canvas",
      category: "select",
      handler: async (_args, ctx) => handleAll(ctx)
    },
    {
      name: "select-clear",
      description: "Clear the current selection",
      usage: "/select clear",
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
var SELECTOR_MESSAGE_ROW2 = '[data-component="BubbleMessage"]';
var init_select = __esm(() => {
  init_extract();
  init_selection();
});

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
  injectStyles(STYLE_ID2, `
    .canvas-slash-toast-surface {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9980;
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
var STYLE_ID2 = "canvas-slash-toast-styles", nextId = 0, listeners, toasts, _toastTimers, mounted = false, toastHostEl = null, toastEventHandler = null;
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
function attachSlashRuntime(ctx) {
  const registry = new CommandRegistry;
  registry.register(makeHelpCommand(registry));
  for (const cmd of makeSelectCommands()) {
    registry.register(cmd);
  }
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
  const detachIntercept = installIntercept(ctx, {
    onParsed: (parsed) => {
      dispatchCommand(parsed, slashCtx, registry);
    },
    onTextChange: (text) => {
      if (text.startsWith("/")) {
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
        const { activeIndex, nextSticky } = resolveActiveIndex(matches, text, lastActiveIndex);
        lastActiveIndex = nextSticky;
        showSuggest(ta, matches, activeIndex);
      } else {
        hideSuggest();
        lastActiveIndex = null;
      }
    }
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
  return () => {
    unmountToast();
    detachIntercept();
    window.removeEventListener("canvas:slash-register", registerListener);
    window.removeEventListener("canvas:slash-unregister", unregisterListener);
    unregisterByName.clear();
    registry.clear();
  };
}
var init_runtime = __esm(() => {
  init_intercept();
  init_select();
  init_suggest();
  init_dispatch();
  init_toast();
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
    init(_ctx) {
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
    mount(_ctx) {
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
      if (active)
        return active;
      active = attach(ctx);
      return active;
    },
    apply(_prev, next, ctx) {
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
  return {
    feature: slashFeature,
    alwaysCleanup() {
      if (active) {
        active();
        active = null;
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
`, debugFeature, _chatReflowTeardown = null, chatReflowFeature, secondSidebarFeature, resizeSidebarsFeature, drawerSyncFeature, consistentIconSizeFeature, shadowsDesktopFeature, shadowsMobileFeature, layoutPersistenceFeature, _slashImpl, slashFeature, tabPositionFeature, FEATURES;
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
        clearChatMargins(getChatColumn());
      }
    }
  };
  secondSidebarFeature = {
    id: "secondSidebarEnabled",
    mount(_ctx, layout) {
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
    hint: "Moves the list of tab buttons to be along the edge of the screen instead of the edge of the chat area.",
    control: moveControlsToOuter.btn
  }));
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
    resizeSidebars.refresh();
    compact.refresh();
    iconSize.refresh();
    chat.refresh();
    persist.refresh();
    slash.refresh();
    debugMode.refresh();
    shadowsDesktop.refresh();
    shadowsMobile.refresh();
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
    const sidebar = getMainSidebar();
    if (!sidebar || !sidebar.contains(tabBtn)) {
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
  mountSettingsPanel(ctx);
  for (const teardown of alwaysCleanups()) {
    registerCleanup(teardown);
  }
  loadSavedLayout().then((layout) => {
    if (layout?.version && layout.version !== CANVAS_VERSION) {
      dwarn(`Layout was saved by v${layout.version}, running v${CANVAS_VERSION}. ` + `Hard-refresh (Ctrl+F5) to load the updated extension.`);
    }
    hydrateSettings(layout?.settings);
    setDebug(getSettings().debugMode);
    setLastLoadedLayout(layout);
    refreshSettingsPanel();
    if (getSettings().debugMode)
      installDebugEscapeHatch();
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
    applyMainDrawer(layout);
    if (layout && getSettings().secondSidebarEnabled) {
      applyLayout(layout);
    }
  }).catch((err) => {
    dwarn("Canvas: loadSavedLayout failed, mounting with defaults:", err);
  });
  return cleanupAll;
}
export {
  setup
};
