import { useMemo } from "react";
import { useGenerationJobStore, type GenerationJob, type GenerationJobStatus } from "../../../stores/generation-job-store";

const GROUPS: Array<{ status: GenerationJobStatus; title: string }> = [
  { status: "queued", title: "Queued" },
  { status: "running", title: "Running" },
  { status: "completed", title: "Completed" },
  { status: "failed", title: "Failed" },
  { status: "canceled", title: "Canceled" },
];

export function JobManagementPanel() {
  const jobs = useGenerationJobStore((state) => state.jobs);
  const cancel = useGenerationJobStore((state) => state.cancel);
  const retry = useGenerationJobStore((state) => state.retry);

  const grouped = useMemo(
    () => GROUPS.map((group) => ({ ...group, jobs: jobs.filter((job) => job.status === group.status) })),
    [jobs],
  );

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
        <p className="text-[10px] text-text-muted mt-1">KieAI and WaveSpeed queue, status, retry, and local cancel controls.</p>
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
                <JobRow key={job.id} job={job} onCancel={cancel} onRetry={retry} />
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
  onCancel,
  onRetry,
}: {
  job: GenerationJob;
  onCancel: (id: string) => void;
  onRetry: (id: string, newProviderJobId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background-secondary p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{job.prompt || job.model}</p>
          <p className="text-[10px] text-text-muted mt-0.5">
            {job.provider} · {job.model} · {job.providerJobId}
          </p>
          {job.error && <p className="text-[10px] text-red-300 mt-1">{job.error}</p>}
          {job.outputUrl && <p className="text-[10px] text-green-300 mt-1 truncate">{job.outputUrl}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {(job.status === "queued" || job.status === "running") && (
            <button
              type="button"
              aria-label={`Cancel ${job.prompt || job.model}`}
              onClick={() => onCancel(job.id)}
              className="text-[10px] px-2 py-1 rounded bg-background-tertiary text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          )}
          {job.status === "failed" && (
            <button
              type="button"
              aria-label={`Retry ${job.prompt || job.model}`}
              onClick={() => onRetry(job.id, `retry-${crypto.randomUUID()}`)}
              className="text-[10px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
