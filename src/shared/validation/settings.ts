import { BUILTIN_FILENAME_TEMPLATE_ID } from "../constants";
import { builtinFilenameTemplate } from "../defaults";
import type { FilenameTemplate, GlobalSettings, MetadataField } from "../types/settings";
import { assertArray, assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, assertString, isRecord } from "./common";
import { validateFilenameTemplatePattern, validateFilenameTemplates } from "./filename-template";

const metadataFields = ["author", "copyright", "orientation", "colorspace"] as const satisfies readonly MetadataField[];
const outputFormats = ["jpeg", "webp", "avif", "png"] as const;
const jpegStrategies = ["match-source-size", "match-source-quality", "fixed", "prompt-per-task"] as const;
const chromaSubsamplingModes = ["4:4:4", "4:2:2", "4:2:0"] as const;

export type SettingsNormalizationResult = {
  settings: GlobalSettings;
  issues: string[];
};

export function normalizeGlobalSettings(input: unknown, fallback: GlobalSettings): SettingsNormalizationResult {
  const issues: string[] = [];
  const source = isRecord(input)
    ? input
    : (issues.push("settings must be a JSON object."), {});

  const settings: GlobalSettings = {
    confirmDeleteOriginalWithTasks: readValue(source, "confirmDeleteOriginalWithTasks", fallback.confirmDeleteOriginalWithTasks, issues, assertBoolean),
    confirmDeleteOutputFiles: readValue(source, "confirmDeleteOutputFiles", fallback.confirmDeleteOutputFiles, issues, assertBoolean),
    defaultOutputFormat: readValue(source, "defaultOutputFormat", fallback.defaultOutputFormat, issues, (value, path) => assertOneOf(value, path, outputFormats)),
    defaultWebpQuality: readValue(source, "defaultWebpQuality", fallback.defaultWebpQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultAvifQuality: readValue(source, "defaultAvifQuality", fallback.defaultAvifQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultPngPalette: readValue(source, "defaultPngPalette", fallback.defaultPngPalette, issues, assertBoolean),
    defaultMetadataStrip: readValue(source, "defaultMetadataStrip", fallback.defaultMetadataStrip, issues, validateMetadataStrip),
    defaultAnalyzeContent: readValue(source, "defaultAnalyzeContent", fallback.defaultAnalyzeContent, issues, assertBoolean),
    defaultBackgroundForTransparency: readValue(source, "defaultBackgroundForTransparency", fallback.defaultBackgroundForTransparency, issues, assertNonEmptyString),
    injectAuthorCopyright: readValue(source, "injectAuthorCopyright", fallback.injectAuthorCopyright, issues, assertBoolean),
    preserveSourceDates: readValue(source, "preserveSourceDates", fallback.preserveSourceDates, issues, assertBoolean),
    injectFields: readValue(source, "injectFields", fallback.injectFields, issues, validateStringMap),
    defaultTemplateId: fallback.defaultTemplateId,
    defaultOutputDirectory: readValue(source, "defaultOutputDirectory", fallback.defaultOutputDirectory, issues, assertString),
    lutFolder: readValue(source, "lutFolder", fallback.lutFolder, issues, assertNonEmptyString),
    defaultWatermarkImage: readValue(source, "defaultWatermarkImage", fallback.defaultWatermarkImage, issues, assertString),
    jpegStrategy: readValue(source, "jpegStrategy", fallback.jpegStrategy, issues, (value, path) => assertOneOf(value, path, jpegStrategies)),
    jpegQualityOnDetectionFailure: readValue(source, "jpegQualityOnDetectionFailure", fallback.jpegQualityOnDetectionFailure, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    jpegFixedQuality: readValue(source, "jpegFixedQuality", fallback.jpegFixedQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    jpegChromaSubsampling: readValue(source, "jpegChromaSubsampling", fallback.jpegChromaSubsampling, issues, (value, path) => assertOneOf(value, path, chromaSubsamplingModes)),
    jpegProgressive: readValue(source, "jpegProgressive", fallback.jpegProgressive, issues, assertBoolean),
    webpMethod: readValue(source, "webpMethod", fallback.webpMethod, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 6 })),
    avifEffort: readValue(source, "avifEffort", fallback.avifEffort, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 9 })),
    model: readValue(source, "model", fallback.model, issues, assertNonEmptyString),
    visionProjectContext: readValue(source, "visionProjectContext", fallback.visionProjectContext, issues, assertString),
    preResizeLongEdge: readValue(source, "preResizeLongEdge", fallback.preResizeLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 128 })),
    customPromptAddendum: readValue(source, "customPromptAddendum", fallback.customPromptAddendum, issues, assertString),
    filenameTemplates: normalizeFilenameTemplates(source.filenameTemplates, fallback.filenameTemplates, issues),
    slugMinWords: readValue(source, "slugMinWords", fallback.slugMinWords, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 12 })),
    slugMaxWords: readValue(source, "slugMaxWords", fallback.slugMaxWords, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 16 })),
    hashSuffixLength: readValue(source, "hashSuffixLength", fallback.hashSuffixLength, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 2, max: 16 })),
    workerPoolSize: readValue(source, "workerPoolSize", fallback.workerPoolSize, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 32 })),
    previewLongEdge: readValue(source, "previewLongEdge", fallback.previewLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 64 })),
    previewDebounceMs: readValue(source, "previewDebounceMs", fallback.previewDebounceMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 5000 })),
    showHistogram: readValue(source, "showHistogram", fallback.showHistogram, issues, assertBoolean)
  };

  if (settings.slugMaxWords < settings.slugMinWords) {
    issues.push("settings.slugMaxWords must be greater than or equal to settings.slugMinWords.");
    settings.slugMaxWords = Math.max(settings.slugMinWords, fallback.slugMaxWords);
  }

  const requestedTemplateId = source.defaultTemplateId;
  settings.defaultTemplateId = normalizeDefaultTemplateId(
    requestedTemplateId === undefined ? fallback.defaultTemplateId : requestedTemplateId,
    settings.filenameTemplates,
    fallback.defaultTemplateId,
    issues
  );

  return { settings, issues };
}

