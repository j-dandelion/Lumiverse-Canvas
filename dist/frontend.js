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

// src/debug/boot-diag.ts
function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
function push(entry) {
  timeline.push(entry);
  if (timeline.length > MAX_ENTRIES)
    timeline.splice(0, timeline.length - MAX_ENTRIES);
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(timeline.slice(-MAX_ENTRIES)));
  } catch {}
}
function bootStep(tag, msg) {
  const entry = { t: performance.now() - startedAt, tag, msg, kind: "step" };
  push(entry);
  console.info(`[Canvas-boot] +${entry.t.toFixed(0)}ms ${tag}${msg ? ` — ${msg}` : ""}`);
}
function bootError(tag, err) {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  push({ t: performance.now() - startedAt, tag, msg: detail, kind: "error" });
  console.error(`[Canvas-boot] FAIL ${tag}`, err);
}
function bootWarn(tag, msg) {
  push({ t: performance.now() - startedAt, tag, msg, kind: "warn" });
  console.warn(`[Canvas-boot] WARN ${tag}${msg ? ` — ${msg}` : ""}`);
}
function armBootWatchdog(onStall) {
  const timer = setTimeout(() => {
    onStall();
    push({ t: performance.now() - startedAt, tag: "watchdog", msg: "boot did not reach a terminal step in time", kind: "stall" });
    console.error(`[Canvas-boot] STALL — setup did not finish within ${WATCHDOG_MS}ms. Timeline:
` + dump());
  }, WATCHDOG_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  let cancelled = false;
  return () => {
    if (cancelled)
      return;
    cancelled = true;
    clearTimeout(timer);
  };
}
function dump() {
  return JSON.stringify({
    at: new Date().toISOString(),
    ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
    entries: timeline
  }, null, 2);
}
function installBootDiag() {
  try {
    console.info("[Canvas-boot] diagnostics armed", { at: new Date().toISOString() });
    window.addEventListener("error", (event) => {
      push({
        t: performance.now() - startedAt,
        tag: "window.error",
        msg: event.message + (event.filename ? ` @ ${event.filename}:${event.lineno}` : ""),
        kind: "error"
      });
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
      push({ t: performance.now() - startedAt, tag: "unhandledrejection", msg: detail, kind: "error" });
    });
    window.__canvasDiag = {
      dump,
      timeline,
      storageKey: KEY
    };
  } catch {}
}
var KEY = "canvas.bootDiag.v1", MAX_ENTRIES = 60, WATCHDOG_MS = 20000, timeline, startedAt;
var init_boot_diag = __esm(() => {
  timeline = [];
  startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
});

// src/types.ts
function normalizeCanvasSettingsFields(s) {
  let out = s;
  if (out.taskbarMode && !out.moveControlsToOuterEdge) {
    out = {
      ...out,
      taskbarMode: false,
      hideDrawerOpenCloseButtons: false,
      dragAndDropDrawerTabs: false
    };
  }
  if (out.hideDrawerOpenCloseButtons && !out.taskbarMode) {
    out = { ...out, hideDrawerOpenCloseButtons: false };
  }
  if (out.dragAndDropDrawerTabs && !out.taskbarMode) {
    out = { ...out, dragAndDropDrawerTabs: false };
  }
  return out;
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
    if (saved.taskbarMode === undefined && typeof raw.keepTabListVisible === "boolean") {
      out.taskbarMode = raw.keepTabListVisible;
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
    taskbarMode: false,
    hideDrawerOpenCloseButtons: false,
    dragAndDropDrawerTabs: true,
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

// src/persist/backend-ctx.ts
var exports_backend_ctx = {};
__export(exports_backend_ctx, {
  setBackendCtx: () => setBackendCtx,
  getBackendCtx: () => getBackendCtx,
  CANVAS_VERSION: () => CANVAS_VERSION
});
function getBackendCtx() {
  return _backendCtx;
}
function setBackendCtx(ctx) {
  _backendCtx = ctx;
}
var _backendCtx = null, CANVAS_VERSION = "1.9.0";

// src/debug/log.ts
function setDebug(value) {
  DEBUG = value;
  Promise.resolve().then(() => exports_backend_ctx).then(({ getBackendCtx: getBackendCtx2 }) => {
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

// src/debug/persist-debug.ts
var exports_persist_debug = {};
__export(exports_persist_debug, {
  syncPersistDebugToBackend: () => syncPersistDebugToBackend,
  summarizeLayout: () => summarizeLayout,
  refreshPersistDebugFlag: () => refreshPersistDebugFlag,
  plog: () => plog,
  logPersistSave: () => logPersistSave,
  logPersistLoad: () => logPersistLoad,
  isPersistDebugEnabled: () => isPersistDebugEnabled
});
function isPersistDebugEnabled() {
  if (_enabled !== null)
    return _enabled;
  try {
    _enabled = localStorage.getItem(LS_KEY) === "1" || localStorage.getItem("sidebarUxDebug") === "1";
  } catch {
    _enabled = false;
  }
  return _enabled;
}
function refreshPersistDebugFlag() {
  _enabled = null;
  _backendSynced = false;
}
function nextSeq() {
  _seq += 1;
  return _seq;
}
function plog(...args) {
  if (!isPersistDebugEnabled())
    return;
  console.log("[Canvas][persist]", ...args);
}
function syncPersistDebugToBackend(send) {
  if (!isPersistDebugEnabled() || _backendSynced || !send)
    return;
  _backendSynced = true;
  try {
    send({ type: "SET_PERSIST_DEBUG", enabled: true });
  } catch {
    _backendSynced = false;
  }
}
function summarizeLayout(layout) {
  if (layout == null)
    return "layout=null";
  if (typeof layout !== "object")
    return `layout=type:${typeof layout}`;
  const L = layout;
  const primary = L.primary && typeof L.primary === "object" ? L.primary : null;
  const secondary = L.secondary && typeof L.secondary === "object" ? L.secondary : null;
  const tabs = Array.isArray(L.detachedTabs) ? L.detachedTabs.length : -1;
  const hidden = Array.isArray(L.hiddenTabIds) ? L.hiddenTabIds.length : -1;
  const settings = L.settings;
  const hasSettings = settings != null && typeof settings === "object";
  let settingsKeys = 0;
  let nonDefault = 0;
  if (hasSettings) {
    const s = settings;
    const keys = Object.keys(DEFAULT_CANVAS_SETTINGS);
    for (const k of keys) {
      if (s[k] === undefined)
        continue;
      settingsKeys++;
      if (s[k] !== DEFAULT_CANVAS_SETTINGS[k])
        nonDefault++;
    }
  }
  return [
    `v=${L.version ?? "?"}`,
    `pOpen=${primary?.open ?? "?"}`,
    `sOpen=${secondary?.open ?? "?"}`,
    `tabs=${tabs}`,
    `hidden=${hidden}`,
    hasSettings ? `settings{keys=${settingsKeys} nonDef=${nonDefault}}` : "settings=none"
  ].join(" ");
}
function logPersistLoad(phase, detail = {}) {
  if (!isPersistDebugEnabled())
    return;
  const n = nextSeq();
  const parts = [
    `#${n}`,
    "LOAD",
    phase,
    detail.reason ? `reason=${detail.reason}` : null,
    detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : null,
    detail.generation !== undefined ? `gen=${detail.generation}` : null,
    detail.userTouched !== undefined ? `userTouched=${detail.userTouched}` : null,
    detail.layout !== undefined ? summarizeLayout(detail.layout) : null
  ].filter(Boolean);
  plog(parts.join(" "));
}
function logPersistSave(reason, layout, detail = {}) {
  if (!isPersistDebugEnabled())
    return;
  const n = nextSeq();
  if (detail.skipped) {
    plog(`#${n} SAVE-SKIP reason=${reason} skip=${detail.skipped}`, detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : "", detail.restoreActive !== undefined ? `restore=${detail.restoreActive}` : "");
    return;
  }
  const settings = layout && typeof layout === "object" ? layout.settings : undefined;
  plog(`#${n} SAVE reason=${reason}`, detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : "", detail.restoreActive !== undefined ? `restore=${detail.restoreActive}` : "", summarizeLayout(layout));
}
var LS_KEY = "canvasPersistDebug", _enabled = null, _seq = 0, _backendSynced = false;
var init_persist_debug = __esm(() => {
  init_types();
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

// src/dom/host-bridge.ts
var exports_host_bridge = {};
__export(exports_host_bridge, {
  setHostBridgeContext: () => setHostBridgeContext,
  getHostBridgeContext: () => getHostBridgeContext,
  getHostBridge: () => getHostBridge,
  ensureUiPanelsPermission: () => ensureUiPanelsPermission
});
function setHostBridgeContext(ctx) {
  _setupCtx = ctx;
}
function getHostBridgeContext() {
  return _setupCtx;
}
function resolveCtx() {
  if (_setupCtx)
    return _setupCtx;
  if (typeof window === "undefined")
    return null;
  const global = window.spindle;
  return global ?? null;
}
function getHostBridge() {
  const ctx = resolveCtx();
  if (!ctx)
    return null;
  return {
    ui: ctx.ui,
    containers: ctx.containers,
    ctx
  };
}
async function ensureUiPanelsPermission() {
  const ctx = resolveCtx();
  if (!ctx?.permissions)
    return false;
  try {
    const granted = await ctx.permissions.getGranted();
    if (granted.includes("ui_panels"))
      return true;
    const perms = ctx.permissions;
    if (typeof perms.request !== "function")
      return false;
    const next = await perms.request(["ui_panels"], {
      reason: "Canvas needs panel access to move built-in tabs (Personas, Lorebook, etc.) into the second drawer."
    });
    return next.includes("ui_panels");
  } catch {
    return false;
  }
}
var _setupCtx = null;

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
  const tabs = getHostStoreTabs();
  if (tabs.length === 0) {
    const fallback = getDrawerTabs();
    if (fallback.length > 0)
      return tagFromTabs(sidebar, fallback);
    return 0;
  }
  return tagFromTabs(sidebar, tabs);
}
function tagFromTabs(sidebar, tabs) {
  let tagged = 0;
  const taggedDetail = [];
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
      taggedDetail.push({ title: btnTitle, id: tab.id, btnId: existing || "(none)" });
    }
  }
  if (tagged > 0)
    dlog(`tagMainSidebarButtons: tagged ${tagged} button(s)`, { tagged: taggedDetail });
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
       (ViewportDrawer.module.css:241-252). The base selector covers every
       button carrying data-tab-id (secondary + mirror after the host tagger
       runs); the two mirror selectors cover mirror buttons WITHOUT
       data-tab-id — extension tabs are not tagged by host React, so a mirror
       button whose host never received Canvas's data-tab-id tag would
       otherwise drop out of this rule and render its label at the inherited
       (larger) font size. Same selector pattern as the label-color rule
       below. */
    .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
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
  wrapper.className = `${wrapperClass} sidebar-ux-shell sidebar-ux-side-${side}`;
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
    /* Static taskbar-mode chrome for Welcome only — no transition.
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
  if (!isTaskbarModeEnabled()) {
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
  return outerEdgeEnabled || !!getSettings().taskbarMode;
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
    Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
    return;
  }
  const want = !!getSettings().taskbarMode && hasSecondaryAssignedTabs();
  applyTabListPin(want, { force: true });
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
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
        _cacheTimestamp = Date.now();
        return;
      }
    }
    hook = hook.next;
    hookIdx++;
  }
  scanForHostSettings(fiber.child, depth + 1, maxDepth, visited);
  scanForHostSettings(fiber.sibling, depth, maxDepth, visited);
}
function walkElementForHostSettings(el, visited) {
  if (!el)
    return;
  const rootFiber = getFiberFromElement(el);
  if (!rootFiber)
    return;
  let fiber = rootFiber;
  const ancestors = [];
  while (fiber) {
    ancestors.push(fiber);
    fiber = fiber.return;
  }
  for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 8); i--) {
    scanForHostSettings(ancestors[i], 0, 40, visited);
    if (_cachedSetSetting && _cachedDrawerSettings)
      return;
  }
}
function findHostSettings(force = false) {
  const now = Date.now();
  if (!force && _cachedSetSetting && _cachedDrawerSettings && now - _cacheTimestamp < CACHE_TTL_MS) {
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
  const visited = new Set;
  walkElementForHostSettings(getMainSidebar(), visited);
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    walkElementForHostSettings(getMainPanel(), visited);
  }
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    walkElementForHostSettings(getMainWrapper(), visited);
  }
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    const getById = typeof document.getElementById === "function" ? (id) => document.getElementById(id) : () => null;
    const appRoot = getById("root") || getById("app") || document.body || null;
    walkElementForHostSettings(appRoot, visited);
  }
  if (_cachedSetSetting || _cachedDrawerSettings) {
    _cacheTimestamp = Date.now();
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
    const merged2 = { ...current2, ...partial };
    _testSetSetting("drawerSettings", merged2);
    _cachedDrawerSettings = merged2;
    _cacheTimestamp = Date.now();
    findStoreData(true);
    return true;
  }
  if (!_cachedSetSetting) {
    findStoreData(true);
    const snap = getStoreSnapshot();
    if (snap && typeof snap.setSetting === "function") {
      _cachedSetSetting = snap.setSetting.bind(snap);
      if (snap.drawerSettings && typeof snap.drawerSettings === "object") {
        _cachedDrawerSettings = snap.drawerSettings;
      }
      _cacheTimestamp = Date.now();
      dlog("patchHostDrawerSettings: setSetting recovered from store snapshot");
    }
  }
  const current = _cachedDrawerSettings ?? {};
  const merged = { ...current, ...partial };
  _cachedDrawerSettings = merged;
  _cacheTimestamp = Date.now();
  if (!_cachedSetSetting) {
    if ("side" in partial) {
      delete merged.side;
      _cachedDrawerSettings = merged;
    }
    dlog("patchHostDrawerSettings: setSetting not available (NO-GO)");
    return false;
  }
  _cachedSetSetting("drawerSettings", merged);
  findStoreData(true);
  return true;
}
async function writeHostDrawerSettingsViaApi(patch) {
  try {
    const doFetch = _settingsApiFetch ?? ((url, init) => fetch(url, init));
    let current = {};
    try {
      const res2 = await doFetch("/api/v1/settings/drawerSettings", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (res2.ok) {
        const row = await res2.json();
        if (row && typeof row.value === "object" && row.value !== null) {
          current = row.value;
        }
      }
    } catch {}
    const merged = { ...current, ...patch };
    const res = await doFetch("/api/v1/settings/drawerSettings", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: merged })
    });
    if (res.ok) {
      dlog("writeHostDrawerSettingsViaApi: ok", { patch });
      return true;
    }
    dlog("writeHostDrawerSettingsViaApi: rejected", { status: res.status });
    return false;
  } catch (err) {
    dlog("writeHostDrawerSettingsViaApi: failed", String(err));
    return false;
  }
}
var _cachedDrawerSettings = null, _cachedSetSetting = null, _cacheTimestamp = 0, CACHE_TTL_MS = 3000, _testSetSetting = null, _settingsApiFetch = null;
var init_host_settings = __esm(() => {
  init_fiber();
  init_log();
  init_store();
});

// src/core/select.ts
function listForSide(model, side) {
  return side === "primary" ? model.primary : model.secondary;
}
function visibleKeys(model, side) {
  const list = listForSide(model, side);
  return list.filter((k) => !model.hidden.includes(k));
}
function isHidden(model, key) {
  return model.hidden.includes(key);
}
function visibleToAbsoluteIndex(model, side, visibleIndex) {
  const list = listForSide(model, side);
  if (visibleIndex < 0)
    return list.length;
  let vi = 0;
  for (let i = 0;i < list.length; i++) {
    if (!isHidden(model, list[i])) {
      if (vi === visibleIndex)
        return i;
      vi++;
    }
  }
  return list.length;
}
function activeAfterRemoval(model, side, removed) {
  const list = listForSide(model, side);
  const idx = list.indexOf(removed);
  if (idx === -1)
    return null;
  for (let i = idx - 1;i >= 0; i--) {
    const key = list[i];
    if (!isHidden(model, key))
      return key;
  }
  for (let i = idx + 1;i < list.length; i++) {
    const key = list[i];
    if (!isHidden(model, key))
      return key;
  }
  return null;
}
function keyExists(model, key) {
  return model.primary.includes(key) || model.secondary.includes(key);
}
function sideOfKey(model, key) {
  if (model.primary.includes(key))
    return "primary";
  if (model.secondary.includes(key))
    return "secondary";
  return null;
}

// src/core/reduce.ts
function removeFrom(list, key) {
  return list.filter((k) => k !== key);
}
function insertAt(list, key, index) {
  const next = list.slice();
  next.splice(index, 0, key);
  return next;
}
function toggleHidden(hidden, key, hide) {
  const has = hidden.includes(key);
  if (hide && !has)
    return [...hidden, key];
  if (!hide && has)
    return hidden.filter((k) => k !== key);
  return hidden;
}
function applyMove(model, key, to, index, activateDest) {
  const from = sideOfKey(model, key);
  if (!from)
    return model;
  const srcList = listForSide(model, from);
  const idx = srcList.indexOf(key);
  if (idx === -1)
    return model;
  const wasActiveInSource = model.active[from] === key;
  const wasActiveInDest = model.active[to] === key;
  let sourceReplacement = null;
  if (wasActiveInSource && from !== to) {
    sourceReplacement = activeAfterRemoval(model, from, key);
  }
  let next = model;
  if (from === to) {
    const without = removeFrom(srcList, key);
    const absIdx = visibleToAbsoluteIndex({ ...model, [from]: without }, from, index);
    const newList = insertAt(without, key, absIdx);
    next = { ...model, [from]: newList };
  } else {
    const newSrc = removeFrom(srcList, key);
    const destList = listForSide(model, to);
    const absIdx = visibleToAbsoluteIndex({ ...model, [from]: newSrc }, to, index);
    const newDest = insertAt(destList, key, absIdx);
    next = {
      ...model,
      [from]: newSrc,
      [to]: newDest
    };
  }
  if (wasActiveInSource && from !== to) {
    next = { ...next, active: { ...next.active, [from]: sourceReplacement } };
    if (!activateDest && wasActiveInDest) {
      next = { ...next, active: { ...next.active, [to]: key } };
    }
  }
  if (activateDest && !isHidden(next, key)) {
    next = { ...next, active: { ...next.active, [to]: key } };
  }
  return next;
}
function applyReorder(model, key, side, index) {
  const list = listForSide(model, side);
  const idx = list.indexOf(key);
  if (idx === -1)
    return model;
  const without = removeFrom(list, key);
  const absIdx = visibleToAbsoluteIndex({ ...model, [side]: without }, side, index);
  const newList = insertAt(without, key, absIdx);
  return { ...model, [side]: newList };
}
function applySetHidden(model, key, hide) {
  if (!keyExists(model, key))
    return model;
  let next = { ...model, hidden: toggleHidden(model.hidden, key, hide) };
  if (hide) {
    if (model.active.primary === key) {
      const replacement = activeAfterRemoval(next, "primary", key);
      next = { ...next, active: { ...next.active, primary: replacement } };
    }
    if (model.active.secondary === key) {
      const replacement = activeAfterRemoval(next, "secondary", key);
      next = { ...next, active: { ...next.active, secondary: replacement } };
    }
  }
  return next;
}
function applyActivate(model, key, side) {
  const list = listForSide(model, side);
  if (!list.includes(key))
    return model;
  if (isHidden(model, key))
    return model;
  if (model.active[side] === key)
    return model;
  return { ...model, active: { ...model.active, [side]: key } };
}
function applySyncActive(model, primary, secondary) {
  let next = model;
  if (primary !== null && next.active.primary !== primary) {
    const list = listForSide(next, "primary");
    if (list.includes(primary) && !isHidden(next, primary)) {
      next = { ...next, active: { ...next.active, primary } };
    }
  }
  if (secondary !== null && next.active.secondary !== secondary) {
    const list = listForSide(next, "secondary");
    if (list.includes(secondary) && !isHidden(next, secondary)) {
      next = { ...next, active: { ...next.active, secondary } };
    }
  }
  return next;
}
function applySetDrawer(model, side, open, width) {
  const current = model.drawers[side];
  const newOpen = open !== undefined ? open : current.open;
  const newWidth = width !== undefined ? width : current.width;
  if (newOpen === current.open && newWidth === current.width)
    return model;
  return {
    ...model,
    drawers: {
      ...model.drawers,
      [side]: { open: newOpen, width: newWidth }
    }
  };
}
function applySwapSides(model) {
  const newSide = model.side === "left" ? "right" : "left";
  return { ...model, side: newSide };
}
function applySyncFromHost(model, observed) {
  const observedKeys = new Set(observed.tabs.map((t) => t.key));
  const observedMap = new Map(observed.tabs.map((t) => [t.key, t]));
  let next = model;
  const removeFromSide = (side, keys) => {
    const list = listForSide(next, side);
    return list.filter((k) => keys.has(k));
  };
  const newPrimary = [];
  const newSecondary = [];
  const seen = new Set;
  for (const tab of observed.tabs) {
    if (seen.has(tab.key)) {
      if (tab.location === "primary") {
        const idx = newPrimary.indexOf(tab.key);
        if (idx >= 0)
          newPrimary.splice(idx, 1);
        if (newSecondary.includes(tab.key)) {
          const sidx = newSecondary.indexOf(tab.key);
          if (sidx >= 0)
            newSecondary.splice(sidx, 1);
        }
      } else {
        const idx = newSecondary.indexOf(tab.key);
        if (idx >= 0)
          newSecondary.splice(idx, 1);
        if (newPrimary.includes(tab.key)) {
          const pidx = newPrimary.indexOf(tab.key);
          if (pidx >= 0)
            newPrimary.splice(pidx, 1);
        }
      }
    }
    seen.add(tab.key);
    if (tab.location === "primary")
      newPrimary.push(tab.key);
    else
      newSecondary.push(tab.key);
  }
  next = { ...next, primary: newPrimary, secondary: newSecondary };
  next = {
    ...next,
    hidden: next.hidden.filter((k) => observedKeys.has(k))
  };
  const adoptActive = (side) => {
    for (const tab of observed.tabs) {
      const isActive = side === "primary" ? tab.isActiveInPrimary : tab.isActiveInSecondary;
      if (isActive && tab.location === side && !isHidden(next, tab.key)) {
        return tab.key;
      }
    }
    const current = next.active[side];
    const currentTab = current === null ? undefined : observedMap.get(current);
    if (current !== null && currentTab?.location === side && !isHidden(next, current)) {
      return current;
    }
    return null;
  };
  next = {
    ...next,
    active: {
      primary: adoptActive("primary"),
      secondary: adoptActive("secondary")
    }
  };
  next = {
    ...next,
    side: observed.drawerSide,
    drawers: {
      ...next.drawers,
      primary: { open: observed.primaryOpen, width: observed.primaryWidth },
      secondary: { open: observed.secondaryOpen, width: observed.secondaryWidth }
    }
  };
  const sameContent = sameKeys(next.primary, model.primary) && sameKeys(next.secondary, model.secondary) && sameKeys(next.hidden, model.hidden) && next.active.primary === model.active.primary && next.active.secondary === model.active.secondary && next.side === model.side && next.drawers.primary.open === model.drawers.primary.open && next.drawers.primary.width === model.drawers.primary.width && next.drawers.secondary.open === model.drawers.secondary.open && next.drawers.secondary.width === model.drawers.secondary.width;
  if (sameContent)
    return model;
  return next;
}
function sameKeys(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function reduce(model, intent) {
  switch (intent.t) {
    case "move":
      return applyMove(model, intent.key, intent.to, intent.index, intent.activateDest);
    case "reorder":
      return applyReorder(model, intent.key, intent.side, intent.index);
    case "setHidden":
      return applySetHidden(model, intent.key, intent.hidden);
    case "activate":
      return applyActivate(model, intent.key, intent.side);
    case "syncActive":
      return applySyncActive(model, intent.primary, intent.secondary);
    case "setDrawer":
      return applySetDrawer(model, intent.side, intent.open, intent.width);
    case "swapSides":
      return applySwapSides(model);
    case "syncFromHost":
      return applySyncFromHost(model, intent.observed);
    default: {
      const _exhaustive = intent;
      return model;
    }
  }
}
function foldIntents(model, intents) {
  let next = model;
  for (const intent of intents) {
    next = reduce(next, intent);
  }
  return next;
}
var init_reduce = () => {};

// src/recon/reconcile.ts
function modelMatchesWorld(model, resolved, world) {
  for (const side of ["primary", "secondary"]) {
    if (diffSetOrder(model, side, resolved, world) !== null)
      return false;
    if (diffHidden(model, side, resolved, world) !== null)
      return false;
    if (diffActive(model, side, resolved, world) !== null)
      return false;
    if (diffDrawer(model, side, world) !== null)
      return false;
  }
  if (diffSide(model, world) !== null)
    return false;
  return true;
}
function mkStep(step, status, ops, reason) {
  const r = { step, status, ops };
  if (reason)
    r.reason = reason;
  return r;
}
function mergeSideOrder(model, side, resolved) {
  const list = listForSide(model, side);
  const out = [];
  for (const key of list) {
    const id = resolved.get(key);
    if (id)
      out.push(id);
  }
  return out;
}
function observeSideOrder(world, side) {
  return world.tabs.filter((t) => t.location === side).map((t) => t.liveId);
}
function diffSetOrder(model, side, resolved, world) {
  const want = mergeSideOrder(model, side, resolved);
  const have = observeSideOrder(world, side);
  if (want.length !== have.length)
    return want;
  for (let i = 0;i < want.length; i++) {
    if (want[i] !== have[i])
      return want;
  }
  return null;
}
function diffHidden(model, side, resolved, world) {
  const modelHiddenIds = [];
  const list = listForSide(model, side);
  for (const key of list) {
    const id = resolved.get(key);
    if (!id)
      continue;
    if (model.hidden.includes(key)) {
      modelHiddenIds.push(id);
    }
  }
  const tabMap = new Map(world.tabs.map((t) => [t.key, t]));
  const liveHidden = new Map;
  for (const [key, id] of resolved) {
    const obs = tabMap.get(key);
    if (obs && obs.location === side) {
      liveHidden.set(id, obs.isHidden);
    }
  }
  const diff = [];
  for (const [key, id] of resolved) {
    const obs = tabMap.get(key);
    if (!obs || obs.location !== side)
      continue;
    const wantHidden = model.hidden.includes(key);
    const isObsHidden = obs.isHidden;
    if (wantHidden && !isObsHidden)
      diff.push(id);
  }
  for (const [key, id] of resolved) {
    const obs = tabMap.get(key);
    if (!obs || obs.location !== side)
      continue;
    const wantHidden = model.hidden.includes(key);
    const isObsHidden = obs.isHidden;
    if (!wantHidden && isObsHidden)
      diff.push(id);
  }
  return diff.length > 0 ? modelHiddenIds : null;
}
function diffActive(model, side, resolved, world) {
  const modelActive = model.active[side];
  if (!modelActive)
    return null;
  const id = resolved.get(modelActive);
  if (!id)
    return null;
  const tabMap = new Map(world.tabs.map((t) => [t.key, t]));
  const obs = tabMap.get(modelActive);
  const isActive = side === "primary" ? obs?.isActiveInPrimary ?? false : obs?.isActiveInSecondary ?? false;
  return isActive ? null : id;
}
function diffDrawer(model, side, world) {
  const m = model.drawers[side];
  const wOpen = side === "primary" ? world.primaryOpen : world.secondaryOpen;
  const wWidth = side === "primary" ? world.primaryWidth : world.secondaryWidth;
  if (m.open !== wOpen || m.width !== wWidth) {
    return { open: m.open, width: m.width };
  }
  return null;
}
function diffSide(model, world) {
  return model.side !== world.drawerSide ? model.side : null;
}
async function reconcile(model, host) {
  const world = host.observe();
  const steps = [];
  let totalOps = 0;
  const observedTabMap = new Map(world.tabs.map((t) => [t.key, t]));
  const allKeys = new Set;
  for (const k of model.primary)
    allKeys.add(k);
  for (const k of model.secondary)
    allKeys.add(k);
  const resolved = new Map;
  const unresolved = [];
  let identityOps = 0;
  for (const key of allKeys) {
    const id = host.resolve(key);
    if (id) {
      resolved.set(key, id);
      identityOps++;
    } else {
      unresolved.push(key);
    }
  }
  steps.push(mkStep("identity", unresolved.length === 0 ? "ok" : "degraded", identityOps, unresolved.length ? `${unresolved.length} tab(s) not present in host` : undefined));
  {
    const status = world.inventory?.status;
    const inventoryStatus = status === "partial" || status === "empty" ? "degraded" : "ok";
    steps.push(mkStep("inventory", inventoryStatus, 0, status === undefined ? "inventory not reported by host" : status === "partial" ? "inventory partial" : status === "empty" ? "inventory empty" : status));
  }
  steps.push(mkStep("shell", "ok", 0));
  const epochId = ++_epochId;
  _activeEpoch = true;
  const unsub = host.onWorldChanged(() => {
    if (!_activeEpoch || _epochId !== epochId) {
      _queuedPostEpoch = true;
      return;
    }
    const w = host.observe();
    if (modelMatchesWorld(model, resolved, w)) {
      _echoDropped++;
    } else {
      _nonEchoDetected++;
      _queuedPostEpoch = true;
    }
  });
  let placeOps = 0;
  let placeIssues = 0;
  let orderOps = 0;
  let orderIssues = 0;
  let actOps = 0;
  let actIssues = 0;
  let drawerOps = 0;
  let visOps = 0;
  let visDegraded = 0;
  let totalOpsLocal = 0;
  let scheduled;
  let modelSideCorrection = null;
  try {
    for (const [key, id] of resolved) {
      const modelSide = sideOfKey(model, key);
      if (!modelSide)
        continue;
      const obs = observedTabMap.get(key);
      if (!obs)
        continue;
      if (obs.location !== modelSide) {
        placeOps++;
        const result = await host.placeTab(id, modelSide);
        if (!result.placed)
          placeIssues++;
      }
    }
    steps.push(mkStep("placement", placeIssues > 0 ? "degraded" : "ok", placeOps, placeIssues ? `${placeIssues} placement(s) failed` : undefined));
    totalOps += placeOps;
    for (const side of ["primary", "secondary"]) {
      const hids = diffHidden(model, side, resolved, world);
      if (hids !== null) {
        visOps++;
        const result = await host.setHidden(side, hids);
        if (result !== "ok")
          visDegraded++;
      }
    }
    steps.push(mkStep("visibility", visDegraded > 0 ? "degraded" : "ok", visOps, visDegraded ? `${visDegraded} visibility write(s) degraded` : undefined));
    totalOps += visOps;
    for (const side of ["primary", "secondary"]) {
      const want = diffSetOrder(model, side, resolved, world);
      if (want !== null) {
        dlog("[reconcile] setOrder", {
          side,
          want,
          observed: observeSideOrder(world, side),
          model: mergeSideOrder(model, side, resolved)
        });
        orderOps++;
        const result = await host.setOrder(side, want);
        if (result !== "ok")
          orderIssues++;
      }
    }
    steps.push(mkStep("order", orderIssues > 0 ? "degraded" : "ok", orderOps, orderIssues ? `${orderIssues} order write(s) degraded` : undefined));
    totalOps += orderOps;
    for (const side of ["primary", "secondary"]) {
      const id = diffActive(model, side, resolved, world);
      if (id !== null) {
        actOps++;
        const result = await host.activate(side, id);
        if (result !== "ok")
          actIssues++;
      }
    }
    steps.push(mkStep("activation", actIssues > 0 ? "degraded" : "ok", actOps, actIssues ? `${actIssues} activation(s) degraded` : undefined));
    totalOps += actOps;
    for (const side of ["primary", "secondary"]) {
      const ds = diffDrawer(model, side, world);
      if (ds) {
        drawerOps++;
        await host.setDrawer(side, ds);
      }
    }
    const newSide = diffSide(model, world);
    if (newSide) {
      drawerOps++;
      const result = await host.setSide(newSide);
      if (result !== "ok") {
        modelSideCorrection = world.drawerSide;
      }
    }
    steps.push(mkStep("drawers", "ok", drawerOps));
    totalOps += drawerOps;
    scheduled = _queuedPostEpoch;
  } finally {
    _activeEpoch = false;
    unsub();
  }
  _queuedPostEpoch = false;
  const echoInfo = {
    echoDropped: _echoDropped,
    nonEcho: _nonEchoDetected,
    postEpochScheduled: scheduled
  };
  _echoDropped = 0;
  _nonEchoDetected = 0;
  const report = {
    ops: totalOps,
    steps,
    unresolved,
    echo: echoInfo
  };
  if (modelSideCorrection !== null) {
    report.modelSideCorrection = modelSideCorrection;
  }
  return report;
}
var _epochId = 0, _activeEpoch = false, _echoDropped = 0, _nonEchoDetected = 0, _queuedPostEpoch = false;
var init_reconcile = __esm(() => {
  init_log();
});

// src/core/model.ts
function builtinKey(id) {
  return `${BUILTIN_PREFIX}${id}`;
}
function extensionKey(extensionId, tabName) {
  return `${EXT_PREFIX}${extensionId}/${tabName}`;
}
function isBuiltinKey(key) {
  return key.startsWith(BUILTIN_PREFIX);
}
function isExtensionKey(key) {
  return key.startsWith(EXT_PREFIX);
}
function parseBuiltinKey(key) {
  if (!isBuiltinKey(key))
    return null;
  return key.slice(BUILTIN_PREFIX.length);
}
function parseExtensionKey(key) {
  if (!isExtensionKey(key))
    return null;
  const rest = key.slice(EXT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1)
    return null;
  return { extensionId: rest.slice(0, slash), tabName: rest.slice(slash + 1) };
}
function createEmptyModel(side = "left") {
  return {
    version: 2,
    primary: [],
    secondary: [],
    hidden: [],
    active: { primary: null, secondary: null },
    drawers: {
      primary: { open: false, width: 420 },
      secondary: { open: false, width: 420 }
    },
    side
  };
}
var BUILTIN_PREFIX = "builtin:", EXT_PREFIX = "ext:";

// src/persist/tab-id-heal.ts
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
  const groups = new Map;
  for (const stored of storedIds.filter((id) => !result.has(id))) {
    const key = stripTabIdSuffix(stored);
    const group = groups.get(key) ?? { stored: [], live: [] };
    group.stored.push(stored);
    groups.set(key, group);
  }
  for (const live of available)
    groups.get(stripTabIdSuffix(live))?.live.push(live);
  for (const group of groups.values()) {
    group.stored.sort();
    group.live.sort();
    const count = Math.min(group.stored.length, group.live.length);
    for (let i = 0;i < count; i++) {
      result.set(group.stored[i], group.live[i]);
      available.delete(group.live[i]);
    }
    for (let i = count;i < group.stored.length; i++)
      result.set(group.stored[i], null);
  }
  for (const stored of storedIds)
    if (!result.has(stored))
      result.set(stored, null);
  return result;
}
function isTabIdHidden(tabId, hiddenIds, liveIds) {
  const stored = [...hiddenIds];
  if (stored.includes(tabId))
    return true;
  if (!liveIds?.length)
    return false;
  return [...pairStoredToLiveIds(stored, [...liveIds]).values()].includes(tabId);
}
function healHiddenTabIds(storedHidden, liveIds, opts) {
  const pairing = pairStoredToLiveIds([...storedHidden], [...liveIds]);
  const out = [];
  const seen = new Set;
  for (const stored of storedHidden) {
    const live = pairing.get(stored);
    const id = live ?? (opts?.keepUnmatched ? stored : null);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// src/persist/layout-model.ts
function buildModelFromLayout(layout, findKey, side) {
  const model = createEmptyModel(side ?? "left");
  if (!layout)
    return model;
  const tabOrder = layout.tabOrder ?? [];
  const detached = layout.detachedTabs ?? [];
  const secondaryIds = new Set(detached.map((d) => d.tabId));
  const isSecondaryStoredId = (id) => {
    if (secondaryIds.has(id))
      return true;
    const base = stripTabIdSuffix(id);
    for (const secondaryId of secondaryIds) {
      if (stripTabIdSuffix(secondaryId) === base)
        return true;
    }
    return false;
  };
  const primary = [];
  const secondary = [];
  const unresolvedIds = [];
  const appendOnce = (list, key) => {
    if (!primary.includes(key) && !secondary.includes(key))
      list.push(key);
  };
  for (const storedId of tabOrder) {
    const key = resolveStoredId(storedId, findKey);
    if (!key) {
      unresolvedIds.push(storedId);
      continue;
    }
    appendOnce(isSecondaryStoredId(storedId) ? secondary : primary, key);
  }
  for (const d of detached) {
    const fromTitle = d.tabTitle ? resolveStoredId(d.tabTitle, findKey) : null;
    const key = fromTitle ?? resolveStoredId(d.tabId, findKey);
    if (key && !primary.includes(key) && !secondary.includes(key)) {
      appendOnce(secondary, key);
    }
  }
  const hidden = [];
  for (const storedId of layout.hiddenTabIds ?? []) {
    const key = resolveStoredId(storedId, findKey);
    if (key && (primary.includes(key) || secondary.includes(key)) && !hidden.includes(key)) {
      hidden.push(key);
    }
  }
  const activePrimaryCandidate = layout.primary?.tabId ? resolveStoredId(layout.primary.tabId, findKey) : null;
  const activeSecondaryCandidate = layout.secondary?.activeTabId ? resolveStoredId(layout.secondary.activeTabId, findKey) : null;
  const activePrimary = activePrimaryCandidate && primary.includes(activePrimaryCandidate) && !hidden.includes(activePrimaryCandidate) ? activePrimaryCandidate : null;
  const activeSecondary = activeSecondaryCandidate && secondary.includes(activeSecondaryCandidate) && !hidden.includes(activeSecondaryCandidate) ? activeSecondaryCandidate : null;
  const primaryOpen = layout.primary?.open ?? false;
  const primaryWidth = layout.primary?.width ?? 420;
  const secondaryOpen = layout.secondary?.open ?? false;
  const secondaryWidth = layout.secondary?.width ?? 420;
  return {
    version: 2,
    primary,
    secondary,
    hidden,
    active: {
      primary: activePrimary ?? null,
      secondary: activeSecondary ?? null
    },
    drawers: {
      primary: { open: primaryOpen, width: primaryWidth },
      secondary: { open: secondaryOpen, width: secondaryWidth }
    },
    side: layout.drawerSide ?? side ?? "left"
  };
}
function resolveStoredId(storedId, findKey) {
  const exact = findKey(storedId);
  if (exact)
    return exact;
  const stripped = stripTabIdSuffix(storedId);
  if (stripped === storedId)
    return null;
  return findKey(stripped) ?? null;
}
function serializeModelToLayout(model, resolve, version) {
  const primary = resolveList(model.primary, resolve);
  const secondary = resolveList(model.secondary, resolve);
  const tabOrder = [...primary, ...secondary];
  const detachedTabs = [
    ...model.secondary.map((key) => {
      const id = resolve(key);
      return id ? { tabId: id, tabTitle: key, sidebar: "secondary" } : null;
    })
  ].filter(Boolean);
  const hiddenTabIds = model.hidden.map((key) => resolve(key)).filter(Boolean);
  return {
    version,
    primary: {
      open: model.drawers.primary.open,
      width: model.drawers.primary.width,
      tabId: model.active.primary ? resolve(model.active.primary) ?? undefined : undefined
    },
    secondary: {
      open: model.drawers.secondary.open,
      width: model.drawers.secondary.width,
      activeTabId: model.active.secondary ? resolve(model.active.secondary) ?? undefined : undefined
    },
    detachedTabs,
    tabOrder,
    hiddenTabIds,
    drawerSide: model.side
  };
}
function resolveList(keys, resolve) {
  return keys.map((key) => resolve(key)).filter(Boolean);
}
var init_layout_model = () => {};

// src/persist/layout-repo.ts
function getBootLoadWindowMs() {
  return _windowMs;
}
function getBootLoadIntervalMs() {
  return _intervalMs;
}
function setLayoutRepoBackendCtx(ctx) {
  _ctx = ctx;
}
function isLayoutRepoArmed() {
  return _armed;
}
function armLayoutRepo() {
  _armed = true;
}
function disarmLayoutRepo() {
  _armed = false;
  for (const [id, { reject, timer }] of _pendingSaves) {
    clearTimeout(timer);
    _pendingSaves.delete(id);
    reject(new Error("layout repo disarmed"));
  }
}
function loadLayoutFromDisk() {
  const ctx = _ctx;
  if (!ctx)
    return Promise.resolve({ status: "error", reason: "no backend" });
  return new Promise((resolve) => {
    let settled = false;
    let unsub = null;
    let attempts = 0;
    const startedAt2 = Date.now();
    function attempt() {
      if (settled)
        return;
      const handler = (payload) => {
        if (payload.type !== "LAYOUT_DATA")
          return;
        if (settled)
          return;
        settled = true;
        if (typeof unsub === "function")
          unsub();
        const result = payload && typeof payload === "object" && "result" in payload ? payload.result : null;
        if (result && typeof result === "object" && (result.status === "ok" || result.status === "empty" || result.status === "error")) {
          bootStep(`layout-load-resolved`, `attempt ${attempts} after ${Date.now() - startedAt2}ms (${result.status})`);
          resolve(result);
        } else {
          resolve({ status: "error", reason: "malformed response" });
        }
      };
      unsub = ctx.onBackendMessage(handler);
      attempts++;
      ctx.sendToBackend({ type: "LOAD_LAYOUT" });
      setTimeout(() => {
        if (settled)
          return;
        const elapsed = Date.now() - startedAt2;
        if (elapsed < getBootLoadWindowMs()) {
          if (typeof unsub === "function")
            unsub();
          if (attempts > 1 && attempts % 5 === 1) {
            bootWarn(`layout-load-still-pending`, `attempt ${attempts} no response after ${elapsed}ms — transport not ready (WS connecting or worker spawning)`);
          }
          attempt();
        } else {
          settled = true;
          if (typeof unsub === "function")
            unsub();
          const reason = `load timed out after ${attempts} attempts (${elapsed}ms)`;
          bootWarn(`layout-load-timeout`, reason);
          resolve({ status: "error", reason });
        }
      }, getBootLoadIntervalMs());
    }
    attempt();
  });
}
function saveLayoutToDisk(layout) {
  const ctx = _ctx;
  if (!ctx)
    return Promise.resolve({ status: "error", reason: "no backend" });
  if (!_armed)
    return Promise.resolve({ status: "error", reason: "not armed" });
  const id = ++_saveCounter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_pendingSaves.has(id)) {
        _pendingSaves.delete(id);
        resolve({ status: "error", reason: "save timed out" });
      }
    }, 5000);
    _pendingSaves.set(id, { resolve, reject, timer });
    ctx.sendToBackend({ type: "SAVE_LAYOUT", layout, saveId: id });
  });
}
function __resolveLayoutSave(saveId, result) {
  const pending = _pendingSaves.get(saveId);
  if (!pending)
    return;
  _pendingSaves.delete(saveId);
  clearTimeout(pending.timer);
  pending.resolve(result);
}
function bindLayoutSaveResultBridge() {
  const ctx = _ctx;
  if (!ctx)
    return () => {};
  return ctx.onBackendMessage((payload) => {
    if (!payload || payload.type !== "SAVE_LAYOUT_RESULT")
      return;
    const saveId = typeof payload.saveId === "number" ? payload.saveId : 0;
    const result = payload.result;
    if (result && typeof result === "object" && (result.status === "ok" || result.status === "error")) {
      __resolveLayoutSave(saveId, result);
    }
  });
}
var BOOT_LOAD_WINDOW_MS = 15000, BOOT_LOAD_INTERVAL_MS = 1000, _windowMs, _intervalMs, _ctx = null, _armed = false, _saveCounter = 0, _pendingSaves;
var init_layout_repo = __esm(() => {
  init_boot_diag();
  _windowMs = BOOT_LOAD_WINDOW_MS;
  _intervalMs = BOOT_LOAD_INTERVAL_MS;
  _pendingSaves = new Map;
});

// src/sidebar/main-tab-pin.ts
var exports_main_tab_pin = {};
__export(exports_main_tab_pin, {
  reconcileMainTabListPin: () => reconcileMainTabListPin,
  isMainTabPinEnabled: () => isMainTabPinEnabled,
  isMainTabListPinActive: () => isMainTabListPinActive,
  getMainMirrorActiveTabId: () => getMainMirrorActiveTabId,
  getActiveMainMirrorKey: () => getActiveMainMirrorKey,
  findNeighborHostButtonFor: () => findNeighborHostButtonFor,
  applyMainTabListPin: () => applyMainTabListPin,
  adoptMainMirrorNeighbor: () => adoptMainMirrorNeighbor,
  adoptMainMirrorHostActivation: () => adoptMainMirrorHostActivation,
  activateMainMirrorFromRestore: () => activateMainMirrorFromRestore,
  __setMainTabPinEnabledForTest: () => __setMainTabPinEnabledForTest,
  __setActiveMainMirrorKeyForTest: () => __setActiveMainMirrorKeyForTest,
  __resetMainTabPinForTest: () => __resetMainTabPinForTest,
  MAIN_MIRROR_LIST_MAIN_CLASS: () => MAIN_MIRROR_LIST_MAIN_CLASS,
  MAIN_MIRROR_LIST_CLASS: () => MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_LIST_BOTTOM_CLASS: () => MAIN_MIRROR_LIST_BOTTOM_CLASS,
  MAIN_MIRROR_BTN_CLASS: () => MAIN_MIRROR_BTN_CLASS
});
function commitState(updater) {
  const patch = updater(_state);
  const activeChanged = patch.activeKey !== undefined && patch.activeKey !== null && patch.activeKey !== _state.activeKey;
  Object.assign(_state, patch);
  if (activeChanged) {
    Promise.resolve().then(() => (init_dispatch(), exports_dispatch)).then((m) => m.dispatchTrackedActiveSync()).catch((err) => {
      dwarn("[main-mirror] active persist dispatch failed:", err);
    });
  }
}
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
  if (_state.enabled && !opts?.force) {
    scheduleReconcile();
    return;
  }
  commitState(() => ({ enabled: true }));
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
  const on = !!getSettings().taskbarMode;
  if (!on) {
    teardownMainPin();
    Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
    return;
  }
  commitState(() => ({ enabled: true }));
  ensureObservers();
  reconcileMainMirror();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m) => m.updateStripGutters());
}
function isMainTabListPinActive() {
  return _state.enabled && isMainMirrorActive();
}
function __resetMainTabPinForTest() {
  stopObservers();
  _state = { ...initialState };
  __resetMainMirrorForTest();
  destroyMainPinHost();
}
function getActiveMainMirrorKey() {
  return _state.activeKey;
}
function isMainTabPinEnabled() {
  return _state.enabled;
}
function getMainMirrorActiveTabId() {
  if (!_state.enabled)
    return null;
  const key = _state.activeKey;
  if (!key)
    return null;
  if (key.startsWith("id__"))
    return key.slice(4) || null;
  if (key.startsWith("title__"))
    return key.slice(7) || null;
  return null;
}
function __setActiveMainMirrorKeyForTest(key) {
  _state.activeKey = key;
}
function __setMainTabPinEnabledForTest(on) {
  _state.enabled = on;
}
function activateMainMirrorFromRestore(hostBtn, title) {
  if (_state.userPicked) {
    dlog("[main-mirror] activate-from-restore skipped (user key established)", {
      keepKey: _state.activeKey,
      targetTitle: title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined
    });
    return;
  }
  const resolvedTitle = title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined;
  if (hostBtn && hostBtn.isConnected) {
    const key = hostButtonKey(hostBtn);
    commitState(() => ({ activeKey: key, userPicked: false }));
    try {
      hostBtn.click();
    } catch {}
  } else if (resolvedTitle) {
    commitState(() => ({ activeKey: `title__${resolvedTitle}`, userPicked: false }));
  }
  onMainMirrorTabActivated(resolvedTitle);
}
function adoptMainMirrorNeighbor(hostBtn, title) {
  if (!_state.enabled)
    return;
  const resolvedTitle = title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined;
  if (hostBtn && hostBtn.isConnected) {
    const key = hostButtonKey(hostBtn);
    commitState(() => ({ activeKey: key, userPicked: true }));
    try {
      hostBtn.click();
    } catch {}
  } else if (resolvedTitle) {
    commitState(() => ({ activeKey: `title__${resolvedTitle}`, userPicked: true }));
  }
  onMainMirrorTabActivated(resolvedTitle);
}
function adoptMainMirrorHostActivation(hostBtn, title, opts) {
  if (!_state.enabled)
    return;
  if (hostBtn && isSecondaryAssignedHostButton(hostBtn)) {
    dlog("[main-mirror] adopt host activation skipped (secondary-assigned button)", {
      key: hostButtonKey(hostBtn)
    });
    return;
  }
  const resolvedTitle = title || hostBtn?.getAttribute("title") || hostBtn?.getAttribute("aria-label") || undefined;
  if (hostBtn && hostBtn.isConnected) {
    commitState(() => ({ activeKey: hostButtonKey(hostBtn), userPicked: false }));
  } else if (resolvedTitle) {
    commitState(() => ({ activeKey: `title__${resolvedTitle}`, userPicked: false }));
  }
  if (!isMainMirrorActive()) {
    dlog("[main-mirror] adopt host activation (key only; shell inactive)", {
      key: _state.activeKey,
      title: resolvedTitle
    });
    return;
  }
  const shouldOpen = opts?.open !== false;
  if (shouldOpen) {
    onMainMirrorTabActivated(resolvedTitle);
  } else if (resolvedTitle) {
    setCanvasMainTitle(resolvedTitle);
  }
  scheduleReconcile();
  dlog("[main-mirror] adopt host activation", {
    key: _state.activeKey,
    title: resolvedTitle,
    open: shouldOpen
  });
}
function teardownMainPin() {
  commitState(() => ({ enabled: false, activeKey: null }));
  stopObservers();
  applyMainMirrorDrawer(false, { force: true });
  destroyMainPinHost();
}
function scheduleReconcile() {
  if (_state.reconcileRaf !== null)
    return;
  commitState(() => ({
    reconcileRaf: requestAnimationFrame(() => {
      commitState(() => ({ reconcileRaf: null }));
      if (_state.enabled)
        reconcileMainMirror();
    })
  }));
}
function reconcileMainMirror() {
  if (!_state.enabled)
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
  if (sidebar !== _state.sidebar) {
    attachSidebarObserver(sidebar);
  }
  const { main: mainSection, bottom: bottomSection } = ensureMirrorListStructure(list);
  const hostButtons = collectHostTabButtons(sidebar);
  const regularButtons = hostButtons.filter((b) => !isSettingsButton(b));
  const settingsButtons = hostButtons.filter((b) => isSettingsButton(b));
  const wantedKeys = new Set(hostButtons.map((b) => hostButtonKey(b)));
  if (_state.activeKey == null || !wantedKeys.has(_state.activeKey)) {
    const prevKey = _state.activeKey;
    const hiddenHostForKey = prevKey != null ? findHostButtonByKeyIncludingHidden(sidebar, prevKey) : null;
    const midMoveHidden = !!hiddenHostForKey && hiddenHostForKey.style.display === "none";
    if (midMoveHidden) {
      dlog("[main-mirror] active key kept (mid-move host hidden)", { prevKey });
    } else {
      const hostActiveBtn = hostButtons.find((b) => hostHasTabBtnActive(b)) ?? null;
      const hostActiveIsSecondary = hostActiveBtn != null && isSecondaryAssignedHostButton(hostActiveBtn);
      if (hostActiveBtn && !hostActiveIsSecondary && !isSettingsButton(hostActiveBtn)) {
        const newKey = hostButtonKey(hostActiveBtn);
        commitState(() => ({ activeKey: newKey, userPicked: false }));
        const t = hostActiveBtn.getAttribute("title") || hostActiveBtn.getAttribute("aria-label") || "";
        if (t)
          setCanvasMainTitle(t);
      } else if (prevKey != null && !hostActiveIsSecondary) {
        commitState(() => ({ activeKey: null, userPicked: false }));
      }
      if (prevKey !== _state.activeKey) {
        dlog("[main-mirror] active key healed/seeded", {
          prevKey,
          nextKey: _state.activeKey
        });
      }
    }
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
  if (_state.activeKey != null) {
    const activeMirror = list.querySelector(`button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(_state.activeKey)}"]`);
    const title = activeMirror?.getAttribute("title") || activeMirror?.getAttribute("aria-label") || "";
    if (title) {
      setCanvasMainTitle(title);
    }
  }
  dlog("[main-mirror] reconcile tabs", {
    hostCount: hostButtons.length,
    regularCount: regularButtons.length,
    settingsCount: settingsButtons.length,
    mirrorCount: list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`).length,
    open: isCanvasMainOpen(),
    hostOrder: hostButtons.map((b) => hostButtonKey(b)),
    mirrorOrder: Array.from(list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`)).map((b) => b.getAttribute("data-mirror-key") || mirrorButtonKey(b)),
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
  if (isSettingsButton(hostBtn))
    return false;
  return isShowTabLabels();
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
  return buttons.filter((b) => b.style.display !== "none");
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
function findHostButtonByKeyIncludingHidden(sidebar, key) {
  const buttons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]'));
  return buttons.find((b) => hostButtonKey(b) === key) ?? null;
}
function findNeighborHostButtonFor(tabId) {
  const sidebar = getMainSidebar();
  if (!sidebar)
    return null;
  const buttons = collectHostTabButtons(sidebar);
  const idx = buttons.findIndex((b) => b.getAttribute("data-tab-id") === tabId);
  if (idx === -1)
    return null;
  for (let i = idx - 1;i >= 0; i--) {
    if (!isSettingsButton(buttons[i]))
      return buttons[i];
  }
  for (let i = idx + 1;i < buttons.length; i++) {
    if (!isSettingsButton(buttons[i]))
      return buttons[i];
  }
  return null;
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
function isSecondaryAssignedHostButton(btn) {
  const id = btn.getAttribute("data-tab-id") || btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
  if (!id)
    return false;
  try {
    return getTabSidebar(id) === "secondary";
  } catch {
    return false;
  }
}
function syncMirrorFromHost(mirror, hostBtn) {
  const tabId = hostBtn.getAttribute("data-tab-id");
  if (tabId)
    mirror.setAttribute("data-tab-id", tabId);
  else
    mirror.removeAttribute("data-tab-id");
  if (!tabId) {
    const key2 = hostButtonKey(hostBtn);
    if (!_noTabIdMirrorLogged.has(key2)) {
      _noTabIdMirrorLogged.add(key2);
      dlog("[main-mirror] mirror button has no data-tab-id (host twin untagged)", {
        key: key2,
        title: hostBtn.getAttribute("title") || hostBtn.getAttribute("aria-label") || null,
        hostCls: String(hostBtn.className || "")
      });
    }
  }
  const title = hostBtn.getAttribute("title") || hostBtn.getAttribute("aria-label") || "";
  if (title) {
    mirror.setAttribute("title", title);
    mirror.setAttribute("aria-label", title);
  }
  const key = hostButtonKey(hostBtn);
  const hostActive = hostHasTabBtnActive(hostBtn);
  const canvasActive = _state.activeKey != null && key === _state.activeKey;
  const showActive = isCanvasMainOpen() && (_state.activeKey != null ? canvasActive : hostActive);
  const wasActive = mirror.classList.contains("sidebar-ux-tab-active");
  mirror.classList.toggle("sidebar-ux-tab-active", showActive);
  if (showActive !== wasActive) {
    dlog("[main-mirror] active toggle", {
      title: mirror.getAttribute("title"),
      showActive,
      hostActive,
      canvasActive,
      canvasKey: _state.activeKey,
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
  if (labeled && !isSettingsButton(hostBtn)) {
    const hostLabel = hostBtn.querySelector('span[class*="tabLabel"]');
    const fromHost = hostLabel ? (hostLabel.textContent || "").trim() : "";
    const title = hostBtn.getAttribute("title") || hostBtn.getAttribute("aria-label") || "";
    const text = fromHost || (title ? deriveShortName(title) : "");
    if (text) {
      parts.push(`<span class="sidebar-ux-tab-label" style="opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease">${escapeHtml(text)}</span>`);
    }
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
  const wasActive = _state.activeKey != null ? key === _state.activeKey : mirror.classList.contains("sidebar-ux-tab-active") || hostHasTabBtnActive(hostBtn);
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
      const againKey = hostButtonKey(again);
      commitState(() => ({ activeKey: againKey, userPicked: true }));
      try {
        again.click();
      } catch {}
    } else {
      commitState(() => ({ activeKey: key, userPicked: true }));
    }
    onMainMirrorTabActivated(title);
    return;
  }
  commitState(() => ({ activeKey: key, userPicked: true }));
  try {
    hostBtn.click();
  } catch {}
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
  if (_state.observer && _state.sidebar === sidebar)
    return;
  if (_state.observer) {
    _state.observer.disconnect();
    commitState(() => ({ observer: null }));
  }
  commitState(() => ({ sidebar }));
  if (typeof MutationObserver === "undefined")
    return;
  const observer = new MutationObserver(() => scheduleReconcile());
  observer.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-tab-id", "title", "aria-label"]
  });
  commitState(() => ({ observer }));
}
function stopObservers() {
  if (_state.observer) {
    _state.observer.disconnect();
    commitState(() => ({ observer: null, sidebar: null }));
  }
  if (_state.reconcileRaf !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(_state.reconcileRaf);
    commitState(() => ({ reconcileRaf: null }));
  }
}
var MAIN_MIRROR_LIST_CLASS = "sidebar-ux-main-tab-list-mirror", MAIN_MIRROR_BTN_CLASS = "sidebar-ux-main-tab-mirror-btn", MAIN_MIRROR_LIST_MAIN_CLASS = "sidebar-ux-tab-list-main", MAIN_MIRROR_LIST_BOTTOM_CLASS = "sidebar-ux-tab-list-bottom", initialState, _state, _mirrorToHost, _noTabIdMirrorLogged;
var init_main_tab_pin = __esm(() => {
  init_store();
  init_state();
  init_log();
  init_mobile_exclusion();
  init_drawer_sync();
  init_assignment();
  init_main_mirror_drawer();
  init_tab_position();
  init_buttons();
  initialState = {
    enabled: false,
    activeKey: null,
    userPicked: false,
    sidebar: null,
    observer: null,
    reconcileRaf: null
  };
  _state = { ...initialState };
  _mirrorToHost = new WeakMap;
  _noTabIdMirrorLogged = new Set;
});

// src/tabs/active-tab.ts
var exports_active_tab = {};
__export(exports_active_tab, {
  setActiveSecondaryTabId: () => setActiveSecondaryTabId,
  resolvePrimaryActiveTabId: () => resolvePrimaryActiveTabId,
  isTabActiveInMainDrawer: () => isTabActiveInMainDrawer,
  getActiveTabId: () => getActiveTabId,
  getActiveSecondaryTabId: () => getActiveSecondaryTabId
});
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
function resolvePrimaryActiveTabId() {
  if (isMainTabPinEnabled()) {
    return getMainMirrorActiveTabId();
  }
  const sidebar = getMainSidebar();
  if (sidebar) {
    const activeBtn = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]');
    const id = activeBtn?.getAttribute("data-tab-id") || activeBtn?.getAttribute("title") || null;
    if (id)
      return id;
  }
  const active = getActiveTabId();
  if (active.state === "active")
    return active.id;
  return null;
}
function isTabActiveInMainDrawer(tabId) {
  const id = resolvePrimaryActiveTabId();
  return id != null && id === tabId;
}
function getActiveSecondaryTabId() {
  return _activeSecondaryTabId;
}
function setActiveSecondaryTabId(tabId) {
  const changed = tabId !== null && tabId !== _activeSecondaryTabId;
  _activeSecondaryTabId = tabId;
  if (changed) {
    Promise.resolve().then(() => (init_dispatch(), exports_dispatch)).then((m) => m.dispatchTrackedActiveSync()).catch(() => {});
  }
}
var _activeSecondaryTabId = null;
var init_active_tab = __esm(() => {
  init_store();
  init_main_tab_pin();
});

// src/tabs/host-tab-location.ts
var exports_host_tab_location = {};
__export(exports_host_tab_location, {
  requestHostTabToSecondary: () => requestHostTabToSecondary,
  requestHostTabToMain: () => requestHostTabToMain,
  requestHostTabLocation: () => requestHostTabLocation,
  locationMatches: () => locationMatches,
  getHostMoveTabTo: () => getHostMoveTabTo,
  __setHostMoveTabToForTest: () => __setHostMoveTabToForTest,
  CANVAS_SECONDARY_CONTAINER_ID: () => CANVAS_SECONDARY_CONTAINER_ID
});
function __setHostMoveTabToForTest(fn) {
  _testMoveTabTo = fn;
  _cachedMoveTabTo = fn;
  _moveTabToCacheTs = Date.now();
}
function locationMatches(actual, expected) {
  const effective = actual ?? { kind: "main-drawer" };
  if (effective.kind !== expected.kind)
    return false;
  if (expected.kind === "container") {
    return effective.containerId === expected.containerId;
  }
  return true;
}
function readLocation(tabId) {
  const ui = getHostBridge()?.ui;
  if (ui?.getTabLocation) {
    try {
      return ui.getTabLocation(tabId) ?? null;
    } catch {}
  }
  findStoreData(true);
  const snap = getStoreSnapshot();
  const loc = snap?.tabLocations?.[tabId];
  return loc ?? null;
}
function scanFiberForMoveTabTo(fiber, depth, maxDepth, visited) {
  if (!fiber || depth > maxDepth || visited.has(fiber))
    return null;
  visited.add(fiber);
  let hook = fiber.memoizedState;
  let hookIdx = 0;
  while (hook && hookIdx < 40) {
    const state = hook.memoizedState;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      const move = state.moveTabTo;
      if (typeof move === "function") {
        return move;
      }
    }
    hook = hook.next;
    hookIdx++;
  }
  const child = scanFiberForMoveTabTo(fiber.child, depth + 1, maxDepth, visited);
  if (child)
    return child;
  return scanFiberForMoveTabTo(fiber.sibling, depth, maxDepth, visited);
}
function walkElementForMoveTabTo(el, visited) {
  if (!el)
    return null;
  const rootFiber = getFiberFromElement(el);
  if (!rootFiber)
    return null;
  let fiber = rootFiber;
  const ancestors = [];
  while (fiber) {
    ancestors.push(fiber);
    fiber = fiber.return;
  }
  for (let i = ancestors.length - 1;i >= Math.max(0, ancestors.length - 8); i--) {
    const found = scanFiberForMoveTabTo(ancestors[i], 0, 40, visited);
    if (found)
      return found;
  }
  return null;
}
function getHostMoveTabTo(force = false) {
  if (_testMoveTabTo)
    return _testMoveTabTo;
  const now = Date.now();
  if (!force && _cachedMoveTabTo && now - _moveTabToCacheTs < MOVE_TAB_TO_TTL_MS) {
    return _cachedMoveTabTo;
  }
  findStoreData(force);
  const snap = getStoreSnapshot();
  if (snap && typeof snap.moveTabTo === "function") {
    _cachedMoveTabTo = snap.moveTabTo;
    _moveTabToCacheTs = now;
    return _cachedMoveTabTo;
  }
  if (typeof document === "undefined")
    return null;
  const visited = new Set;
  const anchors = [
    getMainSidebar(),
    getMainPanel(),
    getMainWrapper()
  ];
  if (typeof document.getElementById === "function") {
    anchors.push(document.getElementById("root"), document.getElementById("app"), document.body);
  }
  for (const el of anchors) {
    const found = walkElementForMoveTabTo(el, visited);
    if (found) {
      _cachedMoveTabTo = found;
      _moveTabToCacheTs = now;
      return found;
    }
  }
  _cachedMoveTabTo = null;
  _moveTabToCacheTs = now;
  return null;
}
function requestHostTabLocation(tabId, location) {
  const ui = getHostBridge()?.ui;
  if (ui?.requestTabLocation) {
    try {
      ui.requestTabLocation(tabId, location);
    } catch (err) {
      dwarn(`[tabmove] requestTabLocation threw for "${tabId}":`, err);
    }
    const after = readLocation(tabId);
    if (locationMatches(after, location)) {
      dlog(`[tabmove] requestHostTabLocation ok via=bridge tab=${tabId} loc=${JSON.stringify(location)}`);
      return { ok: true, via: "bridge" };
    }
    dlog(`[tabmove] requestTabLocation did not stick for "${tabId}" ` + `(got ${JSON.stringify(after)}; often non-CORE allowlist silent no-op). Trying store.moveTabTo.`);
  }
  const moveTabTo = getHostMoveTabTo(true);
  if (!moveTabTo) {
    dlog(`[tabmove] bridge+store unavailable for "${tabId}" ` + `(allowlist no-op and moveTabTo missing) — caller may DOM-place.`);
    return { ok: false, via: "none" };
  }
  try {
    moveTabTo(tabId, location);
  } catch (err) {
    dwarn(`[tabmove] store.moveTabTo threw for "${tabId}":`, err);
    return { ok: false, via: "none" };
  }
  const afterStore = readLocation(tabId);
  if (locationMatches(afterStore, location)) {
    dlog(`[tabmove] requestHostTabLocation ok via=store tab=${tabId} loc=${JSON.stringify(location)}`);
    return { ok: true, via: "store" };
  }
  dwarn(`[tabmove] store.moveTabTo for "${tabId}" did not stick (loc=${JSON.stringify(afterStore)}).`);
  return { ok: false, via: "none" };
}
function requestHostTabToSecondary(tabId) {
  return requestHostTabLocation(tabId, {
    kind: "container",
    containerId: CANVAS_SECONDARY_CONTAINER_ID
  });
}
function requestHostTabToMain(tabId) {
  return requestHostTabLocation(tabId, { kind: "main-drawer" });
}
var CANVAS_SECONDARY_CONTAINER_ID = "canvas-secondary-drawer", _cachedMoveTabTo = null, _moveTabToCacheTs = 0, MOVE_TAB_TO_TTL_MS = 3000, _testMoveTabTo = null;
var init_host_tab_location = __esm(() => {
  init_fiber();
  init_store();
  init_log();
});

// src/tabs/dom-placed-builtin.ts
function isDomPlacedBuiltIn(tabId) {
  if (_domPlacedIds.has(tabId))
    return true;
  if (typeof document === "undefined")
    return false;
  try {
    return !!document.querySelector(`[data-canvas-moved="${CSS.escape(tabId)}"][${CANVAS_DOM_PLACED_ATTR}]`);
  } catch {
    return false;
  }
}
function markDomPlacedBuiltIn(tabId) {
  _domPlacedIds.add(tabId);
}
function clearDomPlacedBuiltIn(tabId) {
  _domPlacedIds.delete(tabId);
}
function __clearDomPlacedForTest() {
  _domPlacedIds.clear();
}
function resolveMainPanelContentForRestore() {
  const fromHost = getMainPanelContent();
  if (fromHost)
    return fromHost;
  if (typeof document === "undefined")
    return null;
  return document.querySelector("[data-canvas-main-panel-content]");
}
function restoreDomPlacedBuiltInToMain(tabId, root) {
  let el = root ?? null;
  if (!el && typeof document !== "undefined") {
    try {
      el = document.querySelector(`[data-canvas-moved="${CSS.escape(tabId)}"][${CANVAS_DOM_PLACED_ATTR}]`);
      if (!el) {
        el = document.querySelector(`[data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`);
      }
    } catch {
      el = null;
    }
  }
  if (el) {
    if (el.parentElement) {
      try {
        el.parentElement.removeChild(el);
      } catch {}
    }
    el.removeAttribute("data-canvas-moved");
    el.removeAttribute("data-canvas-active");
    el.removeAttribute(CANVAS_DOM_PLACED_ATTR);
    el.style.removeProperty("position");
    el.style.removeProperty("inset");
    el.style.removeProperty("display");
  }
  _domPlacedIds.delete(tabId);
  dlog(`[tabmove] restoreDomPlacedBuiltInToMain tab=${tabId} restored=${!!el} (detached — host re-attaches on activation)`);
  return !!el;
}
var CANVAS_DOM_PLACED_ATTR = "data-canvas-dom-placed", _domPlacedIds;
var init_dom_placed_builtin = __esm(() => {
  init_log();
  _domPlacedIds = new Set;
});

// src/tabs/builtin-move.ts
var exports_builtin_move = {};
__export(exports_builtin_move, {
  restoreDomPlacedBuiltInToMain: () => restoreDomPlacedBuiltInToMain,
  resolveMainPanelContentForRestore: () => resolveMainPanelContentForRestore,
  moveBuiltInTabToSecondaryContainer: () => moveBuiltInTabToSecondaryContainer,
  markDomPlacedBuiltIn: () => markDomPlacedBuiltIn,
  isDomPlacedBuiltIn: () => isDomPlacedBuiltIn,
  clearDomPlacedBuiltIn: () => clearDomPlacedBuiltIn,
  __setSecondaryContentForTest: () => __setSecondaryContentForTest,
  __clearDomPlacedForTest: () => __clearDomPlacedForTest,
  CANVAS_DOM_PLACED_ATTR: () => CANVAS_DOM_PLACED_ATTR
});
function __setSecondaryContentForTest(el) {
  _testSecondaryContent = el;
}
function tryDomPlaceRoot(tabId, root) {
  const secondaryContent = _testSecondaryContent ?? getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-content");
  if (!secondaryContent) {
    dwarn(`[tabmove] cannot DOM-place "${tabId}" — secondary .sidebar-ux-panel-content missing`);
    return false;
  }
  try {
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root);
    }
  } catch (err) {
    dwarn(`[tabmove] DOM appendChild failed for "${tabId}":`, err);
    return false;
  }
  const inSecondary = root.parentElement === secondaryContent || typeof secondaryContent.contains === "function" && secondaryContent.contains(root);
  if (!inSecondary) {
    dwarn(`[tabmove] DOM place for "${tabId}" did not stick (parent not secondary content)`);
    return false;
  }
  root.setAttribute("data-canvas-moved", tabId);
  root.setAttribute(CANVAS_DOM_PLACED_ATTR, "");
  markDomPlacedBuiltIn(tabId);
  dlog(`[tabmove] place built-in "${tabId}" ok via=dom ` + `(bridge+store unavailable; registry root reparented into secondary)`);
  return true;
}
async function moveBuiltInTabToSecondaryContainer(opts) {
  const { tabId, deferActivation = false } = opts;
  const bridge = getHostBridge();
  const ui = bridge?.ui;
  if (!ui?.getBuiltInTabRoot) {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=BRIDGE_MISSING ` + `hasGetBuiltInTabRoot=${!!ui?.getBuiltInTabRoot} hasRequestTabLocation=${!!ui?.requestTabLocation}`);
    return;
  }
  let root = opts.root;
  if (!root) {
    try {
      root = ui.getBuiltInTabRoot(tabId);
    } catch (err) {
      dwarn(`[tabmove] getBuiltInTabRoot threw for "${tabId}":`, err);
      root = undefined;
    }
  }
  if (!root) {
    const { ensureBuiltInTabActiveInMain } = await Promise.resolve().then(() => (init_assignment(), exports_assignment));
    await ensureBuiltInTabActiveInMain(tabId, {
      getBuiltInTabRoot: (id) => {
        try {
          return ui.getBuiltInTabRoot?.(id);
        } catch {
          return;
        }
      },
      dlog
    });
    await new Promise((r) => requestAnimationFrame(() => r()));
    try {
      root = ui.getBuiltInTabRoot(tabId);
    } catch {
      root = undefined;
    }
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
  const placed = requestHostTabToSecondary(tabId);
  if (placed.ok) {
    root.removeAttribute(CANVAS_DOM_PLACED_ATTR);
    clearDomPlacedBuiltIn(tabId);
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} via=${placed.via} container=${CANVAS_SECONDARY_CONTAINER_ID}`);
    const afterLoc = ui.getTabLocation?.(tabId) ?? {
      kind: "container",
      containerId: CANVAS_SECONDARY_CONTAINER_ID
    };
    watchForContainerPass3Reset(bridge, tabId, root, afterLoc);
    return root;
  }
  if (tryDomPlaceRoot(tabId, root)) {
    if (!deferActivation) {
      root.setAttribute("data-canvas-active", "");
    }
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} via=dom container=${CANVAS_SECONDARY_CONTAINER_ID}`);
    return root;
  }
  root.removeAttribute("data-canvas-moved");
  root.removeAttribute("data-canvas-active");
  root.removeAttribute(CANVAS_DOM_PLACED_ATTR);
  clearDomPlacedBuiltIn(tabId);
  dwarn(`[tabmove] built-in "${tabId}" not moved to secondary — host allowlist denied, ` + `store.moveTabTo unavailable/failed, and DOM reparent failed. Aborting assign.`);
  return;
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
var _testSecondaryContent = null;
var init_builtin_move = __esm(() => {
  init_log();
  init_secondary();
  init_dom_placed_builtin();
  init_host_tab_location();
  init_dom_placed_builtin();
});

// src/sidebar/secondary-drawer.ts
var exports_secondary_drawer = {};
__export(exports_secondary_drawer, {
  unassignFromSecondary: () => unassignFromSecondary,
  teardownSecondaryDrawer: () => teardownSecondaryDrawer,
  setSuppressAutoActivation: () => setSuppressAutoActivation,
  setRestoringFromLayout: () => setRestoringFromLayout,
  markDrawerOpenState: () => markDrawerOpenState,
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
function initSecondaryDrawer(_ctx2) {
  drawerObserver.onTabUnregistered((tabId) => {
    if (getTabAssignments().has(tabId)) {
      if (_restoringFromLayout)
        return;
      deleteTabAssignment(tabId);
      removeSecondaryTabButton(tabId);
      if (_activeTabId === tabId) {
        _activeTabId = null;
        _state2 = getTabAssignments().size > 0 ? "open" : "closed";
        if (_state2 === "closed") {
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
  dlog("[SecondaryDrawer] finalize open-gate", {
    resolvedId,
    openOnClosed,
    state: _state2,
    sidebarOpen: isSecondarySidebarOpen(),
    mobile: isMobileViewport(),
    restoring: isRestoringFromLayout(),
    deferActivation,
    setActiveWhenReady
  });
  if (openOnClosed && _state2 === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar();
    dlog("[SecondaryDrawer] finalize open-gate:BRANCH open+tab_active", { resolvedId });
    if (!deferActivation) {
      _state2 = "tab_active";
      _activeTabId = resolvedId;
      setActiveSecondaryTabId(resolvedId);
    }
  } else if (setActiveWhenReady && !isMobileViewport() && !deferActivation) {
    dlog("[SecondaryDrawer] finalize open-gate:BRANCH tab_active-only", { resolvedId });
    _activeTabId = resolvedId;
    _state2 = "tab_active";
    setActiveSecondaryTabId(resolvedId);
  } else {
    dlog("[SecondaryDrawer] finalize open-gate:BRANCH none", { resolvedId });
  }
  const headerTitle = getSecondaryWrapper()?.querySelector(".sidebar-ux-panel-title");
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = title;
  }
  if (showAndPersist) {
    if (!isMobileViewport() && !deferActivation) {
      showSecondaryTab(resolvedId);
    }
  }
  if (wireAssignment) {
    try {
      const m = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
      m.reconcileMainTabListPin();
    } catch {}
  }
}
async function assignExtensionTabToSecondary(ctx) {
  const { tabId, tab, resolvedId, iconSvg, shortName, deferActivation } = ctx;
  setTabAssignment(resolvedId, "secondary");
  hideMainTabButton(resolvedId);
  if (_state2 === "closed" && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar();
    _state2 = "open";
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
      setActiveWhenReady: ctx.setActiveWhenReady ?? true
    });
    return;
  }
  const secondaryWrapper = getSecondaryWrapper();
  const secondaryContentMain = secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
  const { getHostStoreTabs: getHostStoreTabs2 } = await Promise.resolve().then(() => (init_store(), exports_store));
  const hostStoreTabs = getHostStoreTabs2();
  const fiberTab = hostStoreTabs.find((t) => t.id === resolvedId) || hostStoreTabs.find((t) => t.title === tab.title);
  const realRoot = fiberTab?.root && fiberTab.root !== tab.button ? fiberTab.root : null;
  if (realRoot && secondaryContentMain) {
    const root = realRoot;
    root.setAttribute("data-canvas-moved", resolvedId);
    let placedViaHost = false;
    try {
      const { requestHostTabToSecondary: requestHostTabToSecondary2 } = await Promise.resolve().then(() => (init_host_tab_location(), exports_host_tab_location));
      const placed = requestHostTabToSecondary2(resolvedId);
      dlog("[SecondaryDrawer] assignExtensionTab: requestHostTabToSecondary", {
        tabId: resolvedId,
        ok: placed.ok,
        via: placed.via
      });
      placedViaHost = placed.ok;
    } catch (err) {
      dwarn("[SecondaryDrawer] assignExtensionTab: requestHostTabToSecondary threw:", err);
    }
    if (!placedViaHost) {
      if (root.parentElement !== secondaryContentMain) {
        secondaryContentMain.appendChild(root);
      }
    }
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
      title: tab.title || storeTab?.title || resolvedId,
      root,
      iconSvg: tab.button?.querySelector("svg")?.outerHTML || storeTab?.iconSvg,
      shortName: readMainButtonShortName(tab.button) || storeTab?.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      setActiveWhenReady: ctx.setActiveWhenReady ?? true
    });
    return;
  }
  await finalizeAssignToSecondary({
    resolvedId,
    title: tab.title || storeTab?.title || resolvedId,
    root: tab.button,
    iconSvg: tab.button?.querySelector("svg")?.outerHTML || storeTab?.iconSvg,
    shortName: readMainButtonShortName(tab.button) || storeTab?.shortName,
    deferActivation,
    wireAssignment: false,
    openOnClosed: false,
    setActiveWhenReady: ctx.setActiveWhenReady ?? true
  });
  return;
}
async function assignBuiltInTabToSecondary(ctx) {
  const { tabId, tab, resolvedId, deferActivation } = ctx;
  const secondaryWrapper = getSecondaryWrapper();
  const secondaryContent = secondaryWrapper?.querySelector(".sidebar-ux-panel-content");
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title);
  const wSpindle = getHostBridge();
  const wSpindleUi = wSpindle?.ui;
  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!storeTab} hasSecondaryContent=${!!secondaryContent}`);
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
      openOnClosed: ctx.openOnClosed ?? true,
      setActiveWhenReady: ctx.setActiveWhenReady ?? false
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
  let bridgeRoot;
  try {
    bridgeRoot = wSpindleUi?.getBuiltInTabRoot?.(tabId);
  } catch (err) {
    dwarn(`[SecondaryDrawer] getBuiltInTabRoot threw for "${tabId}":`, err);
    bridgeRoot = undefined;
  }
  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} rootFound=${!!bridgeRoot} rootTagId=${bridgeRoot?.getAttribute("data-tab-id") ?? "null"} via=getBuiltInTabRoot`);
  let root;
  let placedViaHost = false;
  if (wSpindleUi?.getBuiltInTabRoot) {
    const { moveBuiltInTabToSecondaryContainer: moveBuiltInTabToSecondaryContainer2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
    root = await moveBuiltInTabToSecondaryContainer2({
      tabId,
      deferActivation,
      root: bridgeRoot
    });
    placedViaHost = !!root;
  }
  if (!root && storeTab?.root && storeTab.extensionId) {
    root = storeTab.root;
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root);
    }
    root.setAttribute("data-canvas-moved", resolvedId);
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_STORE_REPARENT tab=${resolvedId} branch=STORE_ROOT`);
  }
  if (!root) {
    dwarn("[SecondaryDrawer] assignToSecondary: built-in tab not placed (host location write failed, DOM reparent failed, or root missing).", { tabId, resolvedId, hasBridgeRoot: !!bridgeRoot, hasGetRoot: !!wSpindleUi?.getBuiltInTabRoot });
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
    openOnClosed: ctx.openOnClosed ?? true,
    setActiveWhenReady: ctx.setActiveWhenReady ?? false
  });
}
async function assignToSecondary(tabId, opts) {
  const deferActivation = isRestoringFromLayout() || isSuppressAutoActivation();
  if (!ensureSecondaryShellMounted({ initialOpen: false })) {
    dwarn(`[SecondaryDrawer] assignToSecondary: secondary shell unavailable; skip "${tabId}"`);
    return;
  }
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
      title: storeTab.title,
      key: keyForTabShape(storeTab.id, storeTab.extensionId, storeTab.title),
      titles: new Set([storeTab.title])
    };
    iconSvg = storeTab.iconSvg;
    shortName = storeTab.shortName;
  } else {
    iconSvg = tab.button.querySelector("svg")?.outerHTML;
  }
  const resolvedId = tab.tabId;
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`);
  let isExtensionTab = !!tab.extensionId && tab.extensionId !== "unknown";
  if (!isExtensionTab) {
    if (!tab)
      return;
    const t = tab;
    const { getHostStoreTabs: getHostStoreTabs2 } = await Promise.resolve().then(() => (init_store(), exports_store));
    const hostStoreTabs = getHostStoreTabs2();
    const storeTab = hostStoreTabs.find((x) => x.id === tabId) || hostStoreTabs.find((x) => x.id === t.tabId) || hostStoreTabs.find((x) => x.title === t.title);
    if (storeTab?.extensionId && storeTab.extensionId !== "unknown") {
      dlog("[SecondaryDrawer] assignToSecondary: observer entry stale — upgraded from store", {
        fromId: t.tabId,
        toId: storeTab.id,
        extFrom: t.extensionId,
        extTo: storeTab.extensionId
      });
      tab = {
        ...tab,
        tabId: storeTab.id,
        extensionId: storeTab.extensionId,
        title: storeTab.title,
        titles: new Set([storeTab.title])
      };
      iconSvg = iconSvg ?? storeTab.iconSvg;
      shortName = shortName ?? storeTab.shortName;
      isExtensionTab = true;
    }
  }
  const ctx = {
    tabId,
    tab,
    resolvedId: tab.tabId,
    iconSvg,
    shortName,
    deferActivation,
    openOnClosed: opts?.openOnClosed,
    setActiveWhenReady: opts?.setActiveWhenReady
  };
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
  let bridgeRoot;
  try {
    bridgeRoot = bridgeUi?.getBuiltInTabRoot?.(tabId) || (resolvedShowId !== tabId ? bridgeUi?.getBuiltInTabRoot?.(resolvedShowId) : undefined);
  } catch {
    bridgeRoot = undefined;
  }
  const isBuiltIn = bridgeRoot != null || !!(bridgeUi?.getBuiltInTabTitle?.(tabId) || (resolvedShowId !== tabId ? bridgeUi?.getBuiltInTabTitle?.(resolvedShowId) : undefined));
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
    const hostTabId = bridgeRoot?.getAttribute?.("data-tab-id") || tabId;
    let hostResetOk = false;
    try {
      const { requestHostTabToMain: requestHostTabToMain2 } = await Promise.resolve().then(() => (init_host_tab_location(), exports_host_tab_location));
      const result = requestHostTabToMain2(hostTabId);
      hostResetOk = result.ok;
      if (!result.ok) {
        dwarn(`[SecondaryDrawer] unassign: could not reset tabLocations for ${hostTabId} (via=${result.via})`);
      }
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassign: requestHostTabToMain failed for ${hostTabId}:`, err);
    }
    const {
      isDomPlacedBuiltIn: isDomPlacedBuiltIn2,
      restoreDomPlacedBuiltInToMain: restoreDomPlacedBuiltInToMain2,
      CANVAS_DOM_PLACED_ATTR: CANVAS_DOM_PLACED_ATTR2
    } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
    const domPlaced = isDomPlacedBuiltIn2(hostTabId) || isDomPlacedBuiltIn2(tabId) || !!_movedRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR2) || !!bridgeRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR2);
    if (domPlaced || !hostResetOk && _movedRoot) {
      restoreDomPlacedBuiltInToMain2(hostTabId, _movedRoot || bridgeRoot);
      if (tabId !== hostTabId) {
        const { clearDomPlacedBuiltIn: clearDomPlacedBuiltIn2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
        clearDomPlacedBuiltIn2(tabId);
      }
    } else {
      const clearAttrs = (el) => {
        if (!el)
          return;
        el.removeAttribute("data-canvas-moved");
        el.removeAttribute("data-canvas-active");
        el.removeAttribute(CANVAS_DOM_PLACED_ATTR2);
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
    }
  } else if (_movedRoot) {
    let hostResetOk = false;
    try {
      const { requestHostTabToMain: requestHostTabToMain2 } = await Promise.resolve().then(() => (init_host_tab_location(), exports_host_tab_location));
      const result = requestHostTabToMain2(resolvedShowId);
      hostResetOk = result.ok;
      dlog("[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain", {
        tabId: resolvedShowId,
        ok: result.ok,
        via: result.via
      });
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain failed for ${resolvedShowId}:`, err);
    }
    if (!hostResetOk) {
      if (_movedRoot.parentElement) {
        try {
          _movedRoot.parentElement.removeChild(_movedRoot);
        } catch {}
      }
    }
    _movedRoot.removeAttribute("data-canvas-moved");
    _movedRoot.removeAttribute("data-canvas-active");
    _movedRoot.style?.removeProperty?.("position");
    _movedRoot.style?.removeProperty?.("inset");
    _movedRoot.style?.removeProperty?.("display");
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
    _state2 = "closed";
    _activeTabId = null;
    setActiveSecondaryTabId(null);
    closeSecondarySidebar();
    updateDrawerTabVisibility();
  }
}
function activateSecondaryTab(tabId) {
  _activeTabId = tabId;
  _state2 = "tab_active";
  showSecondaryTab(tabId);
}
function getActiveSecondaryTab() {
  return _activeTabId;
}
function getSecondaryDrawerState() {
  return _state2;
}
function markDrawerOpenState(open) {
  if (open) {
    _state2 = _activeTabId ? "tab_active" : "open";
  } else {
    _state2 = "closed";
  }
}
function teardownSecondaryDrawer() {
  _state2 = "closed";
  _activeTabId = null;
  setActiveSecondaryTabId(null);
}
var _state2 = "closed", _activeTabId = null, _restoringFromLayout = false, _suppressAutoActivation = false;
var init_secondary_drawer = __esm(() => {
  init_drawer_observer();
  init_buttons();
  init_assignment();
  init_active_tab();
  init_secondary();
  init_store();
  init_log();
  init_mobile_exclusion();
});

// src/recon/dispatch.ts
var exports_dispatch = {};
__export(exports_dispatch, {
  snapshotOwnedModelLayout: () => snapshotOwnedModelLayout,
  shutdown: () => shutdown,
  placementFirstMoveByLiveId: () => placementFirstMoveByLiveId,
  getModel: () => getModel,
  getHost: () => getHost,
  flush: () => flush,
  dispatchTrackedActiveSync: () => dispatchTrackedActiveSync,
  dispatchMoveByLiveId: () => dispatchMoveByLiveId,
  dispatchBatch: () => dispatchBatch,
  dispatchActivateByLiveId: () => dispatchActivateByLiveId,
  dispatch: () => dispatch,
  captureSecondaryNeighborForMove: () => captureSecondaryNeighborForMove,
  captureMainMirrorMoveChrome: () => captureMainMirrorMoveChrome,
  bootstrapFromLayout: () => bootstrapFromLayout,
  bootstrap: () => bootstrap,
  applySecondaryNeighborHandoff: () => applySecondaryNeighborHandoff,
  applyMainMirrorMoveChrome: () => applyMainMirrorMoveChrome
});
function pendingLayoutTabCount(layout) {
  if (!layout || typeof layout !== "object")
    return 0;
  const ids = new Set;
  for (const id of Array.isArray(layout.tabOrder) ? layout.tabOrder : []) {
    if (typeof id === "string")
      ids.add(id);
  }
  for (const tab of Array.isArray(layout.detachedTabs) ? layout.detachedTabs : []) {
    if (typeof tab?.tabId === "string")
      ids.add(tab.tabId);
  }
  return ids.size;
}
function inventoryIsReady(observed) {
  const status = observed.inventory?.status;
  return status === undefined || status === "ready" || status === "degraded";
}
function mergeResolvedInto(current, rebuilt) {
  const inModel = new Set([...current.primary, ...current.secondary]);
  const mergeSide = (side) => {
    const cur = listForSide(current, side);
    const reb = listForSide(rebuilt, side);
    const fresh = reb.filter((k) => !inModel.has(k));
    if (fresh.length === 0)
      return cur;
    const next2 = cur.slice();
    for (const k of fresh) {
      inModel.add(k);
      next2.splice(Math.min(reb.indexOf(k), next2.length), 0, k);
    }
    return next2;
  };
  const primary = mergeSide("primary");
  const secondary = mergeSide("secondary");
  const hidden = rebuilt.hidden.filter((k) => inModel.has(k));
  const next = {
    ...current,
    primary,
    secondary,
    hidden,
    active: {
      primary: current.active.primary ?? rebuilt.active.primary,
      secondary: current.active.secondary ?? rebuilt.active.secondary
    },
    drawers: rebuilt.drawers,
    side: rebuilt.side
  };
  if (sameKeys2(next.primary, current.primary) && sameKeys2(next.secondary, current.secondary) && sameKeys2(next.hidden, current.hidden) && next.active.primary === current.active.primary && next.active.secondary === current.active.secondary && next.drawers.primary.open === current.drawers.primary.open && next.drawers.primary.width === current.drawers.primary.width && next.drawers.secondary.open === current.drawers.secondary.open && next.drawers.secondary.width === current.drawers.secondary.width && next.side === current.side) {
    return current;
  }
  return next;
}
function sameKeys2(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function bootstrap(model, host, version) {
  _unsubscribeWorldChanged?.();
  const gen = ++_generation;
  _model = model;
  _host = host;
  _version = version ?? "unknown";
  _bootstrapping = true;
  _worldSyncPending = false;
  _unsubscribeWorldChanged = host.onWorldChanged(() => {
    if (gen !== _generation || _host !== host)
      return;
    if (_bootstrapping) {
      _worldSyncPending = true;
      return;
    }
    enqueueHostSync(host, gen).catch(() => {});
  });
  const task = reconcileAndPersist(model, gen);
  _queue = task.catch(() => {}).then(() => {});
  task.then((next) => {
    if (gen !== _generation || _host !== host)
      return;
    if (next !== model)
      _model = next;
    _bootstrapping = false;
    if (_worldSyncPending) {
      _worldSyncPending = false;
      enqueueHostSync(host, gen).catch(() => {});
    }
  }, () => {
    if (gen === _generation && _host === host)
      _bootstrapping = false;
  });
}
function enqueueHostSync(host, generation) {
  const task = _queue.then(async () => {
    if (generation !== _generation || _host !== host || !_model)
      return;
    const observed = host.observe();
    if (_pendingLayout !== null && inventoryIsReady(observed) && observed.tabs.length > 0) {
      if (_restoringPending)
        return;
      if (Date.now() > _restoreDeadline) {
        dlog("[dispatch] pending-layout restore aborted (retry window expired)");
        _pendingLayout = null;
        return;
      }
      const rebuilt = buildModelFromLayout(_pendingLayout, (id) => host.findKey(id), observed.drawerSide);
      const expected = pendingLayoutTabCount(_pendingLayout);
      const resolvedAll = rebuilt.primary.length + rebuilt.secondary.length >= expected;
      const merged = mergeResolvedInto(_model, rebuilt);
      if (resolvedAll) {
        _pendingLayout = null;
      }
      if (merged !== _model) {
        _restoringPending = true;
        try {
          if (generation === _generation) {
            _model = await reconcileAndPersist(merged, generation);
          }
        } finally {
          _restoringPending = false;
        }
      }
      return;
    }
    const next = reduce(_model, { t: "syncFromHost", observed });
    if (!inventoryIsReady(observed)) {
      dlog("[dispatch] host-sync skipped non-ready inventory", {
        inventory: observed.inventory
      });
      return;
    }
    if (observed.tabs.length === 0 && (_model.primary.length > 0 || _model.secondary.length > 0)) {
      dlog("[dispatch] host-sync skipped empty observed world", {
        before: { primary: _model.primary, secondary: _model.secondary }
      });
      return;
    }
    dlog("[dispatch] host-sync", {
      observed: observed.tabs.map((t) => `${t.liveId}:${t.location}`),
      observedDrawerSide: observed.drawerSide,
      before: { primary: _model.primary, secondary: _model.secondary, side: _model.side },
      after: { primary: next.primary, secondary: next.secondary, side: next.side }
    });
    if (next.side !== _model.side) {
      dlog('[dispatch] host drawer side adopted (Lumiverse "Drawer side" setting toggled)', {
        observed: observed.drawerSide,
        modelBefore: _model.side,
        modelAfter: next.side
      });
    }
    if (next === _model)
      return;
    const result = await reconcileAndPersist(next, generation);
    if (generation === _generation)
      _model = result;
  });
  _queue = task.catch(() => {});
  return task;
}
function shutdown() {
  _generation++;
  _unsubscribeWorldChanged?.();
  _unsubscribeWorldChanged = null;
  _bootstrapping = false;
  _worldSyncPending = false;
  _host = null;
  _model = null;
  _version = "unknown";
  _pendingLayout = null;
  _restoringPending = false;
  _restoreDeadline = 0;
  _queue = Promise.resolve();
}
function getModel() {
  return _model;
}
function getHost() {
  return _host;
}
function snapshotOwnedModelLayout() {
  const host = _host;
  const model = _model;
  if (!host || !model)
    return null;
  return serializeModelToLayout(model, (key) => host.resolve(key), _version);
}
function buildPersistedBlob(model, resolve) {
  const layout = serializeModelToLayout(model, resolve, _version);
  const isDual = model.secondary.length > 0;
  return {
    ...layout,
    dualLayout: isDual ? layout : getDualLayoutSlot(),
    singleLayout: isDual ? getSingleLayoutSlot() : layout
  };
}
function persistModel(model) {
  const host = _host;
  if (!host)
    return;
  const layout = buildPersistedBlob(model, (key) => host.resolve(key));
  const json = JSON.stringify(layout);
  if (json === _lastPersistedLayout) {
    dlog("[dispatch] persist layout skipped (byte-identical)");
    return;
  }
  _lastPersistedLayout = json;
  const persistedTabs = Array.isArray(layout.tabOrder) ? layout.tabOrder.length : 0;
  const persistedSecondary = Array.isArray(layout.detachedTabs) ? layout.detachedTabs.length : 0;
  dlog("[dispatch] persist layout", {
    drawerSide: layout.drawerSide,
    primary: persistedTabs - persistedSecondary,
    secondary: persistedSecondary,
    hidden: Array.isArray(layout.hiddenTabIds) ? layout.hiddenTabIds.length : 0,
    activePrimary: layout.primary?.tabId ?? null,
    activeSecondary: layout.secondary?.activeTabId ?? null,
    singleSlot: layout.singleLayout != null,
    dualSlot: layout.dualLayout != null,
    bytes: json.length
  });
  saveLayoutToDisk(layout).then((r) => {
    if (r.status === "error") {
      console.warn("[canvas] saveLayoutToDisk failed:", r.reason);
    }
  }).catch((err) => {
    console.warn("[canvas] saveLayoutToDisk rejected:", err);
  });
}
async function reconcileAndPersist(model, generation = _generation) {
  const host = _host;
  if (!host || generation !== _generation)
    return model;
  const report = await reconcile(model, host);
  if (report.modelSideCorrection !== undefined && model.side !== report.modelSideCorrection) {
    model = { ...model, side: report.modelSideCorrection };
  }
  const hasTabs = model.primary.length > 0 || model.secondary.length > 0;
  if (generation === _generation && _host === host && _pendingLayout === null && hasTabs) {
    persistModel(model);
  }
  return model;
}
function dispatch(intent) {
  const gen = _generation;
  const host = _host;
  if (host)
    dlog("[dispatch] intent", { t: intent.t, intent });
  if (!host)
    return Promise.resolve();
  const task = _queue.then(async () => {
    if (gen !== _generation)
      return;
    if (!_model || !_host)
      return;
    const next = reduce(_model, intent);
    if (next === _model) {
      dlog("[dispatch] no-op (reduce returned same model)", { t: intent.t });
      return;
    }
    _model = next;
    _model = await reconcileAndPersist(next, gen);
  });
  _queue = task.catch(() => {});
  return task;
}
function dispatchBatch(intents) {
  const gen = _generation;
  const host = _host;
  if (!host)
    return Promise.resolve();
  const task = _queue.then(async () => {
    if (gen !== _generation)
      return;
    if (!_model || !_host)
      return;
    const next = foldIntents(_model, intents);
    dlog("[dispatch] batch", {
      intents,
      before: { primary: _model.primary, secondary: _model.secondary },
      after: { primary: next.primary, secondary: next.secondary }
    });
    if (next === _model)
      return;
    _model = next;
    _model = await reconcileAndPersist(next, gen);
  });
  _queue = task.catch(() => {});
  return task;
}
function dispatchMoveByLiveId(liveId, activateDest = true) {
  const host = _host;
  const model = _model;
  if (!host || !model)
    return Promise.resolve();
  const key = host.findKey(liveId);
  if (!key)
    return Promise.resolve();
  let from = sideOfKey(model, key);
  if (!from) {
    return dispatch({ t: "syncFromHost", observed: host.observe() }).then(() => {
      const nextModel = _model;
      if (!nextModel)
        return;
      const nextFrom = sideOfKey(nextModel, key);
      if (!nextFrom)
        return;
      const nextTo = nextFrom === "primary" ? "secondary" : "primary";
      const destVisible2 = visibleKeys(nextModel, nextTo).length;
      return dispatch({
        t: "move",
        key,
        to: nextTo,
        index: destVisible2,
        activateDest
      });
    });
  }
  const to = from === "primary" ? "secondary" : "primary";
  const destVisible = visibleKeys(model, to).length;
  return dispatch({
    t: "move",
    key,
    to,
    index: destVisible,
    activateDest
  });
}
function dispatchActivateByLiveId(liveId, side) {
  const host = _host;
  if (!host)
    return Promise.resolve();
  const key = host.findKey(liveId);
  if (!key) {
    dlog("[dispatch] dispatchActivateByLiveId: findKey returned null", { liveId, side });
    return Promise.resolve();
  }
  return dispatch({ t: "activate", key, side });
}
async function dispatchTrackedActiveSync() {
  const host = _host;
  if (!host)
    return;
  if (_bootstrapping || _restoringPending) {
    dlog("[dispatch] dispatchTrackedActiveSync skipped (model mid-boot/restore)");
    return;
  }
  const active = await Promise.resolve().then(() => (init_active_tab(), exports_active_tab));
  const primaryId = active.resolvePrimaryActiveTabId();
  const secondaryId = active.getActiveSecondaryTabId();
  const primary = primaryId ? host.findKey(primaryId) : null;
  const secondary = secondaryId ? host.findKey(secondaryId) : null;
  if (!primary && !secondary) {
    dlog("[dispatch] dispatchTrackedActiveSync: nothing resolvable", { primaryId, secondaryId });
    return;
  }
  await dispatch({ t: "syncActive", primary, secondary });
}
async function captureMainMirrorMoveChrome(liveId, target) {
  if (target !== "secondary")
    return { neighborBtn: null, reassertId: null };
  const pin = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
  if (!pin.isMainTabPinEnabled())
    return { neighborBtn: null, reassertId: null };
  const mirrorKey = pin.getActiveMainMirrorKey();
  const mirrorId = mirrorKey?.startsWith("id__") ? mirrorKey.slice("id__".length) : null;
  if (!mirrorId)
    return { neighborBtn: null, reassertId: null };
  if (mirrorId === liveId) {
    const neighborBtn = pin.findNeighborHostButtonFor(liveId);
    if (neighborBtn) {
      dlog("[tabmove] capture chrome: active tab moved — neighbor handoff target", {
        liveId,
        neighbor: neighborBtn.getAttribute("title") || neighborBtn.getAttribute("data-tab-id")
      });
    }
    return { neighborBtn, reassertId: null };
  }
  return { neighborBtn: null, reassertId: mirrorId };
}
async function applyMainMirrorMoveChrome(chrome, liveId) {
  const { neighborBtn, reassertId } = chrome;
  const pin = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
  if (!pin.isMainTabPinEnabled())
    return;
  if (neighborBtn && neighborBtn.isConnected) {
    const title = neighborBtn.getAttribute("title") || neighborBtn.getAttribute("aria-label") || undefined;
    dlog(`[tabmove] apply chrome: handing main-mirror to neighbor (${title ?? neighborBtn.getAttribute("data-tab-id")})`);
    pin.adoptMainMirrorNeighbor(neighborBtn, title);
  } else if (reassertId) {
    const { findMainTabButton: findMainTabButton2 } = await Promise.resolve().then(() => (init_buttons(), exports_buttons));
    const btn = findMainTabButton2(reassertId);
    if (btn && btn.isConnected) {
      dlog(`[tabmove] apply chrome: re-asserting active tab content (${reassertId})`);
      try {
        btn.click();
      } catch {}
    } else {
      dlog("[tabmove] apply chrome: re-assert button not found in main sidebar", { reassertId });
    }
  }
  if (neighborBtn) {
    const neighborLiveId = neighborBtn.getAttribute("data-tab-id");
    if (neighborLiveId) {
      const neighborKey = _host?.findKey(neighborLiveId);
      if (neighborKey && _model?.active.primary !== neighborKey) {
        dlog(`[tabmove] apply chrome: converging model active to neighbor (${neighborKey})`);
        dispatch({ t: "activate", key: neighborKey, side: "primary" }).catch((err) => {
          dwarn("[tabmove] apply chrome: neighbor activate dispatch failed:", err);
        });
      }
    }
  }
}
async function captureSecondaryNeighborForMove(liveId) {
  const { getActiveSecondaryTabId: getActiveSecondaryTabId2 } = await Promise.resolve().then(() => (init_active_tab(), exports_active_tab));
  if (getActiveSecondaryTabId2() !== liveId)
    return { neighborBtn: null };
  const { findNeighborSecondaryButtonFor } = await Promise.resolve().then(() => (init_buttons(), exports_buttons));
  const neighborBtn = findNeighborSecondaryButtonFor(liveId);
  if (neighborBtn) {
    dlog("[tabmove] capture secondary chrome: active tab moved — neighbor target", {
      liveId,
      neighbor: neighborBtn.getAttribute("title") || neighborBtn.getAttribute("data-tab-id")
    });
  }
  return { neighborBtn };
}
async function applySecondaryNeighborHandoff(chrome, liveId) {
  const { neighborBtn } = chrome;
  if (!neighborBtn)
    return;
  const neighborId = neighborBtn.getAttribute("data-tab-id");
  if (!neighborId)
    return;
  const title = neighborBtn.getAttribute("title") || neighborBtn.getAttribute("aria-label") || undefined;
  dlog(`[tabmove] apply secondary chrome: activating neighbor (${title ?? neighborId})`);
  if (neighborBtn.isConnected) {
    try {
      const drawer = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
      drawer.activateSecondaryTab(neighborId);
    } catch {}
  }
  const neighborKey = _host?.findKey(neighborId);
  if (neighborKey && _model?.active.secondary !== neighborKey) {
    dlog(`[tabmove] apply secondary chrome: converging model active to neighbor (${neighborKey})`);
    dispatch({ t: "activate", key: neighborKey, side: "secondary" }).catch((err) => {
      dwarn("[tabmove] apply secondary chrome: neighbor activate dispatch failed:", err);
    });
  }
}
async function placementFirstMoveByLiveId(liveId, target) {
  const host = _host;
  if (!host) {
    dlog("[tabmove] placementFirstMove: no host, bailing", { liveId, target });
    return;
  }
  const chrome = await captureMainMirrorMoveChrome(liveId, target);
  const secondaryChrome = target === "primary" ? await captureSecondaryNeighborForMove(liveId) : { neighborBtn: null };
  let placed = false;
  try {
    const sidebar = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    if (target === "secondary") {
      await sidebar.assignToSecondary(liveId);
    } else {
      await sidebar.unassignFromSecondary(liveId);
    }
    placed = true;
  } catch (err) {
    dwarn("[tabmove] placementFirstMove: placement threw", { liveId, target, err: String(err) });
  }
  if (!placed) {
    dlog("[tabmove] placementFirstMove: placement did not complete; skipping model update", { liveId, target });
    return;
  }
  if (target === "secondary") {
    const secondary = await Promise.resolve().then(() => (init_secondary(), exports_secondary));
    if (!secondary.isSecondarySidebarOpen()) {
      const { isMobileViewport: isMobileViewport2 } = await Promise.resolve().then(() => (init_mobile_exclusion(), exports_mobile_exclusion));
      if (!isMobileViewport2()) {
        dlog("[tabmove] placementFirstMove: secondary drawer not open; opening explicitly");
        secondary.openSecondarySidebar();
      } else {
        dlog("[tabmove] placementFirstMove: mobile — drawer left closed (no auto-open on move)");
      }
    }
    await applyMainMirrorMoveChrome(chrome, liveId);
  }
  const key = host.findKey(liveId);
  if (!key) {
    dlog("[tabmove] placementFirstMove: findKey returned null after placement", { liveId, target });
    return;
  }
  const model = _model;
  if (!model) {
    dlog("[tabmove] placementFirstMove: no model after placement", { liveId, target });
    return;
  }
  const from = sideOfKey(model, key);
  if (from !== target) {
    const neighborId = secondaryChrome.neighborBtn?.getAttribute("data-tab-id") ?? null;
    const neighborKey = neighborId ? host.findKey(neighborId) : null;
    if (neighborKey) {
      dlog("[tabmove] placementFirstMove: dispatching move + secondary neighbor activate", {
        liveId,
        key,
        from,
        to: target,
        neighbor: neighborKey
      });
      await dispatchBatch([
        { t: "move", key, to: target, index: -1, activateDest: false },
        { t: "activate", key: neighborKey, side: "secondary" }
      ]);
    } else {
      dlog("[tabmove] placementFirstMove: dispatching move", { liveId, key, from, to: target });
      await dispatch({ t: "move", key, to: target, index: -1, activateDest: false });
    }
  } else {
    dlog("[tabmove] placementFirstMove: model already in target", { liveId, key, target });
  }
  if (target === "primary") {
    await applySecondaryNeighborHandoff(secondaryChrome, liveId);
  }
}
function bootstrapFromLayout(layout, host, version) {
  let model = buildModelFromLayout(layout, (id) => host.findKey(id));
  if (pendingLayoutTabCount(layout) === 0) {
    const observed = host.observe();
    if (inventoryIsReady(observed) && observed.tabs.length > 0) {
      model = reduce(model, { t: "syncFromHost", observed });
    }
  }
  _restoringPending = false;
  const expected = pendingLayoutTabCount(layout);
  const resolved = model.primary.length + model.secondary.length;
  _restoreDeadline = Date.now() + RESTORE_RETRY_WINDOW_MS;
  _pendingLayout = layout != null && resolved < expected ? layout : null;
  bootstrap(model, host, version);
  const savedLayout = layout ?? {};
  dlog("[dispatch] boot restore", {
    expectedTabs: expected,
    resolvedTabs: resolved,
    pendingRetry: _pendingLayout !== null,
    savedDrawerSide: savedLayout.drawerSide ?? null,
    savedSecondary: Array.isArray(savedLayout.detachedTabs) ? savedLayout.detachedTabs.length : 0,
    modelSide: model.side,
    modelPrimary: model.primary.length,
    modelSecondary: model.secondary.length
  });
  Promise.resolve().then(() => (init_secondary(), exports_secondary)).then((m) => {
    m.reassignSecondaryTabsFromModel({
      openOnClosed: false,
      setActiveWhenReady: false,
      activateKey: model.active.secondary ?? null
    });
  }).catch((err) => {
    dwarn("[bootstrap] reassignSecondaryTabsFromModel failed:", err);
  });
}
function flush() {
  return _queue;
}
var _host = null, _model = null, _queue, _generation = 0, _version = "unknown", _unsubscribeWorldChanged = null, _bootstrapping = false, _worldSyncPending = false, _pendingLayout = null, _restoringPending = false, _restoreDeadline = 0, RESTORE_RETRY_WINDOW_MS = 30000, _lastPersistedLayout = null;
var init_dispatch = __esm(() => {
  init_reduce();
  init_reconcile();
  init_layout_model();
  init_layout_repo();
  init_state();
  init_log();
  _queue = Promise.resolve();
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
function isExtensionDrawerTab(t3) {
  if (t3.extensionId)
    return true;
  const root = t3.root;
  if (root && typeof root.className === "string" && root.className.includes("tabBtnExtension")) {
    return true;
  }
  return t3.id.includes(":");
}
function getExtensionCatalog() {
  const tabs = getDrawerTabs();
  if (!tabs || tabs.length === 0)
    return [];
  return tabs.filter(isExtensionDrawerTab).map((t3) => ({
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
function filterCatalogToLive(catalog, host, knownLiveIds) {
  if (!host)
    return catalog;
  return catalog.filter((tab) => host.findKey(tab.id) !== null || knownLiveIds.has(tab.id));
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

// src/tabs/identity.ts
function liveIdForKey(key, tabs) {
  const frozen = tabs.find((t3) => t3.key === key);
  if (frozen)
    return frozen.id;
  if (isBuiltinKey(key)) {
    const builtinId = parseBuiltinKey(key) ?? "";
    const base = builtinId.includes(":") ? builtinId.slice(0, builtinId.lastIndexOf(":")) : builtinId;
    const idMatch = tabs.find((t3) => {
      if (t3.id === builtinId)
        return true;
      const tBase = t3.id.includes(":") ? t3.id.slice(0, t3.id.lastIndexOf(":")) : t3.id;
      return tBase === base;
    });
    if (idMatch)
      return idMatch.id;
    const titleMatch2 = builtinId ? tabs.find((t3) => t3.title === builtinId) : undefined;
    if (titleMatch2)
      return titleMatch2.id;
    return builtinId;
  }
  const parsed = parseExtensionKey(key);
  if (!parsed)
    return null;
  const extMatch = tabs.find((t3) => (t3.extensionId === parsed.extensionId || !t3.extensionId && parsed.extensionId === "unknown") && t3.title === parsed.tabName);
  if (extMatch)
    return extMatch.id;
  const titleMatch = tabs.find((t3) => t3.title === parsed.tabName);
  return titleMatch ? titleMatch.id : null;
}
function keyForLiveId(id, tabs) {
  let match = tabs.find((t3) => t3.id === id);
  if (match)
    return match.key ?? null;
  const idBase = id.includes(":") ? id.slice(0, id.lastIndexOf(":")) : id;
  match = tabs.find((t3) => {
    const tBase = t3.id.includes(":") ? t3.id.slice(0, t3.id.lastIndexOf(":")) : t3.id;
    return tBase === id || tBase === idBase;
  });
  if (match)
    return match.key ?? null;
  match = tabs.find((t3) => t3.title === id || t3.titles?.has(id));
  if (match)
    return match.key ?? null;
  match = tabs.find((t3) => {
    const btn = t3.root;
    return !!btn && btn.getAttribute("data-tab-id") === id;
  });
  if (match)
    return match.key ?? null;
  return null;
}
function liveIdForTitle(title, tabs) {
  const t3 = tabs.find((x2) => x2.title === title || x2.titles?.has(title));
  return t3 ? t3.id : null;
}
var init_identity = () => {};

// src/tabs/configure-model.ts
var exports_configure_model = {};
__export(exports_configure_model, {
  swapDrawerSide: () => swapDrawerSide,
  setHidden: () => setHidden,
  reorderWithinVisible: () => reorderWithinVisible,
  reorderWithin: () => reorderWithin,
  reorderVisibleInList: () => reorderVisibleInList,
  rebaseBaseIfEpochUnchanged: () => rebaseBaseIfEpochUnchanged,
  partitionDisplayLists: () => partitionDisplayLists,
  moveTabVisible: () => moveTabVisible,
  moveTab: () => moveTab,
  leftColumnIsSecondary: () => leftColumnIsSecondary,
  isDraftDirty: () => isDraftDirty,
  insertAtVisibleIndex: () => insertAtVisibleIndex,
  encodeHostTabOrder: () => encodeHostTabOrder,
  createDraft: () => createDraft,
  baseSnapshotFromDraft: () => baseSnapshotFromDraft,
  alignIdsToLiveVisibleOrder: () => alignIdsToLiveVisibleOrder,
  alignDraftToLiveVisibleOrder: () => alignDraftToLiveVisibleOrder
});
function normalizeIdsToCatalog(ids, catalog) {
  const byTitle = new Map;
  for (const tab of catalog) {
    if (tab.title && !byTitle.has(tab.title))
      byTitle.set(tab.title, tab.id);
  }
  const observed = drawerObserver.getAllTabs().map((t3) => ({
    id: t3.tabId,
    extensionId: t3.extensionId,
    title: t3.title
  }));
  return ids.map((id) => byTitle.get(id) ?? liveIdForTitle(id, observed) ?? id);
}
function builtinIdSet() {
  return _builtinIdSet ??= new Set(BUILTIN_TAB_IDS);
}
function partitionOrderByCatalog(tabOrder, catalog) {
  const builtinOrder = [];
  const extensionOrder = [];
  const seen = new Set;
  for (const id of tabOrder) {
    if (seen.has(id))
      continue;
    seen.add(id);
    if (builtinIdSet().has(id)) {
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
    if (builtinIdSet().has(id)) {
      builtinOrder.push(id);
    } else {
      extensionOrder.push(id);
    }
  }
  return { builtinOrder, extensionOrder };
}
function createDraft(input) {
  const { catalog, tabOrder, hiddenTabIds, drawerSide, assignments } = input;
  const tabOrderNormalized = normalizeIdsToCatalog(tabOrder, catalog);
  const hiddenNormalized = normalizeIdsToCatalog(hiddenTabIds, catalog);
  const { builtinOrder, extensionOrder } = partitionOrderByCatalog(tabOrderNormalized, catalog);
  const hiddenSet = new Set(hiddenNormalized);
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
function baseSnapshotFromDraft(draft) {
  const assignments = new Map;
  for (const id of draft.primaryIds) {
    assignments.set(id, "primary");
  }
  for (const id of draft.secondaryIds) {
    assignments.set(id, "secondary");
  }
  return {
    tabOrder: encodeHostTabOrder(draft),
    hiddenTabIds: [...draft.hiddenIds],
    drawerSide: draft.drawerSide,
    assignments
  };
}
function rebaseBaseIfEpochUnchanged(draftToCommit, epochAtStart, currentEpoch) {
  if (epochAtStart !== currentEpoch)
    return null;
  return baseSnapshotFromDraft(draftToCommit);
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
  const insertAt2 = index < 0 ? target.length : Math.min(index, target.length);
  target.splice(insertAt2, 0, tabId);
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
  const insertAt2 = toIndex < 0 ? list.length : Math.min(toIndex, list.length);
  list.splice(insertAt2, 0, moved);
  const next = { ...draft, [listKey]: list };
  const { builtinOrder, extensionOrder } = syncKindOrders(next);
  return { ...next, builtinOrder, extensionOrder };
}
function alignIdsToLiveVisibleOrder(sideIds, liveVisibleIds, hiddenIds) {
  if (sideIds.length === 0)
    return [];
  const sideSet = new Set(sideIds);
  const liveOnSide = liveVisibleIds.filter((id) => sideSet.has(id));
  const liveSet = new Set(liveOnSide);
  const missingVisible = sideIds.filter((id) => !hiddenIds.has(id) && !liveSet.has(id));
  const nextVisible = [...liveOnSide, ...missingVisible];
  if (nextVisible.length === 0) {
    return sideIds.slice();
  }
  let vi = 0;
  return sideIds.map((id) => hiddenIds.has(id) ? id : nextVisible[vi++]);
}
function alignDraftToLiveVisibleOrder(draft, livePrimaryIds, liveSecondaryIds) {
  const primaryIds = alignIdsToLiveVisibleOrder(draft.primaryIds, livePrimaryIds, draft.hiddenIds);
  const secondaryIds = alignIdsToLiveVisibleOrder(draft.secondaryIds, liveSecondaryIds, draft.hiddenIds);
  const primarySame = primaryIds.length === draft.primaryIds.length && primaryIds.every((id, i3) => id === draft.primaryIds[i3]);
  const secondarySame = secondaryIds.length === draft.secondaryIds.length && secondaryIds.every((id, i3) => id === draft.secondaryIds[i3]);
  if (primarySame && secondarySame)
    return draft;
  const next = { ...draft, primaryIds, secondaryIds };
  const { builtinOrder, extensionOrder } = syncKindOrders(next);
  return { ...next, builtinOrder, extensionOrder };
}
function reorderVisibleInList(fullIds, movedId, toVisibleIndex, hiddenIds) {
  const isVisible = (id) => !hiddenIds.has(id);
  const visible = fullIds.filter(isVisible);
  const from = visible.indexOf(movedId);
  if (from === -1)
    return fullIds.slice();
  const nextVis = visible.slice();
  nextVis.splice(from, 1);
  const insertAt2 = toVisibleIndex < 0 ? nextVis.length : Math.min(toVisibleIndex, nextVis.length);
  nextVis.splice(insertAt2, 0, movedId);
  let vi = 0;
  return fullIds.map((id) => isVisible(id) ? nextVis[vi++] : id);
}
function insertAtVisibleIndex(fullIds, tabId, toVisibleIndex, hiddenIds) {
  const without = fullIds.filter((id) => id !== tabId);
  const visibleCount = without.reduce((n2, id) => n2 + (hiddenIds.has(id) ? 0 : 1), 0);
  const targetVis = toVisibleIndex < 0 ? visibleCount : Math.min(toVisibleIndex, visibleCount);
  if (targetVis >= visibleCount) {
    return [...without, tabId];
  }
  let seen = 0;
  for (let i3 = 0;i3 < without.length; i3++) {
    if (hiddenIds.has(without[i3]))
      continue;
    if (seen === targetVis) {
      const next = without.slice();
      next.splice(i3, 0, tabId);
      return next;
    }
    seen++;
  }
  return [...without, tabId];
}
function reorderWithinVisible(draft, listKey, tabId, toVisibleIndex) {
  const list = draft[listKey];
  const nextList = reorderVisibleInList(list, tabId, toVisibleIndex, draft.hiddenIds);
  if (nextList.length === list.length && nextList.every((id, i3) => id === list[i3])) {
    return draft;
  }
  const next = { ...draft, [listKey]: nextList };
  const { builtinOrder, extensionOrder } = syncKindOrders(next);
  return { ...next, builtinOrder, extensionOrder };
}
function moveTabVisible(draft, tabId, to, toVisibleIndex) {
  const fromList = draft.primaryIds.includes(tabId) ? "primaryIds" : "secondaryIds";
  const toList = to === "primary" ? "primaryIds" : "secondaryIds";
  if (fromList === toList) {
    return reorderWithinVisible(draft, fromList, tabId, toVisibleIndex);
  }
  const source = draft[fromList].filter((id) => id !== tabId);
  const target = insertAtVisibleIndex(draft[toList], tabId, toVisibleIndex, draft.hiddenIds);
  const next = { ...draft, [fromList]: source, [toList]: target };
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
var _builtinIdSet = null;
var init_configure_model = __esm(() => {
  init_configure_catalog();
  init_identity();
  init_drawer_observer();
});

// src/tabs/canvas-hidden.ts
function normalizeHiddenIds(ids) {
  if (!Array.isArray(ids))
    return [];
  const out = [];
  const seen = new Set;
  for (const id of ids) {
    if (typeof id !== "string" || !id.length)
      continue;
    if (seen.has(id))
      continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function getCanvasHiddenTabIds() {
  return _canvasHiddenTabIds.slice();
}
function setCanvasHiddenTabIds(ids) {
  _canvasHiddenTabIds = normalizeHiddenIds(ids);
}
function hydrateCanvasHiddenFromLayout(layout) {
  if (!layout || typeof layout !== "object")
    return;
  const raw = layout.hiddenTabIds;
  if (!Array.isArray(raw))
    return;
  _canvasHiddenTabIds = normalizeHiddenIds(raw);
}
function mergeHiddenTabIdLists(hostIds, canvasIds) {
  const out = [];
  const seen = new Set;
  for (const id of [...normalizeHiddenIds(hostIds), ...normalizeHiddenIds(canvasIds)]) {
    if (seen.has(id))
      continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function __resetCanvasHiddenTabIdsForTest() {
  _canvasHiddenTabIds = [];
}
var _canvasHiddenTabIds;
var init_canvas_hidden = __esm(() => {
  _canvasHiddenTabIds = [];
});

// src/tabs/hidden-tabs.ts
var exports_hidden_tabs = {};
__export(exports_hidden_tabs, {
  syncHiddenTabsFromHost: () => syncHiddenTabsFromHost,
  setCanvasHiddenTabIds: () => setCanvasHiddenTabIds,
  scheduleSyncHiddenTabsFromHost: () => scheduleSyncHiddenTabsFromHost,
  resolveHiddenTabIdsForDraft: () => resolveHiddenTabIdsForDraft,
  mergeHiddenTabIdLists: () => mergeHiddenTabIdLists,
  isTabIdHidden: () => isTabIdHidden,
  hydrateCanvasHiddenFromLayout: () => hydrateCanvasHiddenFromLayout,
  healHiddenTabIds: () => healHiddenTabIds,
  getCanvasHiddenTabIds: () => getCanvasHiddenTabIds,
  collectLiveTabIdsForHiddenHeal: () => collectLiveTabIdsForHiddenHeal,
  __resetCanvasHiddenTabIdsForTest: () => __resetCanvasHiddenTabIdsForTest
});
function collectLiveTabIdsForHiddenHeal() {
  const ids = new Set;
  for (const id of BUILTIN_TAB_IDS)
    ids.add(id);
  for (const t3 of getDrawerTabs()) {
    if (t3?.id)
      ids.add(t3.id);
  }
  try {
    const list = getSecondaryTabList();
    if (list) {
      for (const btn of Array.from(list.querySelectorAll("button[data-tab-id]"))) {
        const tid = btn.getAttribute("data-tab-id");
        if (tid)
          ids.add(tid);
      }
    }
  } catch {}
  if (typeof document !== "undefined") {
    for (const btn of Array.from(document.querySelectorAll('.sidebar button[data-tab-id], [class*="tabList"] button[data-tab-id]'))) {
      const tid = btn.getAttribute("data-tab-id");
      if (tid)
        ids.add(tid);
    }
  }
  return [...ids];
}
function scheduleSyncHiddenTabsFromHost(opts) {
  const delayMs = opts?.delayMs ?? 50;
  if (_debouncedSyncTimer !== null)
    clearTimeout(_debouncedSyncTimer);
  _debouncedSyncTimer = setTimeout(() => {
    _debouncedSyncTimer = null;
    try {
      syncHiddenTabsFromHost({ writeBack: opts?.writeBack !== false });
    } catch {}
  }, delayMs);
}
function syncHiddenTabsFromHost(opts) {
  const writeBack = opts?.writeBack !== false;
  const host = getHostDrawerSettings();
  const hostStored = normalizeHiddenIds(host?.hiddenTabIds);
  const canvasStored = getCanvasHiddenTabIds();
  const stored = mergeHiddenTabIdLists(hostStored, canvasStored);
  const liveIds = collectLiveTabIdsForHiddenHeal();
  const forHost = healHiddenTabIds(stored, liveIds, { keepUnmatched: true });
  const forDom = healHiddenTabIds(stored, liveIds, { keepUnmatched: false });
  setCanvasHiddenTabIds(forHost);
  let wroteBack = false;
  if (writeBack && forHost.length > 0) {
    const hostSame = forHost.length === hostStored.length && forHost.every((id, i3) => id === hostStored[i3]);
    if (!hostSame) {
      wroteBack = patchHostDrawerSettings({ hiddenTabIds: forHost });
      if (wroteBack) {
        dlog("[hidden-tabs] healed hiddenTabIds write-back", {
          from: hostStored,
          to: forHost
        });
      } else {
        dlog("[hidden-tabs] host write-back NO-GO; Canvas layout copy retained", {
          hidden: forHost
        });
      }
    }
  }
  const applySet = new Set([...forDom, ...stored.filter((id) => liveIds.includes(id))]);
  applyHiddenTabIdsToSecondary(applySet);
  applyHiddenTabIdsToMirror(applySet);
  applyHiddenTabIdsToHostMain(applySet);
  return { hiddenIds: forHost, wroteBack };
}
function resolveHiddenTabIdsForDraft(storedHidden, liveCatalogIds) {
  const stored = normalizeHiddenIds(storedHidden);
  if (!stored.length)
    return [];
  return healHiddenTabIds(stored, liveCatalogIds, { keepUnmatched: true });
}
var _debouncedSyncTimer = null;
var init_hidden_tabs = __esm(() => {
  init_host_settings();
  init_store();
  init_configure_catalog();
  init_buttons();
  init_secondary();
  init_log();
  init_canvas_hidden();
  init_canvas_hidden();
});

// src/tabs/owned-commit.ts
function plannedMovesForCommit(model, desiredSide) {
  const moves = [];
  for (const [key, side] of desiredSide) {
    const current = sideOfKey(model, key);
    if (current && current !== side)
      moves.push({ key, to: side });
  }
  return moves;
}
function missingSecondaryButtonKeys(model, desiredSide, resolve, hasButton) {
  const missing = [];
  for (const [key, side] of desiredSide) {
    if (side !== "secondary")
      continue;
    if (sideOfKey(model, key) !== "secondary")
      continue;
    const liveId = resolve(key);
    if (liveId && !hasButton(liveId))
      missing.push({ key, to: "secondary" });
  }
  return missing;
}
async function commitDraftToOwnedModel(draft, activeAtGestureStart, opts) {
  const host = getHost();
  if (!host)
    return { ok: false, error: "Canvas tab model is not ready." };
  try {
    const commitBaseModel = getModel();
    const observedBeforeRebase = host.observe();
    await dispatchBatch([{ t: "syncFromHost", observed: host.observe() }]);
    const model = getModel();
    if (!model)
      return { ok: false, error: "Canvas tab model is not ready." };
    dlog("[owned-commit] rebased", {
      primary: model.primary,
      secondary: model.secondary
    });
    const keyFor = (id) => host.findKey(id);
    const primary = resolveKeys(draft.primaryIds, keyFor);
    const secondary = resolveKeys(draft.secondaryIds, keyFor);
    const hidden = new Set(resolveKeys([...draft.hiddenIds], keyFor));
    if (primary.length !== draft.primaryIds.length || secondary.length !== draft.secondaryIds.length) {
      dlog("[owned-commit] resolution failed — rolling back rebase", {
        expectedPrimary: draft.primaryIds.length,
        gotPrimary: primary.length,
        expectedSecondary: draft.secondaryIds.length,
        gotSecondary: secondary.length
      });
      await dispatchBatch([{ t: "syncFromHost", observed: observedBeforeRebase }]);
      return { ok: false, error: "A tab changed while Configure Tabs was open. Please retry." };
    }
    const intents = [];
    if (draft.drawerSide !== model.side) {
      dlog("[owned-commit] drawer side swap requested", {
        draftSide: draft.drawerSide,
        modelSide: model.side
      });
      intents.push({ t: "swapSides" });
    }
    const desiredSide = new Map;
    for (const key of primary)
      desiredSide.set(key, "primary");
    for (const key of secondary)
      desiredSide.set(key, "secondary");
    for (const [key, side] of desiredSide) {
      const current = sideOfKey(model, key);
      if (current && current !== side) {
        intents.push({
          t: "move",
          key,
          to: side,
          index: visibleKeys(model, side).length,
          activateDest: false
        });
      }
    }
    dlog("[owned-commit] reorder index context", {
      hiddenCount: hidden.size,
      hiddenKeys: [...hidden],
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      visiblePrimary: model.primary.filter((k3) => !hidden.has(k3)).length,
      visibleSecondary: model.secondary.filter((k3) => !hidden.has(k3)).length
    });
    for (const [side, keys] of [["primary", primary], ["secondary", secondary]]) {
      for (let index = 0;index < keys.length; index++) {
        const key = keys[index];
        intents.push({ t: "reorder", key, side, index });
      }
    }
    for (const key of [...model.primary, ...model.secondary]) {
      intents.push({ t: "setHidden", key, hidden: hidden.has(key) });
    }
    if (commitBaseModel) {
      const activeBeforeRebase = activeAtGestureStart ?? activeSelection(observedBeforeRebase);
      for (const source of ["primary", "secondary"]) {
        const active = activeBeforeRebase[source];
        if (!active || hidden.has(active))
          continue;
        const destination = desiredSide.get(active);
        if (destination === source) {
          intents.push({ t: "activate", key: active, side: source });
          continue;
        }
        if (destination) {
          const replacement = activeAfterRemoval(commitBaseModel, source, active);
          if (replacement && !hidden.has(replacement)) {
            intents.push({ t: "activate", key: replacement, side: source });
          }
          const destinationActive = activeBeforeRebase[destination];
          if (destinationActive && destinationActive !== active && !hidden.has(destinationActive)) {
            intents.push({ t: "activate", key: destinationActive, side: destination });
          }
        }
      }
    }
    dlog("[owned-commit] dispatching", {
      intents,
      primary,
      secondary
    });
    const plannedMoves = plannedMovesForCommit(commitBaseModel ?? model, desiredSide);
    if (typeof document !== "undefined") {
      try {
        const { cssEscape } = await Promise.resolve().then(() => (init_buttons(), exports_buttons));
        const { getSecondaryWrapper: getSecondaryWrapper2 } = await Promise.resolve().then(() => (init_secondary(), exports_secondary));
        const missing = missingSecondaryButtonKeys(model, desiredSide, (key) => host.resolve(key), (liveId) => {
          const content = getSecondaryWrapper2()?.querySelector(".sidebar-ux-panel-content");
          return !!content?.querySelector(`[data-canvas-moved="${cssEscape(liveId)}"]`);
        });
        if (missing.length > 0) {
          dlog("[owned-commit] placement pass: model-vs-DOM divergence healed", {
            missing: missing.map((m3) => m3.key)
          });
          plannedMoves.push(...missing);
        }
      } catch (err) {
        dwarn("[owned-commit] divergence heal failed:", err);
      }
    }
    const mirrorChrome = new Map;
    const secondaryChrome = new Map;
    if (!opts?.skipChrome) {
      for (const move of plannedMoves) {
        const liveId = host.resolve(move.key);
        if (!liveId)
          continue;
        if (move.to === "secondary") {
          mirrorChrome.set(move.key, await captureMainMirrorMoveChrome(liveId, "secondary"));
        } else {
          secondaryChrome.set(move.key, await captureSecondaryNeighborForMove(liveId));
        }
      }
    }
    await dispatchBatch(intents);
    const committed = getModel();
    dlog("[owned-commit] committed", {
      primary: committed?.primary,
      secondary: committed?.secondary
    });
    if (plannedMoves.length > 0 && typeof document !== "undefined") {
      try {
        const drawer = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
        drawer.setSuppressAutoActivation(true);
        let placed = 0;
        const failed = [];
        try {
          for (const move of plannedMoves) {
            const liveId = host.resolve(move.key);
            if (!liveId) {
              dlog("[owned-commit] placement pass: host.resolve returned null", {
                key: move.key,
                to: move.to
              });
              continue;
            }
            try {
              if (move.to === "secondary") {
                await drawer.assignToSecondary(liveId, {
                  openOnClosed: false,
                  setActiveWhenReady: false
                });
              } else {
                await drawer.unassignFromSecondary(liveId);
              }
              placed++;
            } catch (err) {
              failed.push(move.key);
              dwarn("[owned-commit] placement failed for", move.key, String(err));
            }
          }
        } finally {
          drawer.setSuppressAutoActivation(false);
        }
        dlog("[owned-commit] placement pass", {
          moves: plannedMoves.length,
          placed,
          failed,
          toSecondary: plannedMoves.filter((m3) => m3.to === "secondary").map((m3) => m3.key),
          toPrimary: plannedMoves.filter((m3) => m3.to === "primary").map((m3) => m3.key)
        });
        const modelAfter = getModel();
        if (modelAfter && modelAfter.secondary.length > 0) {
          const { reorderSecondaryTabButtons, secondaryTabButtonsReady } = await Promise.resolve().then(() => (init_buttons(), exports_buttons));
          const ids = modelAfter.secondary.map((k3) => host.resolve(k3)).filter((id) => !!id);
          if (secondaryTabButtonsReady(ids))
            reorderSecondaryTabButtons(ids);
        }
      } catch (err) {
        dwarn("[owned-commit] placement pass failed:", err);
      }
    }
    if (!opts?.skipChrome) {
      for (const move of plannedMoves) {
        const liveId = host.resolve(move.key);
        if (!liveId)
          continue;
        try {
          if (move.to === "secondary") {
            await applyMainMirrorMoveChrome(mirrorChrome.get(move.key) ?? { neighborBtn: null, reassertId: null }, liveId);
          } else {
            await applySecondaryNeighborHandoff(secondaryChrome.get(move.key) ?? { neighborBtn: null }, liveId);
          }
        } catch (err) {
          dwarn("[owned-commit] chrome handoff failed for", move.key, String(err));
        }
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
function resolveKeys(ids, resolve) {
  const keys = [];
  for (const id of ids) {
    const key = resolve(id);
    if (key)
      keys.push(key);
  }
  return keys;
}
function activeSelection(world) {
  return {
    primary: world.tabs.find((tab) => tab.location === "primary" && tab.isActiveInPrimary)?.key ?? null,
    secondary: world.tabs.find((tab) => tab.location === "secondary" && tab.isActiveInSecondary)?.key ?? null
  };
}
var init_owned_commit = __esm(() => {
  init_dispatch();
  init_log();
});

// src/tabs/live-tab-order.ts
function readVisibleTabIdsFromList(list) {
  if (!list)
    return [];
  const out = [];
  for (const el of Array.from(list.querySelectorAll('button[data-tab-id], button.sidebar-ux-main-tab-mirror-btn, button[class*="tabBtnExtension"]'))) {
    if (isSettingsButton(el))
      continue;
    if (el.style?.display === "none")
      continue;
    const hasAttr = el.getAttribute("data-tab-id") !== null;
    const id = buttonTabId(el);
    if (id) {
      if (!hasAttr && !_titleResolvedLogged.has(id)) {
        _titleResolvedLogged.add(id);
        dlog("[live-order] no data-tab-id button counted via title fallback", {
          id,
          title: el.getAttribute("title") || el.getAttribute("aria-label") || null,
          cls: String(el.className || ""),
          parentCls: el.parentElement ? String(el.parentElement.className || "") : null
        });
      }
      out.push(id);
    }
  }
  return out;
}
function readLivePrimaryTabIds() {
  const mirrorMain = document.querySelector(".sidebar-ux-main-tab-list-mirror .sidebar-ux-tab-list-main");
  if (mirrorMain)
    return readVisibleTabIdsFromList(mirrorMain);
  const sidebar = getMainSidebar();
  if (!sidebar)
    return [];
  const tabList = sidebar.querySelector('[class*="tabListWrap"] > [class*="tabList"]') || sidebar.querySelector('[class*="tabList"]');
  return readVisibleTabIdsFromList(tabList);
}
function readLiveSecondaryTabIds() {
  return readVisibleTabIdsFromList(getSecondaryTabList());
}
var _titleResolvedLogged;
var init_live_tab_order = __esm(() => {
  init_buttons();
  init_secondary();
  init_log();
  _titleResolvedLogged = new Set;
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

// src/persist/layout-load.ts
function isLoadInProgress() {
  return _loadInProgress;
}
function cancelLoadSavedLayout(options) {
  if (_loadCancel) {
    Promise.resolve().then(() => (init_persist_debug(), exports_persist_debug)).then(({ logPersistLoad: logPersistLoad2 }) => {
      logPersistLoad2("cancel", {
        reason: options?.preserveGuard ? "preserve-guard" : "cancel",
        loadInProgress: _loadInProgress
      });
    });
    _loadCancel();
  }
  _loadCancel = null;
  if (!options?.preserveGuard)
    _loadInProgress = false;
}
function cancelLayoutSave() {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
}
function flushPendingSaves() {
  if (!isLayoutRepoArmed()) {
    logPersistSave("flush", null, { skipped: "not-armed", loadInProgress: _loadInProgress });
    return;
  }
  if (_loadInProgress) {
    logPersistSave("flush", null, { skipped: "load-in-progress", loadInProgress: true });
    return;
  }
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer);
    _saveLayoutTimer = null;
  }
  cancelSettingsSave();
  syncPersistDebugToBackend((msg) => getBackendCtx()?.sendToBackend(msg));
  logPersistSave("flush", null, { loadInProgress: _loadInProgress });
  const layout = buildPersistedLayout();
  setLastLoadedLayout(layout);
}
var _loadInProgress = false, _loadCancel = null, _saveLayoutTimer = null;
var init_layout_load = __esm(() => {
  init_state();
  init_layout_repo();
  init_persist_debug();
  init_snapshot();
});

// src/layout/mode-profiles.ts
function buildSingleLayoutFromLiveHost() {
  try {
    const settings = getHostDrawerSettings() ?? {};
    const mainOpen = isMainDrawerOpen();
    let mainActiveTabId = null;
    if (mainOpen) {
      const active = getActiveTabId();
      if (active.state === "active")
        mainActiveTabId = active.id;
    }
    return {
      version: CANVAS_VERSION,
      primary: {
        open: mainOpen,
        width: readPrimaryWidthFallback(),
        tabId: mainActiveTabId ?? undefined
      },
      secondary: { open: false, width: 420, activeTabId: undefined },
      detachedTabs: [],
      tabOrder: Array.isArray(settings.tabOrder) ? settings.tabOrder.slice() : [],
      hiddenTabIds: Array.isArray(settings.hiddenTabIds) ? settings.hiddenTabIds.slice() : [],
      drawerSide: settings.side || getMainDrawerSide()
    };
  } catch {
    return {
      version: CANVAS_VERSION,
      primary: { open: false, width: 420, tabId: undefined },
      secondary: { open: false, width: 420, activeTabId: undefined },
      detachedTabs: [],
      tabOrder: [],
      hiddenTabIds: [],
      drawerSide: "left"
    };
  }
}
async function restoreSingleModeLayout(slot, host) {
  try {
    bootstrapFromLayout(slot, host, CANVAS_VERSION);
    await flush();
  } catch (err) {
    return { ok: false, reason: `bootstrap: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const open = !!slot.primary?.open;
    let tabId = slot.primary?.tabId ?? null;
    if (tabId && !isTabKnownAndVisible(tabId))
      tabId = pickSafeFallbackTabId();
    if (open && !tabId)
      tabId = pickSafeFallbackTabId();
    restoreMainDrawerFromDom(open, tabId, undefined, {
      restoreOpen: true,
      restoreWidth: true
    });
  } catch (err) {
    return { ok: false, reason: `main drawer: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}
function readPrimaryWidthFallback() {
  if (typeof document === "undefined")
    return 420;
  try {
    const w3 = getMainDrawerWidth();
    return w3 > 0 ? w3 : 420;
  } catch {
    return 420;
  }
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
var init_mode_profiles = __esm(() => {
  init_host_settings();
  init_store();
  init_active_tab();
  init_dispatch();
  init_main_persist();
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
  const dualSnapshot = snapshotOwnedModelLayout();
  if (dualSnapshot) {
    setDualLayoutSlot(dualSnapshot);
    dlog("[second-drawer-mode] saved dual layout slot:", {
      tabs: dualSnapshot.detachedTabs?.length ?? 0
    });
  }
  let singleLayout = getSingleLayoutSlot();
  if (!singleLayout) {
    try {
      singleLayout = buildSingleLayoutFromLiveHost();
      dlog("[second-drawer-mode] single layout built from live host (no slot)");
    } catch (err) {
      dwarn("[second-drawer-mode] single layout fallback build failed:", err);
      singleLayout = null;
    }
  }
  setSettings({ secondSidebarEnabled: false });
  const host = getHost();
  if (singleLayout && host) {
    try {
      dlog("[second-drawer-mode] restoring single layout into owned model", {
        tabOrder: Array.isArray(singleLayout.tabOrder) ? singleLayout.tabOrder.length : 0
      });
      const result = await restoreSingleModeLayout(singleLayout, host);
      if (!result.ok) {
        dwarn(`[second-drawer-mode] single-layout restore partial: ${result.reason ?? "unknown"}`);
      }
    } catch (err) {
      dwarn("[second-drawer-mode] single-layout restore failed:", err);
    }
  }
  resetSideRemountStateAfterDisable();
  try {
    const mp = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
    mp.reconcileMainTabListPin();
  } catch (err) {
    dwarn("[second-drawer-mode] reconcileMainTabListPin after disable failed:", err);
  }
  try {
    const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
    if (m3.isConfigureTabsModalOpen()) {
      m3.refreshConfigureDraftFromLive();
    }
  } catch {}
  const afterModel = getModel();
  dlog("[second-drawer-mode] single mode active", {
    secondSidebarEnabled: false,
    modelPrimary: afterModel?.primary.length ?? 0,
    modelSecondary: afterModel?.secondary.length ?? 0,
    modelSide: afterModel?.side ?? null
  });
}
async function requestSecondDrawerMode(next) {
  if (next) {
    if (getSettings().secondSidebarEnabled)
      return;
    const switchDualSlot = getDualLayoutSlot();
    const switchSingleSlot = getSingleLayoutSlot();
    dlog("[second-drawer-mode] switching to dual", {
      singleSlotTabs: Array.isArray(switchSingleSlot?.tabOrder) ? switchSingleSlot.tabOrder.length : 0,
      dualSlotTabs: Array.isArray(switchDualSlot?.detachedTabs) ? switchDualSlot.detachedTabs.length : 0,
      modelSecondary: getModel()?.secondary.length ?? 0
    });
    const singleSnapshot = snapshotOwnedModelLayout();
    const modelNow = getModel();
    if (singleSnapshot && (!modelNow || modelNow.secondary.length === 0)) {
      setSingleLayoutSlot(singleSnapshot);
      dlog("[second-drawer-mode] saved single layout slot:", {
        primary: singleSnapshot.tabOrder?.length ?? 0
      });
    }
    const layoutBefore = getLastLoadedLayout();
    const dualSlotBefore = getDualLayoutSlot();
    if (!hasDetachedTabs(layoutBefore) && !hasDetachedTabs(dualSlotBefore)) {
      dlog("[second-drawer-mode] first enable — seeding dual layout from live");
      seedDualLayoutFromLive();
    }
    setSettings({ secondSidebarEnabled: true });
    cancelSettingsSave();
    cancelLayoutSave();
    const host = getHost();
    const dualSlot = getDualLayoutSlot();
    const restoreSource = [dualSlot].find((l3) => l3 && Array.isArray(l3.detachedTabs) && l3.detachedTabs.length > 0);
    if (restoreSource && host) {
      dlog("[second-drawer-mode] owned-model restore for re-enable:", {
        tabs: restoreSource.detachedTabs.length,
        source: "dual-slot"
      });
      const result = await restoreSingleModeLayout(restoreSource, host);
      if (!result.ok) {
        dwarn(`[second-drawer-mode] dual-layout restore partial: ${result.reason ?? "unknown"}`);
      }
    }
    persistSettings();
    try {
      const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
      if (m3.isConfigureTabsModalOpen()) {
        try {
          await m3.flushConfigureCommits();
        } catch {}
        m3.refreshConfigureDraftFromLive();
      }
    } catch {}
    const afterModel = getModel();
    dlog("[second-drawer-mode] dual mode active", {
      secondSidebarEnabled: true,
      modelPrimary: afterModel?.primary.length ?? 0,
      modelSecondary: afterModel?.secondary.length ?? 0,
      modelSide: afterModel?.side ?? null
    });
  } else {
    if (!getSettings().secondSidebarEnabled)
      return;
    const switchSingleSlot = getSingleLayoutSlot();
    const switchDualSlot = getDualLayoutSlot();
    dlog("[second-drawer-mode] switching to single", {
      singleSlotTabs: Array.isArray(switchSingleSlot?.tabOrder) ? switchSingleSlot.tabOrder.length : 0,
      dualSlotTabs: Array.isArray(switchDualSlot?.detachedTabs) ? switchDualSlot.detachedTabs.length : 0,
      modelSecondary: getModel()?.secondary.length ?? 0
    });
    let userChoice = "clean";
    try {
      const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
      if (m3.isConfigureTabsModalOpen()) {
        try {
          await m3.flushConfigureCommits();
        } catch (err) {
          dwarn("[second-drawer-mode] flushConfigureCommits failed:", err);
        }
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
          const result = await commitDraftToOwnedModel(draft);
          if (!result.ok) {
            dwarn("[second-drawer-mode] commit failed on mode switch:", result.error);
            return;
          }
        }
      } catch (err) {
        dwarn("[second-drawer-mode] error applying draft on mode switch:", err);
        return;
      }
    } else if (userChoice === "discard") {}
    await finishDisable();
  }
}
var HOST_ID = "canvas-mode-switch-dialog", STYLE_ID2 = "canvas-mode-switch-dialog-styles", _dialogHost = null, _dialogKeydown = null;
var init_second_drawer_mode = __esm(() => {
  init_state();
  init_layout_load();
  init_snapshot();
  init_dispatch();
  init_owned_commit();
  init_mode_profiles();
  init_drawer_sync();
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
  flushConfigureCommits: () => flushConfigureCommits,
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
    /* Drop settle: floating clone eases into its destination row slot (matches live tab-list DnD). */
    .canvas-configure-tabs-overlay-clone.canvas-configure-tabs-overlay-settling {
      transition:
        left ${SETTLE_DURATION_MS}ms cubic-bezier(0.25, 1, 0.5, 1),
        top ${SETTLE_DURATION_MS}ms cubic-bezier(0.25, 1, 0.5, 1),
        box-shadow ${SETTLE_DURATION_MS}ms ease,
        opacity ${SETTLE_DURATION_MS}ms ease !important;
      box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.35);
      cursor: default;
    }

    /* ── Row card (host .row) ── */
    /* Non-core (hideable) tabs use host hover surface; core keeps .row-locked tint. */
    .canvas-configure-tabs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg, #1a1a2e));
      touch-action: manipulation;
      user-select: none;
    }
    .canvas-configure-tabs-row.row-locked {
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 6%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
    }
    /* Hidden (disabled) tabs: no card fill — blend into the dialog so the
       row reads as absent; dimming keeps the disabled cue. Core rows are
       never hidden, so .row-locked keeps its tinted background. */
    .canvas-configure-tabs-row.row-hidden {
      background: transparent;
      opacity: 0.6;
    }
    /* Invisible slot holder while the floating clone is the visible row
       (matches live tab-list DnD placeholder). Overlay uses its own className
       so cloneNode + class replace never inherits opacity:0. */
    .canvas-configure-tabs-row.row-dragging {
      opacity: 0 !important;
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
function detachDragListeners() {
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
}
function cancelOverlaySettle() {
  if (_settleTimer !== null) {
    clearTimeout(_settleTimer);
    _settleTimer = null;
  }
  if (_dragOverlay) {
    _dragOverlay.classList.remove("canvas-configure-tabs-overlay-settling");
  }
  _settling = false;
}
function resolveConfigureSettleDestination(tabId) {
  if (!tabId)
    return null;
  for (const el of document.querySelectorAll(".canvas-configure-tabs-row")) {
    if (el.getAttribute("data-tab-id") === tabId) {
      const r3 = el.getBoundingClientRect();
      return { left: r3.left, top: r3.top };
    }
  }
  return null;
}
function animateOverlaySettle(destLeft, destTop) {
  const overlay = _dragOverlay;
  if (!overlay)
    return Promise.resolve();
  const curLeft = parseFloat(overlay.style.left) || 0;
  const curTop = parseFloat(overlay.style.top) || 0;
  const dx = destLeft - curLeft;
  const dy = destTop - curTop;
  if (Math.hypot(dx, dy) < SETTLE_MIN_DISTANCE_PX) {
    overlay.style.left = `${destLeft}px`;
    overlay.style.top = `${destTop}px`;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done)
        return;
      done = true;
      overlay.removeEventListener("transitionend", onEnd);
      if (_settleTimer !== null) {
        clearTimeout(_settleTimer);
        _settleTimer = null;
      }
      resolve();
    };
    const onEnd = (e3) => {
      if (e3.target !== overlay)
        return;
      if (e3.propertyName && e3.propertyName !== "left" && e3.propertyName !== "top")
        return;
      finish();
    };
    _settling = true;
    overlay.addEventListener("transitionend", onEnd);
    overlay.classList.add("canvas-configure-tabs-overlay-settling");
    overlay.offsetWidth;
    overlay.style.left = `${destLeft}px`;
    overlay.style.top = `${destTop}px`;
    _settleTimer = setTimeout(finish, SETTLE_DURATION_MS + 40);
  });
}
function cloneConfigureDraft(d3) {
  return {
    drawerSide: d3.drawerSide,
    primaryIds: [...d3.primaryIds],
    secondaryIds: [...d3.secondaryIds],
    builtinOrder: [...d3.builtinOrder],
    extensionOrder: [...d3.extensionOrder],
    hiddenIds: new Set(d3.hiddenIds)
  };
}
function clearDragState() {
  cancelOverlaySettle();
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
  detachDragListeners();
  _dragActive = false;
  _lastDropTarget = null;
  _flipRects = null;
  _dragTabId = null;
  _dragFromSide = null;
  _dragDraftSnapshot = null;
  _settling = false;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
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
function cancelDrag(opts) {
  const revert = opts?.revertDraft === true && !_settling && _dragDraftSnapshot;
  if (revert && _dragDraftSnapshot) {
    _draftRef = cloneConfigureDraft(_dragDraftSnapshot);
  }
  clearDragState();
  if (revert && _draftRef) {
    renderModal(_draftRef, _catalogRef, null, false);
  }
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
    const draftToCommit = _draftRef;
    const baseToCommit = _baseSnapshotRef;
    const epochAtStart = _baseEpoch;
    const result = await commitDraftToOwnedModel(draftToCommit);
    if (result.ok) {
      const rebased = rebaseBaseIfEpochUnchanged(draftToCommit, epochAtStart, _baseEpoch);
      if (rebased) {
        _baseSnapshotRef = rebased;
      }
      if (_draftRef === draftToCommit) {
        renderModal(draftToCommit, _catalogRef, null, false);
      }
    } else {
      if (_draftRef === draftToCommit) {
        renderModal(draftToCommit, _catalogRef, result.error, false);
      }
    }
    return result;
  })();
  _commitPromise = myWork.then((r3) => r3).catch(() => ({ ok: false, error: "auto-commit failed" }));
  await myWork;
}
async function flushConfigureCommits() {
  await autoCommit();
  await autoCommit();
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
          cancelDrag({ revertDraft: !_settling });
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
    if (_settling)
      return;
    e3.preventDefault();
    _dragTabId = tabId;
    _dragFromSide = side;
    _dragActive = false;
    _dragStartX = e3.clientX;
    _dragStartY = e3.clientY;
    _lastDropTarget = null;
    _dragDraftSnapshot = _draftRef ? cloneConfigureDraft(_draftRef) : null;
    const onMove = (ev) => {
      if (_settling)
        return;
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
    const onUp = async (_ev) => {
      detachDragListeners();
      _dragDraftSnapshot = null;
      try {
        if (_dragActive && _dragOverlay && _dragTabId) {
          const dest = resolveConfigureSettleDestination(_dragTabId);
          if (dest) {
            await animateOverlaySettle(dest.left, dest.top);
          }
        }
      } finally {
        clearDragState();
        autoCommit();
      }
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
    const isHidden3 = draft.hiddenIds.has(tab.id);
    const isLocked = tab.hideLocked;
    const isCore = tab.kind === "builtin" && tab.hideLocked;
    const description = tab.description || "";
    return /* @__PURE__ */ u3("div", {
      class: `canvas-configure-tabs-row${isHidden3 ? " row-hidden" : ""}${isLocked ? " row-locked" : ""}`,
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
          class: `canvas-configure-tabs-toggle${!isHidden3 ? " toggle-on" : ""}`,
          disabled: isLocked,
          title: isLocked ? "Cannot hide this tab" : isHidden3 ? "Show tab" : "Hide tab",
          onClick: (e3) => {
            e3.stopPropagation();
            onToggleHide(tab.id, !isHidden3);
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
  const catalog = filterCatalogToLive(getFullCatalog(), getHost(), new Set(getLiveIdAssignments().keys()));
  const hostSettings = getHostDrawerSettings();
  const currentAssignments = new Map(getLiveIdAssignments());
  const hostSide = hostSettings?.side;
  const drawerSide = hostSide || getMainDrawerSide();
  const sideSource = hostSide ? "host-settings" : "dom";
  const healedHidden = resolveHiddenTabIdsForDraft(mergeHiddenTabIdLists(hostSettings?.hiddenTabIds, getCanvasHiddenTabIds()), catalog.map((t3) => t3.id));
  const draftFromHost = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: healedHidden,
    drawerSide,
    assignments: currentAssignments
  });
  const draft = alignDraftToLiveVisibleOrder(draftFromHost, readLivePrimaryTabIds(), readLiveSecondaryTabIds());
  const base = baseSnapshotFromDraft(draft);
  dlog("[configure-modal] draft from live", {
    side: draft.drawerSide,
    sideSource,
    primary: draft.primaryIds.length,
    secondary: draft.secondaryIds.length,
    hidden: draft.hiddenIds.size,
    secondDrawerEnabled: getSettings().secondSidebarEnabled
  });
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
  _baseEpoch++;
  dlog("[configure-modal] open (draft built from live)");
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
  _baseEpoch++;
  dlog("[configure-modal] refresh from live (draft rebuilt)");
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
      const before = _draftRef.drawerSide;
      const next = swapDrawerSide(_draftRef);
      _draftRef = next;
      dlog("[configure-modal] swap drawer locations", {
        draftSideBefore: before,
        draftSideAfter: next.drawerSide,
        modelSide: getModel()?.side ?? null,
        visibleSide: getMainDrawerSide()
      });
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
      const target = !getSettings().secondSidebarEnabled;
      dlog("[configure-modal] enable second drawer toggle", {
        target,
        current: getSettings().secondSidebarEnabled
      });
      Promise.resolve().then(() => (init_second_drawer_mode(), exports_second_drawer_mode)).then((m3) => {
        m3.requestSecondDrawerMode(target);
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
      renderModal(_draftRef, catalog, null, true);
      try {
        await flushConfigureCommits();
      } catch (err) {
        dwarn("[configure-modal] Done flush failed:", err);
      }
      if (!_draftRef || !_baseSnapshotRef)
        return;
      if (isDraftDirty(_draftRef, _baseSnapshotRef)) {
        const result = await commitDraftToOwnedModel(_draftRef);
        if (!result.ok) {
          renderModal(_draftRef, catalog, result.error, false);
          return;
        }
        _baseSnapshotRef = baseSnapshotFromDraft(_draftRef);
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
var _modalContainer = null, _draftRef = null, _baseSnapshotRef = null, _baseEpoch = 0, _dragTabId = null, _dragFromSide = null, _dragActive = false, _dragOverlay = null, _dragOffsetX = 0, _dragOffsetY = 0, _dragStartX = 0, _dragStartY = 0, _lastDropTarget = null, _flipRects = null, _dragMoveHandler = null, _dragUpHandler = null, _settleTimer = null, _settling = false, _commitPromise = null, _dragDraftSnapshot = null, SETTLE_DURATION_MS = 140, SETTLE_MIN_DISTANCE_PX = 2, BUILTIN_ICON_SVGS, MODAL_STYLE_ID = "canvas-configure-tabs-styles", _catalogRef;
var init_configure_modal = __esm(() => {
  init_preact_module();
  init_hooks_module();
  init_configure_model();
  init_configure_catalog();
  init_canvas_hidden();
  init_hidden_tabs();
  init_host_settings();
  init_store();
  init_assignment();
  init_owned_commit();
  init_dispatch();
  init_live_tab_order();
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
  const moveTarget = onSecondary ? "primary" : "secondary";
  const canShowMove = moveTarget === "primary" || secondEnabled;
  if (!_contextMenu) {
    _contextMenu = createAssignmentContextMenu();
    document.body.appendChild(_contextMenu);
  }
  _contextMenu.innerHTML = "";
  const showLabels = isShowTabLabels();
  const toggleLabel = showLabels ? "Hide tab labels" : "Show tab labels";
  const toggleItem = createAssignmentContextMenuItem(toggleLabel, () => {
    const next = !showLabels;
    const ok = patchHostDrawerSettings({ showTabLabels: next });
    syncSecondaryTabLabels(next);
    if (ok) {
      requestAnimationFrame(() => syncSecondaryTabLabels(next));
    }
  }, { danger: showLabels });
  _contextMenu.appendChild(toggleItem);
  const configureItem = createAssignmentContextMenuItem("Configure tabs", () => {
    Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal)).then((m3) => m3.openConfigureTabsModal()).catch((err) => console.warn("[tab-context-menu] configure modal load failed:", err));
  });
  _contextMenu.appendChild(configureItem);
  if (canShowMove) {
    const divider = createDivider();
    _contextMenu.appendChild(divider);
    const moveItem = createAssignmentContextMenuItem(moveLabel, () => {
      dlog(`[tabmove] secondary context-menu CLICK: tabId="${tabId}" target=${moveTarget} label="${moveLabel}"`);
      placementFirstMoveByLiveId(tabId, moveTarget).catch((err) => {
        console.warn("[tabmove] secondary context-menu placement-first move failed:", err);
        dispatchMoveByLiveId(tabId, false).catch((err2) => {
          console.warn("[tabmove] secondary context-menu dispatchMoveByLiveId fallback also failed:", err2);
        });
      });
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
  init_dispatch();
  init_state();
  init_log();
  init_drawer_sync();
  init_host_settings();
});

// src/tabs/buttons.ts
var exports_buttons = {};
__export(exports_buttons, {
  updateDrawerTabVisibility: () => updateDrawerTabVisibility,
  showSecondaryTab: () => showSecondaryTab,
  showMainTabButton: () => showMainTabButton,
  secondaryTabButtonsReady: () => secondaryTabButtonsReady,
  reorderSecondaryTabButtons: () => reorderSecondaryTabButtons,
  reorderMainMirrorTabButtons: () => reorderMainMirrorTabButtons,
  reorderHostMainTabButtons: () => reorderHostMainTabButtons,
  removeSecondaryTabButton: () => removeSecondaryTabButton,
  readMainButtonShortName: () => readMainButtonShortName,
  isSettingsButton: () => isSettingsButton,
  hideMainTabButton: () => hideMainTabButton,
  findSafeFallbackButton: () => findSafeFallbackButton,
  findNeighborSecondaryButtonFor: () => findNeighborSecondaryButtonFor,
  findMainTabButton: () => findMainTabButton,
  deriveShortName: () => deriveShortName,
  cssEscape: () => cssEscape2,
  clearSecondaryTabButtonActive: () => clearSecondaryTabButtonActive,
  buttonTabId: () => buttonTabId,
  applyHiddenTabIdsToSecondary: () => applyHiddenTabIdsToSecondary,
  applyHiddenTabIdsToMirror: () => applyHiddenTabIdsToMirror,
  applyHiddenTabIdsToHostMain: () => applyHiddenTabIdsToHostMain,
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
    if (!byTitle.getAttribute("data-tab-id")) {
      byTitle.setAttribute("data-tab-id", tabId);
    }
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
function buttonTabId(btn) {
  const existing = btn.getAttribute("data-tab-id");
  if (existing)
    return existing;
  const title = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
  if (!title)
    return null;
  const tabs = getDrawerTabs();
  if (tabs && tabs.length > 0) {
    const tab = tabs.find((t3) => t3.title === title);
    if (tab) {
      if (!_buttonTabIdLogged.has(title)) {
        _buttonTabIdLogged.add(title);
        dlog("[buttonTabId] title fallback → store id", {
          title,
          id: tab.id,
          kind: tab.extensionId ? "extension" : "builtin"
        });
      }
      return tab.id;
    }
  }
  if (!_buttonTabIdLogged.has(title)) {
    _buttonTabIdLogged.add(title);
    dlog("[buttonTabId] title fallback → title-as-id (no store match)", {
      title,
      storeTabs: (tabs || []).map((t3) => t3.title)
    });
  }
  return title;
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
function isOwnedSecondaryTabButton(el) {
  const h4 = el;
  if (h4.classList?.contains?.("sidebar-ux-main-tab-mirror-btn"))
    return false;
  if (typeof h4.closest === "function" && h4.closest(".sidebar-ux-main-tab-list-mirror")) {
    return false;
  }
  return true;
}
function addSecondaryTabButton(tab) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  const _bareId = tab.id.includes(":") ? tab.id.replace(/:\d+$/, "").split(":").pop() ?? tab.id : tab.id;
  const idSels = [`[data-tab-id="${CSS.escape(tab.id)}"]`];
  if (_bareId !== tab.id) {
    idSels.push(`[data-tab-id="${CSS.escape(_bareId)}"]`);
  }
  const seen = new Set;
  let hasRealSecondary = false;
  let insertBefore = null;
  for (const sel of idSels) {
    for (const el of Array.from(tabList.querySelectorAll(sel))) {
      if (seen.has(el))
        continue;
      seen.add(el);
      if (isOwnedSecondaryTabButton(el)) {
        hasRealSecondary = true;
      } else {
        if (insertBefore == null)
          insertBefore = el.nextSibling;
        el.remove();
      }
    }
  }
  if (hasRealSecondary)
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
  labelSpan.style.cssText = showLabels ? `opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease` : `display:none;visibility:hidden;opacity:0;height:0;min-height:0;margin-top:0;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease`;
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
  const effectiveHidden = mergeHiddenTabIdLists(getHostDrawerSettings()?.hiddenTabIds, getCanvasHiddenTabIds());
  if (effectiveHidden.length > 0) {
    const liveOnStrip = [];
    for (const el of Array.from(tabList.querySelectorAll("button[data-tab-id]"))) {
      const tid = el.getAttribute("data-tab-id");
      if (tid)
        liveOnStrip.push(tid);
    }
    liveOnStrip.push(tab.id);
    if (isTabIdHidden(tab.id, effectiveHidden, liveOnStrip)) {
      btn.style.display = "none";
    }
  }
  if (insertBefore && insertBefore.parentNode === tabList) {
    tabList.insertBefore(btn, insertBefore);
  } else {
    tabList.appendChild(btn);
  }
  Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
}
function removeSecondaryTabButton(tabId) {
  const btn = getSecondaryTabList()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`) ?? getSecondaryWrapper()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`);
  btn?.remove();
  Promise.resolve().then(() => (init_tab_position(), exports_tab_position)).then((m3) => m3.reconcileTabListPin());
}
function findNeighborSecondaryButtonFor(tabId) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return null;
  const buttons = Array.from(tabList.querySelectorAll("button[data-tab-id]"));
  const idx = buttons.findIndex((b2) => b2.getAttribute("data-tab-id") === tabId);
  if (idx === -1)
    return null;
  for (let i3 = idx - 1;i3 >= 0; i3--) {
    if (isSettingsButton(buttons[i3]))
      continue;
    if (buttons[i3].style?.display === "none")
      continue;
    return buttons[i3];
  }
  for (let i3 = idx + 1;i3 < buttons.length; i3++) {
    if (isSettingsButton(buttons[i3]))
      continue;
    if (buttons[i3].style?.display === "none")
      continue;
    return buttons[i3];
  }
  return null;
}
function secondaryTabButtonsReady(ids) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return false;
  for (const id of ids) {
    if (!tabList.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)) {
      return false;
    }
  }
  return true;
}
function reorderSecondaryTabButtons(ids) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  const desired = ids.filter((id) => tabList.querySelector(`[data-tab-id="${CSS.escape(id)}"]`));
  const current = Array.from(tabList.querySelectorAll("[data-tab-id]")).map((btn) => btn.getAttribute("data-tab-id"));
  if (desired.length === current.length && desired.every((id, i3) => id === current[i3]))
    return;
  for (const id of desired) {
    const btn = tabList.querySelector(`[data-tab-id="${CSS.escape(id)}"]`);
    if (btn) {
      tabList.appendChild(btn);
    }
  }
}
function reorderMainMirrorTabButtons(ids) {
  const main = document.querySelector(".sidebar-ux-main-tab-list-mirror .sidebar-ux-tab-list-main");
  if (!main)
    return;
  for (const id of ids) {
    const btn = Array.from(main.querySelectorAll(":scope > button.sidebar-ux-main-tab-mirror-btn, :scope > button[data-tab-id]")).find((b2) => buttonTabId(b2) === id);
    if (btn && btn.parentElement === main) {
      main.appendChild(btn);
    }
  }
}
function reorderHostMainTabButtons(ids) {
  const sidebar = getMainSidebar();
  if (!sidebar)
    return;
  const tabList = sidebar.querySelector('[class*="tabListWrap"] > [class*="tabList"]') || sidebar.querySelector('[class*="tabList"]');
  if (!tabList)
    return;
  for (const id of ids) {
    const btn = Array.from(tabList.querySelectorAll(":scope > button")).find((b2) => buttonTabId(b2) === id);
    if (btn && btn.parentElement === tabList) {
      tabList.appendChild(btn);
    }
  }
}
function applyHiddenTabIdsToSecondary(hiddenIds) {
  const tabList = getSecondaryTabList();
  if (!tabList)
    return;
  const buttons = Array.from(tabList.querySelectorAll("button[data-tab-id]"));
  const liveIds = buttons.map((b2) => b2.getAttribute("data-tab-id") || "").filter(Boolean);
  for (const btn of buttons) {
    const tid = btn.getAttribute("data-tab-id") || "";
    if (isTabIdHidden(tid, hiddenIds, liveIds)) {
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
    const buttons = Array.from(list.querySelectorAll("button[data-tab-id]"));
    const liveIds = buttons.map((b2) => b2.getAttribute("data-tab-id") || "").filter(Boolean);
    for (const btn of buttons) {
      const tid = btn.getAttribute("data-tab-id") || "";
      if (isTabIdHidden(tid, hiddenIds, liveIds)) {
        btn.style.display = "none";
      } else {
        btn.style.display = "";
      }
    }
  });
}
function applyHiddenTabIdsToHostMain(hiddenIds) {
  Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
    if (m3.getMainMirrorTabList())
      return;
    const sidebar = getMainSidebar();
    if (!sidebar)
      return;
    const tabList = sidebar.querySelector('[class*="tabListWrap"] > [class*="tabList"]') || sidebar.querySelector('[class*="tabList"]');
    if (!tabList)
      return;
    const buttons = Array.from(tabList.querySelectorAll("button[data-tab-id]"));
    const liveIds = buttons.map((b2) => b2.getAttribute("data-tab-id") || "").filter(Boolean);
    for (const btn of buttons) {
      const tid = btn.getAttribute("data-tab-id") || "";
      let assignedSide = null;
      try {
        assignedSide = getTabSidebar(tid);
      } catch {
        assignedSide = null;
      }
      if (assignedSide === "secondary")
        continue;
      if (isTabIdHidden(tid, hiddenIds, liveIds)) {
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
var _hideMainTabButtonOverride = null, _showMainTabButtonOverride = null, _buttonTabIdLogged;
var init_buttons = __esm(() => {
  init_host_settings();
  init_store();
  init_log();
  init_drawer_sync();
  init_secondary();
  init_state();
  init_assignment();
  init_tab_context_menu();
  init_canvas_hidden();
  _buttonTabIdLogged = new Set;
});

// src/sidebar/drawer-sync.ts
var exports_drawer_sync = {};
__export(exports_drawer_sync, {
  syncSecondaryTabLabels: () => syncSecondaryTabLabels,
  syncDrawerTabSettings: () => syncDrawerTabSettings,
  stopSideChangeWatcher: () => stopSideChangeWatcher,
  stopObserverCoordinator: () => stopObserverCoordinator,
  stopDrawerTabStyleObserver: () => stopDrawerTabStyleObserver,
  stopDrawerTabResizeWatcher: () => stopDrawerTabResizeWatcher,
  stopDrawerTabClassObserver: () => stopDrawerTabClassObserver,
  startSideChangeWatcher: () => startSideChangeWatcher,
  restoreSecondaryTabButtons: () => restoreSecondaryTabButtons,
  resetSideRemountStateAfterDisable: () => resetSideRemountStateAfterDisable,
  rebindSideChangeWatcherIfNeeded: () => rebindSideChangeWatcherIfNeeded,
  isShowTabLabels: () => isShowTabLabels,
  checkSideChanged: () => checkSideChanged,
  applyMainDrawerSideChange: () => applyMainDrawerSideChange,
  __setSideSettleHardMsForTest: () => __setSideSettleHardMsForTest,
  __setLastKnownSideForTest: () => __setLastKnownSideForTest,
  __resetSideApplyStateForTest: () => __resetSideApplyStateForTest,
  __resetDrawerTabSyncStateForTest: () => __resetDrawerTabSyncStateForTest,
  __getSideRemountGenForTest: () => __getSideRemountGenForTest,
  __getLastKnownSideForTest: () => __getLastKnownSideForTest
});

class ObserverCoordinator {
  pending = new Map;
  frame = null;
  _stopped = false;
  signal(kind, payload) {
    if (this._stopped)
      return;
    this.pending.set(kind, payload ?? null);
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this._stopped)
          return;
        const entries = [...this.pending];
        this.pending.clear();
        this.flush(entries);
      });
    }
  }
  stop() {
    this._stopped = true;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.pending.clear();
  }
  flush(entries) {
    const hasSideChange = entries.some(([kind]) => kind === "side");
    const hasLightSignals = entries.some(([kind]) => kind !== "side");
    if (hasSideChange) {
      checkSideChanged();
    }
    if (hasLightSignals) {
      _runSyncDrawerTabSettings();
    }
  }
}
function isShowTabLabels() {
  const host = getHostDrawerSettings();
  if (host && typeof host.showTabLabels === "boolean") {
    return host.showTabLabels;
  }
  const store = getStoreSnapshot();
  if (store) {
    const snapshot = asDrawerStore(store);
    if (snapshot.drawerSettings && typeof snapshot.drawerSettings.showTabLabels === "boolean") {
      return snapshot.drawerSettings.showTabLabels;
    }
  }
  const sidebar = getMainSidebar();
  if (sidebar) {
    return !!sidebar.querySelector('button[class*="tabBtnLabeled"]');
  }
  return true;
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
    _drawerTabRetryCount++;
    if (!_drawerTabRetryLogged) {
      _drawerTabRetryLogged = true;
      dlog("[drawer-sync] main drawer tab not found — bounded retry engaged", {
        retryMax: DRAWER_TAB_RETRY_MAX
      });
    }
    if (_drawerTabRetryCount < DRAWER_TAB_RETRY_MAX) {
      requestAnimationFrame(() => _runSyncDrawerTabSettings());
    }
    return;
  }
  _drawerTabRetryCount = 0;
  const w3 = mainDrawerTab.offsetWidth;
  const h4 = mainDrawerTab.offsetHeight;
  if (w3 < 16 || w3 > 120 || h4 < 16 || h4 > 400) {
    dlog(`[drawer-sync] main drawer tab dimensions look wrong (w=${w3} h=${h4}), skipping mirror`);
    return;
  }
  if (!_mainDrawerTabResizeObserver) {
    const coordinator = ensureObserverCoordinator();
    _mainDrawerTabResizeObserver = new ResizeObserver(() => {
      coordinator.signal("resize");
    });
    _mainDrawerTabResizeObserver.observe(mainDrawerTab);
    registerCleanup(stopDrawerTabResizeWatcher);
  }
  if (!_mainDrawerTabClassObserver) {
    const coordinator = ensureObserverCoordinator();
    _mainDrawerTabClassObserver = new MutationObserver(() => {
      coordinator.signal("class");
    });
    _mainDrawerTabClassObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ["class"] });
    registerCleanup(stopDrawerTabClassObserver);
  }
  if (!_mainDrawerTabStyleObserver) {
    const coordinator = ensureObserverCoordinator();
    _mainDrawerTabStyleObserver = new MutationObserver(() => {
      coordinator.signal("style");
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
function syncSecondaryTabLabels(forceShow) {
  const showLabels = typeof forceShow === "boolean" ? forceShow : isShowTabLabels();
  const cacheKey = showLabels ? "show" : "hide";
  const forced = typeof forceShow === "boolean";
  if (!forced && cacheKey === _lastWrittenLabelsKey)
    return;
  _lastWrittenLabelsKey = cacheKey;
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function")
    return;
  const labels = document.querySelectorAll(".sidebar-ux-tab-label");
  for (let i3 = 0;i3 < labels.length; i3++) {
    const label = labels[i3];
    if (showLabels) {
      label.style.display = "";
      label.style.visibility = "visible";
      label.style.opacity = "1";
      label.style.height = "auto";
      label.style.minHeight = "";
      label.style.marginTop = "1px";
    } else {
      label.style.display = "none";
      label.style.visibility = "hidden";
      label.style.opacity = "0";
      label.style.height = "0";
      label.style.minHeight = "0";
      label.style.marginTop = "0";
    }
    const btn = label.closest("button[data-tab-id], button.sidebar-ux-main-tab-mirror-btn");
    if (btn) {
      btn.classList.toggle("sidebar-ux-tab-labeled", showLabels);
      btn.style.height = showLabels ? "56px" : "48px";
    }
  }
  Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => {
    try {
      m3.reconcileMainTabListPin();
    } catch {}
  });
}
function checkSideChanged() {
  const currentSide = getMainDrawerSide();
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    dlog("[drawer-sync] side changed detected", {
      from: _lastKnownSide,
      to: currentSide,
      secondDrawerEnabled: getSettings().secondSidebarEnabled
    });
    if (getSettings().secondSidebarEnabled) {
      const wasOpen = isSecondarySidebarOpen();
      const remountGen = ++_sideRemountGen;
      unmountSecondarySidebar();
      _lastWrittenDrawerTabVars = null;
      _lastWrittenLabelsKey = null;
      _lastKnownVerticalPos = null;
      stopDrawerTabResizeWatcher();
      stopDrawerTabClassObserver();
      stopDrawerTabStyleObserver();
      findStoreData(true);
      mountSecondarySidebar({ initialOpen: wasOpen });
      reconcileMainMirrorDrawer();
      Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => {
        if (remountGen !== _sideRemountGen)
          return;
        try {
          m3.reconcileMainTabListPin();
        } catch {}
      });
      restoreSecondaryTabButtons();
      Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer)).then(async ({ assignToSecondary: assignToSecondary2, setSuppressAutoActivation: setSuppressAutoActivation2 }) => {
        if (remountGen !== _sideRemountGen)
          return;
        try {
          const liveTabs = getDrawerTabs().map((t3) => ({
            tabId: t3.id,
            extensionId: t3.extensionId,
            title: t3.title
          }));
          const activeId = getActiveSecondaryTabId();
          setSuppressAutoActivation2(true);
          try {
            await Promise.all(Array.from(getTabAssignments()).filter(([, side]) => side === "secondary").map(async ([key]) => {
              const liveId = liveIdForFacadeKey(key, liveTabs) ?? key;
              await assignToSecondary2(liveId, { setActiveWhenReady: false }).catch(() => {});
            }));
          } finally {
            setSuppressAutoActivation2(false);
          }
          if (remountGen !== _sideRemountGen)
            return;
          if (activeId !== null && getTabSidebar(activeId) === "secondary") {
            showSecondaryTab(activeId);
          }
        } catch (err) {
          dwarn("[drawer-sync] side-remount reassign failed:", err);
        }
      });
      updateDrawerTabVisibility();
      const activeTabId = getActiveSecondaryTabId();
      if (activeTabId !== null) {
        if (getTabSidebar(activeTabId) === "secondary") {
          showSecondaryTab(activeTabId);
        }
      }
    }
  }
  _lastKnownSide = currentSide;
  syncDrawerTabSettings();
}
function resetSideRemountStateAfterDisable() {
  _sideRemountGen++;
  setMainDrawerSideOverride(null);
  _lastKnownSide = getMainDrawerSide();
}
function restoreSecondaryTabButtons() {
  const tabs = getDrawerTabs();
  const liveTabs = tabs.map((t3) => ({
    tabId: t3.id,
    extensionId: t3.extensionId,
    title: t3.title
  }));
  for (const [assignedKey, sidebar] of getTabAssignments()) {
    if (sidebar !== "secondary")
      continue;
    const tabId = liveIdForFacadeKey(assignedKey, liveTabs) ?? assignedKey;
    let tab = tabs && tabs.find((t3) => t3.id === tabId);
    if (!tab && tabs) {
      const stripSuffix = (id) => {
        const lastColon = id.lastIndexOf(":");
        if (lastColon <= 0)
          return id;
        const tail = id.slice(lastColon + 1);
        return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id;
      };
      const storedPrefix = stripSuffix(tabId);
      const candidates = tabs.filter((t3) => stripSuffix(t3.id) === storedPrefix);
      if (candidates.length === 1) {
        tab = candidates[0];
        dlog(`restoreSecondaryTabButtons: suffix-drift fallback matched stored "${tabId}" -> live "${tab.id}"`);
      }
    }
    if (tab) {
      const mainBtnForIcon = findMainTabButton(tabId);
      const iconSvg = tab.iconSvg || mainBtnForIcon?.querySelector("svg")?.outerHTML;
      const shortName = tab.shortName || readMainButtonShortName(mainBtnForIcon);
      addSecondaryTabButton({ ...tab, iconSvg, shortName });
      hideMainTabButton(tabId);
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
        shortName: readMainButtonShortName(mainBtn),
        root: undefined,
        iconSvg: svg
      });
      hideMainTabButton(id);
      dlog(`restoreSecondaryTabButtons: DOM-fallback restored tab "${id}" from main sidebar button`);
    } else {
      dwarn(`restoreSecondaryTabButtons: tab "${tabId}" not found in store or main sidebar`);
    }
  }
}
async function applyMainDrawerSideChange(desired) {
  const gen = ++_sideApplyGen;
  const run = async () => {
    if (gen !== _sideApplyGen)
      return;
    dlog("[drawer-sync] apply drawer side change", {
      desired,
      remounting: _lastKnownSide === null || _lastKnownSide !== desired
    });
    setMainDrawerSideOverride(desired);
    if (_lastKnownSide === null || _lastKnownSide !== desired) {
      if (_lastKnownSide === null) {
        _lastKnownSide = desired === "left" ? "right" : "left";
      }
      try {
        checkSideChanged();
      } catch (err) {
        dwarn("[drawer-sync] applyMainDrawerSideChange remount failed:", err);
      }
    }
    _lastKnownSide = desired;
    waitForSideSettle(desired, gen).then(() => {
      if (gen !== _sideApplyGen)
        return;
      _lastKnownSide = desired;
      rebindSideChangeWatcherIfNeeded();
    });
  };
  const next = _applySideChain.then(run, run);
  _applySideChain = next.catch(() => {});
  await next;
}
function readMainWrapperSideFromDom() {
  const wrapper = getMainWrapper();
  if (!wrapper)
    return null;
  const cls = wrapper.classList.toString();
  if (cls.includes("wrapperLeft"))
    return "left";
  if (cls.includes("wrapperRight"))
    return "right";
  if (/\bwrapper\w*/.test(cls) && !cls.includes("wrapperLeft"))
    return "right";
  return null;
}
function reconcileSideOverrideFromDom() {
  const override = getMainDrawerSideOverride();
  if (override === null)
    return;
  const domSide = readMainWrapperSideFromDom();
  if (domSide === null)
    return;
  if (domSide === override) {
    setMainDrawerSideOverride(null);
    return;
  }
  const hostSide = getHostDrawerSettings()?.side;
  if ((hostSide === "left" || hostSide === "right") && hostSide !== override && hostSide === domSide) {
    setMainDrawerSideOverride(null);
  }
}
function waitForSideSettle(desired, gen) {
  return new Promise((resolve) => {
    if (gen !== _sideApplyGen) {
      resolve();
      return;
    }
    let observed = getMainWrapper();
    if (!observed) {
      resolve();
      return;
    }
    if (readMainWrapperSideFromDom() === desired) {
      if (gen === _sideApplyGen && getMainDrawerSideOverride() === desired) {
        setMainDrawerSideOverride(null);
      }
      resolve();
      return;
    }
    let settled = false;
    let timer = null;
    let observer;
    const finish = () => {
      if (settled)
        return;
      settled = true;
      if (timer != null)
        clearTimeout(timer);
      try {
        observer.disconnect();
      } catch {}
      resolve();
    };
    observer = new MutationObserver(() => {
      if (settled)
        return;
      if (gen !== _sideApplyGen) {
        finish();
        return;
      }
      if (!observed || !observed.isConnected) {
        observer.disconnect();
        const next = getMainWrapper();
        if (!next)
          return;
        observed = next;
        observer.observe(observed, { attributes: true, attributeFilter: ["class"] });
      }
      if (readMainWrapperSideFromDom() === desired) {
        if (gen === _sideApplyGen && getMainDrawerSideOverride() === desired) {
          setMainDrawerSideOverride(null);
        }
        finish();
      }
    });
    observer.observe(observed, { attributes: true, attributeFilter: ["class"] });
    timer = setTimeout(() => {
      if (settled)
        return;
      if (gen === _sideApplyGen) {
        _lastKnownSide = desired;
        dwarn(`[drawer-sync] applyMainDrawerSideChange: host DOM side did not settle to "${desired}" within ${_sideSettleHardMs}ms; keeping override until DOM matches or host writes a different side`);
      }
      finish();
    }, _sideSettleHardMs);
  });
}
function rebindSideChangeWatcherIfNeeded() {
  const wrapper = getMainWrapper();
  if (!wrapper)
    return;
  if (_sideObserver !== null && _observedMainWrapper === wrapper)
    return;
  if (_sideObserver !== null) {
    try {
      _sideObserver.disconnect();
    } catch {}
    _sideObserver = null;
    _observedMainWrapper = null;
  }
  startSideChangeWatcher();
}
function startSideChangeWatcher() {
  if (_sideObserver !== null)
    return;
  if (_lastKnownSide === null) {
    _lastKnownSide = getMainDrawerSide();
  }
  const wrapper = getMainWrapper();
  if (!wrapper) {
    dwarn("startSideChangeWatcher: no main wrapper found; side changes will not be detected until the wrapper appears");
    return;
  }
  const coordinator = ensureObserverCoordinator();
  _sideObserver = new MutationObserver(() => {
    reconcileSideOverrideFromDom();
    coordinator.signal("side");
  });
  _sideObserver.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
  _observedMainWrapper = wrapper;
  if (!_sideWatcherCleanupRegistered) {
    _sideWatcherCleanupRegistered = true;
    registerCleanup(() => stopSideChangeWatcher());
  }
}
function stopSideChangeWatcher() {
  if (_sideObserver === null)
    return;
  _sideObserver.disconnect();
  _sideObserver = null;
  _observedMainWrapper = null;
}
function __setLastKnownSideForTest(side) {
  _lastKnownSide = side;
}
function __getLastKnownSideForTest() {
  return _lastKnownSide;
}
function __getSideRemountGenForTest() {
  return _sideRemountGen;
}
function __resetSideApplyStateForTest() {
  _sideApplyGen = 0;
  _applySideChain = Promise.resolve();
  _sideRemountGen = 0;
  _sideSettleHardMs = SIDE_SETTLE_HARD_MS;
}
function __resetDrawerTabSyncStateForTest() {
  _lastKnownVerticalPos = null;
  _lastWrittenDrawerTabVars = null;
  _lastWrittenLabelsKey = null;
  _syncPending = false;
  _drawerTabRetryCount = 0;
  _drawerTabRetryLogged = false;
}
function __setSideSettleHardMsForTest(ms) {
  _sideSettleHardMs = ms;
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
function ensureObserverCoordinator() {
  if (!_observerCoordinator) {
    _observerCoordinator = new ObserverCoordinator;
    registerCleanup(stopObserverCoordinator);
  }
  return _observerCoordinator;
}
function stopObserverCoordinator() {
  if (_observerCoordinator) {
    _observerCoordinator.stop();
    _observerCoordinator = null;
  }
}
var _lastKnownSide = null, _lastKnownVerticalPos = null, _mainDrawerTabResizeObserver = null, _mainDrawerTabClassObserver = null, _mainDrawerTabStyleObserver = null, _observerCoordinator = null, _sideRemountGen = 0, _applySideChain, _sideApplyGen = 0, _syncPending = false, _drawerTabRetryCount = 0, DRAWER_TAB_RETRY_MAX = 30, _drawerTabRetryLogged = false, _lastWrittenDrawerTabVars = null, _lastWrittenLabelsKey = null, _sideObserver = null, _observedMainWrapper = null, _sideWatcherCleanupRegistered = false, SIDE_SETTLE_HARD_MS = 2500, _sideSettleHardMs;
var init_drawer_sync = __esm(() => {
  init_host_settings();
  init_store();
  init_log();
  init_secondary();
  init_main_mirror_drawer();
  init_assignment();
  init_cleanup();
  init_state();
  init_buttons();
  init_active_tab();
  _applySideChain = Promise.resolve();
  _sideSettleHardMs = SIDE_SETTLE_HARD_MS;
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
  const on = !!getSettings().taskbarMode;
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
function persistCanvasMainOpenState() {}
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
  try {
    dlog("[main-mirror] content state", {
      parked: _contentEl?.parentElement === _shell?.content,
      children: _contentEl ? Array.from(_contentEl.children).map((c3) => {
        const cls = c3.className;
        return `${c3.tagName}.${String(cls ?? "").slice(0, 60)}`;
      }) : null,
      movedAttrs: _contentEl ? Array.from(_contentEl.children).filter((c3) => c3.hasAttribute?.("data-canvas-moved")).length : null
    });
  } catch {}
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
  const hideTab = !!getSettings().hideDrawerOpenCloseButtons && !!getSettings().taskbarMode;
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
  sweepOrphanMainMirrorWrappers();
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
  const fromHost = getMainPanelContent();
  if (fromHost)
    return fromHost;
  if (_contentEl?.isConnected)
    return _contentEl;
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
  if (_contentEl && _contentEl !== hostContent) {
    dlog("[main-mirror] parked content node replaced by host (re-parking)", {
      hadMark: _contentEl.hasAttribute?.(CONTENT_MARK_ATTR) ?? false
    });
    if (_contentEl.parentElement === slot) {
      slot.removeChild(_contentEl);
    }
    _contentEl.removeAttribute?.(CONTENT_MARK_ATTR);
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
function sweepOrphanMainMirrorWrappers() {
  if (typeof document === "undefined" || !document.querySelectorAll)
    return;
  const keep = _shell?.wrapper ?? null;
  const all = document.querySelectorAll(".sidebar-ux-main-mirror-wrapper");
  for (const el of Array.from(all)) {
    if (el !== keep) {
      try {
        el.remove();
      } catch {}
    }
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
  sweepOrphanMainMirrorWrappers();
  if (!opts?.keepWidthVar) {
    const w3 = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0);
    if (w3 > 0) {
      const wrapper = getMainWrapper();
      if (wrapper && !isHostMobileDrawerViewport()) {
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
  init_reflow();
  init_handles();
  init_drawer_sync();
  init_panel_header_sync();
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
    if (mainWidth === 0 && isTaskbarModeEnabled()) {
      mainWidth = TAB_LIST_WIDTH_PX;
    }
  }
  let secondaryWidth = isSecondarySidebarOpen() ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420 : 0;
  if (secondaryWidth === 0 && isTaskbarModeEnabled() && getSecondaryTabList()) {
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
  _mediaQuery2 = window.matchMedia("(max-width: 600px)");
  _onMediaChange2 = _onMediaChangeImpl;
  _mediaQuery2.addEventListener("change", _onMediaChange2);
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
    if (_mediaQuery2 && _onMediaChange2) {
      _mediaQuery2.removeEventListener("change", _onMediaChange2);
    }
    _mediaQuery2 = null;
    _onMediaChange2 = null;
  };
}
var CONTENT_INSET_L_VAR = "--sidebar-ux-content-inset-l", CONTENT_INSET_R_VAR = "--sidebar-ux-content-inset-r", _reflowRaf = null, _mediaQuery2 = null, _onMediaChange2 = null;
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
      }, () => {}, () => isCanvasMainOpen());
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
function waitForSettle(timeout) {
  return new Promise((resolve) => {
    if (_stopped) {
      resolve();
      return;
    }
    let settled = false;
    let hardTimer = null;
    const settle = () => {
      if (settled)
        return;
      settled = true;
      if (hardTimer != null)
        clearTimeout(hardTimer);
      stopContentSettleWatch();
      resolve();
    };
    startContentSettleWatch(() => settle());
    hardTimer = setTimeout(() => settle(), Math.max(0, timeout));
  });
}
function unsuppressAfterTwoPaints() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        unsuppressMainDrawer();
        resolve();
      });
    });
  });
}
function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function restoreTab(targetTabId, preferMirror, timeout, opts) {
  if (_stopped)
    return;
  if (!targetTabId) {
    opts?.repark?.();
    await unsuppressAfterTwoPaints();
    return;
  }
  const repark = opts?.repark;
  const isMirrorMode = opts?.isMirrorMode ?? false;
  const deadline = Date.now() + timeout;
  let polls = 0;
  let stable = 0;
  while (!_stopped && Date.now() < deadline) {
    if (isHostPrimaryTabActive(targetTabId)) {
      stable++;
      if (stable >= RESTORE_HOST_STABLE_POLLS)
        break;
    } else {
      stable = 0;
      if (polls % 3 === 0) {
        clickRestoredPrimaryTab(targetTabId, preferMirror);
      }
    }
    if (!isMirrorMode) {
      stampPanelBodyHide();
    }
    repark?.();
    polls++;
    await delayMs(RESTORE_TAB_POLL_MS);
  }
  if (!_stopped) {
    const remaining = Math.max(0, deadline - Date.now());
    await waitForSettle(remaining > 0 ? remaining : RESTORE_CONTENT_FALLBACK_MS);
  }
  if (!isMirrorMode) {
    stampPanelBodyHide();
  }
  repark?.();
  await unsuppressAfterTwoPaints();
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
  const run = async () => {
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
    const timeout = RESTORE_TAB_POLL_MAX * RESTORE_TAB_POLL_MS;
    await restoreTab(targetTabId, preferMirror, timeout, {
      repark: reparkIfNeeded,
      isMirrorMode
    });
    dlog("main-persist restore: unsuppress (host-stable + content settle)");
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
  const canvasMain = !!getSettings().taskbarMode && typeof window !== "undefined" && window.innerWidth > 600;
  const open = canvasMain ? document.documentElement.classList.contains("sidebar-ux-canvas-main-open") : readWrapperOpen(_wrapper);
  const tabId = _sidebar ? readActiveTabId(_sidebar) : null;
  if (open === _lastSeenOpen && tabId === _lastSeenTabId)
    return;
  _lastSeenOpen = open;
  _lastSeenTabId = tabId;
  if (!canvasMain || tabId !== null) {}
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
  const taskbarMode = !!getSettings().taskbarMode;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  clickRestoredPrimaryTab(targetTabId, taskbarMode && !isMobile);
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
  const taskbarMode = !!getSettings().taskbarMode;
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  const isHostMobile = isHostMobileDrawerViewport();
  if (taskbarMode && !isMobile) {
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
  if (isHostMobile && !taskbarMode && drawer) {
    drawer.style.removeProperty("width");
    wrapper.style.removeProperty("--drawer-panel-w");
    if (!isMobileViewport()) {
      wrapper.style.setProperty("--drawer-panel-w", "calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)", "important");
    }
  }
  if (!restoreOpen) {
    const currentOpen2 = readWrapperOpen(wrapper);
    if (currentOpen2 && clampedWidth !== null && drawer && !isHostMobile) {
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
    if (targetOpen && clampedWidth !== null && drawer && !isHostMobile) {
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
    if (clampedWidth !== null && drawer && !isHostMobile) {
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
  if (_resizeDebounce) {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = null;
  }
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
  init_state();
  init_log();
  init_handles();
  init_mobile_exclusion();
  init_persist_polling();
  init_persist_polling();
  PANEL_BODY_HIDE_SELECTOR = '[class*="_panelContent_"],' + "[data-canvas-main-panel-content]," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content," + ".sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *";
});

// src/sidebar/mobile-exclusion.ts
var exports_mobile_exclusion = {};
__export(exports_mobile_exclusion, {
  syncHostMainDrawerToMobileWidth: () => syncHostMainDrawerToMobileWidth,
  startMobileExclusion: () => startMobileExclusion,
  setMobileOpenClass: () => setMobileOpenClass,
  isMobileViewport: () => isMobileViewport,
  isHostMobileDrawerViewport: () => isHostMobileDrawerViewport,
  enforceExclusionOnOpen: () => enforceExclusionOnOpen
});
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
function isHostMobileDrawerViewport() {
  if (isMobileViewport())
    return true;
  return window.matchMedia("(pointer: coarse)").matches;
}
function syncHostMainDrawerToMobileWidth() {
  const wrapper = getMainWrapper();
  const drawer = getMainDrawer();
  if (!wrapper || !drawer)
    return;
  if (isMobileViewport()) {
    drawer.style.removeProperty("width");
    wrapper.style.removeProperty("--drawer-panel-w");
  } else if (window.matchMedia("(pointer: coarse)").matches) {
    const fullWidth = "calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)";
    drawer.style.removeProperty("width");
    wrapper.style.setProperty("--drawer-panel-w", fullWidth, "important");
  } else {
    const current = wrapper.style.getPropertyValue("--drawer-panel-w");
    if (current && current.includes("app-scaled-viewport-width")) {
      wrapper.style.removeProperty("--drawer-panel-w");
    }
  }
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
  _mediaQuery3 = window.matchMedia("(max-width: 600px)");
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
    syncHostMainDrawerToMobileWidth();
  }
  _onMediaChange3 = (e3) => {
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
  _mediaQuery3.addEventListener("change", _onMediaChange3);
  const _onResize = () => {
    syncHostMainDrawerToMobileWidth();
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
  syncHostMainDrawerToMobileWidth();
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
    if (_mediaQuery3 && _onMediaChange3) {
      _mediaQuery3.removeEventListener("change", _onMediaChange3);
    }
    _mediaQuery3 = null;
    _onMediaChange3 = null;
    document.getElementById("canvas-ux-secondary-mobile")?.remove();
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY);
  };
}
var _desktopCssVarValue = null, _resizeRafId = null, _lastDiagLog = 0, DIAG_THROTTLE_MS = 500, BODY_CLASS_PRIMARY = "canvas-ux-mobile-primary-open", BODY_CLASS_SECONDARY = "canvas-ux-mobile-secondary-open", _mediaQuery3 = null, _onMediaChange3 = null;
var init_mobile_exclusion = __esm(() => {
  init_log();
  init_main_persist();
  init_secondary();
  init_animation();
});

// src/tabs/activation-handoff.ts
async function captureSourceList(_side, _h) {
  return [];
}
function buildCrossDrawerHandoff(args) {
  return args;
}
function armPreservePrimaryActiveOnToSecondary(_tabIds) {
  return { disconnect: () => {}, reassert: () => {} };
}
async function runHandoff(_handoff) {
  dwarn("[activation-handoff-stub] runHandoff called on deleted module");
}
async function reassertPrimaryNeighborAfterHandoff(_tabId, _preMoveSourceList) {
  dwarn("[activation-handoff-stub] reassertPrimaryNeighborAfterHandoff called on deleted module");
}
var init_activation_handoff = __esm(() => {
  init_log();
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
  getLiveIdAssignments: () => getLiveIdAssignments,
  getLiveIdAssignmentEntries: () => getLiveIdAssignmentEntries,
  getActiveSecondaryTabId: () => getActiveSecondaryTabId,
  ensureBuiltInTabActiveInMain: () => ensureBuiltInTabActiveInMain,
  deleteTabAssignment: () => deleteTabAssignment,
  clearTabAssignments: () => clearTabAssignments,
  assignTab: () => assignTab
});
function _resolvedKey(liveId) {
  const host = getHost();
  if (host) {
    const key = host.findKey(liveId);
    if (key)
      return key;
  }
  const stripped = stripTabIdSuffix(liveId);
  if (!stripped.includes(":"))
    return `builtin:${stripped}`;
  return null;
}
function _readFromModel() {
  const model = getModel();
  if (!model)
    return null;
  const out = new Map;
  for (const key of model.primary)
    out.set(key, "primary");
  for (const key of model.secondary)
    out.set(key, "secondary");
  return out;
}
function getTabAssignments() {
  const fromModel = _readFromModel();
  if (fromModel)
    return fromModel;
  return _tabAssignments;
}
function hasTabAssignment(tabId) {
  const fromModel = _readFromModel();
  if (fromModel) {
    if (fromModel.has(tabId))
      return true;
    const key = _resolvedKey(tabId);
    if (key && fromModel.has(key))
      return true;
    return false;
  }
  return _tabAssignments.has(tabId);
}
function clearTabAssignments() {
  _tabAssignments.clear();
}
function hasSecondaryAssignedTabs() {
  const fromModel = _readFromModel();
  if (fromModel) {
    for (const side of fromModel.values()) {
      if (side === "secondary")
        return true;
    }
    return false;
  }
  for (const side of _tabAssignments.values()) {
    if (side === "secondary")
      return true;
  }
  return false;
}
function setTabAssignment(tabId, panelId) {
  if (getModel())
    return;
  _tabAssignments.set(tabId, panelId);
}
function deleteTabAssignment(tabId) {
  if (getModel())
    return;
  _tabAssignments.delete(tabId);
}
function getTabSidebar(tabId) {
  const fromModel = _readFromModel();
  if (fromModel) {
    if (fromModel.has(tabId))
      return fromModel.get(tabId);
    const key = _resolvedKey(tabId);
    if (key && fromModel.has(key))
      return fromModel.get(key);
  }
  return _tabAssignments.get(tabId) || "primary";
}
function getLiveIdAssignments(tabs = drawerObserver.getAllTabs()) {
  const fromModel = _readFromModel();
  if (!fromModel)
    return _tabAssignments;
  const out = new Map;
  for (const [key, side] of fromModel) {
    const liveId = liveIdForFacadeKey(key, tabs);
    out.set(liveId ?? key, side);
  }
  return out;
}
function getLiveIdAssignmentEntries(tabs = drawerObserver.getAllTabs()) {
  const fromModel = _readFromModel();
  if (!fromModel)
    return [];
  const out = [];
  for (const [key, side] of fromModel) {
    const liveId = liveIdForFacadeKey(key, tabs);
    out.push({ key, liveId: liveId ?? key, side });
  }
  return out;
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
async function reconcileMainMirrorAfterSecondaryAssign() {
  try {
    const pin = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
    pin.reconcileMainTabListPin();
  } catch {}
  try {
    const m3 = await Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer));
    if (m3.isMainMirrorActive())
      m3.ensureHostContentParkedPublic();
  } catch {}
}
async function assignTab(tabId, sidebar) {
  if (sidebar === "secondary") {
    if (!ensureSecondaryShellMounted({ initialOpen: false })) {
      dwarn(`[tabmove] assignTab: secondary shell unavailable (secondSidebarEnabled=${!!getSettings().secondSidebarEnabled}); abort move of "${tabId}"`);
      return;
    }
    const preMoveSourceList = await captureSourceList("primary");
    const handoff = buildCrossDrawerHandoff({
      tabId,
      source: "primary",
      destination: "secondary",
      sourceList: preMoveSourceList,
      activateDestination: true
    });
    const preMoveActiveTab = !!handoff.preMoveSourceActiveTab;
    const preservePrimary = armPreservePrimaryActiveOnToSecondary([tabId]);
    const bridge = getHostBridge();
    if (bridge?.ui.getBuiltInTabRoot) {
      const { moveBuiltInTabToSecondaryContainer: moveBuiltInTabToSecondaryContainer2 } = await Promise.resolve().then(() => (init_builtin_move(), exports_builtin_move));
      const builtInRoot = await moveBuiltInTabToSecondaryContainer2({ tabId });
      if (builtInRoot) {
        setTabAssignment(tabId, "secondary");
        hideMainTabButton(tabId);
        addBuiltInSecondaryButton(bridge, tabId, builtInRoot);
        updateDrawerTabVisibility();
        if (!isSecondarySidebarOpen() && !isMobileViewport())
          openSecondarySidebar();
        await runHandoff(handoff);
        await reconcileMainMirrorAfterSecondaryAssign();
        if (preMoveActiveTab) {
          await reassertPrimaryNeighborAfterHandoff(tabId, preMoveSourceList);
        } else {
          try {
            preservePrimary?.reassert();
          } catch {}
        }
        if (preservePrimary) {
          new Promise((r3) => setTimeout(() => r3(), 120)).then(() => {
            try {
              preservePrimary.reassert();
            } catch {}
            try {
              preservePrimary.disconnect();
            } catch {}
          });
        }
        return;
      }
      try {
        preservePrimary?.disconnect();
      } catch {}
      let knownBuiltIn = false;
      try {
        knownBuiltIn = !!bridge.ui.getBuiltInTabRoot?.(tabId) || !!bridge.ui.getBuiltInTabTitle?.(tabId);
      } catch {
        knownBuiltIn = false;
      }
      if (knownBuiltIn) {
        dwarn(`[tabmove] assignTab: built-in "${tabId}" place failed; aborting (no empty secondary handoff).`);
        return;
      }
    }
    if (!bridge) {
      dwarn(`[tabmove] no host bridge; tabId="${tabId}" treated as extension. Built-in move requires the spindle loader.`);
    }
    const { assignToSecondary: assignToSecondary2 } = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    await assignToSecondary2(tabId);
    await runHandoff(handoff);
    await reconcileMainMirrorAfterSecondaryAssign();
    if (preMoveActiveTab) {
      await reassertPrimaryNeighborAfterHandoff(tabId, preMoveSourceList);
    } else {
      try {
        preservePrimary?.reassert();
      } catch {}
    }
    if (preservePrimary) {
      new Promise((r3) => setTimeout(() => r3(), 120)).then(() => {
        try {
          preservePrimary.reassert();
        } catch {}
        try {
          preservePrimary.disconnect();
        } catch {}
      });
    }
  } else {
    const { unassignFromSecondary: unassignFromSecondary2 } = await Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer));
    const preMoveSourceList = await captureSourceList("secondary");
    const handoff = buildCrossDrawerHandoff({
      tabId,
      source: "secondary",
      destination: "primary",
      sourceList: preMoveSourceList,
      activateDestination: true
    });
    await unassignFromSecondary2(tabId);
    await runHandoff(handoff);
  }
}
var _tabAssignments;
var init_assignment = __esm(() => {
  init_log();
  init_mobile_exclusion();
  init_state();
  init_secondary();
  init_buttons();
  init_activation_handoff();
  init_active_tab();
  init_dispatch();
  init_drawer_observer();
  init_secondary();
  _tabAssignments = new Map;
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
function parseExtensionId(tabId, existingId, isExtensionBtn) {
  const parts = tabId.split(":");
  return existingId ? parts[1] || "unknown" : isExtensionBtn ? parts[1] || "unknown" : "";
}
function keyForTabShape(tabId, extensionId, title) {
  const extId = extensionId && extensionId !== "unknown" ? extensionId : "";
  if (!extId && !tabId.includes(":"))
    return builtinKey(tabId);
  return extensionKey(extId || "unknown", title);
}

class DrawerObserver {
  observer = null;
  tabs = new Map;
  tabHandlers = [];
  unregHandlers = [];
  revision = 0;
  started = false;
  start() {
    if (this.started)
      return;
    const sidebar = getMainSidebar();
    if (!sidebar) {
      console.warn("[DrawerObserver] main sidebar not found");
      return;
    }
    this.started = true;
    this.scanExistingTabs(sidebar);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target instanceof HTMLElement)
            this.registerTab(target);
          continue;
        }
        for (const node of mutation.addedNodes ?? []) {
          if (node instanceof HTMLElement)
            this.handleAddedNode(node);
        }
      }
      this.scanExistingTabs(sidebar);
      this.removeDetachedTabs();
      this.revision++;
    });
    this.observer.observe(sidebar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tab-id", "title", "class"]
    });
    this.scanExistingTabs(sidebar);
    registerCleanup(() => this.stop());
    const stale = Array.from(this.tabs.entries()).filter(([, t3]) => t3.extensionId === "unknown" && !t3.key.startsWith("builtin:"));
    if (stale.length > 0) {
      dlog("[DrawerObserver] post-start scan: extension entries still title-keyed", {
        stale: stale.map(([id, t3]) => ({ id, key: t3.key, title: t3.title }))
      });
    }
  }
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.tabs.clear();
    this.started = false;
    this.revision++;
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
    return Array.from(this.tabs.values()).sort((a3, b2) => {
      if (typeof a3.button.compareDocumentPosition !== "function")
        return 0;
      const relation = a3.button.compareDocumentPosition(b2.button);
      return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }
  getSnapshot() {
    const tabs = this.getAllTabs();
    return {
      status: !this.started ? "empty" : tabs.length === 0 ? "partial" : "ready",
      revision: this.revision,
      tabs
    };
  }
  scanExistingTabs(sidebar) {
    const buttons = sidebar.querySelectorAll('[data-tab-id], button[class*="tabBtnExtension"]');
    for (const btn of buttons) {
      if (btn instanceof HTMLElement) {
        this.registerTab(btn);
      }
    }
  }
  removeDetachedTabs() {
    for (const [tabId, tab] of this.tabs) {
      if (tab.button.isConnected === false) {
        let moved = null;
        if (typeof document !== "undefined") {
          try {
            moved = document.querySelector(`[data-canvas-moved="${CSS.escape(tabId)}"]`);
          } catch {
            moved = null;
          }
        }
        if (moved)
          continue;
        this.tabs.delete(tabId);
        for (const h4 of this.unregHandlers)
          h4(tabId);
      }
    }
  }
  handleAddedNode(node) {
    if (node.hasAttribute?.("data-tab-id") || String(node.className || "").includes("tabBtnExtension")) {
      this.registerTab(node);
    }
    const buttons = node.querySelectorAll?.('[data-tab-id], button[class*="tabBtnExtension"]');
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
        for (const h4 of this.unregHandlers)
          h4(tabId);
      }
    }
    const buttons = node.querySelectorAll?.("[data-tab-id]");
    if (buttons) {
      for (const btn of buttons) {
        if (btn instanceof HTMLElement) {
          const tabId = btn.getAttribute("data-tab-id") || "";
          if (this.tabs.has(tabId)) {
            this.tabs.delete(tabId);
            for (const h4 of this.unregHandlers)
              h4(tabId);
          }
        }
      }
    }
  }
  entryForButton(button) {
    for (const tab of this.tabs.values()) {
      if (tab.button === button)
        return tab;
    }
    return null;
  }
  registerTab(button) {
    const existingId = button.getAttribute("data-tab-id") || "";
    const isExtensionBtn = String(button.className || "").includes("tabBtnExtension");
    if (!existingId && !isExtensionBtn)
      return;
    const tabId = existingId || button.getAttribute("title") || button.getAttribute("aria-label") || "";
    if (!tabId)
      return;
    const existing = this.entryForButton(button);
    if (existing) {
      this.updateEntry(existing, button, tabId, existingId, isExtensionBtn);
      return;
    }
    if (this.tabs.has(tabId))
      return;
    const title = button.getAttribute("title") || button.textContent?.trim() || tabId;
    const tab = {
      tabId,
      button,
      extensionId: parseExtensionId(tabId, existingId, isExtensionBtn),
      title,
      key: this.freezeKey(tabId, isExtensionBtn, title),
      titles: new Set([title])
    };
    this.tabs.set(tabId, tab);
    for (const h4 of this.tabHandlers)
      h4(tab);
  }
  updateEntry(entry, button, tabId, existingId, isExtensionBtn) {
    const title = button.getAttribute("title") || button.textContent?.trim() || tabId;
    const nextExtensionId = parseExtensionId(tabId, existingId, isExtensionBtn);
    if (entry.tabId === tabId && entry.title === title && entry.extensionId === nextExtensionId) {
      return;
    }
    if (entry.tabId !== tabId) {
      dlog("[DrawerObserver] entry address upgraded", {
        from: entry.tabId,
        to: tabId,
        extFrom: entry.extensionId,
        extTo: nextExtensionId
      });
    }
    entry.tabId = tabId;
    entry.title = title;
    entry.extensionId = nextExtensionId;
    if (!entry.titles.has(title)) {
      entry.titles = new Set(entry.titles).add(title);
    }
    for (const [key, tab] of this.tabs) {
      if (tab === entry) {
        if (key !== tabId) {
          this.tabs.delete(key);
          this.tabs.set(tabId, entry);
        }
        break;
      }
    }
  }
  freezeKey(tabId, isExtensionBtn, title) {
    if (!isExtensionBtn && !tabId.includes(":"))
      return builtinKey(tabId);
    const extensionId = tabId.split(":")[1] || "unknown";
    const base = extensionKey(extensionId || "unknown", title);
    if (!this.hasKey(base))
      return base;
    let n2 = 2;
    while (this.hasKey(`${base}@${n2}`))
      n2++;
    return `${base}@${n2}`;
  }
  hasKey(key) {
    for (const tab of this.tabs.values()) {
      if (tab.key === key)
        return true;
    }
    return false;
  }
}
var drawerObserver;
var init_drawer_observer = __esm(() => {
  init_cleanup();
  init_log();
  drawerObserver = new DrawerObserver;
});

// src/store/index.ts
var exports_store = {};
__export(exports_store, {
  setMainDrawerSideOverride: () => setMainDrawerSideOverride,
  isMainDrawerOpen: () => isMainDrawerOpen,
  getStoreSnapshot: () => getStoreSnapshot,
  getMainDrawerSideOverride: () => getMainDrawerSideOverride,
  getMainDrawerSide: () => getMainDrawerSide,
  getHostStoreTabs: () => getHostStoreTabs,
  getDrawerTabs: () => getDrawerTabs,
  getActiveModal: () => getActiveModal,
  findStoreData: () => findStoreData,
  asDrawerStore: () => asDrawerStore,
  __setStoreSnapshotForTest: () => __setStoreSnapshotForTest,
  __setDrawerTabsForTest: () => __setDrawerTabsForTest
});
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
  const v3 = store["activeModal"];
  if (typeof v3 === "string")
    return v3;
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
      _cacheTimestamp2 = Date.now();
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
  if (!force && _drawerTabsCache && _storeSnapshotCache && now - _cacheTimestamp2 < CACHE_TTL_MS2)
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
    for (let i3 = ancestors.length - 1;i3 >= Math.max(0, ancestors.length - 5); i3--) {
      scanForStoreData(ancestors[i3], 0, 30, visited2, true);
    }
    _cacheTimestamp2 = Date.now();
    return;
  }
  const visited = new Set;
  for (let i3 = ancestors.length - 1;i3 >= Math.max(0, ancestors.length - 5); i3--) {
    scanForStoreData(ancestors[i3], 0, 30, visited, false);
    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp2 = Date.now();
      break;
    }
  }
}
function getDrawerTabs() {
  if (_testDrawerTabsOverride && _drawerTabsCache)
    return _drawerTabsCache;
  const observed = drawerObserver.getAllTabs();
  if (observed.length > 0) {
    return observed.map((tab) => ({
      id: tab.tabId,
      title: tab.title,
      root: tab.button,
      iconSvg: "",
      extensionId: tab.extensionId === "unknown" ? "" : tab.extensionId
    }));
  }
  findStoreData();
  if (_drawerTabsCache)
    return _drawerTabsCache;
  dlog("getDrawerTabs: no host inventory available");
  return [];
}
function getHostStoreTabs() {
  findStoreData(true);
  return _drawerTabsCache ? [..._drawerTabsCache] : [];
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
function setMainDrawerSideOverride(side) {
  _mainDrawerSideOverride = side;
}
function getMainDrawerSideOverride() {
  return _mainDrawerSideOverride;
}
function getMainDrawerSide() {
  if (_mainDrawerSideOverride === "left" || _mainDrawerSideOverride === "right") {
    return _mainDrawerSideOverride;
  }
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
function __setStoreSnapshotForTest(snap, timestamp = Date.now()) {
  _storeSnapshotCache = snap;
  _cacheTimestamp2 = timestamp;
}
function __setDrawerTabsForTest(tabs) {
  _drawerTabsCache = tabs;
  _testDrawerTabsOverride = tabs !== null;
  _cacheTimestamp2 = Date.now();
}
var _drawerTabsCache = null, _testDrawerTabsOverride = false, _storeSnapshotCache = null, _cacheTimestamp2 = 0, CACHE_TTL_MS2 = 3000, _mainDrawerSideOverride = null;
var init_store = __esm(() => {
  init_fiber();
  init_log();
  init_drawer_observer();
});

// src/sidebar/secondary.tsx
var exports_secondary = {};
__export(exports_secondary, {
  unmountSecondarySidebar: () => unmountSecondarySidebar,
  tearDownSecondarySidebar: () => tearDownSecondarySidebar,
  syncPanelHeaderFromMain: () => syncPanelHeaderFromMain2,
  stopPanelHeaderObservers: () => stopPanelHeaderObservers,
  setSecondarySidebarOpen: () => setSecondarySidebarOpen,
  secondaryTabsAllPlaced: () => secondaryTabsAllPlaced,
  reassignSecondaryTabsFromModel: () => reassignSecondaryTabsFromModel,
  persistSecondaryDrawerOpen: () => persistSecondaryDrawerOpen,
  openSecondarySidebar: () => openSecondarySidebar,
  mountSecondarySidebar: () => mountSecondarySidebar,
  liveIdForFacadeKey: () => liveIdForFacadeKey,
  isSecondarySidebarOpen: () => isSecondarySidebarOpen,
  isSecondaryShellLive: () => isSecondaryShellLive,
  injectDrawerTabStyles: () => injectDrawerTabStyles,
  getSecondaryWrapper: () => getSecondaryWrapper,
  getSecondaryTabList: () => getSecondaryTabList,
  getSecondaryPanel: () => getSecondaryPanel,
  getSecondaryDrawer: () => getSecondaryDrawer,
  getClosedTransformPx: () => getClosedTransformPx,
  ensureSecondaryShellMounted: () => ensureSecondaryShellMounted,
  createSecondarySidebar: () => createSecondarySidebar,
  closeSecondarySidebar: () => closeSecondarySidebar,
  animateWrapper: () => animateWrapper,
  __setSecondaryWrapperForTest: () => __setSecondaryWrapperForTest,
  SECONDARY_WIDTH_VAR: () => SECONDARY_WIDTH_VAR,
  PUZZLE_ICON_SVG: () => PUZZLE_ICON_SVG
});
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
function __setSecondaryWrapperForTest(wrapper) {
  _secondaryWrapper = wrapper;
}
function isSecondarySidebarOpen() {
  return _secondarySidebarOpen;
}
function setSecondarySidebarOpen(open) {
  _secondarySidebarOpen = open;
}
function unmountSecondarySidebar() {
  applyTabListPin(false, { force: true });
  if (_secondaryWrapper) {
    _secondaryWrapper.remove();
    _secondaryWrapper = null;
  }
  _secondaryDrawer = null;
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
      try {
        wContainers.unregisterContainer?.("canvas-secondary-drawer");
      } catch {}
      wContainers.registerContainer({
        id: "canvas-secondary-drawer",
        side,
        element: shell.content
      });
    } else {
      dwarn(`[tabmove] createSecondarySidebar: registerContainer SKIPPED — ` + `host bridge containers.registerContainer not available ` + `(setup ctx / window.spindle missing). Built-in tab moves will ` + `silently fail (ContainerTabContent Pass 3 resets to main-drawer).`);
    }
  } catch (err) {
    dwarn(`[tabmove] createSecondarySidebar: registerContainer THREW:`, err);
  }
  _secondaryDrawer = shell.drawer;
  return shell.wrapper;
}
function sweepOrphanSecondaryWrappers() {
  if (typeof document === "undefined" || !document.querySelectorAll)
    return;
  const all = document.querySelectorAll(".sidebar-ux-secondary-wrapper");
  for (const el of Array.from(all)) {
    if (el !== _secondaryWrapper) {
      try {
        el.remove();
      } catch {}
    }
  }
}
function liveIdForFacadeKey(key, tabs) {
  return liveIdForKey(key, tabs.map((t3) => ({
    id: t3.tabId,
    extensionId: t3.extensionId,
    title: t3.title
  })));
}
function secondaryTabsAllPlaced(modelSecondaryKeys, tabs, listIds) {
  const present = new Set(listIds);
  return modelSecondaryKeys.every((key) => {
    const liveId = liveIdForFacadeKey(key, tabs);
    return liveId === null || present.has(liveId);
  });
}
function reassignSecondaryTabsFromModel(opts) {
  Promise.resolve().then(() => (init_secondary_drawer(), exports_secondary_drawer)).then(async ({ assignToSecondary: assignToSecondary2, activateSecondaryTab: activateSecondaryTab2, getActiveSecondaryTab: getActiveSecondaryTab2 }) => {
    setSuppressAutoActivation(true);
    const tabs = drawerObserver.getAllTabs();
    const modelSecondaryKeys = Array.from(getTabAssignments()).filter(([, side]) => side === "secondary").map(([key]) => key);
    const listIds = getSecondaryTabList() ? Array.from(getSecondaryTabList().querySelectorAll("button[data-tab-id]")).map((el) => el.getAttribute("data-tab-id")).filter((id) => !!id) : [];
    if (secondaryTabsAllPlaced(modelSecondaryKeys, tabs, listIds)) {
      dlog(`[secondary] open loop: all ${modelSecondaryKeys.length} secondary tabs already placed; skipping`);
      if (isSecondarySidebarOpen() && !getActiveSecondaryTab2() && listIds.length > 0) {
        const preferred = opts?.activateKey ? liveIdForFacadeKey(opts.activateKey, tabs) : null;
        const target = preferred && listIds.includes(preferred) ? preferred : listIds[0];
        dlog(`[secondary] open loop: showing "${target}" (placed, no active)`);
        setActiveSecondaryTabId(target);
        activateSecondaryTab2(target);
      }
      setSuppressAutoActivation(false);
      return;
    }
    const placed = [];
    const promises = Array.from(getTabAssignments()).filter(([, side]) => side === "secondary").map(async ([tabKey]) => {
      const liveId = liveIdForFacadeKey(tabKey, tabs);
      dlog(`[secondary] open loop: resolving ${tabKey} → liveId ${liveId}`);
      if (!liveId) {
        dlog(`[secondary] open loop: no live tab for facade key "${tabKey}"`);
        return;
      }
      const ok = await assignToSecondary2(liveId, opts).then(() => true).catch(() => false);
      if (ok)
        placed.push(liveId);
    });
    await Promise.all(promises);
    setSuppressAutoActivation(false);
    if (isSecondarySidebarOpen() && !getActiveSecondaryTab2() && placed.length > 0) {
      const preferred = opts?.activateKey ? liveIdForFacadeKey(opts.activateKey, tabs) : null;
      const target = preferred && placed.includes(preferred) ? preferred : placed[0];
      dlog(`[secondary] open loop: showing "${target}"${preferred && preferred !== target ? " (preferred missing)" : ""}`);
      setActiveSecondaryTabId(target);
      activateSecondaryTab2(target);
    }
  });
}
function persistSecondaryDrawerOpen(open) {
  Promise.resolve().then(() => (init_dispatch(), exports_dispatch)).then((m3) => {
    m3.dispatch({ t: "setDrawer", side: "secondary", open }).catch((err) => {
      dwarn("[secondary] persist secondary open state failed:", err);
    });
  });
}
function openSecondarySidebar() {
  dlog("[secondary] openSecondarySidebar:enter", {
    shellLive: isSecondaryShellLive(),
    drawerConnected: !!_secondaryDrawer?.isConnected,
    alreadyOpen: _secondarySidebarOpen,
    hasWrapper: !!_secondaryWrapper,
    enabled: getSettings().secondSidebarEnabled
  });
  if (!isSecondaryShellLive() || !_secondaryDrawer?.isConnected) {
    if (getSettings().secondSidebarEnabled) {
      ensureSecondaryShellMounted({ initialOpen: false });
    }
  }
  if (!isSecondaryShellLive() || !_secondaryDrawer?.isConnected) {
    dlog("[secondary] openSecondarySidebar:BAIL shell-not-live", {
      shellLive: isSecondaryShellLive(),
      drawerConnected: !!_secondaryDrawer?.isConnected
    });
    return;
  }
  if (_secondarySidebarOpen) {
    dlog("[secondary] openSecondarySidebar:BAIL already-open");
    reassignSecondaryTabsFromModel();
    return;
  }
  const wrapper = _secondaryWrapper;
  if (!wrapper) {
    dlog("[secondary] openSecondarySidebar:BAIL no-wrapper");
    return;
  }
  dlog("[secondary] openSecondarySidebar:opening", { mobile: isMobileViewport() });
  enforceExclusionOnOpen("secondary");
  animateWrapper(wrapper, 0);
  _secondarySidebarOpen = true;
  wrapper.dataset.drawerOpen = "true";
  markDrawerOpenState(true);
  syncDrawerTabSettings();
  updateDrawerTabVisibility();
  syncPanelHeaderFromMain2();
  updateChatReflow();
  reassignSecondaryTabsFromModel();
  persistSecondaryDrawerOpen(true);
  setMobileOpenClass("secondary", true);
}
function closeSecondarySidebar(options) {
  dlog("[secondary] closeSecondarySidebar", {
    silent: options?.silent,
    alreadyClosed: !_secondarySidebarOpen,
    caller: new Error("close callstack").stack?.split(`
`).slice(1, 4).join(" | ")
  });
  if (!_secondaryWrapper || !_secondaryDrawer)
    return;
  animateWrapper(_secondaryWrapper, getClosedTransformPx());
  _secondarySidebarOpen = false;
  _secondaryWrapper.dataset.drawerOpen = "false";
  markDrawerOpenState(false);
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
    persistSecondaryDrawerOpen(false);
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
function isSecondaryShellLive() {
  return !!(_secondaryWrapper && _secondaryWrapper.isConnected);
}
function ensureSecondaryShellMounted(options) {
  if (!getSettings().secondSidebarEnabled)
    return false;
  if (isSecondaryShellLive())
    return true;
  if (_secondaryWrapper && !_secondaryWrapper.isConnected) {
    _secondaryWrapper = null;
    _secondaryDrawer = null;
    _secondarySidebarOpen = false;
  }
  mountSecondarySidebar({
    initialWidth: options?.initialWidth,
    initialOpen: options?.initialOpen === true
  });
  return isSecondaryShellLive();
}
function mountSecondarySidebar(options) {
  if (_secondaryWrapper?.isConnected)
    return;
  if (_secondaryWrapper && !_secondaryWrapper.isConnected) {
    _secondaryWrapper = null;
    _secondaryDrawer = null;
    _secondarySidebarOpen = false;
  }
  _secondaryWrapper = createSecondarySidebar(options);
  document.body.appendChild(_secondaryWrapper);
  sweepOrphanSecondaryWrappers();
  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _secondaryWrapper.querySelector(".sidebar-ux-drawer"),
    tabList: _secondaryWrapper.querySelector(".sidebar-ux-tab-list"),
    handle: _secondaryWrapper.querySelector(".sidebar-ux-resize-handle")
  });
  reconcileTabListPin();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true;
    markDrawerOpenState(true);
  } else {
    markDrawerOpenState(false);
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
    const _liveTabs = getDrawerTabs().map((t3) => ({
      tabId: t3.id,
      extensionId: t3.extensionId,
      title: t3.title
    }));
    for (const [assignedKey] of Array.from(getTabAssignments())) {
      const tabId = liveIdForFacadeKey(assignedKey, _liveTabs) ?? assignedKey;
      const _isBuiltIn = _wSpindleUi?.getBuiltInTabRoot?.(tabId) != null;
      const _movedRoot = _secondaryWrapper?.querySelector(`.sidebar-ux-panel-content [data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`);
      const _domPlaced = !!_movedRoot?.hasAttribute("data-canvas-dom-placed");
      if (_isBuiltIn) {
        try {
          requestHostTabToMain(tabId);
        } catch (err) {
          if (_wSpindleUi?.requestTabLocation) {
            try {
              _wSpindleUi.requestTabLocation(tabId, { kind: "main-drawer" });
            } catch (err2) {
              dwarn(`[tabmove] teardown: requestTabLocation failed for tabId=${tabId}:`, err2);
            }
          } else {
            dwarn(`[tabmove] teardown: requestHostTabToMain failed for tabId=${tabId}:`, err);
          }
        }
      }
      if (!_isBuiltIn || _domPlaced) {
        if (_domPlaced) {
          restoreDomPlacedBuiltInToMain(tabId, _movedRoot);
        } else {
          if (_movedRoot && _movedRoot.parentElement) {
            try {
              _movedRoot.parentElement.removeChild(_movedRoot);
            } catch {}
          }
          if (_movedRoot) {
            _movedRoot.removeAttribute("data-canvas-moved");
            _movedRoot.removeAttribute("data-canvas-active");
            _movedRoot.removeAttribute("data-canvas-dom-placed");
            _movedRoot.style.removeProperty("position");
            _movedRoot.style.removeProperty("inset");
            _movedRoot.style.removeProperty("display");
          }
        }
      }
      showMainTabButton(tabId);
    }
    try {
      const wContainers = getHostBridge()?.containers;
      wContainers?.unregisterContainer?.("canvas-secondary-drawer");
    } catch (err) {
      dwarn("[tabmove] teardown: unregisterContainer failed:", err);
    }
    _secondaryWrapper.remove();
    _secondaryWrapper = null;
  }
  _secondaryDrawer = null;
  clearTabAssignments();
  _secondarySidebarOpen = false;
  setMobileOpenClass("secondary", false);
  updateChatReflow();
  Promise.resolve().then(() => (init_strip_gutter(), exports_strip_gutter)).then((m3) => m3.updateStripGutters());
  Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin)).then((m3) => m3.reconcileMainTabListPin()).catch((err) => {
    dwarn("[tabmove] teardown: reconcileMainTabListPin failed:", err);
  });
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
  init_host_tab_location();
  init_dom_placed_builtin();
  init_mobile_exclusion();
  init_animation();
  init_styles();
  init_tab_position();
  init_state();
  init_log();
  init_identity();
  init_drawer_observer();
  init_panel_header_sync();
  init_secondary_drawer();
  init_active_tab();
  init_drawer_shell();
  init_styles();
  init_animation();
});

// src/layout/snapshot.ts
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
  return false;
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
function readSecondaryWidth() {
  if (typeof document === "undefined")
    return 420;
  return parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420;
}
function snapshotLayout() {
  const assignments = getLiveIdAssignmentEntries();
  const secondaryAssignments = assignments.filter((a3) => a3.side === "secondary");
  const drawerTabs = getDrawerTabs();
  return {
    version: CANVAS_VERSION,
    primary: {
      open: readPrimaryOpen(),
      width: readPrimaryWidth(),
      tabId: null
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: readSecondaryWidth(),
      activeTabId: getActiveSecondaryTabId()
    },
    detachedTabs: secondaryAssignments.map(({ key, liveId }) => {
      const tab = drawerTabs.find((t3) => t3.id === liveId);
      return { tabId: liveId, tabTitle: key, sidebar: "secondary" };
    }),
    tabOrder: getHostDrawerSettings()?.tabOrder ?? [],
    hiddenTabIds: getCanvasHiddenTabIds()
  };
}
function hasDetachedTabs(layoutOrProfile) {
  if (!layoutOrProfile)
    return false;
  return Array.isArray(layoutOrProfile.detachedTabs) && layoutOrProfile.detachedTabs.length > 0;
}
function seedDualLayoutFromLive() {
  const live = snapshotLayout();
  const primaryWidth = live.primary?.width > 0 ? live.primary.width : 420;
  const seed = {
    version: live.version,
    primary: {
      open: live.primary?.open ?? false,
      width: primaryWidth,
      tabId: live.primary?.tabId ?? null
    },
    secondary: {
      open: false,
      width: primaryWidth,
      activeTabId: null
    },
    detachedTabs: [],
    hiddenTabIds: Array.isArray(live.hiddenTabIds) ? live.hiddenTabIds : getCanvasHiddenTabIds()
  };
  setLastLoadedLayout(seed);
}
function isOpenStatePersistenceEnabled() {
  return !!getSettings().persistDrawerOpenState;
}
function isWidthPersistenceEnabled() {
  return !!getSettings().persistDrawerWidth;
}
function buildPersistedLayout() {
  const live = snapshotLayout();
  const last = getLastLoadedLayout();
  const base = {
    primary: last?.primary ?? { open: false, width: 420 },
    secondary: last?.secondary ?? { open: false, width: 420 },
    detachedTabs: last?.detachedTabs ?? [],
    hiddenTabIds: Array.isArray(last?.hiddenTabIds) ? last.hiddenTabIds : []
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
    detachedTabs: tabsLive ? live.detachedTabs : base.detachedTabs ?? [],
    hiddenTabIds: Array.isArray(live.hiddenTabIds) ? live.hiddenTabIds : base.hiddenTabIds ?? [],
    tabOrder: Array.isArray(live.tabOrder) ? live.tabOrder : []
  };
}
var _lastKnownPrimaryWidth = null;
var init_snapshot = __esm(() => {
  init_secondary();
  init_styles();
  init_assignment();
  init_active_tab();
  init_canvas_hidden();
  init_host_settings();
  init_state();
  init_store();
});

// src/persist/settings-repo.ts
function setSettingsRepoBackendCtx(ctx) {
  _ctx2 = ctx;
}
function isSettingsRepoArmed() {
  return _armed2;
}
function armSettingsRepo() {
  _armed2 = true;
}
function disarmSettingsRepo() {
  _armed2 = false;
  for (const [id, { reject, timer }] of _pendingSaves2) {
    clearTimeout(timer);
    _pendingSaves2.delete(id);
    reject(new Error("settings repo disarmed"));
  }
}
function loadSettingsFromDisk() {
  const ctx = _ctx2;
  if (!ctx)
    return Promise.resolve({ status: "error", reason: "no backend" });
  return new Promise((resolve) => {
    let settled = false;
    let unsub = null;
    let attempts = 0;
    const startedAt2 = Date.now();
    function attempt() {
      if (settled)
        return;
      const handler = (payload) => {
        if (payload.type !== "SETTINGS_DATA")
          return;
        if (settled)
          return;
        settled = true;
        if (typeof unsub === "function")
          unsub();
        const result = payload && typeof payload === "object" && "result" in payload ? payload.result : null;
        if (result && typeof result === "object" && (result.status === "ok" || result.status === "empty" || result.status === "error")) {
          bootStep(`settings-load-resolved`, `attempt ${attempts} after ${Date.now() - startedAt2}ms (${result.status})`);
          resolve(result);
        } else {
          resolve({ status: "error", reason: "malformed response" });
        }
      };
      unsub = ctx.onBackendMessage(handler);
      attempts++;
      ctx.sendToBackend({ type: "LOAD_SETTINGS" });
      setTimeout(() => {
        if (settled)
          return;
        const elapsed = Date.now() - startedAt2;
        if (elapsed < getBootLoadWindowMs()) {
          if (typeof unsub === "function")
            unsub();
          if (attempts > 1 && attempts % 5 === 1) {
            bootWarn(`settings-load-still-pending`, `attempt ${attempts} no response after ${elapsed}ms — transport not ready (WS connecting or worker spawning)`);
          }
          attempt();
        } else {
          settled = true;
          if (typeof unsub === "function")
            unsub();
          const reason = `load timed out after ${attempts} attempts (${elapsed}ms)`;
          bootWarn(`settings-load-timeout`, reason);
          resolve({ status: "error", reason });
        }
      }, getBootLoadIntervalMs());
    }
    attempt();
  });
}
function saveSettingsToDisk(settings) {
  const ctx = _ctx2;
  if (!ctx)
    return Promise.resolve({ status: "error", reason: "no backend" });
  if (!_armed2)
    return Promise.resolve({ status: "error", reason: "not armed" });
  const id = ++_saveCounter2;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_pendingSaves2.has(id)) {
        _pendingSaves2.delete(id);
        resolve({ status: "error", reason: "save timed out" });
      }
    }, 5000);
    _pendingSaves2.set(id, { resolve, reject, timer });
    ctx.sendToBackend({ type: "SAVE_SETTINGS", settings: { version: 2, settings }, saveId: id });
  });
}
function __resolveSettingsSave(saveId, result) {
  const pending = _pendingSaves2.get(saveId);
  if (!pending)
    return;
  _pendingSaves2.delete(saveId);
  clearTimeout(pending.timer);
  pending.resolve(result);
}
function bindSettingsSaveResultBridge() {
  const ctx = _ctx2;
  if (!ctx)
    return () => {};
  return ctx.onBackendMessage((payload) => {
    if (!payload || payload.type !== "SAVE_SETTINGS_RESULT")
      return;
    const saveId = typeof payload.saveId === "number" ? payload.saveId : 0;
    const result = payload.result;
    if (result && typeof result === "object" && (result.status === "ok" || result.status === "error")) {
      __resolveSettingsSave(saveId, result);
    }
  });
}
var _ctx2 = null, _armed2 = false, _saveCounter2 = 0, _pendingSaves2;
var init_settings_repo = __esm(() => {
  init_boot_diag();
  init_layout_repo();
  _pendingSaves2 = new Map;
});

// src/settings/state.ts
var exports_state = {};
__export(exports_state, {
  setSingleLayoutSlot: () => setSingleLayoutSlot,
  setSettings: () => setSettings,
  setPanelRefresh: () => setPanelRefresh,
  setLastLoadedLayout: () => setLastLoadedLayout,
  setDualLayoutSlot: () => setDualLayoutSlot,
  refreshSettingsPanel: () => refreshSettingsPanel,
  persistSettings: () => persistSettings,
  normalizeCanvasSettings: () => normalizeCanvasSettings,
  isTaskbarModeEnabled: () => isTaskbarModeEnabled,
  isHideDrawerOpenCloseButtonsEnabled: () => isHideDrawerOpenCloseButtonsEnabled,
  isDragAndDropDrawerTabsEnabled: () => isDragAndDropDrawerTabsEnabled,
  hydrateSettings: () => hydrateSettings,
  hydrateModeLayoutSlots: () => hydrateModeLayoutSlots,
  getSingleLayoutSlot: () => getSingleLayoutSlot,
  getSettings: () => getSettings,
  getLastLoadedLayout: () => getLastLoadedLayout,
  getDualLayoutSlot: () => getDualLayoutSlot,
  cancelSettingsSave: () => cancelSettingsSave
});
function getSettings() {
  return _settings;
}
function setLastLoadedLayout(layout) {
  _lastLoadedLayout = layout;
}
function getLastLoadedLayout() {
  return _lastLoadedLayout;
}
function getSingleLayoutSlot() {
  return _singleLayout;
}
function setSingleLayoutSlot(layout) {
  _singleLayout = layout;
}
function getDualLayoutSlot() {
  return _dualLayout;
}
function setDualLayoutSlot(layout) {
  _dualLayout = layout;
}
function hydrateModeLayoutSlots(layout) {
  if (layout && typeof layout === "object") {
    if (layout.dualLayout !== undefined)
      _dualLayout = layout.dualLayout;
    if (layout.singleLayout !== undefined)
      _singleLayout = layout.singleLayout;
    dlog("[settings] mode layout slots hydrated", {
      singleSlot: _singleLayout != null,
      singleTabs: Array.isArray(_singleLayout?.tabOrder) ? _singleLayout.tabOrder.length : 0,
      dualSlot: _dualLayout != null,
      dualTabs: Array.isArray(_dualLayout?.detachedTabs) ? _dualLayout.detachedTabs.length : 0,
      drawerSide: layout.drawerSide ?? null
    });
  }
}
function setPanelRefresh(fn) {
  _panelRefresh = fn;
}
function normalizeCanvasSettings(s3) {
  return normalizeCanvasSettingsFields(s3);
}
function isTaskbarModeEnabled(s3 = _settings) {
  return !!s3.taskbarMode && !!s3.moveControlsToOuterEdge;
}
function isHideDrawerOpenCloseButtonsEnabled(s3 = _settings) {
  return !!s3.hideDrawerOpenCloseButtons && isTaskbarModeEnabled(s3);
}
function isDragAndDropDrawerTabsEnabled(s3 = _settings) {
  return !!s3.dragAndDropDrawerTabs && isTaskbarModeEnabled(s3);
}
function hydrateSettings(raw) {
  _settings = normalizeCanvasSettings(mergeCanvasSettings(raw ?? null));
}
function setSettings(patch) {
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
  if (!isSettingsRepoArmed()) {
    dlog("persistSettings: not armed, skipping");
    logPersistSave("persistSettings", null, { skipped: "not-armed" });
    return;
  }
  if (isLoadInProgress()) {
    dlog("persistSettings: load in progress, skipping");
    logPersistSave("persistSettings", null, { skipped: "load-in-progress", loadInProgress: true });
    return;
  }
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null;
    if (!isSettingsRepoArmed()) {
      dlog("persistSettings: not armed at debounce fire, skipping");
      logPersistSave("persistSettings:debounce", null, { skipped: "not-armed" });
      return;
    }
    const layoutSnapshot = buildPersistedLayout();
    dlog(`persistSettings: debounced firing (open=${_settings.persistDrawerOpenState}, width=${_settings.persistDrawerWidth}, snapshot.primary.open=${layoutSnapshot.primary.open}, snapshot.secondary.open=${layoutSnapshot.secondary.open})`);
    const backendCtx = getBackendCtx();
    if (backendCtx) {
      syncPersistDebugToBackend((msg) => backendCtx.sendToBackend(msg));
    }
    logPersistSave("persistSettings:debounce", { settings: _settings }, {
      loadInProgress: isLoadInProgress()
    });
    saveSettingsToDisk(_settings).then((r3) => {
      if (r3.status === "error") {
        console.warn("[canvas] saveSettingsToDisk failed:", r3.reason);
      }
    }).catch((err) => {
      console.warn("[canvas] saveSettingsToDisk rejected:", err);
    });
    setLastLoadedLayout({ ...layoutSnapshot, settings: _settings });
  }, 100);
}
function cancelSettingsSave() {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = null;
  }
}
var _settings, _lastLoadedLayout = null, _saveSettingsTimer = null, _singleLayout = null, _dualLayout = null, _panelRefresh = null;
var init_state = __esm(() => {
  init_types();
  init_log();
  init_persist_debug();
  init_panel();
  init_snapshot();
  init_layout_load();
  init_settings_repo();
  _settings = mergeCanvasSettings(null);
});

// src/tabs/tab-list-dnd.ts
function isLiveTabListDndAllowed() {
  return !isMobileViewport();
}
function shouldActivateDragFromDistance(dx, dy, threshold = DRAG_ACTIVATE_DISTANCE_PX) {
  return Math.sqrt(dx * dx + dy * dy) >= threshold;
}
function usesLongPressActivation(pointerType) {
  return pointerType === "touch" || pointerType === "pen";
}
function dndOrderSnapshot() {
  return {
    primary: readLivePrimaryTabIds(),
    secondary: readLiveSecondaryTabIds()
  };
}
function logDndOrder(label, extra = {}) {
  dlog("[tab-list-dnd]", label, { ...extra, live: dndOrderSnapshot() });
}
function injectDndStyles() {
  if (typeof document === "undefined")
    return;
  if (document.getElementById(DND_STYLE_ID))
    return;
  const style = document.createElement("style");
  style.id = DND_STYLE_ID;
  style.textContent = `
    /* ── Floating overlay clone (wrapper) — matches configure-modal overlay-clone treatment.
         pointer-events:none so synthetic click targets the real tab under the
         cursor (document capture suppressor can stop activation). ── */
    .canvas-tab-list-dnd-overlay-clone {
      position: fixed;
      z-index: 13000;
      pointer-events: none !important;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 10px;
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 8%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
      box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.45),
        0 0 0 1px var(--lumiverse-primary-040, var(--lumiverse-primary, #4a9eff));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      opacity: 1 !important;
      will-change: transform;
      cursor: grabbing;
    }
    /* Defense: never inherit invisible-placeholder opacity onto the float */
    .canvas-tab-list-dnd-overlay-clone .canvas-tab-list-dnd-placeholder,
    .canvas-tab-list-dnd-overlay-clone-btn.canvas-tab-list-dnd-placeholder {
      opacity: 1 !important;
      pointer-events: none !important;
    }

    /* ── Inner button clone — host CSS-module classes may not reflow the
         floating clone the same way; force tab-btn layout so icons stay
         centered (was left-biased after lift). ── */
    .canvas-tab-list-dnd-overlay-clone-btn {
      border: none !important;
      background: none !important;
      box-shadow: none !important;
      outline: none !important;
      width: 100% !important;
      height: 100% !important;
      flex-shrink: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 1px !important;
      padding: 0 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }

    /* ── Override label font for overlay clone (lost .sidebar-ux-tab-list ancestry) ── */
    .canvas-tab-list-dnd-overlay-clone .sidebar-ux-tab-label,
    .canvas-tab-list-dnd-overlay-clone span[class*="tabLabel"] {
      font-size: calc(9px * var(--lumiverse-font-scale, 1)) !important;
      font-weight: 500 !important;
      line-height: 1 !important;
      text-align: center !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      max-width: 48px !important;
      flex-shrink: 0 !important;
    }

    /* ── Icon wrap + svg sizing (host builtins = button>svg; mirror/secondary = span>svg) ── */
    .canvas-tab-list-dnd-overlay-clone-btn > span:first-child {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      width: 20px !important;
      height: 20px !important;
    }
    .canvas-tab-list-dnd-overlay-clone-btn svg {
      width: 20px !important;
      height: 20px !important;
      flex-shrink: 0 !important;
      display: block !important;
    }
    .canvas-tab-list-dnd-overlay-clone-btn img {
      width: 20px !important;
      height: 20px !important;
      flex-shrink: 0 !important;
      display: block !important;
    }

    /* ── Source button while being dragged — invisible slot holder (keeps
         layout / mid-drag FLIP geometry; floating overlay is the visible tab).
         transition:none while hidden so removing the class does not fade
         opacity via strip transition:all 0.2s. ── */
    .canvas-tab-list-dnd-placeholder {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
    }

    /* ── While dragging: strip buttons do not receive pointer hits.
         Overlay is pointer-events:none so the cursor would otherwise
         :hover the tab underneath (host hover glow/background). Hit-test
         uses document pointer coords, not elementFromPoint. ── */
    body.canvas-tab-list-dnd-dragging button[data-tab-id],
    body.canvas-tab-list-dnd-dragging .sidebar-ux-main-tab-mirror-btn,
    body.canvas-tab-list-dnd-dragging .sidebar-ux-tab-list button,
    body.canvas-tab-list-dnd-dragging .sidebar-ux-main-tab-list-mirror button {
      pointer-events: none !important;
    }

    /* ── FLIP animation on Canvas-owned list buttons during mid-drag reorder ── */
    .canvas-tab-list-dnd-flipping {
      transition: transform 200ms cubic-bezier(0.25, 1, 0.5, 1) !important;
    }

    /* ── Drop settle: floating clone eases into its destination slot ── */
    .canvas-tab-list-dnd-overlay-clone.canvas-tab-list-dnd-overlay-settling {
      transition:
        transform ${SETTLE_DURATION_MS2}ms cubic-bezier(0.25, 1, 0.5, 1),
        box-shadow ${SETTLE_DURATION_MS2}ms ease,
        opacity ${SETTLE_DURATION_MS2}ms ease !important;
      box-shadow: 0 2px 10px -4px rgba(0, 0, 0, 0.35),
        0 0 0 1px var(--lumiverse-border, #333);
      cursor: default;
      opacity: 0.92 !important;
    }
  `;
  document.head.appendChild(style);
}
function isSecondaryButton(btn) {
  if (btn.classList.contains(MIRROR_BTN_CLASS))
    return false;
  if (btn.closest(`.${MIRROR_LIST_CLASS}`))
    return false;
  return !!btn.closest(`.${TAB_LIST_CLASS}`);
}
function getButtonTabId(btn) {
  return buttonTabId(btn);
}
function isReorderableContainer(el) {
  if (el.classList.contains(MIRROR_MAIN_CLASS))
    return true;
  if (el.classList.contains(MIRROR_BOTTOM_CLASS))
    return true;
  if (el.classList.contains(MIRROR_LIST_CLASS))
    return true;
  if (el.classList.contains(TAB_LIST_CLASS) && !el.classList.contains(MIRROR_LIST_CLASS)) {
    return true;
  }
  return false;
}
function getReorderParent(btn) {
  if (btn.classList.contains(MIRROR_BTN_CLASS) || btn.closest(`.${MIRROR_LIST_CLASS}`)) {
    const section = btn.closest(`.${MIRROR_MAIN_CLASS}, .${MIRROR_BOTTOM_CLASS}`);
    return section ?? btn.parentElement;
  }
  if (isSecondaryButton(btn)) {
    const list = btn.closest(`.${TAB_LIST_CLASS}`);
    if (list && !list.classList.contains(MIRROR_LIST_CLASS))
      return list;
  }
  return null;
}
function getDropContainers() {
  const containers = [];
  if (getSecondaryWrapper()) {
    const secList = getSecondaryTabList();
    if (secList)
      containers.push({ el: secList, secondary: true });
  }
  const mirrorList = document.querySelector(`.${MIRROR_LIST_CLASS}`);
  if (mirrorList) {
    const main = mirrorList.querySelector(`:scope > .${MIRROR_MAIN_CLASS}`);
    if (main) {
      containers.push({ el: main, secondary: false });
    } else {
      containers.push({ el: mirrorList, secondary: false });
    }
  }
  return containers;
}
function getAllButtonsInContainer(container) {
  if (container.classList.contains(MIRROR_MAIN_CLASS) || container.classList.contains(MIRROR_BOTTOM_CLASS)) {
    return Array.from(container.querySelectorAll(`:scope > button.${MIRROR_BTN_CLASS}, :scope > button[data-tab-id]`));
  }
  if (container.classList.contains(MIRROR_LIST_CLASS)) {
    return Array.from(container.querySelectorAll(`button.${MIRROR_BTN_CLASS}`));
  }
  if (container.classList.contains(TAB_LIST_CLASS) && !container.classList.contains(MIRROR_LIST_CLASS)) {
    return Array.from(container.querySelectorAll(":scope > button[data-tab-id]"));
  }
  return Array.from(container.querySelectorAll("button[data-tab-id]"));
}
function isDisplayedTabButton(el) {
  return el.style?.display !== "none";
}
function domInsertIndexFromVisibleIndex(siblingHidden, toVisibleIndex) {
  const visibleCount = siblingHidden.reduce((n2, hidden) => n2 + (hidden ? 0 : 1), 0);
  const targetVis = toVisibleIndex < 0 ? visibleCount : Math.min(toVisibleIndex, visibleCount);
  if (targetVis >= visibleCount) {
    let lastVisible = -1;
    for (let i3 = 0;i3 < siblingHidden.length; i3++) {
      if (!siblingHidden[i3])
        lastVisible = i3;
    }
    return lastVisible + 1;
  }
  let seen = 0;
  for (let i3 = 0;i3 < siblingHidden.length; i3++) {
    if (siblingHidden[i3])
      continue;
    if (seen === targetVis)
      return i3;
    seen++;
  }
  return siblingHidden.length;
}
function getButtonsInContainer(container, _secondary, excludeTabId) {
  return getAllButtonsInContainer(container).filter((el) => {
    if (!isDisplayedTabButton(el))
      return false;
    if (excludeTabId && getButtonTabId(el) === excludeTabId) {
      return false;
    }
    return true;
  });
}
function buildDraftAndBase() {
  const catalog = filterCatalogToLive(getFullCatalog(), getHost(), new Set(getLiveIdAssignments().keys()));
  const hostSettings = getHostDrawerSettings();
  const currentAssignments = new Map(getLiveIdAssignments());
  const drawerSide = hostSettings?.side || getMainDrawerSide();
  const healedHidden = resolveHiddenTabIdsForDraft(mergeHiddenTabIdLists(hostSettings?.hiddenTabIds, getCanvasHiddenTabIds()), catalog.map((t3) => t3.id));
  const draftFromHost = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: healedHidden,
    drawerSide,
    assignments: currentAssignments
  });
  const livePrimary = readLivePrimaryTabIds();
  const liveSecondary = readLiveSecondaryTabIds();
  const draft = alignDraftToLiveVisibleOrder(draftFromHost, livePrimary, liveSecondary);
  dlog("[tab-list-dnd] draft-built (live order)", {
    livePrimary,
    liveSecondary,
    draftPrimary: draft.primaryIds,
    draftSecondary: draft.secondaryIds,
    hidden: [...draft.hiddenIds]
  });
  const base = {
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: healedHidden,
    drawerSide,
    assignments: new Map(currentAssignments)
  };
  return { draft, base, catalog };
}
function dragHitGeometry(overlayTx, overlayTy, overlayWidth, overlayHeight) {
  const w3 = Math.max(0, overlayWidth);
  const h4 = Math.max(0, overlayHeight);
  return {
    centerX: overlayTx + w3 / 2,
    centerY: overlayTy + h4 / 2,
    left: overlayTx,
    top: overlayTy,
    right: overlayTx + w3,
    bottom: overlayTy + h4
  };
}
function overlayOverlapsContainer(overlay, container, padY = 8, padX = 80) {
  const overlapsX = overlay.right > container.left - padX && overlay.left < container.right + padX;
  const overlapsY = overlay.bottom > container.top - padY && overlay.top < container.bottom + padY;
  return overlapsX && overlapsY;
}
function insertIndexFromMidpoints(y3, midpoints) {
  for (let i3 = 0;i3 < midpoints.length; i3++) {
    if (y3 < midpoints[i3])
      return i3;
  }
  return midpoints.length;
}
function hitTestDropTarget2(geom, dragTabId) {
  const containers = _geometryCache ? _geometryCache.containers : getDropContainers();
  let best = null;
  for (const { el: container, secondary } of containers) {
    const rect = container.getBoundingClientRect();
    if (!overlayOverlapsContainer(geom, rect))
      continue;
    const buttons = getButtonsInContainer(container, secondary, dragTabId);
    let index = 0;
    if (buttons.length > 0) {
      const midpoints = buttons.map((btn) => {
        const btnRect = btn.getBoundingClientRect();
        return btnRect.top + btnRect.height / 2;
      });
      index = insertIndexFromMidpoints(geom.centerY, midpoints);
      dlog("[tab-list-dnd] hit-test", {
        containerCls: String(container.className || ""),
        secondary,
        dragTabId,
        buttons: buttons.length,
        midpoints: midpoints.length,
        centerY: Math.round(geom.centerY),
        index
      });
    }
    const containerMidX = rect.left + rect.width / 2;
    const distX = Math.abs(geom.centerX - containerMidX);
    if (!best || distX < best.distX) {
      best = { container, index, secondary, distX };
    }
  }
  return best ? { container: best.container, index: best.index, secondary: best.secondary } : null;
}
function settleDestFromButtonRects(index, rects, emptyFallback) {
  if (rects.length === 0)
    return emptyFallback;
  if (index >= rects.length) {
    const last = rects[rects.length - 1];
    return { left: last.left, top: last.top + last.height };
  }
  const ref = rects[index];
  return { left: ref.left, top: ref.top };
}
function resolveSettleDestination(dragElement, tabId, target, overlayWidth) {
  if (dragElement && target && target.container.contains(dragElement)) {
    const r3 = dragElement.getBoundingClientRect();
    return { left: r3.left, top: r3.top };
  }
  if (target && tabId) {
    const buttons = getButtonsInContainer(target.container, target.secondary, tabId);
    const rects = buttons.map((b2) => {
      const r3 = b2.getBoundingClientRect();
      return { left: r3.left, top: r3.top, width: r3.width, height: r3.height };
    });
    const cr = target.container.getBoundingClientRect();
    const emptyFallback = {
      left: cr.left + Math.max(0, (cr.width - (overlayWidth || 48)) / 2),
      top: cr.top
    };
    return settleDestFromButtonRects(target.index, rects, emptyFallback);
  }
  if (dragElement) {
    const r3 = dragElement.getBoundingClientRect();
    return { left: r3.left, top: r3.top };
  }
  return null;
}
function animateOverlaySettle2(overlay, currentTx, currentTy, destLeft, destTop) {
  const dx = destLeft - currentTx;
  const dy = destTop - currentTy;
  if (Math.hypot(dx, dy) < SETTLE_MIN_DISTANCE_PX2) {
    overlay.style.transform = `translate3d(${destLeft}px, ${destTop}px, 0)`;
    return Promise.resolve({ tx: destLeft, ty: destTop });
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done)
        return;
      done = true;
      overlay.removeEventListener("transitionend", onEnd);
      if (_settleTimer2 !== null) {
        clearTimeout(_settleTimer2);
        _settleTimer2 = null;
      }
      resolve({ tx: destLeft, ty: destTop });
    };
    const onEnd = (e3) => {
      if (e3.target !== overlay)
        return;
      if (e3.propertyName && e3.propertyName !== "transform")
        return;
      finish();
    };
    overlay.addEventListener("transitionend", onEnd);
    overlay.classList.add("canvas-tab-list-dnd-overlay-settling");
    overlay.offsetWidth;
    overlay.style.transform = `translate3d(${destLeft}px, ${destTop}px, 0)`;
    _settleTimer2 = setTimeout(finish, SETTLE_DURATION_MS2 + 40);
  });
}
function cancelOverlaySettle2(overlay) {
  if (_settleTimer2 !== null) {
    clearTimeout(_settleTimer2);
    _settleTimer2 = null;
  }
  if (overlay) {
    overlay.classList.remove("canvas-tab-list-dnd-overlay-settling");
  }
}
function installDropSlotSpacer(placeholder) {
  if (!placeholder?.parentElement)
    return null;
  const parent = placeholder.parentElement;
  const rect = placeholder.getBoundingClientRect();
  const height = Math.max(Math.round(rect.height), 1);
  const spacer = document.createElement("div");
  spacer.className = "canvas-tab-list-dnd-slot-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.cssText = [
    `height:${height}px`,
    "width:100%",
    "flex-shrink:0",
    "pointer-events:none",
    "visibility:hidden",
    "box-sizing:border-box",
    "margin:0",
    "padding:0",
    "border:none"
  ].join(";");
  parent.insertBefore(spacer, placeholder.nextSibling);
  return spacer;
}
function removeDropSlotSpacer(spacer) {
  if (spacer?.isConnected)
    spacer.remove();
  if (typeof document !== "undefined") {
    for (const el of Array.from(document.querySelectorAll(".canvas-tab-list-dnd-slot-spacer"))) {
      el.remove();
    }
  }
}
function clearInsertIndicator() {
  if (_insertIndicatorEl) {
    _insertIndicatorEl.classList.remove("canvas-tab-list-dnd-insert-before");
    _insertIndicatorEl = null;
  }
  if (typeof document !== "undefined") {
    for (const el of Array.from(document.querySelectorAll(".canvas-tab-list-dnd-insert-before"))) {
      el.classList.remove("canvas-tab-list-dnd-insert-before");
    }
  }
}
function snapshotButtonRects(container) {
  const rects = new Map;
  for (const btn of getAllButtonsInContainer(container)) {
    const id = getButtonTabId(btn);
    if (id)
      rects.set(id, btn.getBoundingClientRect());
  }
  return rects;
}
function mergeRects(into, from) {
  for (const [k3, v3] of from)
    into.set(k3, v3);
}
function applyFLIP2(prevRects, excludeTabId, containers) {
  const animated = [];
  const seen = new Set;
  for (const container of containers) {
    for (const btn of getAllButtonsInContainer(container)) {
      if (seen.has(btn))
        continue;
      seen.add(btn);
      const id = getButtonTabId(btn);
      if (!id || id === excludeTabId || !prevRects.has(id))
        continue;
      const prev = prevRects.get(id);
      const curr = btn.getBoundingClientRect();
      const deltaY = prev.top - curr.top;
      if (Math.abs(deltaY) <= 0.5)
        continue;
      btn.style.setProperty("transition", "none", "important");
      btn.style.setProperty("transform", `translateY(${deltaY}px)`, "important");
      animated.push(btn);
    }
  }
  if (animated.length === 0)
    return;
  document.body.offsetHeight;
  requestAnimationFrame(() => {
    for (const node of animated) {
      node.style.setProperty("transition", "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)", "important");
      node.style.setProperty("transform", "", "important");
      node.style.removeProperty("transform");
    }
    if (_flipActiveTimer)
      clearTimeout(_flipActiveTimer);
    _flipActiveTimer = setTimeout(() => {
      for (const node of animated) {
        node.style.removeProperty("transition");
        node.style.removeProperty("transform");
      }
      _flipActiveTimer = null;
    }, 220);
  });
}
function clearFLIPStyles() {
  if (_flipActiveTimer) {
    clearTimeout(_flipActiveTimer);
    _flipActiveTimer = null;
  }
  const containers = _geometryCache?.containers ?? getDropContainers();
  for (const { el: container } of containers) {
    for (const btn of getAllButtonsInContainer(container)) {
      btn.style.removeProperty("transition");
      btn.style.removeProperty("transform");
    }
  }
}
function reorderCanvasListDOM(container, target, sourceTabId, dragElement) {
  if (!sourceTabId)
    return false;
  if (!isReorderableContainer(container))
    return false;
  const sourceBtn = dragElement && getButtonTabId(dragElement) === sourceTabId ? dragElement : getAllButtonsInContainer(container).find((b2) => getButtonTabId(b2) === sourceTabId) ?? null;
  if (!sourceBtn)
    return false;
  const buttonsWithoutSource = getAllButtonsInContainer(container).filter((b2) => b2 !== sourceBtn);
  const siblingHidden = buttonsWithoutSource.map((b2) => !isDisplayedTabButton(b2));
  const insertIdx = domInsertIndexFromVisibleIndex(siblingHidden, target.index);
  if (insertIdx >= buttonsWithoutSource.length) {
    if (sourceBtn.parentElement === container && sourceBtn.nextElementSibling === null) {
      return false;
    }
    container.appendChild(sourceBtn);
    return true;
  }
  const referenceBtn = buttonsWithoutSource[insertIdx];
  if (sourceBtn.parentElement === container && sourceBtn.nextElementSibling === referenceBtn) {
    return false;
  }
  container.insertBefore(sourceBtn, referenceBtn);
  return true;
}
function restoreSourceButtonDOM(dragElement, originalParent, originalNextSibling) {
  if (!dragElement || !originalParent)
    return;
  const parent = dragElement.parentNode;
  if (parent === originalParent) {
    if (originalNextSibling) {
      if (dragElement.nextElementSibling === originalNextSibling)
        return;
      originalParent.insertBefore(dragElement, originalNextSibling);
    } else {
      if (dragElement.nextElementSibling === null && dragElement.parentNode === originalParent)
        return;
      originalParent.insertBefore(dragElement, null);
    }
  } else {
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(dragElement, originalNextSibling);
    } else {
      originalParent.appendChild(dragElement);
    }
  }
}
function createDragOverlay2(sourceBtn) {
  const wrapper = document.createElement("div");
  wrapper.className = "canvas-tab-list-dnd-overlay-clone";
  const clone = sourceBtn.cloneNode(true);
  clone.classList.remove("canvas-tab-list-dnd-placeholder");
  clone.classList.add("canvas-tab-list-dnd-overlay-clone-btn");
  const rect = sourceBtn.getBoundingClientRect();
  wrapper.style.width = rect.width + "px";
  wrapper.style.height = rect.height + "px";
  wrapper.style.left = "0px";
  wrapper.style.top = "0px";
  wrapper.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return wrapper;
}
function suppressSyntheticClick(e3) {
  e3.preventDefault();
  e3.stopPropagation();
  e3.stopImmediatePropagation();
}
function installClickSuppressor(el) {
  removeClickSuppressorNow();
  _clickSuppressor = suppressSyntheticClick;
  _clickSuppressorEl = el;
  el.addEventListener("click", _clickSuppressor, true);
  _docClickSuppressor = suppressSyntheticClick;
  document.addEventListener("click", _docClickSuppressor, true);
}
function scheduleClickSuppressorRemoval() {
  if (_clickSuppressorTimer !== null)
    clearTimeout(_clickSuppressorTimer);
  _clickSuppressorTimer = setTimeout(() => {
    removeClickSuppressorNow();
  }, 0);
}
function removeClickSuppressorNow() {
  if (_clickSuppressorTimer !== null) {
    clearTimeout(_clickSuppressorTimer);
    _clickSuppressorTimer = null;
  }
  if (_clickSuppressor && _clickSuppressorEl) {
    _clickSuppressorEl.removeEventListener("click", _clickSuppressor, true);
  }
  _clickSuppressor = null;
  _clickSuppressorEl = null;
  if (_docClickSuppressor) {
    document.removeEventListener("click", _docClickSuppressor, true);
    _docClickSuppressor = null;
  }
}
function scheduleDragFrame() {
  if (_rafId !== null)
    return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    if (_drag.phase !== "dragging")
      return;
    if (_geomDirty || !_geometryCache) {
      _geometryCache = { containers: getDropContainers() };
      _geomDirty = false;
    }
    const geom = dragHitGeometry(_drag.overlayTx, _drag.overlayTy, _drag.overlayWidth || 48, _drag.overlayHeight || 48);
    const target = hitTestDropTarget2(geom, _drag.tabId);
    const prev = _drag.lastDropTarget;
    const sameTarget = prev && target && prev.container === target.container && prev.index === target.index && prev.secondary === target.secondary;
    if (!target) {
      if (prev) {
        clearInsertIndicator();
      }
      return;
    }
    if (!sameTarget) {
      const isReorderable = isReorderableContainer(target.container);
      const prevReorderable = prev ? isReorderableContainer(prev.container) : false;
      dlog("[tab-list-dnd] target change", {
        tabId: _drag.tabId,
        index: target.index,
        secondary: target.secondary,
        containerCls: String(target.container.className || ""),
        isReorderable,
        sourceIsInCanvasList: _drag.sourceIsInCanvasList,
        fromSecondary: _drag.fromSecondary
      });
      if (isReorderable && _drag.sourceIsInCanvasList) {
        const prevRects = new Map;
        const flipContainers = [];
        const sourceParent = _drag.element?.parentElement;
        if (sourceParent && isReorderableContainer(sourceParent)) {
          mergeRects(prevRects, snapshotButtonRects(sourceParent));
          flipContainers.push(sourceParent);
        }
        if (prev?.container && prev.container !== sourceParent) {
          mergeRects(prevRects, snapshotButtonRects(prev.container));
          if (!flipContainers.includes(prev.container)) {
            flipContainers.push(prev.container);
          }
        }
        mergeRects(prevRects, snapshotButtonRects(target.container));
        if (!flipContainers.includes(target.container)) {
          flipContainers.push(target.container);
        }
        const didReorder = reorderCanvasListDOM(target.container, target, _drag.tabId, _drag.element);
        if (didReorder) {
          applyFLIP2(prevRects, _drag.tabId, flipContainers);
          _geomDirty = true;
        }
      } else if (prevReorderable && !isReorderable && prev) {
        restoreSourceButtonDOM(_drag.element, _drag.originalParent, _drag.originalNextSibling);
        clearFLIPStyles();
        _geomDirty = true;
      }
      _drag.lastDropTarget = target;
    }
  });
}
function startDrag(btn, pointerEvent) {
  if (!isLiveTabListDndAllowed())
    return;
  const tabId = getButtonTabId(btn);
  if (!tabId) {
    dlog("[tab-list-dnd] startDrag bail: no tab id", {
      title: btn.getAttribute("title") || null,
      cls: String(btn.className || ""),
      mirrorKey: btn.getAttribute("data-mirror-key") || null
    });
    return;
  }
  const fromSecondary = isSecondaryButton(btn);
  const activeAtGestureStart = captureActiveSelection();
  const element = btn;
  const originalParent = btn.parentElement;
  const originalNextSibling = btn.nextElementSibling;
  const sourceIsInCanvasList = getReorderParent(btn) != null;
  logDndOrder("start", {
    tabId,
    fromSecondary,
    sourceIsInCanvasList,
    hasDataTabId: btn.hasAttribute("data-tab-id"),
    mirrorKey: btn.getAttribute("data-mirror-key") || null,
    reorderParent: sourceIsInCanvasList ? getReorderParent(btn)?.className : null
  });
  const rect = btn.getBoundingClientRect();
  const offsetX = pointerEvent.clientX - rect.left;
  const offsetY = pointerEvent.clientY - rect.top;
  const overlay = createDragOverlay2(btn);
  const overlayInner = overlay.querySelector(".canvas-tab-list-dnd-overlay-clone-btn");
  btn.classList.add("canvas-tab-list-dnd-placeholder");
  _geometryCache = { containers: getDropContainers() };
  _geomDirty = false;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";
  document.body.classList.add("canvas-tab-list-dnd-dragging");
  const suppressCtx = (e3) => {
    e3.preventDefault();
    e3.stopPropagation();
  };
  document.addEventListener("contextmenu", suppressCtx, true);
  installClickSuppressor(btn);
  const onMove = (ev) => {
    if (_drag.phase !== "dragging")
      return;
    _drag.overlayTx = ev.clientX - _drag.offsetX;
    _drag.overlayTy = ev.clientY - _drag.offsetY;
    _drag.overlay.style.transform = `translate3d(${_drag.overlayTx}px, ${_drag.overlayTy}px, 0)`;
    _pendingPointerX = ev.clientX;
    _pendingPointerY = ev.clientY;
    scheduleDragFrame();
  };
  const onUp = async (ev) => {
    ev.preventDefault();
    if (_drag.phase !== "dragging")
      return;
    const capturedTabId = tabId;
    const capturedFromSecondary = fromSecondary;
    const capturedActiveSelection = activeAtGestureStart;
    const capturedTarget = _drag.lastDropTarget;
    logDndOrder("pointerup", {
      tabId: capturedTabId,
      fromSecondary: capturedFromSecondary,
      target: capturedTarget ? {
        index: capturedTarget.index,
        secondary: capturedTarget.secondary,
        container: capturedTarget.container.className
      } : null
    });
    document.removeEventListener("contextmenu", suppressCtx, true);
    scheduleClickSuppressorRemoval();
    detachDragPointerListeners();
    _drag = {
      phase: "settling",
      tabId: capturedTabId,
      element,
      fromSecondary: capturedFromSecondary,
      activeAtGestureStart: capturedActiveSelection,
      overlay
    };
    clearInsertIndicator();
    let slotSpacer = null;
    try {
      if (capturedTarget && capturedTabId) {
        const crossList = capturedFromSecondary !== capturedTarget.secondary;
        const dest = resolveSettleDestination(element, capturedTabId, capturedTarget, rect.width);
        if (dest) {
          const currentTx = overlay.style.transform ? parseFloat(overlay.style.transform.match(/translate3d\(([^,]+)/)?.[1] || "0") : 0;
          const currentTy = overlay.style.transform ? parseFloat(overlay.style.transform.match(/translate3d\([^,]+,\s*([^,]+)/)?.[1] || "0") : 0;
          await animateOverlaySettle2(overlay, currentTx, currentTy, dest.left, dest.top);
        }
        if (crossList && capturedFromSecondary) {
          slotSpacer = installDropSlotSpacer(element);
          restoreSourceButtonDOM(element, originalParent, originalNextSibling);
        }
        let moveChrome = { neighborBtn: null, reassertId: null };
        let secondaryChrome = { neighborBtn: null };
        if (crossList && !capturedFromSecondary) {
          moveChrome = await captureMainMirrorMoveChrome(capturedTabId, "secondary");
          hideMainTabButton(capturedTabId);
        } else if (crossList && capturedFromSecondary) {
          secondaryChrome = await captureSecondaryNeighborForMove(capturedTabId);
        }
        const ok = await performDrop(capturedTabId, capturedFromSecondary, capturedActiveSelection, capturedTarget);
        logDndOrder("post-commit-before-cleanup", {
          tabId: capturedTabId,
          ok
        });
        if (ok && crossList) {
          try {
            if (!capturedFromSecondary) {
              await applyMainMirrorMoveChrome(moveChrome, capturedTabId);
            } else {
              await applySecondaryNeighborHandoff(secondaryChrome, capturedTabId);
            }
          } catch (err) {
            dwarn("[tab-list-dnd] post-commit cross-drawer chrome failed:", err);
          }
        } else if (!ok) {
          if (crossList && !capturedFromSecondary) {
            showMainTabButton(capturedTabId);
            try {
              const mp = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
              mp.reconcileMainTabListPin?.();
            } catch {}
          }
          restoreSourceButtonDOM(element, originalParent, originalNextSibling);
        }
      } else {
        restoreSourceButtonDOM(element, originalParent, originalNextSibling);
        const dest = resolveSettleDestination(element, capturedTabId, null, rect.width);
        if (dest) {
          const currentTx = overlay.style.transform ? parseFloat(overlay.style.transform.match(/translate3d\(([^,]+)/)?.[1] || "0") : 0;
          const currentTy = overlay.style.transform ? parseFloat(overlay.style.transform.match(/translate3d\([^,]+,\s*([^,]+)/)?.[1] || "0") : 0;
          await animateOverlaySettle2(overlay, currentTx, currentTy, dest.left, dest.top);
        }
      }
    } finally {
      removeDropSlotSpacer(slotSpacer);
      cancelOverlaySettle2(overlay);
      cleanupDragVisuals();
      logDndOrder("cleanup-complete", { tabId: capturedTabId });
    }
  };
  _drag = {
    phase: "dragging",
    tabId,
    element,
    fromSecondary,
    activeAtGestureStart,
    overlay,
    overlayInner,
    offsetX,
    offsetY,
    overlayTx: rect.left,
    overlayTy: rect.top,
    overlayWidth: rect.width,
    overlayHeight: rect.height,
    originalParent,
    originalNextSibling,
    sourceIsInCanvasList,
    lastDropTarget: null,
    moveHandler: onMove,
    upHandler: onUp
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}
function captureActiveSelection() {
  const world = getHost()?.observe();
  return {
    primary: world?.tabs.find((tab) => tab.location === "primary" && tab.isActiveInPrimary)?.key ?? null,
    secondary: world?.tabs.find((tab) => tab.location === "secondary" && tab.isActiveInSecondary)?.key ?? null
  };
}
function detachDragPointerListeners() {
  if (_drag.phase === "dragging") {
    document.removeEventListener("pointermove", _drag.moveHandler);
    document.removeEventListener("pointerup", _drag.upHandler);
    document.removeEventListener("pointercancel", _drag.upHandler);
  }
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _geometryCache = null;
  _geomDirty = false;
}
function clearDragState2() {
  detachDragPointerListeners();
  _drag = { phase: "idle" };
}
function cleanupDragVisuals() {
  clearFLIPStyles();
  if (_drag.phase === "dragging" || _drag.phase === "settling") {
    const el = _drag.element;
    el.style.setProperty("transition", "none", "important");
    el.classList.remove("canvas-tab-list-dnd-placeholder");
    el.offsetWidth;
    requestAnimationFrame(() => {
      el.style.removeProperty("transition");
    });
  }
  if (_drag.phase === "dragging" || _drag.phase === "settling") {
    const overlay = _drag.overlay;
    document.body.offsetWidth;
    overlay.remove();
  }
  clearInsertIndicator();
  if (typeof document !== "undefined") {
    document.body.classList.remove("canvas-tab-list-dnd-dragging");
  }
  _drag = { phase: "idle" };
}
async function performDrop(tabId, fromSecondary, activeAtGestureStart, target) {
  try {
    const { draft, base } = buildDraftAndBase();
    dlog("[tab-list-dnd]", "draft-built", {
      tabId,
      fromSecondary,
      target: { index: target.index, secondary: target.secondary },
      draft: {
        primary: draft.primaryIds,
        secondary: draft.secondaryIds
      },
      base: { tabOrder: base.tabOrder },
      live: dndOrderSnapshot()
    });
    if (fromSecondary !== target.secondary) {
      const targetSide = target.secondary ? "secondary" : "primary";
      const updated2 = moveTabVisible(draft, tabId, targetSide, target.index);
      const result2 = await commitDraftToOwnedModel(updated2, activeAtGestureStart, { skipChrome: true });
      dlog("[tab-list-dnd]", "cross-commit-result", {
        tabId,
        ok: result2.ok,
        updated: {
          primary: updated2.primaryIds,
          secondary: updated2.secondaryIds
        },
        live: dndOrderSnapshot()
      });
      if (!result2.ok) {
        dwarn("[tab-list-dnd] cross-drawer commit failed:", result2.error);
        return false;
      }
      const m4 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
      const modalWasOpen2 = m4.isConfigureTabsModalOpen();
      m4.refreshConfigureDraftFromLive();
      dlog("[tab-list-dnd] configure modal sync (cross-drawer)", {
        modalWasOpen: modalWasOpen2,
        refreshed: modalWasOpen2
      });
      return true;
    }
    const listKey = target.secondary ? "secondaryIds" : "primaryIds";
    const fullList = draft[listKey];
    if (!fullList.includes(tabId)) {
      dwarn("[tab-list-dnd] tab not found in draft for reorder:", tabId);
      return false;
    }
    const updated = reorderWithinVisible(draft, listKey, tabId, target.index);
    if (updated === draft && !isDraftDirty(draft, base)) {
      return true;
    }
    const result = await commitDraftToOwnedModel(updated, activeAtGestureStart, { skipChrome: true });
    dlog("[tab-list-dnd]", "reorder-commit-result", {
      tabId,
      ok: result.ok,
      updated: {
        primary: updated.primaryIds,
        secondary: updated.secondaryIds
      },
      live: dndOrderSnapshot()
    });
    if (!result.ok) {
      dwarn("[tab-list-dnd] reorder commit failed:", result.error);
      return false;
    }
    const m3 = await Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal));
    const modalWasOpen = m3.isConfigureTabsModalOpen();
    m3.refreshConfigureDraftFromLive();
    dlog("[tab-list-dnd] configure modal sync (reorder)", {
      modalWasOpen,
      refreshed: modalWasOpen
    });
    return true;
  } catch (err) {
    dwarn("[tab-list-dnd] drop failed:", err);
    return false;
  }
}
function installDragOnButton(btn) {
  if (_installed.has(btn))
    return;
  const tabId = getButtonTabId(btn);
  if (!tabId) {
    dlog("[tab-list-dnd] install skip: no tab id", {
      tag: btn.tagName,
      cls: String(btn.className || ""),
      title: btn.getAttribute("title") || null,
      aria: btn.getAttribute("aria-label") || null,
      hasDataTabId: btn.hasAttribute("data-tab-id"),
      mirrorKey: btn.getAttribute("data-mirror-key") || null,
      parentCls: btn.parentElement ? String(btn.parentElement.className || "") : null
    });
    return;
  }
  if (isSettingsButton(btn)) {
    dlog("[tab-list-dnd] install skip: settings", {
      title: btn.getAttribute("title") || null,
      cls: String(btn.className || "")
    });
    return;
  }
  _installed.add(btn);
  let longPressTimer = null;
  let dragActivated = false;
  let armingCancelled = false;
  let pendingPointerMove = null;
  let pendingPointerUp = null;
  let pendingPointerCancel = null;
  const cleanupPendingListeners = () => {
    if (pendingPointerMove) {
      document.removeEventListener("pointermove", pendingPointerMove);
      pendingPointerMove = null;
    }
    if (pendingPointerUp) {
      document.removeEventListener("pointerup", pendingPointerUp);
      pendingPointerUp = null;
    }
    if (pendingPointerCancel) {
      document.removeEventListener("pointercancel", pendingPointerCancel);
      pendingPointerCancel = null;
    }
  };
  const cancelArming = () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    cleanupPendingListeners();
  };
  const onPointerDown = (e3) => {
    if (!_active2)
      return;
    if (!isLiveTabListDndAllowed())
      return;
    if (e3.button !== 0)
      return;
    if (_drag.phase !== "idle")
      return;
    dlog("[tab-list-dnd] pointerdown arm", {
      tabId: getButtonTabId(btn),
      title: btn.getAttribute("title") || btn.getAttribute("aria-label") || null,
      hasDataTabId: btn.hasAttribute("data-tab-id"),
      cls: String(btn.className || ""),
      pointerType: e3.pointerType
    });
    dragActivated = false;
    armingCancelled = false;
    const startX = e3.clientX;
    const startY = e3.clientY;
    const longPress = usesLongPressActivation(e3.pointerType);
    if (longPress) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        cleanupPendingListeners();
        if (armingCancelled)
          return;
        if (!isLiveTabListDndAllowed())
          return;
        dragActivated = true;
        startDrag(btn, e3);
      }, LONG_PRESS_MS);
    }
    const onMove = (ev) => {
      if (dragActivated)
        return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (longPress) {
        if (shouldActivateDragFromDistance(dx, dy)) {
          armingCancelled = true;
          cancelArming();
        }
        return;
      }
      if (!shouldActivateDragFromDistance(dx, dy))
        return;
      dragActivated = true;
      cleanupPendingListeners();
      if (!isLiveTabListDndAllowed())
        return;
      startDrag(btn, ev);
    };
    const onUp = () => {
      cancelArming();
    };
    pendingPointerMove = onMove;
    pendingPointerUp = onUp;
    pendingPointerCancel = onUp;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  btn.addEventListener("pointerdown", onPointerDown);
}
function installTabListDnd() {
  if (_active2)
    return null;
  _active2 = true;
  dlog("[tab-list-dnd] install: diagnostic build active");
  injectDndStyles();
  const existing = document.querySelectorAll("button[data-tab-id], .sidebar-ux-main-tab-mirror-btn");
  for (const btn of existing) {
    installDragOnButton(btn);
  }
  dlog("[tab-list-dnd] install: existing buttons visited", { count: existing.length });
  _observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof HTMLElement))
          continue;
        if (node.tagName === "BUTTON" && (node.hasAttribute("data-tab-id") || node.classList.contains("sidebar-ux-main-tab-mirror-btn"))) {
          installDragOnButton(node);
        }
        const descendants = node.querySelectorAll("button[data-tab-id], .sidebar-ux-main-tab-mirror-btn");
        for (const child of descendants) {
          installDragOnButton(child);
        }
      }
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    tearDownTabListDnd();
  };
}
function tearDownTabListDnd() {
  _active2 = false;
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  if (_drag.phase !== "idle") {
    removeClickSuppressorNow();
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    if (_drag.phase === "dragging" || _drag.phase === "settling") {
      cancelOverlaySettle2(_drag.overlay);
    }
    if (_drag.phase === "dragging") {
      restoreSourceButtonDOM(_drag.element, _drag.originalParent, _drag.originalNextSibling);
    }
    cleanupDragVisuals();
    clearDragState2();
  }
  if (typeof document !== "undefined") {
    document.body.classList.remove("canvas-tab-list-dnd-dragging");
    document.getElementById(DND_STYLE_ID)?.remove();
  }
}
var DRAG_ACTIVATE_DISTANCE_PX = 6, LONG_PRESS_MS = 200, _drag, _clickSuppressor = null, _clickSuppressorEl = null, _docClickSuppressor = null, _clickSuppressorTimer = null, _rafId = null, _pendingPointerX = 0, _pendingPointerY = 0, _settleTimer2 = null, SETTLE_DURATION_MS2 = 140, SETTLE_MIN_DISTANCE_PX2 = 2, _geometryCache = null, _geomDirty = false, _insertIndicatorEl = null, _installed, _flipActiveTimer = null, DND_STYLE_ID = "canvas-tab-list-dnd-styles", MIRROR_LIST_CLASS = "sidebar-ux-main-tab-list-mirror", MIRROR_MAIN_CLASS = "sidebar-ux-tab-list-main", MIRROR_BOTTOM_CLASS = "sidebar-ux-tab-list-bottom", MIRROR_BTN_CLASS = "sidebar-ux-main-tab-mirror-btn", TAB_LIST_CLASS = "sidebar-ux-tab-list", _active2 = false, _observer = null;
var init_tab_list_dnd = __esm(() => {
  init_configure_model();
  init_owned_commit();
  init_dispatch();
  init_configure_catalog();
  init_canvas_hidden();
  init_hidden_tabs();
  init_host_settings();
  init_assignment();
  init_store();
  init_secondary();
  init_buttons();
  init_mobile_exclusion();
  init_log();
  init_live_tab_order();
  _drag = { phase: "idle" };
  _installed = new WeakSet;
});

// src/debug/fiber-scan.ts
function installDebugEscapeHatch() {
  window.__canvasDebug = function() {
    try {
      Promise.all([
        Promise.resolve().then(() => (init_state(), exports_state)),
        Promise.resolve().then(() => (init_secondary(), exports_secondary)),
        Promise.resolve().then(() => (init_assignment(), exports_assignment)),
        Promise.resolve().then(() => exports_host_bridge)
      ]).then(([state, secondary, assignment, bridgeMod]) => {
        const s3 = state.getSettings();
        const wrap = secondary.getSecondaryWrapper();
        const live = typeof secondary.isSecondaryShellLive === "function" ? secondary.isSecondaryShellLive() : !!(wrap && wrap.isConnected);
        const regs = bridgeMod.getHostBridge()?.containers?.registerContainer;
        const secondaryAssigned = [...assignment.getTabAssignments().entries()].filter(([, side]) => side === "secondary").map(([id]) => id);
        console.log("=== Canvas secondary / move diagnostics ===");
        console.log({
          secondSidebarEnabled: s3.secondSidebarEnabled,
          taskbarMode: s3.taskbarMode,
          shellLive: live,
          wrapperConnected: !!wrap?.isConnected,
          wrapperInDom: !!document.querySelector(".sidebar-ux-secondary-wrapper"),
          drawerOpen: secondary.isSecondarySidebarOpen(),
          tabList: !!secondary.getSecondaryTabList?.(),
          registerContainer: typeof regs === "function",
          secondaryAssigned
        });
      }).catch((err) => {
        console.warn("[__canvasDebug] secondary diagnostics failed:", err);
      });
    } catch (err) {
      console.warn("[__canvasDebug] secondary diagnostics setup failed:", err);
    }
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
  _ctx3 = {
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
  _ctx3.visible = true;
  renderGhostOverlay(ta, suffix, payload.range.end);
}
function hasGhost() {
  return _ctx3?.visible === true;
}
function acceptGhost(ta) {
  if (!_ctx3?.visible)
    return false;
  const { fullArg, range } = _ctx3;
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
  _ctx3 = null;
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
var GHOST_ID = "canvas-slash-ghost", STYLE_ID3 = "canvas-slash-ghost-styles", _ctx3 = null;
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
function installIntercept(_ctx4, callbacks) {
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
var init_dispatch2 = __esm(() => {
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
  init_dispatch2();
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
    init(_ctx4) {
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
    mount(_ctx4) {
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
    slashAlwaysCleanup
  ];
}
var SHADOW_DISABLE_DESKTOP_ID = "sidebar-ux-shadow-disable-desktop", SHADOW_DISABLE_MOBILE_ID = "sidebar-ux-shadow-disable-mobile", shadowDisableCss = (media, width) => `
  @media (${media}-width: ${width}px) {
    .sidebar-ux-drawer, :has(> [data-spindle-mount="sidebar"]) {
      box-shadow: none !important;
    }
  }
`, debugFeature, _chatReflowTeardown = null, chatReflowFeature, secondSidebarFeature, resizeSidebarsFeature, drawerSyncFeature, shadowsDesktopFeature, shadowsMobileFeature, persistDrawerOpenStateFeature, persistDrawerWidthFeature, _slashImpl, slashFeature, tabPositionFeature, taskbarModeFeature, hideDrawerOpenCloseButtonsFeature, dragAndDropDrawerTabsFeature, FEATURES;
var init_registry = __esm(() => {
  init_state();
  init_tab_list_dnd();
  init_log();
  init_fiber_scan();
  init_reflow();
  init_cleanup();
  init_secondary();
  init_handles();
  init_drawer_sync();
  init_layout_load();
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
    mount(_ctx4, layout) {
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
          const layout = getDualLayoutSlot() ?? getLastLoadedLayout();
          const initialWidth = s3.persistDrawerWidth ? layout?.secondary?.width : undefined;
          const hasTabsToRestore = (layout?.detachedTabs?.length ?? 0) > 0;
          const initialOpen = !!(s3.persistDrawerOpenState && layout?.secondary?.open === true && hasTabsToRestore);
          mountSecondarySidebar({ initialWidth, initialOpen });
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
  taskbarModeFeature = {
    id: "taskbarMode",
    mount(_ctx4, _layout) {
      const on = !!getSettings().taskbarMode && !!getSettings().moveControlsToOuterEdge;
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
      const on = !!next.taskbarMode && !!next.moveControlsToOuterEdge;
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
  dragAndDropDrawerTabsFeature = {
    id: "dragAndDropDrawerTabs",
    mount() {
      if (!isDragAndDropDrawerTabsEnabled())
        return;
      return installTabListDnd() ?? undefined;
    },
    apply(_prev, next) {
      if (isDragAndDropDrawerTabsEnabled(next)) {
        const teardown = installTabListDnd();
        if (teardown)
          registerCleanup(teardown);
      } else {
        tearDownTabListDnd();
      }
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
    taskbarModeFeature,
    hideDrawerOpenCloseButtonsFeature,
    dragAndDropDrawerTabsFeature,
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
    hint: 'Moves the list of tab buttons to be along the edge of the screen instead of the edge of the chat area. Required for "Taskbar mode".',
    control: moveControlsToOuter.btn
  }));
  const taskbarMode = makeToggle(() => getSettings().taskbarMode, (v3) => setSettings({ taskbarMode: v3 }), { disabled: () => !getSettings().moveControlsToOuterEdge });
  const taskbarModeRow = buildSettingRow({
    label: "Taskbar mode",
    hint: 'Pins tab buttons to the screen edge when a drawer is closed so you can switch tabs without opening it. Requires "Move tab controls to outer edge". Desktop only.',
    control: taskbarMode.btn,
    disabled: !getSettings().moveControlsToOuterEdge
  });
  secSidebars.appendChild(taskbarModeRow);
  const hideDrawerTabToggle = makeToggle(() => getSettings().hideDrawerOpenCloseButtons, (v3) => setSettings({ hideDrawerOpenCloseButtons: v3 }), { disabled: () => !getSettings().taskbarMode });
  const hideDrawerTabToggleRow = buildSettingRow({
    label: "Hide drawer open/close buttons",
    hint: 'Hides the small button that open/closes the drawer. Requires "Taskbar mode".',
    control: hideDrawerTabToggle.btn,
    disabled: !getSettings().taskbarMode
  });
  secSidebars.appendChild(hideDrawerTabToggleRow);
  const dragAndDropDrawerTabs = makeToggle(() => getSettings().dragAndDropDrawerTabs, (v3) => setSettings({ dragAndDropDrawerTabs: v3 }), { disabled: () => !getSettings().taskbarMode });
  const dragAndDropDrawerTabsRow = buildSettingRow({
    label: "Drag and drop drawer tabs",
    hint: 'Drag a tab button to reorder it within a drawer or move it to the other drawer (mouse: drag after a short move; touch: long-press). Requires "Taskbar mode". Desktop only (viewport wider than 600px); on mobile use Configure Tabs.',
    control: dragAndDropDrawerTabs.btn,
    disabled: !getSettings().taskbarMode
  });
  secSidebars.appendChild(dragAndDropDrawerTabsRow);
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
    taskbarMode.refresh();
    hideDrawerTabToggle.refresh();
    dragAndDropDrawerTabs.refresh();
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
      taskbarMode.btn.disabled = d3;
      taskbarMode.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      taskbarModeRow.classList.toggle("sidebar-ux-panel-row-disabled", d3);
    }
    {
      const d3 = !getSettings().taskbarMode;
      hideDrawerTabToggle.btn.disabled = d3;
      hideDrawerTabToggle.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      hideDrawerTabToggleRow.classList.toggle("sidebar-ux-panel-row-disabled", d3);
      dragAndDropDrawerTabs.btn.disabled = d3;
      dragAndDropDrawerTabs.btn.style.cursor = d3 ? "not-allowed" : "pointer";
      dragAndDropDrawerTabsRow.classList.toggle("sidebar-ux-panel-row-disabled", d3);
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

// src/frontend.ts
init_boot_diag();

// src/setup.ts
init_panel();

// src/layout/main-restore.ts
init_log();
init_snapshot();

// src/layout/parse-layout.ts
init_log();
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
  if (Array.isArray(input.hiddenTabIds)) {
    const ids = [];
    for (const id of input.hiddenTabIds) {
      if (typeof id === "string" && id.length > 0)
        ids.push(id);
    }
    out.hiddenTabIds = ids;
  }
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
    if (key === "primary" || key === "secondary" || key === "detachedTabs" || key === "version" || key === "settings" || key === "hiddenTabIds") {
      continue;
    }
    out[key] = input[key];
  }
  return out;
}

// src/layout/main-restore.ts
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

// src/setup.ts
init_layout_load();
init_layout_repo();
init_settings_repo();
init_tag_buttons();
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
init_dispatch();
init_state();
init_tab_context_menu();
init_buttons();
init_drawer_sync();
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
var _observer2 = null;
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
function stampHostTabLabelsMenuItem(menu) {
  const buttons = Array.from(menu.querySelectorAll("button"));
  if (buttons.length === 0)
    return;
  const norm = (t3) => (t3 ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const isLabelsLabel = (t3) => t3 === "hide tab labels" || t3 === "show tab labels";
  const isConfigureLabel = (t3) => t3 === "configure tabs";
  let btn = buttons.find((b2) => isLabelsLabel(norm(b2.textContent))) ?? null;
  if (!btn) {
    const looksLikeTabMenu = buttons.some((b2) => isConfigureLabel(norm(b2.textContent)));
    if (!looksLikeTabMenu) {
      dlog("[tabmove] stampHostTabLabelsMenuItem: skip non-tab menu");
      return;
    }
    btn = buttons[0] ?? null;
  }
  if (!btn)
    return;
  const show = isShowTabLabels();
  const label = show ? "Hide tab labels" : "Show tab labels";
  if (btn.textContent !== label) {
    btn.textContent = label;
  }
  btn.style.color = show ? "var(--lumiverse-error, #e54545)" : "var(--lumiverse-text)";
  dlog("[tabmove] stampHostTabLabelsMenuItem", { show, label });
}
function startObserver() {
  if (_observer2)
    return;
  _observer2 = new MutationObserver(() => {
    requestAnimationFrame(() => {
      const menu = findLumiverseContextMenu();
      if (!menu)
        return;
      if (menu.dataset.canvasLabelsSynced !== "1") {
        stampHostTabLabelsMenuItem(menu);
        menu.dataset.canvasLabelsSynced = "1";
      }
      if (_injected || !_pendingTabInfo) {
        if (!_pendingTabInfo)
          stopObserver();
        return;
      }
      injectCanvasItem(menu, _pendingTabInfo);
      _injected = true;
      _pendingTabInfo = null;
      stopObserver();
    });
  });
  _observer2.observe(document.body, { childList: true });
}
function stopObserver() {
  if (_observer2) {
    _observer2.disconnect();
    _observer2 = null;
  }
}
function injectCanvasItem(menu, info) {
  if (menu.dataset.canvasLabelsSynced !== "1") {
    stampHostTabLabelsMenuItem(menu);
    menu.dataset.canvasLabelsSynced = "1";
  }
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
    placementFirstMoveByLiveId(info.tabId, targetSidebar).catch((err) => {
      dwarn("[tabmove] context-menu placement-first move failed:", err);
      dispatchMoveByLiveId(info.tabId, false).catch((err2) => {
        dwarn("[tabmove] context-menu dispatchMoveByLiveId fallback also failed:", err2);
      });
    });
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
    const t3 = e3.target;
    const menu = document.querySelector(".canvas-tab-context-menu");
    if (menu && t3 && menu.contains(t3))
      return;
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
init_boot_diag();
init_persist_debug();
init_fiber_scan();

// src/tabs/configure-intercept.ts
init_host_settings();
init_drawer_sync();
init_log();
var _interceptActive = false;
var _clickHandler = null;
function normalizeMenuLabel(text) {
  return (text ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
function isConfigureTabsLabel(label) {
  return label === "configure tabs";
}
function isTabLabelsToggleLabel(label) {
  return label === "hide tab labels" || label === "show tab labels";
}
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
    const target = e3.target;
    if (!target || typeof target.closest !== "function")
      return;
    const btn = target.closest("button");
    if (!btn || !menu.contains(btn))
      return;
    const label = normalizeMenuLabel(btn.textContent);
    if (isTabLabelsToggleLabel(label)) {
      e3.preventDefault();
      e3.stopPropagation();
      e3.stopImmediatePropagation();
      dismissHostContextMenu();
      const showLabels = isShowTabLabels();
      const next = !showLabels;
      const ok = patchHostDrawerSettings({ showTabLabels: next });
      syncSecondaryTabLabels(next);
      if (ok) {
        requestAnimationFrame(() => syncSecondaryTabLabels(next));
      }
      dlog("[configure-intercept] intercepted Hide/Show tab labels", { next, ok, label });
      return;
    }
    if (!isConfigureTabsLabel(label))
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
init_styles();
init_state();
init_strip_gutter();
init_mobile_exclusion();
var WEAVER_LANE_STYLE_ID = "canvas-weaver-lane-styles";
var WEAVER_LANE_ATTR = "data-canvas-weaver-lane";
var WEAVER_INSET_L_VAR = "--sidebar-ux-weaver-inset-l";
var WEAVER_INSET_R_VAR = "--sidebar-ux-weaver-inset-r";
var PIN_HOST_SEL = ".sidebar-ux-tab-list-pin-host";
var _observer3 = null;
var _rafId2 = null;
var _active3 = false;
var _resizeListening = false;
var _pollTimer = null;
var _taggedDialog = null;
var _drawersClosedForWeaver = false;
var POLL_MS = 250;
function closeBothDrawersForWeaver() {
  Promise.resolve().then(() => (init_secondary(), exports_secondary)).then((m3) => {
    try {
      if (m3.isSecondarySidebarOpen())
        m3.closeSecondarySidebar();
    } catch (err) {
      dwarn("[weaver-lane] closeSecondarySidebar failed:", err);
    }
  }).catch((err) => dwarn("[weaver-lane] secondary import failed:", err));
  Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer)).then((m3) => {
    try {
      if (m3.isMainMirrorActive()) {
        if (m3.isCanvasMainOpen())
          m3.closeCanvasMainDrawer();
        return;
      }
    } catch (err) {
      dwarn("[weaver-lane] closeCanvasMainDrawer failed:", err);
    }
    closeHostMainDrawer();
  }).catch((err) => {
    dwarn("[weaver-lane] main-mirror import failed:", err);
    closeHostMainDrawer();
  });
}
function closeHostMainDrawer() {
  Promise.all([
    Promise.resolve().then(() => (init_store(), exports_store)),
    Promise.resolve().then(() => exports_lumiverse),
    Promise.resolve().then(() => (init_main_persist(), exports_main_persist))
  ]).then(([storeMod, dom, persist]) => {
    try {
      storeMod.findStoreData(true);
      const snap = storeMod.getStoreSnapshot();
      if (snap && typeof snap.closeDrawer === "function") {
        snap.closeDrawer();
        return;
      }
    } catch (err) {
      dwarn("[weaver-lane] store closeDrawer failed:", err);
    }
    try {
      const wrapper = dom.getMainWrapper();
      if (!wrapper)
        return;
      const cls = wrapper.classList?.toString?.() ?? String(wrapper.className || "");
      if (!cls.includes("wrapperOpen"))
        return;
      const btn = persist.findDrawerToggleButton(wrapper);
      if (btn) {
        try {
          btn.click();
        } catch {}
      }
    } catch (err) {
      dwarn("[weaver-lane] closeHostMainDrawer failed:", err);
    }
  }).catch((err) => dwarn("[weaver-lane] host main close import failed:", err));
}
function injectWeaverLaneStyles() {
  injectStyles(WEAVER_LANE_STYLE_ID, `
    [${WEAVER_LANE_ATTR}="1"] {
      position: fixed !important;
      inset: unset !important;
      top: 0 !important;
      bottom: 0 !important;
      left: var(${WEAVER_INSET_L_VAR}, 0px) !important;
      right: var(${WEAVER_INSET_R_VAR}, 0px) !important;
      /* Beat host --app-scaled-viewport-width which ignores strip insets. */
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    /* Host .shell uses 95vw of the full viewport — size to the strip lane. */
    [${WEAVER_LANE_ATTR}="1"] > * {
      width: min(100%, 1180px) !important;
      max-width: 100% !important;
      height: min(100%, 880px) !important;
      max-height: 100% !important;
      box-sizing: border-box !important;
      flex: 0 1 auto !important;
    }
  `);
}
function setImportant(el, prop, value) {
  el.style.setProperty(prop, value, "important");
}
function clearLaneInlineStyles(el) {
  for (const prop of [
    "position",
    "inset",
    "top",
    "bottom",
    "left",
    "right",
    "width",
    "height",
    "max-width",
    "max-height",
    "box-sizing",
    "overflow",
    "display",
    "align-items",
    "justify-content"
  ]) {
    el.style.removeProperty(prop);
  }
}
function clearShellInlineStyles(dialog) {
  const shell = dialog.firstElementChild;
  if (!shell)
    return;
  for (const prop of ["width", "max-width", "height", "max-height", "box-sizing", "flex"]) {
    shell.style.removeProperty(prop);
  }
}
function clearWeaverInsetVars() {
  if (typeof document === "undefined")
    return;
  const root = document.documentElement;
  root.style.removeProperty(WEAVER_INSET_L_VAR);
  root.style.removeProperty(WEAVER_INSET_R_VAR);
}
function measurePinStripInsets() {
  let left = 0;
  let right = 0;
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { left, right };
  }
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const cap = TAB_LIST_WIDTH_PX + 8;
  for (const el of document.querySelectorAll(PIN_HOST_SEL)) {
    const style = window.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden"))
      continue;
    const w3 = el.offsetWidth;
    if (w3 < 8)
      continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1)
      continue;
    const mid = rect.left + rect.width / 2;
    const strip = Math.min(w3, cap);
    if (mid < vw / 2)
      left = Math.max(left, strip);
    else
      right = Math.max(right, strip);
  }
  return { left, right };
}
function computeWeaverStripInsets() {
  if (typeof document === "undefined")
    return { left: 0, right: 0 };
  if (isMobileViewport())
    return { left: 0, right: 0 };
  if (!isTaskbarModeEnabled())
    return { left: 0, right: 0 };
  let gutters = { left: 0, right: 0 };
  try {
    gutters = computeStripGutters();
  } catch (err) {
    dwarn("[weaver-lane] computeStripGutters failed:", err);
  }
  const live = measurePinStripInsets();
  return {
    left: Math.max(gutters.left, live.left),
    right: Math.max(gutters.right, live.right)
  };
}
function applyLaneGeometry(dialog) {
  const insets = computeWeaverStripInsets();
  try {
    const root = document.documentElement;
    root.style.setProperty(WEAVER_INSET_L_VAR, `${insets.left}px`);
    root.style.setProperty(WEAVER_INSET_R_VAR, `${insets.right}px`);
  } catch (err) {
    dwarn("[weaver-lane] publish weaver inset vars failed:", err);
  }
  setImportant(dialog, "position", "fixed");
  setImportant(dialog, "inset", "unset");
  setImportant(dialog, "top", "0px");
  setImportant(dialog, "bottom", "0px");
  setImportant(dialog, "left", `${insets.left}px`);
  setImportant(dialog, "right", `${insets.right}px`);
  setImportant(dialog, "width", "auto");
  setImportant(dialog, "height", "auto");
  setImportant(dialog, "max-width", "none");
  setImportant(dialog, "max-height", "none");
  setImportant(dialog, "box-sizing", "border-box");
  setImportant(dialog, "overflow", "hidden");
  setImportant(dialog, "display", "flex");
  setImportant(dialog, "align-items", "center");
  setImportant(dialog, "justify-content", "center");
  const shell = dialog.firstElementChild;
  if (shell) {
    setImportant(shell, "width", "min(100%, 1180px)");
    setImportant(shell, "max-width", "100%");
    setImportant(shell, "height", "min(100%, 880px)");
    setImportant(shell, "max-height", "100%");
    setImportant(shell, "box-sizing", "border-box");
    setImportant(shell, "flex", "0 1 auto");
  }
}
function findWeaverDialog() {
  if (typeof document === "undefined")
    return null;
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  for (const d3 of dialogs) {
    const label = (d3.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("weaver"))
      return d3;
    if (d3.getAttribute(WEAVER_LANE_ATTR) === "1")
      return d3;
  }
  let modal = null;
  try {
    modal = getActiveModal(true);
  } catch (err) {
    dwarn("[weaver-lane] getActiveModal failed:", err);
  }
  if (modal === "weaver") {
    return document.querySelector('[role="dialog"][aria-modal="true"]');
  }
  return null;
}
function clearTaggedDialog() {
  if (_taggedDialog) {
    clearShellInlineStyles(_taggedDialog);
    clearLaneInlineStyles(_taggedDialog);
    _taggedDialog.removeAttribute(WEAVER_LANE_ATTR);
    _taggedDialog = null;
  } else if (typeof document !== "undefined") {
    const tagged = document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`);
    if (tagged) {
      clearShellInlineStyles(tagged);
      clearLaneInlineStyles(tagged);
      tagged.removeAttribute(WEAVER_LANE_ATTR);
    }
  }
  clearWeaverInsetVars();
  setResizeListening(false);
  setPoll(false);
  try {
    publishContentLaneInsets();
  } catch {}
}
function setResizeListening(on) {
  if (typeof window === "undefined")
    return;
  if (on && !_resizeListening) {
    window.addEventListener("resize", scheduleApply);
    _resizeListening = true;
  } else if (!on && _resizeListening) {
    window.removeEventListener("resize", scheduleApply);
    _resizeListening = false;
  }
}
function setPoll(on) {
  if (on && _pollTimer === null) {
    _pollTimer = setInterval(() => {
      if (!_active3) {
        setPoll(false);
        return;
      }
      scheduleApply();
    }, POLL_MS);
  } else if (!on && _pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
function applyWeaverLane() {
  if (!_active3)
    return;
  const dialog = findWeaverDialog();
  if (dialog) {
    if (_taggedDialog && _taggedDialog !== dialog) {
      clearShellInlineStyles(_taggedDialog);
      clearLaneInlineStyles(_taggedDialog);
      _taggedDialog.removeAttribute(WEAVER_LANE_ATTR);
    }
    dialog.setAttribute(WEAVER_LANE_ATTR, "1");
    _taggedDialog = dialog;
    applyLaneGeometry(dialog);
    setResizeListening(true);
    setPoll(true);
    if (!_drawersClosedForWeaver) {
      _drawersClosedForWeaver = true;
      closeBothDrawersForWeaver();
    }
    return;
  }
  if (_taggedDialog || typeof document !== "undefined" && document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`)) {
    clearTaggedDialog();
  }
  _drawersClosedForWeaver = false;
}
function scheduleApply() {
  if (_rafId2 !== null)
    return;
  _rafId2 = requestAnimationFrame(() => {
    _rafId2 = null;
    applyWeaverLane();
  });
}
function startWeaverLane() {
  if (_observer3) {
    return () => {};
  }
  injectWeaverLaneStyles();
  _active3 = true;
  scheduleApply();
  _observer3 = new MutationObserver(() => {
    if (!_active3)
      return;
    scheduleApply();
  });
  _observer3.observe(document.body, { childList: true, subtree: true });
  return () => {
    _active3 = false;
    if (_rafId2 !== null) {
      cancelAnimationFrame(_rafId2);
      _rafId2 = null;
    }
    if (_observer3) {
      _observer3.disconnect();
      _observer3 = null;
    }
    setPoll(false);
    clearTaggedDialog();
    _drawersClosedForWeaver = false;
  };
}

// src/host/lumiverse/implementation.ts
init_store();
init_host_settings();
init_assignment();
init_active_tab();
init_canvas_hidden();
init_secondary();
init_secondary_drawer();
init_buttons();
init_drawer_observer();
init_identity();
init_main_mirror_drawer();
init_secondary();
init_live_tab_order();
init_log();
var SECONDARY_WIDTH_VAR2 = "--canvas-secondary-width";
var DEFAULT_WIDTH = 420;
function readSecondaryWidth2() {
  if (typeof document === "undefined")
    return DEFAULT_WIDTH;
  return parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR2)) || DEFAULT_WIDTH;
}
function classifyTab(tabId, drawerExtensionId) {
  const bridge = getHostBridge();
  if (bridge?.ui?.getBuiltInTabRoot) {
    try {
      if (bridge.ui.getBuiltInTabRoot(tabId))
        return "builtin";
    } catch {}
  }
  return !drawerExtensionId || drawerExtensionId === "unknown" ? "builtin" : "extension";
}
function tabKeyFromDrawerTab(t3) {
  if (classifyTab(t3.id, t3.extensionId) === "builtin")
    return builtinKey(t3.id);
  return extensionKey(t3.extensionId || "unknown", t3.title);
}
function liveDrawerTabs() {
  return drawerObserver.getAllTabs().map((tab) => ({
    id: tab.tabId,
    extensionId: tab.extensionId === "unknown" ? "" : tab.extensionId,
    title: tab.title,
    root: tab.button,
    titles: tab.titles,
    key: tab.key ?? tabKeyFromDrawerTab({ id: tab.tabId, extensionId: tab.extensionId, title: tab.title })
  }));
}
function resolveTabKey(key) {
  return liveIdForKey(key, liveDrawerTabs());
}
function entryLocationFor(tab, assignments) {
  const direct = assignments.get(tab.key ?? tabKeyFromDrawerTab(tab));
  if (direct)
    return direct;
  for (const [facadeKey, side] of assignments) {
    const builtin = parseBuiltinKey(facadeKey);
    if (builtin && builtin === tab.title)
      return side;
    const ext = parseExtensionKey(facadeKey);
    if (ext && ext.tabName === tab.title)
      return side;
  }
  return "primary";
}
function buildHostEntry(tab) {
  const assignments = getTabAssignments();
  const location = entryLocationFor(tab, assignments);
  const key = tab.key;
  const canvasHidden = new Set(getCanvasHiddenTabIds());
  const hostSettings = getHostDrawerSettings();
  const hostHidden = hostSettings?.hiddenTabIds ? new Set(hostSettings.hiddenTabIds) : new Set;
  const isHidden3 = canvasHidden.has(tab.id) || hostHidden.has(tab.id);
  const primaryActive = resolvePrimaryActiveTabId();
  const secondaryActive = getActiveSecondaryTabId();
  return {
    key,
    liveId: tab.id,
    isBuiltin: !tab.extensionId,
    location,
    isHidden: isHidden3,
    isActiveInPrimary: primaryActive === tab.id,
    isActiveInSecondary: secondaryActive === tab.id,
    hasContentRoot: tab.root != null
  };
}
function buildEntryFromAssignment(tabKey) {
  const assignments = getTabAssignments();
  const location = assignments.get(tabKey) === "secondary" ? "secondary" : "primary";
  const canvasHidden = new Set(getCanvasHiddenTabIds());
  const isHidden3 = canvasHidden.has(tabKey);
  const primaryActive = resolvePrimaryActiveTabId();
  const secondaryActive = getActiveSecondaryTabId();
  return {
    key: tabKey,
    liveId: "",
    isBuiltin: false,
    location,
    isHidden: isHidden3,
    isActiveInPrimary: primaryActive === tabKey,
    isActiveInSecondary: secondaryActive === tabKey,
    hasContentRoot: false
  };
}

class LumiverseHost {
  _dispose = null;
  shutdown() {
    this._dispose?.();
    this._dispose = null;
  }
  observe() {
    findStoreData(true);
    const liveTabs = liveDrawerTabs();
    const seen = new Set;
    const entries = [];
    for (const t3 of liveTabs) {
      const key = t3.key;
      seen.add(key);
      entries.push(buildHostEntry(t3));
    }
    const liveByTitle = new Map;
    for (const t3 of liveTabs) {
      if (!liveByTitle.has(t3.title))
        liveByTitle.set(t3.title, t3.key);
    }
    const assignments = getTabAssignments();
    for (const [tabKey] of assignments) {
      if (seen.has(tabKey))
        continue;
      const title = parseBuiltinKey(tabKey) ?? parseExtensionKey(tabKey)?.tabName;
      if (title && liveByTitle.has(title))
        continue;
      entries.push(buildEntryFromAssignment(tabKey));
      seen.add(tabKey);
    }
    const secondaryIds = readVisibleTabIdsFromList(getSecondaryTabList());
    if (secondaryIds.length > 0) {
      const primaryEntries = entries.filter((e3) => e3.location !== "secondary");
      const secondaryEntries = entries.filter((e3) => e3.location === "secondary");
      const byLiveId = new Map(secondaryEntries.map((e3) => [e3.liveId, e3]));
      const ordered = [];
      const placed = new Set;
      for (const id of secondaryIds) {
        const entry = byLiveId.get(id);
        if (entry && !placed.has(id)) {
          ordered.push(entry);
          placed.add(id);
        }
      }
      for (const e3 of secondaryEntries) {
        if (!placed.has(e3.liveId))
          ordered.push(e3);
      }
      entries.length = 0;
      entries.push(...primaryEntries, ...ordered);
    }
    const drawerSide = getMainDrawerSide() === "left" ? "left" : "right";
    const primaryOpen = isMainDrawerOpen();
    const primaryWidth = getMainDrawerWidth() || DEFAULT_WIDTH;
    const secondaryOpen = isSecondarySidebarOpen();
    const secondaryWidth = readSecondaryWidth2();
    return {
      tabs: entries,
      inventory: drawerObserver.getSnapshot(),
      drawerSide,
      primaryOpen,
      primaryWidth,
      secondaryOpen,
      secondaryWidth
    };
  }
  resolve(key) {
    return resolveTabKey(key);
  }
  findKey(id) {
    const tabs = liveDrawerTabs();
    if (isBuiltinKey(id) || isExtensionKey(id)) {
      const live = liveIdForKey(id, tabs);
      if (live !== null) {
        const key = keyForLiveId(live, tabs);
        if (key !== null)
          return key;
      }
      return null;
    }
    return keyForLiveId(id, tabs);
  }
  async placeTab(id, to) {
    try {
      const assignments = getTabAssignments();
      const key = this.findKey(id) ?? id;
      const current = assignments.get(key) ?? "primary";
      if (current === to)
        return { placed: true };
      ensureSecondaryShellMounted({ initialOpen: false });
      if (to === "secondary") {
        await assignToSecondary(id);
        return { placed: true };
      } else {
        await unassignFromSecondary(id);
        return { placed: true };
      }
    } catch (e3) {
      return { placed: false, reason: String(e3) };
    }
  }
  async setOrder(side, ids) {
    try {
      dlog("[host] setOrder:start", { side, ids });
      if (side === "secondary") {
        if (!secondaryTabButtonsReady(ids)) {
          dlog("[host] setOrder:secondary-not-ready", { ids });
          return "degraded";
        }
        reorderSecondaryTabButtons(ids);
        return "ok";
      }
      const current = getHostDrawerSettings();
      const merged = {
        ...current ?? {},
        tabOrder: ids
      };
      reorderHostMainTabButtons(ids);
      reorderMainMirrorTabButtons(ids);
      dlog("[host] setOrder:dom-reordered", { side, ids });
      const ok = patchHostDrawerSettings(merged);
      dlog("[host] setOrder:settings-written", { side, ids, ok });
      return ok ? "ok" : "degraded";
    } catch {
      return "failed";
    }
  }
  async setHidden(_side, ids) {
    try {
      const current = getHostDrawerSettings();
      const side = _side;
      const assignments = getTabAssignments();
      const sideIds = new Set;
      for (const tab of liveDrawerTabs()) {
        const assignedSide = assignments.get(tab.key);
        if (assignedSide === "secondary" === (side === "secondary")) {
          sideIds.add(tab.id);
        }
      }
      for (const [key, assignedSide] of assignments) {
        if (assignedSide === "secondary" === (side === "secondary"))
          sideIds.add(key);
      }
      const currentHidden = Array.isArray(current?.hiddenTabIds) ? current.hiddenTabIds : [];
      const nextHidden = currentHidden.filter((id) => !sideIds.has(id));
      for (const id of ids) {
        if (!nextHidden.includes(id))
          nextHidden.push(id);
      }
      const canvasHidden = getCanvasHiddenTabIds().filter((id) => !sideIds.has(id));
      setCanvasHiddenTabIds([...canvasHidden, ...ids]);
      const effective = mergeHiddenTabIdLists(nextHidden, getCanvasHiddenTabIds());
      const merged = {
        ...current ?? {},
        hiddenTabIds: effective
      };
      applyHiddenTabIdsToMirror(new Set(effective));
      applyHiddenTabIdsToSecondary(new Set(effective));
      applyHiddenTabIdsToHostMain(new Set(effective));
      const ok = patchHostDrawerSettings(merged);
      return ok ? "ok" : "degraded";
    } catch {
      return "failed";
    }
  }
  async activate(side, id) {
    try {
      if (side === "secondary") {
        showSecondaryTab(id);
        return "ok";
      }
      const tabs = liveDrawerTabs();
      const tab = tabs.find((t3) => t3.id === id);
      if (!tab)
        return "degraded";
      const hostBtn = findMainTabButton(id);
      if (!hostBtn) {
        dlog("[host] activate: findMainTabButton returned null", { side, id });
        return "degraded";
      }
      const { activateMainMirrorFromRestore: activateMainMirrorFromRestore2 } = await Promise.resolve().then(() => (init_main_tab_pin(), exports_main_tab_pin));
      activateMainMirrorFromRestore2(hostBtn, tab.title);
      return "ok";
    } catch {
      return "failed";
    }
  }
  async setDrawer(side, s3) {
    try {
      if (side === "secondary") {
        if (s3.open) {
          openSecondarySidebar();
        } else {
          closeSecondarySidebar();
        }
        if (s3.width > 0 && typeof document !== "undefined") {
          document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR2, `${s3.width}px`);
        }
        return "ok";
      }
      const current = getHostDrawerSettings();
      if (current) {
        const patch = {};
        if (s3.width > 0) {
          patch.width = s3.width;
        }
        patchHostDrawerSettings({ ...current, ...patch });
      }
      const { applyMainMirrorDrawer: applyMainMirrorDrawer2, openCanvasMainDrawer: openCanvasMainDrawer2, closeCanvasMainDrawer: closeCanvasMainDrawer2 } = await Promise.resolve().then(() => (init_main_mirror_drawer(), exports_main_mirror_drawer));
      if (s3.open) {
        openCanvasMainDrawer2();
      } else {
        closeCanvasMainDrawer2();
      }
      if (s3.width > 0) {
        if (typeof document !== "undefined") {
          document.documentElement.style.setProperty("--canvas-main-mirror-width", `${s3.width}px`);
        }
      }
      return "ok";
    } catch {
      return "failed";
    }
  }
  async setSide(side) {
    try {
      const current = getHostDrawerSettings();
      const merged = { ...current ?? {}, side };
      let ok = patchHostDrawerSettings(merged);
      let bridge = "fiber";
      if (!ok) {
        ok = await writeHostDrawerSettingsViaApi({ side });
        bridge = "api";
      }
      if (ok) {
        try {
          const ds = await Promise.resolve().then(() => (init_drawer_sync(), exports_drawer_sync));
          await ds.applyMainDrawerSideChange(side);
        } catch (err) {
          dlog("[host] setSide: drawer-sync flip failed", String(err));
        }
      } else {
        bridge = "none";
        dlog(`[host] setSide: NO-GO — host cannot flip the drawer to "${side}"; model will converge on the real side`);
      }
      dlog("[host] setSide", { side, bridge, result: ok ? "ok" : "degraded" });
      return ok ? "ok" : "degraded";
    } catch {
      return "failed";
    }
  }
  onWorldChanged(cb) {
    let disposed = false;
    let scheduled = false;
    const notify = () => {
      if (disposed || scheduled)
        return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed)
          cb();
      });
    };
    const unreg1 = drawerObserver.onTabRegistered(notify);
    const unreg2 = drawerObserver.onTabUnregistered(notify);
    let sidebarObserver = null;
    const sidebar = getMainSidebar();
    if (sidebar) {
      sidebarObserver = new MutationObserver(notify);
      sidebarObserver.observe(sidebar, { childList: true, subtree: true });
    }
    let bodyObserver = null;
    if (!sidebar && typeof document !== "undefined" && document.body) {
      bodyObserver = new MutationObserver(() => {
        const readySidebar = getMainSidebar();
        if (!readySidebar || sidebarObserver || disposed)
          return;
        drawerObserver.start();
        sidebarObserver = new MutationObserver(notify);
        sidebarObserver.observe(readySidebar, { childList: true, subtree: true });
        bodyObserver?.disconnect();
        bodyObserver = null;
        notify();
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
    let mirrorObserver = null;
    const mirror = getMainMirrorDrawer();
    if (mirror) {
      mirrorObserver = new MutationObserver(notify);
      mirrorObserver.observe(mirror, {
        attributes: true,
        attributeFilter: ["class"],
        subtree: true
      });
    }
    const tabs = liveDrawerTabs();
    if (tabs.length > 0) {
      notify();
    }
    const dispose = () => {
      disposed = true;
      unreg1();
      unreg2();
      sidebarObserver?.disconnect();
      bodyObserver?.disconnect();
      mirrorObserver?.disconnect();
    };
    this._dispose = dispose;
    return dispose;
  }
}

// src/setup.ts
init_dispatch();
var _setupGeneration = 0;
function setup(ctx) {
  const generation = ++_setupGeneration;
  bootStep(`setup-start gen=${generation}`);
  const cancelBootWatchdog = armBootWatchdog(() => {
    if (generation === _setupGeneration) {
      bootError(`setup-stall gen=${generation}`, new Error("boot did not finish in time"));
    }
  });
  dlog(`start gen=${generation}`);
  cancelLoadSavedLayout({ preserveGuard: true });
  cleanupAll();
  setBackendCtx(ctx);
  setLayoutRepoBackendCtx(ctx);
  setSettingsRepoBackendCtx(ctx);
  const unsubLayoutSaveResults = bindLayoutSaveResultBridge();
  const unsubSettingsSaveResults = bindSettingsSaveResultBridge();
  registerCleanup(() => {
    unsubLayoutSaveResults();
    unsubSettingsSaveResults();
  });
  setHostBridgeContext(ctx);
  syncPersistDebugToBackend((msg) => ctx.sendToBackend(msg));
  plog(`setup start gen=${generation}`);
  let active = true;
  const isCurrent = () => active && generation === _setupGeneration;
  beginMainDrawerRestoreGuard();
  registerCleanup(unsuppressMainDrawer);
  registerCleanup(() => {
    if (generation === _setupGeneration)
      setHostBridgeContext(null);
  });
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
    try {
      flushPendingSaves();
    } catch (err) {
      dwarn("flushPendingSaves on teardown failed:", err);
    }
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
  Promise.all([
    loadLayoutFromDisk().catch((err) => {
      dwarn("Canvas: loadLayoutFromDisk failed:", err);
      return { status: "error", reason: String(err) };
    }),
    loadSettingsFromDisk().catch((err) => {
      dwarn("Canvas: loadSettingsFromDisk failed:", err);
      return { status: "error", reason: String(err) };
    })
  ]).then(async ([layoutResult, settingsResult]) => {
    dlog(`load resolved gen=${generation} layoutStatus=${layoutResult.status} settingsStatus=${settingsResult.status}`);
    bootStep(`loads-resolved gen=${generation}`, `layout=${layoutResult.status} settings=${settingsResult.status}`);
    if (!isCurrent()) {
      plog(`setup load ignored stale gen=${generation} current=${_setupGeneration}`);
      cancelBootWatchdog();
      return;
    }
    if (settingsResult.status === "ok" || settingsResult.status === "empty") {
      armSettingsRepo();
    } else {
      dwarn(`Canvas: settings load ${settingsResult.status}: ${settingsResult.reason ?? "unknown"}`);
    }
    if (layoutResult.status === "ok" || layoutResult.status === "empty") {
      armLayoutRepo();
    } else {
      dwarn(`Canvas: layout load ${layoutResult.status}: ${layoutResult.reason ?? "unknown"}`);
    }
    const layout = layoutResult.status === "ok" ? layoutResult.data : null;
    if (layout?.version && layout.version !== CANVAS_VERSION) {
      dwarn(`Layout was saved by v${layout.version}, running v${CANVAS_VERSION}. ` + `Hard-refresh (Ctrl+F5) to load the updated extension.`);
    }
    const settingsPayload = settingsResult.status === "ok" ? settingsResult.data : null;
    hydrateSettings(settingsPayload?.settings ?? null);
    setDebug(getSettings().debugMode);
    setLastLoadedLayout(layout);
    try {
      const { hydrateModeLayoutSlots: hydrateModeLayoutSlots2 } = await Promise.resolve().then(() => (init_state(), exports_state));
      hydrateModeLayoutSlots2(layout);
    } catch {}
    logPersistLoad("hydrate", {
      layout: layout ?? null,
      generation,
      reason: layout == null ? "null-layout→defaults" : "from-disk"
    });
    if (layout == null) {
      plog(`hydrate applied in-memory defaults (disk layout was null)`);
    }
    bootStep(`hydrate gen=${generation}`, layout == null ? "in-memory defaults (layout was null)" : "from-disk");
    try {
      const { hydrateCanvasHiddenFromLayout: hydrateCanvasHiddenFromLayout3 } = await Promise.resolve().then(() => (init_hidden_tabs(), exports_hidden_tabs));
      hydrateCanvasHiddenFromLayout3(layout);
    } catch {}
    refreshSettingsPanel();
    if (getSettings().debugMode)
      installDebugEscapeHatch();
    try {
      const ok = await ensureUiPanelsPermission();
      if (!ok) {
        dwarn("Canvas: ui_panels permission not granted — built-in tab moves to " + "the second drawer will fail until the user grants panel access.");
      }
    } catch (err) {
      dwarn("Canvas: ensureUiPanelsPermission failed:", err);
    }
    if (!isCurrent())
      return;
    beginMainDrawerRestoreGuard();
    for (const feature of FEATURES) {
      if (!isCurrent())
        return;
      feature.init?.(ctx);
    }
    for (const feature of FEATURES) {
      if (!isCurrent())
        return;
      if (!feature.mount)
        continue;
      if (!getSettings()[feature.id])
        continue;
      dlog(`mounting feature ${String(feature.id)}`);
      const teardown = feature.mount(ctx, layout);
      if (typeof teardown === "function")
        registerCleanup(teardown);
      dlog(`mounted feature ${String(feature.id)}`);
    }
    dlog(`all features mounted`);
    bootStep(`features-mounted gen=${generation}`);
    dlog(`startSideChangeWatcher`);
    startSideChangeWatcher();
    dlog(`startSideChangeWatcher done`);
    dlog(`startMainDrawerPersistence`);
    startMainDrawerPersistence();
    dlog(`startMainDrawerPersistence done`);
    registerCleanup(stopMainDrawerPersistence);
    dlog(`startMobileExclusion`);
    registerCleanup(startMobileExclusion());
    dlog(`startMobileExclusion done`);
    dlog(`drawerObserver.onTabRegistered`);
    drawerObserver.onTabRegistered(() => {
      tagMainSidebarButtons();
      Promise.resolve().then(() => (init_hidden_tabs(), exports_hidden_tabs)).then((m3) => {
        m3.scheduleSyncHiddenTabsFromHost({ writeBack: true });
      }).catch(() => {});
      Promise.resolve().then(() => (init_configure_modal(), exports_configure_modal)).then((m3) => {
        m3.refreshConfigureDraftFromLive();
      }).catch(() => {});
    });
    dlog(`drawerObserver.start`);
    drawerObserver.start();
    dlog(`drawerObserver.start done`);
    dlog(`initSecondaryDrawer`);
    initSecondaryDrawer(ctx);
    dlog(`initSecondaryDrawer done`);
    dlog(`startContextMenuListener`);
    startContextMenuListener();
    dlog(`startContextMenuListener done`);
    registerCleanup(stopContextMenuListener);
    dlog(`startConfigureTabsIntercept`);
    startConfigureTabsIntercept();
    dlog(`startConfigureTabsIntercept done`);
    registerCleanup(stopConfigureTabsIntercept);
    dlog(`startWeaverLane`);
    registerCleanup(startWeaverLane());
    dlog(`startWeaverLane done`);
    registerCleanup(() => {
      teardownSecondaryDrawer();
    });
    dlog(`new LumiverseHost`);
    const coreHost = new LumiverseHost;
    try {
      dlog(`bootstrapFromLayout:start`);
      bootstrapFromLayout(layout, coreHost, CANVAS_VERSION);
      dlog(`bootstrapFromLayout:returned (async reconcile still in flight)`);
      bootStep(`bootstrap gen=${generation}`);
    } catch (bootstrapErr) {
      dlog(`bootstrapFromLayout:threw`, bootstrapErr);
      bootError(`bootstrapFromLayout gen=${generation}`, bootstrapErr);
      dwarn("Canvas: bootstrapFromLayout threw synchronously:", bootstrapErr);
      throw bootstrapErr;
    }
    registerCleanup(() => {
      shutdown();
      coreHost.shutdown();
    });
    dlog(`applyMainDrawer:pre`);
    const s3 = getSettings();
    const restoreOpen = !!s3.persistDrawerOpenState;
    const restoreWidth = !!s3.persistDrawerWidth;
    if (restoreOpen || restoreWidth) {
      dlog(`applyMainDrawer:call`);
      applyMainDrawer(layout);
      dlog(`applyMainDrawer:returned (async restore in flight)`);
    } else {
      dlog(`applyMainDrawer:skipped (no restore flags)`);
      unsuppressMainDrawer();
    }
    dlog(`setup():.then end gen=${generation}`);
    cancelBootWatchdog();
    bootStep(`setup-done gen=${generation}`, `elapsed since start`);
  }).catch((err) => {
    dlog(`setup():.then caught error gen=${generation}`, err);
    cancelBootWatchdog();
    bootError(`setup gen=${generation}`, err);
    if (!isCurrent())
      return;
    dwarn("Canvas: split persistence load failed, mounting with defaults:", err);
    logPersistLoad("null-response", {
      reason: "load-promise-reject",
      generation,
      layout: null
    });
    disarmLayoutRepo();
    disarmSettingsRepo();
    try {
      unsuppressMainDrawer();
    } catch {}
  });
  let disposed = false;
  return () => {
    if (disposed)
      return;
    disposed = true;
    active = false;
    cancelBootWatchdog();
    if (generation !== _setupGeneration)
      return;
    plog(`setup teardown gen=${generation}`);
    cleanupAll();
    cancelLoadSavedLayout();
    if (getBackendCtx() === ctx)
      setBackendCtx(null);
  };
}

// src/frontend.ts
installBootDiag();
export {
  setup
};
