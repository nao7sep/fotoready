import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import type { Task } from "@shared/types/project";

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
  fallbackLabel
}: {
  originalDataUrl: string | null;
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  task: Task | null;
  fallbackLabel: string;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 900, height: 600 });
  const [mode, setMode] = useState<"after" | "before">("after");
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const activeSource = mode === "before" && originalDataUrl ? { dataUrl: originalDataUrl, width: preview?.width ?? 1, height: preview?.height ?? 1 } : preview;
  const image = useImage(activeSource?.dataUrl ?? null);
  const imageSize = image ? { width: image.naturalWidth || activeSource?.width || 1, height: image.naturalHeight || activeSource?.height || 1 } : { width: activeSource?.width ?? 1, height: activeSource?.height ?? 1 };
  const placement = useMemo(() => fitImage(imageSize.width, imageSize.height, frameSize.width, frameSize.height, zoom), [frameSize.height, frameSize.width, imageSize.height, imageSize.width, zoom]);

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
      <div className="canvas-toolbar">
        <button className={mode === "after" ? "active" : ""} type="button" onClick={() => setMode("after")}>After</button>
        <button className={mode === "before" ? "active" : ""} disabled={!originalDataUrl} type="button" onClick={() => setMode("before")}>Before</button>
        <button className={zoom === "fit" ? "active" : ""} type="button" onClick={() => setZoom("fit")}>Fit</button>
        <button className={zoom === "actual" ? "active" : ""} type="button" onClick={() => setZoom("actual")}>100%</button>
      </div>
      {image ? (
        <Stage height={frameSize.height} width={frameSize.width}>
          <Layer>
            <KonvaImage image={image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
            {mode === "after" && task ? <PipelineOverlays task={task} placement={placement} imageSize={imageSize} /> : null}
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
  imageSize,
  placement,
  task
}: {
  imageSize: { width: number; height: number };
  placement: { x: number; y: number; width: number; height: number; scale: number };
  task: Task;
}): React.JSX.Element {
  const longEdge = Math.max(imageSize.width, imageSize.height);
  return (
    <>
      {task.pipeline.ops.flatMap((op, opIndex) => {
        if (!op.enabled) return [];
        if (op.type === "crop") {
          return [<OverlayRect color="#facc15" key={`${opIndex}-crop`} placement={placement} rect={rectFromParams(op.params, longEdge)} />];
        }
        if (op.type.startsWith("redact-")) {
          return rectsParam(op.params.rects).map((rect, rectIndex) => (
            <OverlayRect color="#f87171" key={`${opIndex}-redact-${rectIndex}`} placement={placement} rect={scaleRect(rect, longEdge)} />
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
  return scaleRect({
    x: Number(params.x ?? 0),
    y: Number(params.y ?? 0),
    w: Number(params.w ?? 1),
    h: Number(params.h ?? 1)
  }, longEdge);
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
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { x: number; y: number; w: number; h: number } =>
    item !== null &&
    typeof item === "object" &&
    typeof (item as { x?: unknown }).x === "number" &&
    typeof (item as { y?: unknown }).y === "number" &&
    typeof (item as { w?: unknown }).w === "number" &&
    typeof (item as { h?: unknown }).h === "number"
  );
}

function anchorPoint(anchor: string, placement: { x: number; y: number; width: number; height: number }, marginX: number, marginY: number): { x: number; y: number } {
  const x = anchor.includes("left") ? placement.x + marginX * placement.width : anchor.includes("right") ? placement.x + placement.width - marginX * placement.width - 120 : placement.x + placement.width / 2 - 60;
  const y = anchor.includes("top") ? placement.y + marginY * placement.height : anchor.includes("bottom") ? placement.y + placement.height - marginY * placement.height - 20 : placement.y + placement.height / 2 - 10;
  return { x: Math.max(placement.x, x), y: Math.max(placement.y, y) };
}
