import { useState } from "react";
import type {
  ResolvePreviewClipGroup,
  ResolvePreviewClipType,
} from "@openreel/core";
import { MediaClipPreview } from "./MediaClipPreview";

export interface ClipGroupsProps {
  groups: ResolvePreviewClipGroup[];
}

const GROUP_LABELS: Record<ResolvePreviewClipType, string> = {
  video: "Video",
  audio: "Audio",
  titles: "Titles",
  graphics: "Graphics",
  subtitles: "Subtitles",
  unsupported: "Unsupported",
};

export function ClipGroups({ groups }: ClipGroupsProps) {
  const [collapsed, setCollapsed] = useState<Partial<Record<ResolvePreviewClipType, boolean>>>({});

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">This project has no clips to preview.</p>;
  }

  return (
    <section aria-label="Project clip groups" className="space-y-2">
      {groups.map((group) => {
        const label = GROUP_LABELS[group.type];
        const isExpanded = !collapsed[group.type];
        const panelId = `resolve-clip-group-${group.type}`;
        const countLabel = `${group.clips.length.toLocaleString("en-GB")} ${group.clips.length === 1 ? "clip" : "clips"}`;

        return (
          <div key={group.type} className="overflow-hidden rounded-md border bg-card">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={panelId}
              aria-label={`${label}, ${countLabel}`}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => setCollapsed((current) => ({ ...current, [group.type]: !current[group.type] }))}
            >
              <span>{label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{countLabel}</span>
            </button>
            {isExpanded && (
              <div id={panelId} className="border-t p-3">
                {group.clips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No {label.toLocaleLowerCase()} clips.</p>
                ) : (
                  <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
                    {group.clips.map((clip) => (
                      <li key={clip.id} className="min-w-0">
                        <MediaClipPreview clip={clip} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
