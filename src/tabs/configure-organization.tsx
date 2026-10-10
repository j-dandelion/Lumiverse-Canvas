/** @jsxImportSource preact */
import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import { itemId, referenceId, relocateOrganizationItem, removeOrganizationItem, type Organization, type OrganizationItem, type TabReference } from '../core/organization'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'
import { getSettings } from '../settings/state'
import type { Side } from '../core/model'
import { getHost } from '../recon/dispatch'
import type { CatalogTab } from './configure-catalog'
import { folderIconSvg, FOLDER_ICONS, parseCustomSvg } from './folder-icons'

function Icon(props: { name: 'plus' | 'grip' | 'more' | 'right' | 'down' | 'up' | 'swap' | 'trash' }) {
  const paths = { plus: 'M12 5v14M5 12h14', more: 'M5 12h.01M12 12h.01M19 12h.01', right: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6', up: 'm6 15 6-6 6 6', swap: 'M3 7h18l-4-4M21 17H3l4 4', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', grip: '' }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {props.name === 'grip' ? [9, 15].flatMap(x => [5, 12, 19].map(y => <circle cx={x} cy={y} r="1.5"/>)) : <path d={paths[props.name]}/>}
  </svg>
}

/** Keep an unfinished rename across unrelated draft/commit rerenders. */
function OrganizationName(props: { id: string; value: string; kind: 'folder' | 'divider'; onSave: (value: string) => void }) {
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  return <input data-organization-name={props.id} class="canvas-organization-name" aria-label={props.kind === 'folder' ? 'Folder name' : 'Divider label'} placeholder={props.kind === 'divider' ? 'Divider label (optional)' : undefined}
    value={text} onInput={e => setText(e.currentTarget.value)} onBlur={() => { const value = text.trim() || (props.kind === 'folder' ? 'Folder' : ''); setText(value); if (value !== props.value) props.onSave(value) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}/>
}

export function ConfigureOrganization(props: {
  organization: Organization; side: Side; tabs: CatalogTab[];
  onChange: (organization: Organization) => void;
  onConfigureDragStart: (event: PointerEvent, id: string, side: Side) => void;
  renderTab: (tab: CatalogTab, index: number, side: Side) => h.JSX.Element;
  renderHeader: (actions: h.JSX.Element) => h.JSX.Element;
}) {
  const { organization, side, tabs, onChange, onConfigureDragStart, renderTab } = props
  const latestOrganization = useRef(organization)
  latestOrganization.current = organization
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [iconEditor, setIconEditor] = useState<string | null>(null)
  const [actionEditor, setActionEditor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      if (!organization[side].some(item => item.type !== 'tab' && item.id === id)) return
      setExpanded(current => new Set([...current, id]))
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-organization-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
    }
    document.addEventListener('canvas:configure-organization-focus', focus)
    return () => { document.removeEventListener('canvas:configure-organization-focus', focus) }
  }, [organization, side])
  const update = (id: string, patch: Partial<OrganizationItem>) => onChange({ ...organization, [side]: organization[side].map(item => itemId(item) === id ? { ...item, ...patch } : item) } as Organization)
  const move = (id: string, to: Side, index = -1, folder?: string) => {
    const label = document.activeElement?.getAttribute('aria-label')
    if (folder && to === side) setExpanded(current => new Set([...current, folder]))
    onChange(relocateOrganizationItem(organization, id, to, index, folder))
    requestAnimationFrame(() => {
      const column = document.querySelector<HTMLElement>(`[data-side="${to}"]`)
      const row = column?.querySelector<HTMLElement>(`[data-organization-ref="${CSS.escape(id)}"]`)
      const control = label ? row?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]:not(:disabled)`) : null
      const fallback = row?.querySelector<HTMLElement>('.canvas-organization-more') ?? column?.querySelector<HTMLElement>('.canvas-organization-disclosure')
      const focus = control ?? fallback
      focus?.focus()
    })
  }
  const remove = (id: string) => {
    const roots = organization[side], index = roots.findIndex(item => itemId(item) === id)
    const neighbor = roots[index + 1] ?? roots[index - 1]
    onChange(removeOrganizationItem(organization, side, id))
    requestAnimationFrame(() => {
      const column = document.querySelector<HTMLElement>(`[data-side="${side}"]`)
      const row = neighbor ? column?.querySelector<HTMLElement>(`[data-organization-ref="${CSS.escape(itemId(neighbor))}"]`) : null
      const focus = row?.querySelector<HTMLElement>('input,button') ?? column?.closest('.canvas-configure-tabs-column')?.querySelector<HTMLElement>('.canvas-organization-create button')
      focus?.focus()
    })
  }
  const create = (type: 'folder' | 'divider') => {
    const id = crypto.randomUUID()
    const item: OrganizationItem = type === 'folder' ? { type, id, name: 'Folder', icon: 'folder', view: 'list', children: [] } : { type, id }
    if (type === 'folder') setExpanded(new Set([...expanded, id]))
    onChange({ ...organization, [side]: [...organization[side], item] })
    requestAnimationFrame(() => { const input = document.querySelector<HTMLInputElement>(`[data-organization-name="${id}"]`); input?.focus(); input?.select() })
  }
  const dragHandle = (id: string) => <span class="canvas-configure-tabs-drag-handle" onPointerDown={event => onConfigureDragStart(event, id, side)} title="Drag to reorder"><Icon name="grip"/></span>
  const more = (id: string, title: string) => <button type="button" class="canvas-organization-more" title="More actions" aria-label={`Actions for ${title}`} aria-expanded={actionEditor === id} aria-controls={`canvas-organization-actions-${id}`} onClick={() => setActionEditor(actionEditor === id ? null : id)}><Icon name="more"/></button>
  const actions = (id: string, index: number, parent?: string, item?: OrganizationItem) => {
    if (actionEditor !== id) return null
    const siblings = parent ? organization[side].find(item => item.type === 'folder' && item.id === parent) : null
    const length = siblings?.type === 'folder' ? siblings.children.length : organization[side].length
    return <div id={`canvas-organization-actions-${id}`} class="canvas-organization-action-panel">
      <div class="canvas-organization-row-actions" role="group" aria-label="Reorder">
        <button type="button" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(id, side, index - 1, parent)}><Icon name="up"/></button>
        <button type="button" title="Move down" aria-label="Move down" disabled={index === length - 1} onClick={() => move(id, side, index + 1, parent)}><Icon name="down"/></button>
      </div>
      {(!item || item.type === 'tab') && <label class="canvas-organization-destination">Move to<select aria-label="Move tab to" value={parent ?? 'root'} onChange={e => { const value = e.currentTarget.value; setActionEditor(null); move(id, side, -1, value === 'root' ? undefined : value) }}>
        <option value="root">Drawer root</option>
        {organization[side].filter(item => item.type === 'folder').map(folder => <option value={folder.id} key={folder.id}>{folder.name}</option>)}
      </select></label>}
      {getSettings().secondSidebarEnabled && <button type="button" title="Move to other drawer" aria-label="Move to other drawer" onClick={() => { setActionEditor(null); move(id, side === 'primary' ? 'secondary' : 'primary') }}><Icon name="swap"/><span>Other drawer</span></button>}
      {item && item.type !== 'tab' && <button type="button" class="canvas-organization-delete" title={item.type === 'folder' ? 'Delete folder; keep its tabs' : 'Delete divider'} aria-label={item.type === 'folder' ? 'Delete folder; keep its tabs' : 'Delete divider'} onClick={() => { setActionEditor(null); remove(id) }}><Icon name="trash"/><span>Delete {item.type}</span></button>}
    </div>
  }
  const leaf = (ref: TabReference, index: number, parent?: string) => {
    const id = referenceId(ref), liveId = ref.key ? getHost()?.resolve(ref.key) : ref.tabId
    const tab = tabs.find(tab => tab.id === liveId)
    return <div key={id} class={`canvas-organization-leaf${parent ? ' canvas-organization-child' : ''}`} data-organization-ref={id} data-organization-drag-id={id} data-organization-drag-kind="tab" data-organization-parent={parent} data-organization-index={index}>
      {dragHandle(id)}
      <div class="canvas-organization-existing-row">{tab ? renderTab(tab, index, side) : <div class="canvas-configure-tabs-row row-hidden"><div class="canvas-configure-tabs-row-info"><div class="canvas-configure-tabs-copy"><span class="canvas-configure-tabs-row-title">{ref.key?.split('/').pop() ?? ref.tabId}</span><p class="canvas-configure-tabs-row-description">Currently unavailable</p></div></div></div>}</div>
      {more(id, tab?.title ?? 'unavailable tab')}
      {actions(id, index, parent)}
    </div>
  }
  const creation = <div class="canvas-organization-create" role="group" aria-label={`Add to ${side === 'primary' ? 'main' : 'second'} drawer`}><button type="button" onClick={() => create('folder')}><Icon name="plus"/>Folder</button><button type="button" onClick={() => create('divider')}><Icon name="plus"/>Divider</button></div>
  return <>{props.renderHeader(creation)}<div class="canvas-configure-tabs-list" data-side={side}><div class="canvas-organization-editor" onKeyDown={e => { if (e.key === 'Escape' && (actionEditor || iconEditor)) { e.preventDefault(); e.stopPropagation() }; if (e.key === 'Escape' && actionEditor) { document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(`canvas-organization-actions-${actionEditor}`)}"]`)?.focus(); setActionEditor(null) }; if (e.key === 'Escape' && iconEditor) { document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(`canvas-organization-icons-${iconEditor}`)}"]`)?.focus(); setIconEditor(null) } }}>
    {!organization[side].length && <div class="canvas-configure-tabs-empty">No tabs assigned</div>}
    {error && <div role="alert" class="canvas-configure-tabs-error">{error}</div>}
    {organization[side].map((item, index) => {
      if (item.type === 'tab') return leaf(item, index)
      const id = itemId(item)
      return item.type === 'folder' ? <div key={id} class="canvas-organization-container" data-organization-id={item.id} data-organization-drag-id={id} data-organization-drag-kind="folder" data-organization-index={index}>
        <div class="canvas-configure-tabs-row canvas-organization-row" data-organization-ref={id} data-organization-index={index}>
          {dragHandle(id)}
          <button type="button" class="canvas-organization-disclosure" aria-label={`${expanded.has(item.id) ? 'Collapse' : 'Expand'} ${item.name}`} aria-expanded={expanded.has(item.id)} onClick={() => { const next = new Set(expanded); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); setExpanded(next) }}><Icon name={expanded.has(item.id) ? 'down' : 'right'}/></button>
          <button type="button" class="canvas-organization-icon" aria-label={`Edit ${item.name} icon`} aria-expanded={iconEditor === item.id} aria-controls={`canvas-organization-icons-${item.id}`} onClick={() => setIconEditor(iconEditor === item.id ? null : item.id)} dangerouslySetInnerHTML={{ __html: folderIconSvg(item) }}/>
          <OrganizationName id={item.id} kind="folder" value={item.name} onSave={name => update(id, { name })}/>
          <small class="canvas-organization-count" aria-label={`${item.children.length} tabs`}>{item.children.length}</small>
          {more(id, item.type === 'folder' ? item.name : item.label || 'divider')}
        </div>
        {actions(id, index, undefined, item)}
        {iconEditor === item.id && <div id={`canvas-organization-icons-${item.id}`} class="canvas-organization-icons" role="group" aria-label="Folder icon">
          {Object.keys(FOLDER_ICONS).map(icon => <button key={icon} type="button" title={icon} aria-label={`${icon} icon`} aria-pressed={!item.customIcon && (item.icon ?? 'folder') === icon} onClick={() => update(id, { icon, customIcon: undefined })} dangerouslySetInnerHTML={{ __html: folderIconSvg({ icon }) }}/>) }
          <textarea rows={2} class="canvas-organization-svg-paste" aria-label="Paste SVG icon" placeholder="Paste an SVG icon…" onPaste={event => { event.preventDefault(); try { update(id, { customIcon: parseCustomSvg(event.clipboardData?.getData('text') ?? '') }); setError(null) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }}/>
          <label class="canvas-organization-import">Import SVG<input type="file" accept="image/svg+xml,.svg" onChange={async e => { const file = e.currentTarget.files?.[0]; if (!file) return; const generation = currentLifecycleGeneration(); try { if (file.size > 32768) throw new Error('SVG must be smaller than 32 KB.'); const text = await file.text(); if (!isLifecycleCurrent(generation) || latestOrganization.current !== organization) return; update(id, { customIcon: parseCustomSvg(text) }); setError(null) } catch (err) { if (isLifecycleCurrent(generation) && latestOrganization.current === organization) setError(err instanceof Error ? err.message : String(err)) } }}/></label>
        </div>}
        {expanded.has(item.id) && item.children.map((ref, childIndex) => leaf(ref, childIndex, item.id))}
      </div> : <div key={id} class="canvas-organization-container canvas-organization-divider-container" data-organization-id={item.id} data-organization-drag-id={id} data-organization-drag-kind="divider" data-organization-index={index}>
        <div class="canvas-configure-tabs-row canvas-organization-row canvas-organization-divider-row" data-organization-ref={id} data-organization-index={index}>
          {dragHandle(id)}<span class="canvas-tab-divider" aria-hidden="true"/><OrganizationName id={item.id} kind="divider" value={item.label ?? ''} onSave={label => update(id, { label })}/>{more(id, item.label || 'divider')}
        </div>
        {actions(id, index, undefined, item)}
      </div>
    })}
    <div class="canvas-organization-end" aria-label="End of drawer"/>
  </div></div></>
}

