import { useCallback, useMemo, useState } from "react";
import type { Clip, MediaItem } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { ImagePlus, ExternalLink, Wand2 } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";

interface ReferenceImagesProps {
  clip: Clip;
  title?: string;
  metadataKey?: string;
  urlKeys?: string[];
  assetIdKeys?: string[];
}

interface ReferenceImageEntry {
  id: string;
  label: string;
  url: string | null;
  mediaItem: MediaItem | null;
}

export function ReferenceImages({
  clip,
  title = "Reference Images",
  metadataKey = "referenceImageUrls",
  urlKeys = ["referenceImageUrls", "characterImageUrls", "trainingImageUrls", "referenceImageUrl", "thumbnailUrl"],
  assetIdKeys = ["referenceAssetIds", "linkedGeneratedAssetIds"],
}: ReferenceImagesProps) {
  const project = useProjectStore((s) => s.project);
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);

  const payload = useMemo(() => {
    const merged: Record<string, unknown> = clip.metadata ? { ...clip.metadata } : {};
    const nestedPayload = clip.metadata?.payload;
    if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
      Object.assign(merged, nestedPayload);
    }
    return merged;
  }, [clip.metadata]);

  const entries = useMemo(() => {
    const refs: ReferenceImageEntry[] = [];
    const seen = new Set<string>();

    for (const key of urlKeys) {
      for (const url of readStringList(payload[key])) {
        if (seen.has(url)) continue;
        seen.add(url);
        refs.push({ id: url, label: key, url, mediaItem: null });
      }
    }

    for (const key of assetIdKeys) {
      for (const assetId of readStringList(payload[key])) {
        if (seen.has(assetId)) continue;
        const mediaItem = project.mediaLibrary.items.find((item) => item.id === assetId) ?? null;
        seen.add(assetId);
        refs.push({
          id: assetId,
          label: mediaItem?.name ?? assetId,
          url: mediaItem?.thumbnailUrl ?? mediaItem?.originalUrl ?? null,
          mediaItem,
        });
      }
    }

    return refs;
  }, [assetIdKeys, payload, project.mediaLibrary.items, urlKeys]);

  const [value, setValue] = useState(() => readStringList(payload[metadataKey]).join("\n"));

  const save = useCallback(() => {
    const urls = value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    updateClipMetadata(clip.id, {
      [metadataKey]: urls,
      payload: { ...payload, [metadataKey]: urls },
    });
  }, [clip.id, metadataKey, payload, updateClipMetadata, value]);

  const openGenerate = useCallback(() => {
    window.dispatchEvent(new CustomEvent("openreel:open-generate-asset-dialog", { detail: { clipId: clip.id } }));
  }, [clip.id]);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background-secondary/40 p-2" data-testid="reference-images">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          <ImagePlus size={12} />
          <span>{title}</span>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={openGenerate}>
          <Wand2 size={10} className="mr-1" />
          Generate
        </Button>
      </div>

      {entries.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {entries.map((entry) => (
            <a
              key={entry.id}
              href={entry.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-md border border-border bg-background-tertiary"
              title={entry.label}
            >
              {entry.url ? (
                <img src={entry.url} alt={entry.label} className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square w-full bg-background flex items-center justify-center text-[9px] text-text-muted px-1 text-center">
                  No image
                </div>
              )}
              <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-text-muted truncate">
                <span className="truncate">{entry.label}</span>
                {entry.url && <ExternalLink size={8} className="shrink-0 opacity-60 group-hover:opacity-100" />}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="rounded border border-dashed border-border px-2 py-3 text-center text-[10px] text-text-muted">
          No reference images attached.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-[10px] text-text-muted">URLs or asset IDs, one per line</p>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
          }}
          placeholder="https://… or media asset ID"
          className="text-xs"
        />
      </div>
    </div>
  );
}

function readStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return [];
}
