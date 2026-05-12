import type { OutputFormat } from "./pipeline";

export type MetadataField = "author" | "copyright" | "orientation" | "colorspace";
export type MetadataStripMode = MetadataField[];

export type FilenameTemplate = {
  id: string;
  name: string;
  pattern: string;
  builtin?: boolean;
};

export type MetadataFields = Record<string, string>;

export type ProjectSettings = {
  defaultOutputFormat?: OutputFormat;
  defaultWebpQuality?: number;
  defaultAvifQuality?: number;
  defaultPngPalette?: boolean;
  defaultMetadataStrip?: MetadataStripMode;
  defaultAnalyzeContent?: boolean;
  defaultBackgroundForTransparency?: string;
  injectAuthorCopyright?: boolean;
  preserveSourceDates?: boolean;
  descriptionSource?: "vision-then-none";
  injectFields?: MetadataFields;
  defaultTemplateId?: string;
  defaultOutputDirectory?: string;
  sidecarLocation?: "in-project-file";
  lutFolder?: string;
  defaultWatermarkImage?: string;
  projectContext?: string;
  lastProjectPath?: string | null;
};

export type GlobalSettings = Required<Omit<ProjectSettings, "projectContext">> & {
  theme: "dark" | "light" | "system";
  language: "en";
  cameraTimezone: string;
  confirmDeleteOriginalWithTasks: boolean;
  confirmDeleteOutputFiles: boolean;
  checkForUpdates: boolean;
  telemetry: false;
  defaultStripGps: true;
  defaultStripThumbnail: true;
  jpegStrategy: "match-source-size" | "match-source-quality" | "fixed" | "prompt-per-task";
  jpegQualityOnDetectionFailure: number;
  jpegFixedQuality: number;
  jpegChromaSubsampling: "4:4:4" | "4:2:2" | "4:2:0";
  jpegProgressive: boolean;
  webpMethod: number;
  avifEffort: number;
  workingColorSpace: "srgb";
  assumptionWhenNoIccNoTag: "srgb" | "adobe-rgb";
  outputIccBehavior: "tag-srgb" | "embed-srgb" | "untagged";
  provider: "gemini";
  model: string;
  apiKey: "";
  preResizeLongEdge: number;
  maxConcurrent: number;
  customPromptAddendum: string;
  cacheResults: boolean;
  filenameTemplates: FilenameTemplate[];
  slugMinWords: number;
  slugMaxWords: number;
  slugCollisionResolution: "hash-suffix";
  hashSuffixLength: number;
  workerPoolSize: number;
  previewLongEdge: number;
  previewDebounceMs: number;
};
