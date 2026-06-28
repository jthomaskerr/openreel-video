import { useCallback } from "react";
import type { MediaItem } from "@openreel/core";
import { Button, Label } from "@openreel/ui";
import { Check, ImageIcon, Film, Music } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";

interface VersionsTabProps {
  item: MediaItem;
  onClose: () => void;
}

export function VersionsTab({ item }: VersionsTabProps) {
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const setCurrentVersion = useProjectStore((s) => s.setCurrentAssetVersion);
  const freshItem = mediaItems.find((m) => m.id === item.id) ?? item;
  const assetGroupId = freshItem.assetGroupId ?? freshItem.id;

  const versions = mediaItems.filter(
    (m) => (m.assetGroupId ?? m.id) === assetGroupId,
  );

  const handlePromote = useCallback(
    async (mediaId: string) => {
      setCurrentVersion(mediaId);
    },
    [setCurrentVersion],
  );

  const TypeIcon = ({ type }: { type: MediaItem["type"] }) => {
    switch (type) {
      case "video":
        return <Film size={14} className="text-text-muted" />;
      case "audio":
        return <Music size={14} className="text-text-muted" />;
      case "image":
        return <ImageIcon size={14} className="text-text-muted" />;
    }
  };

  // No versioning active
  if (versions.length <= 1) {
    return (
      <div className="space-y-3 px-1">
        <div className="text-center py-8">
          <p className="text-xs text-text-muted">No versions yet.</p>
          <p className="text-[10px] text-text-muted mt-1">
            Duplicate this asset to create a version group.
          </p>
        </div>
      </div>
    );
  }

  // Sort: current first, then by date descending
  const sorted = [...versions].sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return 0;
  });

  return (
    <div className="space-y-2 px-1">
      <Label className="text-[11px] text-text-secondary">
        {sorted.length} version{sorted.length !== 1 ? "s" : ""}
      </Label>
      <div className="space-y-1.5">
        {sorted.map((v) => (
          <div
            key={v.id}
            className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${
              v.isCurrent
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:border-text-secondary"
            }`}
          >
            <div className="w-10 h-8 rounded bg-background-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
              {v.thumbnailUrl ? (
                <img src={v.thumbnailUrl} alt={v.name} className="w-full h-full object-cover" />
              ) : (
                <TypeIcon type={v.type} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-text-primary truncate">
                {v.title || v.name}
                {v.isCurrent && (
                  <span className="ml-1.5 text-[9px] text-primary font-normal">current</span>
                )}
              </div>
              <div className="text-[9px] text-text-muted">
                {v.metadata?.width && `${v.metadata.width}×${v.metadata.height}`}
                {v.metadata?.width && v.metadata?.fileSize && " • "}
                {v.metadata?.fileSize && formatSize(v.metadata.fileSize)}
              </div>
            </div>

            {!v.isCurrent && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handlePromote(v.id)}
                className="text-[10px] h-7 px-2"
              >
                <Check size={12} className="mr-1" />
                Set Current
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}