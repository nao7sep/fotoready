import { DEFAULT_FILENAME_TEMPLATE_ID } from "../constants";
import { builtinFilenameTemplates } from "../defaults";
import type { FilenameTemplate, GlobalSettings, MetadataField, MetadataFields } from "../types/settings";
import { assertArray, assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, assertString, isRecord } from "./common";
import { validateFilenameTemplatePattern, validateFilenameTemplates } from "./filename-template";

const metadataFields = ["author", "copyright", "orientation", "colorspace"] as const satisfies readonly MetadataField[];
const outputFormats = ["original", "jpeg", "webp", "avif", "png"] as const;
const jpegQualityModes = ["auto", "fixed"] as const;
const chromaSubsamplingModes = ["4:4:4", "4:2:2", "4:2:0"] as const;
const editableMetadataFields = ["description", "author", "credit", "source", "copyright", "usageTerms", "webStatement", "contactEmail", "contactUrl"] as const satisfies readonly (keyof MetadataFields)[];

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
    confirmDeleteOriginals: readValue(source, "confirmDeleteOriginals", fallback.confirmDeleteOriginals, issues, assertBoolean),
    confirmDeleteTasks: readValue(source, "confirmDeleteTasks", fallback.confirmDeleteTasks, issues, assertBoolean),
    confirmDeleteOutputFiles: readValue(source, "confirmDeleteOutputFiles", fallback.confirmDeleteOutputFiles, issues, assertBoolean),
    defaultOutputFormat: readValue(source, "defaultOutputFormat", fallback.defaultOutputFormat, issues, (value, path) => assertOneOf(value, path, outputFormats)),
    defaultWebpQuality: readValue(source, "defaultWebpQuality", fallback.defaultWebpQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultAvifQuality: readValue(source, "defaultAvifQuality", fallback.defaultAvifQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultPngPalette: readValue(source, "defaultPngPalette", fallback.defaultPngPalette, issues, assertBoolean),
    defaultMetadataStrip: readValue(source, "defaultMetadataStrip", fallback.defaultMetadataStrip, issues, validateMetadataStrip),
    defaultGenerateDescription: readLegacyBooleanPair(source, "defaultGenerateDescription", "defaultAnalyzeContent", fallback.defaultGenerateDescription, issues),
    defaultGenerateSlug: readLegacyBooleanPair(source, "defaultGenerateSlug", "defaultAnalyzeContent", fallback.defaultGenerateSlug, issues),
    enableJpegQualityEstimate: readValue(source, "enableJpegQualityEstimate", fallback.enableJpegQualityEstimate, issues, assertBoolean),
    defaultFlattenTransparency: readValue(source, "defaultFlattenTransparency", fallback.defaultFlattenTransparency, issues, assertBoolean),
    defaultBackgroundForTransparency: readValue(source, "defaultBackgroundForTransparency", fallback.defaultBackgroundForTransparency, issues, assertNonEmptyString),
    injectAuthorCopyright: readValue(source, "injectAuthorCopyright", fallback.injectAuthorCopyright, issues, assertBoolean),
    preserveSourceDates: readValue(source, "preserveSourceDates", fallback.preserveSourceDates, issues, assertBoolean),
    injectFields: readValue(source, "injectFields", fallback.injectFields, issues, validateMetadataFields),
    defaultTemplateId: fallback.defaultTemplateId,
    defaultOutputDirectory: readValue(source, "defaultOutputDirectory", fallback.defaultOutputDirectory, issues, assertString),
    lutFolder: readValue(source, "lutFolder", fallback.lutFolder, issues, assertString),
    defaultWatermarkImage: readValue(source, "defaultWatermarkImage", fallback.defaultWatermarkImage, issues, assertString),
    jpegQualityMode: readValue(source, "jpegQualityMode", fallback.jpegQualityMode, issues, (value, path) => assertOneOf(value, path, jpegQualityModes)),
    jpegFixedQuality: readValue(source, "jpegFixedQuality", fallback.jpegFixedQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    jpegChromaSubsampling: readValue(source, "jpegChromaSubsampling", fallback.jpegChromaSubsampling, issues, (value, path) => assertOneOf(value, path, chromaSubsamplingModes)),
    jpegProgressive: readValue(source, "jpegProgressive", fallback.jpegProgressive, issues, assertBoolean),
    webpMethod: readValue(source, "webpMethod", fallback.webpMethod, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 6 })),
    avifEffort: readValue(source, "avifEffort", fallback.avifEffort, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 9 })),
    model: readValue(source, "model", fallback.model, issues, assertNonEmptyString),
    preResizeLongEdge: readValue(source, "preResizeLongEdge", fallback.preResizeLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 128 })),
    visionDescriptionPrompt: readValue(source, "visionDescriptionPrompt", fallback.visionDescriptionPrompt, issues, assertNonEmptyString),
    visionSlugPrompt: readValue(source, "visionSlugPrompt", fallback.visionSlugPrompt, issues, assertNonEmptyString),
    filenameTemplates: normalizeFilenameTemplates(source.filenameTemplates, fallback.filenameTemplates, issues),
    workerPoolSize: readValue(source, "workerPoolSize", fallback.workerPoolSize, issues, validateWorkerPoolSize),
    previewLongEdge: readValue(source, "previewLongEdge", fallback.previewLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 64 })),
    previewDebounceMs: readValue(source, "previewDebounceMs", fallback.previewDebounceMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 5000 }))
  };

  const requestedTemplateId = source.defaultTemplateId;
  settings.defaultTemplateId = normalizeDefaultTemplateId(
    requestedTemplateId === undefined ? fallback.defaultTemplateId : requestedTemplateId,
    settings.filenameTemplates,
    fallback.defaultTemplateId,
    issues
  );
  if (settings.defaultGenerateSlug) {
    settings.defaultGenerateDescription = true;
  }
  if (!settings.enableJpegQualityEstimate && settings.jpegQualityMode === "auto") {
    settings.jpegQualityMode = "fixed";
  }

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

