export interface V2SplitPayload {
  layout: Record<string, unknown>
  settings: { version: 2; settings: unknown }
}

/**
 * Parse and split the legacy combined layout payload. Returns null for JSON
 * that is not an object or is already the split v2 shape.
 */
export function migrateLegacyPayload(raw: string): V2SplitPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const source = parsed as Record<string, unknown>
  if (source.version === 2 || source.version === '2') return null

  const layout = { ...source }
  const settings = layout.settings
  delete layout.settings
  layout.version = 2

  return {
    layout,
    settings: { version: 2, settings: settings && typeof settings === 'object' ? settings : {} },
  }
}
