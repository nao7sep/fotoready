import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "./watermark-text-layout";

export const defaultVisionDescriptionPrompt = "Write one factual sentence describing the image for publication use. State only what is clearly visible, including the subject, setting, and the most useful distinguishing detail. Avoid marketing language, emotional interpretation, and guesses about unseen context.";
export const defaultVisionSlugPrompt = "Generate 3 to 5 distinct lowercase English slug candidates from the description. Prefer concrete nouns and verbs, order them from most specific to more general, avoid filler words like photo, image, shot, and view, and use only letters, numbers, and hyphens.";

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
    confirmDeleteOriginals: false,
    confirmDeleteTasks: false,
    confirmDeleteOutputFiles: true,
    defaultOutputFormat: "original",
    defaultWebpQuality: 82,
    defaultAvifQuality: 60,
    defaultPngPalette: false,
    defaultMetadataStrip: [],
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
    injectAuthorCopyright: false,
    preserveSourceDates: true,
    injectFields: {},
    model: "gemini-3-flash-preview",
    preResizeLongEdge: 1024,
    visionDescriptionPrompt: defaultVisionDescriptionPrompt,
    visionSlugPrompt: defaultVisionSlugPrompt,
    defaultOutputDirectory: "",
    lutFolder: "",
    defaultWatermarkImage: "",
    defaultWatermarkTextFontFamily: DEFAULT_TEXT_WATERMARK_FONT_FAMILY,
    workerPoolSize,
    previewLongEdge: 1024,
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
