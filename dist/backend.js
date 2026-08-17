// @bun
// src/persist/migration.ts
function migrateLegacyPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const source = parsed;
  if (source.version === 2 || source.version === "2")
    return null;
  const layout = { ...source };
  const settings = layout.settings;
  delete layout.settings;
  layout.version = 2;
  return {
    layout,
    settings: { version: 2, settings: settings && typeof settings === "object" ? settings : {} }
  };
}

// src/persist/corrupt-file.ts
function buildCorruptKey(key, ts) {
  return key.replace(/\.json$/, `.corrupt-${ts}.json`);
}
async function moveCorruptFile(storage, key, now = Date.now) {
  const ts = now();
  const corruptKey = buildCorruptKey(key, ts);
  try {
    await storage.move(key, corruptKey);
    return corruptKey;
  } catch {
    return null;
  }
}

// src/backend.ts
var LAYOUT_KEY = "layout.json";
var SETTINGS_KEY = "settings.json";
var LAYOUT_TMP_KEY = LAYOUT_KEY + ".tmp";
var SETTINGS_TMP_KEY = SETTINGS_KEY + ".tmp";
var DEBUG = false;
var PERSIST_DEBUG = false;
function pblog(...args) {
  if (!DEBUG && !PERSIST_DEBUG)
    return;
  try {
    spindle.log.info(`[SidebarUX][persist] ${args.map(String).join(" ")}`);
  } catch {}
}
var saveQueue = Promise.resolve();
async function readJsonFile(key) {
  let data;
  try {
    data = await spindle.storage.read(key);
  } catch {
    return null;
  }
  if (data && typeof data === "string")
    return { data, bytes: data.length };
  return null;
}
async function atomicWrite(key, tmpKey, json) {
  await spindle.storage.write(tmpKey, json);
  try {
    await spindle.storage.move(tmpKey, key);
  } catch (moveErr) {
    const mmsg = moveErr instanceof Error ? moveErr.message : String(moveErr);
    if (DEBUG || PERSIST_DEBUG) {
      spindle.log.warn(`[SidebarUX] Atomic move failed, falling back to direct write: ${mmsg}`);
    }
    await spindle.storage.write(key, json);
    try {
      await spindle.storage.delete(tmpKey);
    } catch {}
  }
}
function currentVersion() {
  return 2;
}
function makePayload(version, data) {
  return { status: "ok", data };
}
function emptyResult() {
  return { status: "empty" };
}
function errorResult(reason) {
  return { status: "error", reason };
}
async function tryMigrateV1ToV2(raw) {
  const migrated = migrateLegacyPayload(raw);
  if (migrated) {
    const layoutJson = JSON.stringify(migrated.layout, null, 2);
    const settingsJson = JSON.stringify(migrated.settings, null, 2);
    await atomicWrite(LAYOUT_KEY, LAYOUT_TMP_KEY, layoutJson);
    await atomicWrite(SETTINGS_KEY, SETTINGS_TMP_KEY, settingsJson);
    pblog("v1\u2192v2 migration: wrote layout.json + settings.json");
    return true;
  }
  return false;
}
async function loadLayout() {
  try {
    const raw = await readJsonFile(LAYOUT_KEY);
    if (!raw)
      return emptyResult();
    let parsed;
    try {
      parsed = JSON.parse(raw.data);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Failed to parse layout: ${msg}`);
      }
      await moveCorruptFile2(LAYOUT_KEY, msg);
      return errorResult(`parse failed: ${msg}`);
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.version === 1 || parsed.settings !== undefined && parsed.version !== 2) {
        const migrated = await tryMigrateV1ToV2(raw.data);
        if (migrated) {
          const fresh = await readJsonFile(LAYOUT_KEY);
          if (fresh) {
            try {
              parsed = JSON.parse(fresh.data);
            } catch {
              return errorResult("migration succeeded but re-read failed");
            }
          }
        }
      }
      pblog("disk-read layout ok", `bytes=${raw.bytes}`, `version=${parsed?.version ?? "?"}`);
      return makePayload(currentVersion(), parsed);
    }
    pblog("disk-read layout empty-or-missing");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pblog("disk-read layout error", msg);
    if (DEBUG)
      spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`);
    return errorResult(`read failed: ${msg}`);
  }
  return emptyResult();
}
async function loadSettings() {
  try {
    const raw = await readJsonFile(SETTINGS_KEY);
    if (!raw) {
      const layoutRaw = await readJsonFile(LAYOUT_KEY);
      if (layoutRaw) {
        let parsed2;
        try {
          parsed2 = JSON.parse(layoutRaw.data);
        } catch {}
        if (parsed2 && typeof parsed2 === "object" && parsed2.settings !== undefined) {
          const migrated = await tryMigrateV1ToV2(layoutRaw.data);
          if (migrated) {
            const fresh = await readJsonFile(SETTINGS_KEY);
            if (fresh) {
              try {
                const freshParsed = JSON.parse(fresh.data);
                pblog("disk-read settings ok (v1\u2192v2 migrated)");
                return makePayload(currentVersion(), freshParsed);
              } catch {
                return errorResult("migration succeeded but re-read failed");
              }
            }
          }
        }
      }
      pblog("disk-read settings empty-or-missing");
      return emptyResult();
    }
    let parsed;
    try {
      parsed = JSON.parse(raw.data);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Failed to parse settings: ${msg}`);
      }
      await moveCorruptFile2(SETTINGS_KEY, msg);
      return errorResult(`parse failed: ${msg}`);
    }
    pblog("disk-read settings ok", `bytes=${raw.bytes}`, `version=${parsed?.version ?? "?"}`);
    return makePayload(currentVersion(), parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pblog("disk-read settings error", msg);
    if (DEBUG)
      spindle.log.warn(`[SidebarUX] Failed to load settings: ${msg}`);
    return errorResult(`read failed: ${msg}`);
  }
}
async function moveCorruptFile2(key, reason) {
  const newKey = await moveCorruptFile({
    read: (k) => spindle.storage.read(k).then((v) => typeof v === "string" ? v : v?.data ?? null),
    write: (k, contents) => spindle.storage.write(k, contents),
    move: (from, to) => spindle.storage.move(from, to),
    delete: (k) => spindle.storage.delete(k)
  }, key);
  if (newKey) {
    pblog(`moved corrupt ${key} \u2192 ${newKey}`, reason);
    if (DEBUG) {
      spindle.log.warn(`[SidebarUX] Corrupt ${key} preserved as ${newKey}: ${reason}`);
    }
  } else {
    pblog(`failed to move corrupt ${key}`, reason);
  }
}
async function saveLayout(state) {
  if (!state || typeof state !== "object")
    return;
  const json = JSON.stringify(state, null, 2);
  pblog("disk-write layout start", `bytes=${json.length}`);
  try {
    await atomicWrite(LAYOUT_KEY, LAYOUT_TMP_KEY, json);
    pblog("disk-write layout ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pblog("disk-write layout fail", msg);
    if (DEBUG)
      spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`);
  }
}
async function saveSettings(state) {
  if (!state || typeof state !== "object")
    return;
  const json = JSON.stringify(state, null, 2);
  pblog("disk-write settings start", `bytes=${json.length}`);
  try {
    await atomicWrite(SETTINGS_KEY, SETTINGS_TMP_KEY, json);
    pblog("disk-write settings ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pblog("disk-write settings fail", msg);
    if (DEBUG)
      spindle.log.error(`[SidebarUX] Failed to save settings: ${msg}`);
  }
}
spindle.onFrontendMessage(async (payload) => {
  if (payload.type === "SET_DEBUG") {
    DEBUG = !!payload.debug;
    return;
  }
  if (payload.type === "SET_PERSIST_DEBUG") {
    PERSIST_DEBUG = !!payload.enabled;
    pblog("persist-debug", PERSIST_DEBUG ? "on" : "off");
    return;
  }
  if (payload.type === "SAVE_LAYOUT") {
    pblog("ipc SAVE_LAYOUT");
    const saveId = typeof payload.saveId === "number" ? payload.saveId : 0;
    saveQueue = saveQueue.then(() => saveLayout(payload.layout)).then(() => {
      if (saveId > 0) {
        spindle.sendToFrontend({ type: "SAVE_LAYOUT_RESULT", saveId, result: { status: "ok" } });
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Queued layout save failed: ${msg}`);
      }
      if (saveId > 0) {
        spindle.sendToFrontend({ type: "SAVE_LAYOUT_RESULT", saveId, result: { status: "error", reason: msg } });
      }
    });
    await saveQueue;
  } else if (payload.type === "SAVE_SETTINGS") {
    pblog("ipc SAVE_SETTINGS");
    const saveId = typeof payload.saveId === "number" ? payload.saveId : 0;
    saveQueue = saveQueue.then(() => saveSettings(payload.settings)).then(() => {
      if (saveId > 0) {
        spindle.sendToFrontend({ type: "SAVE_SETTINGS_RESULT", saveId, result: { status: "ok" } });
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Queued settings save failed: ${msg}`);
      }
      if (saveId > 0) {
        spindle.sendToFrontend({ type: "SAVE_SETTINGS_RESULT", saveId, result: { status: "error", reason: msg } });
      }
    });
    await saveQueue;
  } else if (payload.type === "LOAD_LAYOUT") {
    pblog("ipc LOAD_LAYOUT");
    await saveQueue;
    const result = await loadLayout();
    const status = result.status;
    pblog("ipc LAYOUT_DATA", status);
    spindle.sendToFrontend({ type: "LAYOUT_DATA", result });
  } else if (payload.type === "LOAD_SETTINGS") {
    pblog("ipc LOAD_SETTINGS");
    await saveQueue;
    const result = await loadSettings();
    const status = result.status;
    pblog("ipc SETTINGS_DATA", status);
    spindle.sendToFrontend({ type: "SETTINGS_DATA", result });
  }
});
