import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { currentCompositeIndex, nextIndex } from "@renderer/components/composite-nav";

/**
 * The app's in-app listbox layer for the single-select master panels (Originals,
 * Tasks). Returns props to spread onto the existing list container and each row's
 * focusable element, so adopting it changes the keyboard/ARIA behavior without
 * restructuring the rows.
 *
 * One tab stop (roving tabindex on the options); Up/Down move the selection and
 * focus (selection follows focus — the panels' clicks already select on the same
 * cost), Home/End jump to the ends (stopping there), and Delete/Backspace removes
 * the focused row when an `onRemove` is given. Mirrors the asset-picker grid's
 * roving-tabindex model in a vertical, single-select form.
 *
 * `activeId` is the roving tab stop. It leads `selectedId` during fast keyboard
 * navigation (selection round-trips through IPC) and is reconciled back to the
 * selection once it lands. After a removal, focus simply follows wherever the
 * session re-pointed the selection — the listbox never invents its own target, so
 * focus and the `aria-selected`/highlighted row can never disagree.
 */
export function useListbox(params: {
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const { ids, selectedId, onSelect, onRemove } = params;
  const ref = useRef<HTMLDivElement>(null);
  const selectedInList = selectedId && ids.includes(selectedId) ? selectedId : null;
  const activeIdRef = useRef<string | null>(selectedInList ?? ids[0] ?? null);
  const [activeId, setActiveIdState] = useState<string | null>(activeIdRef.current);
  const refocusAfterRemovalRef = useRef(false);
  // Effects key on this string, not the `ids` array, whose identity changes every
  // parent render (the panels pass a fresh `.map(...)`); this keeps them from
  // re-running on unrelated renders.
  const idsKey = ids.join("\0");

  // The single tab stop: the active row when it's still present, else the selected
  // row, else the first, so the list is always Tab-reachable when it has rows.
  const tabbableId = activeId && ids.includes(activeId) ? activeId : selectedInList ?? ids[0] ?? null;

  const setActiveId = (id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  };

  const focusOption = (id: string) => {
    (
      ref.current?.querySelector(
        `[data-listbox-option="${CSS.escape(id)}"]`,
      ) as HTMLElement | null
    )?.focus();
  };

  // Keep the roving active row valid and following the selection; after a keyboard
  // removal, return focus to whichever row the session selected in place of the
  // removed one (focus follows selection, so the two never diverge).
  useEffect(() => {
    const desired = selectedInList ?? ids[0] ?? null;
    if (!activeIdRef.current || !ids.includes(activeIdRef.current)) {
      setActiveId(desired);
    } else if (selectedInList && selectedInList !== activeIdRef.current) {
      setActiveId(selectedInList);
    }
    if (refocusAfterRemovalRef.current) {
      refocusAfterRemovalRef.current = false;
      const target = activeIdRef.current ?? desired;
      if (target) focusOption(target);
    }
  }, [idsKey, selectedInList]);

  const focusedId = (): string | null => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? active.dataset.listboxOption ?? null : null;
  };

  const selectAt = (index: number) => {
    const id = ids[index];
    if (id === undefined) return;
    setActiveId(id);
    focusOption(id);
    onSelect(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (ids.length === 0) return;
    const current = currentCompositeIndex({
      ids,
      focusedId: focusedId(),
      activeId: activeIdRef.current,
      selectedId,
    });
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
    } else if ((e.key === "Delete" || e.key === "Backspace") && onRemove) {
      const targetId = focusedId() ?? activeIdRef.current ?? selectedId;
      if (!targetId || !ids.includes(targetId)) return;
      e.preventDefault();
      refocusAfterRemovalRef.current = true;
      onRemove(targetId);
    }
  };

  return {
    listboxProps: { ref, role: "listbox" as const, onKeyDown },
    getOptionProps: (id: string) => ({
      role: "option" as const,
      "aria-selected": id === selectedId,
      tabIndex: id === tabbableId ? 0 : -1,
      "data-listbox-option": id,
      onFocus: () => setActiveId(id),
    }),
  };
}
