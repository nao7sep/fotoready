import type { OutputFormat } from "./pipeline";

export type MetadataField = "author" | "copyright" | "orientation" | "colorspace";
export type MetadataStripMode = MetadataField[];

export type FilenameTemplate = {
  id: string;
  name: string;
  pattern: string;
  builtin?: boolean;
};

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
  defaultTemplateId: string;
  defaultOutputDirectory: string;
  lutFolder: string;
  defaultWatermarkImage: string;
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
  filenameTemplates: FilenameTemplate[];
  workerPoolSize: number | null;
  previewLongEdge: number;
  previewDebounceMs: number;
};
