/**
 * The live stack of open modal/dialog layers.
 *
 * Every {@link ./modal-shell.ModalShell} registers itself here while mounted. The stack is the
 * single source of truth for "which layer is on top" so that:
 *   - Escape and the Tab focus trap act only on the topmost layer, and
 *   - global window shortcuts can suppress themselves while any layer is open.
 *
 * A plain module-level array is intentional. The renderer is single-window, and the keyboard
 * handlers that consult this stack run inside DOM `keydown` listeners that need a synchronous,
 * render-independent read of the current top at event time.
 */
const layers: symbol[] = [];

/** Register a layer as newly opened (pushed on top). */
export function pushModalLayer(id: symbol): void {
  layers.push(id);
}

/** Remove a layer when it closes. Safe to call for an id that is not present. */
export function removeModalLayer(id: symbol): void {
  const index = layers.lastIndexOf(id);
  if (index >= 0) layers.splice(index, 1);
}

/** True when `id` is the topmost open layer. Escape and Tab trapping key off this. */
export function isTopModalLayer(id: symbol): boolean {
  return layers.length > 0 && layers[layers.length - 1] === id;
}

/** True when any modal or dialog layer is open. Global shortcuts suppress on this. */
export function isModalOpen(): boolean {
  return layers.length > 0;
}
