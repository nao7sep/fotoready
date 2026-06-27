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
        { action: "Toggle histogram", detail: "Show or hide the preview histogram. Its position is remembered across sessions.", keys: `${mod}+H` }
      ]
    },
    {
      title: "Lists and controls",
      items: [
        { action: "Move within a list or control", detail: "Each list (Originals, Tasks), segmented control, swatch group, settings tab strip, and the resize-preset toolbar is one tab stop: Tab in, then the arrow keys move within it; the selection follows in lists, tabs, and groups, while in the preset toolbar they move focus and Enter applies.", keys: "Arrow keys" },
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
    },
    {
      title: "App",
      items: [
        { action: "Open settings", keys: `${mod}+Comma` },
        { action: "Show keyboard shortcuts", keys: `${mod}+Slash` },
        { action: "Close the active dialog", keys: "Escape" }
      ]
    }
  ];
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
  return (
    <ModalShell
      title="Keyboard shortcuts"
      size="small"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>Close</button>}
    >
      <div className="shortcut-list">
        {sections.map(({ title, items }) => (
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
    </ModalShell>
  );
}
