import React, { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import type { Task } from "@shared/types/project";
import { InteractiveOverlayRect } from "./interactive-overlays";
import { cropRectFromOp, redactionRects, scaleRect as scaleOverlayRect, selectedEditableOverlay, selectedWhiteBalanceSample, updatePatchForOverlay, type FractionRect } from "@renderer/canvas/op-overlays";

export type EditorCanvasPreview = {
  dataUrl: string;
  width: number;
  height: number;
};

export function EditorCanvas({
  originalDataUrl,
  preview,
  previewState,
  task,
  fallbackLabel,
  selectedOpIndex,
  onOpParamsChange
}: {
  originalDataUrl: string | null;
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  task: Task | null;
  fallbackLabel: string;
  selectedOpIndex: number | null;
  onOpParamsChange(opIndex: number, patch: Record<string, unknown>): void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 900, height: 600 });
  const [mode, setMode] = useState<"after" | "before">("after");
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const activeSource = mode === "before" && originalDataUrl ? { dataUrl: originalDataUrl, width: preview?.width ?? 1, height: preview?.height ?? 1 } : preview;
  const image = useImage(activeSource?.dataUrl ?? null);
  const imageSize = image ? { width: image.naturalWidth || activeSource?.width || 1, height: image.naturalHeight || activeSource?.height || 1 } : { width: activeSource?.width ?? 1, height: activeSource?.height ?? 1 };
  const placement = useMemo(() => fitImage(imageSize.width, imageSize.height, frameSize.width, frameSize.height, zoom), [frameSize.height, frameSize.width, imageSize.height, imageSize.width, zoom]);
  const longEdge = Math.max(imageSize.width, imageSize.height);
  const editableOverlay = useMemo(() => selectedEditableOverlay(task, selectedOpIndex), [selectedOpIndex, task]);
  const whiteBalanceSample = useMemo(() => selectedWhiteBalanceSample(task, selectedOpIndex), [selectedOpIndex, task]);
  const [draftOverlayRect, setDraftOverlayRect] = useState<FractionRect | null>(null);

  useEffect(() => {
    setDraftOverlayRect(null);
  }, [editableOverlay?.kind, editableOverlay?.opIndex, task?.id, task?.updatedAt]);

  const activeOverlayRect = draftOverlayRect ?? editableOverlay?.rect ?? null;
  const clampedPan = useMemo(() => clampPan(pan, placement, frameSize, zoom), [frameSize, pan, placement, zoom]);

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

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [task?.id, zoom]);

  useEffect(() => {
    if (clampedPan.x !== pan.x || clampedPan.y !== pan.y) {
      setPan(clampedPan);
    }
  }, [clampedPan, pan.x, pan.y]);

  return (
    <div className={`editor-canvas ${zoom === "actual" ? "is-actual-zoom" : ""}`} ref={frameRef}>
      <div className="canvas-toolbar">
        <button className={mode === "after" ? "active" : ""} type="button" onClick={() => setMode("after")}>After</button>
        <button className={mode === "before" ? "active" : ""} disabled={!originalDataUrl} type="button" onClick={() => setMode("before")}>Before</button>
        <button className={zoom === "fit" ? "active" : ""} type="button" onClick={() => setZoom("fit")}>Fit</button>
        <button className={zoom === "actual" ? "active" : ""} type="button" onClick={() => setZoom("actual")}>100%</button>
      </div>
      {image ? (
        <Stage height={frameSize.height} width={frameSize.width}>
          <Layer>
            <Group
              draggable={zoom === "actual"}
              dragBoundFunc={(position) => clampPan(position, placement, frameSize, zoom)}
              x={clampedPan.x}
              y={clampedPan.y}
              onClick={(event) => {
                if (mode !== "after" || !whiteBalanceSample) return;
                const pointer = event.target.getStage()?.getPointerPosition();
                if (!pointer) return;
                const localX = (pointer.x - clampedPan.x - placement.x) / placement.scale;
                const localY = (pointer.y - clampedPan.y - placement.y) / placement.scale;
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
              onDragMove={(event) => setPan({ x: event.target.x(), y: event.target.y() })}
              onDragEnd={(event) => setPan({ x: event.target.x(), y: event.target.y() })}
            >
              <KonvaImage image={image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
              {mode === "after" && task ? (
                <PipelineOverlays
                  editableOverlay={editableOverlay && activeOverlayRect ? { ...editableOverlay, rect: activeOverlayRect } : null}
                  imageSize={imageSize}
                  onEditableOverlayChange={setDraftOverlayRect}
                  onEditableOverlayCommit={(rect) => {
                    if (!editableOverlay) return;
                    setDraftOverlayRect(null);
                    onOpParamsChange(editableOverlay.opIndex, updatePatchForOverlay(task.pipeline.ops[editableOverlay.opIndex], rect));
                  }}
                  placement={placement}
                  whiteBalanceSamplePoint={whiteBalanceSample?.point ?? null}
                  task={task}
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
  imageSize,
  onEditableOverlayChange,
  onEditableOverlayCommit,
  placement,
  whiteBalanceSamplePoint,
  task
}: {
  editableOverlay: { kind: "crop" | "redact"; opIndex: number; rect: FractionRect; color: string } | null;
  imageSize: { width: number; height: number };
  onEditableOverlayChange(nextRect: FractionRect): void;
  onEditableOverlayCommit(nextRect: FractionRect): void;
  placement: { x: number; y: number; width: number; height: number; scale: number };
  whiteBalanceSamplePoint: { x: number; y: number } | null;
  task: Task;
}): React.JSX.Element {
  const longEdge = Math.max(imageSize.width, imageSize.height);
  return (
    <>
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
        if (!op.enabled) return [];
        if (op.type === "crop") {
          if (editableOverlay?.kind === "crop" && editableOverlay.opIndex === opIndex) {
            return [
              <InteractiveOverlayRect
                color={editableOverlay.color}
                key={`${opIndex}-crop-edit`}
                placement={placement}
                rect={scaleOverlayRect(editableOverlay.rect, longEdge)}
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

function fitImage(imageWidth: number, imageHeight: number, frameWidth: number, frameHeight: number, zoom: "fit" | "actual"): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = zoom === "actual" ? 1 : Math.min(frameWidth / imageWidth, frameHeight / imageHeight, 1);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: Math.round((frameWidth - width) / 2),
    y: Math.round((frameHeight - height) / 2),
    width,
    height,
    scale
  };
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

function clampPan(
  pan: { x: number; y: number },
  placement: { x: number; y: number; width: number; height: number },
  frameSize: { width: number; height: number },
  zoom: "fit" | "actual"
): { x: number; y: number } {
  if (zoom !== "actual") {
    return { x: 0, y: 0 };
  }

  const minTotalX = placement.width > frameSize.width ? frameSize.width - placement.width : placement.x;
  const maxTotalX = placement.width > frameSize.width ? 0 : placement.x;
  const minTotalY = placement.height > frameSize.height ? frameSize.height - placement.height : placement.y;
  const maxTotalY = placement.height > frameSize.height ? 0 : placement.y;
  const totalX = clamp(placement.x + pan.x, minTotalX, maxTotalX);
  const totalY = clamp(placement.y + pan.y, minTotalY, maxTotalY);
  return {
    x: totalX - placement.x,
    y: totalY - placement.y
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
