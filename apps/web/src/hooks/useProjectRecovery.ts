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
}

export function useProjectRecovery(autoRestoreProjectId?: string) {
  const [state, setState] = useState<RecoveryState>({
    isChecking: true,
    availableSaves: [],
    showDialog: false,
    error: null,
  });

  const recoverFromAutoSave = useProjectStore((s) => s.recoverFromAutoSave);
  const loadProject = useProjectStore((s) => s.loadProject);

  useEffect(() => {
    const checkForRecovery = async () => {
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();

        if (autoRestoreProjectId) {
          // Backend is authoritative — no IndexedDB dependency.
          const backendProject = await backendSaveService.load(autoRestoreProjectId);
          if (backendProject) {
            loadProject(backendProject);
            setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
            return;
          }

          // Backend unreachable — surface the error.
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: "Could not reach the project server. Please ensure the orchestrator is running and try again.",
          });
          return;
        }

        if (saves.length > 0) {
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
        setState({
          isChecking: false,
          availableSaves: [],
          showDialog: false,
          error: null,
        });
      }
    };

    checkForRecovery();
  }, []);

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
    recover,
    dismiss,
    clearAll,
  };
}
