import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Stage } from "react-konva";
import type { Task } from "@shared/types/project";
import { getOpRenderer, type OverlayContext } from "@renderer/ops";
import { fitImage, imageBoundsFromSize } from "@renderer/ops/_overlay-primitives";

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
  selectedOpId,
  onOpParamsChange
}: {
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  task: Task | null;
  fallbackLabel: string;
  originalAspectRatio: number | null;
  selectedOpId: string | null;
  onOpParamsChange(opId: string, patch: Record<string, unknown>): void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setFrameSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    }
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setFrameSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const selectedOp = task && selectedOpId ? task.pipeline.ops.find((op) => op.id === selectedOpId) ?? null : null;
  const selectedRenderer = selectedOp?.enabled ? getOpRenderer(selectedOp.type) : null;
  const SelectedOverlay = selectedRenderer?.Overlay ?? null;
  const needsInteractiveCanvas = Boolean(preview && selectedRenderer && (SelectedOverlay || selectedRenderer.onImageClick));
  const image = useImage(needsInteractiveCanvas ? preview?.dataUrl ?? null : null);
  const imageSize = image
    ? { width: image.naturalWidth || preview?.width || 1, height: image.naturalHeight || preview?.height || 1 }
    : { width: preview?.width ?? 1, height: preview?.height ?? 1 };
  const longEdge = Math.max(imageSize.width, imageSize.height);
  const imageBounds = useMemo(() => imageBoundsFromSize(imageSize), [imageSize]);
  const placement = useMemo(
    () => fitImage(imageSize.width, imageSize.height, frameSize.width, frameSize.height),
    [frameSize.height, frameSize.width, imageSize.height, imageSize.width]
  );

  const overlayCtx: OverlayContext = useMemo(
    () => ({ imageSize, longEdge, imageBounds, placement, stageSize: frameSize, originalAspectRatio }),
    [imageBounds, imageSize, longEdge, placement, frameSize, originalAspectRatio]
  );

  function handleStageClick(event: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }): void {
    if (!task || !selectedOpId) return;
    const op = task.pipeline.ops.find((item) => item.id === selectedOpId);
    if (!op) return;
    if (!op?.enabled) return;
    if (!selectedRenderer?.onImageClick) return;

    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const localX = (pointer.x - placement.x) / placement.scale;
    const localY = (pointer.y - placement.y) / placement.scale;
    if (localX < 0 || localY < 0 || localX > imageSize.width || localY > imageSize.height) return;

    selectedRenderer.onImageClick(localX, localY, op.params, overlayCtx, (patch) => onOpParamsChange(op.id, patch as Record<string, unknown>));
  }

  return (
    <div className="editor-canvas" ref={frameRef}>
      {preview && !needsInteractiveCanvas ? (
        <div className="editor-canvas-static">
          <img alt="" className="preview-image" src={preview.dataUrl} />
        </div>
      ) : image ? (
        <Stage height={frameSize.height} width={frameSize.width}>
          <Layer>
            <Group onClick={selectedRenderer?.onImageClick ? handleStageClick : undefined}>
              <KonvaImage image={image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
              {selectedOp && SelectedOverlay ? (
                <SelectedOverlay
                  key={`overlay-${selectedOp.id}`}
                  params={selectedOp.params}
                  opId={selectedOp.id}
                  selected
                  ctx={overlayCtx}
                  onParamsChange={(patch) => onOpParamsChange(selectedOp.id, patch as Record<string, unknown>)}
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
