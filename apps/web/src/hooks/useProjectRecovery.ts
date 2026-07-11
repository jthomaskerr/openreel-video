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
    let cancelled = false;

    const checkForRecovery = async () => {
      try {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isChecking: true, error: null }));
        }

        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();

        if (autoRestoreProjectId) {
          const pendingCreation = autoSaveManager.getPendingProjectCreation(autoRestoreProjectId);
          if (pendingCreation) {
            // A reload can happen after the UUID autosave but before POST
            // returns its canonical slug. Do not turn that temporary UUID
            // into a backend GET/404; recover the local save and let the
            // store retry the identity handoff.
            const matchingPendingSave = saves
              .filter((save) => save.projectId === autoRestoreProjectId)
              .sort((a, b) => b.timestamp - a.timestamp)[0];
            if (matchingPendingSave) {
              const success = await recoverFromAutoSave(matchingPendingSave.id);
              if (cancelled) return;
              if (success) {
                setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
              } else {
                const storeError = useProjectStore.getState().error;
                setState({
                  isChecking: false,
                  availableSaves: [],
                  showDialog: false,
                  error: storeError ?? "Could not restore the pending local project.",
                });
              }
              return;
            }
          }

          // Prefer the backend copy when a URL project id is present, but do not
          // strand fresh local work if the backend save has not completed yet
          // (for example after HMR/page refresh shortly after an import).
          const backendProject = await backendSaveService.load(autoRestoreProjectId);
          if (cancelled) return;
          if (backendProject) {
            loadProject(backendProject);
            setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
            return;
          }

          const matchingSave = saves
            .filter((save) => save.projectId === autoRestoreProjectId)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

          if (matchingSave) {
            const success = await recoverFromAutoSave(matchingSave.id);
            if (cancelled) return;
            if (success) {
              setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
            } else {
              const storeError = useProjectStore.getState().error;
              setState({
                isChecking: false,
                availableSaves: [],
                showDialog: false,
                error: storeError ?? "Could not restore the local autosave for this project.",
              });
            }
            return;
          }

          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: "Could not reach the project server and no local autosave was found for this project.",
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
        if (!cancelled) {
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
            error: null,
          });
        }
      }
    };

    checkForRecovery();

    return () => {
      cancelled = true;
    };
  }, [autoRestoreProjectId]);

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
