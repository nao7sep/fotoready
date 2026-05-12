import React, { useEffect, useState } from "react";
import type { FilenameTemplate } from "@shared/types/settings";
import type { RenamePreview } from "@shared/types/ipc";

export function RenameModal({
  templates,
  defaultTemplateId,
  onClose,
  onPreview,
  onRun
}: {
  templates: FilenameTemplate[];
  defaultTemplateId: string;
  onClose(): void;
  onPreview(templateId: string): Promise<RenamePreview>;
  onRun(templateId: string): Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        {preview?.missingSlugCount ? (
          <div className="modal-warning">
            {preview.missingSlugCount} of {preview.items.length} done tasks need a custom slug before rename.
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
