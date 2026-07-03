import { tool } from "ai";
import { z } from "zod";
import type { Action, ActionResult, Clip, TimelineAction } from "@openreel/core";
import type { SelectionType } from "../../../stores/ui-store";
import type { EditorStateSnapshot } from "../snapshot";
import { buildEditorSnapshot } from "../snapshot";
import { executeEditorMutation } from "../execute";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { projectManager } from "../../project-manager";

export interface ToolResult {
  ok: boolean;
  message?: string;
  data?: unknown;
  undoLabel?: string;
  needsConfirm?: boolean;
  validationErrors?: unknown;
}

const ACTION_TYPES = [
  "project/create",
  "project/updateSettings",
  "project/rename",
  "media/import",
  "media/delete",
  "media/rename",
  "media/updateMetadata",
  "track/add",
  "track/remove",
  "track/reorder",
  "track/lock",
  "track/hide",
  "track/mute",
  "track/solo",
  "clip/add",
  "clip/remove",
  "clip/move",
  "clip/trim",
  "clip/split",
  "clip/rippleDelete",
  "clip/slip",
  "clip/slide",
  "effect/add",
  "effect/remove",
  "effect/update",
  "effect/reorder",
  "transform/update",
  "keyframe/add",
  "keyframe/remove",
  "keyframe/update",
  "transition/add",
  "transition/remove",
  "transition/update",
  "audio/setVolume",
  "audio/setFade",
  "audio/addAutomation",
  "subtitle/import",
  "subtitle/add",
  "subtitle/update",
  "subtitle/remove",
  "subtitle/setStyle",
] as const;

type EditorActionType = typeof ACTION_TYPES[number];

const actionTypeSchema = z.enum(ACTION_TYPES);
const paramsSchema = z.record(z.string(), z.unknown());

function actionResult(result: ActionResult, undoLabel?: string): ToolResult {
  return result.success
    ? { ok: true, undoLabel }
    : { ok: false, message: result.error?.message ?? "Action failed", validationErrors: result.error ? [result.error] : undefined };
}

function levenshtein(a: string, b: string): number {
  const costs = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = costs[j];
      costs[j] = a[i - 1] === b[j - 1]
        ? costs[j - 1]
        : Math.min(costs[j - 1], previous, costs[j]) + 1;
      previous = current;
    }
    costs[0] = i;
  }
  return costs[b.length];
}

function suggestActionType(input: string): string {
  return ACTION_TYPES.reduce((best, candidate) => (
    levenshtein(input, candidate) < levenshtein(input, best) ? candidate : best
  ), ACTION_TYPES[0]);
}

function makeAction(type: EditorActionType, params: Record<string, unknown>): Action {
  return {
    type,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params,
  };
}

function trackClipCount(trackId: string): number {
  const project = useProjectStore.getState().project;
  return project.timeline.tracks.find((track) => track.id === trackId)?.clips.length ?? 0;
}

function projectHasContent(): boolean {
  const project = useProjectStore.getState().project;
  return project.mediaLibrary.items.length > 0 || project.timeline.tracks.some((track) => track.clips.length > 0);
}

