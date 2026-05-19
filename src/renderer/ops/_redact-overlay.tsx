import React, { useEffect, useState } from "react";
import { DEFAULT_REDACTION_REGION, type RedactionRegion } from "@shared/types/redaction";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpOverlayProps } from "./op-renderer";
import {
  clampRedactionRegion,
  OverlayRedactionShape,
  patchFirstRedactionRegion,
  readRedactionRegionList,
  redactionRegionFromStage,
  redactionRegionToStage
} from "./_redaction-primitives";

/** Shared draggable redaction overlay used by redact-fill, redact-blur, redact-pixelate. */
export function RedactOverlay({ params, selected, ctx, onParamsChange }: OpOverlayProps<{ rects: RedactionRegion[] } & Record<string, unknown>>): React.JSX.Element | null {
  const rects = readRedactionRegionList(params.rects);
  const firstRect = rects[0] ?? DEFAULT_REDACTION_REGION;
  const clampedFirst = clampRedactionRegion(firstRect, ctx.imageBounds);

  const [draft, setDraft] = useState<RedactionRegion | null>(null);
  useEffect(() => { setDraft(null); }, [firstRect.h, firstRect.rotation, firstRect.shape, firstRect.w, firstRect.x, firstRect.y]);

  if (!selected) {
    return (
      <>
        {rects.map((rect, index) => (
          <OverlayRedactionShape
            color="#f87171"
            key={`r-${index}`}
            longEdge={ctx.longEdge}
            placement={ctx.placement}
            region={clampRedactionRegion(rect, ctx.imageBounds)}
          />
        ))}
      </>
    );
  }

  const visible = draft ?? clampedFirst;
  const stageRect = redactionRegionToStage(visible, ctx.longEdge, ctx.placement);
  return (
    <>
      <InteractiveOverlayRect
        color="#f87171"
        placement={ctx.placement}
        rect={stageRect}
        rotateEnabled
        shape={visible.shape}
        onChange={(next) => setDraft(redactionRegionFromStage(next, ctx.longEdge, ctx.placement, visible.shape))}
        onCommit={(next) => {
          const committed = clampRedactionRegion(redactionRegionFromStage(next, ctx.longEdge, ctx.placement, visible.shape), ctx.imageBounds);
          setDraft(null);
          const nextRects = patchFirstRedactionRegion(rects, committed);
          onParamsChange({ rects: nextRects });
        }}
      />
      {rects.slice(1).map((rect, index) => (
        <OverlayRedactionShape
          color="#f87171"
          key={`r-${index + 1}`}
          longEdge={ctx.longEdge}
          placement={ctx.placement}
          region={clampRedactionRegion(rect, ctx.imageBounds)}
        />
      ))}
    </>
  );
}
