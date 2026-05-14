import React from "react";
import { Trash2 } from "lucide-react";
import type { LutEntry, OpCatalogItem } from "@shared/types/ipc";
import type { OpInstance } from "@shared/types/op";
import type { Task } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import { applyCropAspect, cropAspectOptionId, cropRectFromOp, fullCropRect, imageBoundsFromSize, resolveCropAspectRatio } from "@renderer/canvas/op-overlays";
import { api } from "@renderer/ipc/client";

type OpsPanelProps = {
  activeTask: Task | null;
  hasGeminiApiKey: boolean;
  luts: LutEntry[];
  opCatalog: OpCatalogItem[];
  originalSize: { width: number; height: number } | null;
  onOpenSettings(): void;
  settings: GlobalSettings | null;
  selectedOpIndex: number | null;
  onAddOp(opType: string): void;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOpEnabledChange(opIndex: number, enabled: boolean): void;
  onOpParamChange(opIndex: number, key: string, value: unknown): void;
  onOpParamsChange(opIndex: number, patch: Record<string, unknown>): void;
  onOutputChange(key: string, value: unknown): void;
  onRemoveOp(opIndex: number): void;
  onSelectOp(opIndex: number): void;
};

export function OpsPanel({
  activeTask,
  hasGeminiApiKey,
  luts,
  opCatalog,
  originalSize,
  onOpenSettings,
  settings,
  selectedOpIndex,
  onAddOp,
  onAnalyzeContentChange,
  onCustomSlugChange,
  onOpEnabledChange,
  onOpParamChange,
  onOpParamsChange,
  onOutputChange,
  onRemoveOp,
  onSelectOp
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
              onParamsChange={(patch) => onOpParamsChange(index, patch)}
              onRemove={() => onRemoveOp(index)}
              onSelect={() => onSelectOp(index)}
              originalSize={originalSize}
              selected={selectedOpIndex === index}
            />
          )) : (
            <div className="ops-empty">No ops in this task</div>
          )}
        </div>
      ) : null}
      {["Geometry", "Tone", "Effects", "Redaction", "Watermark", "Metadata", "Output"].map((section) => (
        <section className="op-section" key={section}>
          <h3>{section}</h3>
          {section === "Output" ? (
            <OutputControls
              disabled={!activeTask || activeTask.status !== "pending"}
              hasGeminiApiKey={hasGeminiApiKey}
              onOpenSettings={onOpenSettings}
              settings={settings}
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
  onParamsChange,
  onRemove,
  onSelect,
  originalSize,
  selected
}: {
  catalogItem: OpCatalogItem | null;
  disabled: boolean;
  index: number;
  luts: LutEntry[];
  op: OpInstance;
  onEnabledChange(enabled: boolean): void;
  onParamChange(key: string, value: unknown): void;
  onParamsChange(patch: Record<string, unknown>): void;
  onRemove(): void;
  onSelect(): void;
  originalSize: { width: number; height: number } | null;
  selected: boolean;
}): React.JSX.Element {
  return (
    <section className={`pipeline-op-card ${selected ? "active" : ""}`} onClick={onSelect}>
      <div className="op-card-header">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={op.enabled}
            disabled={disabled}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            onClick={(event) => event.stopPropagation()}
          />
          {index + 1}. {catalogItem?.label ?? op.type}
        </label>
        <button className="icon-button compact" type="button" title="Remove op" disabled={disabled} onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}>
          <Trash2 size={14} />
        </button>
      </div>
      <OpParams disabled={disabled} luts={luts} onParamChange={onParamChange} onParamsChange={onParamsChange} op={op} originalSize={originalSize} />
    </section>
  );
}

function OpParams({
  disabled,
  luts,
  op,
  onParamChange,
  onParamsChange,
  originalSize
}: {
  disabled: boolean;
  luts: LutEntry[];
  op: OpInstance;
  onParamChange(key: string, value: unknown): void;
  onParamsChange(patch: Record<string, unknown>): void;
  originalSize: { width: number; height: number } | null;
}): React.JSX.Element {
  if (op.type === "resize") {
    return (
      <ResizeControls disabled={disabled} mode={resizeModeValue(op.params.mode)} onParamChange={onParamChange} value={numberValue(op.params.value, 1920)} />
    );
  }

  if (op.type === "rotate") {
    return (
      <RotateControls
        degrees={numberValue(op.params.degrees, 0)}
        disabled={disabled}
        fillColor={stringValue(op.params.fillColor, "#ffffff")}
        onParamChange={onParamChange}
      />
    );
  }

  if (op.type === "crop") {
    const originalAspectRatio = originalSize ? originalSize.width / Math.max(1, originalSize.height) : null;
    const imageBounds = originalSize ? imageBoundsFromSize(originalSize) : { maxX: 1, maxY: 1 };
    return (
      <CropControls
        aspectLock={op.params.aspectLock}
        currentRect={cropRectFromOp(op, imageBounds)}
        disabled={disabled}
        imageBounds={imageBounds}
        onParamChange={onParamChange}
        onParamsChange={onParamsChange}
        originalAspectRatio={originalAspectRatio}
      />
    );
  }

  if (op.type === "levels") {
    return (
      <div className="field-grid">
        <label className="span-two">
          Black point — <strong>{numberValue(op.params.blackPoint, 0)}</strong>
          <input disabled={disabled} max={254} min={0} step={1} type="range" value={numberValue(op.params.blackPoint, 0)} onChange={(event) => onParamChange("blackPoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          White point — <strong>{numberValue(op.params.whitePoint, 255)}</strong>
          <input disabled={disabled} max={255} min={1} step={1} type="range" value={numberValue(op.params.whitePoint, 255)} onChange={(event) => onParamChange("whitePoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Gamma — <strong>{numberValue(op.params.gamma, 1).toFixed(2)}</strong>
          <input disabled={disabled} max={5} min={0.1} step={0.05} type="range" value={numberValue(op.params.gamma, 1)} onChange={(event) => onParamChange("gamma", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "white-balance") {
    const samplePoint = samplePointValue(op.params.samplePoint);
    return (
      <div className="field-grid">
        <label className="span-two">
          Temperature — <strong>{numberValue(op.params.temperature, 0)}</strong>
          <input disabled={disabled || samplePoint !== null} max={100} min={-100} step={1} type="range" value={numberValue(op.params.temperature, 0)} onChange={(event) => onParamChange("temperature", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Tint — <strong>{numberValue(op.params.tint, 0)}</strong>
          <input disabled={disabled || samplePoint !== null} max={100} min={-100} step={1} type="range" value={numberValue(op.params.tint, 0)} onChange={(event) => onParamChange("tint", event.currentTarget.valueAsNumber)} />
        </label>
        <div className="row-detail span-two">
          {samplePoint
            ? `Preview sample active at ${samplePoint[0].toFixed(3)}, ${samplePoint[1].toFixed(3)}.`
            : "Click the preview while this op is selected to sample a neutral point."}
        </div>
        {samplePoint ? (
          <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={() => onParamChange("samplePoint", null)}>
            Use temperature/tint sliders
          </button>
        ) : null}
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
    const labels = ["Shadows", "Dark", "Midtones", "Light", "Highlights"];
    const inputValues = [0, 64, 128, 192, 255];
    return (
      <div className="field-grid">
        {points.map((point, index) => (
          <label className="span-two" key={index}>
            {labels[index] ?? `Point ${index + 1}`} — in {inputValues[index] ?? point[0]}, out <strong>{point[1]}</strong>
            <input
              disabled={disabled}
              max={255}
              min={0}
              step={1}
              type="range"
              value={point[1]}
              onChange={(event) => onParamChange("rgb", points.map((item, itemIndex) => itemIndex === index ? [item[0], event.currentTarget.valueAsNumber] : item))}
            />
          </label>
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
                  {key} <strong>{key === "hue" ? Math.round(params[key]) : params[key].toFixed(2)}</strong>
                  <input
                    disabled={disabled}
                    max={key === "hue" ? 180 : 1}
                    min={key === "hue" ? -180 : -1}
                    step={key === "hue" ? 1 : 0.01}
                    type="range"
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
        <label className="span-two">
          Radius — <strong>{numberValue(op.params.radius, 1).toFixed(1)}</strong>
          <input disabled={disabled} max={10} min={0.3} step={0.1} type="range" value={numberValue(op.params.radius, 1)} onChange={(event) => onParamChange("radius", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Amount — <strong>{numberValue(op.params.amount, 1).toFixed(1)}</strong>
          <input disabled={disabled} max={5} min={0} step={0.1} type="range" value={numberValue(op.params.amount, 1)} onChange={(event) => onParamChange("amount", event.currentTarget.valueAsNumber)} />
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
    return (
      <div className="field-grid">
        <label className="span-two">
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#000000")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
        <div className="row-detail span-two">Drag the rectangle on the preview to position and size it.</div>
      </div>
    );
  }

  if (op.type === "redact-blur" || op.type === "redact-pixelate") {
    const sizeKey = op.type === "redact-blur" ? "radius" : "blockSize";
    const defaultSize = op.type === "redact-blur" ? 0.02 : 0.015;
    const maxSize = op.type === "redact-blur" ? 0.1 : 0.05;
    return (
      <div className="field-grid">
        <label className="span-two">
          {op.type === "redact-blur" ? "Radius" : "Block size"} — <strong>{numberValue(op.params[sizeKey], defaultSize).toFixed(3)}</strong>
          <input disabled={disabled} max={maxSize} min={0.005} step={0.005} type="range" value={numberValue(op.params[sizeKey], defaultSize)} onChange={(event) => onParamChange(sizeKey, event.currentTarget.valueAsNumber)} />
        </label>
        <div className="row-detail span-two">Drag the rectangle on the preview to position and size it.</div>
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
        <label className="span-two">
          Size — <strong>{numberValue(op.params.size, 0.03).toFixed(3)}</strong>
          <input disabled={disabled} max={0.2} min={0.005} step={0.005} type="range" value={numberValue(op.params.size, 0.03)} onChange={(event) => onParamChange("size", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity — <strong>{numberValue(op.params.opacity, 0.7).toFixed(2)}</strong>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#ffffff")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
        <div className="stacked-field">
          Position
          <AnchorPicker disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(anchor) => onParamChange("anchor", anchor)} />
        </div>
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
        <label className="span-two">
          Scale — <strong>{numberValue(op.params.scale, 0.15).toFixed(2)}</strong>
          <input disabled={disabled} max={0.5} min={0.01} step={0.01} type="range" value={numberValue(op.params.scale, 0.15)} onChange={(event) => onParamChange("scale", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity — <strong>{numberValue(op.params.opacity, 0.7).toFixed(2)}</strong>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
        <div className="stacked-field span-two">
          Position
          <AnchorPicker disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(anchor) => onParamChange("anchor", anchor)} />
        </div>
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

function CropControls({
  aspectLock,
  currentRect,
  disabled,
  imageBounds,
  onParamChange,
  onParamsChange,
  originalAspectRatio
}: {
  aspectLock: unknown;
  currentRect: { x: number; y: number; w: number; h: number };
  disabled: boolean;
  imageBounds: { maxX: number; maxY: number };
  onParamChange(key: string, value: unknown): void;
  onParamsChange(patch: Record<string, unknown>): void;
  originalAspectRatio: number | null;
}): React.JSX.Element {
  const activeAspectId = cropAspectOptionId(aspectLock, originalAspectRatio);

  function handleAspectChange(nextAspectId: CropAspectOptionId): void {
    if (nextAspectId === "free") {
      onParamChange("aspectLock", null);
      return;
    }

    const aspectRatio = resolveCropAspectRatio(nextAspectId, originalAspectRatio);
    if (!aspectRatio) return;
    const nextRect = applyCropAspect(currentRect, aspectRatio, imageBounds);
    onParamsChange({
      ...nextRect,
      aspectLock: nextAspectId
    });
  }

  return (
    <div className="geometry-controls">
      <div className="geometry-toolbar-row">
        <span className="geometry-status">
          Aspect: <strong>{cropAspectLabel(activeAspectId, currentRect)}</strong>
        </span>
        <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamsChange({ ...fullCropRect(imageBounds), aspectLock: null })}>
          Reset crop
        </button>
      </div>
      <div className="geometry-chip-group" role="group" aria-label="Crop aspect ratio">
        {cropAspectOptions.map((option) => (
          <button
            className={`geometry-chip ${activeAspectId === option.id ? "active" : ""}`}
            disabled={disabled}
            key={option.id}
            type="button"
            onClick={() => handleAspectChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="geometry-help">Drag the crop lines on the preview. Use these chips here to keep or change the aspect ratio.</div>
    </div>
  );
}

function RotateControls({
  degrees,
  disabled,
  fillColor,
  onParamChange
}: {
  degrees: number;
  disabled: boolean;
  fillColor: string;
  onParamChange(key: string, value: unknown): void;
}): React.JSX.Element {
  return (
    <div className="geometry-controls">
      <div className="geometry-toolbar-row">
        <div className="geometry-stepper-group">
          <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", normalizeDegrees(degrees - 90))}>
            -90°
          </button>
          <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", normalizeDegrees(degrees + 90))}>
            +90°
          </button>
          <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", 0)}>
            Reset
          </button>
        </div>
        <span className="geometry-status">
          Angle: <strong>{formatDegrees(degrees)}</strong>
        </span>
      </div>
      <label className="stacked-field geometry-range-field">
        Rotate left / right
        <input
          disabled={disabled}
          max={180}
          min={-180}
          step={1}
          type="range"
          value={degrees}
          onChange={(event) => onParamChange("degrees", event.currentTarget.valueAsNumber)}
        />
      </label>
      <div className="geometry-toolbar-row">
        <span className="geometry-status">Fill</span>
        <div className="geometry-swatch-group" role="group" aria-label="Rotate fill color">
          {rotateFillSwatches.map((swatch) => (
            <button
              aria-label={`Use fill color ${swatch}`}
              className={`color-swatch ${fillColor.toLowerCase() === swatch ? "active" : ""}`}
              disabled={disabled}
              key={swatch}
              style={{ background: swatch }}
              type="button"
              onClick={() => onParamChange("fillColor", swatch)}
            />
          ))}
          <label className="color-picker-button">
            <input disabled={disabled} type="color" value={fillColor} onChange={(event) => onParamChange("fillColor", event.currentTarget.value)} />
          </label>
        </div>
      </div>
    </div>
  );
}

function ResizeControls({
  disabled,
  mode,
  onParamChange,
  value
}: {
  disabled: boolean;
  mode: ResizeMode;
  onParamChange(key: string, value: unknown): void;
  value: number;
}): React.JSX.Element {
  const sliderMax = Math.max(7680, Math.ceil(value / 320) * 320);

  function setValue(nextValue: number): void {
    onParamChange("value", Math.max(1, Math.round(nextValue)));
  }

  return (
    <div className="geometry-controls">
      <div className="geometry-toolbar-row">
        <span className="geometry-status">
          Target: <strong>{value}px</strong>
        </span>
        <div className="geometry-stepper-group">
          {[-100, -10, 10, 100].map((delta) => (
            <button className="inline-action" disabled={disabled} key={delta} type="button" onClick={() => setValue(value + delta)}>
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>
      </div>
      <div className="geometry-chip-group" role="group" aria-label="Resize mode">
        {resizeModeOptions.map((option) => (
          <button
            className={`geometry-chip ${mode === option.id ? "active" : ""}`}
            disabled={disabled}
            key={option.id}
            type="button"
            onClick={() => onParamChange("mode", option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="stacked-field geometry-range-field">
        Size
        <input disabled={disabled} max={sliderMax} min={64} step={16} type="range" value={value} onChange={(event) => setValue(event.currentTarget.valueAsNumber)} />
      </label>
      <div className="geometry-chip-group" role="group" aria-label="Common resize presets">
        {resizePresets.map((preset) => (
          <button className="geometry-chip" disabled={disabled} key={preset} type="button" onClick={() => setValue(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <div className="geometry-toolbar-row">
        <label className="stacked-field geometry-number-field">
          Custom size
          <input disabled={disabled} min={1} type="number" value={value} onChange={(event) => setValue(event.currentTarget.valueAsNumber)} />
        </label>
        <div className="geometry-help">{resizeModeDescription(mode, value)}</div>
      </div>
    </div>
  );
}

function OutputControls({
  disabled,
  hasGeminiApiKey,
  onOpenSettings,
  settings,
  task,
  onAnalyzeContentChange,
  onCustomSlugChange,
  onOutputChange
}: {
  disabled: boolean;
  hasGeminiApiKey: boolean;
  onOpenSettings(): void;
  settings: GlobalSettings | null;
  task: Task | null;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOutputChange(key: string, value: unknown): void;
}): React.JSX.Element {
  const jpegQualityMode = typeof task?.pipeline.output.quality === "number" ? "fixed" : task?.pipeline.output.quality ?? "fixed";
  const defaultFixedQuality = settings?.jpegFixedQuality ?? 85;
  const promptPerTask = settings?.jpegStrategy === "prompt-per-task";
  return (
    <div className="output-controls">
      <label className="toggle-row" title="When this task is saved, use AI to generate a description of the image. Used for alt text, slugs, and notes.">
        <input type="checkbox" disabled={disabled || !task} checked={task?.analyzeContent ?? true} onChange={(event) => onAnalyzeContentChange(event.currentTarget.checked)} />
        Describe contents
      </label>
      {task?.analyzeContent && !task.output?.vision && !hasGeminiApiKey ? (
        <div className="modal-warning">
          Gemini API key required for description generation.
          <button className="inline-action" type="button" onClick={onOpenSettings}>Open settings</button>
        </div>
      ) : task?.output?.vision ? (
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
        Quality — <strong>{typeof task?.pipeline.output.quality === "number" ? task.pipeline.output.quality : 82}</strong>
        <input
          disabled={disabled || !task || (task.pipeline.output.format === "jpeg" && typeof task.pipeline.output.quality !== "number")}
          max={100}
          min={1}
          step={1}
          type="range"
          value={typeof task?.pipeline.output.quality === "number" ? task.pipeline.output.quality : 82}
          onChange={(event) => onOutputChange("quality", event.currentTarget.valueAsNumber)}
        />
      </label>
      {task?.pipeline.output.format === "jpeg" ? (
        <label className="stacked-field">
          JPEG strategy
          <select
            disabled={disabled || !task}
            value={jpegQualityMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onOutputChange("quality", value === "fixed" ? (typeof task.pipeline.output.quality === "number" ? task.pipeline.output.quality : defaultFixedQuality) : value);
            }}
          >
            <option value="fixed">fixed</option>
            <option value="match-source-quality">match-source-quality</option>
            <option value="match-source-size">match-source-size</option>
          </select>
        </label>
      ) : null}
      {task?.pipeline.output.format === "jpeg" && promptPerTask ? (
        <div className="row-detail">Global JPEG strategy is prompt-per-task, so this task can keep its own fixed JPEG quality.</div>
      ) : null}
    </div>
  );
}

function AnchorPicker({ disabled, value, onChange }: { disabled: boolean; value: string; onChange(anchor: string): void }): React.JSX.Element {
  const anchors = [
    ["top-left", "top", "top-right"],
    ["left", "center", "right"],
    ["bottom-left", "bottom", "bottom-right"]
  ];
  const symbols: Record<string, string> = {
    "top-left": "↖", "top": "↑", "top-right": "↗",
    "left": "←", "center": "·", "right": "→",
    "bottom-left": "↙", "bottom": "↓", "bottom-right": "↘"
  };
  return (
    <div className="anchor-grid">
      {anchors.flat().map((anchor) => (
        <button
          className={`${value === anchor ? "active" : ""}`}
          disabled={disabled}
          key={anchor}
          title={anchor}
          type="button"
          onClick={() => onChange(anchor)}
        >
          {symbols[anchor]}
        </button>
      ))}
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

const cropAspectOptions = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "3:2", label: "3:2" },
  { id: "16:9", label: "16:9" }
] as const;

const resizeModeOptions = [
  { id: "long-edge", label: "Long edge" },
  { id: "short-edge", label: "Short edge" },
  { id: "width", label: "Width" },
  { id: "height", label: "Height" },
  { id: "fit", label: "Fit" },
  { id: "fill", label: "Fill" }
] as const;

const resizePresets = [640, 1200, 1600, 1920, 2560, 3840] as const;
const rotateFillSwatches = ["#ffffff", "#000000", "#f5f5f5", "#e5e7eb", "#dbeafe"] as const;

type CropAspectOptionId = (typeof cropAspectOptions)[number]["id"];
type ResizeMode = (typeof resizeModeOptions)[number]["id"];

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function cropAspectLabel(aspectId: CropAspectOptionId | "custom", rect: { w: number; h: number }): string {
  if (aspectId === "custom") {
    return `${(rect.w / Math.max(rect.h, 0.001)).toFixed(2)}:1`;
  }
  return cropAspectOptions.find((option) => option.id === aspectId)?.label ?? "Free";
}

function normalizeDegrees(value: number): number {
  let next = Math.round(value);
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function formatDegrees(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value)}°`;
}

function resizeModeValue(value: unknown): ResizeMode {
  return typeof value === "string" && resizeModeOptions.some((option) => option.id === value) ? (value as ResizeMode) : "long-edge";
}

function resizeModeDescription(mode: ResizeMode, value: number): string {
  switch (mode) {
    case "long-edge":
      return `Set the long edge to ${value}px and preserve aspect ratio.`;
    case "short-edge":
      return `Set the short edge to ${value}px and preserve aspect ratio.`;
    case "width":
      return `Force width to ${value}px and derive height automatically.`;
    case "height":
      return `Force height to ${value}px and derive width automatically.`;
    case "fit":
      return `Fit the image inside a ${value}px square.`;
    case "fill":
      return `Fill a ${value}px square and crop to cover.`;
  }
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

function samplePointValue(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return null;
  return [value[0], value[1]];
}
