import type { MediaItem, ReferenceTarget } from "@openreel/core";

import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";

export type ReferenceEditorPlacement = "modal" | "inspector";

export type ReferenceEditorIssueCode =
  | "UNRESOLVED_REFERENCE"
  | "CHARACTER_CLIP_NOT_FOUND"
  | "MEDIA_NOT_FOUND"
  | "DEFINITION_NOT_FOUND"
  | "DEFINITION_MEDIA_NOT_FOUND";

export interface ReferenceEditorIssue {
  readonly code: ReferenceEditorIssueCode;
  readonly message: string;
  readonly details: Record<string, string>;
}

export type ReferenceEditorRoute =
  | {
      readonly editor: "character";
      readonly title: string;
      readonly target: Extract<ReferenceTarget, { kind: "character" }>;
      readonly characterId: string;
      readonly clipId: string;
      readonly trackId: string;
    }
  | {
      readonly editor: "imported-image";
      readonly title: string;
      readonly target: Extract<ReferenceTarget, { kind: "imported-image" }>;
      readonly mediaId: string;
    }
  | {
      readonly editor: "generated-image";
      readonly title: string;
      readonly target:
        | Extract<ReferenceTarget, { kind: "generated-image" }>
        | Extract<ReferenceTarget, { kind: "imported-image" }>;
      readonly definitionId: string;
      readonly mediaId: string;
    }
  | {
      readonly editor: "missing";
      readonly title: string;
      readonly target: ReferenceTarget;
      readonly issue: ReferenceEditorIssue;
    };

type ReferenceClip = {
  readonly id: string;
  readonly type?: string;
  readonly metadata?: Record<string, unknown> | null;
};

type ReferenceTrack = {
  readonly id: string;
  readonly clips?: readonly ReferenceClip[];
};

type GeneratedImageDefinitionLike = {
  readonly id: string;
  readonly currentMediaVersionId?: string | null;
};

export interface ReferenceNavigationSnapshot {
  readonly project: {
    readonly timeline?: {
      readonly tracks?: readonly ReferenceTrack[];
    };
    readonly generatedImageDefinitions?: readonly GeneratedImageDefinitionLike[];
  };
  readonly getMediaItem: (mediaId: string) => MediaItem | undefined;
}

const MODAL_ID = "reference-editor";
const MODAL_ROUTE_KEY = "referenceEditorRoute";

let modalInvoker: HTMLElement | null = null;

function missingRoute(
  target: ReferenceTarget,
  issue: ReferenceEditorIssue,
): ReferenceEditorRoute {
  return {
    editor: "missing",
    title: "Reference unavailable",
    target,
    issue,
  };
}

function definitionForMedia(
  snapshot: ReferenceNavigationSnapshot,
  mediaId: string,
): GeneratedImageDefinitionLike | undefined {
  return snapshot.project.generatedImageDefinitions?.find(
    (definition) => definition.currentMediaVersionId === mediaId,
  );
}

function characterClipForId(
  snapshot: ReferenceNavigationSnapshot,
  characterId: string,
): { readonly clipId: string; readonly trackId: string } | undefined {
  for (const track of snapshot.project.timeline?.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.type !== "metadata") continue;
      const metadata =
        clip.metadata && typeof clip.metadata === "object" ? clip.metadata : null;
      if (metadata?.kind !== "character") continue;
      if (metadata.characterId === characterId) {
        return { clipId: clip.id, trackId: track.id };
      }
    }
  }

  return undefined;
}

export function referencePlacementFromEvent(event?: {
  readonly shiftKey?: boolean;
}): ReferenceEditorPlacement {
  return event?.shiftKey ? "inspector" : "modal";
}

export function rememberReferenceInvoker(target: EventTarget | null | undefined): void {
  if (typeof HTMLElement === "undefined") return;
  modalInvoker = target instanceof HTMLElement ? target : null;
}

export function restoreReferenceInvoker(): void {
  modalInvoker?.focus();
  modalInvoker = null;
}

