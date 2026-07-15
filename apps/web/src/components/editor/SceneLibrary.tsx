import { useMemo, useState } from "react";
import { Film, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import type { MediaItem } from "@openreel/core";
import type { StoryboardShot } from "@openreel/music-video-domain";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore, type SceneInspectorSelection } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";

const EMPTY_SCENES: StoryboardShot[] = [];
let focusTitleRequestId = 0;

function sceneSelection(
  sceneId: string,
  options: { projectionClipId?: string; requestTitleFocus?: boolean } = {},
): SceneInspectorSelection {
  return Object.freeze({
    type: "scene" as const,
    sceneId,
    ...(options.projectionClipId ? { projectionClipId: options.projectionClipId } : {}),
    ...(options.requestTitleFocus
      ? { focusTitleRequestId: ++focusTitleRequestId }
      : {}),
  });
}

function selectScene(selection: SceneInspectorSelection): void {
  const ui = useUIStore.getState();
  ui.clearSelection();
  ui.setInspectedAsset(null);
  ui.setInspectorSelection(selection);
}

function placementDisabledReason(): string | null {
  const { activeTrackId } = useUIStore.getState();
  if (!activeTrackId) return "Select a video track to place this scene.";
  const track = useProjectStore.getState().project.timeline.tracks.find(
    (candidate) => candidate.id === activeTrackId,
  );
  if (!track) return "Select a video track to place this scene.";
  if (track.locked) return "Unlock the active track to place this scene.";
  if (track.type !== "video") return "Select a video track to place this scene.";
  return null;
}

interface SceneAssociationPickerProps {
  sceneId: string;
  videos: readonly MediaItem[];
  onDone?: () => void;
}

