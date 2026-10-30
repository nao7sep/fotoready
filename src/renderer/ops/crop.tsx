import { useI18n } from "@renderer/i18n/I18nContext";
import { useEffect, useRef, useState } from "react";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";
import { NumberField } from "@renderer/components/number-field";
import { opFieldKey, useEditorStore } from "@renderer/state/editor-store";
import { customAspectLock, customAspectRatio } from "@shared/crop-aspect";
import { readPositiveNumber } from "@shared/number-text";
import type { OpCardContext, OpRenderer } from "./op-renderer";
import type { Translator } from "@shared/i18n/translate";
import { clampFractionRect, CropDarkenMask, type FractionRect, imageBoundsFromOriginalSize, OverlayRect, rectFromStage, rectToStage } from "./_overlay-primitives";

type CropAspectLock = number | string | null;
type CropParams = { x: number; y: number; w: number; h: number; aspectLock: CropAspectLock };

type CropAspectOptionId = "free" | "original" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";

// "free" and "original" are named in the interface language; the ratios name themselves.
const cropAspectOptionIds: readonly CropAspectOptionId[] = ["free", "original", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];

function cropAspectOptionLabel(id: CropAspectOptionId, t: Translator["t"]): string {
  if (id === "free") return t("crop.free");
  if (id === "original") return t("crop.original");
  return id;
}

export const cropRenderer: OpRenderer<CropParams> = {
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const { t, rich } = useI18n();
    const originalAspectRatio = ctx.originalSize ? ctx.originalSize.width / Math.max(1, ctx.originalSize.height) : null;
    const imageBounds = imageBoundsFromOriginalSize(ctx.inputSize ?? ctx.originalSize);
    const currentRect = clampFractionRect({ x: params.x, y: params.y, w: params.w, h: params.h }, imageBounds);
    const activeAspectId = identifyAspect(params.aspectLock, originalAspectRatio);
    const custom = useCustomAspectText(ctx, params.aspectLock, (ratio, lock) => {
      onParamsChange({ ...cropRectParams(fitAspect(currentRect, ratio, imageBounds)), aspectLock: lock });
    });

    function handleAspectChange(nextAspectId: CropAspectOptionId): void {
      if (nextAspectId === "free") {
        onParamChange("aspectLock", null);
        return;
      }
      const aspectRatio = resolveAspectRatio(nextAspectId, originalAspectRatio);
      if (!aspectRatio) return;
      const nextRect = fitAspect(currentRect, aspectRatio, imageBounds);
      onParamsChange({ ...cropRectParams(nextRect), aspectLock: nextAspectId });
    }

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">{rich("crop.aspectStatus", { aspect: <strong>{aspectLabel(activeAspectId, currentRect, t)}</strong> })}</span>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onParamsChange({ x: 0, y: 0, w: imageBounds.maxX, h: imageBounds.maxY, aspectLock: null })}>
            {t("common.reset")}
          </button>
        </div>
        <SegmentedRadioGroup
          className="geometry-chip-group"
          optionClassName="toolbar-button compact-text"
          ariaLabel={t("crop.aspectRatio")}
          options={cropAspectOptionIds.map((id) => ({ id, label: cropAspectOptionLabel(id, t) }))}
          value={activeAspectId === "custom" ? null : activeAspectId}
          onChange={handleAspectChange}
          disabled={disabled}
        />
        <div className="field-grid">
          <NumberField
            className="stacked-field geometry-number-field"
            disabled={disabled}
            error={custom.widthError}
            inputMode="decimal"
            label={t("crop.ratioWidth")}
            text={custom.width}
            onTextChange={(width) => custom.change(width, custom.height)}
          />
          <NumberField
            className="stacked-field geometry-number-field"
            disabled={disabled}
            error={custom.heightError}
            inputMode="decimal"
            label={t("crop.ratioHeight")}
            text={custom.height}
            onTextChange={(height) => custom.change(custom.width, height)}
          />
        </div>
      </div>
    );
  },
  Overlay({ params, editable, ctx, onParamsChange }) {
    const rect = clampFractionRect({ x: params.x, y: params.y, w: params.w, h: params.h }, ctx.imageBounds);
    const [draft, setDraft] = useState<FractionRect | null>(null);
    useEffect(() => { setDraft(null); }, [params.x, params.y, params.w, params.h]);

    if (!editable) {
      return <OverlayRect color="#facc15" rect={rect} placement={ctx.placement} longEdge={ctx.longEdge} />;
    }

    const visible = draft ?? rect;
    const aspect = resolveAspectRatio(params.aspectLock as CropAspectOptionId | number | null, ctx.originalAspectRatio);
    const stageRect = rectToStage(visible, ctx.longEdge, ctx.placement);

    return (
      <>
        <CropDarkenMask placement={ctx.placement} rect={visible} longEdge={ctx.longEdge} stageSize={ctx.stageSize} />
        <InteractiveOverlayRect
          aspectRatio={aspect}
          color="#facc15"
          placement={ctx.placement}
          rect={stageRect}
          onChange={(nextRect) => setDraft(rectFromStage(nextRect, ctx.longEdge, ctx.placement))}
          onCommit={(nextRect) => {
            const committed = rectFromStage(nextRect, ctx.longEdge, ctx.placement);
            setDraft(null);
            onParamsChange(cropRectParams(committed));
          }}
        />
      </>
    );
  }
};

