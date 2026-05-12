export type RenderTemplateInput = {
  slug: string;
  w: number;
  h: number;
  ext: string;
  outputHash: string;
  index: number;
};

export function renderFilenameTemplate(pattern: string, input: RenderTemplateInput): string {
  return pattern
    .replaceAll("{slug}", input.slug)
    .replaceAll("{w}", input.w.toString())
    .replaceAll("{h}", input.h.toString())
    .replaceAll("{ext}", input.ext)
    .replaceAll("{index}", input.index.toString())
    .replace(/\{hash:(\d+)\}/g, (_, chars: string) => input.outputHash.slice(0, Number(chars)));
}
