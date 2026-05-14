import React, { useEffect, useMemo, useRef } from "react";
import type Konva from "konva";
import { Rect, Transformer } from "react-konva";

type RectShape = { x: number; y: number; w: number; h: number };
type Placement = { x: number; y: number; width: number; height: number; scale: number };
const MIN_STAGE_SIZE = 12;

/**
 * Draggable/resizable region in stage pixels. Callers own conversion between
 * image-space params and stage-space display coordinates.
 */
export function InteractiveOverlayRect({
  aspectRatio,
  color,
  placement,
  rect,
  onChange,
  onCommit
}: {
  aspectRatio?: number | null;
  color: string;
  placement: Placement;
  rect: RectShape;
  onChange(nextRect: RectShape): void;
  onCommit(nextRect: RectShape): void;
}): React.JSX.Element {
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRect = useMemo(() => clampStageRect(rect, placement), [placement, rect]);

  useEffect(() => {
    if (!rectRef.current || !transformerRef.current) return;
    transformerRef.current.nodes([rectRef.current]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [stageRect]);

  return (
    <>
      <Rect
        ref={rectRef}
        dash={[6, 4]}
        fill={`${color}22`}
        height={stageRect.h}
        stroke={color}
        strokeWidth={2}
        width={stageRect.w}
        x={stageRect.x}
        y={stageRect.y}
        draggable
        dragBoundFunc={(position) => {
          const bounded = clampStageRect({ ...stageRect, x: position.x, y: position.y }, placement);
          return { x: bounded.x, y: bounded.y };
        }}
        onDragMove={(event) => {
          const node = event.target;
          const nextRect = clampStageRect({ x: node.x(), y: node.y(), w: stageRect.w, h: stageRect.h }, placement);
          onChange(nextRect);
        }}
        onDragEnd={(event) => {
          const node = event.target;
          const nextRect = clampStageRect({ x: node.x(), y: node.y(), w: stageRect.w, h: stageRect.h }, placement);
          onCommit(nextRect);
        }}
        onTransform={(event) => {
          const nextRect = transformedStageRect(event.target as Konva.Rect, placement);
          onChange(nextRect);
        }}
        onTransformEnd={(event) => {
          const nextRect = transformedStageRect(event.target as Konva.Rect, placement);
          onCommit(nextRect);
        }}
      />
      <Transformer
        ref={transformerRef}
        anchorFill="#ffffff"
        anchorSize={7}
        anchorStroke={color}
        anchorStrokeWidth={1.5}
        borderDash={[6, 4]}
        borderStroke={color}
        enabledAnchors={["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]}
        flipEnabled={false}
        keepRatio={Boolean(aspectRatio)}
        rotateEnabled={false}
        boundBoxFunc={(oldBox, newBox) => toKonvaBox(clampStageRect(fromKonvaBox(newBox), placement), oldBox.rotation)}
      />
    </>
  );
}

function transformedStageRect(node: Konva.Rect, placement: Placement): RectShape {
  const width = Math.max(MIN_STAGE_SIZE, node.width() * node.scaleX());
  const height = Math.max(MIN_STAGE_SIZE, node.height() * node.scaleY());
  const bounded = clampStageRect({ x: node.x(), y: node.y(), w: width, h: height }, placement);
  node.scaleX(1);
  node.scaleY(1);
  node.width(bounded.w);
  node.height(bounded.h);
  node.x(bounded.x);
  node.y(bounded.y);
  return bounded;
}

function clampStageRect(rect: RectShape, placement: Placement): RectShape {
  const minWidth = Math.min(MIN_STAGE_SIZE, placement.width);
  const minHeight = Math.min(MIN_STAGE_SIZE, placement.height);
  const width = clamp(rect.w, minWidth, placement.width);
  const height = clamp(rect.h, minHeight, placement.height);
  const x = clamp(rect.x, placement.x, placement.x + placement.width - width);
  const y = clamp(rect.y, placement.y, placement.y + placement.height - height);
  return { x, y, w: width, h: height };
}

function fromKonvaBox(box: { x: number; y: number; width: number; height: number }): RectShape {
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

function toKonvaBox(rect: RectShape, rotation: number): { x: number; y: number; width: number; height: number; rotation: number } {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h, rotation };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
