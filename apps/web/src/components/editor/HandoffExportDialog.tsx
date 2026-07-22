import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Film, Layers3, Loader2, OctagonAlert } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Progress,
} from "@openreel/ui";
import {
  renderCompatibilityReport,
  type
  ExportRange,
  HandoffProgress,
  HandoffResult,
  HandoffSelection,
  HandoffTarget,
  Project,
} from "@openreel/core";
import {
  ResolveProjectPicker,
  type ResolveProjectPickerClient,
} from "./resolve-picker/ResolveProjectPicker";

interface RunHandoffOptions {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: HandoffProgress) => void;
}

export type RunHandoff = (
  selection: HandoffSelection,
  options: RunHandoffOptions,
) => Promise<HandoffResult>;

export interface HandoffExportDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly project: Project;
  readonly selectedRange?: ExportRange | null;
  readonly onStart?: RunHandoff;
  readonly resolveClient?: ResolveProjectPickerClient;
}

type DialogStatus = "idle" | "running" | "completed" | "blocked" | "cancelled" | "failed";

const unavailableStart: RunHandoff = async (selection) => ({
  status: "failed",
  target: selection.target,
  failure: {
    code: "handoff.destination-unavailable",
    stage: "awaiting-destination",
    message: "This browser cannot open the required export destination. Use a Chromium browser and retry.",
    entity: null,
    retryable: true,
  },
  writtenArtifacts: [],
});

