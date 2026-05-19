import { DEFAULT_FILENAME_TEMPLATE_ID } from "../constants";
import type { FilenameTemplate } from "../types/settings";

export type FilenameTemplateValidationIssue = {
  templateId: string | null;
  message: string;
};

const simplePlaceholders = new Set(["slug", "original", "w", "h", "ext"]);
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

export function validateFilenameTemplates(templates: FilenameTemplate[], defaultTemplateId?: string | null): FilenameTemplateValidationIssue[] {
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

  }

  if (templates.length === 0) {
    issues.push({ templateId: null, message: "At least one filename template is required." });
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
  return simplePlaceholders.has(token);
}
