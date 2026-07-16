import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  TimelineContextMenu,
  TimelineContextMenuContent,
} from "./TimelineContextMenu";

const TRACK_TYPES = [
  ["video", "Video Track"],
  ["audio", "Audio Track"],
  ["image", "Image Track"],
  ["text", "Text Track"],
  ["graphics", "Graphics Track"],
] as const;

export function TimelineEmptySpaceMenu({ trackId }: { trackId: string }) {
  return (
    <TimelineContextMenu
      trigger={
        <div
          data-testid={`timeline-empty-space-${trackId}`}
          className="absolute inset-0 z-0"
          aria-label="Empty timeline space"
        />
      }
    >
      <TimelineContextMenuContent className="min-w-[180px]">
        <ContextMenuLabel>New Track</ContextMenuLabel>
        <ContextMenuSeparator />
        {TRACK_TYPES.map(([type, label]) => (
          <ContextMenuItem
            key={type}
            onSelect={() => void useProjectStore.getState().addTrack(type)}
          >
            {label}
          </ContextMenuItem>
        ))}
      </TimelineContextMenuContent>
    </TimelineContextMenu>
  );
}
