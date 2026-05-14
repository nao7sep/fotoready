import React from "react";

export const ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export type Anchor = (typeof ANCHORS)[number];

const symbols: Record<string, string> = {
  "top-left": "↖", "top": "↑", "top-right": "↗",
  "left": "←", "center": "·", "right": "→",
  "bottom-left": "↙", "bottom": "↓", "bottom-right": "↘"
};

export function AnchorPicker({ disabled, value, onChange }: { disabled: boolean; value: string; onChange(anchor: Anchor): void }): React.JSX.Element {
  return (
    <div className="anchor-grid">
      {ANCHORS.map((anchor) => (
        <button
          className={value === anchor ? "active" : ""}
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
