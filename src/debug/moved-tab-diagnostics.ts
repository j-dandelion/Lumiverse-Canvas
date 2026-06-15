/**
 * Diagnose the layout of a tab that has been (or is being) moved to the
 * secondary drawer. Dumps the full ancestor chain with computed styles,
 * bounding rects, inline styles, and matched CSS rules. Use to debug
 * layout collapse issues like the Creator Notes ~150px iframe bug.
 *
 * Gated behind localStorage flag `canvasDiagMovedTab`. Enable with:
 *   localStorage.setItem('canvasDiagMovedTab', '1')
 * Disable with:
 *   localStorage.removeItem('canvasDiagMovedTab')
 */

const TAG = '[canvas-diag]'

function diagEnabled(): boolean {
  try {
    return localStorage.getItem('canvasDiagMovedTab') === '1'
  } catch {
    return false
  }
}

export function setDiagEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem('canvasDiagMovedTab', '1')
    else localStorage.removeItem('canvasDiagMovedTab')
  } catch { /* ignore */ }
}

function fmtRect(r: DOMRect | { x: number; y: number; width: number; height: number }): string {
  return `x:${r.x.toFixed(1)} y:${r.y.toFixed(1)} w:${r.width.toFixed(1)} h:${r.height.toFixed(1)}`
}

function getComputedProps(el: HTMLElement): Record<string, string> {
  const cs = window.getComputedStyle(el)
  const props = [
    'height', 'width', 'minHeight', 'minWidth',
    'position', 'display', 'flex', 'flexDirection', 'flexWrap',
    'boxSizing', 'overflow', 'top', 'left', 'right', 'bottom',
  ] as const
  const out: Record<string, string> = {}
  for (const p of props) {
    out[p] = cs[p]
  }
  return out
}

function dumpElement(label: string, el: HTMLElement): void {
  console.log(`${TAG} ${label}: <${el.tagName.toLowerCase()}>`)
  console.log(`${TAG}   className:`, el.className)
  console.log(`${TAG}   id:`, el.id)
  console.log(`${TAG}   inline style:`, el.style.cssText)
  console.log(`${TAG}   bounding rect:`, fmtRect(el.getBoundingClientRect()))

  const cp = getComputedProps(el)
  console.log(`${TAG}   computed styles:`, cp)

  if (el.parentElement) {
    const pcs = window.getComputedStyle(el.parentElement)
    console.log(`${TAG}   parent: <${el.parentElement.tagName.toLowerCase()}> class="${el.parentElement.className}" computed height=${pcs.height}`)
  }
}

function dumpAncestorChain(startEl: HTMLElement, stopClass?: string): void {
  console.log(`${TAG} ancestor chain from <${startEl.tagName.toLowerCase()}>`)
  let el: HTMLElement | null = startEl
  let depth = 0
  while (el && depth < 30) {
    const cs = window.getComputedStyle(el)
    console.log(`${TAG}   ${'  '.repeat(depth)}<${el.tagName.toLowerCase()}> class="${el.className}" h=${cs.height} w=${cs.width} pos=${cs.position} display=${cs.display}`)
    if (stopClass && el.classList.contains(stopClass)) {
      console.log(`${TAG}   (reached stop class: .${stopClass})`)
      break
    }
    el = el.parentElement
    depth++
  }
}

function findMovedTabRules(): string[] {
  const rules: string[] = []
  try {
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i]
      let cssRules: CSSRuleList
      try {
        cssRules = sheet.cssRules
      } catch {
        continue // cross-origin stylesheet
      }
      for (let j = 0; j < cssRules.length; j++) {
        const rule = cssRules[j]
        if (rule instanceof CSSStyleRule && rule.selectorText && rule.selectorText.includes('data-canvas-moved')) {
          rules.push(`${rule.selectorText} { ${rule.style.cssText} }`)
        }
      }
    }
  } catch { /* ignore */ }
  return rules
}

/**
 * Dump full layout diagnostics for a tab being moved to the secondary drawer.
 */
export function diagnoseMovedTab(tabId: string, tabRoot: HTMLElement): void {
  if (!diagEnabled()) return

  try {
    console.log(`${TAG} === layout diagnostics for tab "${tabId}" ===`)

    // Check if tabRoot is in the DOM
    if (!tabRoot.isConnected) {
      console.warn(`${TAG} tabRoot is NOT in the DOM — cannot diagnose layout`)
      return
    }

    // Presence of data-canvas-moved
    const hasMoveAttr = tabRoot.hasAttribute('data-canvas-moved')
    console.log(`${TAG} data-canvas-moved attribute present: ${hasMoveAttr}`)

    // Dump tabRoot itself
    dumpElement('tab.root', tabRoot)

    // Find iframeContainer (first child div) and iframe (recursive)
    let iframeContainer: HTMLElement | null = null
    for (const child of Array.from(tabRoot.children)) {
      if (child instanceof HTMLElement && child.tagName === 'DIV') {
        iframeContainer = child
        break
      }
    }

    if (iframeContainer) {
      dumpElement('iframeContainer', iframeContainer)
    } else {
      console.log(`${TAG} no iframeContainer (first div child) found`)
    }

    const iframe = tabRoot.querySelector('iframe')
    if (iframe) {
      dumpElement('iframe', iframe as unknown as HTMLElement)
      console.log(`${TAG}   iframe src:`, iframe.src)
    } else {
      console.log(`${TAG} no <iframe> found in tab root`)
    }

    // Ancestry chain up to .sidebar-ux-secondary-wrapper or document.body
    dumpAncestorChain(tabRoot, 'sidebar-ux-secondary-wrapper')

    // CSS rules referencing data-canvas-moved
    const movedRules = findMovedTabRules()
    if (movedRules.length > 0) {
      console.log(`${TAG} matched CSS rules for data-canvas-moved:`)
      movedRules.forEach(r => console.log(`${TAG}   ${r}`))
    } else {
      console.log(`${TAG} NO CSS rules referencing data-canvas-moved found in document.styleSheets`)
    }

    // Secondary wrapper state
    const secondaryWrapper = document.querySelector('.sidebar-ux-secondary-wrapper')
    if (secondaryWrapper) {
      const cs = window.getComputedStyle(secondaryWrapper as HTMLElement)
      console.log(`${TAG} .sidebar-ux-secondary-wrapper transform: ${cs.transform}`)
      console.log(`${TAG} .sidebar-ux-secondary-wrapper height: ${cs.height}`)
      console.log(`${TAG} .sidebar-ux-secondary-wrapper overflow: ${cs.overflow}`)
    } else {
      console.log(`${TAG} .sidebar-ux-secondary-wrapper NOT FOUND in DOM`)
    }

    // Panel content height + padding
    const panelContent = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
    if (panelContent) {
      const pcs = window.getComputedStyle(panelContent as HTMLElement)
      console.log(`${TAG} .sidebar-ux-panel-content height: ${pcs.height}`)
      console.log(`${TAG} .sidebar-ux-panel-content padding: ${pcs.padding}`)
    }

    console.log(`${TAG} === END ${tabId} ===`)
  } catch (err) {
    console.error(`${TAG} diagnoseMovedTab failed: ${err}`)
  }
}
