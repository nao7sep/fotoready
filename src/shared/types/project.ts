import type { OutputFormat, Pipeline } from "./pipeline";
import type { MetadataStripMode, ProjectSettings } from "./settings";

export type Original = {
  id: string;
  sourcePath: string;
  sourceHash: string;
  size: number;
  format: string;
  width: number;
  height: number;
  addedAt: string;
};

export type TaskStatus = "draft" | "pending" | "processing" | "done" | "error";

export type VisionResult = {
  description: string;
  slugCandidates: string[];
  model: string;
  ranAt: string;
};

export type TaskOutput = {
  stagedPath: string;
  stagedAt: string;
  outputHash: string;
  vision: VisionResult | null;
  finalPath: string | null;
  renamedAt: string | null;
};

export type TaskError = {
  stage: "processing" | "vision" | "rename";
  message: string;
  detail: string | null;
  occurredAt: string;
  retryable: boolean;
};

export type Task = {
  id: string;
  originalId: string;
  analyzeContent: boolean;
  outputFormatOverride: OutputFormat | null;
  outputQualityOverride: number | "match-source-size" | "match-source-quality" | null;
  metadataStripOverride: MetadataStripMode | null;
  customSlug: string | null;
  pipeline: Pipeline;
  status: TaskStatus;
  output: TaskOutput | null;
  error: TaskError | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  version: 1;
  name: string;
  outputDir: string;
  settings: ProjectSettings;
  originals: Original[];
  tasks: Task[];
};
