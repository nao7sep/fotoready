import type sharp from "sharp";
import type { Pipeline } from "@shared/types/pipeline";

export type Image = {
  sharp: sharp.Sharp;
  width: number;
  height: number;
  format: string;
};

export type WorkerProcessJob = {
  jobId: string;
  kind: "process";
  sourcePath: string;
  sourceHash: string;
  pipeline: Pipeline;
  outputPath: string;
  previewLongEdge: null;
};

export type WorkerPreviewJob = {
  jobId: string;
  kind: "preview";
  sourcePath: string;
  sourceHash: string;
  pipeline: Pipeline;
  outputPath: null;
  previewLongEdge: number | null;
};

export type WorkerPreviewStageJob = {
  jobId: string;
  kind: "preview-stage";
  bitmap: ArrayBuffer;
  width: number;
  height: number;
  pipeline: Pipeline;
};

export type WorkerJob = WorkerProcessJob | WorkerPreviewJob | WorkerPreviewStageJob;

export type WorkerResult =
  | { kind: "process"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }
  | { kind: "preview"; bitmap: ArrayBuffer; width: number; height: number; format: "rgba8"; appliedPipeline: Pipeline };
