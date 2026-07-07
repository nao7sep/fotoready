/**
 * Projects a normalized crop rectangle (fractions of the image's long edge) onto pixel coordinates,
 * clamped so the result is always a valid, in-bounds `extract` window.
 *
 * The UI clamps crop rectangles before they reach here, but a hand-edited or corrupted task sidecar
 * can carry an out-of-range fraction. Without clamping, an origin past the image edge yields a zero
 * or negative width/height, which Sharp's `extract` rejects with an opaque error. Clamping the
 * origin inside the image and flooring the size at one pixel keeps a malformed project file from
 * turning into an unexplained processing failure.
 */
export function cropExtractRegion(
  params: { x: number; y: number; w: number; h: number },
  sourceWidth: number,
  sourceHeight: number
): { left: number; top: number; width: number; height: number } {
  const longEdge = Math.max(sourceWidth, sourceHeight, 1);
  const maxLeft = Math.max(0, sourceWidth - 1);
  const maxTop = Math.max(0, sourceHeight - 1);

  const left = Math.min(Math.max(0, Math.round(params.x * longEdge)), maxLeft);
  const top = Math.min(Math.max(0, Math.round(params.y * longEdge)), maxTop);
  const width = Math.max(1, Math.min(Math.round(params.w * longEdge), sourceWidth - left));
  const height = Math.max(1, Math.min(Math.round(params.h * longEdge), sourceHeight - top));

  return { left, top, width, height };
}
