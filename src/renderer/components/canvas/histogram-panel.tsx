import React, { useEffect, useMemo, useState } from "react";
import type { Task } from "@shared/types/project";
import type { EditorCanvasPreview } from "./editor-canvas";

type HistogramBins = {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  max: number;
};

export function HistogramPanel({
  preview,
  previewState,
  task
}: {
  preview: EditorCanvasPreview | null;
  previewState: "idle" | "loading" | "error";
  task: Task | null;
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

  const summary = useMemo(() => outputSummary(task, preview), [preview, task]);

  return (
    <section className="histogram-panel">
      <div className="histogram-chart">
        {bins ? <HistogramSvg bins={bins} /> : <span>{previewState === "loading" ? "Rendering histogram..." : "No preview histogram"}</span>}
      </div>
      <div className="histogram-readout">
        <span>{summary.primary}</span>
        <span>{summary.secondary}</span>
      </div>
    </section>
  );
}

function HistogramSvg({ bins }: { bins: HistogramBins }): React.JSX.Element {
  return (
    <svg aria-label="Preview histogram" preserveAspectRatio="none" viewBox="0 0 256 64">
      <HistogramPath bins={bins.luminance} color="#d6d3d1" max={bins.max} opacity={0.6} />
      <HistogramPath bins={bins.red} color="#f87171" max={bins.max} opacity={0.45} />
      <HistogramPath bins={bins.green} color="#86efac" max={bins.max} opacity={0.45} />
      <HistogramPath bins={bins.blue} color="#60a5fa" max={bins.max} opacity={0.45} />
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

function outputSummary(task: Task | null, preview: EditorCanvasPreview | null): { primary: string; secondary: string } {
  if (!task) return { primary: "No active task", secondary: "Import an original to inspect output" };
  const dimensions = preview ? `${preview.width}x${preview.height}` : "Preview pending";
  const output = task.output ? basename(task.output.finalPath ?? task.output.stagedPath) : "Not saved";
  return {
    primary: `${task.status} · ${dimensions}`,
    secondary: output
  };
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}
