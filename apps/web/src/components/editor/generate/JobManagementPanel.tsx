import { useCallback, useMemo, useState } from "react";
import {
  getProductionGenerationRuntime,
  useGenerationJobStore,
  type GenerationJob,
  type GenerationJobStatus,
} from "../../../stores/generation-job-store";
import {
  allowedRecoveryActionsForJob,
  type RecoveryAction,
} from "../../../features/generation/recovery/state-machine";
import { toast } from "../../../stores/notification-store";

type JobCommand = Exclude<RecoveryAction, "regenerate" | "variation">;

const GROUPS: Array<{ status: GenerationJobStatus; title: string }> = [
  { status: "queued", title: "Queued" },
  { status: "submitting", title: "Submitting" },
  { status: "running", title: "Running" },
  { status: "completed", title: "Completed" },
  { status: "finalizing", title: "Finalizing" },
  { status: "needs-attention", title: "Needs attention" },
  { status: "failed", title: "Failed" },
  { status: "succeeded", title: "Succeeded" },
  { status: "canceled", title: "Canceled" },
];

const COMMAND_LABELS: Record<JobCommand, string> = {
  cancel: "Cancel",
  "retry-provider": "Retry provider",
  "retry-finalization": "Retry finalization",
  "retry-placement": "Retry placement",
  "reconcile-placement": "Reconcile placement",
};

function commandActions(job: GenerationJob): JobCommand[] {
  return allowedRecoveryActionsForJob(job).filter(
    (action): action is JobCommand => action !== "regenerate" && action !== "variation",
  );
}

export function JobManagementPanel() {
  const jobs = useGenerationJobStore((state) => state.jobs);
  const [generationRuntime] = useState(getProductionGenerationRuntime);
  const [pendingCommand, setPendingCommand] = useState<string>();

  const grouped = useMemo(
    () => GROUPS.map((group) => ({
      ...group,
      jobs: jobs.filter((job) => job.status === group.status),
    })),
    [jobs],
  );

  const runCommand = useCallback(async (job: GenerationJob, action: JobCommand) => {
    const pendingKey = `${job.id}:${action}`;
    setPendingCommand(pendingKey);
    try {
      await generationRuntime.command(action, job);
    } catch (error) {
      console.error("generation-job-command-failed", {
        projectId: job.projectId,
        jobId: job.id,
        action,
        error,
      });
      toast.error(
        `${COMMAND_LABELS[action]} failed`,
        error instanceof Error ? error.message : "The generation command could not be completed.",
      );
    } finally {
      setPendingCommand((current) => current === pendingKey ? undefined : current);
    }
  }, [generationRuntime]);

  if (jobs.length === 0) {
    return (
      <div className="p-4 text-xs text-text-muted">
        No generation jobs yet.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Generation Jobs</h3>
        <p className="text-[10px] text-text-muted mt-1">
          Server-authoritative status, cancellation, and stage recovery.
        </p>
      </div>

      {grouped.map((group) => (
        <section key={group.status} className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-text-secondary">{group.title}</h4>
            <span className="text-[10px] text-text-muted">{group.jobs.length}</span>
          </div>
          {group.jobs.length === 0 ? (
            <p className="text-[10px] text-text-muted">None</p>
          ) : (
            <div className="space-y-2">
              {group.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  pendingCommand={pendingCommand}
                  onCommand={runCommand}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function JobRow({
  job,
  pendingCommand,
  onCommand,
}: {
  job: GenerationJob;
  pendingCommand?: string;
  onCommand: (job: GenerationJob, action: JobCommand) => void | Promise<void>;
}) {
  const label = job.context.prompt || job.modelId;
  const actions = commandActions(job);

  return (
    <div className="rounded-lg border border-border bg-background-secondary p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{label}</p>
          <p className="text-[10px] text-text-muted mt-0.5">
            {job.provider} · {job.modelId} · {job.providerJobId ?? "provider pending"}
          </p>
          {job.error?.message ? (
            <p className="text-[10px] text-red-300 mt-1">{job.error.message}</p>
          ) : null}
          {job.output?.mediaId ? (
            <p className="text-[10px] text-green-300 mt-1 truncate">
              {job.output.mediaId} · {job.output.versionId}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          {actions.map((action) => {
            const pendingKey = `${job.id}:${action}`;
            const pending = pendingCommand === pendingKey;
            return (
              <button
                key={action}
                type="button"
                aria-label={`${COMMAND_LABELS[action]} ${label}`}
                disabled={Boolean(pendingCommand)}
                onClick={() => void onCommand(job, action)}
                className="text-[10px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:cursor-wait disabled:opacity-50"
              >
                {pending ? `${COMMAND_LABELS[action]}…` : COMMAND_LABELS[action]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
