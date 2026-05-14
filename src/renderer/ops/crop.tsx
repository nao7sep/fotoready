import React, { useEffect, useState } from "react";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";
import { clampFractionRect, CropDarkenMask, type FractionRect, imageBoundsFromSize, OverlayRect } from "./_overlay-primitives";

type CropAspectLock = number | string | null;
type CropParams = { x: number; y: number; w: number; h: number; aspectLock: CropAspectLock };

type CropAspectOptionId = "free" | "original" | "1:1" | "4:5" | "3:2" | "16:9";

const cropAspectOptions: ReadonlyArray<{ id: CropAspectOptionId; label: string }> = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "3:2", label: "3:2" },
  { id: "16:9", label: "16:9" }
];

export const cropRenderer: OpRenderer<CropParams> = {
  type: "crop",
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const originalAspectRatio = ctx.originalSize ? ctx.originalSize.width / Math.max(1, ctx.originalSize.height) : null;
    const imageBounds = ctx.originalSize ? imageBoundsFromSize(ctx.originalSize) : { maxX: 1, maxY: 1 };
    const currentRect = clampFractionRect({ x: params.x, y: params.y, w: params.w, h: params.h }, imageBounds);
    const activeAspectId = identifyAspect(params.aspectLock, originalAspectRatio);

    function handleAspectChange(nextAspectId: CropAspectOptionId): void {
      if (nextAspectId === "free") {
        onParamChange("aspectLock", null);
        return;
      }
      const aspectRatio = resolveAspectRatio(nextAspectId, originalAspectRatio);
      if (!aspectRatio) return;
      const nextRect = fitAspect(currentRect, aspectRatio, imageBounds);
      onParamsChange({ ...nextRect, aspectLock: nextAspectId });
    }

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Aspect: <strong>{aspectLabel(activeAspectId, currentRect)}</strong></span>
          <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamsChange({ x: 0, y: 0, w: imageBounds.maxX, h: imageBounds.maxY, aspectLock: null })}>
            Reset crop
          </button>
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Crop aspect ratio">
          {cropAspectOptions.map((option) => (
            <button
              className={`geometry-chip ${activeAspectId === option.id ? "active" : ""}`}
              disabled={disabled}
              key={option.id}
              type="button"
              onClick={() => handleAspectChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="geometry-help">Drag the crop lines on the preview. Use these chips here to keep or change the aspect ratio.</div>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    const rect = clampFractionRect({ x: params.x, y: params.y, w: params.w, h: params.h }, ctx.imageBounds);
    const [draft, setDraft] = useState<FractionRect | null>(null);
    useEffect(() => { setDraft(null); }, [params.x, params.y, params.w, params.h]);

    if (!selected) {
      return <OverlayRect color="#facc15" rect={rect} placement={ctx.placement} longEdge={ctx.longEdge} />;
    }

    const visible = draft ?? rect;
    const aspect = resolveAspectRatio(params.aspectLock as CropAspectOptionId | number | null, ctx.originalAspectRatio);
    const stageRect = {
      x: ctx.placement.x + visible.x * ctx.longEdge * ctx.placement.scale,
      y: ctx.placement.y + visible.y * ctx.longEdge * ctx.placement.scale,
      w: visible.w * ctx.longEdge * ctx.placement.scale,
      h: visible.h * ctx.longEdge * ctx.placement.scale
    };

    return (
      <>
        <CropDarkenMask placement={ctx.placement} rect={visible} longEdge={ctx.longEdge} stageSize={ctx.stageSize} />
        <InteractiveOverlayRect
          aspectRatio={aspect}
          color="#facc15"
          placement={ctx.placement}
          rect={stageRect}
          onChange={(nextRect) => setDraft(stageToFractionRect(nextRect, ctx))}
          onCommit={(nextRect) => {
            const committed = stageToFractionRect(nextRect, ctx);
            setDraft(null);
            onParamsChange(committed);
          }}
        />
      </>
    );
  }
};

function stageToFractionRect(rect: { x: number; y: number; w: number; h: number }, ctx: { placement: { x: number; y: number; scale: number }; longEdge: number }): FractionRect {
  return {
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    w: rect.w / (ctx.longEdge * ctx.placement.scale),
    h: rect.h / (ctx.longEdge * ctx.placement.scale)
  };
}

function identifyAspect(aspectLock: CropAspectLock, originalAspectRatio: number | null): CropAspectOptionId | "custom" {
  if (aspectLock === null || aspectLock === undefined) return "free";
  if (aspectLock === "original") return "original";
  if (typeof aspectLock === "string" && ["1:1", "4:5", "3:2", "16:9"].includes(aspectLock)) {
    return aspectLock as "1:1" | "4:5" | "3:2" | "16:9";
  }
  const ratio = resolveAspectRatio(aspectLock, originalAspectRatio);
  if (!ratio) return "custom";
  if (originalAspectRatio && Math.abs(ratio - originalAspectRatio) <= 0.02) return "original";
  if (Math.abs(ratio - 1) <= 0.02) return "1:1";
  if (Math.abs(ratio - 4 / 5) <= 0.02) return "4:5";
  if (Math.abs(ratio - 3 / 2) <= 0.02) return "3:2";
  if (Math.abs(ratio - 16 / 9) <= 0.02) return "16:9";
  return "custom";
}

function resolveAspectRatio(aspectLock: unknown, originalAspectRatio: number | null): number | null {
  if (typeof aspectLock === "number" && Number.isFinite(aspectLock) && aspectLock > 0) return aspectLock;
  if (typeof aspectLock !== "string") return null;
  if (aspectLock === "original") return originalAspectRatio && Number.isFinite(originalAspectRatio) && originalAspectRatio > 0 ? originalAspectRatio : null;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectLock.trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : null;
}

function fitAspect(rect: FractionRect, aspectRatio: number, imageBounds: { maxX: number; maxY: number }): FractionRect {
  const next = clampFractionRect(rect, imageBounds);
  if (!(aspectRatio > 0) || !Number.isFinite(aspectRatio)) return next;
  const centerX = next.x + next.w / 2;
  const centerY = next.y + next.h / 2;
  const targetArea = Math.max(0.0001, next.w * next.h);
  let width = Math.sqrt(targetArea * aspectRatio);
  let height = width / aspectRatio;
  const maxWidth = 2 * Math.min(centerX, imageBounds.maxX - centerX);
  const maxHeight = 2 * Math.min(centerY, imageBounds.maxY - centerY);
  const scale = Math.min(1, maxWidth / width || 1, maxHeight / height || 1);
  width *= scale;
  height *= scale;
  return clampFractionRect({ x: centerX - width / 2, y: centerY - height / 2, w: width, h: height }, imageBounds);
}

function aspectLabel(activeId: CropAspectOptionId | "custom", rect: { w: number; h: number }): string {
  if (activeId === "custom") return `${(rect.w / Math.max(rect.h, 0.001)).toFixed(2)}:1`;
  return cropAspectOptions.find((option) => option.id === activeId)?.label ?? "Free";
}
