import React, { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { Task } from "@shared/types/project";
import { InteractiveOverlayRect } from "./interactive-overlays";
import { fitImage, zoomToCropRect } from "@renderer/canvas/crop-focus";
import {
  cropRectFromOp,
  imageBoundsFromSize,
  redactionRects,
  resolveCropAspectRatio,
  scaleRect as scaleOverlayRect,
  selectedEditableOverlay,
  selectedWhiteBalanceSample,
  updatePatchForOverlay,
  type FractionRect
} from "@renderer/canvas/op-overlays";

export type EditorCanvasPreview = {
  dataUrl: string;
  width: number;
  height: number;
};

export function EditorCanvas({
  preview,
  previewState,
  task,
  fallbackLabel,
  originalAspectRatio,
  selectedOpIndex,
  onOpParamsChange
}: {
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  task: Task | null;
  fallbackLabel: string;
  originalAspectRatio: number | null;
  selectedOpIndex: number | null;
  onOpParamsChange(opIndex: number, patch: Record<string, unknown>): void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 900, height: 600 });
  const image = useImage(preview?.dataUrl ?? null);
  const imageSize = image
    ? { width: image.naturalWidth || preview?.width || 1, height: image.naturalHeight || preview?.height || 1 }
    : { width: preview?.width ?? 1, height: preview?.height ?? 1 };
  const longEdge = Math.max(imageSize.width, imageSize.height);
  const imageBounds = useMemo(() => imageBoundsFromSize(imageSize), [imageSize]);
  const editableOverlay = useMemo(() => selectedEditableOverlay(task, selectedOpIndex, imageBounds), [imageBounds, selectedOpIndex, task]);
  const whiteBalanceSample = useMemo(() => selectedWhiteBalanceSample(task, selectedOpIndex), [selectedOpIndex, task]);
  const [draftOverlayRect, setDraftOverlayRect] = useState<FractionRect | null>(null);
  const [committedCropRect, setCommittedCropRect] = useState<FractionRect | null>(null);
  const selectedOp = selectedOpIndex === null ? null : task?.pipeline.ops[selectedOpIndex] ?? null;
  const selectedCropAspectRatio = useMemo(
    () => (selectedOp?.type === "crop" ? resolveCropAspectRatio(selectedOp.params.aspectLock, originalAspectRatio) : null),
    [originalAspectRatio, selectedOp]
  );
  const showRotateGuide = selectedOp?.type === "rotate";
  const activeOverlayRect = draftOverlayRect ?? editableOverlay?.rect ?? null;
  const cropZoomRect = useMemo(() => {
    if (selectedOp?.type !== "crop" || !committedCropRect) return null;
    return scaleOverlayRect(committedCropRect, longEdge);
  }, [committedCropRect, longEdge, selectedOp?.type]);
  const placement = useMemo(
    () =>
      cropZoomRect
        ? zoomToCropRect(imageSize.width, imageSize.height, frameSize.width, frameSize.height, cropZoomRect)
        : fitImage(imageSize.width, imageSize.height, frameSize.width, frameSize.height),
    [cropZoomRect, frameSize.height, frameSize.width, imageSize.height, imageSize.width]
  );

  useEffect(() => {
    setDraftOverlayRect(null);
    setCommittedCropRect(null);
  }, [editableOverlay?.kind, editableOverlay?.opIndex, task?.id, task?.updatedAt]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setFrameSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height))
      });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="editor-canvas" ref={frameRef}>
      {image ? (
        <Stage height={frameSize.height} width={frameSize.width}>
          <Layer>
            <Group
              onClick={(event) => {
                if (!whiteBalanceSample) return;
                const pointer = event.target.getStage()?.getPointerPosition();
                if (!pointer) return;
                const localX = (pointer.x - placement.x) / placement.scale;
                const localY = (pointer.y - placement.y) / placement.scale;
                if (localX < 0 || localY < 0 || localX > imageSize.width || localY > imageSize.height) {
                  return;
                }
                onOpParamsChange(whiteBalanceSample.opIndex, {
                  samplePoint: [
                    clamp(localX / longEdge, 0, imageSize.width / longEdge),
                    clamp(localY / longEdge, 0, imageSize.height / longEdge)
                  ]
                });
              }}
            >
              <KonvaImage image={image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
              {task ? (
                <PipelineOverlays
                  editableOverlay={editableOverlay && activeOverlayRect ? { ...editableOverlay, rect: activeOverlayRect } : null}
                  cropAspectRatio={selectedCropAspectRatio}
                  imageSize={imageSize}
                  onEditableOverlayChange={(rect) => {
                    setDraftOverlayRect(rect);
                  }}
                  onEditableOverlayCommit={(rect) => {
                    if (!editableOverlay) return;
                    if (editableOverlay.kind === "crop") setCommittedCropRect(rect);
                    setDraftOverlayRect(null);
                    onOpParamsChange(editableOverlay.opIndex, updatePatchForOverlay(task.pipeline.ops[editableOverlay.opIndex], rect, imageBounds));
                  }}
                  placement={placement}
                  stageSize={frameSize}
                  showRotateGuide={showRotateGuide}
                  whiteBalanceSamplePoint={whiteBalanceSample?.point ?? null}
                  task={task}
                  selectedOpIndex={selectedOpIndex}
                />
              ) : null}
            </Group>
          </Layer>
        </Stage>
      ) : (
        <div className="canvas-placeholder">
          {previewState === "loading" ? "Rendering preview..." : fallbackLabel}
          {previewState === "error" ? <span className="preview-error">Preview failed</span> : null}
        </div>
      )}
    </div>
  );
}

