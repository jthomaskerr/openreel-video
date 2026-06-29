import React, { useCallback, useMemo, useState } from "react";
import { Film, Music, ImageIcon, FileText, Layers, Sparkles, GitBranch, Link2, RefreshCw, Trash2, Download, X as XIcon } from "lucide-react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { resolveAssetCategory } from "../asset-category";
import {
  MetadataEditor,
  FileInfoGrid,
  TypeSection,
  TypeDetailRow,
  VersionList,
  formatSize,
  formatDuration,
  type InfoRow,
} from "../asset-manager/AssetDetailShared";

// ── Secondary tab bar ──────────────────────────────────────────────

type AssetTabId = "clip" | "file" | "generation" | "versions" | "usages";

interface AssetTabDef {
  id: AssetTabId;
  label: string;
  icon: React.ElementType;
}

const TAB_DEFS: Record<AssetTabId, AssetTabDef> = {
  clip:       { id: "clip",       label: "Clip",       icon: Film },
  file:       { id: "file",       label: "File",       icon: FileText },
  generation: { id: "generation", label: "Generation", icon: Sparkles },
  versions:   { id: "versions",   label: "Versions",   icon: GitBranch },
  usages:     { id: "usages",     label: "Usages",     icon: Link2 },
};

function AssetSecondaryTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: AssetTabDef[];
  activeId: AssetTabId;
  onSelect: (id: AssetTabId) => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + dir + tabs.length) % tabs.length];
    if (next) onSelect(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Asset inspector tabs"
      className="flex items-center gap-0.5 px-2 border-b border-border overflow-x-auto scrollbar-none shrink-0"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={[
              "flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              active
                ? "text-accent border-accent"
                : "text-fg-3 border-transparent hover:text-fg",
            ].join(" ")}
          >
            <Icon size={11} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function assetSourceIds(item: MediaItem): string[] {
  const inputs = item.generationMeta?.inputs;
  if (!inputs || typeof inputs !== "object") return [];
  if (!("sourceAssets" in inputs)) return [];
  const sa = inputs.sourceAssets;
  if (!Array.isArray(sa)) return [];
  const ids: string[] = [];
  for (const ref of sa) {
    if (ref && typeof ref === "object" && "id" in ref && typeof ref.id === "string") {
      ids.push(ref.id);
    }
  }
  return ids;
}

function formatStatus(status: string | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "realized": return "text-green-400";
    case "failed":
    case "cancelled": return "text-red-400";
    case "processing":
    case "submitting": return "text-yellow-400";
    default: return "text-text-muted";
  }
}

// ── Preview ────────────────────────────────────────────────────────

