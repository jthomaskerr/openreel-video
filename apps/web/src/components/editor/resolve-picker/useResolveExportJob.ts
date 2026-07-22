import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ResolveBridgeRequestOptions,
  ResolveExportStartRequest,
  ResolveExportStartResponse,
  ResolvePublicExportJob,
} from "../../../services/resolve-bridge-client";

export type ResolveExportSelection = ResolveExportStartRequest["selection"];

export interface ResolveExportJobClient {
  startExport(
    projectId: string,
    input: ResolveExportStartRequest,
    options?: ResolveBridgeRequestOptions,
  ): Promise<ResolveExportStartResponse>;
  getExportJob(
    projectId: string,
    jobId: string,
    options?: ResolveBridgeRequestOptions,
  ): Promise<ResolvePublicExportJob>;
  cancelExport(
    projectId: string,
    jobId: string,
    options?: ResolveBridgeRequestOptions,
  ): Promise<ResolvePublicExportJob>;
  launch(url: string): void;
}

const POLL_DELAYS_MS = [1_000, 1_500, 2_500, 5_000] as const;
const POLL_TIMEOUT_MS = 5 * 60_000;
const TERMINAL_PHASES = new Set<ResolvePublicExportJob["phase"]>([
  "completed",
  "failed",
  "cancelled",
]);
const PHASE_ORDER: readonly ResolvePublicExportJob["phase"][] = [
  "queued",
  "loading",
  "assessing",
  "resolving-media",
  "serializing",
  "verifying",
  "ready",
  "launching",
  "importing",
  "saving",
  "validating",
  "completed",
];

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function safeErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  switch (code) {
    case "STALE_PROJECT_REVISION":
    case "WORKTREE_REVISION_MISMATCH":
    case "PROJECT_REVISION_UNAVAILABLE":
      return "The project changed after this preview was loaded. Refresh the preview and try again.";
    case "MEDIA_INCOMPLETE":
      return "Required media is missing or unavailable. Relink the affected media, save the project, and retry.";
    case "EXPORT_BLOCKED":
      return "Resolve compatibility checks blocked this export. Review the compatibility details and fix the listed items.";
    case "PROJECT_NOT_FOUND":
      return "This project is no longer available. Return to the project list and choose another project.";
    default:
      return "The Resolve export could not be started. Check the OpenReel backend connection and try again.";
  }
}

function phaseMessage(job: ResolvePublicExportJob): string {
  switch (job.phase) {
    case "queued": return "Resolve export queued.";
    case "loading": return "Loading the confirmed project revision.";
    case "assessing": return "Assessing Resolve compatibility.";
    case "resolving-media": return "Checking required media.";
    case "serializing": return "Creating the Resolve timeline package.";
    case "verifying": return "Verifying export artifacts.";
    case "ready": return "Resolve export is ready to open.";
    case "launching": return "Opening DaVinci Resolve.";
    case "importing": return "Importing the timeline in DaVinci Resolve.";
    case "saving": return "Saving the DaVinci Resolve project.";
    case "validating": return "Validating the imported Resolve project.";
    case "completed": return "DaVinci Resolve import completed and was verified.";
    case "failed": return "The Resolve import failed. Review the latest job evidence, then retry the export if needed.";
    case "cancelled": return "Resolve export cancelled.";
  }
}

function monotonicJob(
  current: ResolvePublicExportJob | null,
  next: ResolvePublicExportJob,
): ResolvePublicExportJob {
  if (!current || current.id !== next.id || TERMINAL_PHASES.has(next.phase)) return next;
  if (TERMINAL_PHASES.has(current.phase)) return current;
  const currentIndex = PHASE_ORDER.indexOf(current.phase);
  const nextIndex = PHASE_ORDER.indexOf(next.phase);
  return nextIndex >= currentIndex ? next : current;
}

