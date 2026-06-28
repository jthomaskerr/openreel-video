import { useMemo, useState, useCallback, memo } from "react";
import type { MediaItem } from "@openreel/core";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@openreel/ui";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";

type MediaViewMode = "large" | "small" | "list";

interface BucketDef {
  id: string;
  label: string;
  items: MediaItem[];
}

interface AssetBucketsProps {
  items: MediaItem[];
  viewMode: MediaViewMode;
  searchQuery: string;
  selectedItemIds: ReadonlySet<string>;
  onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onAddMedia: () => void;
  /** Component that renders a single media item row */
  MediaRow: React.ComponentType<{
    item: MediaItem;
    viewMode: MediaViewMode;
    isSelected: boolean;
    onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
    onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
  }>;
}

/**
 * Computes buckets from items — "All", by type, by tag, by group.
 */
function computeBuckets(items: MediaItem[], searchQuery: string): BucketDef[] {
  const query = searchQuery.toLowerCase();

  const filtered = query
    ? items.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(query);
        const titleMatch = item.title?.toLowerCase().includes(query);
        const tagMatch = item.tags?.some((t: string) => t.toLowerCase().includes(query));
        const descMatch = item.description?.toLowerCase().includes(query);
        const groupMatch = item.group?.toLowerCase().includes(query);
        return nameMatch || titleMatch || tagMatch || descMatch || groupMatch;
      })
    : items;

  if (filtered.length === 0) return [];

  const buckets: BucketDef[] = [];

  // All
  buckets.push({ id: "all", label: "All Assets", items: filtered });

  // By type
  for (const type of ["video", "audio", "image"] as const) {
    const typeItems = filtered.filter((i) => i.type === type);
    if (typeItems.length > 0) {
      const labels: Record<string, string> = { video: "Videos", audio: "Audio", image: "Images" };
      buckets.push({ id: `type-${type}`, label: labels[type], items: typeItems });
    }
  }

  // By tag
  const tagSet = new Set<string>();
  for (const item of filtered) {
    for (const tag of item.tags ?? []) tagSet.add(tag);
  }
  for (const tag of [...tagSet].sort()) {
    const tagItems = filtered.filter((i) => i.tags?.includes(tag));
    if (tagItems.length > 0) {
      buckets.push({ id: `tag-${tag}`, label: `#${tag}`, items: tagItems });
    }
  }

  // By group
  const groupSet = new Set<string>();
  for (const item of filtered) {
    if (item.group) groupSet.add(item.group);
  }
  for (const group of [...groupSet].sort()) {
    const groupItems = filtered.filter((i) => i.group === group);
    if (groupItems.length > 0) {
      buckets.push({ id: `group-${group}`, label: group, items: groupItems });
    }
  }

  return buckets;
}

function AddMediaButton({ viewMode, onClick }: { viewMode: MediaViewMode; onClick: () => void }) {
  if (viewMode === "list") {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 border-dashed border-border hover:border-text-secondary cursor-pointer transition-all group"
      >
        <div className="w-12 h-8 rounded bg-background-tertiary flex items-center justify-center flex-shrink-0">
          <Upload size={14} className="text-text-muted group-hover:text-text-secondary transition-colors" />
        </div>
        <span className="text-[11px] text-text-muted group-hover:text-text-secondary transition-colors font-medium">Add media</span>
      </button>
    );
  }
  return (
    <div className="flex flex-col">
      <button
        onClick={onClick}
        className="aspect-video bg-background-tertiary rounded-lg border-2 border-dashed border-border hover:border-text-secondary relative flex items-center justify-center cursor-pointer transition-all overflow-hidden shadow-sm group"
      >
        <div className="flex flex-col items-center gap-1.5">
          <Upload size={viewMode === "small" ? 16 : 20} className="text-text-muted group-hover:text-text-secondary transition-colors" />
          <span className="text-[10px] text-text-muted group-hover:text-text-secondary transition-colors">Add media</span>
        </div>
      </button>
    </div>
  );
}

// Memoize AddMediaButton to avoid re-creating on every render
const MemoAddMediaButton = memo(AddMediaButton);

/**
 * Renders media items in collapsible buckets. Multiple buckets expandable simultaneously.
 * Receives data as stable props (primitives + refs) — no render-props that churn identity.
 */
export function AssetBuckets({
  items,
  viewMode,
  searchQuery,
  selectedItemIds,
  onGenerateRef,
  onRetryKieAIRef,
  onManageRef,
  onRenameRef,
  onAddMedia,
  MediaRow,
}: AssetBucketsProps) {
  const buckets = useMemo(() => computeBuckets(items, searchQuery), [items, searchQuery]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleBucket = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (buckets.length === 0) return null;

  const gridClass =
    viewMode === "list"
      ? "flex flex-col gap-1.5"
      : viewMode === "small"
        ? "grid grid-cols-3 gap-2"
        : "grid grid-cols-2 gap-3";

  return (
    <div className="space-y-3">
      {buckets.map((bucket) => {
        const isCollapsed = collapsed.has(bucket.id);

        return (
          <div key={bucket.id}>
            <Collapsible open={!isCollapsed} onOpenChange={() => toggleBucket(bucket.id)}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1.5 w-full text-left px-4 py-1.5 hover:bg-background-tertiary/50 rounded transition-colors">
                  {isCollapsed ? (
                    <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
                  ) : (
                    <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
                  )}
                  <span className="text-[11px] font-medium text-text-primary">{bucket.label}</span>
                  <span className="text-[10px] text-text-muted ml-1">{bucket.items.length}</span>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="px-4 pt-1 pb-2">
                  <div className={gridClass}>
                    {bucket.items.map((item) => (
                      <MediaRow
                        key={item.id}
                        item={item}
                        viewMode={viewMode}
                        isSelected={selectedItemIds.has(item.id)}
                        onGenerateRef={onGenerateRef}
                        onRetryKieAIRef={onRetryKieAIRef}
                        onManageRef={onManageRef}
                        onRenameRef={onRenameRef}
                      />
                    ))}
                    {bucket.id === "all" && <MemoAddMediaButton viewMode={viewMode} onClick={onAddMedia} />}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}