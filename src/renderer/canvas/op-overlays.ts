import type { OpInstance } from "@shared/types/op";
import type { Task } from "@shared/types/project";

export type FractionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EditableOverlay = {
  kind: "crop" | "redact";
  opIndex: number;
  rect: FractionRect;
  color: string;
};

const defaultRedactionRect: FractionRect = { x: 0.1, y: 0.1, w: 0.25, h: 0.25 };

export function selectedEditableOverlay(task: Task | null, selectedOpIndex: number | null): EditableOverlay | null {
  if (!task || selectedOpIndex === null) return null;
  const op = task.pipeline.ops[selectedOpIndex];
  if (!op?.enabled) return null;

  if (op.type === "crop") {
    return {
      kind: "crop",
      opIndex: selectedOpIndex,
      rect: cropRectFromOp(op),
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

export function cropRectFromOp(op: OpInstance): FractionRect {
  return clampFractionRect({
    x: numberOr(op.params.x, 0),
    y: numberOr(op.params.y, 0),
    w: numberOr(op.params.w, 1),
    h: numberOr(op.params.h, 1)
  });
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

export function updatePatchForOverlay(op: OpInstance, rect: FractionRect): Record<string, unknown> {
  const nextRect = clampFractionRect(rect);
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

function clampFractionRect(rect: FractionRect): FractionRect {
  const x = clamp(rect.x, 0, 1);
  const y = clamp(rect.y, 0, 1);
  const maxWidth = Math.max(0.01, 1 - x);
  const maxHeight = Math.max(0.01, 1 - y);
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
