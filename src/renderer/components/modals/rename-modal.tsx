import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, RenamePreview, RenamePreviewItem } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import { builtinRenameTemplates, DEFAULT_RENAME_TEMPLATE_ID, type RenameTemplateId } from "@shared/rename-template";
import { missingSlugLabel, missingSlugVisualState, renameItemStateLabel, renameItemVisualState } from "@renderer/task-visual-state";
import { ModalShell } from "./modal-shell";

export type RenameRunSummary = {
  renamed: Array<{ from: string; to: string }>;
  skipped: string[];
};

export function RenameModal({
  projectSnapshot,
  outputDirLabel,
  outputDirPath,
  onClearOutputDir,
  onClose,
  onPreview,
  onRegenerateSlug,
  onRun,
  onSetRenameSlug,
  onSetOutputDir
}: {
  projectSnapshot: ProjectSnapshot;
  outputDirLabel: string;
  outputDirPath: string | null;
  onClearOutputDir(): Promise<void>;
  onClose(): void;
  onPreview(templateId: RenameTemplateId): Promise<RenamePreview>;
  onRegenerateSlug(taskId: string): Promise<void>;
  onRun(templateId: RenameTemplateId, summary: RenameRunSummary): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  onSetOutputDir(): Promise<void>;
}): React.JSX.Element {
  const [dirtySlugDrafts, setDirtySlugDrafts] = useState<Record<string, boolean>>({});
  const [templateId, setTemplateId] = useState<RenameTemplateId>(DEFAULT_RENAME_TEMPLATE_ID);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [actionTaskIds, setActionTaskIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const modalBusy = runBusy;
  const hasPendingSlugDrafts = Boolean(
    preview?.usesSlug
    && preview.items.some((item) => dirtySlugDrafts[item.taskId])
  );
  const canRun = Boolean(
    preview?.items.some((item) => item.status === "ready")
    && preview.blockedCount === 0
    && !hasPendingSlugDrafts
  );
  const tasksById = new Map(projectSnapshot.project.tasks.map((task) => [task.id, task]));

  useEffect(() => {
    const activeTaskIds = new Set(preview?.items.map((item) => item.taskId) ?? []);
    setDirtySlugDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([taskId]) => activeTaskIds.has(taskId))
    ));
  }, [preview]);

  const setDirtySlugDraft = useCallback((taskId: string, dirty: boolean) => {
    setDirtySlugDrafts((current) => {
      if (current[taskId] === dirty) return current;
      return { ...current, [taskId]: dirty };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview(): Promise<void> {
      setPreviewBusy(true);
      setError(null);
      await onPreview(templateId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [projectSnapshot, templateId, outputDirPath]);

  async function confirm(): Promise<void> {
    setRunBusy(true);
    setError(null);
    try {
      await onRun(templateId, preview ? renameRunSummary(preview) : { renamed: [], skipped: [] });
    } catch (caught) {
      const message = renameErrorMessage(caught);
      setError(`Couldn't rename files. ${message}`);
      setRunBusy(false);
    }
  }

  function renameErrorMessage(caught: unknown): string {
    const message = caught instanceof Error ? caught.message : String(caught);
    return message.replace(/^Error invoking remote method 'rename\.run': Error: /, "");
  }

  return (
    <ModalShell
      title="Rename all"
      size="wide"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={modalBusy || previewBusy || actionTaskIds.length > 0 || !canRun} onClick={() => void confirm()}>
            Rename all
          </button>
        </>
      }
    >
      <div className="rename-output-dir">
        <div className="rename-output-dir-copy">
          <span className="rename-output-dir-label">Output folder</span>
          <span className="rename-output-dir-value" title={outputDirPath ?? ""}>{outputDirLabel}</span>
        </div>
        <button className="toolbar-button compact-text" disabled={modalBusy} type="button" onClick={() => void onSetOutputDir()}>{outputDirPath ? "Change" : "Choose"}</button>
        {outputDirPath ? <button className="toolbar-button compact-text" disabled={modalBusy} type="button" onClick={() => void onClearOutputDir()}>Clear</button> : null}
      </div>

      <label className="stacked-field">
        Template
        <select disabled={modalBusy} value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value as RenameTemplateId)}>
          {builtinRenameTemplates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </label>

      {preview?.blockedCount ? (
        <div className="modal-warning">{preview.blockedCount} item{preview.blockedCount === 1 ? "" : "s"} need{preview.blockedCount === 1 ? "s" : ""} attention before rename.</div>
      ) : null}

      {error ? <div className="modal-error">{error}</div> : null}

      <div className="rename-preview-list">
        {preview?.items.length ? preview.items.map((item) => (
          <RenamePreviewRow
            actionBusy={actionTaskIds.includes(item.taskId)}
            disabled={modalBusy}
            item={item}
            key={item.taskId}
            task={tasksById.get(item.taskId)}
            onRegenerateSlug={async (taskId) => {
              setActionTaskIds((current) => current.includes(taskId) ? current : [...current, taskId]);
              setError(null);
              try {
                await onRegenerateSlug(taskId);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
              } finally {
                setActionTaskIds((current) => current.filter((id) => id !== taskId));
              }
            }}
            onSetRenameSlug={async (taskId, customSlug) => {
              setActionTaskIds((current) => current.includes(taskId) ? current : [...current, taskId]);
              setError(null);
              try {
                await onSetRenameSlug(taskId, customSlug);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
              } finally {
                setActionTaskIds((current) => current.filter((id) => id !== taskId));
              }
            }}
            onDraftStateChange={setDirtySlugDraft}
            showSlugEditor={Boolean(preview.usesSlug && item.currentPath)}
          />
        )) : (
          <div className="ops-empty">{previewBusy ? "Preparing preview..." : "No tasks to rename"}</div>
        )}
      </div>
    </ModalShell>
  );
}

function RenamePreviewRow({
  actionBusy,
  disabled,
  item,
  task,
  onDraftStateChange,
  onRegenerateSlug,
  onSetRenameSlug,
  showSlugEditor
}: {
  actionBusy: boolean;
  disabled: boolean;
  item: RenamePreviewItem;
  task: Task | undefined;
  onDraftStateChange(taskId: string, dirty: boolean): void;
  onRegenerateSlug(taskId: string): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  showSlugEditor: boolean;
}): React.JSX.Element {
  const initialSlugValue = item.customSlug ?? "";
  const [slugDraft, setSlugDraft] = useState(initialSlugValue);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setSlugDraft(initialSlugValue);
  }, [initialSlugValue, item.taskId]);

  const draftSlug = slugDraft.trim();
  const initialSlug = initialSlugValue.trim();
  const draftDirty = showSlugEditor && draftSlug !== initialSlug;
  const draftEmpty = showSlugEditor && draftSlug.length === 0;
  const previewVisualState = renameItemVisualState(task, item);
  const visualState = draftEmpty ? missingSlugVisualState(task) : previewVisualState;
  const stateText = draftEmpty
    ? missingSlugLabel(visualState)
    : draftDirty
      ? "Editing slug"
      : renameItemStateLabel(previewVisualState, item);
  const rowDisabled = disabled || actionBusy || Boolean(task?.visionRunning);

  useEffect(() => {
    onDraftStateChange(item.taskId, draftDirty);
  }, [draftDirty, item.taskId, onDraftStateChange]);

  async function commitSlugDraft(): Promise<void> {
    if (draftSlug === initialSlug) return;
    await onSetRenameSlug(item.taskId, draftSlug.length > 0 ? draftSlug : null);
  }

  return (
    <div className={`rename-preview-row ${item.status}${showSlugEditor ? "" : " no-side"}`} key={item.taskId}>
      <div className="rename-preview-main">
        <span className={`rename-preview-state state-${visualState}`}>
          <span className={`rename-preview-dot state-${visualState}`} aria-hidden="true">●</span>
          <span>{stateText}</span>
        </span>
        <span className="rename-preview-title" title={item.proposedPath ?? ""}>{item.proposedName ?? (item.status === "not-saved" ? "Not saved yet" : (item.issue ?? "Unavailable"))}</span>
        <span className="rename-preview-meta" title={item.currentPath ?? ""}>
          <span className="rename-preview-meta-label">Current</span>
          <span>{item.currentName ?? "Not saved"}</span>
        </span>
        <span className="rename-preview-meta" title={item.originalName}>
          <span className="rename-preview-meta-label">Original</span>
          <span>{item.originalName}</span>
        </span>
      </div>
      <div className={`rename-preview-side${showSlugEditor ? "" : " hidden"}`}>
        {showSlugEditor ? (
          <div className="rename-preview-slug-editor">
            <input
              className="rename-preview-slug-input"
              disabled={rowDisabled}
              placeholder="descriptive-slug"
              type="text"
              value={slugDraft}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                void commitSlugDraft();
              }}
              onChange={(event) => setSlugDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void commitSlugDraft();
              }}
            />
            <button
              className="inline-action rename-preview-slug-action"
              disabled={rowDisabled}
              type="button"
              onMouseDown={() => {
                skipBlurCommitRef.current = true;
              }}
              onClick={() => void onRegenerateSlug(item.taskId)}
            >
              {actionBusy ? (item.generatedSlug ? "Regenerating" : "Generating") : item.generatedSlug ? "Regenerate" : "Generate"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renameRunSummary(preview: RenamePreview): RenameRunSummary {
  return {
    renamed: preview.items
      .flatMap((item) => item.status === "ready" && item.currentName && item.proposedName
        ? [{ from: item.currentName, to: item.proposedName }]
        : []),
    skipped: preview.items
      .flatMap((item) => {
        if (item.status !== "unchanged") return [];
        const name = item.proposedName ?? item.currentName;
        return name ? [name] : [];
      })
  };
}
