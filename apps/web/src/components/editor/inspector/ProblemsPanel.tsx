import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bug,
  FileWarning,
  X,
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
} from "lucide-react";
import type { Problem, ProblemKind } from "../../../stores/problem-store";
import { useProblemStore } from "../../../stores/problem-store";
import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";

// ── Kind metadata ────────────────────────────────────────────────────

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

const TAB_DEFS: Array<{ value: ProblemKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing_media", label: "Files" },
  { value: "bridge_error", label: "Bridge" },
  { value: "render_error", label: "Render" },
  { value: "engine_error", label: "Engine" },
  { value: "unknown_error", label: "Other" },
];

// ── Problem row ──────────────────────────────────────────────────────

function ProblemRow({
  problem,
  onDismiss,
}: {
  problem: Problem;
  onDismiss: (id: string) => void;
}) {
  const Icon = KIND_ICON[problem.kind] ?? Bug;
  const label = KIND_LABEL[problem.kind] ?? problem.kind;

  return (
    <div className="flex items-start gap-2 px-3 py-2.5 border-b border-border/40 last:border-b-0 group">
      <div className="shrink-0 mt-0.5">
        <Icon size={14} className="text-yellow-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-primary truncate">
            {problem.label}
          </span>
          <span className="text-[9px] text-text-muted uppercase tracking-wider shrink-0">
            {label}
          </span>
        </div>
        <p className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">
          {problem.message}
        </p>
      </div>
      <button
        onClick={() => onDismiss(problem.id)}
        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-background-tertiary transition-opacity"
        aria-label="Dismiss"
      >
        <X size={12} className="text-text-muted" />
      </button>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

export function ProblemsPanel() {
  const problems = useProblemStore((s) => s.problems.filter((p) => !p.resolved));
  const resolveProblem = useProblemStore((s) => s.resolveProblem);
  const clearAll = useProblemStore((s) => s.clearAll);
  const [activeTab, setActiveTab] = useState<string>("all");

  const handleDismiss = useCallback(
    (id: string) => {
      resolveProblem(id);
    },
    [resolveProblem],
  );

  const byKind = useMemo(() => {
    const map: Partial<Record<ProblemKind, Problem[]>> = {};
    for (const p of problems) {
      (map[p.kind] ??= []).push(p);
    }
    return map;
  }, [problems]);

  const visibleTabs = TAB_DEFS.filter(
    (def) => def.value === "all" || (byKind[def.value]?.length ?? 0) > 0,
  );

  const filtered =
    activeTab === "all"
      ? problems
      : problems.filter((p) => p.kind === activeTab);

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

      {/* Filter tabs */}
      {visibleTabs.length > 1 && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v ?? "all")}
          className="shrink-0"
        >
          <TabsList className="px-3 pt-1.5 pb-1 gap-1 h-auto bg-transparent">
            {visibleTabs.map((def) => {
              const count =
                def.value === "all"
                  ? problems.length
                  : (byKind[def.value]?.length ?? 0);
              return (
                <TabsTrigger
                  key={def.value}
                  value={def.value}
                  className="text-[10px] h-6 px-2 data-[state=active]:bg-background-tertiary"
                >
                  {def.label}
                  <span className="ml-1 text-[9px] text-text-muted">
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
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
            <ProblemRow key={p.id} problem={p} onDismiss={handleDismiss} />
          ))
        )}
      </div>
    </div>
  );
}
