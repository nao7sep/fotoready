import React from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { LutEntry, OpCatalogItem } from "@shared/types/ipc";
import type { OpInstance } from "@shared/types/op";
import type { Task } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import { getOpRenderer } from "@renderer/ops";

const ADD_OP_SECTIONS = ["Geometry", "Tone", "Effects", "Redaction", "Watermark", "Metadata"] as const;

type OpsPanelProps = {
  activeTask: Task | null;
  hasGeminiApiKey: boolean;
  luts: LutEntry[];
  opCatalog: OpCatalogItem[];
  originalSize: { width: number; height: number } | null;
  onOpenSettings(): void;
  settings: GlobalSettings | null;
  selectedOpId: string | null;
  onAddOp(opType: string): void;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onMoveOp(opId: string, toIndex: number): void;
  onOpEnabledChange(opId: string, enabled: boolean): void;
  onOpParamChange(opId: string, key: string, value: unknown): void;
  onOpParamsChange(opId: string, patch: Record<string, unknown>): void;
  onOutputChange(key: string, value: unknown): void;
  onRemoveOp(opId: string): void;
  onSelectOp(opId: string): void;
};

export function OpsPanel(props: OpsPanelProps): React.JSX.Element {
  const { activeTask, opCatalog, selectedOpId } = props;

  return (
    <>
      <aside className="panel ops-panel ops-edit-pane">
        <section className="op-section current-ops-section">
          <h3>Ops</h3>
          <div className="current-ops">
            {activeTask ? (
              activeTask.pipeline.ops.length ? activeTask.pipeline.ops.map((op, index) => (
                <PipelineOpCard
                  catalogItem={opCatalog.find((item) => item.type === op.type) ?? null}
                  disabled={activeTask.status !== "pending"}
                  index={index}
                  key={op.id}
                  luts={props.luts}
                  op={op}
                  opCount={activeTask.pipeline.ops.length}
                  onEnabledChange={(enabled) => props.onOpEnabledChange(op.id, enabled)}
                  onMove={(toIndex) => props.onMoveOp(op.id, toIndex)}
                  onParamChange={(key, value) => props.onOpParamChange(op.id, key, value)}
                  onParamsChange={(patch) => props.onOpParamsChange(op.id, patch)}
                  onRemove={() => props.onRemoveOp(op.id)}
                  onSelect={() => props.onSelectOp(op.id)}
                  originalSize={props.originalSize}
                  selected={selectedOpId === op.id}
                />
              )) : <div className="ops-empty">No ops in this task</div>
            ) : <div className="ops-empty">No task selected</div>}
          </div>
        </section>
        <section className="op-section output-section">
          <h3>Output</h3>
          <div className="output-fixed">
            <OutputControls
              disabled={!activeTask || activeTask.status !== "pending"}
              hasGeminiApiKey={props.hasGeminiApiKey}
              onOpenSettings={props.onOpenSettings}
              settings={props.settings}
              task={activeTask}
              onAnalyzeContentChange={props.onAnalyzeContentChange}
              onCustomSlugChange={props.onCustomSlugChange}
              onOutputChange={props.onOutputChange}
            />
          </div>
        </section>
      </aside>
      <aside className="panel ops-panel ops-add-pane">
        {ADD_OP_SECTIONS.map((section) => (
          <section className="op-section" key={section}>
            <h3>{section}</h3>
            <div className="op-buttons">
              {opCatalog.filter((op) => op.category === section).map((op) => (
                <button className="toolbar-button full-width" disabled={!activeTask || activeTask.status !== "pending"} key={op.type} type="button" onClick={() => props.onAddOp(op.type)}>
                  Add {op.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>
    </>
  );
}

function PipelineOpCard({
  catalogItem,
  disabled,
  index,
  op,
  opCount,
  onEnabledChange,
  luts,
  onMove,
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
  opCount: number;
  onEnabledChange(enabled: boolean): void;
  onMove(toIndex: number): void;
  onParamChange(key: string, value: unknown): void;
  onParamsChange(patch: Record<string, unknown>): void;
  onRemove(): void;
  onSelect(): void;
  originalSize: { width: number; height: number } | null;
  selected: boolean;
}): React.JSX.Element {
  const renderer = getOpRenderer(op.type);
  const Card = renderer?.Card;

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
        <div className="op-card-actions">
          <button className="icon-button compact" type="button" title="Move op up" disabled={disabled || index === 0} onClick={(event) => {
            event.stopPropagation();
            onMove(index - 1);
          }}>
            <ArrowUp size={14} />
          </button>
          <button className="icon-button compact" type="button" title="Move op down" disabled={disabled || index >= opCount - 1} onClick={(event) => {
            event.stopPropagation();
            onMove(index + 1);
          }}>
            <ArrowDown size={14} />
          </button>
          <button className="icon-button compact" type="button" title="Remove op" disabled={disabled} onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {Card ? (
        <Card
          params={op.params}
          disabled={disabled}
          ctx={{ luts, originalSize }}
          onParamChange={(key, value) => onParamChange(String(key), value)}
          onParamsChange={(patch) => onParamsChange(patch as Record<string, unknown>)}
        />
      ) : (
        <div className="row-detail">No editable parameters.</div>
      )}
    </section>
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