function validateMetadataFields(value: unknown, path: string): MetadataFields {
  const record = assertRecord(value, path);
  const fields: MetadataFields = {};
  for (const key of editableMetadataFields) {
    if (record[key] === undefined) continue;
    fields[key] = assertString(record[key], `${path}.${key}`);
  }
  return fields;
}

function validateWorkerPoolSize(value: unknown, path: string): number | null {
  if (value === null) return null;
  return assertFiniteNumber(value, path, { integer: true, min: 1, max: 512 });
}

function readLegacyBooleanPair(source: Record<string, unknown>, primaryKey: string, legacyKey: string, fallback: boolean, issues: string[]): boolean {
  const primary = source[primaryKey];
  if (primary !== undefined) {
    try {
      return assertBoolean(primary, `settings.${primaryKey}`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      return fallback;
    }
  }
  const legacy = source[legacyKey];
  if (legacy !== undefined) {
    try {
      return assertBoolean(legacy, `settings.${legacyKey}`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return fallback;
}

function normalizeFilenameTemplates(value: unknown, fallback: FilenameTemplate[], issues: string[]): FilenameTemplate[] {
  const builtins = [...builtinFilenameTemplates];
  if (value === undefined) {
    return cloneValue(fallback.length ? fallback : builtins);
  }

  if (!Array.isArray(value)) {
    issues.push("settings.filenameTemplates must be an array.");
    return cloneValue(fallback.length ? fallback : builtins);
  }

  const templates: FilenameTemplate[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const seenPatterns = new Set<string>();

  for (const [index, entry] of value.entries()) {
    try {
      const template = validateFilenameTemplate(entry, `settings.filenameTemplates[${index}]`);
      if (seen.has(template.id)) {
        issues.push(`settings.filenameTemplates[${index}].id duplicates "${template.id}".`);
        continue;
      }
      seen.add(template.id);
      const normalizedName = template.name.trim().toLowerCase();
      if (seenNames.has(normalizedName)) {
        issues.push(`settings.filenameTemplates[${index}].name duplicates "${template.name.trim()}".`);
        continue;
      }
      seenNames.add(normalizedName);
      const normalizedPattern = template.pattern.trim();
      if (seenPatterns.has(normalizedPattern)) {
        issues.push(`settings.filenameTemplates[${index}].pattern duplicates another template.`);
        continue;
      }
      seenPatterns.add(normalizedPattern);
      templates.push(template);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  const normalizedTemplates = templates;
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
    pattern
  };
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
  return templates[0]?.id ?? DEFAULT_FILENAME_TEMPLATE_ID;
}
