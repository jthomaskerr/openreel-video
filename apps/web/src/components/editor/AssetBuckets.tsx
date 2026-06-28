import { useMemo, useState } from "react";
import type { MediaItem } from "@openreel/core";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@openreel/ui";
import { ChevronDown, ChevronRight } from "lucide-react";

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
  /** Ref-based callbacks for actions (stable across renders) */
  onGenerateRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRetryKieAIRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onManageRef?: React.MutableRefObject<(item: MediaItem) => void>;
  onRenameRef?: React.MutableRefObject<(item: MediaItem) => void>;
  /** Renders a single media item row */
  renderItem: (item: MediaItem) => React.ReactNode;
  /** Renders the "Add media" placeholder button */
  renderAddButton: () => React.ReactNode;
}

/**
 * Computes buckets from items — "All", by type, and by tag.
 * Memoized to avoid recomputation on parent re-renders.
 */
function computeBuckets(items: MediaItem[], searchQuery: string): BucketDef[] {
  const query = searchQuery.toLowerCase();

  // Filter first
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

  // Always include "All"
  buckets.push({ id: "all", label: "All Assets", items: filtered });

  // By type
  for (const type of ["video", "audio", "image"] as const) {
    const typeItems = filtered.filter((i) => i.type === type);
    if (typeItems.length > 0) {
      const labels: Record<string, string> = { video: "Videos", audio: "Audio", image: "Images" };
      buckets.push({ id: `type-${type}`, label: labels[type], items: typeItems });
    }
  }

  // By tag (dynamic)
  const tagSet = new Set<string>();
  for (const item of filtered) {
    for (const tag of item.tags ?? []) {
      tagSet.add(tag);
    }
  }
  for (const tag of [...tagSet].sort()) {
    const tagItems = filtered.filter((i) => i.tags?.includes(tag));
    if (tagItems.length > 0) {
      buckets.push({ id: `tag-${tag}`, label: `#${tag}`, items: tagItems });
    }
  }

  // By group (dynamic)
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

/**
 * Renders media items in collapsible buckets.
 * Multiple buckets can be expanded simultaneously.
 */
export function AssetBuckets({
  items,
  viewMode,
  searchQuery,
  renderItem,
  renderAddButton,
}: AssetBucketsProps) {
  const buckets = useMemo(() => computeBuckets(items, searchQuery), [items, searchQuery]);

  // Track which buckets are collapsed. "all" starts expanded, others collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleBucket = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
              {/* Bucket header */}
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1.5 w-full text-left px-4 py-1.5 hover:bg-background-tertiary/50 rounded transition-colors">
                  {isCollapsed ? (
                    <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
                  ) : (
                    <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
                  )}
                  <span className="text-[11px] font-medium text-text-primary">
                    {bucket.label}
                  </span>
                  <span className="text-[10px] text-text-muted ml-1">
                    {bucket.items.length}
                  </span>
                </button>
              </CollapsibleTrigger>

              {/* Bucket content */}
              <CollapsibleContent>
                <div className="px-4 pt-1 pb-2">
                  <div className={gridClass}>
                    {bucket.items.map((item) => renderItem(item))}
                    {/* Show add button only in "All" bucket */}
                    {bucket.id === "all" && renderAddButton()}
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