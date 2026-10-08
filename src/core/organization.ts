import type { LayoutModel, Side, TabKey } from './model'

/** Unknown native addresses are retained without inventing a TabKey. */
export type TabReference = { key: TabKey; tabId?: never } | { tabId: string; key?: never }
export type CustomIcon = { viewBox: string; attrs: Record<string, string>; elements: { tag: string; attrs: Record<string, string> }[] }
export type OrganizationItem =
  | ({ type: 'tab' } & TabReference)
  | { type: 'divider'; id: string; label?: string }
  | { type: 'folder'; id: string; name: string; icon?: string; customIcon?: CustomIcon; view?: 'list' | 'grid'; children: readonly TabReference[] }
export type Folder = Extract<OrganizationItem, { type: 'folder' }>
export type Organization = { version: 1; primary: readonly OrganizationItem[]; secondary: readonly OrganizationItem[] }

export function referenceId(ref: TabReference): string { return ref.key ?? `address:${ref.tabId}` }
export function itemId(item: OrganizationItem): string { return item.type === 'tab' ? referenceId(item) : `${item.type}:${item.id}` }
export function references(items: readonly OrganizationItem[]): TabReference[] {
  return items.flatMap(item => item.type === 'tab' ? [item] : item.type === 'folder' ? [...item.children] : [])
}
export function organizationFor(model: LayoutModel): Organization {
  return model.organization ?? { version: 1, primary: model.primary.map(key => ({ type: 'tab', key })), secondary: model.secondary.map(key => ({ type: 'tab', key })) }
}
export function folderFor(model: LayoutModel, side: Side, id: string | null | undefined): Folder | null {
  return organizationFor(model)[side].find((item): item is Folder => item.type === 'folder' && item.id === id) ?? null
}
export function folderContaining(model: LayoutModel, side: Side, key: TabKey): Folder | null {
  return organizationFor(model)[side].find((item): item is Folder => item.type === 'folder' && item.children.some(ref => ref.key === key)) ?? null
}

/** Total boundary sanitizer: one occurrence per tab, unique container IDs, no nesting. */
export function sanitizeOrganization(raw: unknown): Organization {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const seen = new Set<string>()
  const containers = new Set<string>()
  const readRef = (value: unknown): TabReference | null => {
    if (!value || typeof value !== 'object') return null
    const r = value as Record<string, unknown>
    const ref: TabReference | null = typeof r.key === 'string' && /^(builtin:|ext:)/.test(r.key)
      ? { key: r.key } : typeof r.tabId === 'string' && r.tabId ? { tabId: r.tabId } : null
    if (!ref || seen.has(referenceId(ref))) return null
    seen.add(referenceId(ref)); return ref
  }
  const read = (value: unknown): OrganizationItem[] => {
    if (!Array.isArray(value)) return []
    const out: OrganizationItem[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const r = entry as Record<string, unknown>
      if (r.type === 'tab') { const ref = readRef(r); if (ref) out.push({ type: 'tab', ...ref }); continue }
      if ((r.type !== 'folder' && r.type !== 'divider') || typeof r.id !== 'string' || !r.id || containers.has(r.id)) continue
      containers.add(r.id)
      if (r.type === 'divider') out.push({ type: 'divider', id: r.id, ...(typeof r.label === 'string' ? { label: r.label } : {}) })
      else out.push({ type: 'folder', id: r.id, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Folder',
        ...(typeof r.icon === 'string' ? { icon: r.icon } : {}),
        ...(r.customIcon && typeof r.customIcon === 'object' ? { customIcon: r.customIcon as CustomIcon } : {}),
        view: r.view === 'grid' ? 'grid' : 'list', children: Array.isArray(r.children) ? r.children.map(readRef).filter((ref): ref is TabReference => !!ref) : [] })
    }
    return out
  }
  return { version: 1, primary: read(input.primary), secondary: read(input.secondary) }
}

/** Ownership remains authoritative; retain unavailable members, append newly discovered keys. */
export function normalizeOrganization(model: LayoutModel, org = organizationFor(model)): Organization {
  const clean = sanitizeOrganization(org)
  const owner = new Map<string, Side>([...model.primary.map(key => [key, 'primary'] as const), ...model.secondary.map(key => [key, 'secondary'] as const)])
  const normalize = (side: Side): OrganizationItem[] => {
    const keep = (ref: TabReference) => !ref.key || !owner.has(ref.key) || owner.get(ref.key) === side
    const items = clean[side].flatMap<OrganizationItem>(item => item.type === 'tab' ? (keep(item) ? [item] : []) : item.type === 'folder' ? [{ ...item, children: item.children.filter(keep) }] : [item])
    const included = new Set(references(items).map(ref => ref.key))
    for (const key of model[side]) if (!included.has(key)) items.push({ type: 'tab', key })
    return items
  }
  return { version: 1, primary: normalize('primary'), secondary: normalize('secondary') }
}

