import React, { useEffect, useRef, useState } from "react";
import type { FilenameTemplate } from "@shared/types/settings";
import type { RenamePreview, RenamePreviewItem } from "@shared/types/ipc";
import { ModalShell } from "./modal-shell";

export function RenameModal({
  templates,
  defaultTemplateId,
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
  templates: FilenameTemplate[];
  defaultTemplateId: string;
  outputDirLabel: string;
  outputDirPath: string | null;
  onClearOutputDir(): Promise<void>;
  onClose(): void;
  onPreview(templateId: string): Promise<RenamePreview>;
  onRegenerateSlug(taskId: string): Promise<void>;
  onRun(templateId: string): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  onSetOutputDir(): Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState(defaultTemplateId);
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
  }, [templateId, outputDirPath]);

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
        <select disabled={modalBusy} value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value)}>
          {templates.map((template) => (
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

  const detail = item.status === "not-saved"
    ? "Not saved"
    : item.status === "blocked"
      ? item.issue ?? "Blocked"
      : item.status === "unchanged"
        ? "No change"
        : "Ready";

  async function commitSlugDraft(): Promise<void> {
    const trimmed = slugDraft.trim();
    if (trimmed === initialSlugValue.trim()) return;
    await onSetRenameSlug(item.taskId, trimmed.length > 0 ? trimmed : null);
  }

  return (
    <div className={`rename-preview-row ${item.status}`} key={item.taskId}>
      <div className="rename-preview-cell">
        <span className="rename-preview-label" title={item.label}>{item.label}</span>
        <span title={item.currentPath ?? ""}>{item.currentName ?? "Not saved"}</span>
      </div>
      <div className="rename-preview-cell">
        <span className="rename-preview-status">{detail}</span>
        <span title={item.proposedPath ?? ""}>{item.proposedName ?? "-"}</span>
        {showSlugEditor ? (
          <div className="rename-preview-slug-editor">
            <label className="rename-preview-slug-field">
              <span>Rename slug</span>
              <input
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
            </label>
            <button
              className="toolbar-button compact-text"
              disabled={disabled}
              type="button"
              onMouseDown={() => {
                skipBlurCommitRef.current = true;
              }}
              onClick={() => void onRegenerateSlug(item.taskId)}
            >
              {actionBusy ? "Regenerating" : "Regenerate slug"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
