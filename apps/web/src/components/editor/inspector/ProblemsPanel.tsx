import { useCallback, useMemo } from "react";
import {
  AlertTriangle,
  FileQuestion,
  ImageOff,
  Sparkles,
  X,
  Link,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { Problem, ProblemKind, ResolveActionId } from "../../../stores/problem-store";
import {
  useProblemStore,
  RESOLVE_ACTIONS_BY_KIND,
  executeResolveAction,
} from "../../../stores/problem-store";
import { useProjectStore } from "../../../stores/project-store";
import {
  selectMediaAvailabilityView,
  useMediaAvailabilityVersion,
} from "../../../services/media-availability-view";
import { mediaAvailabilityRuntime } from "../../../services/media-verification";
import { cn } from "@openreel/ui/lib/utils";

// ── Kind metadata ──────────────────────────────────────────────────

const KIND_META: Record<ProblemKind, { icon: typeof AlertTriangle; label: string; color: string }> = {
  missing_media:     { icon: FileQuestion, label: "Missing file",   color: "text-yellow-400" },
  block_failed:      { icon: AlertTriangle, label: "Import failed",  color: "text-red-400" },
  image_failed:      { icon: ImageOff,     label: "Image failed",   color: "text-orange-400" },
  import_error:      { icon: AlertTriangle, label: "Import error",   color: "text-red-400" },
  generation_failed: { icon: Sparkles,     label: "Generation failed", color: "text-purple-400" },
};

const ACTION_ICON: Partial<Record<ResolveActionId, typeof Link>> = {
  link_file:        Link,
  remove_media:     Trash2,
  retry_generation: RefreshCw,
};

// ── Problem row ────────────────────────────────────────────────────

function ProblemRow({
  problem,
  onDismiss,
}: {
  problem: Problem;
  onDismiss: (id: string) => void;
}) {
  const meta = KIND_META[problem.kind];
  const Icon = meta.icon;
  const actions = RESOLVE_ACTIONS_BY_KIND[problem.kind] ?? [];

  const handleAction = useCallback(
    (actionId: ResolveActionId) => {
      executeResolveAction(actionId, problem);
    },
    [problem],
  );

  return (
    <div className="px-3 py-2.5 border-b border-border/40 last:border-b-0">
      {/* Top row: icon + name + kind badge + dismiss */}
      <div className="flex items-start gap-2">
        <Icon size={13} className={cn("shrink-0 mt-0.5", meta.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-text-primary truncate max-w-[160px]">
              {problem.label}
            </span>
            <span className={cn("text-[9px] font-medium uppercase tracking-wide shrink-0 px-1 py-px rounded", meta.color, "bg-current/10")}>
              {meta.label}
            </span>
          </div>
          {problem.message && (
            <p className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">
              {problem.message}
            </p>
          )}
          {problem.trackName && (
            <p className="text-[9px] text-text-muted mt-0.5">
              {problem.trackName}
            </p>
          )}
        </div>
        <button
          onClick={() => onDismiss(problem.id)}
          className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-background-tertiary transition-colors"
          title="Dismiss"
        >
          <X size={11} />
        </button>
      </div>

      {/* Action row */}
      {actions.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 ml-5">
          {actions.map((action, i) => {
            const ActionIcon = ACTION_ICON[action.id];
            const isPrimary = i === 0;
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
                  isPrimary
                    ? "bg-accent text-white hover:bg-accent/85"
                    : "bg-background-tertiary text-text-secondary hover:bg-red-500/15 hover:text-red-400",
                )}
              >
                {ActionIcon && <ActionIcon size={10} />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────

export function ProblemsPanel() {
  const allProblems = useProblemStore((s) => s.problems.filter((p) => !p.resolved));
  const resolveProblem = useProblemStore((s) => s.resolveProblem);
  const clearAll = useProblemStore((s) => s.clearAll);
  const projectId = useProjectStore((s) => s.project?.id);
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const availabilityVersion = useMediaAvailabilityVersion(projectId);

  const problems = useMemo(() => {
    const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
    const isConfirmedMissing = (mediaId: string) => selectMediaAvailabilityView(
      mediaById.get(mediaId),
      mediaAvailabilityRuntime.get(projectId, mediaId)?.status,
    ).isMissing;
    const scoped = allProblems.filter((problem) => {
      if (problem.projectId && problem.projectId !== projectId) return false;
      if (problem.kind !== "missing_media") return true;
      return problem.mediaId ? isConfirmedMissing(problem.mediaId) : false;
    });
    const knownMissingIds = new Set(
      scoped.filter((problem) => problem.kind === "missing_media").map((problem) => problem.mediaId),
    );
    const derived = mediaItems
      .filter((item) => !knownMissingIds.has(item.id) && isConfirmedMissing(item.id))
      .map((item): Problem => ({
        id: `availability:${projectId}:${item.id}`,
        kind: "missing_media",
        message: `${item.sourceFile?.name ?? item.name} is confirmed missing.`,
        label: item.title ?? item.name,
        timestamp: 0,
        resolved: false,
        projectId,
        mediaId: item.id,
      }));
    return [...scoped, ...derived];
  }, [allProblems, availabilityVersion, mediaItems, projectId]);

  const handleDismiss = useCallback(
    (id: string) => resolveProblem(id),
    [resolveProblem],
  );

  if (problems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
          <AlertTriangle size={16} className="text-text-muted" />
        </div>
        <p className="text-sm text-text-secondary font-medium">No problems</p>
        <p className="text-xs text-text-muted mt-1">
          Missing files and failed generations will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-yellow-400" />
          <span className="text-xs font-medium text-text-primary">Problems</span>
          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-px rounded-full font-medium tabular-nums">
            {problems.length}
          </span>
        </div>
        <button
          onClick={clearAll}
          className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          Clear all
        </button>
      </div>

      {/* Problem list */}
      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
        {problems.map((p) => (
          <ProblemRow key={p.id} problem={p} onDismiss={handleDismiss} />
        ))}
      </div>
    </div>
  );
}