function readValue<T>(
  source: Record<string, unknown>,
  key: string,
  fallback: T,
  issues: string[],
  parser: (value: unknown, path: string) => T
): T {
  const value = source[key];
  if (value === undefined) {
    return cloneValue(fallback);
  }

  try {
    return parser(value, `settings.${key}`);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return cloneValue(fallback);
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return structuredClone(value);
  }
  return value;
}

function validateMetadataStrip(value: unknown, path: string): MetadataField[] {
  const fields = assertArray(value, path).map((item, index) => assertOneOf(item, `${path}[${index}]`, metadataFields));
  return [...new Set(fields)];
}

function validateStringMap(value: unknown, path: string): Record<string, string> {
  const record = assertRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, assertString(entry, `${path}.${key}`)])
  );
}

function normalizeFilenameTemplates(value: unknown, fallback: FilenameTemplate[], issues: string[]): FilenameTemplate[] {
  if (value === undefined) {
    return ensureBuiltinTemplate(cloneValue(fallback));
  }

  if (!Array.isArray(value)) {
    issues.push("settings.filenameTemplates must be an array.");
    return ensureBuiltinTemplate(cloneValue(fallback));
  }

  const templates: FilenameTemplate[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const seenPatterns = new Set<string>();

  for (const [index, entry] of value.entries()) {
    try {
      const template = validateFilenameTemplate(entry, `settings.filenameTemplates[${index}]`);
      const normalized = template.id === BUILTIN_FILENAME_TEMPLATE_ID ? builtinFilenameTemplate : template;
      if (seen.has(normalized.id)) {
        issues.push(`settings.filenameTemplates[${index}].id duplicates "${normalized.id}".`);
        continue;
      }
      seen.add(normalized.id);
      const normalizedName = normalized.name.trim().toLowerCase();
      if (seenNames.has(normalizedName)) {
        issues.push(`settings.filenameTemplates[${index}].name duplicates "${normalized.name.trim()}".`);
        continue;
      }
      seenNames.add(normalizedName);
      const normalizedPattern = normalized.pattern.trim();
      if (seenPatterns.has(normalizedPattern)) {
        issues.push(`settings.filenameTemplates[${index}].pattern duplicates another template.`);
        continue;
      }
      seenPatterns.add(normalizedPattern);
      templates.push(normalized);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  const normalizedTemplates = ensureBuiltinTemplate(templates);
  for (const issue of validateFilenameTemplates(normalizedTemplates)) {
    issues.push(issue.templateId ? `settings.filenameTemplates[${issue.templateId}] ${issue.message}` : issue.message);
  }
  return normalizedTemplates;
}

function validateFilenameTemplate(value: unknown, path: string): FilenameTemplate {
  const record = assertRecord(value, path);
  const pattern = assertNonEmptyString(record.pattern, `${path}.pattern`);
  const patternIssues = validateFilenameTemplatePattern(pattern);
  if (patternIssues.length > 0) {
    throw new Error(`${path}.pattern ${patternIssues[0]}`);
  }
  return {
    id: assertNonEmptyString(record.id, `${path}.id`),
    name: assertNonEmptyString(record.name, `${path}.name`),
    pattern,
    builtin: record.builtin === undefined ? undefined : assertBoolean(record.builtin, `${path}.builtin`)
  };
}

function ensureBuiltinTemplate(templates: FilenameTemplate[]): FilenameTemplate[] {
  const filtered = templates.filter((template) => template.id !== BUILTIN_FILENAME_TEMPLATE_ID);
  return [builtinFilenameTemplate, ...filtered];
}

function normalizeDefaultTemplateId(value: unknown, templates: FilenameTemplate[], fallback: string, issues: string[]): string {
  if (value !== undefined) {
    try {
      const templateId = assertNonEmptyString(value, "settings.defaultTemplateId");
      if (templates.some((template) => template.id === templateId)) {
        return templateId;
      }
      issues.push(`settings.defaultTemplateId must reference an existing template. Received "${templateId}".`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (templates.some((template) => template.id === fallback)) {
    return fallback;
  }
  return templates[0]?.id ?? BUILTIN_FILENAME_TEMPLATE_ID;
}
