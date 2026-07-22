import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Search, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import type { ResolvePreview } from "@openreel/core";
import {
  getPreview,
  getExportJob,
  cancelExport,
  launchResolveBridge,
  listProjects,
  startExport,
  type ResolveBridgeRequestOptions,
  type ResolveProjectListItem,
} from "../../../services/resolve-bridge-client";
import { ProjectList } from "./ProjectList";
import { ProjectMetadata } from "./ProjectMetadata";
import {
  useResolveExportJob,
  type ResolveExportJobClient,
} from "./useResolveExportJob";

export interface ResolveProjectPickerClient extends ResolveExportJobClient {
  readonly listProjects: (
    options?: ResolveBridgeRequestOptions,
  ) => Promise<ResolveProjectListItem[]>;
  readonly getPreview: (
    projectId: string,
    options?: ResolveBridgeRequestOptions,
  ) => Promise<ResolvePreview>;
}

export interface ResolveProjectPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onLaunch?: (preview: ResolvePreview) => void;
  readonly client?: ResolveProjectPickerClient;
}

const defaultClient: ResolveProjectPickerClient = {
  listProjects,
  getPreview,
  startExport,
  getExportJob,
  cancelExport,
  launch: launchResolveBridge,
};

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export function ResolveProjectPicker({
  open,
  onClose,
  onLaunch,
  client = defaultClient,
}: ResolveProjectPickerProps) {
  const [projects, setProjects] = useState<ResolveProjectListItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResolvePreview | null>(null);
  const [projectsState, setProjectsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewRetry, setPreviewRetry] = useState(0);
  const exportJob = useResolveExportJob(client);
  const searchRef = useRef<HTMLInputElement>(null);
  const listControllerRef = useRef<AbortController | null>(null);
  const previewControllerRef = useRef<AbortController | null>(null);
  const listRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  const loadProjects = useCallback(() => {
    if (!open) return;
    listControllerRef.current?.abort();
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    const request = ++listRequestRef.current;
    listControllerRef.current = controller;
    setProjectsState("loading");
    setPreviewState("idle");
    setPreview(null);

    void client.listProjects({ signal: controller.signal }).then((nextProjects) => {
      if (controller.signal.aborted || request !== listRequestRef.current) return;
      setProjects(nextProjects);
      setProjectsState("ready");
      setSelectedId((current) =>
        current && nextProjects.some((project) => project.id === current)
          ? current
          : (nextProjects[0]?.id ?? null),
      );
    }).catch((error: unknown) => {
      if (isAbort(error, controller.signal) || request !== listRequestRef.current) return;
      setProjects([]);
      setSelectedId(null);
      setProjectsState("error");
    });
  }, [client, open]);

  useEffect(() => {
    if (!open) {
      listControllerRef.current?.abort();
      previewControllerRef.current?.abort();
      exportJob.reset();
      return;
    }
    setQuery("");
    loadProjects();
    return () => {
      listControllerRef.current?.abort();
      previewControllerRef.current?.abort();
    };
  }, [loadProjects, open, exportJob.reset]);

  useEffect(() => {
    if (!open || !selectedId || projectsState !== "ready") {
      previewControllerRef.current?.abort();
      if (!selectedId) {
        setPreview(null);
        setPreviewState("idle");
      }
      return;
    }

    previewControllerRef.current?.abort();
    const controller = new AbortController();
    const request = ++previewRequestRef.current;
    previewControllerRef.current = controller;
    setPreview(null);
    setPreviewState("loading");

    void client.getPreview(selectedId, { signal: controller.signal }).then((nextPreview) => {
      if (controller.signal.aborted || request !== previewRequestRef.current) return;
      setPreview(nextPreview);
      setPreviewState("ready");
    }).catch((error: unknown) => {
      if (isAbort(error, controller.signal) || request !== previewRequestRef.current) return;
      setPreview(null);
      setPreviewState("error");
    });

    return () => controller.abort();
  }, [client, open, previewRetry, projectsState, selectedId]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      project.name.toLocaleLowerCase().includes(normalized) ||
      project.description.toLocaleLowerCase().includes(normalized),
    );
  }, [projects, query]);

  useEffect(() => {
    if (visibleProjects.length === 0 || visibleProjects.some((project) => project.id === selectedId)) return;
    setSelectedId(visibleProjects[0].id);
  }, [selectedId, visibleProjects]);

  const selectProject = (projectId: string) => {
    if (projectId === selectedId && previewState !== "error") return;
    exportJob.reset();
    setSelectedId(projectId);
  };

  const launchPreview = (selectedPreview: ResolvePreview) => {
    onLaunch?.(selectedPreview);
    void exportJob.start(
      selectedPreview.projectId,
      selectedPreview.revision,
      {
        projectId: selectedPreview.projectId,
        projectModifiedAt: selectedPreview.modifiedAt,
        target: "resolve",
        range: {
          startTime: 0,
          endTime: selectedPreview.durationFrames / selectedPreview.frameRate,
        },
      },
    );
  };

  const emptyMessage = projects.length === 0
    ? "No OpenReel projects are available. Create or save a project, then retry."
    : `No projects match “${query}”. Clear the search to see all projects.`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        hideCloseButton
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        className="flex h-[calc(100dvh-1rem)] max-h-[56rem] w-[calc(100vw-1rem)] max-w-6xl min-w-0 flex-col gap-0 overflow-hidden p-0 sm:h-[min(90dvh,56rem)]"
      >
        <DialogHeader className="relative border-b px-4 py-4 pr-16 text-left sm:px-6">
          <DialogTitle>Open an OpenReel project in DaVinci Resolve</DialogTitle>
          <DialogDescription>
            Select a backend-managed project and review its current revision before export.
          </DialogDescription>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-11 w-11"
              aria-label="Close Resolve project picker"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:overflow-hidden">
          <aside aria-label="Project browser" className="min-w-0 border-b md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r">
            <div className="border-b p-3">
              <label htmlFor="resolve-project-search" className="sr-only">Search projects</label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  id="resolve-project-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects"
                  className="h-11 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
                />
              </div>
            </div>
            <div className="min-h-0 md:flex-1 md:overflow-y-auto">
              {projectsState === "loading" && (
                <div role="status" aria-live="polite" className="flex min-h-28 items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Loading projects…
                </div>
              )}
              {projectsState === "error" && (
                <div role="alert" className="space-y-3 p-4 text-sm">
                  <p className="flex gap-2 font-medium">
                    <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    Could not load projects from the OpenReel backend.
                  </p>
                  <Button type="button" variant="outline" className="min-h-11" onClick={loadProjects}>
                    Retry loading projects
                  </Button>
                </div>
              )}
              {projectsState === "ready" && (
                <ProjectList
                  projects={visibleProjects}
                  selectedId={selectedId}
                  onSelect={selectProject}
                  emptyMessage={emptyMessage}
                />
              )}
            </div>
          </aside>

          <main aria-label="Selected project details" className="min-w-0 md:min-h-0 md:overflow-y-auto">
            {previewState === "loading" && (
              <div role="status" aria-live="polite" className="flex min-h-52 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Loading project preview…
              </div>
            )}
            {previewState === "error" && (
              <div role="alert" className="m-4 space-y-3 rounded-md border p-4 text-sm sm:m-6">
                <p className="flex gap-2 font-medium">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  Could not load the project preview. The project remains selected.
                </p>
                <p className="text-muted-foreground">Check the backend connection, then retry this preview.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setPreviewRetry((value) => value + 1)}
                >
                  Retry project preview
                </Button>
              </div>
            )}
            {previewState === "ready" && preview && (
              <ProjectMetadata
                preview={preview}
                onLaunch={() => launchPreview(preview)}
                onCancel={() => void exportJob.cancel()}
                onRetryLaunch={exportJob.retryLaunch}
                phase={exportJob.phase}
                percent={exportJob.percent}
                warnings={exportJob.warnings}
                statusMessage={exportJob.statusMessage}
                launchError={exportJob.launchError}
                canStart={exportJob.canStart}
                canCancel={exportJob.canCancel}
                isStarting={exportJob.isStarting}
              />
            )}
            {previewState === "idle" && projectsState === "ready" && projects.length === 0 && (
              <div className="flex min-h-52 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Project metadata will appear here after a project is available.
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