export function buildToolSet(_state: EditorStateSnapshot) {
  return {
    get_editor_state: tool({
      description: "Return the current editor state snapshot.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, data: buildEditorSnapshot() }),
    }),

    add_track: tool({
      description: "Insert a video, audio, image, text, or graphics track.",
      inputSchema: z.object({
        type: z.enum(["video", "audio", "image", "text", "graphics"]),
        index: z.number().int().nonnegative().optional(),
      }),
      execute: async ({ type, index }) => executeEditorMutation("Add track", async () => useProjectStore.getState().addTrack(type, index)),
    }),

    remove_track: tool({
      description: "Remove a track. Requires confirm:true when the track contains clips.",
      inputSchema: z.object({ trackId: z.string(), confirm: z.boolean().optional() }),
      execute: async ({ trackId, confirm }) => {
        const clipCount = trackClipCount(trackId);
        if (clipCount > 0 && confirm !== true) {
          return { ok: false, needsConfirm: true, message: `Track has ${clipCount} clips. Re-run with confirm:true to delete them.` };
        }
        return executeEditorMutation("Remove track", async () => useProjectStore.getState().removeTrack(trackId));
      },
    }),

    add_clip: tool({
      description: "Place a media item from the library onto a track.",
      inputSchema: z.object({
        trackId: z.string(),
        mediaId: z.string(),
        startTime: z.number().nonnegative(),
        duration: z.number().positive().optional(),
        inPoint: z.number().nonnegative().optional(),
        outPoint: z.number().nonnegative().optional(),
      }),
      execute: async ({ trackId, mediaId, startTime, duration, inPoint, outPoint }) => {
        const { project, addClip } = useProjectStore.getState();
        const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
        const mediaItem = project.mediaLibrary.items.find((candidate) => candidate.id === mediaId);
        const type: Clip["type"] =
          track?.type === "metadata"
            ? "metadata"
            : mediaItem?.type === "audio" || track?.type === "audio"
              ? "audio"
              : mediaItem?.type === "image" || track?.type === "image"
                ? "image"
                : "video";
        const options = duration ?? inPoint ?? outPoint
          ? { duration, type, metadata: { inPoint, outPoint } }
          : { type };
        return executeEditorMutation("Add clip", async () => addClip(trackId, mediaId, startTime, options));
      },
    }),

    split_clip: tool({
      description: "Split a clip at a timeline time.",
      inputSchema: z.object({ clipId: z.string(), splitTime: z.number().nonnegative() }),
      execute: async ({ clipId, splitTime }) => executeEditorMutation("Split clip", async () => useProjectStore.getState().splitClip(clipId, splitTime)),
    }),

    trim_clip: tool({
      description: "Change a clip's in or out point.",
      inputSchema: z.object({ clipId: z.string(), inPoint: z.number().nonnegative().optional(), outPoint: z.number().nonnegative().optional() }),
      execute: async ({ clipId, inPoint, outPoint }) => executeEditorMutation("Trim clip", async () => useProjectStore.getState().trimClip(clipId, inPoint, outPoint)),
    }),

    move_clip: tool({
      description: "Move a clip to a new track and/or start time.",
      inputSchema: z.object({ clipId: z.string(), trackId: z.string().optional(), startTime: z.number().nonnegative() }),
      execute: async ({ clipId, trackId, startTime }) => executeEditorMutation("Move clip", async () => useProjectStore.getState().moveClip(clipId, startTime, trackId)),
    }),

    remove_clip: tool({
      description: "Delete a clip, optionally ripple-deleting the gap.",
      inputSchema: z.object({ clipId: z.string(), ripple: z.boolean().optional(), confirm: z.boolean().optional() }),
      execute: async ({ clipId, ripple, confirm }) => {
        if (ripple && confirm !== true) {
          return { ok: false, needsConfirm: true, message: "Ripple delete removes the clip and closes the gap. Re-run with confirm:true." };
        }
        return executeEditorMutation(ripple ? "Ripple delete clip" : "Remove clip", async () => (
          ripple ? useProjectStore.getState().rippleDeleteClip(clipId) : useProjectStore.getState().removeClip(clipId)
        ));
      },
    }),

    set_clip_properties: tool({
      description: "Batch-set transform, speed, volume, pan, opacity, or blend mode on a clip.",
      inputSchema: z.object({
        clipId: z.string(),
        transform: z.record(z.string(), z.unknown()).optional(),
        volume: z.number().min(0).max(2).optional(),
        fadeIn: z.number().nonnegative().optional(),
        fadeOut: z.number().nonnegative().optional(),
        blendMode: z.string().optional(),
        opacity: z.number().min(0).max(1).optional(),
        speed: z.number().positive().optional(),
        pan: z.number().min(-1).max(1).optional(),
      }),
      execute: async ({ clipId, transform, volume, fadeIn, fadeOut, blendMode, opacity, speed, pan }) => executeEditorMutation("Set clip properties", async () => {
        const store = useProjectStore.getState();
        let last: ActionResult = { success: true };
        const actions: Array<[EditorActionType, Record<string, unknown>]> = [];
        if (transform) actions.push(["transform/update", { clipId, transform }]);
        if (volume !== undefined) actions.push(["audio/setVolume", { clipId, volume }]);
        if (fadeIn !== undefined || fadeOut !== undefined) actions.push(["audio/setFade", { clipId, fadeIn, fadeOut }]);
        if (blendMode !== undefined) store.updateClipBlendMode(clipId, blendMode as never);
        if (opacity !== undefined) store.updateClipBlendOpacity(clipId, opacity);
        if (speed !== undefined || pan !== undefined) store.updateClipMetadata(clipId, { speed, pan });
        for (const [type, params] of actions) {
          last = await store.executeAction(makeAction(type, params));
          if (!last.success) return last;
        }
        return last;
      }),
    }),

    add_text_clip: tool({
      description: "Create a styled text clip on a track.",
      inputSchema: z.object({ trackId: z.string(), startTime: z.number().nonnegative(), duration: z.number().positive(), text: z.string(), style: paramsSchema.optional() }),
      execute: async ({ trackId, startTime, duration, text, style }) => executeEditorMutation("Add text clip", () => {
        const clip = useProjectStore.getState().createTextClip(trackId, startTime, text, duration, style as never);
        return { ok: Boolean(clip), data: clip, message: clip ? undefined : "Failed to create text clip" };
      }),
    }),

    add_shape_clip: tool({
      description: "Create a shape clip on a track.",
      inputSchema: z.object({ trackId: z.string(), startTime: z.number().nonnegative(), duration: z.number().positive(), shape: z.string(), style: paramsSchema.optional() }),
      execute: async ({ trackId, startTime, duration, shape, style }) => executeEditorMutation("Add shape clip", () => {
        const clip = useProjectStore.getState().createShapeClip(trackId, startTime, shape as never, duration, style as never);
        return { ok: Boolean(clip), data: clip, message: clip ? undefined : "Failed to create shape clip" };
      }),
    }),

    apply_effect: tool({
      description: "Add or replace a video/audio effect on a clip.",
      inputSchema: z.object({ clipId: z.string(), name: z.string(), params: paramsSchema.optional(), replace: z.boolean().optional() }),
      execute: async ({ clipId, name, params, replace }) => executeEditorMutation("Apply effect", async () => {
        const store = useProjectStore.getState();
        if (replace) {
          const clip = store.getClip(clipId);
          const matching = clip?.effects?.filter((effect) => effect.type === name) ?? [];
          for (const effect of matching) {
            const removed = await store.executeAction(makeAction("effect/remove", { clipId, effectId: effect.id }));
            if (!removed.success) return removed;
          }
        }
        return store.executeAction(makeAction("effect/add", { clipId, effectType: name, params }));
      }),
    }),

    apply_transition: tool({
      description: "Add or change a transition between adjacent clips.",
      inputSchema: z.object({ clipAId: z.string(), clipBId: z.string(), transitionType: z.string(), duration: z.number().positive(), params: paramsSchema.optional() }),
      execute: async ({ clipAId, clipBId, transitionType, duration, params }) => executeEditorMutation("Apply transition", async () => {
        const existing = useProjectStore.getState().getClipTransitionBetweenClips(clipAId, clipBId);
        if (existing) {
          return useProjectStore.getState().executeAction(makeAction("transition/update", { transitionId: existing.id, duration, params: { type: transitionType, ...params } }));
        }
        return useProjectStore.getState().executeAction(makeAction("transition/add", { clipAId, clipBId, transitionType, duration }));
      }),
    }),

    add_keyframe: tool({
      description: "Add a keyframe on a clip property.",
      inputSchema: z.object({ clipId: z.string(), property: z.string(), time: z.number().nonnegative(), value: z.unknown(), easing: z.string().optional() }),
      execute: async ({ clipId, property, time, value, easing }) => executeEditorMutation("Add keyframe", async () => {
        const result = await useProjectStore.getState().executeAction(makeAction("keyframe/add", { clipId, property, time, value }));
        if (!result.success || !easing) return result;
        return useProjectStore.getState().executeAction(makeAction("keyframe/update", { clipId, property, time, easing }));
      }),
    }),

    set_playback: tool({
      description: "Control playback: play, pause, stop, toggle, seek, rate, or loop.",
      inputSchema: z.object({ action: z.enum(["play", "pause", "stop", "toggle", "seek", "rate", "loop"]), time: z.number().nonnegative().optional(), rate: z.number().positive().optional(), start: z.number().nonnegative().optional(), end: z.number().nonnegative().optional() }),
      execute: async ({ action, time, rate, start, end }) => {
        const timeline = useTimelineStore.getState();
        if (action === "play") timeline.play();
        if (action === "pause") timeline.pause();
        if (action === "stop") timeline.stop();
        if (action === "toggle") timeline.togglePlayback();
        if (action === "seek") timeline.seekTo(time ?? 0);
        if (action === "rate") timeline.setPlaybackRate(rate ?? 1);
        if (action === "loop") {
          timeline.setLoopRange(start ?? 0, end ?? useProjectStore.getState().project.timeline.duration);
          timeline.setLoopEnabled(true);
        }
        return { ok: true, data: useTimelineStore.getState() };
      },
    }),

    set_selection: tool({
      description: "Select one or more clips/tracks by id, or clear selection.",
      inputSchema: z.object({ items: z.array(z.object({ id: z.string(), type: z.enum(["clip", "track", "effect", "keyframe", "marker", "text-clip", "shape-clip", "subtitle"]), trackId: z.string().optional() })).optional(), clear: z.boolean().optional() }),
      execute: async ({ items, clear }) => {
        const ui = useUIStore.getState();
        if (clear || !items || items.length === 0) ui.clearSelection();
        else ui.selectMultiple(items.map((item) => ({ id: item.id, type: item.type as SelectionType, trackId: item.trackId })));
        return { ok: true, data: useUIStore.getState().selectedItems };
      },
    }),

    export_project: tool({
      description: "Start an export when format/resolution are specified.",
      inputSchema: z.object({ format: z.string().optional(), resolution: z.string().optional(), preset: z.string().optional(), confirm: z.boolean().optional() }),
      execute: async ({ format, resolution, preset, confirm }) => {
        if (!format && !resolution && !preset && confirm !== true) {
          return { ok: false, needsConfirm: true, message: "Confirm export format/resolution first, or re-run with explicit export settings." };
        }
        return { ok: true, message: "Open the Export menu to choose the destination file; browser export requires a user file picker gesture.", data: { format, resolution, preset } };
      },
    }),

    save_project: tool({
      description: "Save the current project.",
      inputSchema: z.object({}),
      execute: async () => {
        const ok = await projectManager.saveProject(useProjectStore.getState().project);
        return { ok, message: ok ? "Project saved." : "Project save cancelled." };
      },
    }),

    list_projects: tool({
      description: "List recent projects.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, data: await projectManager.getRecentProjects() }),
    }),

    load_project: tool({
      description: "Open a project file. Requires confirm:true when the current project has content.",
      inputSchema: z.object({ confirm: z.boolean().optional() }),
      execute: async ({ confirm }) => {
        if (projectHasContent() && confirm !== true) {
          return { ok: false, needsConfirm: true, message: "Current project has content. Re-run with confirm:true to open another project." };
        }
        const project = await projectManager.openProject();
        if (!project) return { ok: false, message: "Project open cancelled." };
        useProjectStore.getState().loadProject(project);
        return { ok: true, data: { id: project.id, name: project.name } };
      },
    }),

    new_project: tool({
      description: "Create a new project. Requires confirm:true when the current project has content.",
      inputSchema: z.object({ name: z.string().optional(), confirm: z.boolean().optional() }),
      execute: async ({ name, confirm }) => {
        if (projectHasContent() && confirm !== true) {
          return { ok: false, needsConfirm: true, message: "Current project has content. Re-run with confirm:true to create a new project." };
        }
        useProjectStore.getState().createNewProject(name);
        return { ok: true, data: { name: useProjectStore.getState().project.name } };
      },
    }),

    undo: tool({
      description: "Undo the previous editor action.",
      inputSchema: z.object({}),
      execute: async () => actionResult(await useProjectStore.getState().undo(), "Undo"),
    }),

    redo: tool({
      description: "Redo the next editor action.",
      inputSchema: z.object({}),
      execute: async () => actionResult(await useProjectStore.getState().redo(), "Redo"),
    }),

    run_editor_action: tool({
      description: "Escape hatch: dispatch any registered TimelineAction by actionType and params.",
      inputSchema: z.object({ actionType: z.string(), params: paramsSchema }),
      execute: async ({ actionType, params }) => {
        const parsed = actionTypeSchema.safeParse(actionType);
        if (!parsed.success) {
          return { ok: false, message: `Unknown actionType '${actionType}'. Did you mean '${suggestActionType(actionType)}'?` };
        }
        const type = parsed.data as TimelineAction["type"] & EditorActionType;
        return executeEditorMutation(`Run ${type}`, async () => useProjectStore.getState().executeAction(makeAction(type, params)));
      },
    }),
  };
}
