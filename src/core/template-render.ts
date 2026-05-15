export type RenderTemplateInput = {
  slug: string;
  original: string;
  w: number;
  h: number;
  ext: string;
};

export function renderFilenameTemplate(pattern: string, input: RenderTemplateInput): string {
  return pattern
    .replaceAll("{slug}", input.slug)
    .replaceAll("{original}", input.original)
    .replaceAll("{w}", input.w.toString())
    .replaceAll("{h}", input.h.toString())
    .replaceAll("{ext}", input.ext);
}