export function clearReferenceInvoker(): void {
  modalInvoker = null;
}

export function readReferenceEditorRouteFromModalData(
  modalData: Record<string, unknown> | null,
): ReferenceEditorRoute | null {
  const candidate = modalData?.[MODAL_ROUTE_KEY];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const route = candidate as Partial<ReferenceEditorRoute>;
  if (
    route.editor === "character" ||
    route.editor === "imported-image" ||
    route.editor === "generated-image" ||
    route.editor === "missing"
  ) {
    return route as ReferenceEditorRoute;
  }

  return null;
}

export function resolveReferenceEditorRoute(
  snapshot: ReferenceNavigationSnapshot,
  target: ReferenceTarget,
): ReferenceEditorRoute {
  if (target.kind === "missing") {
    return missingRoute(target, {
      code: "UNRESOLVED_REFERENCE",
      message: "The referenced item is no longer available in this draft.",
      details: { token: target.token },
    });
  }

  if (target.kind === "character") {
    const clip = characterClipForId(snapshot, target.id);
    if (!clip) {
      return missingRoute(target, {
        code: "CHARACTER_CLIP_NOT_FOUND",
        message: "The referenced character no longer has an editable character clip.",
        details: { characterId: target.id },
      });
    }

    return {
      editor: "character",
      title: "Character editor",
      target,
      characterId: target.id,
      clipId: clip.clipId,
      trackId: clip.trackId,
    };
  }

  if (target.kind === "generated-image") {
    const definition = snapshot.project.generatedImageDefinitions?.find(
      (entry) => entry.id === target.definitionId,
    );
    if (!definition) {
      return missingRoute(target, {
        code: "DEFINITION_NOT_FOUND",
        message: "The referenced generated image definition no longer exists.",
        details: { definitionId: target.definitionId },
      });
    }

    const mediaId = definition.currentMediaVersionId;
    if (!mediaId || !snapshot.getMediaItem(mediaId)) {
      return missingRoute(target, {
        code: "DEFINITION_MEDIA_NOT_FOUND",
        message:
          "The referenced generated image exists, but its current media version is unavailable.",
        details: {
          definitionId: target.definitionId,
          ...(mediaId ? { mediaId } : {}),
        },
      });
    }

    return {
      editor: "generated-image",
      title: "Generated image editor",
      target,
      definitionId: definition.id,
      mediaId,
    };
  }

  const generatedDefinition = definitionForMedia(snapshot, target.mediaId);
  if (generatedDefinition) {
    return {
      editor: "generated-image",
      title: "Generated image editor",
      target,
      definitionId: generatedDefinition.id,
      mediaId: target.mediaId,
    };
  }

  const media = snapshot.getMediaItem(target.mediaId);
  if (!media) {
    return missingRoute(target, {
      code: "MEDIA_NOT_FOUND",
      message: "The referenced image is no longer available in the project.",
      details: { mediaId: target.mediaId },
    });
  }

  return {
    editor: "imported-image",
    title: "Image inspector",
    target,
    mediaId: media.id,
  };
}

export function openReferenceTarget(
  target: ReferenceTarget,
  placement: ReferenceEditorPlacement,
  options: { readonly invoker?: EventTarget | null } = {},
): ReferenceEditorRoute {
  const projectStore = useProjectStore.getState();
  const route = resolveReferenceEditorRoute(
    {
      project: projectStore.project,
      getMediaItem: projectStore.getMediaItem,
    },
    target,
  );
  const ui = useUIStore.getState();

  if (placement === "modal") {
    rememberReferenceInvoker(options.invoker);
    ui.openModal(MODAL_ID, {
      [MODAL_ROUTE_KEY]: route,
    });
    return route;
  }

  clearReferenceInvoker();
  ui.closeModal();
  ui.clearSelection();
  ui.setInspectedAsset(null);
  ui.setInspectorSelection(null);
  ui.setReferenceEditorInspectorRoute(route);
  ui.setSidebarTab("edit");
  return route;
}
