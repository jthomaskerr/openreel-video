import { useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { ToastContainer } from "./components/Toast";
import { ScriptViewDialog } from "./components/editor/ScriptViewDialog";
import { SearchModal } from "./components/editor/SearchModal";
import { MobileBlocker } from "./components/MobileBlocker";
import { WelcomeScreen } from "./components/welcome";
import { RecoveryDialog } from "./components/welcome/RecoveryDialog";
import { SharePage } from "./pages/SharePage";
import { useUIStore } from "./stores/ui-store";
import { useProjectStore } from "./stores/project-store";
import { useRouter } from "./hooks/use-router";
import { useProjectRecovery } from "./hooks/useProjectRecovery";
import { useProjectUnloadGuard } from "./hooks/useProjectUnloadGuard";
import { reportRuntimeError } from "./stores/notification-store";
import { useKieAIPoller } from "./hooks/useKieAIPoller";
import { useGenerationJobPoller } from "./hooks/useGenerationJobPoller";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { TooltipProvider } from "@openreel/ui";
import { isClientOnlyProjectId } from "./services/backend-save";
import { shouldSyncProjectIdToUrl } from "./services/project-url-identity";
import { usePersistenceStatusStore } from "./stores/persistence-status-store";

const EditorInterface = lazy(() =>
  import("./components/editor/EditorInterface").then((m) => ({
    default: m.EditorInterface,
  }))
);

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-screen w-screen bg-background flex flex-col items-center justify-center">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-sm text-text-secondary">{message}</p>
  </div>
);

const PRESET_DIMENSIONS: Record<string, SocialMediaCategory> = {
  "1080x1920": "tiktok",
  "1920x1080": "youtube-video",
  "1080x1080": "instagram-post",
  "720x1280": "instagram-stories",
  "1280x720": "youtube-video",
};

function App() {
  const { activeModal, modalData, closeModal, skipWelcomeScreen } = useUIStore();
  const { openModal: openSearchModal } = useUIStore();
  const { project, explicitlyCreated } = useProjectStore();
  const persistenceStatus = usePersistenceStatusStore();

  useProjectUnloadGuard(project, persistenceStatus, explicitlyCreated);

  const { route, params, navigate, updateParams, parsedDimensions } = useRouter();
  const scriptViewInitialTab =
    modalData?.tab === "import" ? "import" : "export";

  // Pass the projectId from the URL so the recovery hook auto-restores silently.
  const { showDialog, availableSaves, recover, dismiss, clearAll, hasBackendConflict, isChecking: recoveryIsChecking, error: recoveryError } = useProjectRecovery(
    route === "editor" ? params.projectId : undefined,
  );

  const hasHandledInitialRoute = useRef(false);

  useKieAIPoller();
  useGenerationJobPoller();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      reportRuntimeError("Runtime error", event.error ?? event.message, "window.error");
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportRuntimeError("Unhandled promise rejection", event.reason, "window.unhandledrejection");
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const newProjectPreset = useMemo<SocialMediaCategory | undefined>(() => {
    if (route !== "new") return undefined;

    if (params.preset) {
      const key = params.preset as SocialMediaCategory;
      if (SOCIAL_MEDIA_PRESETS[key]) return key;
    }

    if (parsedDimensions) {
      const dimKey = `${parsedDimensions.width}x${parsedDimensions.height}`;
      const match = PRESET_DIMENSIONS[dimKey];
      if (match) return match;
    }

    return undefined;
  }, [route, params.preset, parsedDimensions]);

  useEffect(() => {
    if (hasHandledInitialRoute.current) return;

    if (route === "new") {
      hasHandledInitialRoute.current = true;
      navigate("welcome");
    } else if (route === "editor" && skipWelcomeScreen) {
      hasHandledInitialRoute.current = true;
    } else if (["welcome", "templates", "recent"].includes(route)) {
      hasHandledInitialRoute.current = true;
    }
  }, [route, navigate, skipWelcomeScreen]);

  // Keep the project ID in the URL while the editor is open so that a page
  // reload can silently restore the correct project without a dialog.
  useEffect(() => {
    if (shouldSyncProjectIdToUrl({
      route,
      requestedProjectId: params.projectId,
      currentProjectId: project.id,
      explicitlyCreated,
      recoveryIsChecking,
      currentProjectIsClientOnly: isClientOnlyProjectId(project.id),
    })) {
      updateParams({ projectId: project.id });
    }
  }, [route, explicitlyCreated, project.id, params.projectId, recoveryIsChecking, updateParams]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && route !== "editor") {
        navigate("editor");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearchModal("search");
      }
    },
    [route, navigate, openSearchModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const showWelcome =
    ["welcome", "templates", "recent", "new"].includes(route) && !skipWelcomeScreen;
  const initialTab =
    route === "templates"
      ? "templates"
      : route === "recent"
        ? "recent"
        : undefined;
  const isSharePage = route === "share" && params.shareId;

  return (
    <TooltipProvider>
      <div className="h-screen w-screen bg-background text-text-primary overflow-hidden">
        <MobileBlocker />
        {isSharePage ? (
          <SharePage shareId={params.shareId!} />
        ) : showWelcome ? (
          <WelcomeScreen initialTab={initialTab} initialPreset={newProjectPreset} />
        ) : route === "editor" && (recoveryIsChecking || !explicitlyCreated) ? (
          recoveryIsChecking ? (
            <LoadingSpinner message="Loading requested project..." />
          ) : (
            <div className="flex h-full items-center justify-center p-6" role="alert">
              <div className="max-w-lg rounded-lg border border-destructive/40 bg-background-secondary p-5 text-sm text-text-primary">
                {recoveryError ?? "No confirmed project is selected. Create or open a project to continue."}
              </div>
            </div>
          )
        ) : (
          <Suspense fallback={<LoadingSpinner message="Loading editor..." />}>
            <EditorInterface />
          </Suspense>
        )}
        <ToastContainer />
        <ScriptViewDialog
          isOpen={activeModal === "scriptView"}
          onClose={closeModal}
          initialTab={scriptViewInitialTab}
        />
        <SearchModal isOpen={activeModal === "search"} onClose={closeModal} />
        {showDialog && availableSaves.length > 0 && (
          <RecoveryDialog
            saves={availableSaves}
            onRecover={async (saveId) => {
              const success = await recover(saveId);
              if (success) navigate("editor");
              return success;
            }}
            onDismiss={dismiss}
            onClearAll={clearAll}
            hasBackendConflict={hasBackendConflict}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
