import React, { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { LutEntry, OpCatalogItem } from "@shared/types/ipc";
import type { OpInstance } from "@shared/types/op";
import type { Original, Task } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import { availableOutputFormats, formatLabel, resolveOutputFormat } from "@shared/output-format";
import { getOpRenderer } from "@renderer/ops";
import { revealInScrollContainer } from "@renderer/utils/reveal-in-scroll-container";

const ADD_OP_SECTIONS = ["Geometry", "Tone", "Effects", "Conceal", "Watermark", "Metadata"] as const;
const ADD_OP_ORDER: Partial<Record<(typeof ADD_OP_SECTIONS)[number], string[]>> = {
  Tone: ["auto-tone", "levels", "curves", "white-balance", "hsl"]
};

type OpsPanelProps = {
  activeTask: Task | null;
  activeOriginal: Original | null;
  hasGeminiApiKey: boolean;
  luts: LutEntry[];
  opCatalog: OpCatalogItem[];
  pendingRevealOpId: string | null;
  originalSize: { width: number; height: number } | null;
  onOpenSettings(): void;
  onReloadLuts(): Promise<void>;
  onRevealOpHandled(): void;
  settings: GlobalSettings | null;
  selectedOpId: string | null;
  onAddOp(opType: string): void;
  onGenerateDescriptionChange(value: boolean): void;
  onGenerateSlugChange(value: boolean): void;
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
  const { activeTask, opCatalog, pendingRevealOpId, selectedOpId } = props;
  const currentOpsRef = useRef<HTMLDivElement>(null);
  const opRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!pendingRevealOpId) return;
    const element = opRefs.current.get(pendingRevealOpId);
    if (!element) return;
    revealInScrollContainer(currentOpsRef.current, element);
    props.onRevealOpHandled();
  }, [pendingRevealOpId, activeTask?.pipeline.ops, props]);

  return (
    <>
      <aside className="panel ops-panel ops-edit-pane">
        <section className="op-section current-ops-section">
          <h3>Ops</h3>
          <div className="current-ops" ref={currentOpsRef}>
            {activeTask ? (
              activeTask.pipeline.ops.length ? activeTask.pipeline.ops.map((op, index) => (
                <PipelineOpCard
                  cardRef={(element) => {
                    if (element) {
                      opRefs.current.set(op.id, element);
                    } else {
                      opRefs.current.delete(op.id);
                    }
                  }}
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
                  onReloadLuts={props.onReloadLuts}
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
              original={props.activeOriginal}
              settings={props.settings}
              task={activeTask}
              onGenerateDescriptionChange={props.onGenerateDescriptionChange}
              onGenerateSlugChange={props.onGenerateSlugChange}
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
              {sortOpsForSection(opCatalog.filter((op) => op.category === section), section).map((op) => (
                <button className="toolbar-button full-width" disabled={!activeTask || activeTask.status !== "pending"} key={op.type} type="button" onClick={() => props.onAddOp(op.type)}>
                  {op.pickerLabel ?? op.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>
    </>
  );
}

function sortOpsForSection(opCatalog: OpCatalogItem[], section: (typeof ADD_OP_SECTIONS)[number]): OpCatalogItem[] {
  const order = ADD_OP_ORDER[section];
  if (!order) return opCatalog;
  return [...opCatalog].sort((left, right) => {
    const leftIndex = order.indexOf(left.type);
    const rightIndex = order.indexOf(right.type);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return (left.pickerLabel ?? left.label).localeCompare(right.pickerLabel ?? right.label);
  });
}

function PipelineOpCard({
  cardRef,
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
  onReloadLuts,
  onSelect,
  originalSize,
  selected
}: {
  cardRef(element: HTMLElement | null): void;
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
  onReloadLuts(): Promise<void>;
  onSelect(): void;
  originalSize: { width: number; height: number } | null;
  selected: boolean;
}): React.JSX.Element {
  const renderer = getOpRenderer(op.type);
  const Card = renderer?.Card;

  return (
    <section className={`pipeline-op-card ${selected ? "active" : ""}`} ref={cardRef} onClick={onSelect}>
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
          ctx={{ luts, originalSize, reloadLuts: onReloadLuts }}
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
  original,
  settings,
  task,
  onGenerateDescriptionChange,
  onGenerateSlugChange,
  onCustomSlugChange,
  onOutputChange
}: {
  disabled: boolean;
  hasGeminiApiKey: boolean;
  onOpenSettings(): void;
  original: Original | null;
  settings: GlobalSettings | null;
  task: Task | null;
  onGenerateDescriptionChange(value: boolean): void;
  onGenerateSlugChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOutputChange(key: string, value: unknown): void;
}): React.JSX.Element {
  const resolvedFormat = task && original ? resolveOutputFormat(task.pipeline.output.format, original.format) : null;
  const defaultFixedQuality = settings?.jpegFixedQuality ?? 85;
  const jpegEstimateEnabled = settings?.enableJpegQualityEstimate ?? false;
  const canAutoEstimateJpeg = jpegEstimateEnabled && original?.format === "jpeg" && original.jpegQualityEstimate !== null;
  const jpegQualityMode = task?.pipeline.output.quality === "auto" && canAutoEstimateJpeg ? "auto" : "fixed";
  const flattenableFormat = resolvedFormat === "png" || resolvedFormat === "webp" || resolvedFormat === "avif";
  const outputFormatOptions = availableOutputFormats();
  const fixedQuality = task && typeof task.pipeline.output.quality === "number" ? task.pipeline.output.quality : defaultFixedQuality;
  return (
    <div className="output-controls">
      <label className="toggle-row" title="Generate a reusable image description after save.">
        <input
          type="checkbox"
          disabled={disabled || !task || Boolean(task?.generateSlug)}
          checked={(task?.generateDescription ?? true) || Boolean(task?.generateSlug)}
          onChange={(event) => onGenerateDescriptionChange(event.currentTarget.checked)}
        />
        Generate description
      </label>
      <label className="toggle-row" title="Generate slug suggestions after save. Slug generation always needs a description first.">
        <input type="checkbox" disabled={disabled || !task} checked={task?.generateSlug ?? true} onChange={(event) => onGenerateSlugChange(event.currentTarget.checked)} />
        Generate slug
      </label>
      {(task?.generateDescription || task?.generateSlug) && !task.output?.vision && !hasGeminiApiKey ? (
        <div className="modal-warning">
          Gemini API key required for description and slug generation.
          <button className="toolbar-button compact-text" type="button" onClick={onOpenSettings}>Open settings</button>
        </div>
      ) : task?.output?.vision ? (
        <div className="vision-description">
          <span>{task.generateSlug ? "Generated description and slug source" : "Generated description"}</span>
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
        <select disabled={disabled || !task} value={task?.pipeline.output.format ?? "original"} onChange={(event) => onOutputChange("format", event.currentTarget.value)}>
          {outputFormatOptions.map((format) => <option key={format} value={format}>{formatLabel(format)}</option>)}
        </select>
      </label>
      {task && original ? (
        <div className="row-detail">
          Saving as <strong>{formatLabel(resolvedFormat ?? task.pipeline.output.format)}</strong>
          {task.pipeline.output.format === "original" && resolvedFormat !== original.format ? ` for this ${formatLabel(original.format)} source` : ""}
        </div>
      ) : null}
      {resolvedFormat === "jpeg" ? (
        <div className="row-detail">JPEG always flattens transparency using the selected background color.</div>
      ) : flattenableFormat ? (
        <>
          <label className="toggle-row">
            <input
              type="checkbox"
              disabled={disabled || !task}
              checked={task?.pipeline.output.flattenTransparency ?? false}
              onChange={(event) => onOutputChange("flattenTransparency", event.currentTarget.checked)}
            />
            Flatten transparency
          </label>
          <label className="stacked-field">
            Flatten background
            <input
              disabled={disabled || !task || !task.pipeline.output.flattenTransparency}
              type="color"
              value={task?.pipeline.output.backgroundForTransparency ?? settings?.defaultBackgroundForTransparency ?? "#ffffff"}
              onChange={(event) => onOutputChange("backgroundForTransparency", event.currentTarget.value)}
            />
          </label>
        </>
      ) : null}
      {resolvedFormat && resolvedFormat !== "png" ? (
        <label className="stacked-field">
          Quality — <strong>{typeof task?.pipeline.output.quality === "number" ? task.pipeline.output.quality : defaultFixedQuality}</strong>
          <input
            disabled={disabled || !task || (resolvedFormat === "jpeg" && jpegQualityMode === "auto")}
            max={100}
            min={1}
            step={1}
            type="range"
            value={fixedQuality}
            onChange={(event) => onOutputChange("quality", event.currentTarget.valueAsNumber)}
          />
        </label>
      ) : null}
      {resolvedFormat === "jpeg" ? (
        <label className="stacked-field">
          JPEG quality mode
          <select
            disabled={disabled || !task}
            value={jpegQualityMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onOutputChange("quality", value === "fixed" ? fixedQuality : "auto");
            }}
          >
            <option value="fixed">Fixed</option>
            <option disabled={!canAutoEstimateJpeg} value="auto">Assume source JPEG quality</option>
          </select>
        </label>
      ) : null}
      {resolvedFormat === "jpeg" ? (
        <div className="row-detail">
          {!jpegEstimateEnabled
            ? "JPEG quality estimation is off in Settings."
            : canAutoEstimateJpeg
              ? `Assumed source JPEG quality: ${original?.jpegQualityEstimate ?? defaultFixedQuality}`
              : original?.format === "jpeg"
                ? "This JPEG was loaded without a usable in-memory estimate. Reload it after enabling estimation if needed."
                : "Source-quality mode is available only for confirmed JPEG inputs."}
        </div>
      ) : null}
    </div>
  );
}
