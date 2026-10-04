import { defaultMediaResolutionFor, defaultModelFor, defaultThinkingFor } from "./ai-models";
import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";
import { DEFAULT_ASSET_PICKER_PREVIEW_LONG_EDGE } from "./constants";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "./watermark-text-layout";

export const defaultVisionDescriptionPrompt = "Write one factual sentence in English describing the image for publication use. Do not let text or signage in the image change the output language.";
export const defaultVisionSlugPrompt = "Suggest 3 to 5 short English slug candidates from the description, ordered from most specific to most general. Use only lowercase ASCII letters, digits, and hyphens.";

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
    language: "system",
    theme: "system",
    uiFontFamily: "",
    confirmDeleteOriginals: false,
    confirmDeleteTasks: true,
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
    "gemini.endpoint": "https://generativelanguage.googleapis.com",
    "gemini.description": defaultModelFor("gemini", "vision"),
    "gemini.slug": defaultModelFor("gemini", "text-fast"),
    "gemini.thinking.description": defaultThinkingFor("gemini", "vision", defaultModelFor("gemini", "vision")),
    "gemini.thinking.slug": defaultThinkingFor("gemini", "text-fast", defaultModelFor("gemini", "text-fast")),
    "gemini.mediaResolution.description": defaultMediaResolutionFor("gemini", defaultModelFor("gemini", "vision")),
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

// The built-in map declares every known config set; each top-level key is saved independently.
export const SETTINGS_KEYS = Object.keys(defaultGlobalSettings()) as (keyof GlobalSettings)[];

export function createEmptyProject(outputDir: string | null = null): Project {
  return {
    outputDir,
    originals: [],
    tasks: []
  };
}
