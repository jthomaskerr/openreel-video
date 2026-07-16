import { toast } from "../../../stores/notification-store";
import React from "react";
import {
  Copy,
  Layers,
  Trash2,
  Scissors,
  Music,
  Sparkles,
  Volume2,
  Film,
  Image,
  ArrowLeftToLine,
  RefreshCw,
  AlertTriangle,
  Link2,
  Clapperboard,
  ExternalLink,
} from "lucide-react";
import type { Clip, Track } from "@openreel/core";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { useUIStore } from "../../../stores/ui-store";
import { normalizeSceneProjectionMetadata } from "@openreel/music-video-domain";
import { ScenePickerDialog } from "./ScenePickerDialog";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuLabel
} from "@openreel/ui";
import { TimelineContextMenuContent } from "./TimelineContextMenu";

interface ClipContextMenuProps {
  clip: Clip;
  track: Track;
  onClose?: () => void;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  clip,
  track,
  onClose
}) => {
  const {
    copyClips,
    duplicateClip,
    removeClip,
    rippleDeleteClip,
    splitClip,
    separateAudio,
    getMediaItem,
    copyEffects,
    pasteEffects,
    copiedEffects,
    closeGapBeforeClip,
    replaceMediaAsset
  } = useProjectStore();
  const { playheadPosition } = useTimelineStore();
  const activeMusicProject = useMusicVideoStore((state) =>
    state.activeProjectId ? state.projects[state.activeProjectId] : undefined,
  );
  const linkClipToScene = useMusicVideoStore((state) => state.linkClipToScene);
  const convertClipToScene = useMusicVideoStore((state) => state.convertClipToScene);
  const { select, setActiveTrack, setInspectorSelection } = useUIStore();
  const [scenePickerMode, setScenePickerMode] = React.useState<"link" | "change" | null>(null);

  const isPlayheadOnClip =
    playheadPosition >= clip.startTime &&
    playheadPosition <= clip.startTime + clip.duration;

  const hasGapBeforeClip = React.useMemo(() => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx < 0) return false;
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const target = prev ? prev.startTime + prev.duration : 0;
    return clip.startTime - target > 0.0001;
  }, [track.clips, clip.id, clip.startTime]);

  const mediaItem = getMediaItem(clip.mediaId);
  const isVideo = track.type === "video" && clip.type === "video";
  const isAudio = track.type === "audio";
  const isImage = track.type === "image";
  const isVideoWithAudio =
    isVideo &&
    mediaItem?.type === "video" &&
    mediaItem?.metadata?.channels &&
    mediaItem.metadata.channels > 0;

  const hasEffects = clip.effects && clip.effects.length > 0;
  const hasCopiedEffects = copiedEffects && copiedEffects.length > 0;
  const linkedSceneId = React.useMemo(() => {
    const direct = normalizeSceneProjectionMetadata(clip.metadata);
    if (direct) return direct.shotId;
    const payload = clip.metadata && typeof clip.metadata.payload === "object"
      ? clip.metadata.payload
      : undefined;
    return normalizeSceneProjectionMetadata(payload)?.shotId;
  }, [clip.metadata]);
  const scenes = activeMusicProject?.shots ?? [];

  const openSceneInspector = (sceneId: string) => {
    select({ type: "clip", id: clip.id, trackId: track.id });
    setActiveTrack(track.id);
    setInspectorSelection({
      type: "scene",
      sceneId,
      projectionClipId: clip.id,
    });
    onClose?.();
  };

  const handleSelectScene = (sceneId: string) => {
    const result = linkClipToScene({ clipId: clip.id, sceneId });
    if (!result.success) {
      toast.error("Could not link scene", `[${result.error.code}] ${result.error.message}`);
      return;
    }
    setScenePickerMode(null);
    openSceneInspector(sceneId);
  };

  const handleConvertToScene = () => {
    const result = convertClipToScene({ clipId: clip.id });
    if (!result.success) {
      toast.error("Could not convert clip", `[${result.error.code}] ${result.error.message}`);
      return;
    }
    openSceneInspector(result.value);
  };

  const handleCopy = () => {
    copyClips([clip.id]);
    onClose?.();
  };

  const handleDuplicate = async () => {
    await duplicateClip(clip.id);
    onClose?.();
  };

  const handleDelete = async () => {
    await removeClip(clip.id);
    onClose?.();
  };

  const handleRippleDelete = async () => {
    await rippleDeleteClip(clip.id);
    onClose?.();
  };

  const handleSplit = async () => {
    if (isPlayheadOnClip) {
      await splitClip(clip.id, playheadPosition);
    }
    onClose?.();
  };

  const handleCloseGap = async () => {
    await closeGapBeforeClip(clip.id);
    onClose?.();
  };

  const handleSeparateAudio = async () => {
    await separateAudio(clip.id);
    onClose?.();
  };

  const handleCopyEffects = () => {
    copyEffects(clip.id);
    onClose?.();
  };

  const handlePasteEffects = async () => {
    await pasteEffects(clip.id);
    onClose?.();
  };
  const handleLinkFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*,image/*";
    input.style.display = "none";
    input.onchange = async (event) => {
      try {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const result = await replaceMediaAsset(clip.mediaId, file);
        if (result.success) {
          toast.success("File linked", `Replaced with ${file.name}`);
          onClose?.();
        } else {
          toast.error("Link failed", result.error?.message || "Could not replace file");
        }
      } catch (err) {
        toast.error("Link failed", err instanceof Error ? err.message : "Unknown error");
      } finally {
        input.remove();
      }
    };
    document.body.appendChild(input);
    input.click();
  };

  const getClipTypeLabel = () => {
    if (isVideo) return "Video Clip";
    if (isAudio) return "Audio Clip";
    if (isImage) return "Image Clip";
    return "Clip";
  };

  const getClipTypeIcon = () => {
    if (isVideo) return <Film className="mr-2 h-3 w-3 text-primary" />;
    if (isAudio) return <Volume2 className="mr-2 h-3 w-3 text-blue-400" />;
    if (isImage) return <Image className="mr-2 h-3 w-3 text-purple-400" />;
    return null;
  };

  return (
    <>
      <TimelineContextMenuContent className="min-w-[220px]">
      <ContextMenuLabel className="flex items-center text-[10px] text-text-muted">
        {getClipTypeIcon()}
        {getClipTypeLabel()}
      </ContextMenuLabel>
      <ContextMenuSeparator />

      {mediaItem && getMediaStatus(mediaItem) === MediaStatus.MISSING && (
        <>
          <ContextMenuItem onClick={handleLinkFile}>
            <RefreshCw className="mr-2 h-4 w-4 text-yellow-500" />
            Link File…
          </ContextMenuItem>
          <ContextMenuLabel className="flex items-center text-[10px] text-yellow-500">
            <AlertTriangle className="mr-2 h-3 w-3" />
            Missing media placeholder
          </ContextMenuLabel>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem onClick={handleCopy}>
        <Copy className="mr-2 h-4 w-4" />
        Copy Clip
        <ContextMenuShortcut>⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDuplicate}>
        <Layers className="mr-2 h-4 w-4" />
        Duplicate
        <ContextMenuShortcut>⌘D</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleSplit} disabled={!isPlayheadOnClip}>
        <Scissors className="mr-2 h-4 w-4" />
        Split at Playhead
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCloseGap} disabled={!hasGapBeforeClip}>
        <ArrowLeftToLine className="mr-2 h-4 w-4" />
        Close Gap to Previous
      </ContextMenuItem>

      {(isVideo || isImage) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Sparkles className="mr-2 h-4 w-4" />
              Effects
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={handleCopyEffects} disabled={!hasEffects}>
                Copy Effects
              </ContextMenuItem>
              <ContextMenuItem onClick={handlePasteEffects} disabled={!hasCopiedEffects}>
                Paste Effects
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      {isVideoWithAudio && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSeparateAudio}>
            <Music className="mr-2 h-4 w-4" />
            Separate Audio
          </ContextMenuItem>
        </>
      )}

      {isAudio && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Volume2 className="mr-2 h-4 w-4" />
              Audio
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={handleCopyEffects} disabled={!hasEffects}>
                Copy Audio Effects
              </ContextMenuItem>
              <ContextMenuItem onClick={handlePasteEffects} disabled={!hasCopiedEffects}>
                Paste Audio Effects
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      {isVideo && (
        <>
          <ContextMenuSeparator />
          {linkedSceneId ? (
            <>
              <ContextMenuItem onClick={() => openSceneInspector(linkedSceneId)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Scene
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setScenePickerMode("change")}>
                <Link2 className="mr-2 h-4 w-4" />
                Change Linked Scene…
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem
                onClick={() => setScenePickerMode("link")}
                disabled={scenes.length === 0}
                title={scenes.length === 0 ? "Create a scene before linking this clip." : undefined}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Link to Existing Scene…
              </ContextMenuItem>
              <ContextMenuItem onClick={handleConvertToScene}>
                <Clapperboard className="mr-2 h-4 w-4" />
                Convert to Scene Clip
              </ContextMenuItem>
            </>
          )}
        </>
      )}

      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRippleDelete} className="text-red-400">
        <Trash2 className="mr-2 h-4 w-4" />
        Ripple Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDelete} className="text-red-400">
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </ContextMenuItem>
      </TimelineContextMenuContent>
      <ScenePickerDialog
        open={scenePickerMode !== null}
        title={scenePickerMode === "change" ? "Change Linked Scene" : "Link to Existing Scene"}
        scenes={scenes}
        currentSceneId={linkedSceneId}
        onSelect={handleSelectScene}
        onCancel={() => setScenePickerMode(null)}
      />
    </>
  );
};
