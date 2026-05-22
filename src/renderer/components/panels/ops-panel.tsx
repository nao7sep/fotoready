import React, { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { LutEntry, OpCatalogItem, StampEntry, TaskEditOptions, VisionRunMode } from "@shared/types/ipc";
import type { OpInstance } from "@shared/types/op";
import type { Original, Task } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import { availableOutputFormats, formatLabel, resolveOutputFormat } from "@shared/output-format";
import { getOpRenderer } from "@renderer/ops";
import { taskVisualState } from "@renderer/task-visual-state";
import { revealInScrollContainer } from "@renderer/utils/reveal-in-scroll-container";

const ADD_OP_SECTIONS = ["Geometry", "Tone", "Effects", "Conceal", "Watermark", "Metadata"] as const;
const ADD_OP_ORDER: Partial<Record<(typeof ADD_OP_SECTIONS)[number], string[]>> = {
  Tone: ["auto-tone", "levels", "curves", "white-balance", "hsl"],
  Conceal: ["cover", "blur", "mosaic", "stamp"]
};

type OpsPanelProps = {
  activeTask: Task | null;
  activeOriginal: Original | null;
  hasGeminiApiKey: boolean;
  luts: LutEntry[];
  stamps: StampEntry[];
  opCatalog: OpCatalogItem[];
  pendingRevealOpId: string | null;
  originalSize: { width: number; height: number } | null;
  visionGenerating: boolean;
  visionGenerationMode: VisionRunMode | null;
  onClearVision(): void;
  onOpenSettings(): void;
  onGenerateVision(mode: VisionRunMode): void;
  onReloadLuts(): Promise<void>;
  onReloadStamps(): Promise<void>;
  onRevealOpHandled(): void;
  settings: GlobalSettings | null;
  selectedOpId: string | null;
  onAddOp(opType: string): void;
  onGenerateDescriptionChange(value: boolean): void;
  onGenerateSlugChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onMoveOp(opId: string, toIndex: number): void;
  onOpEnabledChange(opId: string, enabled: boolean): void;
  onOpParamChange(opId: string, key: string, value: unknown, options?: TaskEditOptions): void;
  onOpParamsChange(opId: string, patch: Record<string, unknown>, options?: TaskEditOptions): void;
  onOutputChange(key: string, value: unknown, options?: TaskEditOptions): void;
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
                  disabled={activeTask.status !== "not-saved"}
                  index={index}
                  key={op.id}
                  luts={props.luts}
                  op={op}
                  opCount={activeTask.pipeline.ops.length}
                  onEnabledChange={(enabled) => props.onOpEnabledChange(op.id, enabled)}
                  onMove={(toIndex) => props.onMoveOp(op.id, toIndex)}
                  onParamChange={(key, value, options) => props.onOpParamChange(op.id, key, value, options)}
                  onParamsChange={(patch, options) => props.onOpParamsChange(op.id, patch, options)}
                  onRemove={() => props.onRemoveOp(op.id)}
                  onReloadLuts={props.onReloadLuts}
                  onReloadStamps={props.onReloadStamps}
                  onSelect={() => props.onSelectOp(op.id)}
                  originalMetadataSummary={props.activeOriginal?.metadataSummary ?? null}
                  originalSize={props.originalSize}
                  selected={selectedOpId === op.id}
                  stamps={props.stamps}
                />
              )) : <div className="ops-empty">No ops in this task</div>
            ) : <div className="ops-empty">No task selected</div>}
          </div>
        </section>
        <section className="op-section output-section">
          <h3>Output</h3>
          <div className="output-fixed">
            <OutputControls
              hasGeminiApiKey={props.hasGeminiApiKey}
              metadataDisabled={!activeTask || activeTask.status === "queued" || activeTask.status === "processing"}
              onClearVision={props.onClearVision}
              onGenerateVision={props.onGenerateVision}
              onOpenSettings={props.onOpenSettings}
              outputDisabled={!activeTask || activeTask.status !== "not-saved"}
              original={props.activeOriginal}
              settings={props.settings}
              task={activeTask}
              visionGenerating={props.visionGenerating}
              visionGenerationMode={props.visionGenerationMode}
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
                <button className="toolbar-button full-width" disabled={!activeTask || activeTask.status !== "not-saved"} key={op.type} type="button" onClick={() => props.onAddOp(op.type)}>
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

