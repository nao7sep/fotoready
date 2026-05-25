import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { fileNameFromPath } from "@shared/file-path";
import type {
  AssetImportResult,
  LutEntry,
  LutPreviewEntry,
  PreviewRenderOptions,
  StampEntry
} from "@shared/types/ipc";
import { api } from "@renderer/ipc/client";
import { useConfirmer } from "./confirmer";
import { ModalShell } from "./modal-shell";

type PickerEntry = {
  builtin: boolean;
  name: string;
  path: string;
  previewDataUrl?: string;
};

type AssetPickerModalProps<T extends PickerEntry> = {
  entries: T[];
  extensions: string[];
  importTitle: string;
  previewLongEdge: number;
  title: string;
  selectedPath: string;
  loading?: boolean;
  onClose(): void;
  onDelete(entries: T[]): Promise<void>;
  onImport(filePaths: string[]): Promise<AssetImportResult[]>;
  onRefresh(): Promise<void>;
  onUse(entry: T | null): void | Promise<void>;
};

export function AssetPickerModal<T extends PickerEntry>({
  entries,
  extensions,
  importTitle,
  previewLongEdge,
  title,
  selectedPath,
  loading = false,
  onClose,
  onDelete,
  onImport,
  onRefresh,
  onUse
}: AssetPickerModalProps<T>): React.JSX.Element {
  const confirmer = useConfirmer();
  const gridRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selectedPaths, setSelectedPaths] = useState<string[]>(selectedPath ? [selectedPath] : []);
  const [focusPath, setFocusPath] = useState(selectedPath);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState(selectedPath);
  const [pendingReselectIndex, setPendingReselectIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const entryIndexByPath = useMemo(
    () => new Map(entries.map((entry, index) => [entry.path, index])),
    [entries]
  );
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPathSet.has(entry.path)),
    [entries, selectedPathSet]
  );
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const focusedIndex = focusPath ? entryIndexByPath.get(focusPath) ?? -1 : -1;
  const canDeleteSelected = selectedEntries.length > 0 && selectedEntries.every((entry) => !entry.builtin);

  function pushError(message: string): void {
    setErrors((current) => [...current, message]);
  }

  function dismissError(index: number): void {
    setErrors((current) => current.filter((_, i) => i !== index));
  }

  function focusItem(path: string): void {
    requestAnimationFrame(() => {
      const button = itemRefs.current.get(path);
      if (button) button.focus();
      else gridRef.current?.focus();
    });
  }

  function setSingleSelection(path: string): void {
    const nextSelectedPaths = path ? [path] : [];
    setSelectedPaths(nextSelectedPaths);
    setFocusPath(path);
    setSelectionAnchorPath(path);
  }

  useEffect(() => {
    if (pendingReselectIndex !== null) {
      const target = entries.length === 0
        ? ""
        : entries[Math.min(pendingReselectIndex, entries.length - 1)].path;
      setSingleSelection(target);
      setPendingReselectIndex(null);
      if (target) focusItem(target);
      else gridRef.current?.focus();
      return;
    }

    const validSelectedPaths = orderedPaths(entries, selectedPaths.filter((path) => entryIndexByPath.has(path)));
    const fallbackPath = selectedPath && entryIndexByPath.has(selectedPath)
      ? selectedPath
      : entries[0]?.path ?? "";
    const nextSelectedPaths = validSelectedPaths.length > 0
      ? validSelectedPaths
      : (fallbackPath ? [fallbackPath] : []);
    const nextFocusPath = focusPath && entryIndexByPath.has(focusPath)
      ? focusPath
      : nextSelectedPaths[0] ?? "";
    const nextAnchorPath = selectionAnchorPath && entryIndexByPath.has(selectionAnchorPath)
      ? selectionAnchorPath
      : nextSelectedPaths[0] ?? nextFocusPath;

    if (!samePaths(selectedPaths, nextSelectedPaths)) {
      setSelectedPaths(nextSelectedPaths);
    }
    if (focusPath !== nextFocusPath) {
      setFocusPath(nextFocusPath);
      if (nextFocusPath) focusItem(nextFocusPath);
    }
    if (selectionAnchorPath !== nextAnchorPath) {
      setSelectionAnchorPath(nextAnchorPath);
    }
  }, [entries, selectedPath, selectedPaths, focusPath, selectionAnchorPath, entryIndexByPath, pendingReselectIndex]);

  useEffect(() => {
    const initialPath = selectedPath || (entries[0]?.path ?? "");
    if (initialPath) focusItem(initialPath);
    else gridRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function useSelected(): Promise<void> {
    if (!selectedEntry) return;
    await useEntry(selectedEntry);
  }

  async function useEntry(entry: T): Promise<void> {
    try {
      setNotice(null);
      await onUse(entry);
      onClose();
    } catch (entryError) {
      pushError(errorMessage(entryError));
    }
  }

  async function importAssets(): Promise<void> {
    try {
      setNotice(null);
      const filePaths = await api.system.pickFiles({ title: importTitle, extensions });
      if (filePaths.length === 0) return;

      const imported = await onImport(filePaths);
      await onRefresh();

      const importedEntries = imported.filter((entry) => entry.status === "imported");
      const skippedEntries = imported.filter((entry) => entry.status === "skipped-name-conflict");
      const preferredPath = importedEntries[0]?.path ?? skippedEntries[0]?.path ?? "";
      if (preferredPath) {
        setSingleSelection(preferredPath);
        focusItem(preferredPath);
      }
      if (skippedEntries.length > 0) {
        const namesPreview = formatNamesList(skippedEntries.map((entry) => entry.fileName));
        const fileWord = skippedEntries.length === 1 ? "file" : "files";
        const label = skippedEntries.length === imported.length
          ? `${skippedEntries.length} ${fileWord} already match a library file name and were not imported: ${namesPreview}`
          : `${skippedEntries.length} of ${imported.length} ${fileWord} already match a library file name and were not imported: ${namesPreview}`;
        setNotice(label);
      }
    } catch (importError) {
      pushError(errorMessage(importError));
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!canDeleteSelected) return;
    const deletedEntries = selectedEntries;
    const deletedIndex = deletedEntries
      .map((entry) => entryIndexByPath.get(entry.path) ?? Number.POSITIVE_INFINITY)
      .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);
    const deletedPaths = new Set(deletedEntries.map((entry) => entry.path));
    const confirmed = await confirmer.confirm({
      title: "Remove from library?",
      message: deletedEntries.length === 1
        ? `Remove "${deletedEntries[0].name}" from the library? This deletes the imported asset file.`
        : (
          <AssetFileListMessage
            intro={`Remove these ${deletedEntries.length} items from the library? This deletes the imported asset files.`}
            names={deletedEntries.map((entry) => entry.name)}
          />
        ),
      confirmLabel: "Remove",
      danger: true
    });
    if (!confirmed) return;
    try {
      setNotice(null);
      await onDelete(deletedEntries);
      if (selectedPath && deletedPaths.has(selectedPath)) {
        await onUse(null);
      }
      await onRefresh();
      setPendingReselectIndex(Number.isFinite(deletedIndex) ? deletedIndex : 0);
    } catch (deleteError) {
      pushError(errorMessage(deleteError));
    }
  }

  function moveFocus(delta: number, options?: { extendSelection?: boolean; preserveSelection?: boolean }): void {
    if (entries.length === 0) return;
    const start = focusedIndex >= 0
      ? focusedIndex
      : (selectedEntries[0] ? entryIndexByPath.get(selectedEntries[0].path) ?? 0 : 0);
    const nextIndex = Math.max(0, Math.min(entries.length - 1, start + delta));
    const nextPath = entries[nextIndex]?.path ?? "";
    if (!nextPath) return;

    if (options?.extendSelection) {
      const anchor = selectionAnchorPath && entryIndexByPath.has(selectionAnchorPath)
        ? selectionAnchorPath
        : focusPath || nextPath;
      setSelectedPaths(rangePaths(entries, anchor, nextPath));
      setSelectionAnchorPath(anchor);
    } else if (!options?.preserveSelection) {
      setSelectedPaths([nextPath]);
      setSelectionAnchorPath(nextPath);
    }

    setFocusPath(nextPath);
    focusItem(nextPath);
  }

  function visibleColumnCount(): number {
    const grid = gridRef.current;
    if (!grid) return 1;
    const columns = getComputedStyle(grid).gridTemplateColumns;
    if (!columns || columns === "none") return 1;
    return columns.split(" ").filter((part) => part.trim().length > 0).length;
  }

  function selectAll(): void {
    if (entries.length === 0) return;
    setSelectedPaths(entries.map((entry) => entry.path));
    const anchor = focusPath || entries[0].path;
    setFocusPath(anchor);
    setSelectionAnchorPath(anchor);
    focusItem(anchor);
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAll();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(-1, { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(1, { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-visibleColumnCount(), { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(visibleColumnCount(), { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void useSelected();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void deleteSelected();
    }
  }

  function handleItemClick(path: string, event: React.MouseEvent<HTMLButtonElement>): void {
    if (event.shiftKey) {
      const anchor = selectionAnchorPath && entryIndexByPath.has(selectionAnchorPath)
        ? selectionAnchorPath
        : focusPath || path;
      setSelectedPaths(rangePaths(entries, anchor, path));
      setSelectionAnchorPath(anchor);
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedPaths((current) => {
        const next = current.includes(path)
          ? current.filter((entryPath) => entryPath !== path)
          : [...current, path];
        return orderedPaths(entries, next);
      });
      setSelectionAnchorPath(path);
    } else {
      setSelectedPaths([path]);
      setSelectionAnchorPath(path);
    }
    setFocusPath(path);
  }

  const deleteTitle = selectedEntries.length === 0
    ? "Select one or more items to delete."
    : !canDeleteSelected
      ? "Built-in items cannot be deleted."
      : `Remove ${selectedEntries.length === 1 ? "the selected item" : "the selected items"} from the library`;
  const useTitle = selectedEntry
    ? "Use the selected item"
    : selectedEntries.length === 0
      ? "Select one item to use."
      : "Select exactly one item to use.";

  return (
    <ModalShell
      title={title}
      size="wide"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={importAssets}>Import...</button>
          <span className="top-bar-spacer" />
          <button
            className="toolbar-button"
            disabled={!canDeleteSelected}
            title={deleteTitle}
            type="button"
            onClick={() => void deleteSelected()}
          >
            Delete
          </button>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary-action"
            disabled={!selectedEntry}
            title={useTitle}
            type="button"
            onClick={() => void useSelected()}
          >
            Use selected
          </button>
        </>
      }
    >
      <div className="asset-picker" style={{ "--asset-picker-preview-size": `${previewLongEdge}px` } as React.CSSProperties}>
        {loading ? <div className="modal-warning">Preparing previews...</div> : null}
        {notice ? <div className="modal-warning">{notice}</div> : null}
        {errors.map((message, index) => (
          <div className="modal-error dismissable" key={index}>
            <span>{message}</span>
            <button className="icon-button compact" type="button" aria-label="Dismiss" title="Dismiss" onClick={() => dismissError(index)}>
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="asset-picker-scroll">
          <div
            aria-multiselectable
            className="asset-picker-grid"
            ref={gridRef}
            role="listbox"
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
          >
            {entries.length > 0 ? entries.map((entry) => {
              const isSelected = selectedPathSet.has(entry.path);
              const isFocused = entry.path === focusPath;
              return (
                <button
                  aria-selected={isSelected}
                  className={`asset-picker-item${isSelected ? " selected" : ""}${isFocused ? " focused" : ""}`}
                  key={entry.path}
                  ref={(element) => {
                    if (element) itemRefs.current.set(entry.path, element);
                    else itemRefs.current.delete(entry.path);
                  }}
                  role="option"
                  tabIndex={isFocused ? 0 : -1}
                  type="button"
                  onClick={(event) => handleItemClick(entry.path, event)}
                  onDoubleClick={() => {
                    setSingleSelection(entry.path);
                    void useEntry(entry);
                  }}
                  onFocus={() => setFocusPath(entry.path)}
                >
                  <span className="asset-picker-preview">
                    {entry.previewDataUrl ? <img alt="" src={entry.previewDataUrl} /> : <span>No preview</span>}
                  </span>
                  <span className="asset-picker-name" title={entry.name}>{entry.name}</span>
                  {entry.builtin ? <span className="asset-picker-badge">Built-in</span> : null}
                </button>
              );
            }) : (
              <div className="ops-empty">No items in this library</div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatNamesList(names: string[], maxNames = 5): string {
  if (names.length <= maxNames) return names.join(", ");
  const preview = names.slice(0, maxNames).join(", ");
  const overflow = names.length - maxNames;
  return `${preview}, and ${overflow} more`;
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function orderedPaths<T extends PickerEntry>(entries: readonly T[], paths: readonly string[]): string[] {
  const pathSet = new Set(paths);
  return entries.filter((entry) => pathSet.has(entry.path)).map((entry) => entry.path);
}

function rangePaths<T extends PickerEntry>(entries: readonly T[], anchorPath: string, targetPath: string): string[] {
  const anchorIndex = entries.findIndex((entry) => entry.path === anchorPath);
  const targetIndex = entries.findIndex((entry) => entry.path === targetPath);
  if (anchorIndex < 0 || targetIndex < 0) return targetPath ? [targetPath] : [];
  const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return entries.slice(start, end + 1).map((entry) => entry.path);
}

export function LutPickerModal({
  luts,
  previewLongEdge,
  selectedPath,
  strength,
  taskId,
  targetOpId,
  onClose,
  onReload,
  onUse
}: {
  luts: LutEntry[];
  previewLongEdge: number;
  selectedPath: string;
  strength: number;
  taskId: string | null;
  targetOpId: string | null;
  onClose(): void;
  onReload(): Promise<void>;
  onUse(path: string): void;
}): React.JSX.Element {
  const [previews, setPreviews] = useState<LutPreviewEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const previewOptions = useMemo<PreviewRenderOptions | undefined>(
    () => targetOpId ? { targetOpId, mode: "input" } : undefined,
    [targetOpId]
  );
  useEffect(() => {
    let cancelled = false;
    if (!taskId || luts.length === 0) {
      setPreviews([]);
      return;
    }
    setLoading(true);
    void api.luts.preview(taskId, previewOptions, strength, previewLongEdge)
      .then((items) => {
        if (!cancelled) setPreviews(items);
      })
      .catch(() => {
        if (!cancelled) setPreviews([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [luts, previewLongEdge, previewOptions, strength, taskId]);

  const entries: PickerEntry[] = (previews.length > 0 ? previews : luts).map((entry) => ({
    ...entry,
    name: entry.name || fileNameFromPath(entry.path),
    previewDataUrl: "dataUrl" in entry && typeof entry.dataUrl === "string" ? entry.dataUrl : undefined
  }));
  return (
    <AssetPickerModal
      entries={entries}
      extensions={["cube"]}
      importTitle="Import LUTs"
      loading={loading}
      previewLongEdge={previewLongEdge}
      selectedPath={selectedPath}
      title="Choose LUT"
      onClose={onClose}
      onDelete={(entriesToDelete) => api.luts.delete(entriesToDelete.map((entry) => entry.path))}
      onImport={(filePaths) => api.luts.import(filePaths)}
      onRefresh={onReload}
      onUse={(entry) => onUse(entry?.path ?? "")}
    />
  );
}

export function StampPickerModal({
  selectedPath,
  previewLongEdge,
  stamps,
  onClose,
  onReload,
  onUse
}: {
  selectedPath: string;
  previewLongEdge: number;
  stamps: StampEntry[];
  onClose(): void;
  onReload(): Promise<void>;
  onUse(path: string): void | Promise<void>;
}): React.JSX.Element {
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (stamps.length === 0) {
      setPreviewMap({});
      return;
    }
    setLoading(true);
    setPreviewMap({});
    void runWithConcurrency(stamps, 6, async (stamp) => {
      if (cancelled) return;
      try {
        const thumbnail = await api.assets.thumbnail(stamp.path, previewLongEdge);
        if (!cancelled) {
          setPreviewMap((current) => ({ ...current, [stamp.path]: thumbnail.dataUrl }));
        }
      } catch (thumbnailError) {
        console.warn("Failed to load stamp thumbnail", stamp.path, thumbnailError);
        if (!cancelled) {
          setPreviewMap((current) => ({ ...current, [stamp.path]: "" }));
        }
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [previewLongEdge, stamps]);

  const entries = stamps.map((stamp) => ({
    ...stamp,
    name: stamp.name || fileNameFromPath(stamp.path),
    previewDataUrl: previewMap[stamp.path]
  }));
  return (
    <AssetPickerModal
      entries={entries}
      extensions={["png", "svg"]}
      importTitle="Import stamps"
      loading={loading}
      previewLongEdge={previewLongEdge}
      selectedPath={selectedPath}
      title="Choose stamp"
      onClose={onClose}
      onDelete={(entriesToDelete) => api.stamps.delete(entriesToDelete.map((entry) => entry.path))}
      onImport={(filePaths) => api.stamps.import(filePaths)}
      onRefresh={onReload}
      onUse={(entry) => onUse(entry?.path ?? "")}
    />
  );
}

function AssetFileListMessage({
  intro,
  names
}: {
  intro: string;
  names: string[];
}): React.JSX.Element {
  return (
    <div className="asset-file-list-message">
      <p>{intro}</p>
      <AssetFileNameList names={names} />
    </div>
  );
}

function AssetFileNameList({ names }: { names: string[] }): React.JSX.Element {
  return (
    <ul className="asset-file-name-list">
      {names.map((name) => <li key={name}>{name}</li>)}
    </ul>
  );
}

async function runWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
