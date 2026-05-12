import { useCallback, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type PaneKey = "originals" | "tasks" | "ops";

type WorkspaceWidths = Record<PaneKey, number>;

const storageKey = "fotoready.workspace.widths";
const defaults: WorkspaceWidths = { originals: 200, tasks: 240, ops: 340 };
const limits: Record<PaneKey, { min: number; max: number }> = {
  originals: { min: 160, max: 360 },
  tasks: { min: 190, max: 420 },
  ops: { min: 280, max: 520 }
};

export function useWorkspaceLayout({
  showOps,
  showOriginals,
  showTasks
}: {
  showOps: boolean;
  showOriginals: boolean;
  showTasks: boolean;
}): {
  gridTemplateColumns: string;
  startResize(pane: PaneKey): (event: ReactPointerEvent<HTMLButtonElement>) => void;
} {
  const [widths, setWidths] = useState<WorkspaceWidths>(readStoredWidths);

  const gridTemplateColumns = useMemo(() => {
    const columns: string[] = [];
    if (showOriginals) columns.push(`${widths.originals}px`, "6px");
    if (showTasks) columns.push(`${widths.tasks}px`, "6px");
    columns.push("minmax(520px, 1fr)");
    if (showOps) columns.push("6px", `${widths.ops}px`);
    return columns.join(" ");
  }, [showOps, showOriginals, showTasks, widths]);

  const startResize = useCallback((pane: PaneKey) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[pane];
    const direction = pane === "ops" ? -1 : 1;

    function onMove(moveEvent: PointerEvent): void {
      const next = clamp(startWidth + (moveEvent.clientX - startX) * direction, limits[pane].min, limits[pane].max);
      setWidths((current) => {
        const updated = { ...current, [pane]: next };
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-workspace");
    }

    document.body.classList.add("is-resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [widths]);

  return { gridTemplateColumns, startResize };
}

function readStoredWidths(): WorkspaceWidths {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Partial<WorkspaceWidths>;
    return {
      originals: clamp(Number(parsed.originals ?? defaults.originals), limits.originals.min, limits.originals.max),
      tasks: clamp(Number(parsed.tasks ?? defaults.tasks), limits.tasks.min, limits.tasks.max),
      ops: clamp(Number(parsed.ops ?? defaults.ops), limits.ops.min, limits.ops.max)
    };
  } catch {
    return defaults;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