function useContinuousControlHistoryScope(scope: string): {
  onBlurCapture(event: React.FocusEvent<HTMLElement>): void;
  onFocusCapture(event: React.FocusEvent<HTMLElement>): void;
  onPointerDownCapture(event: React.PointerEvent<HTMLElement>): void;
  onPointerEndCapture(event: React.PointerEvent<HTMLElement>): void;
  options(): TaskEditOptions | undefined;
} {
  const nextGroupId = useRef(0);
  const activeGroup = useRef<string | null>(null);

  function begin(): void {
    nextGroupId.current += 1;
    activeGroup.current = `${scope}:${nextGroupId.current}`;
  }

  function end(): void {
    activeGroup.current = null;
  }

  return {
    onBlurCapture(event) {
      if (isContinuousInput(event.target)) end();
    },
    onFocusCapture(event) {
      if (isContinuousInput(event.target) && activeGroup.current === null) begin();
    },
    onPointerDownCapture(event) {
      if (isContinuousInput(event.target)) begin();
    },
    onPointerEndCapture(event) {
      if (isContinuousInput(event.target)) end();
    },
    options() {
      return activeGroup.current ? { historyGroup: activeGroup.current } : undefined;
    }
  };
}

function isContinuousInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && (target.type === "range" || target.type === "color");
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
  onReloadStamps,
  onSelect,
  originalMetadataSummary,
  originalSize,
  selected,
  stamps
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
  onParamChange(key: string, value: unknown, options?: TaskEditOptions): void;
  onParamsChange(patch: Record<string, unknown>, options?: TaskEditOptions): void;
  onRemove(): void;
  onReloadLuts(): Promise<void>;
  onReloadStamps(): Promise<void>;
  onSelect(): void;
  originalMetadataSummary: Original["metadataSummary"] | null;
  originalSize: { width: number; height: number } | null;
  selected: boolean;
  stamps: StampEntry[];
}): React.JSX.Element {
  const renderer = getOpRenderer(op.type);
  const Card = renderer?.Card;
  const continuousHistory = useContinuousControlHistoryScope(`op:${op.id}`);

  return (
    <section
      className={`pipeline-op-card ${selected ? "active" : ""}`}
      ref={cardRef}
      onBlurCapture={continuousHistory.onBlurCapture}
      onClick={onSelect}
      onFocusCapture={continuousHistory.onFocusCapture}
      onPointerCancelCapture={continuousHistory.onPointerEndCapture}
      onPointerDownCapture={continuousHistory.onPointerDownCapture}
      onPointerUpCapture={continuousHistory.onPointerEndCapture}
    >
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
          ctx={{ luts, stamps, originalMetadataSummary, originalSize, reloadLuts: onReloadLuts, reloadStamps: onReloadStamps }}
          onParamChange={(key, value, options) => onParamChange(String(key), value, options ?? continuousHistory.options())}
          onParamsChange={(patch, options) => onParamsChange(patch as Record<string, unknown>, options ?? continuousHistory.options())}
        />
      ) : (
        <div className="row-detail">No editable parameters.</div>
      )}
    </section>
  );
}

