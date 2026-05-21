import React, { useEffect, useState } from "react";
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
  onRun,
  onSetOutputDir
}: {
  templates: FilenameTemplate[];
  defaultTemplateId: string;
  outputDirLabel: string;
  outputDirPath: string | null;
  onClearOutputDir(): Promise<void>;
  onClose(): void;
  onPreview(templateId: string): Promise<RenamePreview>;
  onRun(templateId: string): Promise<void>;
  onSetOutputDir(): Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRun = Boolean(preview?.items.some((item) => item.status === "ready" || item.status === "unchanged") && preview.blockedCount === 0);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void onPreview(templateId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onPreview, templateId]);

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
          <button className="primary-action" type="button" disabled={busy || !canRun} onClick={() => void confirm()}>
            Rename all
          </button>
        </>
      }
    >
      <label className="stacked-field">
        Template
        <select value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value)}>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </label>

      <div className="rename-output-dir">
        <div>
          <span className="row-label">Output folder</span>
          <span className="row-detail" title={outputDirPath ?? ""}>{outputDirLabel}</span>
        </div>
        <button className="toolbar-button compact-text" type="button" onClick={() => void onSetOutputDir()}>{outputDirPath ? "Change..." : "Choose..."}</button>
        {outputDirPath ? <button className="toolbar-button compact-text" type="button" onClick={() => void onClearOutputDir()}>Clear</button> : null}
      </div>

      {preview?.blockedCount ? (
        <div className="modal-warning">{preview.blockedCount} item{preview.blockedCount === 1 ? "" : "s"} need attention before rename.</div>
      ) : null}

      {error ? <div className="modal-error">{error}</div> : null}

      <div className="rename-preview-list">
        {preview?.items.length ? preview.items.map((item) => (
          <RenamePreviewRow item={item} key={item.taskId} />
        )) : (
          <div className="ops-empty">{busy ? "Preparing preview..." : "No tasks to rename"}</div>
        )}
      </div>
    </ModalShell>
  );
}

function RenamePreviewRow({ item }: { item: RenamePreviewItem }): React.JSX.Element {
  const detail = item.status === "not-saved"
    ? "Not saved"
    : item.status === "blocked"
      ? item.issue ?? "Blocked"
      : item.status === "unchanged"
        ? "No change"
        : "Ready";

  return (
    <div className={`rename-preview-row ${item.status}`} key={item.taskId}>
      <div className="rename-preview-cell">
        <span className="rename-preview-label" title={item.label}>{item.label}</span>
        <span title={item.currentPath ?? ""}>{item.currentName ?? "Not saved"}</span>
      </div>
      <div className="rename-preview-cell">
        <span className="rename-preview-status">{detail}</span>
        <span title={item.proposedPath ?? ""}>{item.proposedName ?? "-"}</span>
      </div>
    </div>
  );
}
