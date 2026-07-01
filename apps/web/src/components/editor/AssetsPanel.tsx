import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Search, Image as ImageIcon, Film, Music, Plus, Upload, Trash2,
  Square, Circle, Triangle, Star, ArrowRight, Hexagon, FileCode, AlertTriangle,
  RefreshCw, Palette, LayoutGrid, Grid2x2, List, Sparkles, Video,
  Type, Shapes, Wand2, LayoutTemplate, Zap, Shuffle, Pencil, Settings,
  ChevronsUpDown,
} from "lucide-react";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../services/background-generator";
import type { ShapeType } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { shallow } from "zustand/shallow";
import { useUIStore } from "../../stores/ui-store";
import type { MediaItem } from "@openreel/core";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { AIGenTab } from "./AIGenTab";
import { RecipesTab } from "./panels/RecipesTab";
import { TemplatesTab } from "./panels/TemplatesTab";
import {
  EffectsPanel,
  TransitionsPanel,
} from "./panels/EffectsTransitionsPanel";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import {
  Input,
  ScrollArea,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
import { GenerateAssetDialog } from "./generate/GenerateAssetDialog";
import type { GenerateAssetDialogProps } from "./generate/GenerateAssetDialog";
import { loadMediaBlob, saveFileHandle, saveDirectoryHandle, scanDirectoryRecursive } from "../../services/media-storage";
import { useKieAIStore } from "../../stores/kieai-store";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { AssetBuckets, type AssetBucketsHandle, type GroupBy } from "./AssetBuckets";
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Media Item Thumbnail Component
 * Shows thumbnail with metadata below (not overlaid)
 */
type MediaViewMode = "large" | "small" | "list";
type AssetsTab =
  | "media"
  | "text"
  | "graphics"
  | "effects"
  | "transitions"
  | "ai"
  | "recipes"
  | "templates";

const ASSETS_TABS: ReadonlyArray<{
  value: AssetsTab;
  label: string;
  description: string;
}> = [
  {
    value: "media",
    label: "Media",
    description: "Import footage, audio, and stills.",
  },
  {
    value: "text",
    label: "Text",
    description: "Add title presets and caption elements.",
  },
  {
    value: "graphics",
    label: "Graphics",
    description: "Create shapes, arrows, and SVG overlays.",
  },
  {
    value: "effects",
    label: "Effects",
    description: "Drag effects onto a clip to apply them.",
  },
  {
    value: "transitions",
    label: "Transitions",
    description: "Drag transitions onto a clip's edge.",
  },
  {
    value: "ai",
    label: "AI Generate",
    description: "Generate clips, captions, and assisted edits.",
  },
  {
    value: "recipes",
    label: "Recipes",
    description: "Apply clip-scoped looks, overlays, and text stacks.",
  },
  {
    value: "templates",
    label: "Project Templates",
    description: "Load full-project starter layouts and presets.",
  },
] as const;

const TAB_ICONS: Record<AssetsTab, React.ElementType> = {
  media: Video,
  text: Type,
  graphics: Shapes,
  effects: Zap,
  transitions: Shuffle,
  ai: Sparkles,
  recipes: Wand2,
  templates: LayoutTemplate,
};






const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  viewMode: MediaViewMode;
  onSelect: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
  onGenerate?: () => void;
  onRetryKieAI?: () => void;
  onManage?: () => void;
  onRename?: () => void;
}> = function MediaThumbnail({
  item,
  isSelected,
  viewMode,
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
  onGenerate,
  onRetryKieAI,
  onManage,
  onRename,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isReplacing = useProjectStore((s) => s.replacingMediaIds.has(item.id));

  const getIcon = () => {
    switch (item.type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      case "image":
        return ImageIcon;
      default:
        return Film;
    }
  };

  const Icon = getIcon();

  const formatResolution = () => {
    if (item.metadata?.width && item.metadata?.height) {
      return `${item.metadata.width}×${item.metadata.height}`;
    }
    return null;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.kieaiError
    ? "border-red-500 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
    : item.isPending
    ? "border-purple-500 ring-1 ring-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.3)]"
    : item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-primary ring-1 ring-primary/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
        : "border-border hover:border-text-secondary";
  const hoverOverlay = isReplacing ? (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-3 border-blue-400 border-t-transparent" />
        <span className="text-[10px] text-blue-300 font-medium">Replacing…</span>
      </div>
    </div>
  ) : (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center gap-2 animate-in fade-in duration-200">
      {item.kieaiError ? (
        <button
          onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
          title="Generation failed — click to retry"
          className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
        >
          <RefreshCw size={14} className="text-red-400" />
        </button>
      ) : item.isPending ? (
        <div title="KieAI generation in progress…" className="p-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
        </div>
      ) : item.isPlaceholder ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onReplace(); }}
            title="Replace asset"
            className="p-2 bg-yellow-500/20 rounded-full hover:bg-yellow-500/40 backdrop-blur-sm transition-colors"
          >
            <RefreshCw size={14} className="text-yellow-500" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
          </button>
        </>
      ) : (
        <>
          {item.type === "image" && onGenerate && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerate(); }}
              title="Generate Asset"
              className="p-2 bg-purple-500/20 rounded-full hover:bg-purple-500/40 backdrop-blur-sm transition-colors"
            >
              <Sparkles size={14} className="text-purple-300" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            title="Add to timeline"
            className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
          >
            <Plus size={14} className="text-primary" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
          </button>
        </>
      )}
    </div>
  );

  // --- List view ---
  if (viewMode === "list") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail */}
        <div className="w-12 h-8 rounded bg-background-tertiary relative overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon size={14} className={iconColor} />
            </div>
          )}
          {item.kieaiError && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
              <AlertTriangle size={12} className="text-red-400" />
            </div>
          )}
          {!item.kieaiError && item.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-purple-500/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            </div>
          )}
          {isReplacing && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            </div>
          )}
          {!item.kieaiError && !item.isPending && item.isPlaceholder && (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
              <AlertTriangle size={12} className="text-yellow-500/70" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[11px] truncate font-medium ${isSelected ? "text-primary" : "text-text-primary"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>•</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && formatFileSize(item.metadata?.fileSize) && <span>•</span>}
            {formatFileSize(item.metadata?.fileSize) && <span>{formatFileSize(item.metadata?.fileSize)}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.kieaiError ? (
              <button
                onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
                title="Retry generation"
                className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
              >
                <RefreshCw size={12} className="text-red-400" />
              </button>
            ) : item.isPending ? (
              <div className="p-1" title="Generating…">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
              </div>
            ) : item.isPlaceholder ? (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  title="Replace asset"
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                >
                  <RefreshCw size={12} className="text-yellow-500" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Delete"
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </>
            ) : (
              <>
                {item.type === "image" && onGenerate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onGenerate(); }}
                    title="Generate Asset"
                    className="p-1 bg-purple-500/20 rounded hover:bg-purple-500/40 transition-colors"
                  >
                    <Sparkles size={12} className="text-purple-300" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  title="Add to timeline"
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                >
                  <Plus size={12} className="text-primary" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Delete"
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_#22c55e] flex-shrink-0" />
        )}
      </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {item.type === "image" && onGenerate && (
            <ContextMenuItem onClick={onGenerate}>
              <Sparkles size={13} className="mr-2 text-primary" />
              Generate Asset
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onAddToTimeline(); }}>
            <Plus size={13} className="mr-2" />
            Add to Timeline
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onRename?.(); }}>
            <Pencil size={13} className="mr-2" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onManage?.(); }}>
            <Settings size={13} className="mr-2" />
            Manage
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onDelete(); }} className="text-red-400 focus:text-red-400">
            <Trash2 size={13} className="mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div className="flex flex-col">
      {/* Thumbnail container */}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`aspect-video bg-background-tertiary rounded-lg border-2 relative group cursor-pointer transition-all overflow-hidden shadow-sm ${borderClass}`}
      >
        {/* Thumbnail or placeholder */}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary">
            <Icon size={thumbnailIconSize} className={iconColor} />
          </div>
        )}

        {/* Audio waveform placeholder */}
        {item.type === "audio" && (
          <div className="absolute top-1/2 left-0 right-0 h-4 flex items-center gap-px px-2 -translate-y-1/2">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* KieAI Error Badge */}
        {item.kieaiError && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <AlertTriangle size={8} />
            Failed
          </div>
        )}

        {/* Pending KieAI Badge */}
        {!item.kieaiError && item.isPending && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-purple-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <div className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            AI
          </div>
        )}

        {item.generationMeta && (
          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-rose-500/90 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <Sparkles size={8} />
            {item.generationMeta.status ? `Generated · ${item.generationMeta.status}` : "Generated"}
          </div>
        )}


        {/* Missing Asset Badge */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !item.thumbnailUrl && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />
            Missing
          </div>
        )}

        {/* Duration badge on thumbnail */}
        {item.metadata?.duration && (
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white font-mono">
            {formatDuration(item.metadata.duration)}
          </div>
        )}

        {/* Error overlay */}
        {item.kieaiError && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-red-400/60" />
          </div>
        )}

        {/* Pending overlay */}
        {!item.kieaiError && item.isPending && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-purple-500/10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-400 border-t-transparent" />
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Replacing overlay */}
        {isReplacing && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10">
            <div className="flex flex-col items-center gap-1.5">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
              <span className="text-[10px] text-blue-300 font-medium">Replacing…</span>
            </div>
          </div>
        )}

        {/* Hover overlay with actions */}
        {isHovered && hoverOverlay}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_#22c55e]" />
        )}
      </div>

      {/* Metadata below thumbnail */}
      <div className="mt-1.5 px-0.5">
        <div
          className={`text-[10px] truncate font-medium ${
            isSelected ? "text-primary" : "text-text-primary"
          }`}
          title={item.name}
        >
          {item.name}
        </div>
        {viewMode === "large" && (
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted mt-0.5">
            {formatResolution() && <span>{formatResolution()}</span>}
            {formatResolution() && formatFileSize(item.metadata?.fileSize) && (
              <span>•</span>
            )}
            {formatFileSize(item.metadata?.fileSize) && (
              <span>{formatFileSize(item.metadata?.fileSize)}</span>
            )}
          </div>
        )}
      </div>
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {item.type === "image" && onGenerate && (
          <ContextMenuItem onClick={onGenerate}>
            <Sparkles size={13} className="mr-2 text-primary" />
            Generate Asset
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onAddToTimeline()}>
          <Plus size={13} className="mr-2" />
          Add to Timeline
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename?.()}>
          <Pencil size={13} className="mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onManage?.()}>
          <Settings size={13} className="mr-2" />
          Manage
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDelete()} className="text-red-400 focus:text-red-400">
          <Trash2 size={13} className="mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

