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

export type GlobalSettings = {
  defaultOutputFormat: OutputFormat;
  defaultWebpQuality: number;
  defaultAvifQuality: number;
  defaultPngPalette: boolean;
  defaultMetadataStrip: MetadataStripMode;
  defaultAnalyzeContent: boolean;
  defaultBackgroundForTransparency: string;
  injectAuthorCopyright: boolean;
  preserveSourceDates: boolean;
  injectFields: MetadataFields;
  defaultTemplateId: string;
  defaultOutputDirectory: string;
  lutFolder: string;
  defaultWatermarkImage: string;
  confirmDeleteOriginalWithTasks: boolean;
  confirmDeleteOutputFiles: boolean;
  jpegStrategy: "match-source-size" | "match-source-quality" | "fixed" | "prompt-per-task";
  jpegQualityOnDetectionFailure: number;
  jpegFixedQuality: number;
  jpegChromaSubsampling: "4:4:4" | "4:2:2" | "4:2:0";
  jpegProgressive: boolean;
  webpMethod: number;
  avifEffort: number;
  model: string;
  visionProjectContext: string;
  preResizeLongEdge: number;
  customPromptAddendum: string;
  filenameTemplates: FilenameTemplate[];
  slugMinWords: number;
  slugMaxWords: number;
  hashSuffixLength: number;
  workerPoolSize: number;
  previewLongEdge: number;
  previewDebounceMs: number;
};
