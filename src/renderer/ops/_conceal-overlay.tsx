import React, { useEffect, useState } from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpOverlayProps } from "./op-renderer";
import {
  clampConcealRegion,
  OverlayConcealShape,
  patchFirstConcealRegion,
  readConcealRegionList,
  concealRegionFromStage,
  concealRegionToStage
} from "./_conceal-primitives";

/** Shared draggable conceal overlay used by conceal-fill, conceal-blur, conceal-pixelate. */
export function ConcealOverlay({ params, selected, ctx, onParamsChange }: OpOverlayProps<{ rects: ConcealRegion[] } & Record<string, unknown>>): React.JSX.Element | null {
  const rects = readConcealRegionList(params.rects);
  const firstRect = rects[0] ?? null;
  const clampedFirst = firstRect ? clampConcealRegion(firstRect, ctx.imageBounds) : null;

  const [draft, setDraft] = useState<ConcealRegion | null>(null);
  useEffect(() => { setDraft(null); }, [firstRect?.h, firstRect?.rotation, firstRect?.shape, firstRect?.w, firstRect?.x, firstRect?.y]);

  if (!selected) {
    return (
      <>
        {rects.map((rect, index) => (
          <OverlayConcealShape
            color="#f87171"
            key={`r-${index}`}
            longEdge={ctx.longEdge}
            placement={ctx.placement}
            region={clampConcealRegion(rect, ctx.imageBounds)}
          />
        ))}
      </>
    );
  }

  if (!clampedFirst) return null;

  const visible = draft ?? clampedFirst;
  const stageRect = concealRegionToStage(visible, ctx.longEdge, ctx.placement);
  return (
    <>
      <InteractiveOverlayRect
        color="#f87171"
        placement={ctx.placement}
        rect={stageRect}
        rotateEnabled
        shape={visible.shape}
        onChange={(next) => setDraft(concealRegionFromStage(next, ctx.longEdge, ctx.placement, visible.shape))}
        onCommit={(next) => {
          const committed = clampConcealRegion(concealRegionFromStage(next, ctx.longEdge, ctx.placement, visible.shape), ctx.imageBounds);
          setDraft(null);
          const nextRects = patchFirstConcealRegion(rects, committed);
          onParamsChange({ rects: nextRects });
        }}
      />
      {rects.slice(1).map((rect, index) => (
        <OverlayConcealShape
          color="#f87171"
          key={`r-${index + 1}`}
          longEdge={ctx.longEdge}
          placement={ctx.placement}
          region={clampConcealRegion(rect, ctx.imageBounds)}
        />
      ))}
    </>
  );
}
