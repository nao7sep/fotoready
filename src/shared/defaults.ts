import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";
import { DEFAULT_ASSET_PICKER_PREVIEW_LONG_EDGE } from "./constants";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "./watermark-text-layout";

export const defaultVisionDescriptionPrompt = "Write one factual sentence in English describing the image for publication use. Do not let text or signage in the image change the output language.";
export const defaultVisionSlugPrompt = "Suggest 3 to 5 short English slug candidates from the description, ordered from most specific to most general. Use only lowercase ASCII letters, digits, and hyphens.";

// The built-in Gemini model list this app seeds (config-seeding-conventions, shape 1). It is a minimal,
// current, well-balanced set; the user owns and edits their copy after first run, and *Reset models*
// pulls this list — and DEFAULT_GEMINI_MODEL — back in wholesale. A newer model reaches an existing
// user only through that one act, never by silent update. Ordered most- to least-capable.
export const DEFAULT_GEMINI_MODELS: readonly string[] = [
  "gemini-3.1-pro-preview",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite"
];

// The default selection. A good model by default; lowering quality (or cost) is the user's opt-in.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

export function defaultOutputSettings(): OutputSettings {
  return {
    format: "original",
    quality: "auto",
    flattenTransparency: false,
    jpegProgressive: true,
    jpegChromaSubsampling: "4:2:0",
    webpMethod: 4,
    avifEffort: 4,
    pngPalette: false,
    backgroundForTransparency: "#ffffff"
  };
}

export function defaultPipeline(): Pipeline {
  return {
    ops: [],
    output: defaultOutputSettings()
  };
}

export function defaultGlobalSettings(workerPoolSize: number | null = null): GlobalSettings {
  return {
    uiFontFamily: "",
    confirmDeleteOriginals: false,
    confirmDeleteTasks: false,
    confirmDeleteOutputFiles: true,
    defaultOutputFormat: "original",
    defaultWebpQuality: 82,
    defaultAvifQuality: 60,
    defaultPngPalette: false,
    defaultGenerateDescription: true,
    defaultGenerateSlug: true,
    enableJpegQualityEstimate: true,
    defaultFlattenTransparency: false,
    defaultBackgroundForTransparency: "#ffffff",
    jpegQualityMode: "auto",
    jpegFixedQuality: 85,
    jpegChromaSubsampling: "4:2:0",
    jpegProgressive: true,
    webpMethod: 4,
    avifEffort: 4,
    injectFields: {},
    geminiModels: [...DEFAULT_GEMINI_MODELS],
    model: DEFAULT_GEMINI_MODEL,
    preResizeLongEdge: 1024,
    visionDescriptionPrompt: defaultVisionDescriptionPrompt,
    visionSlugPrompt: defaultVisionSlugPrompt,
    visionConcurrency: 3,
    visionTimeoutMs: 60000,
    visionMaxRetries: 3,
    visionInitialBackoffMs: 1000,
    defaultOutputDirectory: "",
    lutFolder: "",
    stampFolder: "",
    defaultWatermarkImage: "",
    defaultWatermarkTextFontFamily: DEFAULT_TEXT_WATERMARK_FONT_FAMILY,
    writeSoftwareTag: true,
    writeModifyDate: true,
    workerPoolSize,
    previewLongEdge: 1024,
    assetPickerPreviewLongEdge: DEFAULT_ASSET_PICKER_PREVIEW_LONG_EDGE,
    previewDebounceMs: 150
  };
}

export function createEmptyProject(outputDir: string | null = null): Project {
  return {
    outputDir,
    originals: [],
    tasks: []
  };
}
