// Defer work to a true task (not a microtask) so the browser can paint between
// the user's keystroke and our handler. MessageChannel is faster than
// setTimeout(0) and works in all browsers.
export function defer<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        try { Promise.resolve(fn()).then(resolve, reject) }
        catch (e) { reject(e) }
      }
      ch.port2.postMessage(null)
    } else {
      queueMicrotask(() => {
        try { Promise.resolve(fn()).then(resolve, reject) }
        catch (e) { reject(e) }
      })
    }
  })
}
