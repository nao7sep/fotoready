import { create } from "zustand";
import type { PreviewResult, ProjectSnapshot } from "@shared/types/ipc";

type PreviewState = "idle" | "loading" | "error";

type EditorStore = {
  projectSnapshot: ProjectSnapshot | null;
  preview: PreviewResult | null;
  previewState: PreviewState;
  selectedOpId: string | null;
  renameOpen: boolean;
  apiKeyOpen: boolean;
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  menuOpen: boolean;
  showOriginals: boolean;
  showTasks: boolean;
  showOps: boolean;
  setProjectSnapshot(snapshot: ProjectSnapshot | null): void;
  setPreview(preview: PreviewResult | null): void;
  setPreviewState(previewState: PreviewState): void;
  selectOp(opId: string | null): void;
  setRenameOpen(open: boolean): void;
  setApiKeyOpen(open: boolean): void;
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
  apiKeyOpen: false,
  shortcutsOpen: false,
  aboutOpen: false,
  menuOpen: false,
  showOriginals: true,
  showTasks: true,
  showOps: true,
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
  setApiKeyOpen: (apiKeyOpen) => set({ apiKeyOpen }),
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
