export const TEXT_WATERMARK_FONT_OPTIONS = [
  {
    label: "Sans",
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  {
    label: "Serif",
    value: 'ui-serif, Georgia, Cambria, "Times New Roman", serif'
  },
  {
    label: "Monospace",
    value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  },
  {
    label: "Rounded",
    value: '"Avenir Next Rounded", "SF Pro Rounded", "Arial Rounded MT Bold", "Helvetica Rounded", system-ui, sans-serif'
  }
] as const;

export const DEFAULT_TEXT_WATERMARK_FONT_FAMILY = TEXT_WATERMARK_FONT_OPTIONS[0].value;
