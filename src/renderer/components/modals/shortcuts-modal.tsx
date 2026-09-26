import React from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { ModalShell } from "./modal-shell";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { Translator } from "@shared/i18n/translate";

type ShortcutItem = {
  action: string;
  detail?: string;
  keys: string;
};

// Keys stay English whatever the interface language (keyboard-shortcut-conventions): they name the
// keycaps. The actions and details are interface text.
function buildSections(mod: string, t: Translator["t"]): ReadonlyArray<{ title: string; items: ReadonlyArray<ShortcutItem> }> {
  return [
    {
      title: t("shortcuts.section.importSave"),
      items: [
        { action: t("shortcuts.addOriginals"), detail: t("shortcuts.addOriginalsDetail"), keys: `${mod}+N` },
        { action: t("shortcuts.saveCurrent"), detail: t("shortcuts.saveCurrentDetail"), keys: `${mod}+S` },
        { action: t("shortcuts.saveAll"), detail: t("shortcuts.saveAllDetail"), keys: `${mod}+Shift+S` },
        { action: t("shortcuts.renameAll"), detail: t("shortcuts.renameAllDetail"), keys: `${mod}+R` }
      ]
    },
    {
      title: t("shortcuts.section.editing"),
      items: [
        { action: t("shortcuts.undo"), detail: t("shortcuts.undoDetail"), keys: `${mod}+Z` }
      ]
    },
    {
      title: t("shortcuts.section.view"),
      items: [
        { action: t("shortcuts.toggleHistogram"), keys: `${mod}+H` }
      ]
    },
    {
      title: t("shortcuts.section.app"),
      items: [
        { action: t("shortcuts.openSettings"), keys: `${mod}+Comma` },
        { action: t("shortcuts.showShortcuts"), keys: `${mod}+Slash` },
        { action: t("shortcuts.closeDialog"), keys: "Escape" }
      ]
    },
    {
      title: t("shortcuts.section.lists"),
      items: [
        { action: t("shortcuts.moveWithin"), detail: t("shortcuts.moveWithinDetail"), keys: "Arrow keys" },
        { action: t("shortcuts.jumpEnds"), detail: t("shortcuts.jumpEndsDetail"), keys: "Home / End" },
        { action: t("shortcuts.removeOriginal"), detail: t("shortcuts.removeOriginalDetail"), keys: "Delete / Backspace" },
        { action: t("shortcuts.openMenu"), detail: t("shortcuts.openMenuDetail"), keys: "Enter / Arrows / Escape" }
      ]
    },
    {
      title: t("shortcuts.section.assetPicker"),
      items: [
        { action: t("shortcuts.gridMove"), detail: t("shortcuts.gridMoveDetail", { selectAll: `${mod}+A` }), keys: "Arrow keys" },
        {
          action: t("shortcuts.gridExtend"),
          detail: t("shortcuts.gridExtendDetail", { extend: "Shift+Arrow", rangeClick: "Shift+Click", toggleClick: `${mod}+Click` }),
          keys: "Shift+Arrows"
        },
        { action: t("shortcuts.gridUse"), detail: t("shortcuts.gridUseDetail"), keys: "Enter / Space" },
        { action: t("shortcuts.gridRemove"), detail: t("shortcuts.gridRemoveDetail"), keys: "Delete / Backspace" }
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
  const { t } = useI18n();
  const mod = systemInfo && systemInfo.platform !== "darwin" ? "Ctrl" : "Cmd";
  const sections = buildSections(mod, t);
  const split = balancedSplit(sections.map(sectionWeight));
  const columns = [sections.slice(0, split), sections.slice(split)];
  return (
    <ModalShell
      title={t("menu.shortcuts")}
      size="wide"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>{t("common.close")}</button>}
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
