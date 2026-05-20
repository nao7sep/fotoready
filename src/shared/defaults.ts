import { BUILTIN_FILENAME_TEMPLATE_IDS, DEFAULT_FILENAME_TEMPLATE_ID } from "./constants";
import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "./watermark-text-layout";

export const builtinFilenameTemplates = [
  {
    id: BUILTIN_FILENAME_TEMPLATE_IDS.original,
    name: "Original only",
    pattern: "{original}.{ext}",
    builtin: true
  },
  {
    id: BUILTIN_FILENAME_TEMPLATE_IDS.originalSize,
    name: "Original + size",
    pattern: "{original}-{w}x{h}.{ext}",
    builtin: true
  },
  {
    id: BUILTIN_FILENAME_TEMPLATE_IDS.slug,
    name: "Slug only",
    pattern: "{slug}.{ext}",
    builtin: true
  },
  {
    id: BUILTIN_FILENAME_TEMPLATE_IDS.slugSize,
    name: "Slug + size",
    pattern: "{slug}-{w}x{h}.{ext}",
    builtin: true
  }
] as const;

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
    defaultMetadataStrip: ["author", "copyright", "orientation", "colorspace"],
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
    model: "gemini-3.1-pro",
    preResizeLongEdge: 1024,
    visionDescriptionPrompt: defaultVisionDescriptionPrompt,
    visionSlugPrompt: defaultVisionSlugPrompt,
    filenameTemplates: [...builtinFilenameTemplates],
    defaultTemplateId: DEFAULT_FILENAME_TEMPLATE_ID,
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