export function HandoffExportDialog({
  isOpen,
  onClose,
  project,
  selectedRange,
  onStart = unavailableStart,
  resolveClient,
}: HandoffExportDialogProps) {
  const [target, setTarget] = useState<HandoffTarget | null>(null);
  const [rangeMode, setRangeMode] = useState<"full" | "selected">("full");
  const [status, setStatus] = useState<DialogStatus>("idle");
  const [progress, setProgress] = useState<HandoffProgress | null>(null);
  const [result, setResult] = useState<HandoffResult | null>(null);
  const [resolvePickerOpen, setResolvePickerOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTarget(null);
    setRangeMode("full");
    setStatus("idle");
    setProgress(null);
    setResult(null);
    setResolvePickerOpen(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [isOpen]);

  const start = async () => {
    if (!target || status === "running") return;
    if (target === "resolve") {
      setResolvePickerOpen(true);
      return;
    }
    const range =
      rangeMode === "selected" && selectedRange
        ? { ...selectedRange }
        : { startTime: 0, endTime: project.timeline.duration };
    const selection: HandoffSelection = {
      projectId: project.id,
      projectModifiedAt: project.modifiedAt,
      target,
      range,
    };
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus("running");
    setResult(null);
    setProgress({
      operationId: "pending",
      target,
      phase: "assessing",
      progress: 0,
      processedCount: 0,
      totalCount: project.mediaLibrary.items.length,
      message: "Assessing compatibility",
    });

    const nextResult = await onStart(selection, {
      signal: controller.signal,
      onProgress: setProgress,
    });
    setResult(nextResult);
    setStatus(nextResult.status);
    abortControllerRef.current = null;
  };

  const cancel = () => abortControllerRef.current?.abort();
  const reportDownload =
    result?.status === "completed"
      ? `data:text/markdown;charset=utf-8,${encodeURIComponent(renderCompatibilityReport(result.report))}`
      : null;

  return (
    <>
    <Dialog open={isOpen && !resolvePickerOpen} onOpenChange={(open) => !open && status !== "running" && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-background-secondary border-border p-0 gap-0">
        <DialogHeader className="p-5 border-b border-border bg-background-tertiary">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/15 p-2 text-primary" aria-hidden="true">
              <Layers3 size={20} />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold text-text-primary">
                Continue editing
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-text-secondary">
                Choose an editing destination. Compatibility is checked before any files are written.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 p-5">
          <section aria-labelledby="handoff-target-heading" className="space-y-3">
            <h2 id="handoff-target-heading" className="text-sm font-semibold text-text-primary">
              Destination
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={target === "resolve"}
                onClick={() => setTarget("resolve")}
                disabled={status === "running"}
                className="min-h-28 cursor-pointer rounded-xl border border-border bg-background-tertiary p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Layers3 size={18} className="text-primary" aria-hidden="true" />
                  DaVinci Resolve
                </span>
                <span className="mt-2 block text-sm leading-5 text-text-secondary">
                  Editable timeline with collected media and an FCPXML compatibility report.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={target === "imovie"}
                onClick={() => setTarget("imovie")}
                disabled={status === "running"}
                className="min-h-28 cursor-pointer rounded-xl border border-border bg-background-tertiary p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Film size={18} className="text-primary" aria-hidden="true" />
                  iMovie
                </span>
                <span className="mt-2 block text-sm leading-5 text-text-secondary">
                  Flattened MOV that preserves the rendered picture and sound without editable clips.
                </span>
              </button>
            </div>
          </section>

          <fieldset className="space-y-3" disabled={status === "running"}>
            <legend className="text-sm font-semibold text-text-primary">Timeline range</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-text-primary focus-within:ring-2 focus-within:ring-primary">
              <input
                type="radio"
                name="handoff-range"
                checked={rangeMode === "full"}
                onChange={() => setRangeMode("full")}
              />
              Full project · {project.timeline.duration.toFixed(1)} seconds
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-text-primary focus-within:ring-2 focus-within:ring-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              <input
                type="radio"
                name="handoff-range"
                checked={rangeMode === "selected"}
                onChange={() => setRangeMode("selected")}
                disabled={!selectedRange}
              />
              Selected range
              {selectedRange && (
                <span className="text-text-muted">
                  {selectedRange.startTime.toFixed(1)}–{selectedRange.endTime.toFixed(1)} seconds
                </span>
              )}
            </label>
          </fieldset>

          <div aria-live="polite" className="min-h-16">
            {status === "idle" && (
              <p className="rounded-lg border border-border bg-background-tertiary p-3 text-sm leading-5 text-text-secondary">
                Select a destination, then start. The preflight reports missing media and unsupported editable changes before destination access.
              </p>
            )}
            {status === "running" && progress && (
              <div role="status" className="space-y-2 rounded-lg border border-border bg-background-tertiary p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium text-text-primary">
                    <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {progress.message}
                  </span>
                  <span className="font-mono text-text-muted">{Math.round(progress.progress * 100)}%</span>
                </div>
                <Progress value={progress.progress * 100} aria-label="Handoff progress" />
              </div>
            )}
            {status === "completed" && (
              <div role="status" className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-200">
                <div className="flex gap-3">
                  <CheckCircle2 size={18} className="shrink-0" aria-hidden="true" />
                  <div><strong className="block">Handoff complete</strong>All required artifacts were closed successfully.</div>
                </div>
                {result?.status === "completed" && (
                  <div className="mt-3 border-t border-green-500/30 pt-3">
                    {result.target === "imovie" && (
                      <div className="mb-3 rounded-md bg-background-tertiary/60 p-3 text-text-secondary">
                        <p className="font-semibold text-text-primary">Flattened MOV</p>
                        <p className="mt-1">
                          {project.settings.width} × {project.settings.height} · {project.settings.width === project.settings.height
                            ? "square"
                            : project.settings.width > project.settings.height
                              ? "landscape"
                              : "portrait"}
                          . Picture and mixed audio are preserved, but clips and effects are not independently editable.
                        </p>
                      </div>
                    )}
                    <p className="font-medium">Completed artifacts</p>
                    <ul className="mt-1 space-y-1 font-mono text-xs">
                      {result.artifacts.map((artifact) => (
                        <li key={`${artifact.kind}:${artifact.relativePath}`}>{artifact.relativePath}</li>
                      ))}
                    </ul>
                    {result.report.unsupportedItems.length > 0 && (
                      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                        <p className="font-semibold">Flattened-only changes</p>
                        <ul className="mt-2 space-y-2">
                          {result.report.unsupportedItems.map((issue) => (
                            <li key={`${issue.entity.id}:${issue.code}`}>
                              <p>{issue.message}</p>
                              <p className="text-xs text-amber-100/80">
                                {issue.entity.kind}: {issue.entity.label}
                                {issue.entity.trackIndex !== null ? ` · Track ${issue.entity.trackIndex + 1}` : ""}
                                {issue.entity.timelineFrame !== null ? ` · frame ${issue.entity.timelineFrame}` : ""}
                              </p>
                              <p className="mt-1"><strong>Action:</strong> {issue.action}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {reportDownload && (
                      <a
                        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        href={reportDownload}
                        download="compatibility-report.md"
                      >
                        Download compatibility report
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
            {status === "blocked" && result?.status === "blocked" && (
              <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                <strong className="block">Compatibility issues must be fixed</strong>
                <ul className="mt-3 space-y-3">
                  {result.assessment.issues.map((entry) => (
                    <li key={`${entry.entity.id}:${entry.code}`} className="rounded-md border border-amber-500/30 p-3">
                      <span className="text-xs font-bold uppercase tracking-wide">
                        {entry.severity === "blocking" ? "Blocking" : entry.severity}
                      </span>
                      <p className="mt-1 font-medium">{entry.message}</p>
                      <p className="mt-1 text-xs text-amber-100/80">
                        Affected {entry.entity.kind}: {entry.entity.label}
                        {entry.entity.trackIndex !== null ? ` · Track ${entry.entity.trackIndex + 1}` : ""}
                        {entry.entity.timelineFrame !== null ? ` · frame ${entry.entity.timelineFrame}` : ""}
                      </p>
                      <p className="mt-2 text-sm"><strong>Action:</strong> {entry.action}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {status === "cancelled" && (
              <div role="status" className="rounded-lg border border-border bg-background-tertiary p-3 text-sm text-text-secondary">
                Handoff cancelled. Partial output is not import-ready.
              </div>
            )}
            {status === "failed" && result?.status === "failed" && (
              <div role="alert" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-100">
                <OctagonAlert size={18} className="shrink-0" aria-hidden="true" />
                <div><strong className="block">Handoff failed</strong>{result.failure.message}</div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background-tertiary p-4">
          {status === "running" ? (
            <Button variant="outline" className="min-h-11" onClick={cancel}>Cancel handoff</Button>
          ) : (
            <Button variant="ghost" className="min-h-11" onClick={onClose}>Close</Button>
          )}
          <Button
            className="min-h-11"
            onClick={start}
            disabled={!target || status === "running"}
          >
            {status === "running"
              ? "Handoff running"
              : (status === "failed" || status === "cancelled") && result?.status !== "blocked"
                ? "Retry handoff"
                : "Start handoff"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <ResolveProjectPicker
      open={isOpen && resolvePickerOpen}
      onClose={() => setResolvePickerOpen(false)}
      client={resolveClient}
    />
    </>
  );
}

export default HandoffExportDialog;