function AssetPreview({ item }: { item: MediaItem }) {
  const category = resolveAssetCategory(item);
  if (category.isMetadata) {
    return (
      <div className="mx-4 mt-3 rounded-lg border border-border bg-background-secondary overflow-hidden">
        <div className="w-full h-20 flex flex-col items-center justify-center bg-background-tertiary gap-1.5">
          <FileText size={28} className="text-purple-400/40" />
          <span className="text-[10px] text-text-muted">{category.label}</span>
        </div>
      </div>
    );
  }
  if (item.type === "audio") {
    return (
      <div className="mx-4 mt-3 rounded-lg border border-border bg-background-secondary overflow-hidden">
        <div className="w-full h-20 flex flex-col items-center justify-center bg-background-tertiary gap-1.5">
          <Music size={28} className="text-green-400/40" />
          <span className="text-[10px] text-text-muted">
            {item.metadata.duration ? formatDuration(item.metadata.duration) : "Audio"}
          </span>
        </div>
        {item.isPlaceholder && (
          <div className="px-3 py-1 bg-yellow-500/10 border-t border-yellow-500/20">
            <span className="text-[10px] text-yellow-400 font-medium">⚠ Missing file</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mx-4 mt-3 rounded-lg border border-border bg-background-secondary overflow-hidden">
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt={item.title ?? item.name}
          className="w-full aspect-video object-cover"
        />
      ) : (
        <div className="w-full aspect-video flex items-center justify-center bg-background-tertiary">
          {item.type === "image"
            ? <ImageIcon size={32} className="text-text-muted/30" />
            : <Film size={32} className="text-text-muted/30" />
          }
        </div>
      )}
      {item.isPlaceholder && (
        <div className="px-3 py-1 bg-yellow-500/10 border-t border-yellow-500/20">
          <span className="text-[10px] text-yellow-400 font-medium">⚠ Missing file — placeholder</span>
        </div>
      )}
      {item.isPending && !item.isPlaceholder && (
        <div className="px-3 py-1 bg-blue-500/10 border-t border-blue-500/20">
          <span className="text-[10px] text-blue-400 font-medium">⏳ Generating…</span>
        </div>
      )}
    </div>
  );
}

// ── Tab: Clip ──────────────────────────────────────────────────────

function ClipTab({ item }: { item: MediaItem }) {
  return (
    <div className="px-4 pt-3 pb-4">
      <MetadataEditor item={item} onSaved={() => {}} />
    </div>
  );
}

// ── Tab: File ──────────────────────────────────────────────────────

function FileTab({ item }: { item: MediaItem }) {
  const fileRows: InfoRow[] = [];
  fileRows.push({ label: "Filename", value: item.name });
  fileRows.push({ label: "Type", value: item.type });
  if (item.metadata.fileSize) fileRows.push({ label: "Size", value: formatSize(item.metadata.fileSize) });
  if (item.metadata.duration) fileRows.push({ label: "Duration", value: formatDuration(item.metadata.duration) });
  if (item.metadata.width && item.metadata.height) {
    fileRows.push({ label: "Dimensions", value: `${item.metadata.width}×${item.metadata.height}` });
  }

  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      {item.type === "video" && (
        <TypeSection title="Video">
          <TypeDetailRow label="Frame Rate" value={item.metadata.frameRate ? `${item.metadata.frameRate} fps` : "—"} />
          <TypeDetailRow label="Codec" value={item.metadata.codec || "—"} />
          <TypeDetailRow label="Audio Channels" value={item.metadata.channels ? String(item.metadata.channels) : "—"} />
          {item.metadata.audioTrackCount != null && (
            <TypeDetailRow label="Audio Tracks" value={String(item.metadata.audioTrackCount)} />
          )}
          <TypeDetailRow label="Sample Rate" value={item.metadata.sampleRate ? `${item.metadata.sampleRate} Hz` : "—"} />
        </TypeSection>
      )}
      {item.type === "audio" && (
        <TypeSection title="Audio">
          <TypeDetailRow label="Sample Rate" value={item.metadata.sampleRate ? `${item.metadata.sampleRate} Hz` : "—"} />
          <TypeDetailRow label="Channels" value={item.metadata.channels ? String(item.metadata.channels) : "—"} />
          <TypeDetailRow label="Codec" value={item.metadata.codec || "—"} />
          {item.metadata.audioTrackCount != null && (
            <TypeDetailRow label="Audio Tracks" value={String(item.metadata.audioTrackCount)} />
          )}
          <TypeDetailRow label="Waveform" value={item.waveformData ? "Generated" : "Not generated"} />
        </TypeSection>
      )}
      {item.type === "image" && (
        <TypeSection title="Image">
          <TypeDetailRow label="Codec" value={item.metadata.codec || "—"} />
          <TypeDetailRow label="Thumbnail" value={item.thumbnailUrl ? "Available" : "Not generated"} />
        </TypeSection>
      )}
      <FileInfoGrid rows={fileRows} />
      {/* Filmstrip for video */}
      {item.filmstripThumbnails && item.filmstripThumbnails.length > 0 && (
        <TypeSection title="Filmstrip">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {item.filmstripThumbnails.map((thumb, i) => (
              <img
                key={i}
                src={thumb.url}
                alt={`Frame at ${thumb.timestamp}s`}
                className="h-10 rounded flex-shrink-0"
                title={`${thumb.timestamp.toFixed(1)}s`}
              />
            ))}
          </div>
        </TypeSection>
      )}
    </div>
  );
}

// ── Tab: Generation ────────────────────────────────────────────────

