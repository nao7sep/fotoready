import type { OpInstance } from "@shared/types/op";
import type { Task } from "@shared/types/project";

export type FractionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type NormalizedImageBounds = {
  maxX: number;
  maxY: number;
};

export type EditableOverlay = {
  kind: "crop" | "redact";
  opIndex: number;
  rect: FractionRect;
  color: string;
};

export type WhiteBalanceSample = {
  opIndex: number;
  point: { x: number; y: number } | null;
};

const defaultRedactionRect: FractionRect = { x: 0.1, y: 0.1, w: 0.25, h: 0.25 };
const defaultImageBounds: NormalizedImageBounds = { maxX: 1, maxY: 1 };

export function selectedEditableOverlay(
  task: Task | null,
  selectedOpIndex: number | null,
  imageBounds: NormalizedImageBounds = defaultImageBounds
): EditableOverlay | null {
  if (!task || selectedOpIndex === null) return null;
  const op = task.pipeline.ops[selectedOpIndex];
  if (!op?.enabled) return null;

  if (op.type === "crop") {
    return {
      kind: "crop",
      opIndex: selectedOpIndex,
      rect: cropRectFromOp(op, imageBounds),
      color: "#facc15"
    };
  }

  if (op.type.startsWith("redact-")) {
    return {
      kind: "redact",
      opIndex: selectedOpIndex,
      rect: firstRedactionRect(op),
      color: "#f87171"
    };
  }

  return null;
}

export function selectedWhiteBalanceSample(task: Task | null, selectedOpIndex: number | null): WhiteBalanceSample | null {
  if (!task || selectedOpIndex === null) return null;
  const op = task.pipeline.ops[selectedOpIndex];
  if (!op?.enabled || op.type !== "white-balance") return null;
  return {
    opIndex: selectedOpIndex,
    point: whiteBalanceSamplePoint(op)
  };
}

export function cropRectFromOp(op: OpInstance, imageBounds: NormalizedImageBounds = defaultImageBounds): FractionRect {
  return clampFractionRect(
    {
      x: numberOr(op.params.x, 0),
      y: numberOr(op.params.y, 0),
      w: numberOr(op.params.w, 1),
      h: numberOr(op.params.h, 1)
    },
    imageBounds
  );
}

export function firstRedactionRect(op: OpInstance): FractionRect {
  const rects = redactionRects(op.params.rects);
  return clampFractionRect(rects[0] ?? defaultRedactionRect);
}

export function redactionRects(value: unknown): FractionRect[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rect = entry as Partial<FractionRect>;
    if (typeof rect.x !== "number" || typeof rect.y !== "number" || typeof rect.w !== "number" || typeof rect.h !== "number") {
      return [];
    }
    return [clampFractionRect(rect as FractionRect)];
  });
}

export function updatePatchForOverlay(
  op: OpInstance,
  rect: FractionRect,
  imageBounds: NormalizedImageBounds = defaultImageBounds
): Record<string, unknown> {
  const nextRect = clampFractionRect(rect, imageBounds);
  if (op.type === "crop") {
    return nextRect;
  }

  if (op.type.startsWith("redact-")) {
    const rects = redactionRects(op.params.rects);
    if (rects.length === 0) {
      return { rects: [nextRect] };
    }
    return {
      rects: [nextRect, ...rects.slice(1)]
    };
  }

  return {};
}

export function scaleRect(rect: FractionRect, longEdge: number): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * longEdge,
    y: rect.y * longEdge,
    w: rect.w * longEdge,
    h: rect.h * longEdge
  };
}

export function whiteBalanceSamplePoint(op: OpInstance): { x: number; y: number } | null {
  const samplePoint = op.params.samplePoint;
  if (!Array.isArray(samplePoint) || samplePoint.length < 2) return null;
  if (typeof samplePoint[0] !== "number" || typeof samplePoint[1] !== "number") return null;
  return {
    x: clamp(samplePoint[0], 0, 1),
    y: clamp(samplePoint[1], 0, 1)
  };
}

