import React from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { Original } from "@shared/types/project";
import { formatLabel } from "@shared/output-format";
import { useListbox } from "@renderer/components/useListbox";

export function OriginalsPanel({
  activeOriginalId,
  originals,
  thumbnails,
  onAdd,
  onDropFiles,
  onRemove,
  onSelect
}: {
  activeOriginalId: string | null;
  originals: Original[];
  thumbnails: Record<string, string>;
  onAdd(): void;
  onDropFiles(sourcePaths: string[]): void;
  onRemove(originalId: string): void;
  onSelect(originalId: string): void;
}): React.JSX.Element {
  const [dragActive, setDragActive] = React.useState(false);
  const listbox = useListbox({
    ids: originals.map((original) => original.id),
    selectedId: activeOriginalId,
    onSelect,
    onRemove
  });

  function onDragOver(event: React.DragEvent): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function onDrop(event: React.DragEvent): void {
    event.preventDefault();
    setDragActive(false);
    const sourcePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.system.filePathForFile(file))
      .filter((filePath) => filePath.length > 0);
    onDropFiles(sourcePaths);
  }

  return (
    <aside className={`panel originals-panel ${dragActive ? "drag-active" : ""}`} onDragLeave={() => setDragActive(false)} onDragOver={onDragOver} onDrop={onDrop}>
      <PanelHeader title="Originals" />
      <div className="list" aria-label="Originals" {...listbox.listboxProps}>
        {originals.length === 0 ? (
          <div className="empty-state">No originals</div>
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
      <div className="panel-footer">
        <button className="drop-target" type="button" onClick={onAdd}>
          <ImagePlus size={14} />
          Drop or add
        </button>
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
