import { useMemo, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import type { MediaItem } from "@openreel/core";
import type { StoryboardShot } from "@openreel/music-video-domain";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { ChevronDown, ChevronRight } from "lucide-react";

type MediaViewMode = "large" | "small" | "list";

export type GroupBy = "none" | "tag" | "type" | "status";

export interface AssetBucketsHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

interface BucketDef {
  id: string;
  label: string;
  entries: AssetEntry[];
}

type AssetEntry =
  | { kind: "media"; item: MediaItem }
  | { kind: "scene"; scene: StoryboardShot };

interface AssetBucketsProps {
  items: MediaItem[];
  scenes?: readonly StoryboardShot[];
  viewMode: MediaViewMode;
  searchQuery: string;
  groupBy: GroupBy;
  selectedItemIds: ReadonlySet<string>;
  selectedSceneId?: string;
  onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onAssociateSceneRef?: React.MutableRefObject<(item: MediaItem) => void>;
  /** Component that renders a single media item row */
  MediaRow: React.ComponentType<{
    item: MediaItem;
    viewMode: MediaViewMode;
    isSelected: boolean;
    onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onAssociateSceneRef?: React.MutableRefObject<(item: MediaItem) => void>;
  }>;
  SceneRow?: React.ComponentType<{
    scene: StoryboardShot;
    viewMode: MediaViewMode;
    isSelected: boolean;
  }>;
}

type AssetCategory =
  | { type: "media"; mediaType: MediaItem["type"]; label: string }
  | { type: "metadata"; kind: string; label: string };

const METADATA_LABELS: Record<string, string> = {
  character: "Characters",
  continuity_note: "Characters",
  note: "Notes",
  scene: "Scenes",
  section: "Scenes",
  style: "Styles",
  visual_motif: "Styles",
  "music-video": "Music Video",
};

export function getAssetCategory(item: MediaItem): AssetCategory {
  const metadataKind = getMetadataKind(item);
  if (metadataKind) {
    return {
      type: "metadata",
      kind: metadataKind,
      label: METADATA_LABELS[metadataKind] ?? `${metadataKind.slice(0, 1).toUpperCase()}${metadataKind.slice(1)}`,
    };
  }

  const labels: Record<MediaItem["type"], string> = {
    video: "Videos",
    audio: "Audio",
    image: "Images",
    srt: "Subtitles",
  };
  return { type: "media", mediaType: item.type, label: labels[item.type] };
}

function getMetadataKind(item: MediaItem): string | null {
  const folder = item.sourceFile?.folder;
  if (!folder || !folder.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(folder) as { kind?: unknown };
    return typeof parsed.kind === "string" && parsed.kind.trim() ? parsed.kind : null;
  } catch {
    return null;
  }
}

function getStatusLabel(item: MediaItem): string {
  const s = getMediaStatus(item);
  if (s === MediaStatus.ERROR) return "Error";
  if (s === MediaStatus.PENDING) return "Pending";
  if (s === MediaStatus.MISSING) return "Placeholder";
  if (s === MediaStatus.UNREALIZED) return "Unrealized";
  return "Normal";
}

/**
 * Computes buckets from items based on groupBy mode.
 */
function computeBuckets(
  items: MediaItem[],
  scenes: readonly StoryboardShot[],
  searchQuery: string,
  groupBy: GroupBy,
): BucketDef[] {
  const query = searchQuery.toLowerCase();

  const mediaEntries: AssetEntry[] = items.map((item) => ({ kind: "media", item }));
  const sceneEntries: AssetEntry[] = scenes.map((scene) => ({ kind: "scene", scene }));
  const entries = [...sceneEntries, ...mediaEntries];
  const filtered = query
    ? entries.filter((entry) => {
        if (entry.kind === "scene") {
          return entry.scene.label.toLowerCase().includes(query) ||
            entry.scene.prompt.toLowerCase().includes(query);
        }
        const item = entry.item;
        const nameMatch = item.name.toLowerCase().includes(query);
        const titleMatch = item.title?.toLowerCase().includes(query);
        const tagMatch = item.tags?.some((t: string) => t.toLowerCase().includes(query));
        const descMatch = item.description?.toLowerCase().includes(query);
        const groupMatch = item.group?.toLowerCase().includes(query);
        return nameMatch || titleMatch || tagMatch || descMatch || groupMatch;
      })
    : entries;

  if (filtered.length === 0) return [];

  switch (groupBy) {
    case "none":
      return [{ id: "all", label: "All Media", entries: filtered }];

    case "tag": {
      const tagSet = new Set<string>();
      for (const entry of filtered) {
        if (entry.kind === "media") for (const tag of entry.item.tags ?? []) tagSet.add(tag);
      }
      const buckets: BucketDef[] = [];
      // Untagged
      const untagged = filtered.filter((entry) => entry.kind === "scene" || !entry.item.tags?.length);
      if (untagged.length > 0) {
        buckets.push({ id: "tag-untagged", label: "Untagged", entries: untagged });
      }
      for (const tag of [...tagSet].sort()) {
        const tagItems = filtered.filter((entry) => entry.kind === "media" && entry.item.tags?.includes(tag));
        if (tagItems.length > 0) {
          buckets.push({ id: `tag-${tag}`, label: `#${tag}`, entries: tagItems });
        }
      }
      return buckets;
    }

    case "type": {
      const typeLabels: Record<string, string> = { video: "Videos", audio: "Audio", image: "Images", srt: "Subtitles" };
      const buckets: BucketDef[] = [];
      const sceneItems = filtered.filter((entry) => entry.kind === "scene");
      if (sceneItems.length > 0) buckets.push({ id: "type-scene", label: "Scenes", entries: sceneItems });
      for (const type of ["video", "audio", "image", "srt"] as const) {
        const typeItems = filtered.filter((entry) => {
          if (entry.kind !== "media") return false;
          const category = getAssetCategory(entry.item);
          return category.type === "media" && category.mediaType === type;
        });
        if (typeItems.length > 0) {
          buckets.push({ id: `type-${type}`, label: typeLabels[type], entries: typeItems });
        }
      }
      // Metadata-backed items (notes, characters, etc.)
      const metadataBuckets = new Map<string, BucketDef>();
      for (const entry of filtered) {
        if (entry.kind !== "media") continue;
        const category = getAssetCategory(entry.item);
        if (category.type !== "metadata") continue;
        const id = `metadata-${category.kind}`;
        const existing = metadataBuckets.get(id);
        if (existing) {
          existing.entries.push(entry);
        } else {
          metadataBuckets.set(id, { id, label: category.label, entries: [entry] });
        }
      }
      buckets.push(...[...metadataBuckets.values()].sort((a, b) => a.label.localeCompare(b.label)));
      return buckets;
    }

    case "status": {
      const statusOrder = ["Normal", "Pending", "Error", "Placeholder"];
      return statusOrder
        .map((status) => {
          const statusItems = filtered.filter((entry) =>
            entry.kind === "scene" ? status === "Normal" : getStatusLabel(entry.item) === status,
          );
          return { id: `status-${status.toLowerCase()}`, label: status, entries: statusItems };
        })
        .filter((b) => b.entries.length > 0);
    }
  }
}

/**
 * Renders media items in collapsible buckets. Multiple buckets expandable simultaneously.
 * Receives data as stable props (primitives + refs) — no render-props that churn identity.
 */
export const AssetBuckets = forwardRef<AssetBucketsHandle, AssetBucketsProps>(function AssetBuckets({
  items,
  scenes = [],
  viewMode,
  searchQuery,
  groupBy,
  selectedItemIds,
  selectedSceneId,
  onGenerateRef,
  onRetryKieAIRef,
  onManageRef,
  onRenameRef,
  onAssociateSceneRef,
  MediaRow,
  SceneRow,
}, ref) {
  const buckets = useMemo(
    () => computeBuckets(items, scenes, searchQuery, groupBy),
    [items, scenes, searchQuery, groupBy],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleBucket = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsed(new Set(buckets.map((b) => b.id)));
  }, [buckets]);

  useImperativeHandle(ref, () => ({ expandAll, collapseAll }), [expandAll, collapseAll]);

  if (buckets.length === 0) return null;

  // Don't render bucket chrome for "none" groupBy with a single bucket
  const flatMode = groupBy === "none" && buckets.length === 1;

  const gridClass =
    viewMode === "list"
      ? "flex flex-col gap-1.5"
      : viewMode === "small"
        ? "grid grid-cols-3 gap-2"
        : "grid grid-cols-2 gap-3";

  const renderEntry = (entry: AssetEntry) => {
    if (entry.kind === "scene") {
      return SceneRow ? (
        <SceneRow
          key={`scene-${entry.scene.id}`}
          scene={entry.scene}
          viewMode={viewMode}
          isSelected={selectedSceneId === entry.scene.id}
        />
      ) : null;
    }
    return (
      <MediaRow
        key={entry.item.id}
        item={entry.item}
        viewMode={viewMode}
        isSelected={selectedItemIds.has(entry.item.id)}
        onGenerateRef={onGenerateRef}
        onRetryKieAIRef={onRetryKieAIRef}
        onManageRef={onManageRef}
        onRenameRef={onRenameRef}
        onAssociateSceneRef={onAssociateSceneRef}
      />
    );
  };

  if (flatMode) {
    return (
      <div className={gridClass}>
        {buckets[0].entries.map(renderEntry)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {buckets.map((bucket, index) => {
        const isCollapsed = collapsed.has(bucket.id);
        const contentId = `asset-bucket-content-${index}`;

        return (
          <div key={bucket.id}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              aria-controls={contentId}
              onClick={() => toggleBucket(bucket.id)}
              className="flex items-center gap-1.5 w-full text-left px-4 py-1.5 hover:bg-background-tertiary/50 rounded transition-colors"
            >
              {isCollapsed ? (
                <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
              ) : (
                <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
              )}
              <span className="text-[11px] font-medium text-text-primary">{bucket.label}</span>
              <span className="text-[10px] text-text-muted ml-1">{bucket.entries.length}</span>
            </button>

            {!isCollapsed && (
              <div id={contentId} className="px-4 pt-1 pb-2">
                <div className={gridClass}>
                  {bucket.entries.map(renderEntry)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
