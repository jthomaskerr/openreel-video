import {
  AlertTriangle,
  Image as ImageIcon,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";

import { useProjectStore } from "../../../stores/project-store";
import {
  restoreReferenceInvoker,
  type ReferenceEditorRoute,
  resolveReferenceEditorRoute,
} from "../../../features/references/navigation";
import { AssetInspectorWithTabs } from "../inspector/AssetInspectorWithTabs";
import { ProjectGeneratedImageEditor } from "../generate/ProjectGeneratedImageEditor";
import { CharacterMetadataInspector } from "../inspector/CharacterMetadataInspector";

interface ReferenceEditorContentProps {
  readonly route: ReferenceEditorRoute;
  readonly placement: "modal" | "inspector";
}

type MissingReferenceEditorRoute = Extract<
  ReferenceEditorRoute,
  { editor: "missing" }
>;

function iconForRoute(editor: ReferenceEditorRoute["editor"]) {
  switch (editor) {
    case "character":
      return UserRound;
    case "generated-image":
      return Sparkles;
    case "imported-image":
      return ImageIcon;
    case "missing":
    default:
      return AlertTriangle;
  }
}

function missingRoute(
  target: ReferenceEditorRoute["target"],
  issue: MissingReferenceEditorRoute["issue"],
): MissingReferenceEditorRoute {
  return {
    editor: "missing",
    title: "Reference unavailable",
    target,
    issue,
  };
}

function ReferenceRecoveryView({
  route,
}: {
  readonly route: MissingReferenceEditorRoute;
}) {
  return (
    <div
      role="status"
      className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"
    >
      <p>{route.issue.message}</p>
      <div className="rounded-lg bg-black/15 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
          {route.issue.code}
        </p>
        <dl className="mt-2 space-y-1 text-xs text-amber-100/90">
          {Object.entries(route.issue.details).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="min-w-[88px] font-medium">
                {key.replace(/([A-Z])/g, " $1")}
              </dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function ReferenceEditorContent({
  route,
  placement,
}: ReferenceEditorContentProps) {
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const project = useProjectStore((state) => state.project);
  const liveRoute =
    route.editor === "missing"
      ? route
      : resolveReferenceEditorRoute({ project, getMediaItem }, route.target);

  if (liveRoute.editor === "character") {
    const clip = tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === liveRoute.clipId);

    if (!clip) {
      return (
        <ReferenceRecoveryView
          route={missingRoute(liveRoute.target, {
            code: "CHARACTER_CLIP_NOT_FOUND",
            message:
              "The referenced character no longer has an editable character clip.",
            details: { characterId: liveRoute.characterId },
          })}
        />
      );
    }

    return <CharacterMetadataInspector clip={clip} />;
  }

  if (liveRoute.editor === "missing") {
    return <ReferenceRecoveryView route={liveRoute} />;
  }

  const mediaItem = getMediaItem(liveRoute.mediaId);
  if (!mediaItem) {
    return (
      <ReferenceRecoveryView
        route={
          liveRoute.editor === "generated-image"
            ? missingRoute(liveRoute.target, {
                code: "DEFINITION_MEDIA_NOT_FOUND",
                message:
                  "The referenced generated image exists, but its current media version is unavailable.",
                details: {
                  definitionId: liveRoute.definitionId,
                  mediaId: liveRoute.mediaId,
                },
              })
            : missingRoute(liveRoute.target, {
                code: "MEDIA_NOT_FOUND",
                message:
                  "The referenced image is no longer available in the project.",
                details: { mediaId: liveRoute.mediaId },
              })
        }
      />
    );
  }

  if (liveRoute.editor === "generated-image") {
    return (
      <ProjectGeneratedImageEditor
        definitionId={liveRoute.definitionId}
        placement={placement}
      />
    );
  }

  return (
    <div data-reference-editor-placement={placement}>
      <AssetInspectorWithTabs item={mediaItem} />
    </div>
  );
}

export interface ReferenceEditorModalProps {
  readonly open: boolean;
  readonly route: ReferenceEditorRoute | null;
  readonly onClose: () => void;
}

export function ReferenceEditorModal({
  open,
  route,
  onClose,
}: ReferenceEditorModalProps) {
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const project = useProjectStore((state) => state.project);
  if (!route) return null;

  const liveRoute =
    route.editor === "missing"
      ? route
      : resolveReferenceEditorRoute({ project, getMediaItem }, route.target);

  const Icon = iconForRoute(liveRoute.editor);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        onClose();
        globalThis.setTimeout(() => {
          restoreReferenceInvoker();
        }, 0);
      }}
    >
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border bg-background-secondary p-0">
        <DialogHeader className="space-y-0 border-b border-border bg-background-secondary/80 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <DialogTitle>{liveRoute.title}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-text-secondary">
                Opened from a prompt mention or reference card.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto">
          <ReferenceEditorContent route={route} placement="modal" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
