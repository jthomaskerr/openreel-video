import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bug,
  FileWarning,
  MonitorX,
  AudioLines,
  ImageOff,
  Type,
  Shapes,
  Camera,
  Film,
  Sparkles,
  Zap,
  Cpu,
  Filter,
} from "lucide-react";
import type { Problem, ProblemKind } from "../../../stores/problem-store";
import {
  useProblemStore,
  RESOLVE_ACTIONS_BY_KIND,
  executeResolveAction,
  type ResolveActionId,
} from "../../../stores/problem-store";
import { useProjectStore } from "../../../stores/project-store";
import { cn } from "@openreel/ui/lib/utils";

// ── Kind metadata ──────────────────────────────────────────────────

const KIND_ICON: Partial<Record<ProblemKind, typeof AlertTriangle>> = {
  block_failed: FileWarning,
  missing_media: AlertTriangle,
  image_failed: FileWarning,
  bridge_error: Bug,
  engine_error: Cpu,
  import_error: FileWarning,
  export_error: MonitorX,
  effect_error: Sparkles,
  render_error: Film,
  audio_error: AudioLines,
  text_error: Type,
  graphics_error: Shapes,
  photo_error: Camera,
  transition_error: Zap,
  playback_error: Film,
  media_error: ImageOff,
  unknown_error: Bug,
};

const KIND_LABEL: Partial<Record<ProblemKind, string>> = {
  block_failed: "Block failed",
  missing_media: "Missing file",
  image_failed: "Image failed",
  bridge_error: "Bridge error",
  engine_error: "Engine error",
  import_error: "Import error",
  export_error: "Export error",
  effect_error: "Effect error",
  render_error: "Render error",
  audio_error: "Audio error",
  text_error: "Text error",
  graphics_error: "Graphics error",
  photo_error: "Photo error",
  transition_error: "Transition error",
  playback_error: "Playback error",
  media_error: "Media error",
  unknown_error: "Error",
};

const KIND_TABS: Array<{ value: ProblemKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing_media", label: "Files" },
  { value: "bridge_error", label: "Bridge" },
  { value: "render_error", label: "Render" },
  { value: "engine_error", label: "Engine" },
  { value: "unknown_error", label: "Other" },
];

// ── Problem row ────────────────────────────────────────────────────

function ProblemRow({
  problem,
  onDismiss,
}: {
  problem: Problem;
  onDismiss: (id: string) => void;
}) {
  const Icon = KIND_ICON[problem.kind] ?? Bug;
  const kindLabel = KIND_LABEL[problem.kind] ?? problem.kind;
  const actions = RESOLVE_ACTIONS_BY_KIND[problem.kind] ?? [];

  const handleAction = useCallback(
    (actionId: ResolveActionId) => {
      if (actionId === "dismiss") {
        onDismiss(problem.id);
      } else {
        executeResolveAction(actionId, problem);
      }
    },
    [problem, onDismiss],
  );

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border/40 last:border-b-0 group">
      <div className="shrink-0 mt-0.5">
        <Icon size={14} className="text-yellow-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-primary truncate">
            {problem.label}
          </span>
          <span className="text-[9px] text-text-muted uppercase tracking-wider shrink-0">
            {kindLabel}
          </span>
        </div>
        <p className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">
          {problem.message}
        </p>
        {problem.trackName && (
          <p className="text-[9px] text-text-muted mt-0.5">
            Track: {problem.trackName}
          </p>
        )}
      </div>
      {/* Resolve actions toolbar */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => handleAction(action.id)}
            className={cn(
              "px-2 py-0.5 rounded text-[9px] font-medium transition-colors whitespace-nowrap",
              action.resolves
                ? "bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25"
                : "bg-accent/15 text-accent hover:bg-accent/25",
            )}
            title={action.label}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────

export function ProblemsPanel() {
  const problems = useProblemStore((s) =>
    s.problems.filter((p) => !p.resolved),
  );
  const resolveProblem = useProblemStore((s) => s.resolveProblem);
  const clearAll = useProblemStore((s) => s.clearAll);
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id;

  const [activeKind, setActiveKind] = useState<string>("all");
  const [currentProjectOnly, setCurrentProjectOnly] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const handleDismiss = useCallback(
    (id: string) => {
      resolveProblem(id);
    },
    [resolveProblem],
  );

  // Filter problems: kind + optional project scope
  const filtered = useMemo(() => {
    let result = problems;
    if (activeKind !== "all") {
      result = result.filter((p) => p.kind === activeKind);
    }
    if (currentProjectOnly && projectId) {
      result = result.filter(
        (p) => !p.projectId || p.projectId === projectId,
      );
    }
    return result;
  }, [problems, activeKind, currentProjectOnly, projectId]);

  const byKind = useMemo(() => {
    const map: Partial<Record<ProblemKind, Problem[]>> = {};
    for (const p of problems) {
      (map[p.kind] ??= []).push(p);
    }
    return map;
  }, [problems]);

  const visibleTabs = KIND_TABS.filter(
    (def) =>
      def.value === "all" || (byKind[def.value]?.length ?? 0) > 0,
  );

  if (problems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-50">
        <Bug size={24} className="text-text-muted mb-2" />
        <p className="text-sm text-text-secondary mb-1">No problems</p>
        <p className="text-xs text-text-muted">
          Errors from media, rendering, and engines will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-yellow-400" />
          <span className="text-xs font-medium text-text-primary">
            Problems
          </span>
          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-medium">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-1 rounded transition-colors",
              showFilters
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary",
            )}
            title="Toggle filters"
          >
            <Filter size={12} />
          </button>
          <button
            onClick={clearAll}
            className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border/40 shrink-0 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={currentProjectOnly}
              onChange={(e) => setCurrentProjectOnly(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-[11px] text-text-secondary">
              Current project only
            </span>
          </label>
        </div>
      )}

      {/* Kind tabs */}
      {visibleTabs.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/30 overflow-x-auto scrollbar-none shrink-0">
          {visibleTabs.map((def) => {
            const count =
              def.value === "all"
                ? problems.length
                : (byKind[def.value]?.length ?? 0);
            return (
              <button
                key={def.value}
                onClick={() => setActiveKind(def.value)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded whitespace-nowrap transition-colors",
                  activeKind === def.value
                    ? "bg-accent/20 text-accent font-medium"
                    : "text-text-muted hover:text-text-secondary hover:bg-background-tertiary",
                )}
              >
                {def.label}
                <span className="ml-1 text-[9px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Problem list */}
      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center p-6">
            <p className="text-[11px] text-text-muted">
              No problems in this category
            </p>
          </div>
        ) : (
          filtered.map((p) => (
            <ProblemRow
              key={p.id}
              problem={p}
              onDismiss={handleDismiss}
            />
          ))
        )}
      </div>
    </div>
  );
}
