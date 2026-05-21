import React, { useEffect, useMemo, useState } from "react";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";
import { clampFractionRect, CropDarkenMask, type FractionRect, imageBoundsFromOriginalSize, OverlayRect, rectFromStage, rectToStage } from "./_overlay-primitives";

type CropAspectLock = number | string | null;
type CropParams = { x: number; y: number; w: number; h: number; aspectLock: CropAspectLock };

type CropAspectOptionId = "free" | "original" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";

const cropAspectOptions: ReadonlyArray<{ id: CropAspectOptionId; label: string }> = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "2:3", label: "2:3" },
  { id: "3:2", label: "3:2" },
  { id: "3:4", label: "3:4" },
  { id: "4:3", label: "4:3" },
  { id: "9:16", label: "9:16" },
  { id: "16:9", label: "16:9" }
];

export const cropRenderer: OpRenderer<CropParams> = {
  type: "crop",
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const originalAspectRatio = ctx.originalSize ? ctx.originalSize.width / Math.max(1, ctx.originalSize.height) : null;
    const imageBounds = imageBoundsFromOriginalSize(ctx.originalSize);
    const currentRect = clampFractionRect({ x: params.x, y: params.y, w: params.w, h: params.h }, imageBounds);
    const activeAspectId = identifyAspect(params.aspectLock, originalAspectRatio);
    const customAspectDraft = useMemo(() => readCustomAspectDraft(params.aspectLock), [params.aspectLock]);
    const [customWidth, setCustomWidth] = useState(customAspectDraft.width);
    const [customHeight, setCustomHeight] = useState(customAspectDraft.height);

    useEffect(() => {
      setCustomWidth(customAspectDraft.width);
      setCustomHeight(customAspectDraft.height);
    }, [customAspectDraft.height, customAspectDraft.width]);

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

    function updateCustomAspect(nextWidth: string, nextHeight: string): void {
      const width = parseCustomAspectPart(nextWidth);
      const height = parseCustomAspectPart(nextHeight);
      if (width === null || height === null) return;
      const nextRect = fitAspect(currentRect, width / height, imageBounds);
      onParamsChange({ ...nextRect, aspectLock: `${width}:${height}` });
    }

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Aspect: <strong>{aspectLabel(activeAspectId, currentRect)}</strong></span>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onParamsChange({ x: 0, y: 0, w: imageBounds.maxX, h: imageBounds.maxY, aspectLock: null })}>
            Reset
          </button>
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Crop aspect ratio">
          {cropAspectOptions.map((option) => (
            <button
              className={`toolbar-button compact-text ${activeAspectId === option.id ? "active" : ""}`}
              disabled={disabled}
              key={option.id}
              type="button"
              onClick={() => handleAspectChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <label className="stacked-field geometry-number-field">
            Ratio width
            <input
              disabled={disabled}
              inputMode="numeric"
              type="text"
              value={customWidth}
              onChange={(event) => {
                const nextWidth = cleanCustomAspectPart(event.currentTarget.value);
                setCustomWidth(nextWidth);
                updateCustomAspect(nextWidth, customHeight);
              }}
            />
          </label>
          <label className="stacked-field geometry-number-field">
            Ratio height
            <input
              disabled={disabled}
              inputMode="numeric"
              type="text"
              value={customHeight}
              onChange={(event) => {
                const nextHeight = cleanCustomAspectPart(event.currentTarget.value);
                setCustomHeight(nextHeight);
                updateCustomAspect(customWidth, nextHeight);
              }}
            />
          </label>
        </div>
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
    const stageRect = rectToStage(visible, ctx.longEdge, ctx.placement);

    return (
      <>
        <CropDarkenMask placement={ctx.placement} rect={visible} longEdge={ctx.longEdge} stageSize={ctx.stageSize} />
        <InteractiveOverlayRect
          aspectRatio={aspect}
          color="#facc15"
          placement={ctx.placement}
          rect={stageRect}
          onChange={(nextRect) => setDraft(rectFromStage(nextRect, ctx.longEdge, ctx.placement))}
          onCommit={(nextRect) => {
            const committed = rectFromStage(nextRect, ctx.longEdge, ctx.placement);
            setDraft(null);
            onParamsChange(committed);
          }}
        />
      </>
    );
  }
};

function identifyAspect(aspectLock: CropAspectLock, originalAspectRatio: number | null): CropAspectOptionId | "custom" {
  if (aspectLock === null || aspectLock === undefined) return "free";
  if (aspectLock === "original") return "original";
  if (typeof aspectLock === "string" && ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"].includes(aspectLock)) {
    return aspectLock as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";
  }
  const ratio = resolveAspectRatio(aspectLock, originalAspectRatio);
  if (!ratio) return "custom";
  if (originalAspectRatio && Math.abs(ratio - originalAspectRatio) <= 0.02) return "original";
  if (Math.abs(ratio - 1) <= 0.02) return "1:1";
  if (Math.abs(ratio - 2 / 3) <= 0.02) return "2:3";
  if (Math.abs(ratio - 3 / 2) <= 0.02) return "3:2";
  if (Math.abs(ratio - 3 / 4) <= 0.02) return "3:4";
  if (Math.abs(ratio - 4 / 3) <= 0.02) return "4:3";
  if (Math.abs(ratio - 9 / 16) <= 0.02) return "9:16";
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

function readCustomAspectDraft(aspectLock: CropAspectLock): { width: string; height: string } {
  if (typeof aspectLock !== "string") {
    return { width: "", height: "" };
  }
  const match = /^(\d+):(\d+)$/.exec(aspectLock.trim());
  if (!match) {
    return { width: "", height: "" };
  }
  return { width: match[1], height: match[2] };
}

function cleanCustomAspectPart(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function parseCustomAspectPart(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
