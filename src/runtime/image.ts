import type * as sharp from "sharp";
import type { Pipeline } from "@shared/types/pipeline";
import type { PipelineErrorCategory } from "./pipeline-error";

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
  pipeline: Pipeline;
  outputPath: string;
  previewLongEdge: null;
};

export type WorkerPreviewJob = {
  jobId: string;
  kind: "preview";
  sourcePath: string;
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
  | { kind: "preview"; bitmap: ArrayBuffer; width: number; height: number; format: "rgba8"; appliedPipeline: Pipeline }
  // A failure is returned as data, not thrown, so the category survives the structured-clone
  // worker boundary intact. The worker never emits "metadata" (that phase runs in the main process).
  | { kind: "error"; category: PipelineErrorCategory; message: string; stack: string | null };
