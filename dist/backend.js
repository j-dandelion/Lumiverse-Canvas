// @bun
// src/backend.ts
var STORAGE_KEY = "layout.json";
var STORAGE_TMP_KEY = STORAGE_KEY + ".tmp";
var DEBUG = false;
var saveQueue = Promise.resolve();
async function loadLayout() {
  try {
    const data = await spindle.storage.read(STORAGE_KEY);
    if (data && typeof data === "string") {
      return JSON.parse(data);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (DEBUG)
      spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`);
  }
  return null;
}
async function saveLayout(state) {
  const json = JSON.stringify(state, null, 2);
  try {
    await spindle.storage.write(STORAGE_TMP_KEY, json);
    try {
      await spindle.storage.move(STORAGE_TMP_KEY, STORAGE_KEY);
    } catch (moveErr) {
      const mmsg = moveErr instanceof Error ? moveErr.message : String(moveErr);
      if (DEBUG)
        spindle.log.warn(`[SidebarUX] Atomic move failed, falling back to direct write: ${mmsg}`);
      await spindle.storage.write(STORAGE_KEY, json);
      try {
        await spindle.storage.delete(STORAGE_TMP_KEY);
      } catch {}
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (DEBUG)
      spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`);
  }
}
spindle.onFrontendMessage(async (payload) => {
  if (payload.type === "SET_DEBUG") {
    DEBUG = !!payload.debug;
    return;
  }
  if (payload.type === "SAVE_LAYOUT") {
    saveQueue = saveQueue.then(() => saveLayout(payload.layout)).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (DEBUG)
        spindle.log.warn(`[SidebarUX] Queued layout save failed: ${msg}`);
    });
    await saveQueue;
  } else if (payload.type === "LOAD_LAYOUT") {
    await saveQueue;
    const layout = await loadLayout();
    spindle.sendToFrontend({ type: "LAYOUT_DATA", layout });
  }
});
