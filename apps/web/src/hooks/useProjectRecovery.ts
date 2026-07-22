import { useState, useEffect, useCallback } from "react";
import { backendSaveService } from "../services/backend-save";
import { autoSaveManager, type AutoSaveMetadata } from "../services/auto-save";
import { clearAllStorage } from "../services/media-storage";
import { useProjectStore } from "../stores/project-store";

interface RecoveryState {
  isChecking: boolean;
  availableSaves: AutoSaveMetadata[];
  showDialog: boolean;
  error: string | null;
  hasBackendConflict?: boolean;
}

export function useProjectRecovery(autoRestoreProjectId?: string) {
  const [state, setState] = useState<RecoveryState>({
    isChecking: true,
    availableSaves: [],
    showDialog: false,
    error: null,
    hasBackendConflict: false,
  });

  const recoverFromAutoSave = useProjectStore((s) => s.recoverFromAutoSave);
  const loadProject = useProjectStore((s) => s.loadProject);

  useEffect(() => {
    let cancelled = false;

    const checkForRecovery = async () => {
      try {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isChecking: true, error: null }));
        }

        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();
        console.info("[ProjectRecovery] recovery check complete", {
          requestedProjectId: autoRestoreProjectId ?? null,
          saveCount: saves.length,
          matchingSaveCount: autoRestoreProjectId
            ? saves.filter((save) => save.projectId === autoRestoreProjectId).length
            : 0,
        });

        if (autoRestoreProjectId) {
          console.info("[ProjectRecovery] loading requested project from backend", {
            projectId: autoRestoreProjectId,
          });
          const backendProject = await backendSaveService.load(autoRestoreProjectId);
          if (cancelled) return;
          if (backendProject?.id === autoRestoreProjectId) {
            console.info("[ProjectRecovery] backend project hydrated", {
              projectId: autoRestoreProjectId,
              mediaCount: backendProject.mediaLibrary.items.length,
              videoCount: backendProject.mediaLibrary.items.filter((item) => item.type === "video").length,
              videoThumbnailCount: backendProject.mediaLibrary.items.filter(
                (item) => item.type === "video" && Boolean(item.thumbnailUrl),
              ).length,
            });
            loadProject(backendProject);
            const newerLocalSave = saves
              .filter((save) => save.projectId === autoRestoreProjectId)
              .sort((a, b) => b.timestamp - a.timestamp)
              .find((save) => save.timestamp > backendProject.modifiedAt);
            setState({
              isChecking: false,
              availableSaves: newerLocalSave ? [newerLocalSave] : [],
              showDialog: Boolean(newerLocalSave),
              error: null,
              hasBackendConflict: Boolean(newerLocalSave),
            });
            return;
          }

          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: `Could not load requested project ${autoRestoreProjectId}. No replacement project was created.`,
          });
          return;
        }

        if (saves.length > 0) {
          console.info("[ProjectRecovery] no project requested; showing recovery dialog", {
            saveCount: saves.length,
          });
          setState({
            isChecking: false,
            availableSaves: saves,
            showDialog: true,
            error: null,
          });
        } else {
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: null,
          });
        }
      } catch (error) {
        console.warn("[Recovery] Failed to check for saves:", error);
        if (!cancelled) {
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: error instanceof Error ? error.message : "Project recovery check failed",
          });
        }
      }
    };

    checkForRecovery();

    return () => {
      cancelled = true;
    };
  }, [autoRestoreProjectId, loadProject]);

  const recover = useCallback(
    async (saveId: string) => {
      setState((prev) => ({ ...prev, error: null }));
      const success = await recoverFromAutoSave(saveId);
      if (success) {
        setState((prev) => ({ ...prev, showDialog: false, error: null }));
      } else {
        // Read the error message the store set during failed recovery.
        const storeError = useProjectStore.getState().error;
        setState((prev) => ({
          ...prev,
          error: storeError ?? "Recovery failed",
        }));
      }
      return success;
    },
    [recoverFromAutoSave],
  );

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, showDialog: false }));
  }, []);

  const clearAll = useCallback(async () => {
    await autoSaveManager.clearAllSaves();
    await clearAllStorage();
    setState((prev) => ({ ...prev, availableSaves: [], showDialog: false }));
  }, []);

  return {
    isChecking: state.isChecking,
    availableSaves: state.availableSaves,
    showDialog: state.showDialog,
    error: state.error,
    hasBackendConflict: Boolean(state.hasBackendConflict),
    recover,
    dismiss,
    clearAll,
  };
}
