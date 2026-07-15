import type { Clip } from "@openreel/core";
import { getSceneIdFromClip } from "@openreel/music-video-domain";
import { SceneEditor } from "./SceneEditor";

export function SceneMetadataInspector({ clip }: { clip: Clip }) {
  const sceneId = getSceneIdFromClip(clip);

  if (!sceneId) {
    return (
      <div role="status" className="text-xs text-amber-300" data-testid="scene-metadata-inspector">
        This clip has scene metadata but no usable scene ID. Relink it to a scene to continue.
      </div>
    );
  }

  return (
    <div data-testid="scene-metadata-inspector">
      <SceneEditor sceneId={sceneId} projectionClipId={clip.id} />
    </div>
  );
}
