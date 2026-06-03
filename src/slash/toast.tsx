import { render, h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

interface ToastEntry {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

let nextId = 0
const listeners = new Set<(toasts: ToastEntry[]) => void>()
let toasts: ToastEntry[] = []

function pushToast(kind: ToastEntry['kind'], text: string) {
  const id = ++nextId
  toasts = [...toasts, { id, kind, text }]
  listeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    listeners.forEach((l) => l(toasts))
  }, 4000)
}

function ToastSurface() {
  const [list, setList] = useState(toasts)
  useEffect(() => {
    listeners.add(setList)
    return () => { listeners.delete(setList) }
  }, [])
  return (
    <div
      data-canvas-slash="toast-surface"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '400px',
      }}
    >
      {list.map((t) => (
        <div
          key={t.id}
          data-kind={t.kind}
          style={{
            background: 'var(--lumiverse-bg-surface, #1e2132)',
            border: '1px solid var(--lumiverse-border, #2e334a)',
            borderLeft: `3px solid ${t.kind === 'error' ? '#e27878' : t.kind === 'success' ? '#b4be82' : '#84a0c6'}`,
            padding: '8px 12px',
            borderRadius: '4px',
            color: 'var(--lumiverse-text, #c6c8d1)',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

let mounted = false
export function mountToastSurface() {
  if (mounted) return
  mounted = true
  const host = document.createElement('div')
  host.id = 'canvas-slash-toast-host'
  document.body.appendChild(host)
  render(h(ToastSurface, {}), host)
}

// Public API: anyone in the extension (or registered via CustomEvent) can call this.
window.addEventListener('canvas:slash-toast', (e) => {
  const { kind, text } = (e as CustomEvent).detail
  pushToast(kind, text)
})