function GenerationTab({ item }: { item: MediaItem }) {
  const gen = item.generationMeta;
  if (!gen) return <div className="px-4 pt-3 text-[11px] text-text-muted">No generation data.</div>;

  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);

  // Collect source asset references
  const sourceIds = useMemo(() => assetSourceIds(item), [item]);
  const sourceItems = useMemo(
    () => sourceIds.map((id) => mediaItems.find((m) => m.id === id)).filter((m): m is MediaItem => m != null),
    [sourceIds, mediaItems],
  );

  // Collect source metadata block IDs
  const sourceBlockIds = useMemo<string[]>(() => {
    const inputs = gen.inputs;
    if (!inputs || typeof inputs !== "object") return [];
    if (!("sourceMetadataBlockIds" in inputs)) return [];
    const val = inputs.sourceMetadataBlockIds;
    if (!Array.isArray(val)) return [];
    return val.filter((v): v is string => typeof v === "string");
  }, [gen.inputs]);

  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      <TypeSection title="Provider">
        <TypeDetailRow label="Provider" value={gen.provider || "—"} />
        <TypeDetailRow label="Model" value={gen.model || "—"} />
        <TypeDetailRow label="Job ID" value={gen.jobId ?? "—"} />
        <div className="flex items-center justify-between py-1">
          <span className="text-[10px] text-text-secondary">Status</span>
          <span className={`text-[10px] font-medium ${statusColor(gen.status)}`}>
            {formatStatus(gen.status)}
          </span>
        </div>
      </TypeSection>

      {gen.prompt && (
        <TypeSection title="Prompt">
          <p className="text-[10px] text-text-primary leading-relaxed">{gen.prompt}</p>
        </TypeSection>
      )}

      {gen.negativePrompt && (
        <TypeSection title="Negative Prompt">
          <p className="text-[10px] text-text-muted leading-relaxed">{gen.negativePrompt}</p>
        </TypeSection>
      )}

      {sourceItems.length > 0 && (
        <TypeSection title="Source Assets">
          <div className="space-y-1.5">
            {sourceItems.map((src) => (
              <button
                key={src.id}
                onClick={() => setInspectedAsset(src)}
                className="w-full flex items-center gap-2.5 p-2 rounded-md border border-border hover:border-accent/40 hover:bg-hover transition-colors text-left"
              >
                <div className="w-10 h-7 rounded bg-background-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {src.thumbnailUrl ? (
                    <img src={src.thumbnailUrl} alt={src.title ?? src.name} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={12} className="text-text-muted/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium truncate text-text-primary">{src.title ?? src.name}</div>
                  <div className="text-[9px] text-text-muted">{src.type} · {src.group ?? "—"}</div>
                </div>
              </button>
            ))}
          </div>
        </TypeSection>
      )}

      {sourceBlockIds.length > 0 && (
        <TypeSection title="Source Scenes">
          <div className="space-y-0.5">
            {sourceBlockIds.map((id) => (
              <div key={id} className="text-[9px] font-mono text-text-muted px-1 py-0.5">{id}</div>
            ))}
          </div>
        </TypeSection>
      )}
    </div>
  );
}

// ── Tab: Versions ──────────────────────────────────────────────────

function VersionsTab({ item }: { item: MediaItem }) {
  return (
    <div className="px-4 pt-3 pb-4">
      <VersionList item={item} />
    </div>
  );
}

// ── Tab: Usages ────────────────────────────────────────────────────

interface TimelineClipRef {
  clipId: string;
  trackId: string;
  trackName: string;
  startTime: number;
  duration: number;
}