function PipelineOverlays({
  editableOverlay,
  cropAspectRatio,
  imageSize,
  onEditableOverlayChange,
  onEditableOverlayCommit,
  placement,
  stageSize,
  showRotateGuide,
  whiteBalanceSamplePoint,
  task,
  selectedOpIndex
}: {
  editableOverlay: { kind: "crop" | "redact"; opIndex: number; rect: FractionRect; color: string } | null;
  cropAspectRatio: number | null;
  imageSize: { width: number; height: number };
  onEditableOverlayChange(nextRect: FractionRect): void;
  onEditableOverlayCommit(nextRect: FractionRect): void;
  placement: { x: number; y: number; width: number; height: number; scale: number };
  stageSize: { width: number; height: number };
  showRotateGuide: boolean;
  whiteBalanceSamplePoint: { x: number; y: number } | null;
  task: Task;
  selectedOpIndex: number | null;
}): React.JSX.Element {
  const longEdge = Math.max(imageSize.width, imageSize.height);
  return (
    <>
      {showRotateGuide ? (
        <>
          <Rect
            height={placement.height}
            stroke="#ffffffaa"
            strokeWidth={1}
            width={placement.width}
            x={placement.x}
            y={placement.y}
          />
          <Line
            dash={[8, 8]}
            points={[placement.x + placement.width / 2, placement.y, placement.x + placement.width / 2, placement.y + placement.height]}
            stroke="#ffffffaa"
            strokeWidth={1}
          />
          <Line
            dash={[8, 8]}
            points={[placement.x, placement.y + placement.height / 2, placement.x + placement.width, placement.y + placement.height / 2]}
            stroke="#ffffffaa"
            strokeWidth={1}
          />
        </>
      ) : null}
      {whiteBalanceSamplePoint ? (
        <Circle
          fill="#60a5fa"
          opacity={0.9}
          radius={5}
          stroke="#ffffff"
          strokeWidth={2}
          x={placement.x + whiteBalanceSamplePoint.x * longEdge * placement.scale}
          y={placement.y + whiteBalanceSamplePoint.y * longEdge * placement.scale}
        />
      ) : null}
      {task.pipeline.ops.flatMap((op, opIndex) => {
        if (!op.enabled || opIndex !== selectedOpIndex) return [];
        if (op.type === "crop") {
          if (editableOverlay?.kind === "crop" && editableOverlay.opIndex === opIndex) {
            const stageRect = scaleOverlayRect(editableOverlay.rect, longEdge);
            return [
              <CropMask key={`${opIndex}-crop-mask`} placement={placement} rect={stageRect} stageSize={stageSize} />,
              <InteractiveOverlayRect
                aspectRatio={cropAspectRatio}
                color={editableOverlay.color}
                key={`${opIndex}-crop-edit`}
                placement={placement}
                rect={stageRect}
                onChange={(nextRect) => onEditableOverlayChange(scaleDownRect(nextRect, longEdge))}
                onCommit={(nextRect) => onEditableOverlayCommit(scaleDownRect(nextRect, longEdge))}
              />
            ];
          }
          return [<OverlayRect color="#facc15" key={`${opIndex}-crop`} placement={placement} rect={rectFromParams(op.params, longEdge)} />];
        }
        if (op.type.startsWith("redact-")) {
          const rects = rectsParam(op.params.rects);
          if (editableOverlay?.kind === "redact" && editableOverlay.opIndex === opIndex) {
            return [
              <InteractiveOverlayRect
                color={editableOverlay.color}
                key={`${opIndex}-redact-edit`}
                placement={placement}
                rect={scaleOverlayRect(editableOverlay.rect, longEdge)}
                onChange={(nextRect) => onEditableOverlayChange(scaleDownRect(nextRect, longEdge))}
                onCommit={(nextRect) => onEditableOverlayCommit(scaleDownRect(nextRect, longEdge))}
              />,
              ...rects.slice(1).map((rect, rectIndex) => (
                <OverlayRect color="#f87171" key={`${opIndex}-redact-${rectIndex + 1}`} placement={placement} rect={scaleOverlayRect(rect, longEdge)} />
              ))
            ];
          }
          return rects.map((rect, rectIndex) => (
            <OverlayRect color="#f87171" key={`${opIndex}-redact-${rectIndex}`} placement={placement} rect={scaleOverlayRect(rect, longEdge)} />
          ));
        }
        if (op.type === "watermark-text" && typeof op.params.text === "string" && op.params.text.trim()) {
          const point = anchorPoint(String(op.params.anchor ?? "bottom-right"), placement, Number(op.params.marginX ?? 0.02), Number(op.params.marginY ?? 0.02));
          return [<Text fill="#ffffff" fontSize={13} key={`${opIndex}-text`} opacity={0.85} text={op.params.text} x={point.x} y={point.y} />];
        }
        return [];
      })}
    </>
  );
}