function cropRectParams(rect: FractionRect): Pick<CropParams, "x" | "y" | "w" | "h"> {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

function identifyAspect(aspectLock: CropAspectLock, originalAspectRatio: number | null): CropAspectOptionId | "custom" {
  if (aspectLock === null || aspectLock === undefined) return "free";
  if (aspectLock === "original") return "original";
  if (typeof aspectLock === "string" && ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"].includes(aspectLock)) {
    return aspectLock as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";
  }
  const ratio = resolveAspectRatio(aspectLock, originalAspectRatio);
  if (!ratio) return "custom";
  if (originalAspectRatio && Math.abs(ratio - originalAspectRatio) <= 0.02) return "original";
  if (Math.abs(ratio - 1) <= 0.02) return "1:1";
  if (Math.abs(ratio - 2 / 3) <= 0.02) return "2:3";
  if (Math.abs(ratio - 3 / 2) <= 0.02) return "3:2";
  if (Math.abs(ratio - 3 / 4) <= 0.02) return "3:4";
  if (Math.abs(ratio - 4 / 3) <= 0.02) return "4:3";
  if (Math.abs(ratio - 9 / 16) <= 0.02) return "9:16";
  if (Math.abs(ratio - 16 / 9) <= 0.02) return "16:9";
  return "custom";
}

function resolveAspectRatio(aspectLock: unknown, originalAspectRatio: number | null): number | null {
  if (typeof aspectLock === "number" && Number.isFinite(aspectLock) && aspectLock > 0) return aspectLock;
  if (typeof aspectLock !== "string") return null;
  if (aspectLock === "original") return originalAspectRatio && Number.isFinite(originalAspectRatio) && originalAspectRatio > 0 ? originalAspectRatio : null;
  return customAspectRatio(aspectLock);
}

function fitAspect(rect: FractionRect, aspectRatio: number, imageBounds: { maxX: number; maxY: number }): FractionRect {
  const next = clampFractionRect(rect, imageBounds);
  if (!(aspectRatio > 0) || !Number.isFinite(aspectRatio)) return next;
  const centerX = next.x + next.w / 2;
  const centerY = next.y + next.h / 2;
  const targetArea = Math.max(0.0001, next.w * next.h);
  let width = Math.sqrt(targetArea * aspectRatio);
  let height = width / aspectRatio;
  const maxWidth = Math.max(0.0001, 2 * Math.min(centerX, imageBounds.maxX - centerX));
  const maxHeight = Math.max(0.0001, 2 * Math.min(centerY, imageBounds.maxY - centerY));
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.max(0.0001, width * scale);
  height = Math.max(0.0001, height * scale);
  return clampFractionRect({ x: centerX - width / 2, y: centerY - height / 2, w: width, h: height }, imageBounds);
}

function aspectLabel(activeId: CropAspectOptionId | "custom", rect: { w: number; h: number }, t: Translator["t"]): string {
  if (activeId === "custom") return `${(rect.w / Math.max(rect.h, 0.001)).toFixed(2)}:1`;
  return cropAspectOptionLabel(activeId, t);
}

function readCustomAspectDraft(aspectLock: CropAspectLock): { width: string; height: string } {
  if (typeof aspectLock !== "string" || customAspectRatio(aspectLock) === null) return { width: "", height: "" };
  const [width, height] = aspectLock.split(":") as [string, string];
  return { width: width.trim(), height: height.trim() };
}

/**
 * The custom ratio's two parts: any number above 0, decimals included (the core checks the same).
 * Both empty is no custom ratio while the crop has none (Free or Original); while it has a ratio,
 * empty parts are an error like any other, since that ratio would stay and save. A ratio commits as soon as both parts are valid; text that is
 * not stays in the fields and in the editor store, so the task cannot be saved, and the crop keeps
 * its last ratio. A ratio set elsewhere (a preset, Reset, undo) replaces what the fields show.
 */
function useCustomAspectText(
  ctx: OpCardContext,
  aspectLock: CropAspectLock,
  commit: (ratio: number, lock: string) => void
): { width: string; height: string; widthError: string | null; heightError: string | null; change(width: string, height: string): void } {
  const { t } = useI18n();
  const taskId = ctx.activeTaskId;
  const keys = taskId === null ? null : { width: opFieldKey(taskId, ctx.opId, "ratioWidth"), height: opFieldKey(taskId, ctx.opId, "ratioHeight") };
  const setInvalidOpField = useEditorStore((state) => state.setInvalidOpField);
  const [text, setText] = useState(() => {
    const shown = readCustomAspectDraft(aspectLock);
    const invalid = useEditorStore.getState().invalidOpFields;
    return keys === null ? shown : { width: invalid[keys.width] ?? shown.width, height: invalid[keys.height] ?? shown.height };
  });
  const noRatio = text.width.trim() === "" && text.height.trim() === "" &&
    (typeof aspectLock !== "string" || customAspectRatio(aspectLock) === null);
  const partError = (part: string): string | null => (noRatio || readPositiveNumber(part) !== null ? null : t("number.aboveZero"));
  const widthError = partError(text.width);
  const heightError = partError(text.height);

  const shownLock = useRef(aspectLock);
  useEffect(() => {
    if (shownLock.current === aspectLock) return;
    shownLock.current = aspectLock;
    setText((current) => (customAspectLock(current.width, current.height) === aspectLock ? current : readCustomAspectDraft(aspectLock)));
  }, [aspectLock]);
  useEffect(() => {
    if (keys === null) return;
    setInvalidOpField(keys.width, widthError === null ? null : text.width);
    setInvalidOpField(keys.height, heightError === null ? null : text.height);
  }, [keys?.width, keys?.height, widthError === null, heightError === null, text.width, text.height]);

  return {
    ...text,
    widthError,
    heightError,
    change(width, height) {
      setText({ width, height });
      const w = readPositiveNumber(width);
      const h = readPositiveNumber(height);
      const lock = customAspectLock(width, height);
      if (w !== null && h !== null && lock !== aspectLock) commit(w / h, lock);
    }
  };
}
