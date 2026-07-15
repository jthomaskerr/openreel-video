import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Film, Wand2 } from "lucide-react";
import { getSceneIdFromClip } from "@openreel/music-video-domain";
import { Button, Input } from "@openreel/ui";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { useProjectStore } from "../../../stores/project-store";
import { selectSceneGenerationContext } from "../../../features/generation/context/scene-generation";
import { ClipTimingSection } from "./ClipTimingSection";
import { InspectorSection } from "./shell/InspectorSection";

export interface SceneEditorProps {
  sceneId: string;
  projectionClipId?: string;
  focusTitleRequestId?: number;
}

const MIN_TRIM_SECONDS = 0.01;
const GenerateAssetDialog = lazy(() =>
  import("../generate/GenerateAssetDialog").then((module) => ({
    default: module.GenerateAssetDialog,
  })),
);

function RecoverableState({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="m-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function ProjectionTrimSection({ clipId }: { clipId: string }) {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId),
  );

  const updateTrim = useCallback((patch: { inPoint?: number; outPoint?: number }) => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((item) => {
              if (item.id !== clipId) return item;
              const requestedInPoint = patch.inPoint ?? item.inPoint;
              const inPoint = Number.isFinite(requestedInPoint)
                ? Math.max(0, requestedInPoint)
                : item.inPoint;
              const requestedOutPoint = patch.outPoint ?? item.outPoint;
              const outPoint = Number.isFinite(requestedOutPoint)
                ? Math.max(inPoint + MIN_TRIM_SECONDS, requestedOutPoint)
                : item.outPoint;
              return { ...item, inPoint, outPoint };
            }),
          })),
        },
        modifiedAt: Date.now(),
      },
    }));
  }, [clipId]);

  if (!clip) return null;

  return (
    <div className="px-3 pt-3">
      <InspectorSection title="Trim" defaultOpen sectionId="scene-projection-trim">
        <div className="space-y-2 rounded-lg border border-border/60 bg-background-secondary/40 p-2.5">
          <label className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] text-text-secondary">
            <span>In point</span>
            <Input
              aria-label="Projection trim in point"
              type="number"
              min={0}
              step="0.01"
              value={clip.inPoint.toFixed(2)}
              onChange={(event) => updateTrim({ inPoint: Number(event.target.value) })}
              className="h-7 bg-background-tertiary border-border text-right text-[10px]"
            />
            <span className="w-10 text-right text-[9px] text-text-muted">sec</span>
          </label>
          <label className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] text-text-secondary">
            <span>Out point</span>
            <Input
              aria-label="Projection trim out point"
              type="number"
              min={MIN_TRIM_SECONDS}
              step="0.01"
              value={clip.outPoint.toFixed(2)}
              onChange={(event) => updateTrim({ outPoint: Number(event.target.value) })}
              className="h-7 bg-background-tertiary border-border text-right text-[10px]"
            />
            <span className="w-10 text-right text-[9px] text-text-muted">sec</span>
          </label>
        </div>
      </InspectorSection>
    </div>
  );
}

