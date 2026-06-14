/**
 * Content-Security-Policy for FotoReady's packaged renderer.
 *
 * Delivered as a `<meta http-equiv="Content-Security-Policy">` tag injected into the built
 * `index.html` (see the build-only plugin in `electron.vite.config.ts`). A meta tag is the
 * spec-defined CSP delivery mechanism that actually applies to a `file://` renderer — response-header
 * injection via `session.onHeadersReceived` does not fire for `file://`. It is injected ONLY in the
 * production build, so the dev server keeps no CSP and Vite HMR's inline scripts / eval / websocket
 * are unaffected.
 *
 * The directives are scoped to exactly what the renderer loads:
 *  - scripts: the app's own bundled module scripts only — never `'unsafe-inline'`/`'unsafe-eval'`.
 *    Vite's inline module-preload polyfill is disabled in the renderer build (Electron's Chromium
 *    supports `modulepreload` natively), so `script-src 'self'` can stay strict.
 *  - styles: `'unsafe-inline'` is required for React `style={{…}}` props and Vite-injected `<style>`.
 *  - images: `'self'` plus `data:` for the base64 thumbnails, previews, histogram, and LUT swatches.
 *  - there is no web worker, `blob:`, remote `fetch`, or web font in the renderer, so those sources
 *    are deliberately omitted (they fall back to the restrictive `default-src 'self'`).
 *
 * `frame-ancestors` is intentionally absent: it is ignored in a meta-delivered policy, and the
 * BrowserWindow plus the `will-navigate`/`setWindowOpenHandler` guards already prevent embedding.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'"
].join("; ");
