import { BUILTIN_FILENAME_TEMPLATE_ID, PIPELINE_SPEC_VERSION } from "./constants";
import type { GlobalSettings } from "./types/settings";
import type { OutputSettings, Pipeline } from "./types/pipeline";

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
    backgroundForTransparency: "#ffffff",
    iccOutput: "tag-srgb"
  };
}

export function defaultPipeline(): Pipeline {
  return {
    specVersion: PIPELINE_SPEC_VERSION,
    ops: [],
    output: defaultOutputSettings(),
    appliedColorNormalization: null,
    sourceSnapshot: null,
    toolVersions: null
  };
}

export function defaultGlobalSettings(
  cameraTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  workerPoolSize = 4
): GlobalSettings {
  return {
    theme: "system",
    language: "en",
    cameraTimezone,
    confirmDeleteOriginalWithTasks: true,
    confirmDeleteOutputFiles: true,
    checkForUpdates: true,
    telemetry: false,
    defaultOutputFormat: "webp",
    defaultWebpQuality: 82,
    defaultAvifQuality: 60,
    defaultPngPalette: false,
    defaultMetadataStrip: ["author", "copyright", "orientation", "colorspace"],
    defaultStripGps: true,
    defaultStripThumbnail: true,
    defaultAnalyzeContent: true,
    defaultBackgroundForTransparency: "#ffffff",
    jpegStrategy: "match-source-size",
    jpegQualityOnDetectionFailure: 85,
    jpegFixedQuality: 85,
    jpegChromaSubsampling: "4:2:0",
    jpegProgressive: true,
    webpMethod: 4,
    avifEffort: 4,
    workingColorSpace: "srgb",
    assumptionWhenNoIccNoTag: "srgb",
    outputIccBehavior: "tag-srgb",
    injectAuthorCopyright: false,
    preserveSourceDates: true,
    descriptionSource: "vision-then-none",
    injectFields: {},
    provider: "gemini",
    model: "gemini-3.1-pro",
    apiKey: "",
    preResizeLongEdge: 768,
    maxConcurrent: 4,
    customPromptAddendum: "",
    cacheResults: true,
    filenameTemplates: [builtinFilenameTemplate],
    defaultTemplateId: BUILTIN_FILENAME_TEMPLATE_ID,
    slugMinWords: 4,
    slugMaxWords: 7,
    slugCollisionResolution: "hash-suffix",
    hashSuffixLength: 4,
    defaultOutputDirectory: "./out",
    sidecarLocation: "in-project-file",
    lutFolder: "~/.fotoready/luts/",
    defaultWatermarkImage: "",
    workerPoolSize,
    previewLongEdge: 1600,
    previewDebounceMs: 150
  };
}