function CropMask({
  placement,
  rect,
  stageSize
}: {
  placement: { x: number; y: number; width: number; height: number; scale: number };
  rect: { x: number; y: number; w: number; h: number };
  stageSize: { width: number; height: number };
}): React.JSX.Element {
  const cropLeft = placement.x + rect.x * placement.scale;
  const cropTop = placement.y + rect.y * placement.scale;
  const cropRight = cropLeft + rect.w * placement.scale;
  const cropBottom = cropTop + rect.h * placement.scale;
  const maskProps = { fill: "#0f172a", listening: false, opacity: 0.46 };

  return (
    <>
      <Rect {...maskProps} height={Math.max(0, cropTop)} width={stageSize.width} x={0} y={0} />
      <Rect {...maskProps} height={Math.max(0, stageSize.height - cropBottom)} width={stageSize.width} x={0} y={cropBottom} />
      <Rect {...maskProps} height={Math.max(0, cropBottom - cropTop)} width={Math.max(0, cropLeft)} x={0} y={cropTop} />
      <Rect {...maskProps} height={Math.max(0, cropBottom - cropTop)} width={Math.max(0, stageSize.width - cropRight)} x={cropRight} y={cropTop} />
    </>
  );
}

function OverlayRect({ color, placement, rect }: { color: string; placement: { x: number; y: number; scale: number }; rect: { x: number; y: number; w: number; h: number } }): React.JSX.Element {
  return (
    <Rect
      dash={[6, 4]}
      height={rect.h * placement.scale}
      stroke={color}
      strokeWidth={2}
      width={rect.w * placement.scale}
      x={placement.x + rect.x * placement.scale}
      y={placement.y + rect.y * placement.scale}
    />
  );
}

function useImage(dataUrl: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setImage(null);
      return;
    }
    const next = new window.Image();
    next.onload = () => setImage(next);
    next.src = dataUrl;
    return () => {
      next.onload = null;
    };
  }, [dataUrl]);
  return image;
}

function rectFromParams(params: Record<string, unknown>, longEdge: number): { x: number; y: number; w: number; h: number } {
  return scaleRect(cropRectFromOp({ type: "crop", enabled: true, params }), longEdge);
}

function scaleRect(rect: { x: number; y: number; w: number; h: number }, longEdge: number): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * longEdge,
    y: rect.y * longEdge,
    w: rect.w * longEdge,
    h: rect.h * longEdge
  };
}

function rectsParam(value: unknown): Array<{ x: number; y: number; w: number; h: number }> {
  return redactionRects(value);
}

function anchorPoint(anchor: string, placement: { x: number; y: number; width: number; height: number }, marginX: number, marginY: number): { x: number; y: number } {
  const x = anchor.includes("left") ? placement.x + marginX * placement.width : anchor.includes("right") ? placement.x + placement.width - marginX * placement.width - 120 : placement.x + placement.width / 2 - 60;
  const y = anchor.includes("top") ? placement.y + marginY * placement.height : anchor.includes("bottom") ? placement.y + placement.height - marginY * placement.height - 20 : placement.y + placement.height / 2 - 10;
  return { x: Math.max(placement.x, x), y: Math.max(placement.y, y) };
}

function scaleDownRect(rect: { x: number; y: number; w: number; h: number }, longEdge: number): FractionRect {
  return {
    x: rect.x / longEdge,
    y: rect.y / longEdge,
    w: rect.w / longEdge,
    h: rect.h / longEdge
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
