import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { fileNameFromPath } from "@shared/file-path";
import type {
  AssetImportResult,
  LutEntry,
  LutPreviewEntry,
  PreviewRenderOptions,
  StampEntry
} from "@shared/types/ipc";
import { STAMP_GROUP_FILTERS, type StampGroupFilterId } from "@shared/stamp-groups";
import { api } from "@renderer/ipc/client";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { filterStampsByGroup, initialStampGroupFilter } from "@renderer/stamp-filter";
import { useImeGuard } from "@renderer/utils/ime-guard";
import { useConfirmer } from "./confirmer";
import { ModalShell } from "./modal-shell";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { MessageKey } from "@shared/i18n/catalogues";
import { message, type Message, type Translator } from "@shared/i18n/translate";

type PickerEntry = {
  builtin: boolean;
  name: string;
  path: string;
  previewDataUrl?: string;
};

type PickerOperation = "delete" | "import" | "use";

const pickerOperations: readonly PickerOperation[] = ["use", "import", "delete"];

const OPERATION_DISMISS_LABELS: Record<PickerOperation, MessageKey> = {
  use: "assets.closeUseResult",
  import: "assets.closeImportResult",
  delete: "assets.closeDeleteResult"
};

const STAMP_GROUP_LABELS: Record<StampGroupFilterId, MessageKey> = {
  all: "stamps.group.all",
  cover: "stamps.group.cover",
  marks: "stamps.group.marks",
  bubbles: "stamps.group.bubbles",
  reactions: "stamps.group.reactions",
  funny: "stamps.group.funny",
  cute: "stamps.group.cute",
  stories: "stamps.group.stories",
  seasonal: "stamps.group.seasonal",
  imported: "stamps.group.imported"
};

