import type { Pipeline } from "./pipeline";
import type { MetadataFields } from "./settings";
import type { Message } from "../i18n/translate";

/** Capture-time and location values keyed by what they are (see the adapter's tag tables), so the
 * renderer can name each in the interface language. */
export type SourceMetadataSummary = {
  editorial: MetadataFields;
  dates: Partial<Record<CaptureTimeField, string>>;
  gps: Partial<Record<LocationField, string>>;
};

export type CaptureTimeField =
  | "captured" | "capturedSubseconds" | "capturedTimeZone" | "created" | "digitized"
  | "createdSubseconds" | "createdTimeZone" | "dateCreated" | "timeCreated"
  | "digitalCreationDate" | "digitalCreationTime" | "gpsDate" | "gpsTime" | "gpsDateTime" | "creationTime";

export type LocationField =
  | "latitude" | "latitudeRef" | "longitude" | "longitudeRef" | "altitude" | "altitudeRef" | "mapDatum"
  | "imageDirection" | "imageDirectionRef" | "destLatitude" | "destLatitudeRef" | "destLongitude"
  | "destLongitudeRef" | "destBearing" | "destBearingRef" | "city" | "provinceState" | "country"
  | "countryCode" | "subLocation" | "location" | "locationShown" | "locationCreated";

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

type TaskErrorBase = {
  /** What went wrong, as a message the renderer renders in the interface language. */
  message: Message;
  detail: string | null;
  occurredAt: string;
  retryable: boolean;
};

export type TaskError =
  | (TaskErrorBase & { stage: "processing" | "rename" })
  /** `retryMode` is the step a vision Retry resumes from (a failed slug step does not redo the description). */
  | (TaskErrorBase & { stage: "vision"; retryMode: VisionRunMode });

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
