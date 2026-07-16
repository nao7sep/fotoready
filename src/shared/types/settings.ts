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
  // The app's UI (chrome) font family. Family only; blank means the built-in default stack (the
  // app.css `--font-ui` variable). Distinct from `defaultWatermarkTextFontFamily`, which is a
  // content-output font rendered into the saved image — never the UI font.
  uiFontFamily: string;
  defaultOutputFormat: OutputFormat;
  defaultWebpQuality: number;
  defaultAvifQuality: number;
  defaultPngPalette: boolean;
  defaultGenerateDescription: boolean;
  defaultGenerateSlug: boolean;
  enableJpegQualityEstimate: boolean;
  defaultFlattenTransparency: boolean;
  defaultBackgroundForTransparency: string;
  injectFields: MetadataFields;
  defaultOutputDirectory: string;
  lutFolder: string;
  stampFolder: string;
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
  // The selected Gemini model. The list itself is app-owned and closed (GEMINI_MODELS in defaults.ts),
  // so this is the only part of the choice the config stores.
  //
  // Deliberately `string`, not `GeminiModel`: a config written by an older build — or edited by hand —
  // can name a model this build does not offer, and the store's job is to hand that value back, not to
  // judge it. It is never snapped to a valid one (ai-model-routing-conventions: the store stays dumb).
  //
  // "Not offered" is not the same as "broken", and the difference was measured rather than assumed:
  // gemini-2.5-pro is absent from GEMINI_MODELS yet still runs, because Gemini still serves it. So an
  // unlisted id keeps working until GOOGLE retires it, at which point the vision job reports the API's
  // own error. FotoReady does not police which models exist — that constraint belongs to the provider.
  model: string;
  preResizeLongEdge: number;
  visionDescriptionPrompt: string;
  visionSlugPrompt: string;
  visionConcurrency: number;
  visionTimeoutMs: number;
  visionMaxRetries: number;
  visionInitialBackoffMs: number;
  writeSoftwareTag: boolean;
  writeModifyDate: boolean;
  workerPoolSize: number | null;
  previewLongEdge: number;
  assetPickerPreviewLongEdge: number;
  previewDebounceMs: number;
};
