import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Film, Music, ImageIcon, FileText, Layers, Sparkles, GitBranch, Link2, RefreshCw, Trash2, Download, X as XIcon, Play, Pause } from "lucide-react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";
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

type AssetTabId = "clip" | "file" | "audio" | "generation" | "versions" | "usages";

interface AssetTabDef {
  id: AssetTabId;
  label: string;
  icon: React.ElementType;
}

const TAB_DEFS: Record<AssetTabId, AssetTabDef> = {
  clip:       { id: "clip",       label: "Clip",       icon: Film },
  file:       { id: "file",       label: "File",       icon: FileText },
  audio:      { id: "audio",      label: "Audio",      icon: Music },
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
    // Metadata media items use a 1×1 transparent PNG placeholder blob.
    // Only show the thumbnail section when a real (non-blob) thumbnail exists.
    if (!item.thumbnailUrl || item.thumbnailUrl.startsWith("blob:")) return null;
    return (
      <div className="mx-4 mt-3 rounded-lg border border-border bg-background-secondary overflow-hidden">
        <img
          src={item.thumbnailUrl}
          alt={item.title ?? item.name}
          className="w-full aspect-square object-cover"
        />
      </div>
    );
  }
  if (item.type === "audio") {
    return (
      <div className="mx-4 mt-3 rounded-lg border border-border bg-background-secondary overflow-hidden">
        <div className="p-3">
          <WaveformPreview item={item} />
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

// ── Waveform Preview ────────────────────────────────────────────────

function WaveformPreview({ item }: { item: MediaItem }) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurferInstance | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);

    const container = waveformRef.current;
    if (!container) return;
    let objectUrl: string | null = null;
    let url = item.originalUrl ?? null;
    if (item.blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(item.blob);
      url = objectUrl;
    }

    if (!url) return;

    const wavesurfer = WaveSurfer.create({
      container,
      url,
      peaks: item.waveformData ? [item.waveformData] : undefined,
      duration: item.metadata.duration || undefined,
      waveColor: "rgba(148, 163, 184, 0.45)",
      progressColor: "rgb(34, 197, 94)",
      cursorColor: "rgb(34, 197, 94)",
      cursorWidth: 2,
      height: 72,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      dragToSeek: true,
      normalize: true,
    });

    wavesurferRef.current = wavesurfer;
    wavesurfer.on("timeupdate", (time: number) => setCurrentTime(time));
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => {
      setIsPlaying(false);
      setCurrentTime(item.metadata.duration || 0);
    });

    return () => {
      wavesurferRef.current = null;
      wavesurfer.destroy();
      if (objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(objectUrl);
    };
  }, [item.blob, item.id, item.metadata.duration, item.originalUrl, item.waveformData]);

  const handlePlayPause = useCallback(() => {
    void wavesurferRef.current?.playPause();
  }, []);

  return (
    <div className="space-y-2">
      <div
        ref={waveformRef}
        data-testid="audio-waveform"
        className="min-h-[72px] overflow-hidden rounded-md border border-border bg-background-tertiary"
      />
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={handlePlayPause}
          aria-label={isPlaying ? "Pause audio preview" : "Play audio preview"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white hover:bg-accent/90 transition-colors"
          disabled={!item.blob && !item.originalUrl}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="font-mono text-[10px] text-text-secondary">
          {formatDuration(currentTime)} / {item.metadata.duration ? formatDuration(item.metadata.duration) : "—"}
        </span>
      </div>
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

type WaveSurferInstance = ReturnType<typeof WaveSurfer.create>;

function formatBpm(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} BPM` : "—";
}

function formatOptionalText(value: string | undefined): string {
  return value && value.trim() ? value : "—";
}

function formatBooleanMetadata(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}

function AudioTab({ item }: { item: MediaItem }) {
  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      <TypeSection title="Audio Analysis">
        <TypeDetailRow label="BPM" value={formatBpm(item.metadata.bpm)} />
        <TypeDetailRow label="Key" value={formatOptionalText(item.metadata.key)} />
        <TypeDetailRow label="Scale" value={formatOptionalText(item.metadata.scale)} />
        <TypeDetailRow label="Has Lyrics" value={formatBooleanMetadata(item.metadata.has_lyrics)} />
      </TypeSection>

      <TypeSection title="Audio">
        <TypeDetailRow label="Sample Rate" value={item.metadata.sampleRate ? `${item.metadata.sampleRate} Hz` : "—"} />
        <TypeDetailRow label="Channels" value={item.metadata.channels ? String(item.metadata.channels) : "—"} />
        <TypeDetailRow label="Codec" value={item.metadata.codec || "—"} />
        {item.metadata.audioTrackCount != null && (
          <TypeDetailRow label="Audio Tracks" value={String(item.metadata.audioTrackCount)} />
        )}
      </TypeSection>
    </div>
  );
}

// ── Tab: Generation ────────────────────────────────────────────────

function formatGenerationInputLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatGenerationInputValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  if (value === undefined || value === null) return "—";
  return String(value);
}

function readGenerationPrompt(gen: MediaItem["generationMeta"]): string {
  if (!gen) return "";
  if (gen.prompt) return gen.prompt;
  const inputs = gen.inputs;
  if (!inputs || typeof inputs !== "object") return "";
  const prompt = inputs.prompt ?? inputs.text_prompt ?? inputs.video_prompt;
  return typeof prompt === "string" ? prompt : "";
}

function updateGenerationMetadata(itemId: string, generationMeta: NonNullable<MediaItem["generationMeta"]>) {
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      mediaLibrary: {
        ...state.project.mediaLibrary,
        items: state.project.mediaLibrary.items.map((candidate) =>
          candidate.id === itemId ? { ...candidate, generationMeta } : candidate,
        ),
      },
      modifiedAt: Date.now(),
    },
  }));
}


function GenerationTab({ item }: { item: MediaItem }) {
  const gen = item.generationMeta;
  if (!gen) return <div className="px-4 pt-3 text-[11px] text-text-muted">No generation data.</div>;
  const [prompt, setPrompt] = useState(readGenerationPrompt(gen));
  const [negativePrompt, setNegativePrompt] = useState(gen.negativePrompt ?? "");
  const [inputsText, setInputsText] = useState(JSON.stringify(gen.inputs ?? {}, null, 2));

  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);

  // Collect source asset references
  const sourceIds = useMemo(() => assetSourceIds(item), [item]);
  const sourceItems = useMemo(
    () => sourceIds.map((id) => mediaItems.find((m) => m.id === id)).filter((m): m is MediaItem => m != null),
    [sourceIds, mediaItems],
  );

  const sourceBlockIds = useMemo<string[]>(() => {
    const inputs = gen.inputs;
    if (!inputs || typeof inputs !== "object") return [];
    if (!("sourceMetadataBlockIds" in inputs)) return [];
    const val = inputs.sourceMetadataBlockIds;
    if (!Array.isArray(val)) return [];
    return val.filter((v): v is string => typeof v === "string");
  }, [gen.inputs]);

  const inputRows = useMemo<InfoRow[]>(() => {
    const inputs = gen.inputs;
    if (!inputs || typeof inputs !== "object") return [];
    const hiddenKeys = new Set(["sourceAssets", "sourceMetadataBlockIds"]);
    return Object.entries(inputs)
      .filter(([key]) => !hiddenKeys.has(key))
      .map(([key, value]) => ({
        label: formatGenerationInputLabel(key),
        value: formatGenerationInputValue(value),
      }));
  }, [gen.inputs]);

  const saveGeneration = useCallback(() => {
    try {
      const inputs = inputsText.trim() ? JSON.parse(inputsText) : {};
      updateGenerationMetadata(item.id, {
        ...gen,
        prompt: prompt || undefined,
        negativePrompt: negativePrompt || undefined,
        inputs,
      });
      toast.success("Generation metadata updated");
    } catch {
      toast.error("Generation metadata must be valid JSON");
    }
  }, [gen, inputsText, item.id, negativePrompt, prompt]);

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

      <TypeSection title="Prompt">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={saveGeneration}
          placeholder="Generation prompt"
          className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-[10px] leading-relaxed text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </TypeSection>

      <TypeSection title="Negative Prompt">
        <textarea
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          onBlur={saveGeneration}
          placeholder="Negative prompt"
          className="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-[10px] leading-relaxed text-text-muted resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </TypeSection>

      <TypeSection title="Generation Metadata">
        {inputRows.length > 0 && (
          <div className="space-y-1 pb-2">
            {inputRows.map((row) => (
              <TypeDetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        )}
        <textarea
          value={inputsText}
          onChange={(event) => setInputsText(event.target.value)}
          onBlur={saveGeneration}
          spellCheck={false}
          className="min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[10px] leading-relaxed text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </TypeSection>

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
        if (!file) return;
        const result = await replaceMediaAsset(item.id, file);
        if (result.success) {
          toast.success("File replaced", `Replaced with ${file.name}`);
        } else {
          toast.error("Replace failed", result.error?.message || "Could not replace file");
        }
      } catch (err) {
        toast.error("Replace failed", err instanceof Error ? err.message : "Unknown error");
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
    if (!category.isMetadata) {
      tabs.push("file");
      if (item.type === "audio") tabs.push("audio");
    }
    if (item.generationMeta) tabs.push("generation");
    tabs.push("versions", "usages");
    return tabs.map((id) => TAB_DEFS[id]);
  }, [category.isMetadata, item.generationMeta, item.type]);

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
        {resolvedTab === "audio" && <AudioTab item={item} />}
        {resolvedTab === "generation" && <GenerationTab item={item} />}
        {resolvedTab === "versions" && <VersionsTab item={item} />}
        {resolvedTab === "usages" && <UsagesTab item={item} />}
      </div>
    </>
  );
}
