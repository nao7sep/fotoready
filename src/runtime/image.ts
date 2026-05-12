import type sharp from "sharp";
import type { MetadataFields } from "@shared/types/settings";
import type { Pipeline } from "@shared/types/pipeline";

export type Image = {
  sharp: sharp.Sharp;
  width: number;
  height: number;
  format: string;
};

export type ExifSubset = {
  colorSpace: number | null;
  interopIndex: string | null;
  dateTimeOriginal: string | null;
  createDate: string | null;
  offsetTimeOriginal: string | null;
};

export type DecodeFacts = {
  format: string;
  width: number;
  height: number;
  orientation: number;
  iccProfile: Buffer | null;
  iccProfileSummary: string | null;
  colorSpaceTag: "srgb" | "adobe-rgb" | "uncalibrated" | null;
  exif: ExifSubset;
  jpegQualityEstimate: { value: number; method: "metadata" | "dqt-match" } | null;
};

export type WorkerJob = {
  jobId: string;
  kind: "process" | "preview" | "vision-prepare";
  sourcePath: string;
  sourceHash: string;
  pipeline: Pipeline;
  outputPath: string | null;
  previewLongEdge: number | null;
  metadataInjection: MetadataFields | null;
};

export type WorkerResult =
  | { kind: "process"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }
  | { kind: "preview"; bitmap: ArrayBuffer; width: number; height: number; format: "rgba8"; appliedPipeline: Pipeline }
  | { kind: "vision-prepare"; bytes: Buffer; mimeType: "image/jpeg"; sha256: string };