function UsagesTab({ item }: { item: MediaItem }) {
  const project = useProjectStore((s) => s.project);
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);
  const pixelsPerSecond = useTimelineStore((s) => s.pixelsPerSecond);

  // Assets that reference this one (i.e., their sourceAssets includes item.id)
  const referencingAssets = useMemo(
    () =>
      project.mediaLibrary.items.filter((m) => {
        if (m.id === item.id) return false;
        return assetSourceIds(m).includes(item.id);
      }),
    [project.mediaLibrary.items, item.id],
  );

  // Timeline clips that use this asset directly (clip.mediaId === item.id)
  const timelineClips = useMemo<TimelineClipRef[]>(() => {
    const refs: TimelineClipRef[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.mediaId === item.id) {
          refs.push({
            clipId: clip.id,
            trackId: track.id,
            trackName: track.name || track.type,
            startTime: clip.startTime,
            duration: clip.duration,
          });
        }
      }
    }
    return refs;
  }, [project.timeline.tracks, item.id]);

  const handleScrollToClip = useCallback(
    (ref: TimelineClipRef) => {
      window.dispatchEvent(
        new CustomEvent("openreel:timeline-scroll-to", {
          detail: { clipId: ref.clipId, startTime: ref.startTime, pixelsPerSecond },
        }),
      );
    },
    [pixelsPerSecond],
  );

  const empty = referencingAssets.length === 0 && timelineClips.length === 0;

  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      {empty && (
        <p className="text-[11px] text-text-muted text-center py-6">No usages found.</p>
      )}

      {referencingAssets.length > 0 && (
        <TypeSection title={`Referenced by (${referencingAssets.length})`}>
          <div className="space-y-1.5">
            {referencingAssets.map((ref) => (
              <button
                key={ref.id}
                onClick={() => setInspectedAsset(ref)}
                className="w-full flex items-center gap-2.5 p-2 rounded-md border border-border hover:border-accent/40 hover:bg-hover transition-colors text-left"
                title="Open in inspector"
              >
                <div className="w-10 h-7 rounded bg-background-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {ref.thumbnailUrl ? (
                    <img src={ref.thumbnailUrl} alt={ref.title ?? ref.name} className="w-full h-full object-cover" />
                  ) : ref.type === "audio" ? (
                    <Music size={12} className="text-text-muted/40" />
                  ) : (
                    <ImageIcon size={12} className="text-text-muted/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium truncate text-text-primary">{ref.title ?? ref.name}</div>
                  <div className="text-[9px] text-text-muted">{ref.type} · {ref.group ?? "library"}</div>
                </div>
                <Layers size={10} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        </TypeSection>
      )}

      {timelineClips.length > 0 && (
        <TypeSection title={`Timeline (${timelineClips.length})`}>
          <div className="space-y-1.5">
            {timelineClips.map((ref) => (
              <button
                key={ref.clipId}
                onClick={() => handleScrollToClip(ref)}
                className="w-full flex items-center gap-2.5 p-2 rounded-md border border-border hover:border-accent/40 hover:bg-hover transition-colors text-left"
                title="Scroll to clip in timeline"
              >
                <div className="w-10 h-7 rounded bg-background-tertiary flex-shrink-0 flex items-center justify-center">
                  <Film size={12} className="text-text-muted/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium text-text-primary">{ref.trackName}</div>
                  <div className="text-[9px] text-text-muted">
                    {formatDuration(ref.startTime)} · {formatDuration(ref.duration)}
                  </div>
                </div>
                <Film size={10} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        </TypeSection>
      )}
    </div>
  );
}

// ── Asset Inspector Header ─────────────────────────────────────────

const ASSET_TYPE_ICON: Record<string, React.ElementType> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  metadata: FileText,
};

function AssetInspectorHeader({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const category = resolveAssetCategory(item);
  const typeKey = category.isMetadata ? "metadata" : item.type;
  const Icon = ASSET_TYPE_ICON[typeKey] ?? FileText;
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
      <Icon size={14} className="text-text-muted shrink-0" />
      <span className="text-xs font-medium truncate flex-1">{item.title || item.name}</span>
      <span className="text-[10px] text-text-muted uppercase tracking-wider shrink-0">{category.label}</span>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-hover text-fg-2 hover:text-fg transition-colors"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

// ── Asset Inspector Toolbar ────────────────────────────────────────

function AssetInspectorToolbar({ item }: { item: MediaItem }) {
  const replaceMediaAsset = useProjectStore((s) => s.replaceMediaAsset);
  const deleteMediaFn = useProjectStore((s) => s.deleteMedia);
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);

  const handleReplace = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = item.type === "video" ? "video/*" : item.type === "audio" ? "audio/*" : "image/*";
    input.style.display = "none";
    input.onchange = async (event) => {
      try {
        const target = event.target;
        const file = target instanceof HTMLInputElement ? target.files?.[0] : undefined;
        if (file) await replaceMediaAsset(item.id, file);
      } finally {
        input.remove();
      }
    };
    document.body.appendChild(input);
    input.click();
  }, [item.id, item.type, replaceMediaAsset]);

  const handleDelete = useCallback(async () => {
    await deleteMediaFn(item.id);
    setInspectedAsset(null);
  }, [item.id, deleteMediaFn, setInspectedAsset]);

  const handleDownload = useCallback(() => {
    if (!item.blob) return;
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [item.blob, item.name]);

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0 bg-background-secondary/50">
      <button
        onClick={handleReplace}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-secondary hover:text-text hover:bg-hover transition-colors"
        title="Replace file"
      >
        <RefreshCw size={11} />
        Replace
      </button>
      {item.blob && (
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-secondary hover:text-text hover:bg-hover transition-colors"
          title="Download original"
        >
          <Download size={11} />
          Download
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={handleDelete}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        title="Delete asset"
      >
        <Trash2 size={11} />
        Delete
      </button>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────

export function AssetInspectorWithTabs({ item }: { item: MediaItem }) {
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);
  const category = resolveAssetCategory(item);

  const availableTabs = useMemo<AssetTabDef[]>(() => {
    const tabs: AssetTabId[] = ["clip"];
    if (!category.isMetadata) tabs.push("file");
    if (item.generationMeta) tabs.push("generation");
    tabs.push("versions", "usages");
    return tabs.map((id) => TAB_DEFS[id]);
  }, [category.isMetadata, item.generationMeta]);

  const [activeTab, setActiveTab] = useState<AssetTabId>("clip");

  const resolvedTab = availableTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (availableTabs[0]?.id ?? "clip");

  return (
    <>
      <AssetInspectorHeader item={item} onClose={() => setInspectedAsset(null)} />
      <AssetInspectorToolbar item={item} />
      <AssetPreview item={item} />
      <AssetSecondaryTabs tabs={availableTabs} activeId={resolvedTab} onSelect={setActiveTab} />
      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
        {resolvedTab === "clip" && <ClipTab item={item} />}
        {resolvedTab === "file" && <FileTab item={item} />}
        {resolvedTab === "generation" && <GenerationTab item={item} />}
        {resolvedTab === "versions" && <VersionsTab item={item} />}
        {resolvedTab === "usages" && <UsagesTab item={item} />}
      </div>
    </>
  );
}
