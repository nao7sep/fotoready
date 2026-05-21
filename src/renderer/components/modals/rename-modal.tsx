import React, { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, RenamePreview, RenamePreviewItem } from "@shared/types/ipc";
import { builtinRenameTemplates, DEFAULT_RENAME_TEMPLATE_ID, type RenameTemplateId } from "@shared/rename-template";
import { ModalShell } from "./modal-shell";

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
  onRun(templateId: RenameTemplateId): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  onSetOutputDir(): Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState<RenameTemplateId>(DEFAULT_RENAME_TEMPLATE_ID);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalBusy = busy || actionTaskId !== null;
  const canRun = Boolean(preview?.items.some((item) => item.status === "ready" || item.status === "unchanged") && preview.blockedCount === 0);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview(): Promise<void> {
      setBusy(true);
      setError(null);
      await onPreview(templateId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [projectSnapshot, templateId, outputDirPath]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onRun(templateId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Rename all"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={modalBusy || !canRun} onClick={() => void confirm()}>
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
        <div className="modal-warning">{preview.blockedCount} item{preview.blockedCount === 1 ? "" : "s"} need attention before rename.</div>
      ) : null}

      {error ? <div className="modal-error">{error}</div> : null}

      <div className="rename-preview-list">
        {preview?.items.length ? preview.items.map((item) => (
          <RenamePreviewRow
            actionBusy={actionTaskId === item.taskId}
            disabled={modalBusy}
            item={item}
            key={item.taskId}
            onRegenerateSlug={async (taskId) => {
              setActionTaskId(taskId);
              setError(null);
              try {
                await onRegenerateSlug(taskId);
                setPreview(await onPreview(templateId));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
              } finally {
                setActionTaskId(null);
              }
            }}
            onSetRenameSlug={async (taskId, customSlug) => {
              setActionTaskId(taskId);
              setError(null);
              try {
                await onSetRenameSlug(taskId, customSlug);
                setPreview(await onPreview(templateId));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
              } finally {
                setActionTaskId(null);
              }
            }}
            showSlugEditor={Boolean(preview.usesSlug && item.currentPath)}
          />
        )) : (
          <div className="ops-empty">{busy ? "Preparing preview..." : "No tasks to rename"}</div>
        )}
      </div>
    </ModalShell>
  );
}

function RenamePreviewRow({
  actionBusy,
  disabled,
  item,
  onRegenerateSlug,
  onSetRenameSlug,
  showSlugEditor
}: {
  actionBusy: boolean;
  disabled: boolean;
  item: RenamePreviewItem;
  onRegenerateSlug(taskId: string): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  showSlugEditor: boolean;
}): React.JSX.Element {
  const initialSlugValue = item.customSlug ?? item.generatedSlug ?? "";
  const [slugDraft, setSlugDraft] = useState(initialSlugValue);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setSlugDraft(initialSlugValue);
  }, [initialSlugValue, item.taskId]);

  const stateText = item.status === "not-saved"
    ? "Not saved"
    : item.status === "blocked"
      ? item.issue ?? "Needs attention"
      : item.status === "unchanged"
        ? "No change"
        : "Ready";

  async function commitSlugDraft(): Promise<void> {
    const trimmed = slugDraft.trim();
    if (trimmed === initialSlugValue.trim()) return;
    await onSetRenameSlug(item.taskId, trimmed.length > 0 ? trimmed : null);
  }

  return (
    <div className={`rename-preview-row ${item.status}${showSlugEditor ? "" : " no-side"}`} key={item.taskId}>
      <div className="rename-preview-main">
        <span className={`rename-preview-state ${item.status}`}>
          <span className={`rename-preview-dot ${item.status}`} aria-hidden="true">●</span>
          <span>{stateText}</span>
        </span>
        <span className="rename-preview-title" title={item.proposedPath ?? ""}>{item.proposedName ?? "Not saved yet"}</span>
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
            <span className="rename-preview-slug-label">slug</span>
            <input
              className="rename-preview-slug-input"
              disabled={disabled}
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
              className="toolbar-button compact-text"
              disabled={disabled}
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
