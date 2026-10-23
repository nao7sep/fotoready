import type { OpInstance } from "./types/op";

export type ImageSize = { width: number; height: number };

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

/** Input frame for each stage, in pipeline order. Params have already been validated. */
export function stageInputSizes(source: ImageSize, ops: readonly OpInstance[]): ImageSize[] {
  const inputs: ImageSize[] = [];
  let size = source;
  for (const op of ops) {
    inputs.push(size);
    size = outputSizeForOp(size, op);
  }
  return inputs;
}

/** Largest actual frame area, including the source and every stage output. */
export function maximumPipelinePixels(source: ImageSize, ops: readonly OpInstance[]): number {
  let size = source;
  let maximum = size.width * size.height;
  for (const op of ops) {
    if (!op.enabled) continue;
    size = outputSizeForOp(size, op);
    maximum = Math.max(maximum, size.width * size.height);
  }
  return maximum;
}

export function outputSizeForOp(source: ImageSize, op: OpInstance): ImageSize {
  if (!op.enabled) return source;
  switch (op.type) {
    case "crop": {
      const region = cropExtractRegion(op.params as { x: number; y: number; w: number; h: number }, source.width, source.height);
      return { width: region.width, height: region.height };
    }
    case "rotate": {
      const degrees = ((op.params.degrees as number) % 360 + 360) % 360;
      if (degrees === 0 || degrees === 180) return source;
      if (degrees === 90 || degrees === 270) return { width: source.height, height: source.width };
      const radians = degrees * Math.PI / 180;
      const cosine = Math.abs(Math.cos(radians));
      const sine = Math.abs(Math.sin(radians));
      return {
        width: Math.round(source.width * cosine + source.height * sine),
        height: Math.round(source.width * sine + source.height * cosine)
      };
    }
    case "resize": {
      const { mode, width, height } = op.params as { mode: "fit" | "exact"; width: number; height: number };
      if (mode === "exact") return { width, height };
      const scale = Math.min(width / source.width, height / source.height);
      return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
    }
    default:
      return source;
  }
}