function OutputControls({
  hasGeminiApiKey,
  metadataDisabled,
  onClearVision,
  onGenerateVision,
  onOpenSettings,
  outputDisabled,
  original,
  settings,
  task,
  visionGenerating,
  visionGenerationMode,
  onGenerateDescriptionChange,
  onGenerateSlugChange,
  onCustomSlugChange,
  onOutputChange
}: {
  hasGeminiApiKey: boolean;
  metadataDisabled: boolean;
  onClearVision(): void;
  onGenerateVision(mode: VisionRunMode): void;
  onOpenSettings(): void;
  outputDisabled: boolean;
  original: Original | null;
  settings: GlobalSettings | null;
  task: Task | null;
  visionGenerating: boolean;
  visionGenerationMode: VisionRunMode | null;
  onGenerateDescriptionChange(value: boolean): void;
  onGenerateSlugChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOutputChange(key: string, value: unknown, options?: TaskEditOptions): void;
}): React.JSX.Element {
  const continuousHistory = useContinuousControlHistoryScope("output");
  const resolvedFormat = task && original ? resolveOutputFormat(task.pipeline.output.format, original.format) : null;
  const defaultFixedQuality = settings?.jpegFixedQuality ?? 85;
  const canAutoEstimateJpeg = Boolean(settings?.enableJpegQualityEstimate && original?.format === "jpeg" && original.jpegQualityEstimate !== null);
  const flattenableFormat = resolvedFormat === "png" || resolvedFormat === "webp" || resolvedFormat === "avif";
  const outputFormatOptions = availableOutputFormats();
  const storedQuality = task?.pipeline.output.quality;
  const assumedQuality = canAutoEstimateJpeg ? original?.jpegQualityEstimate ?? null : null;
  const qualityMatchesAssumed = typeof storedQuality === "number"
    && assumedQuality !== null
    && Math.round(storedQuality) === Math.round(assumedQuality);
  const inferredAutoJpeg = resolvedFormat === "jpeg"
    && canAutoEstimateJpeg
    && (storedQuality === "auto" || (settings?.jpegQualityMode === "auto" && qualityMatchesAssumed));
  const jpegQualityMode = inferredAutoJpeg ? "auto" : "fixed";
  const fixedQuality = typeof storedQuality === "number" && !inferredAutoJpeg ? storedQuality : defaultFixedQuality;
  const qualityValue = resolvedFormat === "jpeg" && jpegQualityMode === "auto" ? assumedQuality ?? defaultFixedQuality : fixedQuality;
  const hasSavedOutput = Boolean(task?.output);
  const vision = task?.output?.vision ?? null;
  const description = vision?.description?.trim() ?? "";
  const generatedSlug = vision?.slugCandidates[0] ?? null;
  const hasGeneratedDescription = description.length > 0;
  const hasGeneratedSlug = Boolean(generatedSlug?.trim());
  const generationStatus = visionGenerationMode === null
    ? "Generating..."
    : visionGenerationMode === "slug"
    ? "Generating slug..."
    : visionGenerationMode === "description-and-slug"
      ? hasGeneratedDescription && !hasGeneratedSlug
        ? "Generating slug..."
        : "Generating description and slug..."
      : "Generating description...";
  const descriptionActionLabel = hasGeneratedDescription ? "Regenerate description" : "Generate description";
  const combinedActionLabel = hasGeneratedDescription && hasGeneratedSlug ? "Regenerate description and slug" : "Generate description and slug";
  const showSlugAction = hasGeneratedDescription;
  const slugActionLabel = hasGeneratedSlug ? "Regenerate slug" : "Generate slug";
  const visionStateClass = `state-${taskVisualState(task)}`;
  return (
    <div
      className="output-controls"
      onBlurCapture={continuousHistory.onBlurCapture}
      onFocusCapture={continuousHistory.onFocusCapture}
      onPointerCancelCapture={continuousHistory.onPointerEndCapture}
      onPointerDownCapture={continuousHistory.onPointerDownCapture}
      onPointerUpCapture={continuousHistory.onPointerEndCapture}
    >
      <label className="stacked-field">
        Format
        <select disabled={outputDisabled || !task} value={task?.pipeline.output.format ?? "original"} onChange={(event) => onOutputChange("format", event.currentTarget.value)}>
          {outputFormatOptions.map((format) => (
            <option key={format} value={format}>
              {format === "original" && original ? `${formatLabel(format)} (${formatLabel(resolveOutputFormat(format, original.format))})` : formatLabel(format)}
            </option>
          ))}
        </select>
      </label>
      {flattenableFormat ? (
        <>
          <label className="toggle-row">
            <input
              type="checkbox"
              disabled={outputDisabled || !task}
              checked={task?.pipeline.output.flattenTransparency ?? false}
              onChange={(event) => onOutputChange("flattenTransparency", event.currentTarget.checked)}
            />
            Flatten transparency
          </label>
          <label className="stacked-field">
            Flatten background
            <input
              disabled={outputDisabled || !task || !task.pipeline.output.flattenTransparency}
              type="color"
              value={task?.pipeline.output.backgroundForTransparency ?? settings?.defaultBackgroundForTransparency ?? "#ffffff"}
              onChange={(event) => onOutputChange("backgroundForTransparency", event.currentTarget.value)}
            />
          </label>
        </>
      ) : null}
      {resolvedFormat === "jpeg" ? (
        <label className="stacked-field">
          JPEG quality mode
          <select
            disabled={outputDisabled || !task}
            value={jpegQualityMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onOutputChange("quality", value === "fixed" ? defaultFixedQuality : "auto");
            }}
          >
            <option disabled={!canAutoEstimateJpeg} value="auto">
              Use assumed value{assumedQuality ? ` (${assumedQuality})` : ""}
            </option>
            <option value="fixed">Fixed value</option>
          </select>
        </label>
      ) : null}
      {resolvedFormat && resolvedFormat !== "png" ? (
        <label className="slider-row">
          <span>Quality</span>
          <input
            disabled={outputDisabled || !task || (resolvedFormat === "jpeg" && jpegQualityMode === "auto")}
            max={100}
            min={1}
            step={1}
            type="range"
            value={qualityValue}
            onChange={(event) => onOutputChange("quality", event.currentTarget.valueAsNumber, continuousHistory.options())}
          />
          <span className="slider-value">{qualityValue}</span>
        </label>
      ) : null}
      {!hasSavedOutput ? (
        <>
          <label className="toggle-row">
            <input
              type="checkbox"
              disabled={metadataDisabled || !task || Boolean(task?.generateSlug)}
              checked={(task?.generateDescription ?? true) || Boolean(task?.generateSlug)}
              onChange={(event) => onGenerateDescriptionChange(event.currentTarget.checked)}
            />
            Generate description
          </label>
          <label className="toggle-row">
            <input type="checkbox" disabled={metadataDisabled || !task} checked={task?.generateSlug ?? true} onChange={(event) => onGenerateSlugChange(event.currentTarget.checked)} />
            Generate slug
          </label>
        </>
      ) : null}
      {hasSavedOutput && !hasGeminiApiKey ? (
        <div className="modal-warning">
          Gemini API key required for description and slug generation.
          <button className="toolbar-button compact-text" type="button" onClick={onOpenSettings}>Open settings</button>
        </div>
      ) : null}
      {hasSavedOutput && visionGenerating ? (
        <div className="modal-warning">{generationStatus}</div>
      ) : null}
      {hasSavedOutput ? (
        <div className={`vision-description ${visionStateClass}`}>
          <div className="vision-description-item">
            <span>Description</span>
            <p>{hasGeneratedDescription ? description : "Not generated"}</p>
          </div>
          <div className="vision-description-item">
            <span>Slug</span>
            <p>{hasGeneratedSlug ? generatedSlug : "Not generated"}</p>
          </div>
          <div className="vision-description-actions">
            <button className="toolbar-button compact-text" disabled={metadataDisabled || !hasGeminiApiKey || visionGenerating} type="button" onClick={() => onGenerateVision("description")}>{descriptionActionLabel}</button>
            <button className="toolbar-button compact-text" disabled={metadataDisabled || !hasGeminiApiKey || visionGenerating} type="button" onClick={() => onGenerateVision("description-and-slug")}>{combinedActionLabel}</button>
            {showSlugAction ? (
              <button className="toolbar-button compact-text" disabled={metadataDisabled || !hasGeminiApiKey || visionGenerating} type="button" onClick={() => onGenerateVision("slug")}>{slugActionLabel}</button>
            ) : null}
          </div>
          {vision ? (
            <div className="vision-description-secondary-actions">
              <button className="toolbar-button compact-text" disabled={metadataDisabled || visionGenerating} type="button" onClick={onClearVision}>Clear</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="stacked-field">
        Rename slug
        <input disabled={metadataDisabled || !task} placeholder="descriptive-slug" type="text" value={task?.customSlug ?? ""} onChange={(event) => onCustomSlugChange(event.currentTarget.value || null)} />
      </label>
    </div>
  );
}