MediaThumbnail.displayName = "MediaThumbnail";


/**
 * Stable per-item row. Custom memo comparator checks item identity by id + key primitives,
 * avoiding re-render when the store issues a new MediaItem reference with unchanged data.
 * All handlers read from getState() — zero per-row Zustand subscriptions.
 */

/**
 * Stabilizes the media items array reference across renders.
 * structuredClone creates new refs for all items on every timeline edit,
 * but most items haven't changed. This hook returns the previous array ref
 * when no items actually changed (by id + key fields), preventing downstream
 * re-renders of AssetBuckets and all MediaThumbnailRow instances.
 */
function useStableMediaItems(items: MediaItem[]): MediaItem[] {
  const ref = useRef(items);
  const prev = ref.current;

  if (items === prev) return prev;
  if (items.length !== prev.length) { ref.current = items; return items; }

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const b = prev[i];
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.title !== b.title ||
      a.type !== b.type ||
      a.isPlaceholder !== b.isPlaceholder ||
      a.isPending !== b.isPending ||
      a.kieaiError !== b.kieaiError ||
      a.kieaiTaskId !== b.kieaiTaskId ||
      a.thumbnailUrl !== b.thumbnailUrl ||
      a.metadata?.duration !== b.metadata?.duration ||
      a.metadata?.width !== b.metadata?.width ||
      a.metadata?.height !== b.metadata?.height ||
      a.metadata?.fileSize !== b.metadata?.fileSize ||
      a.tags?.length !== b.tags?.length ||
      (a.tags && b.tags && !a.tags.every((t, i) => t === b.tags?.[i])) ||
      a.group !== b.group ||
      a.description !== b.description
    ) {
      ref.current = items;
      return items;
    }
  }

  return prev; // no changes — return stable reference
}
const MediaThumbnailRow = React.memo(
  ({ item, viewMode, isSelected, onGenerateRef, onRetryKieAIRef, onManageRef, onRenameRef }: {
    item: MediaItem;
    viewMode: MediaViewMode;
    isSelected: boolean;
    onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
  }) => {
    const handleSelect = useCallback(() => {
      useUIStore.getState().select({ type: "clip", id: item.id });
      onManageRef?.current?.(item);
    }, [item.id, onManageRef]);

    const handleDelete = useCallback(async () => {
      await useProjectStore.getState().deleteMedia(item.id);
    }, [item.id]);

    const handleReplace = useCallback(async () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,audio/*,image/*";
      input.onchange = async (e) => {
        try {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const result = await useProjectStore.getState().replaceMediaAsset(item.id, file);
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
      input.click();
    }, [item.id]);

    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ mediaId: item.id }));
        e.dataTransfer.effectAllowed = "copy";
        useUIStore.getState().startDrag("media", { mediaId: item.id, mediaType: item.type });
      },
      [item.id, item.type],
    );

    const handleAddToTimeline = useCallback(async () => {
      await useProjectStore.getState().addClipToNewTrack(item.id);
    }, [item.id]);

    const handleOpenGenerate = useCallback(() => {
      onGenerateRef?.current?.(item);
    }, [onGenerateRef, item]);

    const handleRetryKieAICb = useCallback(() => {
      onRetryKieAIRef?.current?.(item);
    }, [onRetryKieAIRef, item]);

    const handleManage = useCallback(() => {
      onManageRef?.current?.(item);
    }, [onManageRef, item]);

    const handleRename = useCallback(() => {
      onRenameRef?.current?.(item);
    }, [onRenameRef, item]);

    return (
      <MediaThumbnail
        item={item}
        isSelected={isSelected}
        viewMode={viewMode}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onReplace={handleReplace}
        onDragStart={handleDragStart}
        onAddToTimeline={handleAddToTimeline}
        onGenerate={item.type === "image" && !item.isPending && !item.kieaiError ? handleOpenGenerate : undefined}
        onRetryKieAI={item.kieaiError && item.kieaiTaskId ? handleRetryKieAICb : undefined}
        onManage={handleManage}
        onRename={handleRename}
      />
    );
  },
  // Custom comparator: skip re-render when the item-id is the same and key display fields match
  (prev, next) =>
    prev.isSelected === next.isSelected &&
    prev.item.id === next.item.id &&
    prev.item.name === next.item.name &&
    prev.item.title === next.item.title &&
    prev.item.tags === next.item.tags &&
    prev.item.group === next.item.group &&
    prev.item.description === next.item.description &&
    prev.item.type === next.item.type &&
    prev.item.isPlaceholder === next.item.isPlaceholder &&
    prev.item.isPending === next.item.isPending &&
    prev.item.kieaiError === next.item.kieaiError &&
    prev.item.kieaiTaskId === next.item.kieaiTaskId &&
    prev.item.thumbnailUrl === next.item.thumbnailUrl &&
    prev.item.metadata?.duration === next.item.metadata?.duration &&
    prev.item.metadata?.width === next.item.metadata?.width &&
    prev.item.metadata?.height === next.item.metadata?.height &&
    prev.item.metadata?.fileSize === next.item.metadata?.fileSize &&
    prev.viewMode === next.viewMode &&
    prev.onGenerateRef === next.onGenerateRef &&
    prev.onRetryKieAIRef === next.onRetryKieAIRef &&
    prev.onManageRef === next.onManageRef &&
    prev.onRenameRef === next.onRenameRef,
);

MediaThumbnailRow.displayName = "MediaThumbnailRow";
const EmptyState: React.FC<{ onImport: () => void }> = ({ onImport }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <div className="w-16 h-16 rounded-2xl bg-background-tertiary border border-border flex items-center justify-center mb-4 shadow-inner">
      <Upload size={24} className="text-text-muted" />
    </div>
    <p className="text-sm text-text-secondary mb-2 font-medium">
      No media imported
    </p>
    <p className="text-xs text-text-muted mb-6">
      Drag files here or click to import
    </p>
    <button
      onClick={onImport}
      className="px-4 py-2 bg-background-elevated hover:bg-background-tertiary border border-border text-text-primary text-xs font-medium rounded-lg transition-all hover:border-primary/50"
    >
      Import Media
    </button>
  </div>
);

const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-background-secondary/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-sm text-text-secondary">{message}</p>
  </div>
);

export const AssetsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTabRaw] = useState<AssetsTab>("media");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);

  const setActiveTab = useCallback((tab: AssetsTab) => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [mediaViewMode, setMediaViewMode] = useState<MediaViewMode>("large");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const assetBucketsRef = useRef<AssetBucketsHandle>(null);
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);
  const [backgroundCategory, setBackgroundCategory] = useState<
    "all" | "solid" | "gradient" | "pattern" | "mesh"
  >("all");

  // Generate asset dialog
  const [generateDialog, setGenerateDialog] = useState<Omit<GenerateAssetDialogProps, "open" | "onClose"> | null>(null);
  const setInspectedAsset = useUIStore((s) => s.setInspectedAsset);

  // Project store — narrow subscriptions. mediaItems stabilized since structuredClone
  // creates new refs for unchanged items on every timeline edit.
  const rawMediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const mediaItems = useStableMediaItems(rawMediaItems);
  const projectSettings = useProjectStore((s) => s.project.settings);
  const importMedia = useProjectStore((s) => s.importMedia);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const setKieAIItemState = useProjectStore((s) => s.setKieAIItemState);

  // Selection tracking — stable Set derived from selectedItems array
  const selectedItems = useUIStore((s) => s.selectedItems, shallow);
  const selectedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const si of selectedItems) {
      if (si.type === "clip") ids.add(si.id);
    }
    return ids;
  }, [selectedItems]);

  // KieAI store
  const { retryTask } = useKieAIStore();

  // Count missing assets (memoized)
  const missingAssetsCount = useMemo(
    () => mediaItems.filter((item) => item.isPlaceholder).length,
    [mediaItems],
  );
  // Filter media items by search query across all metadata fields (memoized)
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return mediaItems.filter((item) => {
      if (showOnlyMissing && !item.isPlaceholder) return false;
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        (item.title?.toLowerCase().includes(query) ?? false) ||
        (item.description?.toLowerCase().includes(query) ?? false) ||
        (item.tags?.some((t) => t.toLowerCase().includes(query)) ?? false) ||
        (item.group?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [mediaItems, searchQuery, showOnlyMissing]);

  // Handle file import with loading state
  const handleFileImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setIsImporting(true);
      const fileArray = Array.from(files);

      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setImportProgress(
            `Importing ${file.name} (${i + 1}/${fileArray.length})...`,
          );

          const result = await importMedia(file);

          // If it's a video with audio, extract audio to separate track
          if (result.success && file.type.startsWith("video/")) {
            setImportProgress(`Extracting audio from ${file.name}...`);
            // Audio extraction is handled by the importMedia function
            // The audio track is created automatically when adding to timeline
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [importMedia],
  );

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Snapshot dataTransfer synchronously — it becomes inert after the first await.
      const droppedFiles = e.dataTransfer.files;
      const handlePromises =
        "getAsFileSystemHandle" in DataTransferItem.prototype
          ? Array.from(e.dataTransfer.items)
              .filter((item) => item.kind === "file")
              .map(async (item) => {
                try {
                  const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }).getAsFileSystemHandle();
                  if (handle.kind === "file") {
                    const fileHandle = handle as FileSystemFileHandle;
                    const file = await fileHandle.getFile();
                    await saveFileHandle(file.name, file.size, fileHandle);
                  }
                } catch {
                  // Ignore — handle capture is best-effort
                }
              })
          : [];

      await Promise.all(handlePromises);
      handleFileImport(droppedFiles);
    },
    [handleFileImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);


  const handleRelinkFromFolder = useCallback(async () => {
    const { project } = useProjectStore.getState();
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // ── Path A: File System Access API (Chrome, secure context) ──────────
    if ("showDirectoryPicker" in window) {
      let dirHandle: FileSystemDirectoryHandle;
      try {
        dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      } catch {
        return; // user cancelled
      }

      try { await saveDirectoryHandle(useProjectStore.getState().project.id, dirHandle); } catch { /* best-effort */ }
      const fileMap = await scanDirectoryRecursive(dirHandle);

      setIsImporting(true);
      let linked = 0;
      for (const item of placeholders) {
        const key = item.sourceFile
          ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
          : null;
        const entry = key ? fileMap.get(key) : null;
        if (entry) {
          setImportProgress(`Relinking ${item.name}…`);
          try {
            try { await saveFileHandle(entry.file.name, entry.file.size, entry.handle); } catch { /* best-effort */ }
            await useProjectStore.getState().replaceMediaAsset(item.id, entry.file, dirHandle.name);
            linked++;
          } catch (err) {
            console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
          }
        }
      }
      setIsImporting(false);
      setImportProgress("");

      if (linked > 0) {
        toast.success(`Relinked ${linked} of ${placeholders.length} asset${placeholders.length !== 1 ? "s" : ""}`);
      } else {
        toast.error("No matches found", "None of the files in the selected folder matched the missing assets by filename.");
      }
      return;
    }

    // ── Path B: <input webkitdirectory> fallback (Safari, Firefox, HTTP) ──
    const pickFolder = (): Promise<File[]> =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.multiple = true;
        input.onchange = () => {
          resolve(Array.from(input.files ?? []));
          input.remove();
        };
        // User cancelled → resolve empty
        input.oncancel = () => { resolve([]); input.remove(); };
        // Fallback for browsers that don't fire oncancel
        const focusHandler = () => {
          window.removeEventListener("focus", focusHandler);
          setTimeout(() => {
            if (input.files?.length === 0 || !input.files) {
              resolve([]);
              input.remove();
            }
          }, 300);
        };
        window.addEventListener("focus", focusHandler);
        input.click();
      });

    const files = await pickFolder();
    if (files.length === 0) return;

    // Build name:size map from flat file list (webkitdirectory is flat)
    const fileMap = new Map<string, File>();
    for (const file of files) {
      const key = `${file.name.toLowerCase()}:${file.size}`;
      if (!fileMap.has(key)) {
        fileMap.set(key, file);
      }
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      const key = item.sourceFile
        ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
        : null;
      const file = key ? fileMap.get(key) : undefined;
      if (file) {
        setImportProgress(`Relinking ${item.name}…`);
        try {
          await useProjectStore.getState().replaceMediaAsset(item.id, file);
          linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");

    if (linked > 0) {
      toast.success(`Relinked ${linked} of ${placeholders.length} asset${placeholders.length !== 1 ? "s" : ""}`);
    } else {
      toast.error("No matches found", "None of the files in the selected folder matched the missing assets by filename.");
    }
  }, []);

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const { addClipToNewTrack } = useProjectStore.getState();
    await addClipToNewTrack(item.id);
  }, []);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline]);

  const handleCancelAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, addMediaToTimeline]);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportBackground = useCallback(
    async (preset: BackgroundPreset) => {
      setGeneratingBackground(preset.id);
      try {
        const { width, height } = projectSettings;
        const blob = await generateBackgroundBlob(preset, width, height);
        const file = new File([blob], `${preset.name}_${width}x${height}.png`, {
          type: "image/png",
        });
        const result = await importMedia(file);
        if (result.success && result.actionId) {
          const { addClipToNewTrack } = useProjectStore.getState();
          await addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        setGeneratingBackground(null);
      }
    },
    [importMedia, projectSettings],
  );

  const filteredBackgrounds = useMemo(
    () => BACKGROUND_PRESETS.filter(
      (preset) =>
        backgroundCategory === "all" || preset.category === backgroundCategory,
    ),
    [backgroundCategory],
  );
  // Open unified generate dialog for an image asset
  const handleOpenGenerate = useCallback(async (item: MediaItem) => {
    try {
      const blob = await loadMediaBlob(item.id);
      if (!blob) {
        toast.error("Asset not found", "Cannot load the image data for this asset.");
        return;
      }
      const mimeType = blob.type || (item.name.match(/\.png$/i) ? "image/png" : "image/jpeg");
      const file = new File([blob], item.name, { type: mimeType });

      // Look up NF-imported asset and shot by matching thumbnailUrl → outputPath
      const mvProjects = useMusicVideoStore.getState().projects;
      let asset = undefined;
      let shot = undefined;
      for (const mvProject of Object.values(mvProjects)) {
        const found = mvProject.generatedAssets.find((a) => a.outputPath === item.thumbnailUrl);
        if (found) {
          asset = found;
          shot = mvProject.shots.find((s) => s.generatedAssetIds.includes(found.id));
          break;
        }
      }

      setGenerateDialog({ sourceFile: file, previewUrl: item.thumbnailUrl, asset, shot });
    } catch (err) {
      console.error("[Generate] Failed to load media blob:", err);
      toast.error("Failed to open generator", err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const handleRetryKieAI = useCallback((item: MediaItem) => {
    if (!item.kieaiTaskId) return;
    // Reset error state and re-activate polling
    setKieAIItemState(item.id, true, false);
    retryTask(item.kieaiTaskId);
  }, [retryTask, setKieAIItemState]);

  // Stable refs for callbacks passed through MediaThumbnailRow (avoids re-render cascades)
  const onGenerateRef = useRef(handleOpenGenerate);
  onGenerateRef.current = handleOpenGenerate;
  const onRetryKieAIRef = useRef(handleRetryKieAI);
  onRetryKieAIRef.current = handleRetryKieAI;
  const onManageRef = useRef((item: MediaItem) => setInspectedAsset(item));
  const onRenameRef = useRef((item: MediaItem) => {
    const newName = window.prompt("Rename asset:", item.name);
    if (newName && newName.trim() && newName.trim() !== item.name) {
      useProjectStore.getState().renameMedia(item.id, newName.trim());
    }
  });

  const renderSectionContent = (tab: AssetsTab): React.ReactNode => {
    switch (tab) {
      case "media":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
            <div className="px-4 pt-3 pb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted z-10" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search media"
                  className="pl-9 text-xs bg-background-tertiary border-border text-text-primary h-9"
                />
              </div>
              <div className="flex items-center bg-background-tertiary border border-border rounded-lg p-0.5">
                {([
                  { mode: "large" as const, icon: LayoutGrid, title: "Large icons" },
                  { mode: "small" as const, icon: Grid2x2, title: "Small icons" },
                  { mode: "list" as const, icon: List, title: "List view" },
                ]).map(({ mode, icon: ViewIcon, title }) => (
                  <button
                    key={mode}
                    onClick={() => setMediaViewMode(mode)}
                    title={title}
                    className={`p-1.5 rounded transition-colors ${
                      mediaViewMode === mode
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    <ViewIcon size={13} />
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 pb-2 flex items-center gap-2">
              <button
                onClick={() => assetBucketsRef.current?.collapseAll()}
                title="Collapse all"
                className="p-1.5 rounded bg-background-tertiary border border-border text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronsUpDown size={13} className="rotate-180" />
              </button>
              <button
                onClick={() => assetBucketsRef.current?.expandAll()}
                title="Expand all"
                className="p-1.5 rounded bg-background-tertiary border border-border text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronsUpDown size={13} />
              </button>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                <SelectTrigger className="h-8 text-xs bg-background-tertiary border-border text-text-primary w-[105px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background-secondary border-border">
                  {([
                    { value: "none", label: "Ungrouped" },
                    { value: "tag", label: "By Tag" },
                    { value: "type", label: "By Type" },
                    { value: "status", label: "By Status" },
                  ] as const).map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {missingAssetsCount > 0 && (
              <div className="px-4 pb-3 space-y-2">
                <button
                  onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                  className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-between ${
                    showOnlyMissing
                      ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                      : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>Show Only Missing Assets</span>
                  </div>
                  <div className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
                    {missingAssetsCount}
                  </div>
                </button>
                <button
                  onClick={handleRelinkFromFolder}
                  className="w-full px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-yellow-500 text-xs font-medium transition-all hover:bg-yellow-500/15 flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  <span>Relink from Folder…</span>
                </button>
              </div>
            )}

            <ScrollArea
              className={`min-h-0 flex-1 ${isDragOver ? "bg-primary/5" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="px-4 pb-4 relative">
                {filteredItems.length === 0 ? (
                  <EmptyState onImport={triggerFileInput} />
                ) : (
                  <AssetBuckets
                    ref={assetBucketsRef}
                    items={filteredItems}
                    viewMode={mediaViewMode}
                    searchQuery={searchQuery}
                    groupBy={groupBy}
                    selectedItemIds={selectedItemIds}
                    onGenerateRef={onGenerateRef}
                    onRetryKieAIRef={onRetryKieAIRef}
                    onManageRef={onManageRef}
                    onRenameRef={onRenameRef}
                    MediaRow={MediaThumbnailRow}
                  />
                )}

                {isDragOver && (
                  <div className="absolute inset-4 border-2 border-dashed border-primary rounded-xl flex items-center justify-center bg-primary/5 pointer-events-none z-50 backdrop-blur-sm">
                    <div className="text-primary text-sm font-bold bg-background-secondary px-4 py-2 rounded-full shadow-lg">
                      Drop files to import
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      case "graphics":
        return (
          <div className="min-h-0 flex-1 border-t border-border/70">
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-4 py-4">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                      <Palette size={12} />
                      Backgrounds
                    </h4>
                  </div>
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    {(["all", "solid", "gradient", "mesh", "pattern"] as const).map(
                      (cat) => (
                        <button
                          key={cat}
                          onClick={() => setBackgroundCategory(cat)}
                          className={`px-2.5 py-1 text-[10px] rounded-md transition-all ${
                            backgroundCategory === cat
                              ? "bg-primary text-white"
                              : "bg-background-tertiary text-text-muted hover:text-text-secondary"
                          }`}
                        >
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {filteredBackgrounds.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleImportBackground(preset)}
                        disabled={generatingBackground !== null}
                        className="aspect-square rounded-lg border border-border hover:border-primary/50 transition-all overflow-hidden relative group disabled:opacity-50"
                        title={preset.name}
                        style={{ background: preset.thumbnail }}
                      >
                        {generatingBackground === preset.id && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Plus size={16} className="text-white" />
                        </div>
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/60 py-0.5 px-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          {preset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-xs font-medium text-text-secondary mb-3">
                    Shapes
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      {
                        type: "rectangle" as ShapeType,
                        icon: Square,
                        label: "Rectangle",
                      },
                      { type: "circle" as ShapeType, icon: Circle, label: "Circle" },
                      {
                        type: "triangle" as ShapeType,
                        icon: Triangle,
                        label: "Triangle",
                      },
                      { type: "star" as ShapeType, icon: Star, label: "Star" },
                      {
                        type: "arrow" as ShapeType,
                        icon: ArrowRight,
                        label: "Arrow",
                      },
                      {
                        type: "polygon" as ShapeType,
                        icon: Hexagon,
                        label: "Polygon",
                      },
                    ].map((shape) => (
                      <button
                        key={shape.type}
                        onClick={async () => {
                          const state = useProjectStore.getState();
                          const { createShapeClip, addTrack } = state;
                          const tracksBefore = state.project.timeline.tracks;
                          const addResult = await addTrack("graphics", 0);
                          if (!addResult.success) return;
                          const tracksAfter =
                            useProjectStore.getState().project.timeline.tracks;
                          const newGraphicsTrack = tracksAfter.find(
                            (t) =>
                              t.type === "graphics" &&
                              !tracksBefore.some((bt) => bt.id === t.id),
                          );
                          if (newGraphicsTrack) {
                            createShapeClip(newGraphicsTrack.id, 0, shape.type);
                          }
                        }}
                        className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                        title={shape.label}
                      >
                        <shape.icon
                          size={20}
                          className="text-text-secondary group-hover:text-primary transition-colors"
                        />
                        <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                          {shape.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-xs font-medium text-text-secondary mb-3">
                    3D Objects
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { type: "mesh-cube" as ShapeType, label: "Cube", icon: "□" },
                      { type: "mesh-sphere" as ShapeType, label: "Sphere", icon: "○" },
                      { type: "mesh-torus" as ShapeType, label: "Torus", icon: "◯" },
                      { type: "mesh-cone" as ShapeType, label: "Cone", icon: "△" },
                      { type: "mesh-cylinder" as ShapeType, label: "Cylinder", icon: "▯" },
                      { type: "mesh-icosahedron" as ShapeType, label: "Icosahedron", icon: "◆" },
                    ]).map((mesh) => (
                      <button
                        key={mesh.type}
                        onClick={async () => {
                          const state = useProjectStore.getState();
                          const { createShapeClip, addTrack, updateClipRotate3D } = state;
                          const tracksBefore = state.project.timeline.tracks;
                          const addResult = await addTrack("graphics", 0);
                          if (!addResult.success) return;
                          const tracksAfter =
                            useProjectStore.getState().project.timeline.tracks;
                          const newGraphicsTrack = tracksAfter.find(
                            (t) =>
                              t.type === "graphics" &&
                              !tracksBefore.some((bt) => bt.id === t.id),
                          );
                          if (newGraphicsTrack) {
                            const created = createShapeClip(
                              newGraphicsTrack.id,
                              0,
                              mesh.type,
                            );
                            // Nudge the rotation so the 3D depth is
                            // visible from the get-go (otherwise a
                            // head-on cube looks like a flat square).
                            if (created) {
                              updateClipRotate3D(created.id, {
                                x: -18,
                                y: 28,
                                z: 0,
                              });
                            }
                          }
                        }}
                        className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                        title={mesh.label}
                      >
                        <span className="text-2xl text-text-secondary group-hover:text-primary transition-colors leading-none">
                          {mesh.icon}
                        </span>
                        <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                          {mesh.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-xs font-medium text-text-secondary mb-3">
                    SVG Import
                  </h4>
                  <button
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".svg";
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          const content = await file.text();
                          const state = useProjectStore.getState();
                          const { importSVG, addTrack } = state;
                          const tracksBefore = state.project.timeline.tracks;
                          const addResult = await addTrack("graphics", 0);
                          if (!addResult.success) return;
                          const tracksAfter =
                            useProjectStore.getState().project.timeline.tracks;
                          const newGraphicsTrack = tracksAfter.find(
                            (t) =>
                              t.type === "graphics" &&
                              !tracksBefore.some((bt) => bt.id === t.id),
                          );
                          if (newGraphicsTrack) {
                            importSVG(content, newGraphicsTrack.id, 0);
                          }
                        }
                      };
                      input.click();
                    }}
                    className="w-full py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 group"
                  >
                    <FileCode
                      size={16}
                      className="text-text-secondary group-hover:text-primary transition-colors"
                    />
                    <span className="text-xs text-text-secondary group-hover:text-text-primary">
                      Import SVG File
                    </span>
                  </button>
                </div>

                <div className="mb-6">
                  <h4 className="text-xs font-medium text-text-secondary mb-3">
                    Stickers & Emojis
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {["😀", "🎉", "❤️", "⭐", "🔥", "👍", "🎬", "🎵"].map(
                      (emoji, i) => (
                        <button
                          key={i}
                          onClick={async () => {
                            const state = useProjectStore.getState();
                            const { createStickerClip, addTrack } = state;
                            const { stickerLibrary } = await import("@openreel/core");

                            const tracksBefore = state.project.timeline.tracks;
                            const addResult = await addTrack("graphics", 0);
                            if (!addResult.success) return;
                            const tracksAfter =
                              useProjectStore.getState().project.timeline.tracks;
                            const newGraphicsTrack = tracksAfter.find(
                              (t) =>
                                t.type === "graphics" &&
                                !tracksBefore.some((bt) => bt.id === t.id),
                            );

                            if (newGraphicsTrack) {
                              const emojiItem = {
                                id: `emoji-${i}`,
                                emoji,
                                name: emoji,
                                category: "emojis",
                              };
                              const clip = stickerLibrary.createEmojiClip(
                                emojiItem,
                                newGraphicsTrack.id,
                                0,
                                5,
                              );
                              createStickerClip(clip);
                            }
                          }}
                          className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center text-xl cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        );
      case "text":
        return (
          <div className="min-h-0 flex-1 border-t border-border/70">
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-4 py-4 space-y-3">
                <button
                  onClick={async () => {
                    const state = useProjectStore.getState();
                    const { createTextClip, addTrack } = state;
                    const tracksBefore = state.project.timeline.tracks;
                    const addResult = await addTrack("text", 0);
                    if (!addResult.success) return;
                    const tracksAfter =
                      useProjectStore.getState().project.timeline.tracks;
                    const newTextTrack = tracksAfter.find(
                      (t) =>
                        t.type === "text" &&
                        !tracksBefore.some((bt) => bt.id === t.id),
                    );
                    if (newTextTrack) {
                      createTextClip(newTextTrack.id, 0, "New Title");
                    }
                  }}
                  className="w-full py-4 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-center"
                >
                  <span className="text-lg font-bold text-text-primary">
                    Add Title
                  </span>
                  <p className="text-xs text-text-muted mt-1">
                    Click to add text to timeline
                  </p>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      name: "Heading",
                      text: "Heading",
                      style: {
                        fontSize: 72,
                        fontWeight: 700 as const,
                        textAlign: "center" as const,
                        verticalAlign: "middle" as const,
                      },
                    },
                    {
                      name: "Subtitle",
                      text: "Subtitle text",
                      style: {
                        fontSize: 36,
                        fontWeight: 400 as const,
                        textAlign: "center" as const,
                        verticalAlign: "middle" as const,
                      },
                    },
                    {
                      name: "Lower Third",
                      text: "Name Here",
                      style: {
                        fontSize: 32,
                        fontWeight: 600 as const,
                        textAlign: "left" as const,
                        verticalAlign: "bottom" as const,
                        backgroundColor: "rgba(0, 0, 0, 0.7)",
                      },
                    },
                    {
                      name: "Caption",
                      text: "Caption text here",
                      style: {
                        fontSize: 24,
                        fontWeight: 400 as const,
                        textAlign: "center" as const,
                        verticalAlign: "bottom" as const,
                        shadowColor: "rgba(0, 0, 0, 0.8)",
                        shadowBlur: 4,
                        shadowOffsetX: 1,
                        shadowOffsetY: 1,
                      },
                    },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      onClick={async () => {
                        const state = useProjectStore.getState();
                        const { createTextClip, addTrack } = state;
                        const tracksBefore = state.project.timeline.tracks;
                        const addResult = await addTrack("text", 0);
                        if (!addResult.success) return;
                        const tracksAfter =
                          useProjectStore.getState().project.timeline.tracks;
                        const newTextTrack = tracksAfter.find(
                          (t) =>
                            t.type === "text" &&
                            !tracksBefore.some((bt) => bt.id === t.id),
                        );
                        if (newTextTrack) {
                          createTextClip(
                            newTextTrack.id,
                            0,
                            preset.text,
                            5,
                            preset.style,
                          );
                        }
                      }}
                      className="py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-xs text-text-secondary hover:text-text-primary"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>
        );
      case "effects":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <EffectsPanel />
          </div>
        );
      case "transitions":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <TransitionsPanel />
          </div>
        );
      case "ai":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <AIGenTab />
          </div>
        );
      case "recipes":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <RecipesTab />
          </div>
        );
      case "templates":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <TemplatesTab />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-tour="assets"
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full relative"
    >
      {/* ── Horizontal tool nav (icon + label, top) ──────────── */}
      <div className="flex items-stretch gap-0.5 px-2 pt-2 pb-1 border-b border-border bg-bg-1 overflow-x-auto scrollbar-none shrink-0">
        {ASSETS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              title={tab.description}
              className={`group flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-md min-w-[50px] shrink-0 text-[10.5px] font-medium tracking-tight transition-colors ${
                isActive
                  ? "text-accent"
                  : "text-fg-3 hover:text-fg hover:bg-hover"
              }`}
            >
              <span
                className={`w-7 h-7 grid place-items-center rounded-md transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-fg-2 group-hover:text-fg"
                }`}
              >
                <Icon size={17} strokeWidth={1.6} />
              </span>
              <span className={isActive ? "text-accent" : ""}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Body: section content fills the remaining space ──── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-1 relative">
        {isImporting && (
          <LoadingIndicator message={importProgress || "Importing media..."} />
        )}

        {/* Lightweight panel sub-header (active tab description) */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-border shrink-0">
          <p className="text-[11px] text-fg-muted line-clamp-1">
            {ASSETS_TABS.find((t) => t.value === activeTab)?.description}
          </p>
          {activeTab === "media" && (
            <button
              onClick={triggerFileInput}
              title="Import media"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent text-accent-fg font-semibold text-[11.5px] hover:bg-accent-strong transition-colors"
            >
              <Plus size={12} />
              <span>Import</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          onChange={(e) => handleFileImport(e.target.files)}
          className="hidden"
        />

        {/* Dynamic Section Content */}
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
          {renderSectionContent(activeTab)}
        </div>
      </div>

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={projectSettings.width}
          currentHeight={projectSettings.height}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

      {generateDialog && (
        <GenerateAssetDialog
          open={true}
          onClose={() => setGenerateDialog(null)}
          {...generateDialog}
        />
      )}

    </div>
  );
};

export default AssetsPanel;
