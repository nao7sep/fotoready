import React, { useEffect, useState } from "react";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import { clampFractionRect, OverlayRect, readRectList, rectFromStage, rectToStage, type FractionRect } from "./_overlay-primitives";
import type { OpOverlayProps } from "./op-renderer";

const DEFAULT_REDACT_RECT: FractionRect = { x: 0.1, y: 0.1, w: 0.25, h: 0.25 };

/** Shared draggable-rect overlay used by redact-fill, redact-blur, redact-pixelate. */
export function RedactOverlay({ params, selected, ctx, onParamsChange }: OpOverlayProps<{ rects: FractionRect[] } & Record<string, unknown>>): React.JSX.Element | null {
  const rects = readRectList(params.rects);
  const firstRect = rects[0] ?? DEFAULT_REDACT_RECT;
  const clampedFirst = clampFractionRect(firstRect, ctx.imageBounds);

  const [draft, setDraft] = useState<FractionRect | null>(null);
  useEffect(() => { setDraft(null); }, [firstRect.x, firstRect.y, firstRect.w, firstRect.h]);

  if (!selected) {
    return (
      <>
        {rects.map((rect, index) => (
          <OverlayRect color="#f87171" key={`r-${index}`} rect={clampFractionRect(rect, ctx.imageBounds)} placement={ctx.placement} longEdge={ctx.longEdge} />
        ))}
      </>
    );
  }

  const visible = draft ?? clampedFirst;
  const stageRect = rectToStage(visible, ctx.longEdge, ctx.placement);
  return (
    <>
      <InteractiveOverlayRect
        color="#f87171"
        placement={ctx.placement}
        rect={stageRect}
        onChange={(next) => setDraft(rectFromStage(next, ctx.longEdge, ctx.placement))}
        onCommit={(next) => {
          const committed = clampFractionRect(rectFromStage(next, ctx.longEdge, ctx.placement), ctx.imageBounds);
          setDraft(null);
          const nextRects = rects.length === 0 ? [committed] : [committed, ...rects.slice(1)];
          onParamsChange({ rects: nextRects });
        }}
      />
      {rects.slice(1).map((rect, index) => (
        <OverlayRect color="#f87171" key={`r-${index + 1}`} rect={clampFractionRect(rect, ctx.imageBounds)} placement={ctx.placement} longEdge={ctx.longEdge} />
      ))}
    </>
  );
}
