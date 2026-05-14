import { BUILTIN_FILENAME_TEMPLATE_ID } from "./constants";
import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { Project } from "./types/project";

export const builtinFilenameTemplate = {
  id: BUILTIN_FILENAME_TEMPLATE_ID,
  name: "Slug with size",
  pattern: "{slug}-{w}x{h}.{ext}",
  builtin: true
} as const;

export function defaultOutputSettings(): OutputSettings {
  return {
    format: "webp",
    quality: 82,
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

export function defaultGlobalSettings(workerPoolSize = 4): GlobalSettings {
  return {
    confirmDeleteOriginalWithTasks: true,
    confirmDeleteOutputFiles: true,
    defaultOutputFormat: "webp",
    defaultWebpQuality: 82,
    defaultAvifQuality: 60,
    defaultPngPalette: false,
    defaultMetadataStrip: ["author", "copyright", "orientation", "colorspace"],
    defaultAnalyzeContent: true,
    defaultBackgroundForTransparency: "#ffffff",
    jpegStrategy: "match-source-size",
    jpegQualityOnDetectionFailure: 85,
    jpegFixedQuality: 85,
    jpegChromaSubsampling: "4:2:0",
    jpegProgressive: true,
    webpMethod: 4,
    avifEffort: 4,
    injectAuthorCopyright: false,
    preserveSourceDates: true,
    injectFields: {},
    model: "gemini-3.1-pro",
    visionProjectContext: "",
    preResizeLongEdge: 1024,
    customPromptAddendum: "",
    filenameTemplates: [builtinFilenameTemplate],
    defaultTemplateId: BUILTIN_FILENAME_TEMPLATE_ID,
    slugMinWords: 4,
    slugMaxWords: 7,
    hashSuffixLength: 4,
    defaultOutputDirectory: "",
    lutFolder: "~/.fotoready/luts/",
    defaultWatermarkImage: "",
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
