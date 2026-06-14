import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { currentCompositeIndex, nextIndex } from "@renderer/components/composite-nav";

/**
 * One single-choice segmented control: a `radiogroup` with one tab stop, arrow
 * keys that move and select among the options (radios activate on focus), and
 * Home/End to the ends. Styling is the caller's existing classes (the option
 * carries `active` when selected), so adopting this changes the keyboard/ARIA
 * behavior without changing the look.
 *
 * The app's in-app layer for segmented radio controls, shared across the ops
 * panels so every chip/swatch group behaves the same. Hand-rolled rather than
 * native `<input type="radio">` because the existing CSS targets `button.active`
 * and the swatch groups render color chips — both need to keep their exact look.
 */
export type SegmentedOption<T extends string> = {
  id: T;
  /** Visible text; omit for swatch/icon-only options that rely on `ariaLabel`. */
  label?: string;
  /** Accessible name when `label` is absent or not descriptive (e.g. a color). */
  ariaLabel?: string;
  disabled?: boolean;
  /** Extra per-option class (e.g. a swatch modifier). */
  className?: string;
  /** Per-option inline style (e.g. a color swatch's background). */
  style?: CSSProperties;
};

type Props<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (id: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Class on the radiogroup container (e.g. the existing geometry-chip-group). */
  className?: string;
  /** Class on each option button (e.g. the existing toolbar-button styles). */
  optionClassName?: string;
};

export function SegmentedRadioGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  optionClassName = "",
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  // Arrow navigation moves among the enabled options only.
  const enabled = disabled ? [] : options.filter((o) => !o.disabled);
  const enabledIds = enabled.map((o) => o.id);
  const selectedInGroup = value && enabled.some((o) => o.id === value) ? value : null;
  const initialActiveId = selectedInGroup ?? enabled[0]?.id ?? null;
  const activeIdRef = useRef<T | null>(initialActiveId);
  const lastSelectedRef = useRef<T | null>(selectedInGroup);
  const [activeId, setActiveIdState] = useState<T | null>(initialActiveId);
  const enabledKey = enabledIds.join("\0");

  // The single tab stop: the selected option, or the first enabled one when the
  // current value isn't among the options (e.g. a custom color, no preset match).
  const tabbableId =
    activeId && enabled.some((o) => o.id === activeId)
      ? activeId
      : selectedInGroup ?? enabled[0]?.id;

  const setActiveId = (id: T | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  };

  useEffect(() => {
    if (selectedInGroup === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedInGroup;
    setActiveId(selectedInGroup ?? enabled[0]?.id ?? null);
  }, [selectedInGroup]);

  useEffect(() => {
    if (activeIdRef.current && enabled.some((o) => o.id === activeIdRef.current)) return;
    setActiveId(initialActiveId);
  }, [enabledKey, initialActiveId]);

  const focusOption = (id: T) => {
    (
      Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-option-id]") ?? [])
        .find((el) => el.dataset.optionId === id)
    )?.focus();
  };

  const focusedId = (): T | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const id = active.dataset.optionId;
    return id && enabled.some((o) => o.id === id) ? id as T : null;
  };

  const selectAt = (index: number) => {
    const opt = enabled[index];
    if (!opt) return;
    setActiveId(opt.id);
    focusOption(opt.id);
    onChange(opt.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const current = currentCompositeIndex({
      ids: enabledIds,
      focusedId: focusedId(),
      activeId: activeIdRef.current,
      selectedId: value,
    });
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectAt(nextIndex("next", current, enabled.length));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectAt(nextIndex("prev", current, enabled.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      selectAt(nextIndex("first", current, enabled.length));
    } else if (e.key === "End") {
      e.preventDefault();
      selectAt(nextIndex("last", current, enabled.length));
    }
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      className={className}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            data-option-id={o.id}
            tabIndex={o.id === tabbableId ? 0 : -1}
            disabled={disabled || o.disabled}
            style={o.style}
            onClick={() => {
              setActiveId(o.id);
              onChange(o.id);
            }}
            onFocus={() => setActiveId(o.id)}
            className={[optionClassName, o.className, checked ? "active" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
