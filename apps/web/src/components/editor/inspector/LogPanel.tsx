import { useMemo, useState, useCallback } from "react";
import {
  List,
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
  Search,
  Calendar,
  Filter,
  Hash,
} from "lucide-react";
import type { ProblemKind } from "../../../stores/problem-store";
import { useLogStore, type LogFilter } from "../../../stores/log-store";
import { useProjectStore } from "../../../stores/project-store";
import { Input, Checkbox } from "@openreel/ui";
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
  { value: "engine_error", label: "Engine" },
  { value: "bridge_error", label: "Bridge" },
  { value: "render_error", label: "Render" },
  { value: "missing_media", label: "Files" },
  { value: "unknown_error", label: "Other" },
];

// ── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Log entry row ──────────────────────────────────────────────────

function LogRow({ entry }: { entry: ReturnType<typeof useLogStore.getState>["entries"][number] }) {
  const Icon = KIND_ICON[entry.kind] ?? Bug;
  const kindLabel = KIND_LABEL[entry.kind] ?? entry.kind;

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border/30 last:border-b-0 group">
      <div className="shrink-0 mt-0.5">
        <Icon size={13} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-text-primary truncate max-w-[200px]">
            {entry.label}
          </span>
          <span className="text-[9px] text-text-muted uppercase tracking-wider shrink-0">
            {kindLabel}
          </span>
          {entry.source && (
            <span className="text-[9px] text-text-muted/60 shrink-0">
              {entry.source}
            </span>
          )}
        </div>
        <p className="text-[10px] text-text-secondary mt-0.5 line-clamp-2 break-all">
          {entry.message}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[9px] text-text-muted/50">
            {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
          </span>
          {entry.projectName && (
            <span className="text-[9px] text-text-muted/50 flex items-center gap-0.5">
              <Hash size={9} />
              {entry.projectName}
            </span>
          )}
          {entry.trackName && (
            <span className="text-[9px] text-text-muted/50">
              · {entry.trackName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Log panel ─────────────────────────────────────────────────

export function LogPanel() {
  const entries = useLogStore((s) => s.entries);
  const getFiltered = useLogStore((s) => s.getFiltered);
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id;

  const [kindFilter, setKindFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentProjectOnly, setCurrentProjectOnly] = useState(false);
  const [sinceDate, setSinceDate] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const filter: LogFilter = {};
    if (kindFilter !== "all") {
      filter.kinds = [kindFilter as ProblemKind];
    }
    if (searchQuery.trim()) {
      filter.search = searchQuery.trim();
    }
    if (currentProjectOnly && projectId) {
      filter.projectIds = [projectId];
    }
    if (sinceDate) {
      const ts = new Date(sinceDate).getTime();
      if (!isNaN(ts)) filter.since = ts;
    }
    if (untilDate) {
      // End of day
      const ts = new Date(untilDate + "T23:59:59").getTime();
      if (!isNaN(ts)) filter.until = ts;
    }
    return getFiltered(filter);
  }, [kindFilter, searchQuery, currentProjectOnly, projectId, sinceDate, untilDate, getFiltered]);

  const clearFilters = useCallback(() => {
    setKindFilter("all");
    setSearchQuery("");
    setCurrentProjectOnly(false);
    setSinceDate("");
    setUntilDate("");
  }, []);

  const hasActiveFilters =
    kindFilter !== "all" ||
    searchQuery.trim() !== "" ||
    currentProjectOnly ||
    sinceDate !== "" ||
    untilDate !== "";

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const e of entries) {
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    return counts;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-50">
        <List size={24} className="text-text-muted mb-2" />
        <p className="text-sm text-text-secondary mb-1">No errors logged</p>
        <p className="text-xs text-text-muted">
          Errors from the engine, bridges, and console will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar header */}
      <div className="shrink-0 border-b border-border">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <List size={14} className="text-text-muted" />
            <span className="text-xs font-medium text-text-primary">Log</span>
            <span className="text-[10px] bg-background-tertiary text-text-muted px-1.5 py-0.5 rounded-full font-medium">
              {entries.length}
            </span>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-1 rounded transition-colors",
              showFilters ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary",
            )}
            title="Toggle filters"
          >
            <Filter size={13} />
          </button>
        </div>

        {/* Kind tabs */}
        <div className="flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto scrollbar-none">
          {KIND_TABS.map((def) => {
            const count = kindCounts[def.value] ?? 0;
            if (def.value !== "all" && count === 0) return null;
            return (
              <button
                key={def.value}
                onClick={() => setKindFilter(def.value)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded whitespace-nowrap transition-colors",
                  kindFilter === def.value
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

        {/* Expanded filters */}
        {showFilters && (
          <div className="px-3 pb-2 space-y-2 border-t border-border/40 pt-2">
            {/* Search */}
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="pl-7 h-7 text-[11px]"
              />
            </div>

            {/* Current project only */}
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={currentProjectOnly}
                onCheckedChange={(c) => setCurrentProjectOnly(c === true)}
              />
              <span className="text-[11px] text-text-secondary">Current project only</span>
            </label>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-text-muted shrink-0" />
              <input
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
                className="flex-1 bg-background-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary"
                title="From date"
              />
              <span className="text-[10px] text-text-muted">to</span>
              <input
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
                className="flex-1 bg-background-tertiary border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary"
                title="To date"
              />
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-[10px] text-accent hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Log list */}
      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center p-6">
            <p className="text-[11px] text-text-muted">No matching log entries</p>
          </div>
        ) : (
          filtered.map((e) => <LogRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}
