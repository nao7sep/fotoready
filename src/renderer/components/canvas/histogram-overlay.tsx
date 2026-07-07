import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { clamp } from "@shared/numeric";
import type { EditorCanvasPreview } from "./editor-canvas";

type HistogramBins = {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  max: number;
};

type Position = { x: number; y: number };

const DEFAULT_INSET = 16;

export function HistogramOverlay({
  preview,
  previewState,
  onClose,
  position,
  onPositionChange
}: {
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  onClose(): void;
  position: Position | null;
  onPositionChange(next: Position): void;
}): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState<Position | null>(null);
  const dragRef = useRef<{ originX: number; originY: number; baseX: number; baseY: number } | null>(null);

  // Resolve persisted position against the canvas-frame parent's current size. If the
  // persisted point would leave the overlay outside the visible canvas (window resize,
  // monitor change, accidental drag), snap back to the default top-right inset.
  useLayoutEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const parent = element.parentElement;
    if (!parent) return;

    const rect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const defaultPos: Position = {
      x: Math.max(0, parentRect.width - rect.width - DEFAULT_INSET),
      y: DEFAULT_INSET
    };

    if (!position) {
      setResolvedPosition(defaultPos);
      return;
    }

    const inBounds =
      position.x >= 0 &&
      position.y >= 0 &&
      position.x + rect.width <= parentRect.width &&
      position.y + rect.height <= parentRect.height;
    setResolvedPosition(inBounds ? position : defaultPos);
  }, [position]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!resolvedPosition) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".histogram-overlay-close")) return;
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      originX: event.clientX,
      originY: event.clientY,
      baseX: resolvedPosition.x,
      baseY: resolvedPosition.y
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const element = overlayRef.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const nextX = clamp(drag.baseX + (event.clientX - drag.originX), 0, Math.max(0, parentRect.width - rect.width));
    const nextY = clamp(drag.baseY + (event.clientY - drag.originY), 0, Math.max(0, parentRect.height - rect.height));
    setResolvedPosition({ x: nextX, y: nextY });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    if (resolvedPosition) onPositionChange(resolvedPosition);
  }

  const bins = useHistogramBins(preview);

  return (
    <div
      className="histogram-overlay"
      ref={overlayRef}
      style={resolvedPosition ? { left: resolvedPosition.x, top: resolvedPosition.y, right: "auto" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button className="histogram-overlay-close" type="button" onClick={onClose} title="Hide histogram">
        <X size={12} />
      </button>
      {bins ? (
        <HistogramSvg bins={bins} />
      ) : (
        <span className="histogram-overlay-empty">
          {previewState === "loading" ? "Rendering…" : previewState === "error" ? "Preview failed" : "No preview"}
        </span>
      )}
    </div>
  );
}

function useHistogramBins(preview: EditorCanvasPreview | null): HistogramBins | null {
  const [bins, setBins] = useState<HistogramBins | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!preview) {
      setBins(null);
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setBins(readHistogram(image));
    };
    image.onerror = () => {
      if (!cancelled) setBins(null);
    };
    image.src = preview.dataUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [preview]);

  return bins;
}

function HistogramSvg({ bins }: { bins: HistogramBins }): React.JSX.Element {
  return (
    <svg aria-label="Preview histogram" preserveAspectRatio="none" viewBox="0 0 256 64">
      <HistogramPath bins={bins.luminance} color="#1c1917" max={bins.max} opacity={0.55} />
      <HistogramPath bins={bins.red} color="#dc2626" max={bins.max} opacity={0.5} />
      <HistogramPath bins={bins.green} color="#16a34a" max={bins.max} opacity={0.5} />
      <HistogramPath bins={bins.blue} color="#2563eb" max={bins.max} opacity={0.5} />
    </svg>
  );
}

function HistogramPath({ bins, color, max, opacity }: { bins: number[]; color: string; max: number; opacity: number }): React.JSX.Element {
  const points = bins.map((value, index) => {
    const x = (index / (bins.length - 1)) * 256;
    const y = 64 - (value / max) * 60;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return <polyline fill="none" opacity={opacity} points={points.join(" ")} stroke={color} strokeWidth="1.4" />;
}

function readHistogram(image: HTMLImageElement): HistogramBins {
  const sampleSize = 256;
  const scale = Math.min(sampleSize / image.naturalWidth, sampleSize / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return emptyBins();
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const red = new Array<number>(64).fill(0);
  const green = new Array<number>(64).fill(0);
  const blue = new Array<number>(64).fill(0);
  const luminance = new Array<number>(64).fill(0);

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    red[Math.min(63, Math.floor(r / 4))] += 1;
    green[Math.min(63, Math.floor(g / 4))] += 1;
    blue[Math.min(63, Math.floor(b / 4))] += 1;
    luminance[Math.min(63, Math.floor((0.2126 * r + 0.7152 * g + 0.0722 * b) / 4))] += 1;
  }

  return {
    red,
    green,
    blue,
    luminance,
    max: Math.max(1, ...red, ...green, ...blue, ...luminance)
  };
}

function emptyBins(): HistogramBins {
  const empty = new Array<number>(64).fill(0);
  return { red: empty, green: empty, blue: empty, luminance: empty, max: 1 };
}
