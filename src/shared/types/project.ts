import type { Pipeline } from "./pipeline";

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

export type TaskStatus = "pending" | "queued" | "processing" | "done" | "error";

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
  customSlug: string | null;
  pipeline: Pipeline;
  status: TaskStatus;
  output: TaskOutput | null;
  error: TaskError | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  outputDir: string | null;
  originals: Original[];
  tasks: Task[];
};
