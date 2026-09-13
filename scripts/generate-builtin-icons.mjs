#!/usr/bin/env bun
// Regenerate src/tabs/builtin-icons.ts from the installed Lumiverse host icon
// packages. Canvas's Configure Tabs modal is a Preact re-implementation of the
// host's ConfigureDrawerTabsModal and cannot import React icon components, so
// the built-in glyphs are vendored here as SVG strings. This script keeps them
// path-for-path identical to what the host actually renders.
//
// Sources (must exist on the dev machine):
//   <LUMIVERSE>/frontend/src/lib/drawer-tab-registry.tsx   (id -> tabIcon)
//   <LUMIVERSE>/frontend/node_modules/lucide-react/...     (24 built-ins)
//   <LUMIVERSE>/frontend/node_modules/@tabler/icons-react/ (council, tabler)
//
// Usage:
//   bun scripts/generate-builtin-icons.mjs
//   LUMIVERSE_FRONTEND=/path/to/Lumiverse/frontend bun scripts/generate-builtin-icons.mjs
//
// Why a script and not live-DOM sourcing: Configure-hidden tabs have NO host
// button in the DOM (the host filters them out), so a static map is the only
// source that can cover every row of the modal.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_FILE = path.join(REPO_ROOT, 'src', 'tabs', 'builtin-icons.ts')

const FRONTEND = process.env.LUMIVERSE_FRONTEND
  || path.join(os.homedir(), 'Lumiverse', 'frontend')
const REGISTRY = path.join(FRONTEND, 'src', 'lib', 'drawer-tab-registry.tsx')
const LUCIDE_DIR = path.join(FRONTEND, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons')
const TABLER_DIR = path.join(FRONTEND, 'node_modules', '@tabler', 'icons-react', 'dist', 'esm', 'icons')

function die(msg) {
  console.error(`generate-builtin-icons: ${msg}`)
  process.exit(1)
}

for (const p of [REGISTRY, LUCIDE_DIR, TABLER_DIR]) {
  if (!fs.existsSync(p)) die(`missing ${p} (set LUMIVERSE_FRONTEND to the host frontend dir)`)
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Balanced-bracket slice of the assigned `[...]` after `startMarker`.
 *  Prefers `= [` (skips a TypeScript type annotation like `Entry[] = [`). */
function extractArray(src, startMarker) {
  const i = src.indexOf(startMarker)
  if (i < 0) die(`marker not found: ${startMarker}`)
  const assign = src.indexOf('= [', i)
  const open = assign >= 0 ? assign + 2 : src.indexOf('[', i)
  if (open < 0) die(`no array after: ${startMarker}`)
  let depth = 0
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return src.slice(open, j + 1)
    }
  }
  return die(`unbalanced array after: ${startMarker}`)
}

/** Icon node arrays are pure literals — evaluate them safely in-process. */
function evalArray(text, label) {
  try {
    return Function(`"use strict"; return (${text})`)()
  } catch (err) {
    return die(`failed to evaluate ${label}: ${err.message}`)
  }
}

const kebab = (s) =>
  s.replace(/([a-zA-Z])(\d)/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Lucide icon node, following `export { default } from './x.js'` aliases. */
function lucideNode(component) {
  let k = kebab(component)
  for (;;) {
    const p = path.join(LUCIDE_DIR, `${k}.js`)
    if (!fs.existsSync(p)) die(`lucide icon file not found: ${k}.js (component ${component})`)
    const src = fs.readFileSync(p, 'utf8')
    const alias = src.match(/export \{ default \} from '\.\/([\w.-]+)\.js'/)
    if (alias) {
      k = alias[1]
      continue
    }
    return evalArray(extractArray(src, 'createLucideIcon('), `lucide ${k}`)
  }
}

/** Tabler icon node from @tabler/icons-react. */
function tablerNode(component) {
  const p = path.join(TABLER_DIR, `${component}.mjs`)
  if (!fs.existsSync(p)) die(`tabler icon file not found: ${component}.mjs`)
  const src = fs.readFileSync(p, 'utf8')
  return evalArray(extractArray(src, 'const __iconNode ='), `tabler ${component}`)
}

/** Host modal wrapper: 18×18 at strokeWidth 1.75 (CSS scales it). */
const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'

function nodeToSvg(node) {
  const parts = node.map(([tag, attrs]) => {
    const a = Object.entries(attrs)
      .filter(([key]) => key !== 'key')
      .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
      .join(' ')
    return `<${tag} ${a}/>`
  })
  return `${SVG_OPEN}${parts.join('')}</svg>`
}

function packageVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

// ── Parse the host registry ────────────────────────────────────────────────

const registry = fs.readFileSync(REGISTRY, 'utf8')

function importNames(source, spec) {
  // `[^}]*` stops at the first closing brace so one import statement can never
  // bridge into the next one.
  const m = source.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${spec.replace(/[/@]/g, '\\$&')}'`))
  if (!m) return new Map()
  const map = new Map() // local name -> exported name
  for (const raw of m[1].split(',')) {
    const part = raw.trim()
    if (!part) continue
    const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/)
    if (asMatch) map.set(asMatch[2], asMatch[1])
    else if (/^\w+$/.test(part)) map.set(part, part)
  }
  return map
}