type AssetPickerModalProps<T extends PickerEntry> = {
  entries: T[];
  extensions: string[];
  importTitle: string;
  previewLongEdge: number;
  title: string;
  selectedPath: string;
  loading?: boolean;
  controls?: React.ReactNode;
  contentId?: string;
  contentLabelledBy?: string;
  emptyMessage?: string;
  onClose(): void;
  onDelete(entries: T[]): Promise<void>;
  onImport(filePaths: string[]): Promise<AssetImportResult[]>;
  onImportComplete?(results: AssetImportResult[]): void;
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
  controls,
  contentId,
  contentLabelledBy,
  emptyMessage,
  onClose,
  onDelete,
  onImport,
  onImportComplete,
  onRefresh,
  onUse
}: AssetPickerModalProps<T>): React.JSX.Element {
  const { t, text, list } = useI18n();
  const confirmer = useConfirmer();
  const ime = useImeGuard();
  const gridRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selectedPaths, setSelectedPaths] = useState<string[]>(selectedPath ? [selectedPath] : []);
  const [focusPath, setFocusPath] = useState(selectedPath);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState(selectedPath);
  const [pendingReselectIndex, setPendingReselectIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PickerOperation, Message>>>({});
  const [notice, setNotice] = useState<Message | null>(null);

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

  function setOperationError(operation: PickerOperation, failure: Message | null): void {
    setErrors((current) => {
      if (failure) return { ...current, [operation]: failure };
      if (!current[operation]) return current;
      const next = { ...current };
      delete next[operation];
      return next;
    });
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
      setOperationError("use", null);
      onClose();
    } catch (entryError) {
      setOperationError("use", presentFailure(entryError, message("failure.assetUse"), "renderer asset use failed"));
    }
  }

  async function importAssets(): Promise<void> {
    try {
      setNotice(null);
      const filePaths = await api.system.pickFiles({ title: importTitle, extensions });
      if (filePaths.length === 0) return;

      const imported = await onImport(filePaths);
      await onRefresh();
      setOperationError("import", null);
      onImportComplete?.(imported);

      const importedEntries = imported.filter((entry) => entry.status === "imported");
      const skippedEntries = imported.filter((entry) => entry.status === "skipped-name-conflict");
      const preferredPath = importedEntries[0]?.path ?? skippedEntries[0]?.path ?? "";
      if (preferredPath) {
        setSingleSelection(preferredPath);
        focusItem(preferredPath);
      }
      if (skippedEntries.length > 0) {
        const names = skippedEntries.map((entry) => entry.fileName);
        setNotice(skippedEntries.length === imported.length
          ? message("assets.skippedAll", { count: skippedEntries.length, names: namesPreview(names, t, list) })
          : message("assets.skippedSome", { count: skippedEntries.length, total: imported.length, names: namesPreview(names, t, list) }));
      }
    } catch (importError) {
      setOperationError("import", presentFailure(importError, message("failure.assetImport"), "renderer asset import failed"));
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
      title: t("assets.removeTitle"),
      message: deletedEntries.length === 1
        ? t("assets.removeOne", { name: deletedEntries[0].name })
        : (
          <AssetFileListMessage
            intro={t("assets.removeMany", { count: deletedEntries.length })}
            names={deletedEntries.map((entry) => entry.name)}
          />
        ),
      confirmLabel: t("common.moveToTrash"),
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
      setOperationError("delete", null);
      setPendingReselectIndex(Number.isFinite(deletedIndex) ? deletedIndex : 0);
    } catch (deleteError) {
      let refreshed = true;
      try {
        await onRefresh();
      } catch (refreshError) {
        refreshed = false;
        presentFailure(refreshError, null, "renderer asset library refresh after deletion failed");
      }
      setOperationError("delete", presentFailure(
        deleteError,
        message(refreshed ? "failure.assetDelete" : "failure.assetDeleteUnrefreshed"),
        "renderer asset deletion failed",
      ));
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

  function visiblePageSize(): number {
    const grid = gridRef.current;
    const firstItem = itemRefs.current.values().next().value as HTMLButtonElement | undefined;
    const rowHeight = firstItem?.offsetHeight ?? 0;
    const visibleRows = grid?.parentElement && rowHeight > 0
      ? Math.max(1, Math.floor(grid.parentElement.clientHeight / rowHeight))
      : 3;
    return visibleColumnCount() * visibleRows;
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
    } else if (event.key === "PageUp") {
      event.preventDefault();
      moveFocus(-visiblePageSize(), { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "PageDown") {
      event.preventDefault();
      moveFocus(visiblePageSize(), { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(-entries.length, { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(entries.length, { extendSelection: event.shiftKey, preserveSelection: event.metaKey || event.ctrlKey });
    } else if (event.key === "Enter" || event.key === " ") {
      // Enter that ends an IME composition accepts the candidate; it must not use the selection.
      if (ime.isComposing(event)) return;
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
    ? t("assets.deleteNeedsSelection")
    : !canDeleteSelected
      ? t("assets.builtinProtected")
      : t("assets.removeSelected", { count: selectedEntries.length });
  const useTitle = selectedEntry
    ? t("assets.useSelectedHint")
    : selectedEntries.length === 0
      ? t("assets.selectOne")
      : t("assets.selectExactlyOne");

  return (
    <ModalShell
      title={title}
      size="wide"
      tall
      surfaceClassName="asset-picker-modal"
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={importAssets}>{t("assets.import")}</button>
          <span className="top-bar-spacer" />
          <button
            className="toolbar-button"
            disabled={!canDeleteSelected}
            title={deleteTitle}
            type="button"
            onClick={() => void deleteSelected()}
          >
            {t("common.delete")}
          </button>
          <button className="toolbar-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button
            className="primary-action"
            disabled={!selectedEntry}
            title={useTitle}
            type="button"
            onClick={() => void useSelected()}
          >
            {t("assets.useSelected")}
          </button>
        </>
      }
    >
      <div aria-busy={loading} className="asset-picker" style={{ "--asset-picker-preview-size": `${previewLongEdge}px` } as React.CSSProperties}>
        {controls}
        {loading ? (
          <OperationResult announce={false} className="modal-info" severity="info">
            {t("assets.preparing")}
          </OperationResult>
        ) : null}
        {notice ? (
          <OperationResult className="modal-warning" severity="warning">
            {text(notice)}
          </OperationResult>
        ) : null}
        {pickerOperations.map((operation) => {
          const failure = errors[operation];
          return failure ? (
            <OperationResult
              className="modal-error"
              dismissLabel={t(OPERATION_DISMISS_LABELS[operation])}
              key={operation}
              severity="error"
              onDismiss={() => setOperationError(operation, null)}
            >
              {text(failure)}
            </OperationResult>
          ) : null;
        })}
        <div
          aria-labelledby={contentLabelledBy}
          className="asset-picker-scroll"
          id={contentId}
          role={contentId ? "tabpanel" : undefined}
        >
          <div
            aria-multiselectable
            className="asset-picker-grid"
            ref={gridRef}
            role="listbox"
            tabIndex={entries.length === 0 ? 0 : -1}
            {...ime.compositionProps}
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
                    {entry.previewDataUrl ? <img alt="" src={entry.previewDataUrl} /> : <span>{t("assets.noPreview")}</span>}
                  </span>
                  <span className="asset-picker-name" title={entry.name}>{entry.name}</span>
                  {entry.builtin ? <span className="asset-picker-badge">{t("assets.builtin")}</span> : null}
                </button>
              );
            }) : (
              <div className="ops-empty">{emptyMessage ?? t("assets.empty")}</div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// The first few names, listed the way the language lists them, with a count of the rest.
function namesPreview(names: string[], t: Translator["t"], list: Translator["list"], maxNames = 5): string {
  if (names.length <= maxNames) return list(names);
  return list([...names.slice(0, maxNames), t("assets.moreNames", { count: names.length - maxNames })]);
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
  const { t } = useI18n();
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
      .catch((previewError) => {
        console.warn("Failed to load LUT previews", previewError);
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
      importTitle={t("lut.importTitle")}
      loading={loading}
      previewLongEdge={previewLongEdge}
      selectedPath={selectedPath}
      title={t("lut.chooseTitle")}
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
  const { t } = useI18n();
  const [groupId, setGroupId] = useState<StampGroupFilterId>(() => initialStampGroupFilter(stamps, selectedPath));
  const groupTabsRef = useRef<HTMLDivElement>(null);
  const groupPanelId = useId();
  const visibleStamps = useMemo(() => filterStampsByGroup(stamps, groupId), [groupId, stamps]);
  const activeGroupIndex = STAMP_GROUP_FILTERS.findIndex((group) => group.id === groupId);
  const activeGroupTabId = `${groupPanelId}-${groupId}-tab`;
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function selectGroupAt(index: number): void {
    const group = STAMP_GROUP_FILTERS[index];
    if (!group) return;
    setGroupId(group.id);
    requestAnimationFrame(() => {
      const tab = groupTabsRef.current?.querySelector<HTMLElement>(`[data-stamp-group-index="${index}"]`);
      tab?.focus();
    });
  }

  function handleGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    let targetIndex: number | null = null;
    if (event.key === "ArrowRight") targetIndex = Math.min(activeGroupIndex + 1, STAMP_GROUP_FILTERS.length - 1);
    else if (event.key === "ArrowLeft") targetIndex = Math.max(activeGroupIndex - 1, 0);
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = STAMP_GROUP_FILTERS.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    selectGroupAt(targetIndex);
  }

  useEffect(() => {
    let cancelled = false;
    if (visibleStamps.length === 0) {
      setPreviewMap({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setPreviewMap({});
    void runWithConcurrency(visibleStamps, 6, async (stamp) => {
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
  }, [previewLongEdge, visibleStamps]);

  const entries = visibleStamps.map((stamp) => ({
    ...stamp,
    name: stamp.name || fileNameFromPath(stamp.path),
    previewDataUrl: previewMap[stamp.path]
  }));
  const emptyMessage = t(groupId === "all"
    ? "stamps.emptyLibrary"
    : groupId === "imported"
      ? "stamps.emptyImported"
      : "stamps.emptyGroup");
  return (
    <AssetPickerModal
      contentId={groupPanelId}
      contentLabelledBy={activeGroupTabId}
      controls={(
        <div
          aria-label={t("stamps.groups")}
          className="asset-picker-groups"
          onKeyDown={handleGroupKeyDown}
          ref={groupTabsRef}
          role="tablist"
        >
          {STAMP_GROUP_FILTERS.map((group, index) => {
            const selected = group.id === groupId;
            return (
              <button
                aria-controls={groupPanelId}
                aria-selected={selected}
                className={selected ? "active" : ""}
                data-stamp-group-index={index}
                id={`${groupPanelId}-${group.id}-tab`}
                key={group.id}
                onClick={() => setGroupId(group.id)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {t(STAMP_GROUP_LABELS[group.id])}
              </button>
            );
          })}
        </div>
      )}
      emptyMessage={emptyMessage}
      entries={entries}
      extensions={["png", "svg"]}
      importTitle={t("stamps.importTitle")}
      loading={loading}
      previewLongEdge={previewLongEdge}
      selectedPath={selectedPath}
      title={t("stamps.chooseTitle")}
      onClose={onClose}
      onDelete={(entriesToDelete) => api.stamps.delete(entriesToDelete.map((entry) => entry.path))}
      onImport={(filePaths) => api.stamps.import(filePaths)}
      onImportComplete={() => setGroupId("imported")}
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