export function SceneEditor({ sceneId, projectionClipId, focusTitleRequestId }: SceneEditorProps) {
  const scene = useMusicVideoStore((state) => {
    const projectId = state.activeProjectId;
    return projectId ? state.projects[projectId]?.shots.find((shot) => shot.id === sceneId) : undefined;
  });
  const updateScene = useMusicVideoStore((state) => state.updateScene);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const [title, setTitle] = useState(scene?.label ?? "");
  const [prompt, setPrompt] = useState(scene?.prompt ?? "");
  const [referenceAssetIds, setReferenceAssetIds] = useState(
    () => scene?.referenceAssetIds.join("\n") ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const handledFocusRequestRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setTitle(scene?.label ?? "");
    setPrompt(scene?.prompt ?? "");
    setReferenceAssetIds(scene?.referenceAssetIds.join("\n") ?? "");
  }, [scene?.id, scene?.label, scene?.prompt, scene?.referenceAssetIds]);

  useEffect(() => {
    if (focusTitleRequestId === undefined || handledFocusRequestRef.current === focusTitleRequestId) return;
    handledFocusRequestRef.current = focusTitleRequestId;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [focusTitleRequestId]);

  const allProjections = useMemo(
    () => tracks.flatMap((track) => track.clips).flatMap((clip) => {
      const linkedShotId = getSceneIdFromClip(clip);
      return linkedShotId
        ? [{
            clipId: clip.id,
            linkedShotId,
            startTime: clip.startTime,
            duration: clip.duration,
            inPoint: clip.inPoint,
            outPoint: clip.outPoint,
          }]
        : [];
    }),
    [tracks],
  );
  const projectionClip = projectionClipId
    ? tracks.flatMap((track) => track.clips).find((clip) => clip.id === projectionClipId)
    : undefined;
  const validProjection = projectionClip && getSceneIdFromClip(projectionClip) === sceneId
    ? projectionClip
    : undefined;
  const generationSelection = scene
    ? selectSceneGenerationContext({
        shotId: scene.id,
        includeAudio: scene.includeMainAudio,
        projectionClipId,
        projections: allProjections,
      })
    : null;

  const saveScene = useCallback((patch: Parameters<typeof updateScene>[1]) => {
    const result = updateScene(sceneId, patch);
    setError(result.success ? null : result.error.message);
  }, [sceneId, updateScene]);

  if (!scene) {
    return <RecoverableState>This scene no longer exists. Select another scene to continue.</RecoverableState>;
  }

  const placementMessage = projectionClipId
    ? validProjection
      ? "Timeline projection"
      : projectionClip
        ? "The selected projection belongs to another scene."
        : "The selected timeline projection no longer exists."
    : "Not on timeline";

  return (
    <div className="min-h-0 overflow-y-auto pb-4 custom-scrollbar" data-testid="scene-editor">
      <div className="border-b border-border/60 px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Film size={15} className="shrink-0 text-primary" />
            <h2 className="truncate text-sm font-semibold text-text-primary">Scene</h2>
          </div>
          <span className="rounded-full border border-border bg-background-secondary px-2 py-0.5 text-[9px] text-text-muted">
            {placementMessage}
          </span>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1 text-[10px] text-text-muted">
            <span>Title</span>
            <Input
              ref={titleRef}
              aria-label="Scene title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const label = title.trim() || "Scene";
                if (label !== scene.label) saveScene({ label });
              }}
              className="h-8 bg-background text-xs text-text-primary"
            />
          </label>
          <label className="block space-y-1 text-[10px] text-text-muted">
            <span>Prompt</span>
            <textarea
              aria-label="Scene prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => {
                if (prompt !== scene.prompt) saveScene({ prompt });
              }}
              rows={5}
              placeholder="Scene description / generation prompt"
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1 text-[10px] text-text-muted">
            <span>Reference asset IDs, one per line</span>
            <textarea
              aria-label="Scene reference asset IDs"
              value={referenceAssetIds}
              onChange={(event) => setReferenceAssetIds(event.target.value)}
              onBlur={() => {
                const nextIds = referenceAssetIds.split(/[\n,]/).map((id) => id.trim()).filter(Boolean);
                if (nextIds.join("\n") !== scene.referenceAssetIds.join("\n")) {
                  saveScene({ referenceAssetIds: nextIds });
                }
              }}
              rows={3}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
        </div>
      </div>

      {error && <RecoverableState>{error}</RecoverableState>}
      {projectionClipId && !validProjection && <RecoverableState>{placementMessage}</RecoverableState>}

      <div className="border-b border-border/60 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              aria-label="Include project audio"
              type="checkbox"
              checked={scene.includeMainAudio}
              onChange={(event) => saveScene({ includeMainAudio: event.target.checked })}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            Include Audio
          </label>
          <Button
            type="button"
            size="sm"
            disabled={generationSelection?.status !== "ready"}
            onClick={() => setGenerateOpen(true)}
            className="h-7 px-2 text-[10px]"
          >
            <Wand2 size={11} className="mr-1" />
            Generate
          </Button>
        </div>
        {generationSelection?.status === "disabled" && (
          <p role="status" className="mt-2 text-[10px] leading-relaxed text-amber-300">
            {generationSelection.reason}
          </p>
        )}
      </div>

      {validProjection && (
        <>
          <ClipTimingSection clip={validProjection} />
          <ProjectionTrimSection clipId={validProjection.id} />
        </>
      )}

      {generateOpen && (
        <Suspense fallback={null}>
          <GenerateAssetDialog
            open
            onClose={() => setGenerateOpen(false)}
            shot={scene}
            clipId={validProjection?.id}
          />
        </Suspense>
      )}
    </div>
  );
}
