import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";
import { DEFAULT_ASSET_PICKER_PREVIEW_LONG_EDGE } from "./constants";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "./watermark-text-layout";

export const defaultVisionDescriptionPrompt = "Write one factual sentence in English describing the image for publication use. Do not let text or signage in the image change the output language.";
export const defaultVisionSlugPrompt = "Suggest 3 to 5 short English slug candidates from the description, ordered from most specific to most general. Use only lowercase ASCII letters, digits, and hyphens.";

// The Gemini models FotoReady offers. A CLOSED list (ai-model-routing-conventions): the app ships it,
// the user picks from it, nothing adds to it at runtime. That is why there is no list editor and no
// *Reset models* — content the user must not edit is not shown as editable at all. Ordered by category
// (pro -> flash -> flash-lite), one per category, which also runs most- to least-expensive.
//
// Provenance differs per entry, and the difference is the point of writing it down:
//   gemini-3.1-pro-preview  — verified live 2026-07-16: resolves AND accepts image input.
//   gemini-3.7-flash        — added 2026-08-20, replacing gemini-3.5-flash.
//   gemini-3.5-flash-lite   — added 2026-08-20, replacing gemini-3.1-flash-lite.
// The two 2026-08-20 entries are DOC-VERIFIED ONLY: taken from Google's published model list after
// gemini-3-flash-preview was found shut down, and never yet called with an image from this app. That
// is a weaker bar than the entry above them met, and it stays written here until a live check closes it.
// mumbler proved the earlier ids for AUDIO; a different modality on a different app, so it was re-proven
// here rather than assumed to carry over (gptimg shipped two capability claims that had never met the
// API). Verification is a DESIGN-TIME act — the app itself never queries the model-list endpoint.
export const GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite"
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number];

// The shipped selection: the best of the flash category, which is the category this workload wants.
// A cheaper or stronger model is the user's opt-in. Typed as GeminiModel so a default that is not on
// the list above fails to COMPILE, rather than shipping a selection the Model picker cannot show.
// (Nothing checked this before; it was a standalone string next to a list it merely resembled.)
export const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-3.7-flash";

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
