// Stable selectors for Lumiverse DOM elements. CSS-module hashes change
// across builds, but attribute selectors on React-controlled elements are
// stable across versions.
export const SELECTOR_TEXTAREA = 'textarea[name="chat-message"]'
export const SELECTOR_SEND_BTN = 'button[class*="sendBtn"]'
