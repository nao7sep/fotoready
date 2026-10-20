import { CONTROL_GAP, CONTROL_HEIGHT } from "@shared/layout/controls";
import { RECORDS_FILTERS_PADDING } from "@shared/layout/records-metrics";
import { CHROME, PANE_DEFAULTS, PANE_MINS, SPLITTER_WIDTH } from "@shared/layout/workspace-metrics";

// The lengths the window minimums are derived from, set on the document root before the first
// render, so the stylesheet repeats none of them.
export function applyLayoutVariables(root: HTMLElement): void {
  const lengths: Record<string, number> = {
    "--control-h": CONTROL_HEIGHT,
    "--control-gap": CONTROL_GAP,
    "--splitter-width": SPLITTER_WIDTH,
    "--top-bar-height": CHROME.topBar,
    "--preview-toolbar-height": CHROME.previewToolbar,
    "--status-bar-height": CHROME.statusBar,
    "--originals-default-width": PANE_DEFAULTS.originals,
    "--tasks-default-width": PANE_DEFAULTS.tasks,
    "--ops-default-width": PANE_DEFAULTS.ops + PANE_DEFAULTS.addOps,
    "--editor-min-width": PANE_MINS.editor,
    "--records-filters-padding": RECORDS_FILTERS_PADDING
  };
  for (const [name, value] of Object.entries(lengths)) root.style.setProperty(name, `${value}px`);
}
