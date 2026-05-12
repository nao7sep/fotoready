import React, { useEffect, useState } from "react";
import type { FilenameTemplate } from "@shared/types/settings";
import type { RenamePreview } from "@shared/types/ipc";

export function RenameModal({
  templates,
  defaultTemplateId,
  selectedTaskId,
  onClose,
  onGenerateMissing,
  onPreview,
  onRun
}: {
  templates: FilenameTemplate[];
  defaultTemplateId: string;
  selectedTaskId: string | null;
  onClose(): void;
  onGenerateMissing(taskIds: string[]): Promise<void>;
  onPreview(templateId: string, taskIds?: string[]): Promise<RenamePreview>;
  onRun(templateId: string, taskIds?: string[]): Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUseSelected = selectedTaskId !== null;
  const scopedTaskIds = scope === "selected" && selectedTaskId ? [selectedTaskId] : undefined;

  useEffect(() => {
    if (!canUseSelected && scope === "selected") setScope("all");
  }, [canUseSelected, scope]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void onPreview(templateId, scopedTaskIds)
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
  }, [onPreview, scope, selectedTaskId, templateId]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onRun(templateId, scopedTaskIds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function generateMissing(): Promise<void> {
    const missingTaskIds = preview?.items.filter((item) => item.missingSlug).map((item) => item.taskId) ?? [];
    if (missingTaskIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onGenerateMissing(missingTaskIds);
      setPreview(await onPreview(templateId, scopedTaskIds));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header className="modal-header">
          <h2>Rename Outputs</h2>
          <button className="toolbar-button" type="button" onClick={onClose}>Close</button>
        </header>

        <label className="stacked-field">
          Template
          <select value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value)}>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>

        <div className="segmented-control">
          <button className={scope === "all" ? "active" : ""} type="button" onClick={() => setScope("all")}>All done tasks</button>
          <button className={scope === "selected" ? "active" : ""} disabled={!canUseSelected} type="button" onClick={() => setScope("selected")}>Selected task only</button>
        </div>

        {preview?.missingSlugCount ? (
          <div className="modal-warning">
            {preview.missingSlugCount} of {preview.items.length} done tasks need a custom slug before rename.
            <button className="inline-action" disabled={busy} type="button" onClick={() => void generateMissing()}>Generate now</button>
          </div>
        ) : null}

        {error ? <div className="modal-error">{error}</div> : null}

        <div className="rename-preview-list">
          {preview?.items.length ? preview.items.map((item) => (
            <div className={`rename-preview-row ${item.missingSlug ? "blocked" : ""}`} key={item.taskId}>
              <span>{item.stagedName}</span>
              <span>{item.proposedName}</span>
            </div>
          )) : (
            <div className="ops-empty">{busy ? "Preparing preview..." : "No done tasks to rename"}</div>
          )}
        </div>

        <footer className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={busy || !preview?.items.length || preview.missingSlugCount > 0} onClick={() => void confirm()}>
            Confirm rename
          </button>
        </footer>
      </section>
    </div>
  );
}
