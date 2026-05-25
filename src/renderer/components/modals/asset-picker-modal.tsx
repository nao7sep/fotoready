import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AssetRestoreResult, LutEntry, LutPreviewEntry, PreviewRenderOptions, StampEntry } from "@shared/types/ipc";
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
  restoreLabel: string;
  selectedPath: string;
  loading?: boolean;
  onClose(): void;
  onDelete(entry: T): Promise<void>;
  onImport(filePaths: string[]): Promise<Array<{ path: string }>>;
  onRefresh(): Promise<void>;
  onRestoreBuiltIns(): Promise<AssetRestoreResult>;
  onUse(entry: T | null): void | Promise<void>;
};

export function AssetPickerModal<T extends PickerEntry>({
  entries,
  extensions,
  importTitle,
  previewLongEdge,
  title,
  restoreLabel,
  selectedPath,
  loading = false,
  onClose,
  onDelete,
  onImport,
  onRefresh,
  onRestoreBuiltIns,
  onUse
}: AssetPickerModalProps<T>): React.JSX.Element {
  const confirmer = useConfirmer();
  const gridRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selectionPath, setSelectionPath] = useState(selectedPath);
  const [pendingReselectIndex, setPendingReselectIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  function pushError(message: string): void {
    setErrors((current) => [...current, message]);
  }

  function dismissError(index: number): void {
    setErrors((current) => current.filter((_, i) => i !== index));
  }
  const selectedIndex = entries.findIndex((entry) => entry.path === selectionPath);
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;

  function focusItem(path: string): void {
    requestAnimationFrame(() => {
      const button = itemRefs.current.get(path);
      if (button) button.focus();
      else gridRef.current?.focus();
    });
  }

  useEffect(() => {
    if (pendingReselectIndex !== null) {
      const target = entries.length === 0
        ? ""
        : entries[Math.min(pendingReselectIndex, entries.length - 1)].path;
      setSelectionPath(target);
      setPendingReselectIndex(null);
      if (target) focusItem(target);
      else gridRef.current?.focus();
      return;
    }
    if (!selectionPath || !entries.some((entry) => entry.path === selectionPath)) {
      const preferred = entries.find((entry) => entry.path === selectedPath) ?? entries[0] ?? null;
      const target = preferred?.path ?? "";
      setSelectionPath(target);
      if (target) focusItem(target);
    }
  }, [entries, selectedPath, selectionPath, pendingReselectIndex]);

  useEffect(() => {
    if (selectionPath) {
      focusItem(selectionPath);
    } else {
      gridRef.current?.focus();
    }
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
      const existingPaths = new Set(entries.map((entry) => entry.path));
      const imported = await onImport(filePaths);
      await onRefresh();
      if (imported[0]) setSelectionPath(imported[0].path);
      const dedupedNames = imported
        .filter((entry) => existingPaths.has(entry.path))
        .map((entry) => fileNameFromPath(entry.path));
      if (dedupedNames.length > 0) {
        const namesPreview = formatNamesList(dedupedNames);
        const fileWord = dedupedNames.length === 1 ? "file" : "files";
        const label = dedupedNames.length === imported.length
          ? `${dedupedNames.length} ${fileWord} matched existing library content and were not re-added: ${namesPreview}`
          : `${dedupedNames.length} of ${imported.length} ${fileWord} matched existing library content and were not re-added: ${namesPreview}`;
        setNotice(label);
      }
    } catch (importError) {
      pushError(errorMessage(importError));
    }
  }

  async function restoreBuiltIns(): Promise<void> {
    try {
      setNotice(null);
      const result = await onRestoreBuiltIns();
      await onRefresh();
      await confirmer.alert({
        title: restoreLabel,
        message: <RestoreResultMessage result={result} />
      });
    } catch (restoreError) {
      pushError(errorMessage(restoreError));
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedEntry || selectedEntry.builtin) return;
    const deletedIndex = selectedIndex;
    const deletedPath = selectedEntry.path;
    const confirmed = await confirmer.confirm({
      title: "Remove from library?",
      message: `Remove "${selectedEntry.name}" from the library? This deletes the copied asset file.`,
      confirmLabel: "Remove",
      danger: true
    });
    if (!confirmed) return;
    try {
      setNotice(null);
      await onDelete(selectedEntry);
      if (deletedPath === selectedPath) await onUse(null);
      await onRefresh();
      setPendingReselectIndex(deletedIndex);
    } catch (deleteError) {
      pushError(errorMessage(deleteError));
    }
  }

  function moveSelection(delta: number): void {
    if (entries.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.max(0, Math.min(entries.length - 1, start + delta));
    const nextPath = entries[nextIndex]?.path ?? "";
    setSelectionPath(nextPath);
    if (nextPath) focusItem(nextPath);
  }

  function visibleColumnCount(): number {
    const grid = gridRef.current;
    if (!grid) return 1;
    const columns = getComputedStyle(grid).gridTemplateColumns;
    if (!columns || columns === "none") return 1;
    return columns.split(" ").filter((part) => part.trim().length > 0).length;
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-visibleColumnCount());
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(visibleColumnCount());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void useSelected();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void deleteSelected();
    }
  }

  return (
    <ModalShell
      title={title}
      size="wide"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={importAssets}>Import...</button>
          <button className="toolbar-button" type="button" onClick={restoreBuiltIns}>Restore built-ins</button>
          <span className="top-bar-spacer" />
          <button
            className="toolbar-button"
            disabled={!selectedEntry || selectedEntry.builtin}
            title={selectedEntry?.builtin ? "Built-in items cannot be deleted." : "Remove selected item from the library"}
            type="button"
            onClick={() => void deleteSelected()}
          >
            Delete
          </button>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" disabled={!selectedEntry} type="button" onClick={() => void useSelected()}>Use selected</button>
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
          <div className="asset-picker-grid" ref={gridRef} tabIndex={0} onKeyDown={handleGridKeyDown}>
            {entries.length > 0 ? entries.map((entry) => (
              <button
                className={`asset-picker-item${entry.path === selectionPath ? " active" : ""}`}
                key={entry.path}
                ref={(element) => {
                  if (element) itemRefs.current.set(entry.path, element);
                  else itemRefs.current.delete(entry.path);
                }}
                tabIndex={entry.path === selectionPath ? 0 : -1}
                type="button"
                onClick={() => setSelectionPath(entry.path)}
                onDoubleClick={() => void useEntry(entry)}
              >
                <span className="asset-picker-preview">
                  {entry.previewDataUrl ? <img alt="" src={entry.previewDataUrl} /> : <span>No preview</span>}
                </span>
                <span className="asset-picker-name" title={entry.name}>{entry.name}</span>
                {entry.builtin ? <span className="asset-picker-badge">Built-in</span> : null}
              </button>
            )) : (
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

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function formatNamesList(names: string[], maxNames = 5): string {
  if (names.length <= maxNames) return names.join(", ");
  const preview = names.slice(0, maxNames).join(", ");
  const overflow = names.length - maxNames;
  return `${preview}, and ${overflow} more`;
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
    previewDataUrl: "dataUrl" in entry && typeof entry.dataUrl === "string" ? entry.dataUrl : undefined
  }));
  return (
    <AssetPickerModal
      entries={entries}
      extensions={["cube"]}
      importTitle="Import LUTs"
      loading={loading}
      previewLongEdge={previewLongEdge}
      restoreLabel="Restore built-in LUTs"
      selectedPath={selectedPath}
      title="Choose LUT"
      onClose={onClose}
      onDelete={(entry) => api.luts.delete(entry.path)}
      onImport={(filePaths) => api.luts.import(filePaths)}
      onRefresh={onReload}
      onRestoreBuiltIns={() => api.luts.restoreBuiltIns()}
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
    void Promise.all(stamps.map(async (stamp) => {
      try {
        const thumbnail = await api.assets.thumbnail(stamp.path, previewLongEdge);
        return [stamp.path, thumbnail.dataUrl] as const;
      } catch {
        return [stamp.path, ""] as const;
      }
    })).then((items) => {
      if (!cancelled) setPreviewMap(Object.fromEntries(items));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [previewLongEdge, stamps]);

  const entries = stamps.map((stamp) => ({
    ...stamp,
    previewDataUrl: previewMap[stamp.path]
  }));
  return (
    <AssetPickerModal
      entries={entries}
      extensions={["png", "svg"]}
      importTitle="Import stamps"
      loading={loading}
      previewLongEdge={previewLongEdge}
      restoreLabel="Restore built-in stamps"
      selectedPath={selectedPath}
      title="Choose stamp"
      onClose={onClose}
      onDelete={(entry) => api.stamps.delete(entry.path)}
      onImport={(filePaths) => api.stamps.import(filePaths)}
      onRefresh={onReload}
      onRestoreBuiltIns={() => api.stamps.restoreBuiltIns()}
      onUse={(entry) => onUse(entry?.path ?? "")}
    />
  );
}

function RestoreResultMessage({ result }: { result: AssetRestoreResult }): React.JSX.Element {
  return (
    <div className="restore-result">
      <p>Restored {result.restored.length} built-in item{result.restored.length === 1 ? "" : "s"}.</p>
      {result.skipped.length > 0 ? (
        <>
          <p>Skipped {result.skipped.length} item{result.skipped.length === 1 ? "" : "s"} that already exist in the library.</p>
          <code>{result.skipped.join(", ")}</code>
        </>
      ) : null}
    </div>
  );
}
