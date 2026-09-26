import React, { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { Original } from "@shared/types/project";
import { formatLabel } from "@shared/output-format";
import { useListbox } from "@renderer/components/useListbox";
import {
  hasFileDragType,
  inspectImportFileDragOffer,
  localDropFiles,
} from "@renderer/external-file-drop";
import type { OriginalImportFeedback } from "@renderer/original-import-feedback";
import { OperationResult } from "@renderer/components/operation-result";
import { OwnedFailureList } from "@renderer/components/owned-failure-list";
import type { OwnedFailures } from "@renderer/owned-failures";
import { useI18n } from "@renderer/i18n/I18nContext";

export function OriginalsPanel({
  activeOriginalId,
  originals,
  thumbnails,
  feedback,
  failures,
  onAdd,
  onDismissFeedback,
  onDismissFailure,
  onDropFiles,
  onRemove,
  onSelect
}: {
  activeOriginalId: string | null;
  originals: Original[];
  thumbnails: Record<string, string>;
  feedback: OriginalImportFeedback | null;
  failures: OwnedFailures;
  onAdd(): void;
  onDismissFeedback(): void;
  onDismissFailure(key: string): void;
  onDropFiles(paths: string[], inaccessibleNames: string[]): void;
  onRemove(originalId: string): void;
  onSelect(originalId: string): void;
}): React.JSX.Element {
  const { t, text } = useI18n();
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  const listbox = useListbox({
    ids: originals.map((original) => original.id),
    selectedId: activeOriginalId,
    onSelect,
    onRemove
  });

  function clearDrop(): void {
    dragDepthRef.current = 0;
    setDropActive(false);
  }

  return (
    <aside className="panel originals-panel">
      <PanelHeader title={t("originals.title")} />
      <div
        className={`originals-receiver ${dropActive ? "is-delivery-candidate" : ""}`}
        onDragEnter={(event) => {
          if (inspectImportFileDragOffer(event.dataTransfer) === "rejected") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          dragDepthRef.current += 1;
          setDropActive(true);
        }}
        onDragOver={(event) => {
          if (inspectImportFileDragOffer(event.dataTransfer) === "rejected") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (dragDepthRef.current === 0) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDropActive(false);
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
        <div className="list" aria-label={t("originals.title")} {...listbox.listboxProps}>
          {originals.length === 0 ? (
            <div className="empty-state">{t("originals.empty")}</div>
          ) : originals.map((original) => (
            <div className="original-list-entry" key={original.id}>
              <div className={`list-row with-actions ${activeOriginalId === original.id ? "active" : ""}`}>
                <button className="row-main-action" type="button" onClick={() => onSelect(original.id)} {...listbox.getOptionProps(original.id)}>
                  <span className="thumb">
                    {thumbnails[original.id] ? <img src={thumbnails[original.id]} alt="" /> : null}
                  </span>
                  <span className="row-copy">
                    <span className="row-title">{basename(original.sourcePath)}</span>
                    <span className="row-detail">{`${original.width}×${original.height} · ${formatLabel(original.format)}`}</span>
                  </span>
                </button>
                <button className="icon-button compact row-remove-button" title={t("originals.remove")} type="button" tabIndex={-1} onClick={() => onRemove(original.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              <OwnedFailureList
                className="original-row-failure"
                failures={failureForKey(failures, `remove:${original.id}`)}
                onDismiss={onDismissFailure}
              />
            </div>
          ))}
        </div>
        {feedback ? (
          <OperationResult
            className={`import-feedback ${feedback.severity}`}
            severity={feedback.severity}
            onDismiss={onDismissFeedback}
            dismissLabel={t("originals.closeImportResult")}
          >
            <div>
              <strong>{text(feedback.title)}</strong>
              {feedback.details.map((detail, index) => (
                <div className={`import-feedback-detail ${detail.severity}`} key={index}>{text(detail.text)}</div>
              ))}
            </div>
          </OperationResult>
        ) : null}
        <OwnedFailureList className="panel-owned-failures" failures={failuresOutsidePrefix(failures, "remove:")} onDismiss={onDismissFailure} />
        <div className="panel-footer">
          <button className="toolbar-button" type="button" onClick={onAdd}>
            <ImagePlus size={14} />
            {t("originals.add")}
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

function failureForKey(failures: OwnedFailures, key: string): OwnedFailures {
  return key in failures ? { [key]: failures[key] } : {};
}

function failuresOutsidePrefix(failures: OwnedFailures, prefix: string): OwnedFailures {
  return Object.fromEntries(Object.entries(failures).filter(([key]) => !key.startsWith(prefix)));
}
