declare const spindle: any

const STORAGE_KEY = 'layout.json'

async function loadLayout(): Promise<any> {
  try {
    const data = await spindle.storage.read(STORAGE_KEY)
    if (data && typeof data === 'string') {
      return JSON.parse(data)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`)
  }
  return null
}

async function saveLayout(state: any): Promise<void> {
  try {
    await spindle.storage.write(STORAGE_KEY, JSON.stringify(state, null, 2))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`)
  }
}

spindle.onFrontendMessage(async (payload: any) => {
  if (payload.type === 'SAVE_LAYOUT') {
    await saveLayout(payload.layout)
  } else if (payload.type === 'LOAD_LAYOUT') {
    const layout = await loadLayout()
    spindle.sendToFrontend({ type: 'LAYOUT_DATA', layout })
  }
})

spindle.log.info('[SidebarUX] Backend started')
