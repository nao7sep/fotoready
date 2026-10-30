import { create } from "zustand";
import type { PreviewResult, ProjectSnapshot } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

type PreviewState = "idle" | "loading" | "error";

type EditorStore = {
  projectSnapshot: ProjectSnapshot | null;
  preview: PreviewResult | null;
  previewState: PreviewState;
  selectedOpId: string | null;
  renameOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  menuOpen: boolean;
  showOriginals: boolean;
  showTasks: boolean;
  showOps: boolean;
  /**
   * What the user typed into an op card's number field that is not a value the op accepts, keyed by
   * `opFieldKey`. It stays while the user goes to another task and back, and its task cannot be
   * saved until it is fixed; the op keeps its last valid value meanwhile.
   */
  invalidOpFields: Readonly<Record<string, string>>;
  setInvalidOpField(key: string, text: string | null): void;
  setProjectSnapshot(snapshot: ProjectSnapshot | null): void;
  setPreview(preview: PreviewResult | null): void;
  setPreviewState(previewState: PreviewState): void;
  selectOp(opId: string | null): void;
  setRenameOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setAboutOpen(open: boolean): void;
  setMenuOpen(open: boolean): void;
  toggleOriginals(): void;
  toggleTasks(): void;
  toggleOps(): void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  projectSnapshot: null,
  preview: null,
  previewState: "idle",
  selectedOpId: null,
  renameOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  aboutOpen: false,
  menuOpen: false,
  showOriginals: true,
  showTasks: true,
  showOps: true,
  invalidOpFields: {},
  setInvalidOpField: (key, text) => set((state) => {
    if ((state.invalidOpFields[key] ?? null) === text) return state;
    const invalidOpFields = { ...state.invalidOpFields };
    if (text === null) delete invalidOpFields[key];
    else invalidOpFields[key] = text;
    return { invalidOpFields };
  }),
  setProjectSnapshot: (snapshot) => set((state) => {
    const activeTaskChanged = state.projectSnapshot?.activeTaskId !== snapshot?.activeTaskId;
    return {
      projectSnapshot: snapshot,
      selectedOpId: !activeTaskChanged && selectedOpStillExists(snapshot, state.selectedOpId) ? state.selectedOpId : null
    };
  }),
  setPreview: (preview) => set({ preview }),
  setPreviewState: (previewState) => set({ previewState }),
  selectOp: (selectedOpId) => set({ selectedOpId }),
  setRenameOpen: (renameOpen) => set({ renameOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  toggleOriginals: () => set((state) => ({ showOriginals: !state.showOriginals })),
  toggleTasks: () => set((state) => ({ showTasks: !state.showTasks })),
  toggleOps: () => set((state) => ({ showOps: !state.showOps }))
}));

function selectedOpStillExists(snapshot: ProjectSnapshot | null, selectedOpId: string | null): boolean {
  if (!snapshot || !selectedOpId) return false;
  const activeTask = snapshot.project.tasks.find((task) => task.id === snapshot.activeTaskId);
  return activeTask?.pipeline.ops.some((op) => op.id === selectedOpId) ?? false;
}

export function opFieldKey(taskId: string, opId: string, field: string): string {
  return `${taskId}\0${opId}\0${field}`;
}

/** Whether an op the task still has holds a number field the user must fix before the task saves. */
export function taskHasInvalidOpField(invalidOpFields: Readonly<Record<string, string>>, task: Task): boolean {
  return task.pipeline.ops.some((op) => {
    const prefix = `${task.id}\0${op.id}\0`;
    return Object.keys(invalidOpFields).some((key) => key.startsWith(prefix));
  });
}