export function removeOrganizationItem(org: Organization, side: Side, id: string): Organization {
  return { ...org, [side]: org[side].flatMap<OrganizationItem>(item => itemId(item) !== id ? [item] : item.type === 'folder' ? item.children.map(ref => ({ type: 'tab' as const, ...ref })) : []) }
}

/** Move a root container or a leaf; folders/dividers can never become children. */
export function relocateOrganizationItem(org: Organization, id: string, to: Side, index = -1, folderId?: string): Organization {
  let moved: OrganizationItem | null = null
  const strip = (items: readonly OrganizationItem[]): OrganizationItem[] => items.flatMap<OrganizationItem>(item => {
    if (itemId(item) === id) { moved = item; return [] }
    if (item.type !== 'folder') return [item]
    return [{ ...item, children: item.children.filter(ref => { if (referenceId(ref) !== id) return true; moved = { type: 'tab', ...ref }; return false }) }]
  })
  const primary = strip(org.primary), secondary = strip(org.secondary)
  const item = moved as OrganizationItem | null
  if (!item || (folderId && item.type !== 'tab')) return org
  const target = to === 'primary' ? primary : secondary
  if (folderId) {
    const folderIndex = target.findIndex(entry => entry.type === 'folder' && entry.id === folderId)
    const folder = target[folderIndex]
    if (!folder || folder.type !== 'folder' || item.type !== 'tab') return org
    const children = [...folder.children]; children.splice(index < 0 ? children.length : Math.min(index, children.length), 0, item)
    target[folderIndex] = { ...folder, children }
  } else target.splice(index < 0 ? target.length : Math.min(index, target.length), 0, item)
  return { version: 1, primary, secondary }
}

export function browserVisible(model: LayoutModel, key: TabKey): boolean {
  return !model.hidden.includes(key) || !!model.closeHidden?.includes(key)
}

/** Native layout addresses use stable Spindle IDs without the registration counter. */
export function canonicalAddress(id: string): string {
  if (id === 'ooc' || id === 'feedback') return 'council'
  return id.startsWith('spindle:') && id.includes(':tab:') ? id.replace(/:\d+$/, '') : id
}
export function importNativeOrganization(raw: unknown, model: LayoutModel, findKey: (id: string) => string | null): Organization {
  const entries = Array.isArray(raw) ? raw : []
  const protectedContainers = new Set(organizationFor(model).secondary.filter(item => item.type !== 'tab').map(item => item.id))
  const ref = (id: string): TabReference => { const key = findKey(id) ?? findKey(canonicalAddress(id)); return key ? { key } : { tabId: canonicalAddress(id) } }
  const primary = entries.flatMap((r): OrganizationItem[] => {
    if (!r || typeof r !== 'object') return []
    if (r.type === 'tab' && typeof r.tabId === 'string') return [{ type: 'tab', ...ref(r.tabId) }]
    if (r.type === 'divider') return protectedContainers.has(r.id) ? [] : [r]
    if (r.type === 'folder' && Array.isArray(r.children)) {
      const children = r.children.filter((id: unknown) => typeof id === 'string').map(ref)
      // Disable folds the second drawer into native layout. Its existing
      // containers still belong to the protected Canvas second drawer on
      // enable; importing copies would collide with their IDs or accumulate
      // empty duplicates. New main/unknown members remain reachable at root.
      if (protectedContainers.has(r.id)) return children.filter((child: TabReference) => !child.key || !model.secondary.includes(child.key)).map((child: TabReference) => ({ type: 'tab' as const, ...child }))
      return [{ ...r, children }]
    }
    return []
  })
  return normalizeOrganization(model, sanitizeOrganization({ primary, secondary: organizationFor(model).secondary }))
}
export function projectNativeOrganization(org: Organization, resolve: (key: string) => string | null): unknown[] {
  const address = (ref: TabReference) => ref.key ? resolve(ref.key) : ref.tabId
  return [...org.primary, ...org.secondary].flatMap<unknown>(item => {
    if (item.type === 'tab') { const id = address(item); return id ? [{ type: 'tab', tabId: canonicalAddress(id) }] : [] }
    if (item.type === 'divider') return [item]
    return [{ ...item, children: item.children.map(address).filter((id): id is string => !!id).map(canonicalAddress) }]
  })
}