export const ORGANIZATION_EDITOR_CSS = `
  .canvas-organization-create { display:flex;flex-shrink:0;gap:2px; }
  .canvas-organization-create button { display:inline-flex;align-items:center;gap:3px;min-height:24px;padding:3px 5px;border:0;border-radius:5px;background:transparent;color:var(--lumiverse-text-muted);font:inherit;font-size:calc(11px * var(--lumiverse-font-scale,1));white-space:nowrap;cursor:pointer; }
  .canvas-organization-create svg { width:12px;height:12px; }
  .canvas-organization-create button:hover,.canvas-organization-row button:hover,.canvas-organization-more:hover,.canvas-organization-action-panel button:hover { background:var(--lumiverse-primary-010);color:var(--lumiverse-text); }
  .canvas-organization-editor { display:flex;flex-direction:column;gap:8px; }
  .canvas-organization-container { display:flex;flex-direction:column;gap:6px;min-width:0; }
  .canvas-organization-dragging { opacity:0!important; }
  .canvas-organization-leaf { display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-width:0;border:1px solid var(--lumiverse-border,#333);border-radius:14px;background:var(--lumiverse-bg-hover,var(--lumiverse-bg));padding:0 8px; }
  .canvas-configure-tabs-overlay-clone.canvas-organization-leaf { justify-content:flex-start;gap:2px;padding:0 8px; }
  .canvas-organization-leaf:has(.row-hidden) { background:var(--lumiverse-bg,#1a1a2e); }
  .canvas-organization-existing-row .canvas-configure-tabs-row { background:transparent;border:0;padding-left:4px;padding-right:4px; }
  .canvas-organization-existing-row { flex:1;min-width:0; }
  .canvas-organization-existing-row .canvas-configure-tabs-drag-handle { display:none; }
  .canvas-organization-child { margin-left:24px;border-left:2px solid var(--lumiverse-primary-020);padding-left:6px; }
  .canvas-organization-more,.canvas-organization-row button,.canvas-organization-action-panel button { display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;gap:5px;min-width:28px;min-height:28px;border:0;border-radius:6px;padding:5px;color:var(--lumiverse-text-muted);background:transparent;font:inherit;font-size:calc(11px * var(--lumiverse-font-scale,1));cursor:pointer; }
  .canvas-organization-more svg,.canvas-organization-row button svg,.canvas-organization-action-panel button svg { display:block;width:16px;height:16px; }
  .canvas-organization-more[aria-expanded=true] { background:var(--lumiverse-primary-010);color:var(--lumiverse-primary); }
  .canvas-organization-action-panel { display:flex;align-items:center;flex-wrap:wrap;gap:6px;width:100%;padding:6px 8px;border:1px solid var(--lumiverse-border);border-radius:8px;background:var(--lumiverse-bg); }
  .canvas-organization-leaf > .canvas-organization-action-panel { margin:0 0 8px; }
  .canvas-organization-row-actions { display:flex;gap:2px; }
  .canvas-organization-destination { display:flex;align-items:center;gap:6px;flex:1;min-width:0;font-size:calc(11px * var(--lumiverse-font-scale,1));color:var(--lumiverse-text-muted); }
  .canvas-organization-destination select { flex:1;width:0;min-width:70px;max-width:200px;min-height:28px;font:inherit;background:var(--lumiverse-bg);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:6px;padding:4px; }
  .canvas-organization-action-panel button:disabled { opacity:.3;cursor:default; }
  .canvas-organization-action-panel button:disabled:hover { background:transparent;color:var(--lumiverse-text-muted); }
  .canvas-organization-action-panel .canvas-organization-delete:hover { color:var(--lumiverse-error,var(--lumiverse-text)); }
  .canvas-organization-row { gap:4px;align-items:center;min-height:50px;padding:8px; }
  .canvas-organization-name { flex:1;width:0;min-width:48px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--lumiverse-text);font:inherit;font-size:calc(13px * var(--lumiverse-font-scale,1));padding:4px; }
  .canvas-organization-name:hover { border-color:var(--lumiverse-border); }
  .canvas-organization-name:focus { border-color:var(--lumiverse-primary);outline:none; }
  .canvas-organization-count { min-width:20px;padding:2px 5px;border-radius:5px;background:var(--lumiverse-primary-008);color:var(--lumiverse-text-muted);font-size:calc(11px * var(--lumiverse-font-scale,1));text-align:center; }
  .canvas-organization-row .canvas-organization-icon { width:30px;height:30px;border-radius:8px;background:var(--lumiverse-primary-010);color:var(--lumiverse-primary); }
  .canvas-organization-icon svg { display:block;width:18px;height:18px; }
  .canvas-organization-divider-row { min-height:40px;padding-top:5px;padding-bottom:5px;background:var(--lumiverse-bg,#1a1a2e); }
  .canvas-organization-editor .canvas-organization-divider-row .canvas-tab-divider,
  .canvas-configure-tabs-overlay-clone.canvas-organization-divider-row .canvas-tab-divider { width:24px;height:1px;margin:0 6px; }
  .canvas-organization-icons { display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 8px 30px; }
  .canvas-organization-icons button { display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:5px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--lumiverse-text-muted);cursor:pointer; }
  .canvas-organization-icons button:hover { background:var(--lumiverse-primary-010); }
  .canvas-organization-icons button svg { display:block;width:18px;height:18px; }
  .canvas-organization-icons button[aria-pressed=true] { border-color:var(--lumiverse-primary);color:var(--lumiverse-primary); }
  .canvas-organization-import { position:relative;font-size:calc(11px * var(--lumiverse-font-scale,1));padding:8px;border-radius:6px;color:var(--lumiverse-text-muted);cursor:pointer; }
  .canvas-organization-import input { position:absolute;width:1px;height:1px;opacity:0;overflow:hidden; }
  .canvas-organization-svg-paste { width:100%;font:inherit;font-size:calc(11px * var(--lumiverse-font-scale,1));color:var(--lumiverse-text);background:var(--lumiverse-bg);border:1px solid var(--lumiverse-border);border-radius:6px;padding:6px;resize:vertical; }
  .canvas-organization-create button:focus-visible,.canvas-organization-more:focus-visible,.canvas-organization-row button:focus-visible,.canvas-organization-action-panel button:focus-visible,.canvas-organization-icons button:focus-visible,.canvas-organization-import:focus-within { outline:2px solid var(--lumiverse-primary);outline-offset:1px; }
  .canvas-organization-end { min-height:16px; }
  @media(max-width:500px) { .canvas-organization-child { margin-left:12px; } }
  @media(pointer:coarse) { .canvas-organization-create button { min-height:32px; } .canvas-organization-more,.canvas-organization-row button,.canvas-organization-action-panel button { min-width:32px;min-height:32px; } }
`
