import React from "react";
import { Trash2 } from "lucide-react";
import type { LutEntry, OpCatalogItem } from "@shared/types/ipc";
import type { OpInstance } from "@shared/types/op";
import type { Task } from "@shared/types/project";
import { api } from "@renderer/ipc/client";

type OpsPanelProps = {
  activeTask: Task | null;
  luts: LutEntry[];
  opCatalog: OpCatalogItem[];
  onAddOp(opType: string): void;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOpEnabledChange(opIndex: number, enabled: boolean): void;
  onOpParamChange(opIndex: number, key: string, value: unknown): void;
  onOutputChange(key: string, value: unknown): void;
  onRemoveOp(opIndex: number): void;
};

export function OpsPanel({
  activeTask,
  luts,
  opCatalog,
  onAddOp,
  onAnalyzeContentChange,
  onCustomSlugChange,
  onOpEnabledChange,
  onOpParamChange,
  onOutputChange,
  onRemoveOp
}: OpsPanelProps): React.JSX.Element {
  return (
    <aside className="panel ops-panel">
      <PanelHeader title="Ops" />
      {activeTask ? (
        <div className="current-ops">
          {activeTask.pipeline.ops.length ? activeTask.pipeline.ops.map((op, index) => (
            <PipelineOpCard
              catalogItem={opCatalog.find((item) => item.type === op.type) ?? null}
              disabled={activeTask.status !== "pending"}
              index={index}
              key={`${op.type}-${index}`}
              luts={luts}
              op={op}
              onEnabledChange={(enabled) => onOpEnabledChange(index, enabled)}
              onParamChange={(key, value) => onOpParamChange(index, key, value)}
              onRemove={() => onRemoveOp(index)}
            />
          )) : (
            <div className="ops-empty">No ops in this task</div>
          )}
        </div>
      ) : null}
      {["Geometry", "Tone", "Effects", "Redaction", "Metadata", "Output"].map((section) => (
        <section className="op-section" key={section}>
          <h3>{section}</h3>
          {section === "Output" ? (
            <OutputControls
              disabled={!activeTask || activeTask.status !== "pending"}
              task={activeTask}
              onAnalyzeContentChange={onAnalyzeContentChange}
              onCustomSlugChange={onCustomSlugChange}
              onOutputChange={onOutputChange}
            />
          ) : (
            <div className="op-buttons">
              {opCatalog.filter((op) => op.category === section).map((op) => (
                <button className="toolbar-button full-width" disabled={!activeTask || activeTask.status !== "pending"} key={op.type} type="button" onClick={() => onAddOp(op.type)}>
                  Add {op.label}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </aside>
  );
}

function PipelineOpCard({
  catalogItem,
  disabled,
  index,
  op,
  onEnabledChange,
  luts,
  onParamChange,
  onRemove
}: {
  catalogItem: OpCatalogItem | null;
  disabled: boolean;
  index: number;
  luts: LutEntry[];
  op: OpInstance;
  onEnabledChange(enabled: boolean): void;
  onParamChange(key: string, value: unknown): void;
  onRemove(): void;
}): React.JSX.Element {
  return (
    <section className="pipeline-op-card">
      <div className="op-card-header">
        <label className="toggle-row">
          <input type="checkbox" checked={op.enabled} disabled={disabled} onChange={(event) => onEnabledChange(event.currentTarget.checked)} />
          {index + 1}. {catalogItem?.label ?? op.type}
        </label>
        <button className="icon-button compact" type="button" title="Remove op" disabled={disabled} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <OpParams op={op} disabled={disabled} luts={luts} onParamChange={onParamChange} />
    </section>
  );
}

function OpParams({
  disabled,
  luts,
  op,
  onParamChange
}: {
  disabled: boolean;
  luts: LutEntry[];
  op: OpInstance;
  onParamChange(key: string, value: unknown): void;
}): React.JSX.Element {
  if (op.type === "resize") {
    return (
      <div className="field-grid">
        <label>
          Mode
          <select disabled={disabled} value={stringValue(op.params.mode, "long-edge")} onChange={(event) => onParamChange("mode", event.currentTarget.value)}>
            {["fit", "fill", "width", "height", "long-edge", "short-edge"].map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </label>
        <label>
          Pixels
          <input disabled={disabled} min={1} type="number" value={numberValue(op.params.value, 1920)} onChange={(event) => onParamChange("value", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "rotate") {
    return (
      <div className="field-grid">
        <label>
          Degrees
          <input disabled={disabled} max={180} min={-180} type="number" value={numberValue(op.params.degrees, 0)} onChange={(event) => onParamChange("degrees", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Fill
          <input disabled={disabled} type="color" value={stringValue(op.params.fillColor, "#ffffff")} onChange={(event) => onParamChange("fillColor", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "crop") {
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input disabled={disabled} max={1} min={0} step={0.01} type="number" value={numberValue(op.params[key], key === "w" || key === "h" ? 1 : 0)} onChange={(event) => onParamChange(key, event.currentTarget.valueAsNumber)} />
          </label>
        ))}
      </div>
    );
  }

  if (op.type === "levels") {
    return (
      <div className="field-grid">
        <label>
          Black
          <input disabled={disabled} max={254} min={0} type="number" value={numberValue(op.params.blackPoint, 0)} onChange={(event) => onParamChange("blackPoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          White
          <input disabled={disabled} max={255} min={1} type="number" value={numberValue(op.params.whitePoint, 255)} onChange={(event) => onParamChange("whitePoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Gamma
          <input disabled={disabled} max={5} min={0.1} step={0.05} type="number" value={numberValue(op.params.gamma, 1)} onChange={(event) => onParamChange("gamma", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "white-balance") {
    return (
      <div className="field-grid">
        <label>
          Temperature
          <input disabled={disabled} max={100} min={-100} type="number" value={numberValue(op.params.temperature, 0)} onChange={(event) => onParamChange("temperature", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Tint
          <input disabled={disabled} max={100} min={-100} type="number" value={numberValue(op.params.tint, 0)} onChange={(event) => onParamChange("tint", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "auto-tone") {
    return (
      <div className="field-grid">
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={op.params.enabled !== false} onChange={(event) => onParamChange("enabled", event.currentTarget.checked)} />
          Enabled
        </label>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 0.7)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "curves") {
    const points = curvePointsValue(op.params.rgb);
    return (
      <div className="field-grid">
        {points.map((point, index) => (
          <React.Fragment key={index}>
            <label>
              In {index + 1}
              <input disabled={disabled} max={255} min={0} type="number" value={point[0]} onChange={(event) => onParamChange("rgb", points.map((item, itemIndex) => itemIndex === index ? [event.currentTarget.valueAsNumber, item[1]] : item))} />
            </label>
            <label>
              Out {index + 1}
              <input disabled={disabled} max={255} min={0} type="number" value={point[1]} onChange={(event) => onParamChange("rgb", points.map((item, itemIndex) => itemIndex === index ? [item[0], event.currentTarget.valueAsNumber] : item))} />
            </label>
          </React.Fragment>
        ))}
      </div>
    );
  }

  if (op.type === "hsl") {
    return (
      <div className="hsl-grid">
        {hslRanges.map((range) => {
          const params = hslRangeValue(op.params[range]);
          return (
            <div className="hsl-row" key={range}>
              <span>{range}</span>
              {(["hue", "sat", "lum"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    disabled={disabled}
                    max={key === "hue" ? 180 : 1}
                    min={key === "hue" ? -180 : -1}
                    step={key === "hue" ? 1 : 0.05}
                    type="number"
                    value={params[key]}
                    onChange={(event) => onParamChange(range, { ...params, [key]: event.currentTarget.valueAsNumber })}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (op.type === "unsharp-mask") {
    return (
      <div className="field-grid">
        <label>
          Radius
          <input disabled={disabled} min={0.3} step={0.1} type="number" value={numberValue(op.params.radius, 1)} onChange={(event) => onParamChange("radius", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Amount
          <input disabled={disabled} min={0} step={0.1} type="number" value={numberValue(op.params.amount, 1)} onChange={(event) => onParamChange("amount", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={op.params.outputSharpen === true} onChange={(event) => onParamChange("outputSharpen", event.currentTarget.checked)} />
          Output sharpen
        </label>
      </div>
    );
  }

  if (op.type === "denoise") {
    return (
      <label className="stacked-field">
        Strength
        <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 0.3)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
      </label>
    );
  }

  if (op.type === "lut") {
    return (
      <div className="field-grid">
        <label className="span-two">
          Saved LUT
          <select disabled={disabled || luts.length === 0} value={stringValue(op.params.cubePath, "")} onChange={(event) => onParamChange("cubePath", event.currentTarget.value)}>
            <option value="">Choose a LUT</option>
            {luts.map((lut) => <option key={lut.path} value={lut.path}>{lut.builtin ? "Built-in: " : ""}{lut.name}</option>)}
          </select>
        </label>
        <label className="span-two">
          .cube path
          <input disabled={disabled} type="text" value={stringValue(op.params.cubePath, "")} onChange={(event) => onParamChange("cubePath", event.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Cube LUT", extensions: ["cube"] });
          if (picked) onParamChange("cubePath", picked);
        }}>Browse LUT...</button>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 1)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "redact-fill") {
    const rect = firstRect(op.params.rects);
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input
              disabled={disabled}
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={numberValue(rect[key as keyof typeof rect], key === "w" || key === "h" ? 0.25 : 0)}
              onChange={(event) => onParamChange("rects", [{ ...rect, [key]: event.currentTarget.valueAsNumber }])}
            />
          </label>
        ))}
        <label className="span-two">
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#000000")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "redact-blur" || op.type === "redact-pixelate") {
    const rect = firstRect(op.params.rects);
    const sizeKey = op.type === "redact-blur" ? "radius" : "blockSize";
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input
              disabled={disabled}
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={numberValue(rect[key as keyof typeof rect], key === "w" || key === "h" ? 0.25 : 0)}
              onChange={(event) => onParamChange("rects", [{ ...rect, [key]: event.currentTarget.valueAsNumber }])}
            />
          </label>
        ))}
        <label className="span-two">
          {op.type === "redact-blur" ? "Radius" : "Block size"}
          <input disabled={disabled} min={0.001} step={0.005} type="number" value={numberValue(op.params[sizeKey], op.type === "redact-blur" ? 0.02 : 0.015)} onChange={(event) => onParamChange(sizeKey, event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "watermark-text") {
    return (
      <div className="field-grid">
        <label className="span-two">
          Text
          <input disabled={disabled} type="text" value={stringValue(op.params.text, "")} onChange={(event) => onParamChange("text", event.currentTarget.value)} />
        </label>
        <label>
          Anchor
          <select disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(event) => onParamChange("anchor", event.currentTarget.value)}>
            {["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"].map((anchor) => <option key={anchor}>{anchor}</option>)}
          </select>
        </label>
        <label>
          Size
          <input disabled={disabled} max={0.2} min={0.005} step={0.005} type="number" value={numberValue(op.params.size, 0.03)} onChange={(event) => onParamChange("size", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Opacity
          <input disabled={disabled} max={1} min={0} step={0.05} type="number" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#ffffff")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "watermark-image") {
    return (
      <div className="field-grid">
        <label className="span-two">
          PNG path
          <input disabled={disabled} type="text" value={stringValue(op.params.pngPath, "")} onChange={(event) => onParamChange("pngPath", event.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Watermark PNG", extensions: ["png"] });
          if (picked) onParamChange("pngPath", picked);
        }}>Browse PNG...</button>
        <label>
          Anchor
          <select disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(event) => onParamChange("anchor", event.currentTarget.value)}>
            {["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"].map((anchor) => <option key={anchor}>{anchor}</option>)}
          </select>
        </label>
        <label>
          Scale
          <input disabled={disabled} max={1} min={0.01} step={0.01} type="number" value={numberValue(op.params.scale, 0.15)} onChange={(event) => onParamChange("scale", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity
          <input disabled={disabled} max={1} min={0} step={0.05} type="number" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "strip-metadata") {
    const keep = metadataKeepValue(op.params.keep);
    return (
      <div className="field-grid">
        {(["author", "copyright", "orientation", "colorspace"] as const).map((field) => (
          <label className="toggle-row" key={field}>
            <input
              disabled={disabled}
              type="checkbox"
              checked={keep.includes(field)}
              onChange={(event) => onParamChange("keep", event.currentTarget.checked ? [...keep, field] : keep.filter((item) => item !== field))}
            />
            Keep {field}
          </label>
        ))}
      </div>
    );
  }

  if (op.type === "inject-metadata") {
    const fields = metadataFieldsValue(op.params.fields);
    return (
      <div className="field-grid">
        {(["author", "copyright", "description", "credit"] as const).map((field) => (
          <label className="stacked-field" key={field}>
            {field}
            <input disabled={disabled} type="text" value={fields[field] ?? ""} onChange={(event) => onParamChange("fields", { ...fields, [field]: event.currentTarget.value })} />
          </label>
        ))}
      </div>
    );
  }

  return <div className="row-detail">No editable parameters.</div>;
}

function OutputControls({
  disabled,
  task,
  onAnalyzeContentChange,
  onCustomSlugChange,
  onOutputChange
}: {
  disabled: boolean;
  task: Task | null;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOutputChange(key: string, value: unknown): void;
}): React.JSX.Element {
  return (
    <div className="output-controls">
      <label className="toggle-row" title="When this task is saved, use AI to generate a description of the image. Used for alt text, slugs, and notes.">
        <input type="checkbox" disabled={disabled || !task} checked={task?.analyzeContent ?? true} onChange={(event) => onAnalyzeContentChange(event.currentTarget.checked)} />
        Describe contents
      </label>
      {task?.output?.vision ? (
        <div className="vision-description">
          <span>Generated description</span>
          <p>{task.output.vision.description}</p>
        </div>
      ) : task?.error?.stage === "vision" ? (
        <div className="modal-error">{task.error.message}</div>
      ) : null}
      <label className="stacked-field">
        Custom slug
        <input disabled={disabled || !task} placeholder="manual-descriptive-slug" type="text" value={task?.customSlug ?? ""} onChange={(event) => onCustomSlugChange(event.currentTarget.value || null)} />
      </label>
      <label className="stacked-field">
        Format
        <select disabled={disabled || !task} value={task?.pipeline.output.format ?? "webp"} onChange={(event) => onOutputChange("format", event.currentTarget.value)}>
          {["jpeg", "webp", "avif", "png"].map((format) => <option key={format}>{format}</option>)}
        </select>
      </label>
      <label className="stacked-field">
        Quality
        <input disabled={disabled || !task || typeof task?.pipeline.output.quality !== "number"} max={100} min={1} type="number" value={typeof task?.pipeline.output.quality === "number" ? task.pipeline.output.quality : 82} onChange={(event) => onOutputChange("quality", event.currentTarget.valueAsNumber)} />
      </label>
      {task?.pipeline.output.format === "jpeg" ? (
        <label className="stacked-field">
          JPEG strategy
          <select
            disabled={disabled || !task}
            value={typeof task.pipeline.output.quality === "number" ? "fixed" : task.pipeline.output.quality}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onOutputChange("quality", value === "fixed" ? 85 : value);
            }}
          >
            <option value="fixed">fixed</option>
            <option value="match-source-quality">match-source-quality</option>
            <option value="match-source-size">match-source-size</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const hslRanges = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;

function curvePointsValue(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
  const points = value.filter((point): point is [number, number] =>
    Array.isArray(point) &&
    typeof point[0] === "number" &&
    typeof point[1] === "number"
  );
  return points.length ? points : [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
}

function hslRangeValue(value: unknown): { hue: number; sat: number; lum: number } {
  const params = value && typeof value === "object" ? value as Partial<{ hue: number; sat: number; lum: number }> : {};
  return {
    hue: numberValue(params.hue, 0),
    sat: numberValue(params.sat, 0),
    lum: numberValue(params.lum, 0)
  };
}

function metadataKeepValue(value: unknown): Array<"author" | "copyright" | "orientation" | "colorspace"> {
  const allowed = ["author", "copyright", "orientation", "colorspace"] as const;
  if (!Array.isArray(value)) return [...allowed];
  return value.filter((item): item is typeof allowed[number] => allowed.some((field) => field === item));
}

function metadataFieldsValue(value: unknown): Record<string, string> {
  return value && typeof value === "object" ? value as Record<string, string> : {};
}

function firstRect(value: unknown): { x: number; y: number; w: number; h: number } {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    const rect = value[0] as Partial<{ x: number; y: number; w: number; h: number }>;
    return {
      x: numberValue(rect.x, 0),
      y: numberValue(rect.y, 0),
      w: numberValue(rect.w, 0.25),
      h: numberValue(rect.h, 0.25)
    };
  }
  return { x: 0, y: 0, w: 0.25, h: 0.25 };
}
