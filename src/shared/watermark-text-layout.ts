// Presets offered for the text watermark's font family; the renderer names each by its id.
export const TEXT_WATERMARK_FONT_OPTIONS = [
  {
    id: "system-ui",
    value: "system-ui, sans-serif"
  },
  {
    id: "serif",
    value: 'ui-serif, Georgia, Cambria, "Times New Roman", serif'
  },
  {
    id: "monospace",
    value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  },
  {
    id: "rounded",
    value: '"Avenir Next Rounded", "SF Pro Rounded", "Arial Rounded MT Bold", "Helvetica Rounded", system-ui, sans-serif'
  }
] as const;

export const DEFAULT_TEXT_WATERMARK_FONT_FAMILY = TEXT_WATERMARK_FONT_OPTIONS[0].value;
