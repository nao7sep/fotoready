import type { Pipeline } from "./pipeline";
import type { MetadataFields } from "./settings";

export type SourceMetadataSummary = {
  editorial: MetadataFields;
  dates: Record<string, string>;
  gps: Record<string, string>;
};

export type Original = {
  id: string;
  sourcePath: string;
  sourceHash: string;
  size: number;
  format: string;
  jpegQualityEstimate: number | null;
  metadataSummary: SourceMetadataSummary;
  width: number;
  height: number;
  addedAt: string;
};

export type TaskStatus = "not-saved" | "queued" | "processing" | "saved" | "error";

export type VisionRunMode = "description" | "description-and-slug" | "slug";

export type VisionResult = {
  description: string;
  slugCandidates: string[];
  model: string;
  ranAt: string;
};

export type TaskOutput = {
  stagedPath: string;
  stagedParamsPath: string;
  stagedAt: string;
  outputHash: string;
  vision: VisionResult | null;
  finalPath: string | null;
  finalParamsPath: string | null;
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
  generateDescription: boolean;
  generateSlug: boolean;
  customSlug: string | null;
  visionRunning: boolean;
  visionRunMode: VisionRunMode | null;
  pipeline: Pipeline;
  status: TaskStatus;
  output: TaskOutput | null;
  error: TaskError | null;
  /** Flipped to true the first time the user mutates the task (op, slug, output, generation flags). Used to decide whether `selectOriginal` reuses the active task slot or spawns a new one. */
  everEdited: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  outputDir: string | null;
  originals: Original[];
  tasks: Task[];
};
