import React from "react";
import { ImagePlus } from "lucide-react";
import type { Original } from "@shared/types/project";

export function OriginalsPanel({
  activeOriginalId,
  originals,
  thumbnails,
  onAdd,
  onSelect
}: {
  activeOriginalId: string | null;
  originals: Original[];
  thumbnails: Record<string, string>;
  onAdd(): void;
  onSelect(originalId: string): void;
}): React.JSX.Element {
  return (
    <aside className="panel originals-panel">
      <PanelHeader title="Originals" />
      <button className="drop-target" type="button" onClick={onAdd}>
        <ImagePlus size={18} />
        Add originals
      </button>
      <div className="list">
        {originals.map((original) => (
          <button
            className={`list-row ${activeOriginalId === original.id ? "active" : ""}`}
            key={original.id}
            type="button"
            onClick={() => onSelect(original.id)}
          >
            <span className="thumb">
              {thumbnails[original.id] ? <img src={thumbnails[original.id]} alt="" /> : null}
            </span>
            <span className="row-copy">
              <span className="row-title">{basename(original.sourcePath)}</span>
              <span className="row-detail">{original.width}x{original.height} · {original.format}</span>
            </span>
          </button>
        ))}
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
