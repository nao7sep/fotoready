import React, { useEffect, useMemo, useRef } from "react";
import type Konva from "konva";
import { Ellipse, Rect, Transformer } from "react-konva";
import type { RedactionShape } from "@shared/types/redaction";

type RectShape = { x: number; y: number; w: number; h: number; rotation?: number };
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
  rotateEnabled = false,
  shape = "rectangle",
  onChange,
  onCommit
}: {
  aspectRatio?: number | null;
  color: string;
  placement: Placement;
  rect: RectShape;
  rotateEnabled?: boolean;
  shape?: RedactionShape;
  onChange(nextRect: RectShape): void;
  onCommit(nextRect: RectShape): void;
}): React.JSX.Element {
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRect = useMemo(() => clampStageRect(rect, placement), [placement, rect]);
  const centerX = stageRect.x + stageRect.w / 2;
  const centerY = stageRect.y + stageRect.h / 2;

  useEffect(() => {
    if (!rectRef.current || !transformerRef.current) return;
    transformerRef.current.nodes([rectRef.current]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [stageRect]);

  return (
    <>
      <Rect
        ref={rectRef}
        fill="rgba(255,255,255,0.001)"
        height={stageRect.h}
        offsetX={stageRect.w / 2}
        offsetY={stageRect.h / 2}
        rotation={stageRect.rotation ?? 0}
        strokeEnabled={false}
        width={stageRect.w}
        x={centerX}
        y={centerY}
        draggable
        dragBoundFunc={(position) => {
          const bounded = clampStageRect({
            ...stageRect,
            x: position.x - stageRect.w / 2,
            y: position.y - stageRect.h / 2
          }, placement);
          return { x: bounded.x + bounded.w / 2, y: bounded.y + bounded.h / 2 };
        }}
        onDragMove={(event) => {
          const node = event.target;
          const nextRect = clampStageRect({
            x: node.x() - stageRect.w / 2,
            y: node.y() - stageRect.h / 2,
            w: stageRect.w,
            h: stageRect.h,
            rotation: node.rotation()
          }, placement);
          onChange(nextRect);
        }}
        onDragEnd={(event) => {
          const node = event.target;
          const nextRect = clampStageRect({
            x: node.x() - stageRect.w / 2,
            y: node.y() - stageRect.h / 2,
            w: stageRect.w,
            h: stageRect.h,
            rotation: node.rotation()
          }, placement);
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
      {shape === "ellipse" ? (
        <Ellipse
          dash={[6, 4]}
          fillEnabled={false}
          listening={false}
          radiusX={stageRect.w / 2}
          radiusY={stageRect.h / 2}
          rotation={stageRect.rotation ?? 0}
          stroke={color}
          strokeWidth={2}
          x={centerX}
          y={centerY}
        />
      ) : (
        <Rect
          dash={[6, 4]}
          fillEnabled={false}
          height={stageRect.h}
          listening={false}
          offsetX={stageRect.w / 2}
          offsetY={stageRect.h / 2}
          rotation={stageRect.rotation ?? 0}
          stroke={color}
          strokeWidth={2}
          width={stageRect.w}
          x={centerX}
          y={centerY}
        />
      )}
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
        rotateEnabled={rotateEnabled}
      />
    </>
  );
}

function transformedStageRect(node: Konva.Rect, placement: Placement): RectShape {
  const width = Math.max(MIN_STAGE_SIZE, node.width() * node.scaleX());
  const height = Math.max(MIN_STAGE_SIZE, node.height() * node.scaleY());
  const bounded = clampStageRect({
    x: node.x() - width / 2,
    y: node.y() - height / 2,
    w: width,
    h: height,
    rotation: node.rotation()
  }, placement);
  node.scaleX(1);
  node.scaleY(1);
  node.width(bounded.w);
  node.height(bounded.h);
  node.offsetX(bounded.w / 2);
  node.offsetY(bounded.h / 2);
  node.rotation(bounded.rotation ?? 0);
  node.x(bounded.x + bounded.w / 2);
  node.y(bounded.y + bounded.h / 2);
  return bounded;
}

function clampStageRect(rect: RectShape, placement: Placement): RectShape {
  const minWidth = Math.min(MIN_STAGE_SIZE, placement.width);
  const minHeight = Math.min(MIN_STAGE_SIZE, placement.height);
  let width = clamp(rect.w, minWidth, placement.width);
  let height = clamp(rect.h, minHeight, placement.height);
  const rotation = normalizeRotation(rect.rotation ?? 0);
  let next = { x: rect.x, y: rect.y, w: width, h: height, rotation };
  let bounds = rotatedBounds(next);
  const scale = Math.min(
    1,
    bounds.width > 0 ? placement.width / bounds.width : 1,
    bounds.height > 0 ? placement.height / bounds.height : 1
  );
  if (scale < 1) {
    width = Math.max(minWidth, width * scale);
    height = Math.max(minHeight, height * scale);
    next = { ...next, w: width, h: height };
    bounds = rotatedBounds(next);
  }
  const deltaX = bounds.x < placement.x ? placement.x - bounds.x : bounds.x + bounds.width > placement.x + placement.width ? placement.x + placement.width - (bounds.x + bounds.width) : 0;
  const deltaY = bounds.y < placement.y ? placement.y - bounds.y : bounds.y + bounds.height > placement.y + placement.height ? placement.y + placement.height - (bounds.y + bounds.height) : 0;
  return { ...next, x: next.x + deltaX, y: next.y + deltaY };
}

function rotatedBounds(rect: RectShape): { x: number; y: number; width: number; height: number } {
  const radians = (rect.rotation ?? 0) * (Math.PI / 180);
  const halfWidth = rect.w / 2;
  const halfHeight = rect.h / 2;
  const extentX = Math.abs(halfWidth * Math.cos(radians)) + Math.abs(halfHeight * Math.sin(radians));
  const extentY = Math.abs(halfWidth * Math.sin(radians)) + Math.abs(halfHeight * Math.cos(radians));
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  return {
    x: centerX - extentX,
    y: centerY - extentY,
    width: extentX * 2,
    height: extentY * 2
  };
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
