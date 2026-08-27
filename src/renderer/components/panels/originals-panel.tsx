import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import type { Original } from "@shared/types/project";
import { formatLabel } from "@shared/output-format";
import { useListbox } from "@renderer/components/useListbox";
import {
  DropHighlightLease,
  hasFileDragType,
  inspectImportFileDragOffer,
  localDropFiles,
} from "@renderer/external-file-drop";
import type { OriginalImportFeedback } from "@renderer/original-import-feedback";

export function OriginalsPanel({
  activeOriginalId,
  originals,
  thumbnails,
  feedback,
  onAdd,
  onDismissFeedback,
  onDropFiles,
  onRemove,
  onSelect
}: {
  activeOriginalId: string | null;
  originals: Original[];
  thumbnails: Record<string, string>;
  feedback: OriginalImportFeedback | null;
  onAdd(): void;
  onDismissFeedback(): void;
  onDropFiles(paths: string[], inaccessibleNames: string[]): void;
  onRemove(originalId: string): void;
  onSelect(originalId: string): void;
}): React.JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const leaseRef = useRef<DropHighlightLease | null>(null);
  if (leaseRef.current === null) {
    leaseRef.current = new DropHighlightLease(
      (active) => {
        if (!active) dragDepthRef.current = 0;
        setDropActive(active);
      },
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (handle) => window.clearTimeout(handle),
    );
  }

  useEffect(() => {
    const lease = leaseRef.current;
    return () => lease?.dispose();
  }, []);

  const listbox = useListbox({
    ids: originals.map((original) => original.id),
    selectedId: activeOriginalId,
    onSelect,
    onRemove
  });

  function clearDrop(): void {
    dragDepthRef.current = 0;
    leaseRef.current?.clear();
  }

  return (
    <aside className="panel originals-panel">
      <PanelHeader title="Originals" />
      <div
        className={`originals-receiver ${dropActive ? "is-delivery-candidate" : ""}`}
        onDragEnter={(event) => {
          if (inspectImportFileDragOffer(event.dataTransfer) === "rejected") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          dragDepthRef.current += 1;
          leaseRef.current?.renew();
        }}
        onDragOver={(event) => {
          if (inspectImportFileDragOffer(event.dataTransfer) === "rejected") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          leaseRef.current?.renew();
        }}
        onDragLeave={(event) => {
          if (dragDepthRef.current === 0) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) leaseRef.current?.clear();
        }}
        onDrop={(event) => {
          if (!hasFileDragType(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          const delivered = localDropFiles(event.dataTransfer.files, window.api.system.filePathForFile);
          clearDrop();
          onDropFiles(delivered.paths, delivered.inaccessibleNames);
        }}
        onDragEnd={clearDrop}
      >
        <div className="list" aria-label="Originals" {...listbox.listboxProps}>
          {originals.length === 0 ? (
            <div className="empty-state">No originals. Add or drop an image or FotoReady sidecar.</div>
          ) : originals.map((original) => (
            <div className={`list-row with-actions ${activeOriginalId === original.id ? "active" : ""}`} key={original.id}>
              <button className="row-main-action" type="button" onClick={() => onSelect(original.id)} {...listbox.getOptionProps(original.id)}>
                <span className="thumb">
                  {thumbnails[original.id] ? <img src={thumbnails[original.id]} alt="" /> : null}
                </span>
                <span className="row-copy">
                  <span className="row-title">{basename(original.sourcePath)}</span>
                  <span className="row-detail">{original.width}x{original.height} · {formatLabel(original.format)}</span>
                </span>
              </button>
              <button className="icon-button compact row-remove-button" title="Remove original" type="button" tabIndex={-1} onClick={() => onRemove(original.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        {feedback ? (
          <div className={`import-feedback ${feedback.severity}`} role="status" aria-live="polite">
            <div>
              <strong>{feedback.title}</strong>
              {feedback.details.map((detail, index) => (
                <div className={`import-feedback-detail ${detail.severity}`} key={`${detail.text}\0${index}`}>
                  <strong>{detail.severity === "info" ? "Info" : detail.severity === "warning" ? "Warning" : "Error"}:</strong>{" "}
                  {detail.text}
                </div>
              ))}
            </div>
            <button type="button" className="icon-button compact" aria-label="Dismiss import result" onClick={onDismissFeedback}>
              <X size={13} />
            </button>
          </div>
        ) : null}
        <div className="panel-footer">
          <button className="toolbar-button" type="button" onClick={onAdd}>
            <ImagePlus size={14} />
            Add originals
          </button>
        </div>
      </div>
    </aside>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
