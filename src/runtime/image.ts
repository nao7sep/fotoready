import type sharp from "sharp";
import type { Pipeline } from "@shared/types/pipeline";

export type Image = {
  sharp: sharp.Sharp;
  width: number;
  height: number;
  format: string;
};

export type WorkerJob = {
  jobId: string;
  kind: "process" | "preview";
  sourcePath: string;
  sourceHash: string;
  pipeline: Pipeline;
  outputPath: string | null;
  previewLongEdge: number | null;
};

export type WorkerResult =
  | { kind: "process"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }
  | { kind: "preview"; bitmap: ArrayBuffer; width: number; height: number; format: "rgba8"; appliedPipeline: Pipeline };