export function useResolveExportJob(client: ResolveExportJobClient) {
  const [job, setJob] = useState<ResolvePublicExportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchUrlRef = useRef<string | null>(null);
  const launchAttemptedRef = useRef(false);
  const startedAtRef = useRef(0);
  const pollAttemptRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, [clearTimer]);

  useEffect(() => stop, [stop]);

  const attemptLaunch = useCallback((url: string) => {
    if (launchAttemptedRef.current) return;
    launchAttemptedRef.current = true;
    try {
      client.launch(url);
      setLaunchError(null);
    } catch {
      setLaunchError("OpenReel could not open DaVinci Resolve. Check that the OpenReel Resolve Bridge is installed, then retry opening this ready export.");
    }
  }, [client]);

  const schedulePoll = useCallback((
    projectId: string,
    jobId: string,
    operation: number,
    controller: AbortController,
  ) => {
    if (controller.signal.aborted || operation !== operationRef.current) return;
    if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) {
      setRequestError("Status updates timed out. The backend job is preserved; reopen this picker to check it again.");
      return;
    }
    const delay = POLL_DELAYS_MS[Math.min(pollAttemptRef.current, POLL_DELAYS_MS.length - 1)];
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void client.getExportJob(projectId, jobId, { signal: controller.signal }).then((next) => {
        if (controller.signal.aborted || operation !== operationRef.current) return;
        pollAttemptRef.current += 1;
        setJob((current) => monotonicJob(current, next));
        if (TERMINAL_PHASES.has(next.phase)) return;
        schedulePoll(projectId, jobId, operation, controller);
      }).catch((error: unknown) => {
        if (isAbort(error, controller.signal) || operation !== operationRef.current) return;
        pollAttemptRef.current += 1;
        setRequestError("OpenReel could not refresh the Resolve job status. Retrying automatically while the backend job remains active.");
        schedulePoll(projectId, jobId, operation, controller);
      });
    }, delay);
  }, [client]);

  const start = useCallback(async (
    projectId: string,
    revision: string,
    selection: ResolveExportSelection,
  ) => {
    stop();
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    const controller = new AbortController();
    controllerRef.current = controller;
    launchUrlRef.current = null;
    launchAttemptedRef.current = false;
    startedAtRef.current = Date.now();
    pollAttemptRef.current = 0;
    setJob(null);
    setStarting(true);
    setRequestError(null);
    setLaunchError(null);
    try {
      const response = await client.startExport(
        projectId,
        { revision, selection },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || operation !== operationRef.current) return;
      setJob(response.job);
      launchUrlRef.current = response.bridgeLaunchUrl ?? null;
      if (response.job.phase === "ready" && response.bridgeLaunchUrl) {
        attemptLaunch(response.bridgeLaunchUrl);
      }
      if (!TERMINAL_PHASES.has(response.job.phase)) {
        schedulePoll(projectId, response.job.id, operation, controller);
      }
    } catch (error) {
      if (!isAbort(error, controller.signal) && operation === operationRef.current) {
        setRequestError(safeErrorMessage(error));
      }
    } finally {
      if (operation === operationRef.current) setStarting(false);
    }
  }, [attemptLaunch, client, schedulePoll, stop]);

  const cancel = useCallback(async () => {
    if (!job || job.phase !== "ready") return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    stop();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRequestError(null);
    try {
      const cancelled = await client.cancelExport(job.projectId, job.id, { signal: controller.signal });
      if (!controller.signal.aborted && operation === operationRef.current) {
        setJob((current) => monotonicJob(current, cancelled));
      }
    } catch (error) {
      if (!isAbort(error, controller.signal) && operation === operationRef.current) {
        setRequestError("The backend could not cancel this ready export. Refresh its status before trying again.");
      }
    }
  }, [client, job, stop]);

  const retryLaunch = useCallback(() => {
    if (job?.phase !== "ready" || !launchError || !launchUrlRef.current) return;
    launchAttemptedRef.current = false;
    attemptLaunch(launchUrlRef.current);
  }, [attemptLaunch, job?.phase, launchError]);

  const reset = useCallback(() => {
    operationRef.current += 1;
    stop();
    launchUrlRef.current = null;
    launchAttemptedRef.current = false;
    setJob(null);
    setStarting(false);
    setRequestError(null);
    setLaunchError(null);
  }, [stop]);

  const statusMessage = useMemo(() => {
    if (launchError) return launchError;
    if (requestError) return requestError;
    if (starting) return "Starting a backend-managed Resolve export.";
    if (job) return phaseMessage(job);
    return "Choose a project to create a backend-managed Resolve export.";
  }, [job, launchError, requestError, starting]);

  return {
    job,
    phase: job?.phase ?? null,
    percent: job?.percent ?? 0,
    warnings: job?.warnings ?? [],
    statusMessage,
    launchError,
    canStart: !starting && (job === null || TERMINAL_PHASES.has(job.phase)),
    canCancel: !starting && job?.phase === "ready",
    isStarting: starting,
    start,
    cancel,
    retryLaunch,
    reset,
  };
}
