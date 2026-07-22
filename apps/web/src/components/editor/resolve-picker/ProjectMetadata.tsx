import { AlertTriangle, Ban, CalendarDays, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { Button, Progress } from "@openreel/ui";
import type { ResolvePreview } from "@openreel/core";
import type { ResolvePublicExportJob } from "../../../services/resolve-bridge-client";
import { ClipGroups } from "./ClipGroups";
import { MiniTimeline } from "./MiniTimeline";
import { RenderedOutputPreview } from "./RenderedOutputPreview";

export interface ProjectMetadataProps {
  readonly preview: ResolvePreview;
  readonly onLaunch: () => void;
  readonly onCancel: () => void;
  readonly onRetryLaunch: () => void;
  readonly phase: ResolvePublicExportJob["phase"] | null;
  readonly percent: number;
  readonly warnings: readonly string[];
  readonly statusMessage: string;
  readonly launchError: string | null;
  readonly canStart: boolean;
  readonly canCancel: boolean;
  readonly isStarting: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
});

function compatibilityText(preview: ResolvePreview): string {
  const { compatibility } = preview;
  if (compatibility.status === "blocked") {
    return `Blocked by ${compatibility.blockingIssueCount} compatibility ${compatibility.blockingIssueCount === 1 ? "issue" : "issues"}`;
  }
  if (compatibility.status === "degraded") {
    return `Compatible with ${compatibility.warningCount} ${compatibility.warningCount === 1 ? "warning" : "warnings"}`;
  }
  return compatibility.warningCount > 0
    ? `Ready for Resolve with ${compatibility.warningCount} ${compatibility.warningCount === 1 ? "warning" : "warnings"}`
    : "Ready for Resolve";
}

export function ProjectMetadata({
  preview,
  onLaunch,
  onCancel,
  onRetryLaunch,
  phase,
  percent,
  warnings,
  statusMessage,
  launchError,
  canStart,
  canCancel,
  isStarting,
}: ProjectMetadataProps) {
  const compatibility = compatibilityText(preview);
  const CompatibilityIcon = preview.compatibility.status === "blocked"
    ? Ban
    : preview.compatibility.status === "degraded"
      ? AlertTriangle
      : CheckCircle2;

  return (
    <section aria-labelledby="resolve-project-title" className="flex min-h-full flex-col">
      <div className="flex-1 space-y-5 p-4 sm:p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="resolve-project-title" className="break-words text-xl font-semibold tracking-tight">
                {preview.name}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {preview.description || "No project description has been added."}
              </p>
            </div>
            <div
              className="flex min-h-11 items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm font-medium"
              aria-label={`Resolve compatibility: ${compatibility}`}
            >
              <CompatibilityIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{compatibility}</span>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border bg-card p-3">
            <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <CalendarDays aria-hidden="true" className="h-4 w-4" /> Created
            </dt>
            <dd className="mt-2 text-sm font-medium">{dateFormatter.format(preview.createdAt)}</dd>
          </div>
          <div className="rounded-md border bg-card p-3">
            <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Clock3 aria-hidden="true" className="h-4 w-4" /> Last edited
            </dt>
            <dd className="mt-2 text-sm font-medium">{dateTimeFormatter.format(preview.modifiedAt)}</dd>
          </div>
          <div className="rounded-md border bg-card p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duration</dt>
            <dd className="mt-2 text-sm font-medium tabular-nums">
              {preview.durationFrames.toLocaleString("en-GB")} frames
            </dd>
          </div>
          <div className="rounded-md border bg-card p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Frame rate</dt>
            <dd className="mt-2 text-sm font-medium tabular-nums">{preview.frameRate.toLocaleString("en-GB")} fps</dd>
          </div>
          <div className="rounded-md border bg-card p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</dt>
            <dd className="mt-2 flex flex-wrap gap-x-1 text-sm font-medium">
              <span>{preview.trackCount.toLocaleString("en-GB")} tracks</span>
              <span aria-hidden="true">·</span>
              <span>{preview.clipCount.toLocaleString("en-GB")} clips</span>
            </dd>
          </div>
          <div className="rounded-md border bg-card p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Media</dt>
            <dd className="mt-2 text-sm font-medium">{preview.mediaCount.toLocaleString("en-GB")} media items</dd>
          </div>
        </dl>

        <RenderedOutputPreview render={preview.render} />
        <MiniTimeline timeline={preview.miniTimeline} />
        <ClipGroups groups={preview.clipGroups} />

        <div aria-live="polite" className="space-y-2 rounded-md border bg-card p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="font-medium">{statusMessage}</p>
            {phase && <span className="font-mono text-xs text-muted-foreground">{phase}</span>}
          </div>
          {(isStarting || (phase && phase !== "completed" && phase !== "failed" && phase !== "cancelled")) && (
            <Progress value={percent} aria-label="Resolve export progress" />
          )}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
            </ul>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">
          Revision <span className="font-mono">{preview.revision}</span>
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {canCancel && (
            <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
              Cancel Resolve export
            </Button>
          )}
          {launchError ? (
            <Button type="button" className="min-h-11 min-w-36" onClick={onRetryLaunch}>
              Retry opening Resolve
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 min-w-36"
              disabled={preview.compatibility.status === "blocked" || !canStart}
              onClick={onLaunch}
            >
              {isStarting ? (
                <span className="flex items-center gap-2">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Starting export…
                </span>
              ) : "Open in Resolve"}
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