export function SceneAssociationPicker({
  sceneId,
  videos,
  onDone,
}: SceneAssociationPickerProps) {
  const [mediaId, setMediaId] = useState("");

  const associate = () => {
    if (!mediaId) return;
    const result = useMusicVideoStore
      .getState()
      .associateSceneMedia({ sceneId, mediaId });
    if (!result.success) {
      toast.error("Could not associate video", result.error.message);
      return;
    }
    toast.success("Video associated with scene");
    onDone?.();
  };

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={`scene-association-${sceneId}`}>
      <label className="sr-only" htmlFor={`scene-video-${sceneId}`}>
        Video for scene
      </label>
      <select
        id={`scene-video-${sceneId}`}
        value={mediaId}
        onChange={(event) => setMediaId(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background-tertiary px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Choose a video</option>
        {videos.map((video) => (
          <option key={video.id} value={video.id}>
            {video.title || video.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={associate}
        disabled={!mediaId}
        aria-label="Associate selected video with scene"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background-elevated px-2 text-xs text-text-primary transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Link2 size={13} />
        Associate
      </button>
    </div>
  );
}

interface SceneCardProps {
  scene: StoryboardShot;
  videos: readonly MediaItem[];
  projectionCount: number;
}

function SceneCard({ scene, videos, projectionCount }: SceneCardProps) {
  const [showAssociation, setShowAssociation] = useState(false);
  const disabledReason = placementDisabledReason();
  const status = projectionCount === 0
    ? "Not on timeline"
    : `${projectionCount} ${projectionCount === 1 ? "placement" : "placements"}`;

  const open = () => {
    selectScene(sceneSelection(scene.id));
  };

  const place = async () => {
    const { activeTrackId } = useUIStore.getState();
    const { playheadPosition } = useTimelineStore.getState();
    if (!activeTrackId || placementDisabledReason()) return;
    const result = await useMusicVideoStore.getState().placeScene({
      sceneId: scene.id,
      trackId: activeTrackId,
      startTime: playheadPosition,
    });
    if (!result.success) {
      toast.error("Could not place scene", result.error.message);
      return;
    }
    useUIStore.getState().setActiveTrack(activeTrackId);
    selectScene(
      sceneSelection(scene.id, { projectionClipId: result.value }),
    );
    toast.success("Scene placed on timeline");
  };

  const remove = () => {
    if (!globalThis.confirm(`Delete scene “${scene.label}”?`)) return;
    const result = useMusicVideoStore.getState().deleteScene(scene.id);
    if (!result.success) {
      toast.error("Could not delete scene", result.error.message);
      return;
    }
    const ui = useUIStore.getState();
    if (ui.inspectorSelection?.type === "scene" && ui.inspectorSelection.sceneId === scene.id) {
      ui.setInspectorSelection(null);
    }
    toast.success("Scene deleted");
  };

  return (
    <article
      aria-label={`Scene: ${scene.label}`}
      className="rounded-lg border border-border bg-background-tertiary p-3"
      data-scene-id={scene.id}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={open}
          className="min-w-0 flex-1 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Open scene ${scene.label}`}
        >
          <span className="block truncate text-xs font-semibold text-text-primary">
            {scene.label}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[10px] text-text-secondary">
            <Film size={11} aria-hidden="true" />
            {status}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={open}
            aria-label={`Edit scene ${scene.label}`}
            title="Open scene editor"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-background-elevated hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => setShowAssociation((current) => !current)}
            aria-label={`Associate video with scene ${scene.label}`}
            aria-expanded={showAssociation}
            title="Associate video"
            disabled={videos.length === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-background-elevated hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Link2 size={13} />
          </button>
          {projectionCount === 0 && (
            <button
              type="button"
              onClick={remove}
              aria-label={`Delete scene ${scene.label}`}
              title="Delete scene"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void place()}
            disabled={disabledReason !== null}
            aria-label={`Place scene ${scene.label} at playhead`}
            title={disabledReason ?? "Place at active track and playhead"}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background-elevated px-2 text-[10px] font-medium text-text-primary transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={12} />
            Place
          </button>
        </div>
      </div>
      {showAssociation && (
        <div className="mt-3 border-t border-border pt-3">
          <SceneAssociationPicker
            sceneId={scene.id}
            videos={videos}
            onDone={() => setShowAssociation(false)}
          />
        </div>
      )}
    </article>
  );
}

interface SceneLibraryProps {
  associationMedia?: MediaItem | null;
  onDismissAssociation?: () => void;
}

export function SceneLibrary({
  associationMedia = null,
  onDismissAssociation,
}: SceneLibraryProps) {
  const projectId = useProjectStore((state) => state.project.id);
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const activeTrackId = useUIStore((state) => state.activeTrackId);
  const scenes = useMusicVideoStore(
    (state) => state.projects[projectId]?.shots ?? EMPTY_SCENES,
  );
  const videos = useMemo(
    () => mediaItems.filter((item) => item.type === "video"),
    [mediaItems],
  );

  // These subscriptions keep placement status and compatibility current.
  void tracks;
  void activeTrackId;

  const create = () => {
    const result = useMusicVideoStore.getState().createScene();
    if (!result.success) {
      toast.error("Could not create scene", result.error.message);
      return;
    }
    selectScene(
      sceneSelection(result.value, { requestTitleFocus: true }),
    );
  };

  return (
    <section aria-labelledby="media-scenes-heading" className="border-b border-border/70 px-4 pb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 id="media-scenes-heading" className="text-xs font-semibold text-text-primary">
            Scenes
          </h3>
          <p className="text-[10px] text-text-secondary">
            {scenes.length === 0 ? "No scenes yet" : `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          <Plus size={13} />
          Create Scene
        </button>
      </div>

      {scenes.length > 0 && (
        <div className="grid max-h-56 gap-2 overflow-y-auto pr-1" role="list" aria-label="Scenes">
          {scenes.map((scene) => (
            <div role="listitem" key={scene.id}>
              <SceneCard
                scene={scene}
                videos={videos}
                projectionCount={useMusicVideoStore.getState().getSceneProjectionCount(scene.id)}
              />
            </div>
          ))}
        </div>
      )}

      {associationMedia?.type === "video" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="associate-video-heading"
          className="mt-3 rounded-lg border border-primary/40 bg-background-elevated p-3"
        >
          <h4 id="associate-video-heading" className="mb-2 text-xs font-semibold text-text-primary">
            Associate {associationMedia.title || associationMedia.name} with Scene
          </h4>
          {scenes.length === 0 ? (
            <p className="text-xs text-text-secondary">Create a scene first.</p>
          ) : (
            <AssetSceneAssociation
              media={associationMedia}
              scenes={scenes}
              onDone={onDismissAssociation}
            />
          )}
          <button
            type="button"
            onClick={onDismissAssociation}
            className="mt-2 text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function AssetSceneAssociation({
  media,
  scenes,
  onDone,
}: {
  media: MediaItem;
  scenes: readonly StoryboardShot[];
  onDone?: () => void;
}) {
  const [sceneId, setSceneId] = useState("");
  const associate = () => {
    if (!sceneId || media.type !== "video") return;
    const result = useMusicVideoStore
      .getState()
      .associateSceneMedia({ sceneId, mediaId: media.id });
    if (!result.success) {
      toast.error("Could not associate video", result.error.message);
      return;
    }
    toast.success("Video associated with scene");
    onDone?.();
  };
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`asset-scene-${media.id}`}>Scene</label>
      <select
        id={`asset-scene-${media.id}`}
        value={sceneId}
        onChange={(event) => setSceneId(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background-tertiary px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Choose a scene</option>
        {scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>{scene.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!sceneId}
        onClick={associate}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Link2 size={13} />
        Associate
      </button>
    </div>
  );
}
