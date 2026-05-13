import { BUILTIN_FILENAME_TEMPLATE_ID } from "../constants";
import { builtinFilenameTemplate } from "../defaults";
import type { FilenameTemplate } from "../types/settings";

export type FilenameTemplateValidationIssue = {
  templateId: string | null;
  message: string;
};

const simplePlaceholders = new Set(["slug", "w", "h", "ext", "index"]);
const dateSources = new Set(["saved", "now", "taken", "source"]);
const dateFormats = new Set(["yyyymmdd", "yyyymmdd-hhmmss", "iso", "unix"]);
const placeholderPattern = /\{([^{}]+)\}/g;

export function validateFilenameTemplatePattern(pattern: string): string[] {
  const issues: string[] = [];
  if (pattern.trim().length === 0) {
    issues.push("must not be empty.");
    return issues;
  }

  for (const match of pattern.matchAll(placeholderPattern)) {
    const token = match[1]?.trim() ?? "";
    if (!isAllowedPlaceholder(token)) {
      issues.push(`contains unsupported placeholder "{${token}}".`);
    }
  }

  const literal = pattern.replace(placeholderPattern, "");
  if (literal.includes("{") || literal.includes("}")) {
    issues.push("contains unmatched braces.");
  }
  if (/[\\/]/.test(literal)) {
    issues.push("must not include path separators outside placeholders.");
  }

  return issues;
}

export function validateFilenameTemplates(
  templates: FilenameTemplate[],
  defaultTemplateId?: string | null
): FilenameTemplateValidationIssue[] {
  const issues: FilenameTemplateValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Map<string, string>();
  const seenPatterns = new Map<string, string>();

  for (const template of templates) {
    const normalizedName = template.name.trim().toLowerCase();
    const normalizedPattern = template.pattern.trim();

    if (seenIds.has(template.id)) {
      issues.push({ templateId: template.id, message: `Template id "${template.id}" is duplicated.` });
    }
    seenIds.add(template.id);

    if (template.name.trim().length === 0) {
      issues.push({ templateId: template.id, message: "Template name must not be empty." });
    } else if (seenNames.has(normalizedName)) {
      issues.push({ templateId: template.id, message: `Template name duplicates "${seenNames.get(normalizedName)}".` });
    } else {
      seenNames.set(normalizedName, template.name.trim());
    }

    if (seenPatterns.has(normalizedPattern)) {
      issues.push({ templateId: template.id, message: `Template pattern duplicates "${seenPatterns.get(normalizedPattern)}".` });
    } else {
      seenPatterns.set(normalizedPattern, template.pattern);
    }

    for (const message of validateFilenameTemplatePattern(template.pattern)) {
      issues.push({ templateId: template.id, message: `Pattern ${message}` });
    }

    if (template.id === BUILTIN_FILENAME_TEMPLATE_ID) {
      if (template.pattern !== builtinFilenameTemplate.pattern || template.name !== builtinFilenameTemplate.name || template.builtin !== true) {
        issues.push({ templateId: template.id, message: "Built-in template must keep its original name, pattern, and builtin flag." });
      }
    }
  }

  if (!templates.some((template) => template.id === BUILTIN_FILENAME_TEMPLATE_ID)) {
    issues.push({ templateId: null, message: "Built-in filename template must be present." });
  }

  if (defaultTemplateId && !templates.some((template) => template.id === defaultTemplateId)) {
    issues.push({ templateId: null, message: `Default template "${defaultTemplateId}" does not exist.` });
  }

  return issues;
}

export function assertSafeRenderedFilename(fileName: string): void {
  if (fileName.length === 0) {
    throw new Error("Rendered filename is empty.");
  }
  if (fileName === "." || fileName === "..") {
    throw new Error(`Rendered filename "${fileName}" is not allowed.`);
  }
  if (/[\\/]/.test(fileName)) {
    throw new Error(`Rendered filename "${fileName}" contains path separators.`);
  }
  if (fileName.includes("\0")) {
    throw new Error("Rendered filename contains a null byte.");
  }
}

function isAllowedPlaceholder(token: string): boolean {
  if (simplePlaceholders.has(token)) return true;

  if (/^index:0\d+$/.test(token)) {
    const width = Number(token.slice("index:".length));
    return Number.isInteger(width) && width > 0 && width <= 20;
  }

  if (/^hash:\d+$/.test(token)) {
    const length = Number(token.slice("hash:".length));
    return Number.isInteger(length) && length >= 1 && length <= 64;
  }

  if (/^date:[^|]+\|[^|]+\|[^|]+$/.test(token)) {
    const rest = token.slice("date:".length);
    const [source, timezone, format] = rest.split("|");
    return dateSources.has(source.trim().toLowerCase()) &&
      timezone.trim().length > 0 &&
      dateFormats.has(format.trim().toLowerCase());
  }

  return false;
}
