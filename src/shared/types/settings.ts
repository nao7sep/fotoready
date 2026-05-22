import type { OutputFormat } from "./pipeline";

export const METADATA_KEEP_GROUPS = ["editorial", "dates", "gps"] as const;
export type MetadataKeepGroup = (typeof METADATA_KEEP_GROUPS)[number];
export type MetadataStripMode = MetadataKeepGroup[];

export type MetadataFields = {
  description?: string;
  author?: string;
  credit?: string;
  source?: string;
  copyright?: string;
  usageTerms?: string;
  webStatement?: string;
  contactEmail?: string;
  contactUrl?: string;
};

export const EDITABLE_METADATA_FIELDS = [
  "source",
  "description",
  "author",
  "contactEmail",
  "contactUrl",
  "credit",
  "copyright",
  "webStatement",
  "usageTerms"
] as const satisfies readonly (keyof MetadataFields)[];

export type JpegQualityMode = "auto" | "fixed";

export type GlobalSettings = {
  defaultOutputFormat: OutputFormat;
  defaultWebpQuality: number;
  defaultAvifQuality: number;
  defaultPngPalette: boolean;
  defaultMetadataStrip: MetadataStripMode;
  defaultGenerateDescription: boolean;
  defaultGenerateSlug: boolean;
  enableJpegQualityEstimate: boolean;
  defaultFlattenTransparency: boolean;
  defaultBackgroundForTransparency: string;
  injectAuthorCopyright: boolean;
  preserveSourceDates: boolean;
  injectFields: MetadataFields;
  defaultOutputDirectory: string;
  lutFolder: string;
  defaultWatermarkImage: string;
  defaultWatermarkTextFontFamily: string;
  confirmDeleteOriginals: boolean;
  confirmDeleteTasks: boolean;
  confirmDeleteOutputFiles: boolean;
  jpegQualityMode: JpegQualityMode;
  jpegFixedQuality: number;
  jpegChromaSubsampling: "4:4:4" | "4:2:2" | "4:2:0";
  jpegProgressive: boolean;
  webpMethod: number;
  avifEffort: number;
  model: string;
  preResizeLongEdge: number;
  visionDescriptionPrompt: string;
  visionSlugPrompt: string;
  visionConcurrency: number;
  visionTimeoutMs: number;
  visionMaxRetries: number;
  visionInitialBackoffMs: number;
  workerPoolSize: number | null;
  previewLongEdge: number;
  previewDebounceMs: number;
};
