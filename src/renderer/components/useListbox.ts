import { useRef, type KeyboardEvent } from "react";
import { nextIndex } from "@renderer/components/composite-nav";

/**
 * The app's in-app listbox layer for the single-select master panels (Originals,
 * Tasks). Returns props to spread onto the existing list container and each row's
 * focusable element, so adopting it changes the keyboard/ARIA behavior without
 * restructuring the rows.
 *
 * One tab stop (roving tabindex on the options); Up/Down move the selection and
 * focus (selection follows focus — the panels' clicks already select on the same
 * cost), Home/End jump to the ends (stopping there), and Delete/Backspace removes
 * the selected row when an `onRemove` is given. Mirrors the asset-picker grid's
 * roving-tabindex model in a vertical, single-select form.
 */
export function useListbox(params: {
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const { ids, selectedId, onSelect, onRemove } = params;
  const ref = useRef<HTMLDivElement>(null);

  // The single tab stop: the selected option, or the first when nothing in the
  // list is selected, so the list is always Tab-reachable when it has rows.
  const tabbableId =
    selectedId && ids.includes(selectedId) ? selectedId : ids[0] ?? null;

  const focusOption = (id: string) => {
    (
      ref.current?.querySelector(
        `[data-listbox-option="${CSS.escape(id)}"]`,
      ) as HTMLElement | null
    )?.focus();
  };

  const selectAt = (index: number) => {
    const id = ids[index];
    if (id === undefined) return;
    onSelect(id);
    focusOption(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (ids.length === 0) return;
    const current = selectedId ? ids.indexOf(selectedId) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectAt(nextIndex("next", current, ids.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectAt(nextIndex("prev", current, ids.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      selectAt(nextIndex("first", current, ids.length));
    } else if (e.key === "End") {
      e.preventDefault();
      selectAt(nextIndex("last", current, ids.length));
    } else if ((e.key === "Delete" || e.key === "Backspace") && onRemove && selectedId) {
      e.preventDefault();
      onRemove(selectedId);
    }
  };

  return {
    listboxProps: { ref, role: "listbox" as const, onKeyDown },
    getOptionProps: (id: string) => ({
      role: "option" as const,
      "aria-selected": id === selectedId,
      tabIndex: id === tabbableId ? 0 : -1,
      "data-listbox-option": id,
    }),
  };
}