const lucideLocals = importNames(registry, 'lucide-react')
const tablerLocals = importNames(registry, '@tabler/icons-react')

const entries = []
const arrayText = extractArray(registry, 'export const DRAWER_TABS')
const idRe = /id: '([a-z]+)'/g
let m
while ((m = idRe.exec(arrayText))) {
  const id = m[1]
  const entrySlice = arrayText.slice(m.index, m.index + 800)
  const icon = entrySlice.match(/tabIcon:\s*(\w+)/)
  if (!icon) continue
  const local = icon[1]
  const lucideName = lucideLocals.get(local)
  const tablerName = tablerLocals.get(local)
  if (!lucideName && !tablerName) die(`component ${local} (${id}) not found in registry imports`)
  entries.push({ id, component: local, package: tablerName ? 'tabler' : 'lucide', exportName: tablerName || lucideName })
}

if (entries.length === 0) die('no DRAWER_TABS entries parsed')

// ── Emit the TS module ─────────────────────────────────────────────────────

const lucideVersion = packageVersion(path.join(FRONTEND, 'node_modules', 'lucide-react'))
const tablerVersion = packageVersion(path.join(FRONTEND, 'node_modules', '@tabler', 'icons-react'))

const lines = []
lines.push('// Built-in drawer-tab icon SVGs for the Configure Tabs modal.')
lines.push('//')
lines.push('// GENERATED FILE — do not hand-edit. Regenerate with:')
lines.push('//   bun scripts/generate-builtin-icons.mjs')
lines.push('//')
lines.push(`// Source of truth: Lumiverse's own drawer-tab registry`)
lines.push('// (~/Lumiverse/frontend/src/lib/drawer-tab-registry.tsx) —')
lines.push(`// lucide-react@${lucideVersion} for 24 built-ins plus`)
lines.push(`// @tabler/icons-react@${tablerVersion} for council (not in lucide).`)
lines.push('// Emitted at a 24×24 viewBox / stroke-width 1.75, matching the host')
lines.push('// ConfigureDrawerTabsModal (<Icon size={18} strokeWidth={1.75}/>); the')
lines.push('// modal CSS scales the glyph to 16px.')
lines.push('//')
lines.push('// Canvas renders these for ALL built-in rows — including Configure-hidden')
lines.push('// tabs, whose host button is not in the DOM (the host filters them out),')
lines.push('// so live-DOM sourcing alone cannot cover every row.')
lines.push('')
lines.push('export const BUILTIN_ICON_SVGS: Record<string, string> = {')
for (const e of entries) {
  const node = e.package === 'tabler' ? tablerNode(e.component) : lucideNode(e.component)
  lines.push(`  ${e.id}: \`${nodeToSvg(node)}\`,`)
}
lines.push('}')
lines.push('')

const output = lines.join('\n')
const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null

if (existing === output) {
  console.log(`generate-builtin-icons: ${entries.length} icons unchanged`)
} else {
  fs.writeFileSync(OUT_FILE, output)
  console.log(`generate-builtin-icons: wrote ${entries.length} icons to ${path.relative(REPO_ROOT, OUT_FILE)}`)
  console.log(`  lucide-react@${lucideVersion} · @tabler/icons-react@${tablerVersion}`)
}
