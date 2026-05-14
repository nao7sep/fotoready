import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { EditorCanvasPreview } from "./editor-canvas";

type HistogramBins = {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  max: number;
};

export function HistogramOverlay({
  preview,
  previewState,
  onClose
}: {
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  onClose(): void;
}): React.JSX.Element {
  const [bins, setBins] = useState<HistogramBins | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!preview) {
      setBins(null);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      setBins(readHistogram(image));
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

  return (
    <div className="histogram-overlay">
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
