import React from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { ModalShell } from "./modal-shell";

type ShortcutItem = {
  action: string;
  detail?: string;
  keys: string;
};

function buildSections(mod: string): ReadonlyArray<{ title: string; items: ReadonlyArray<ShortcutItem> }> {
  return [
    {
      title: "Import and save",
      items: [
        { action: "Add originals", detail: "Open the file picker to import source images or sidecars.", keys: `${mod}+N` },
        { action: "Save current not-saved image", detail: "Apply the current task's ops, queue saving, and write the output image plus sidecar.", keys: `${mod}+S` },
        { action: "Save all not-saved images", detail: "Queue every not-saved task for saving.", keys: `${mod}+Shift+S` },
        { action: "Rename all", detail: "Review saved and unsaved tasks before renaming saved outputs.", keys: `${mod}+R` }
      ]
    },
    {
      title: "Editing",
      items: [
        { action: "Undo last not-saved edit", detail: "Revert the most recent task edit when focus is outside a text field. Inside a text field, the shortcut uses native text undo.", keys: `${mod}+Z` }
      ]
    },
    {
      title: "View",
      items: [
        { action: "Toggle histogram", keys: `${mod}+H` }
      ]
    },
    // App sits ahead of the two navigation groups so the columns divide by kind:
    // what you command the app to do on the left, how you move inside its lists and
    // grids on the right. It also balances them — the alternative left one column
    // half the height of the other.
    {
      title: "App",
      items: [
        { action: "Open settings", keys: `${mod}+Comma` },
        { action: "Show keyboard shortcuts", keys: `${mod}+Slash` },
        { action: "Close the active dialog", keys: "Escape" }
      ]
    },
    {
      title: "Lists and controls",
      items: [
        { action: "Move within a list or control", detail: "Each list and control is one tab stop: Tab in, then the arrow keys move within it.", keys: "Arrow keys" },
        { action: "Jump to the first / last item", detail: "Within the focused list or control.", keys: "Home / End" },
        { action: "Remove the selected original", detail: "Deletes the highlighted original from the Originals list.", keys: "Delete / Backspace" },
        { action: "Open a menu, then move between items", detail: "Enter or Space opens the menu; the arrows move between commands and Escape closes it.", keys: "Enter / Arrows / Escape" }
      ]
    },
    {
      title: "Asset picker (LUTs & stamps)",
      items: [
        { action: "Move and select in the grid", detail: `The picker is a multi-select grid: the arrow keys move and select; ${mod}+A selects all.`, keys: "Arrow keys" },
        { action: "Extend the selection", detail: `Shift+Arrow grows a range from the anchor; Shift+Click ranges and ${mod}+Click toggles one item.`, keys: "Shift+Arrows" },
        { action: "Use the selected item", detail: "Applies the one selected LUT or stamp and closes the picker.", keys: "Enter / Space" },
        { action: "Remove from library", detail: "Moves the selected imported files to the system trash. Built-in items are protected.", keys: "Delete / Backspace" }
      ]
    }
  ];
}

/**
 * How much vertical room a section will want, measured in characters of prose. Every row here
 * carries an explanatory sentence, and those sentences differ in length by a factor of ten, so
 * counting rows — the way a uniform shortcut table would — picks the wrong place to divide.
 */
function sectionWeight(section: { title: string; items: ReadonlyArray<ShortcutItem> }): number {
  return section.items.reduce((total, { action, detail }) => total + action.length + (detail?.length ?? 0), 0);
}

/**
 * Where the section list divides into two columns, keeping the sections in order: the split that
 * leaves the heavier column lightest, earlier on a tie so the left column is the longer.
 */
export function balancedSplit(weights: ReadonlyArray<number>): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let best = 0;
  let bestHeavier = Infinity;
  let left = 0;
  for (let split = 0; split <= weights.length; split++) {
    const heavier = Math.max(left, total - left);
    if (heavier < bestHeavier) {
      best = split;
      bestHeavier = heavier;
    }
    if (split < weights.length) left += weights[split];
  }
  return best;
}

interface Props {
  systemInfo: SystemInfo | null;
  onClose(): void;
}

export function ShortcutsModal({ systemInfo, onClose }: Props): React.JSX.Element {
  // Convention is Cmd-first / Mac-first: default to "Cmd" until the platform is
  // known, switching to "Ctrl" only once we positively detect a non-macOS host.
  const mod = systemInfo && systemInfo.platform !== "darwin" ? "Ctrl" : "Cmd";
  const sections = buildSections(mod);
  const split = balancedSplit(sections.map(sectionWeight));
  const columns = [sections.slice(0, split), sections.slice(split)];
  return (
    <ModalShell
      title="Keyboard shortcuts"
      size="wide"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>Close</button>}
    >
      <div className="shortcut-list">
        {columns.map((column, index) => (
          <div className="shortcut-column" key={index}>
            {column.map(({ title, items }) => (
              <section className="shortcut-group" key={title}>
                <h3>{title}</h3>
                {items.map(({ action, detail, keys }) => (
                  <div className="shortcut-row" key={action}>
                    <div className="shortcut-row-copy">
                      <span>{action}</span>
                      {detail ? <small>{detail}</small> : null}
                    </div>
                    <kbd>{keys}</kbd>
                  </div>
                ))}
              </section>
            ))}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
