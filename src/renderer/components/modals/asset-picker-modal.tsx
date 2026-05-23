import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [selectionPath, setSelectionPath] = useState(selectedPath);
  const selectedIndex = entries.findIndex((entry) => entry.path === selectionPath);
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;

  useEffect(() => {
    const preferred = entries.find((entry) => entry.path === selectedPath) ?? entries[0] ?? null;
    if (!selectionPath || !entries.some((entry) => entry.path === selectionPath)) {
      setSelectionPath(preferred?.path ?? "");
    }
  }, [entries, selectedPath, selectionPath]);

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  async function useSelected(): Promise<void> {
    if (!selectedEntry) return;
    await useEntry(selectedEntry);
  }

  async function useEntry(entry: T): Promise<void> {
    await onUse(entry);
    onClose();
  }

  async function importAssets(): Promise<void> {
    const filePaths = await api.system.pickFiles({ title: importTitle, extensions });
    if (filePaths.length === 0) return;
    const imported = await onImport(filePaths);
    await onRefresh();
    if (imported[0]) setSelectionPath(imported[0].path);
  }

  async function restoreBuiltIns(): Promise<void> {
    const result = await onRestoreBuiltIns();
    await onRefresh();
    await confirmer.alert({
      title: restoreLabel,
      message: <RestoreResultMessage result={result} />
    });
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedEntry || selectedEntry.builtin) return;
    const confirmed = await confirmer.confirm({
      title: "Remove from library?",
      message: `Remove "${selectedEntry.name}" from the library? This deletes the copied asset file.`,
      confirmLabel: "Remove",
      danger: true
    });
    if (!confirmed) return;
    const deletedPath = selectedEntry.path;
    await onDelete(selectedEntry);
    if (deletedPath === selectedPath) await onUse(null);
    await onRefresh();
    const nextEntry = entries[selectedIndex + 1] ?? entries[selectedIndex - 1] ?? entries[0] ?? null;
    setSelectionPath(nextEntry?.path === deletedPath ? "" : nextEntry?.path ?? "");
  }

  function moveSelection(delta: number): void {
    if (entries.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.max(0, Math.min(entries.length - 1, start + delta));
    setSelectionPath(entries[nextIndex]?.path ?? "");
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
      moveSelection(-4);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(4);
    } else if (event.key === "Enter") {
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
        <div className="asset-picker-grid" ref={gridRef} tabIndex={0} onKeyDown={handleGridKeyDown}>
          {entries.length > 0 ? entries.map((entry) => (
            <button
              className={`asset-picker-item${entry.path === selectionPath ? " active" : ""}`}
              key={entry.path}
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
    </ModalShell>
  );
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
    void api.luts.preview(taskId, previewOptions, strength)
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
  useEffect(() => {
    let cancelled = false;
    void Promise.all(stamps.map(async (stamp) => {
      try {
        const thumbnail = await api.assets.thumbnail(stamp.path, previewLongEdge);
        return [stamp.path, thumbnail.dataUrl] as const;
      } catch {
        return [stamp.path, ""] as const;
      }
    })).then((items) => {
      if (!cancelled) setPreviewMap(Object.fromEntries(items));
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
          <p>Skipped {result.skipped.length} item{result.skipped.length === 1 ? "" : "s"} because the filename already exists.</p>
          <code>{result.skipped.join(", ")}</code>
        </>
      ) : null}
    </div>
  );
}