export function imageBoundsFromSize(imageSize: { width: number; height: number }): NormalizedImageBounds {
  const longEdge = Math.max(imageSize.width, imageSize.height, 1);
  return {
    maxX: clamp(imageSize.width / longEdge, 0.01, 1),
    maxY: clamp(imageSize.height / longEdge, 0.01, 1)
  };
}

export function fullCropRect(imageBounds: NormalizedImageBounds = defaultImageBounds): FractionRect {
  return {
    x: 0,
    y: 0,
    w: imageBounds.maxX,
    h: imageBounds.maxY
  };
}

export function resolveCropAspectRatio(aspectLock: unknown, originalAspectRatio: number | null): number | null {
  if (typeof aspectLock === "number" && Number.isFinite(aspectLock) && aspectLock > 0) {
    return aspectLock;
  }
  if (typeof aspectLock !== "string") {
    return null;
  }

  if (aspectLock === "original") {
    return originalAspectRatio && Number.isFinite(originalAspectRatio) && originalAspectRatio > 0 ? originalAspectRatio : null;
  }

  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectLock.trim());
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

export function cropAspectOptionId(aspectLock: unknown, originalAspectRatio: number | null): "free" | "original" | "1:1" | "4:5" | "3:2" | "16:9" | "custom" {
  if (aspectLock === null || aspectLock === undefined) {
    return "free";
  }
  if (aspectLock === "original") {
    return "original";
  }
  if (typeof aspectLock === "string" && ["1:1", "4:5", "3:2", "16:9"].includes(aspectLock)) {
    return aspectLock as "1:1" | "4:5" | "3:2" | "16:9";
  }

  const ratio = resolveCropAspectRatio(aspectLock, originalAspectRatio);
  if (!ratio) {
    return "custom";
  }

  if (originalAspectRatio && approximatelyEqual(ratio, originalAspectRatio)) {
    return "original";
  }
  if (approximatelyEqual(ratio, 1)) return "1:1";
  if (approximatelyEqual(ratio, 4 / 5)) return "4:5";
  if (approximatelyEqual(ratio, 3 / 2)) return "3:2";
  if (approximatelyEqual(ratio, 16 / 9)) return "16:9";
  return "custom";
}

export function applyCropAspect(rect: FractionRect, aspectRatio: number, imageBounds: NormalizedImageBounds = defaultImageBounds): FractionRect {
  const nextRect = clampFractionRect(rect, imageBounds);
  if (!(aspectRatio > 0) || !Number.isFinite(aspectRatio)) {
    return nextRect;
  }

  const centerX = nextRect.x + nextRect.w / 2;
  const centerY = nextRect.y + nextRect.h / 2;
  const targetArea = Math.max(0.0001, nextRect.w * nextRect.h);
  let width = Math.sqrt(targetArea * aspectRatio);
  let height = width / aspectRatio;

  const maxWidth = 2 * Math.min(centerX, imageBounds.maxX - centerX);
  const maxHeight = 2 * Math.min(centerY, imageBounds.maxY - centerY);
  const scale = Math.min(1, maxWidth / width || 1, maxHeight / height || 1);

  width *= scale;
  height *= scale;

  return clampFractionRect(
    {
      x: centerX - width / 2,
      y: centerY - height / 2,
      w: width,
      h: height
    },
    imageBounds
  );
}

export function clampFractionRect(rect: FractionRect, imageBounds: NormalizedImageBounds = defaultImageBounds): FractionRect {
  const maxX = clamp(imageBounds.maxX, 0.01, 1);
  const maxY = clamp(imageBounds.maxY, 0.01, 1);
  const x = clamp(rect.x, 0, maxX);
  const y = clamp(rect.y, 0, maxY);
  const maxWidth = Math.max(0.01, maxX - x);
  const maxHeight = Math.max(0.01, maxY - y);
  return {
    x,
    y,
    w: clamp(rect.w, 0.01, maxWidth),
    h: clamp(rect.h, 0.01, maxHeight)
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approximatelyEqual(left: number, right: number, epsilon = 0.02): boolean {
  return Math.abs(left - right) <= epsilon;
}
