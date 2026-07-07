export const BUILTIN_RENAME_TEMPLATE_IDS = {
  slugSize: "builtin-slug-size",
  slug: "builtin-slug",
  originalSize: "builtin-original-size",
  original: "builtin-original"
} as const;

export type RenameTemplateId = (typeof BUILTIN_RENAME_TEMPLATE_IDS)[keyof typeof BUILTIN_RENAME_TEMPLATE_IDS];

export type RenameTemplate = {
  id: RenameTemplateId;
  name: string;
  base: "original" | "slug";
  includeSize: boolean;
};

export type RenderRenameTemplateInput = {
  slug: string;
  original: string;
  w: number;
  h: number;
  ext: string;
};

export const builtinRenameTemplates: readonly RenameTemplate[] = [
  { id: BUILTIN_RENAME_TEMPLATE_IDS.slugSize, name: "Slug + size", base: "slug", includeSize: true },
  { id: BUILTIN_RENAME_TEMPLATE_IDS.slug, name: "Slug only", base: "slug", includeSize: false },
  { id: BUILTIN_RENAME_TEMPLATE_IDS.originalSize, name: "Original + size", base: "original", includeSize: true },
  { id: BUILTIN_RENAME_TEMPLATE_IDS.original, name: "Original only", base: "original", includeSize: false }
] as const;

export const DEFAULT_RENAME_TEMPLATE_ID: RenameTemplateId = BUILTIN_RENAME_TEMPLATE_IDS.slugSize;

export function findRenameTemplate(templateId?: string): RenameTemplate {
  return builtinRenameTemplates.find((template) => template.id === templateId) ?? builtinRenameTemplates[0];
}

export function renameTemplateUsesSlug(template: RenameTemplate): boolean {
  return template.base === "slug";
}

export function renameTemplateUsesOriginal(template: RenameTemplate): boolean {
  return template.base === "original";
}

export function renderRenameTemplate(template: RenameTemplate, input: RenderRenameTemplateInput): string {
  const base = renameTemplateUsesSlug(template) ? input.slug : input.original;
  const size = template.includeSize ? `-${input.w}x${input.h}` : "";
  return `${base}${size}.${input.ext}`;
}
