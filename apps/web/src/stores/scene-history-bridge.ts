export const SCENE_HISTORY_ACTION = "scene/compound";

type SceneHistoryDirection = "undo" | "redo";
type SceneHistoryAdapter = (payload: unknown, direction: SceneHistoryDirection) => boolean;

let adapter: SceneHistoryAdapter | undefined;

export function registerSceneHistoryAdapter(nextAdapter: SceneHistoryAdapter): void {
  adapter = nextAdapter;
}

export function applySceneHistoryEntry(payload: unknown, direction: SceneHistoryDirection): boolean {
  return adapter?.(payload, direction) ?? false;
}
