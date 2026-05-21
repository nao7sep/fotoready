import React, { useEffect, useState } from "react";
import { Ellipse, Rect } from "react-konva";
import type { ConcealRegion } from "@shared/types/conceal";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpOverlayProps, OverlayPlacement } from "./op-renderer";
import {
  clampConcealRegion,
  concealRegionFromStage,
  concealRegionToStage,
  readConcealRegionList,
  replacePrimaryConcealRegion
} from "./_conceal-primitives";

/** Shared draggable conceal overlay used by cover, blur, and mosaic. */
export function ConcealOverlay<P extends { rects: ConcealRegion[] } & Record<string, unknown>>({
  params,
  selected,
  ctx,
  onParamsChange
}: OpOverlayProps<P>): React.JSX.Element | null {
  const rects = readConcealRegionList(params.rects);
  const firstRect = rects[0] ?? null;
  const clampedFirst = firstRect ? clampConcealRegion(firstRect, ctx.imageBounds) : null;

  const [draft, setDraft] = useState<ConcealRegion | null>(null);
  useEffect(() => { setDraft(null); }, [firstRect?.h, firstRect?.rotation, firstRect?.shape, firstRect?.w, firstRect?.x, firstRect?.y]);

  if (!selected) {
    return (
      <>
        {rects.map((rect, index) => (
          <ConcealShapeOutline
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
          onParamsChange({ rects: replacePrimaryConcealRegion(rects, committed) } as Partial<P>);
        }}
      />
      {rects.slice(1).map((rect, index) => (
        <ConcealShapeOutline
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

function ConcealShapeOutline({
  color,
  placement,
  region,
  longEdge
}: {
  color: string;
  placement: OverlayPlacement;
  region: ConcealRegion;
  longEdge: number;
}): React.JSX.Element {
  const stage = concealRegionToStage(region, longEdge, placement);
  const centerX = stage.x + stage.w / 2;
  const centerY = stage.y + stage.h / 2;
  if (region.shape === "ellipse") {
    return (
      <Ellipse
        dash={[6, 4]}
        listening={false}
        radiusX={stage.w / 2}
        radiusY={stage.h / 2}
        rotation={stage.rotation}
        stroke={color}
        strokeWidth={2}
        x={centerX}
        y={centerY}
      />
    );
  }
  return (
    <Rect
      dash={[6, 4]}
      height={stage.h}
      listening={false}
      offsetX={stage.w / 2}
      offsetY={stage.h / 2}
      rotation={stage.rotation}
      stroke={color}
      strokeWidth={2}
      width={stage.w}
      x={centerX}
      y={centerY}
    />
  );
}
