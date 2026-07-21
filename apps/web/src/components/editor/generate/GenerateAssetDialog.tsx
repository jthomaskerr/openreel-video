import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import type { GeneratedAsset, StoryboardShot } from "@openreel/music-video-domain";
import { useEffect, useMemo, useRef, useState } from "react";

import { useProjectStore } from "../../../stores/project-store";
import { ProjectGeneratedImageEditor } from "./ProjectGeneratedImageEditor";

export interface GenerateAssetDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Existing definition to edit. When omitted, the shell resolves or creates one. */
  readonly definitionId?: string;
  /** Imported media to convert into a generated-image definition before editing. */
  readonly sourceMediaId?: string;
  /** Retained for compatibility with existing launchers while generation moves to definitions. */
  readonly sourceFile?: File;
  readonly previewUrl?: string | null;
  readonly asset?: GeneratedAsset;
  readonly shot?: StoryboardShot;
  readonly clipId?: string;
}

function promptFromClip(
  tracks: readonly { readonly clips?: readonly { readonly id: string; readonly metadata?: unknown }[] }[],
  clipId: string | undefined,
): string | undefined {
  if (!clipId) return undefined;
  const clip = tracks.flatMap((track) => track.clips ?? []).find((candidate) => candidate.id === clipId);
  if (!clip?.metadata || typeof clip.metadata !== "object") return undefined;
  const metadata = clip.metadata as Record<string, unknown>;
  const payload =
    metadata.payload && typeof metadata.payload === "object"
      ? (metadata.payload as Record<string, unknown>)
      : metadata;
  for (const key of ["prompt", "text", "videoPrompt"] as const) {
    if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
  }
  return undefined;
}

export function GenerateAssetDialog({
  open,
  onClose,
  definitionId,
  sourceMediaId,
  asset,
  shot,
  clipId,
}: GenerateAssetDialogProps) {
  const createGeneratedImage = useProjectStore((state) => state.createGeneratedImage);
  const convertImportedImage = useProjectStore((state) => state.convertImportedImage);
  const updateGeneratedImageDraft = useProjectStore((state) => state.updateGeneratedImageDraft);
  const [resolvedDefinitionId, setResolvedDefinitionId] = useState<string | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const definitionPromiseRef = useRef<Promise<string> | null>(null);

  const initialPrompt = useMemo(
    () =>
      asset?.prompt?.trim() ||
      shot?.videoPrompt?.trim() ||
      shot?.prompt?.trim(),
    [asset?.prompt, shot?.prompt, shot?.videoPrompt],
  );

  useEffect(() => {
    if (!open) {
      setResolvedDefinitionId(null);
      setPreparationError(null);
      definitionPromiseRef.current = null;
      return;
    }
    if (resolvedDefinitionId) return;

    let active = true;
    const resolveDefinition = async () => {
      const currentProject = useProjectStore.getState().project;
      let nextDefinitionId = definitionId;

      if (!nextDefinitionId && sourceMediaId) {
        const source = currentProject.mediaLibrary.items.find((item) => item.id === sourceMediaId);
        const assetGroupId = source?.assetGroupId ?? sourceMediaId;
        nextDefinitionId = currentProject.generatedImageDefinitions.find(
          (definition) => definition.assetGroupId === assetGroupId,
        )?.id;
        if (!nextDefinitionId) {
          const result = await convertImportedImage({ mediaId: sourceMediaId });
          if (!result.success || !result.definitionId) {
            throw new Error(
              result.error?.message ?? "The source image could not be prepared for generation.",
            );
          }
          nextDefinitionId = result.definitionId;
        }
      }

      if (!nextDefinitionId) {
        const result = await createGeneratedImage({ title: "Generated Image" });
        if (!result.success || !result.definitionId) {
          throw new Error(result.error?.message ?? "The generated image could not be created.");
        }
        nextDefinitionId = result.definitionId;
      }

      return nextDefinitionId;
    };

    const prepare = async () => {
      setPreparationError(null);
      definitionPromiseRef.current ??= resolveDefinition();
      const nextDefinitionId = await definitionPromiseRef.current;
      const prompt =
        initialPrompt ||
        promptFromClip(useProjectStore.getState().project.timeline.tracks, clipId);

      if (prompt) {
        const update = await updateGeneratedImageDraft({
          definitionId: nextDefinitionId,
          patch: { prompt },
        });
        if (!update.success) {
          throw new Error(update.error?.message ?? "The initial prompt could not be saved.");
        }
      }
      if (active) setResolvedDefinitionId(nextDefinitionId);
    };

    void prepare().catch((error: unknown) => {
      if (active) {
        setPreparationError(
          error instanceof Error ? error.message : "The image editor could not be prepared.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [
    convertImportedImage,
    createGeneratedImage,
    clipId,
    definitionId,
    initialPrompt,
    open,
    resolvedDefinitionId,
    sourceMediaId,
    updateGeneratedImageDraft,
  ]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[min(94vw,56rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Generate image</DialogTitle>
          <DialogDescription className="sr-only">
            Configure a generated image, its model, prompt, references, and parameters.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {preparationError ? (
            <div
              role="alert"
              className="m-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
            >
              Image editor could not be prepared: {preparationError}
            </div>
          ) : resolvedDefinitionId ? (
            <ProjectGeneratedImageEditor definitionId={resolvedDefinitionId} placement="modal" />
          ) : (
            <div role="status" className="p-4 text-sm text-text-secondary">
              Preparing image editor…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default GenerateAssetDialog;
