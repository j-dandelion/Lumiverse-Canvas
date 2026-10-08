import type { CustomIcon, Folder } from '../core/organization'

// Native Lumiverse staging presets; lucide-react 0.468.0 (ISC).
export const FOLDER_ICONS: Record<string, string> = {
  "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  "brain": "<path d=\"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z\"/><path d=\"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z\"/><path d=\"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4\"/><path d=\"M17.599 6.5a3 3 0 0 0 .399-1.375\"/><path d=\"M6.003 5.125A3 3 0 0 0 6.401 6.5\"/><path d=\"M3.477 10.896a4 4 0 0 1 .585-.396\"/><path d=\"M19.938 10.5a4 4 0 0 1 .585.396\"/><path d=\"M6 18a4 4 0 0 1-1.967-.516\"/><path d=\"M19.967 17.484A4 4 0 0 1 18 18\"/>",
  "book": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
  "message": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/>",
  "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/><path d=\"M3 5V19A9 3 0 0 0 21 19V5\"/><path d=\"M3 12A9 3 0 0 0 21 12\"/>",
  "palette": "<circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><path d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z\"/>",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>",
  "code": "<path d=\"m18 16 4-4-4-4\"/><path d=\"m6 8-4 4 4 4\"/><path d=\"m14.5 4-5 16\"/>",
  "tools": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/>",
  "game": "<line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\"/><line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\"/><line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\"/><line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\"/><path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\"/>",
  "boxes": "<path d=\"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z\"/><path d=\"m7 16.5-4.74-2.85\"/><path d=\"m7 16.5 5-3\"/><path d=\"M7 16.5v5.17\"/><path d=\"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z\"/><path d=\"m17 16.5-5-3\"/><path d=\"m17 16.5 4.74-2.85\"/><path d=\"M17 16.5v5.17\"/><path d=\"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z\"/><path d=\"M12 8 7.26 5.15\"/><path d=\"m12 8 4.74-2.85\"/><path d=\"M12 13.5V8\"/>",
  "sparkles": "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"/><path d=\"M20 3v4\"/><path d=\"M22 5h-4\"/><path d=\"M4 17v2\"/><path d=\"M5 18H3\"/>",
  "zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"/>"
}

const tags = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'])
const attrNames: Record<string, string> = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule', fillOpacity: 'fill-opacity', strokeOpacity: 'stroke-opacity' }
const allowedAttrs = new Set(['d', 'points', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity'])
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
function attributes(attrs: unknown): string {
  if (!attrs || typeof attrs !== 'object') return ''
  return Object.entries(attrs).flatMap(([name, raw]) => {
    name = attrNames[name] ?? name
    if (!allowedAttrs.has(name) || typeof raw !== 'string' || raw.length > 12000) return []
    const value = raw.trim()
    if ((name === 'fill' || name === 'stroke') && value !== 'none' && value !== 'currentColor') return []
    if (/url|[<>&"']/i.test(value)) return []
    return [` ${name}="${escape(value)}"`]
  }).join('')
}
export function sanitizeCustomIcon(raw: unknown): CustomIcon | undefined {
  if (!raw || typeof raw !== 'object') return
  const icon = raw as CustomIcon
  const box = typeof icon.viewBox === 'string' ? icon.viewBox.trim().split(/[ ,]+/).map(Number) : []
  if (box.length !== 4 || box.some(n => !Number.isFinite(n) || Math.abs(n) > 100000) || box[2]! <= 0 || box[3]! <= 0 || !Array.isArray(icon.elements) || icon.elements.length > 64) return
  const safeAttrs = (attrs: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [name, value] of Object.entries(attrs ?? {})) if (attributes({ [name]: value })) out[name] = value
    return out
  }
  return { viewBox: box.join(' '), attrs: safeAttrs(icon.attrs), elements: icon.elements.filter(el => tags.has(el?.tag)).map(el => ({ tag: el.tag, attrs: safeAttrs(el.attrs) })) }
}
export function parseCustomSvg(text: string): CustomIcon {
  if (new TextEncoder().encode(text).length > 32768) throw new Error('SVG must be smaller than 32 KB.')
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Choose a valid SVG icon.')
  const read = (el: Element) => Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value]))
  const icon = sanitizeCustomIcon({ viewBox: svg.getAttribute('viewBox') ?? '0 0 24 24', attrs: read(svg), elements: Array.from(svg.querySelectorAll('*')).filter(el => tags.has(el.localName)).map(el => ({ tag: el.localName, attrs: read(el) })) })
  if (!icon || !icon.elements.length) throw new Error('The SVG has no supported shapes.')
  return icon
}
export function folderIconSvg(folder: Pick<Folder, 'icon' | 'customIcon'>): string {
  const custom = sanitizeCustomIcon(folder.customIcon)
  if (custom) return `<svg width="20" height="20" viewBox="${escape(custom.viewBox)}"${attributes({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', ...custom.attrs })}>${custom.elements.map(el => `<${el.tag}${attributes(el.attrs)}/>`).join('')}</svg>`
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FOLDER_ICONS[folder.icon ?? 'folder'] ?? FOLDER_ICONS.folder}</svg>`
}
