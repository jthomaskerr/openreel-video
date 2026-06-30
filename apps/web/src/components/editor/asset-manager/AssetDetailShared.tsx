import { useId, useState, useCallback, type KeyboardEvent, type ReactNode } from "react";
import type { MediaItem } from "@openreel/core";
import { Input, Button, Label } from "@openreel/ui";
import { RefreshCw, X, Check, ImageIcon, Film, Music, Download, Trash2 } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

// ── Metadata Editor ────────────────────────────────────────────────

export interface MetadataEditorProps {
  item: MediaItem;
  onSaved: () => void;
}

export function MetadataEditor({ item, onSaved }: MetadataEditorProps) {
  const updateMeta = useProjectStore((s) => s.updateMediaMetadata);
  const replaceMediaAsset = useProjectStore((s) => s.replaceMediaAsset);
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const freshItem = mediaItems.find((m) => m.id === item.id) ?? item;

  const [title, setTitle] = useState(freshItem.title ?? "");
  const [description, setDescription] = useState(freshItem.description ?? "");
  const [tags, setTags] = useState<string[]>(freshItem.tags ?? []);
  const [group, setGroup] = useState(freshItem.group ?? "");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const hasChanges =
    title !== (freshItem.title ?? "") ||
    description !== (freshItem.description ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(freshItem.tags ?? []) ||
    group !== (freshItem.group ?? "");

  const save = useCallback(async () => {
    setSaving(true);
    await updateMeta(freshItem.id, {
      title: title || undefined,
      description: description || undefined,
      tags: tags.length > 0 ? tags : undefined,
      group: group || undefined,
    });
    setSaving(false);
    onSaved();
  }, [freshItem.id, title, description, tags, group, updateMeta, onSaved]);

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag();
      } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
        removeTag(tags[tags.length - 1]);
      }
    },
    [addTag, removeTag, tagInput, tags],
  );

  const linkFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*,image/*";
    input.style.display = "none";
    input.onchange = async (event) => {
      try {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const result = await replaceMediaAsset(freshItem.id, file);
        if (result.success) {
          toast.success("File linked", `Replaced with ${file.name}`);
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
  }, [freshItem.id, replaceMediaAsset]);

  const groupOptions = Array.from(
    new Set(mediaItems.map((m) => m.group).filter((g): g is string => !!g && g !== freshItem.group)),
  ).sort();

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-text-secondary">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={freshItem.name}
          className="text-xs h-9"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-text-secondary">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description..."
          className="text-xs h-9"
        />
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-text-secondary">Tags</Label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-red-400 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="Add tag..."
            className="text-xs h-8 flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={addTag}
            disabled={!tagInput.trim()}
            className="text-xs h-8"
          >
            Add
          </Button>
        </div>
      </div>

      {/* Group */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-text-secondary">Group</Label>
        <Input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="e.g. B-Roll, Interviews..."
          className="text-xs h-9"
          list="group-options"
        />
        {groupOptions.length > 0 && (
          <datalist id="group-options">
            {groupOptions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        )}
      </div>

      {/* Missing file banner */}
      {freshItem.isPlaceholder && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2">
          <div>
            <Label className="text-[11px] text-yellow-400">Missing File</Label>
            <p className="mt-1 text-[10px] text-text-muted">
              This imported clip is a placeholder. Link the original file to restore preview and playback.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={linkFile} className="h-8 text-xs">
            <RefreshCw size={13} className="mr-2" />
            Link File…
          </Button>
        </div>
      )}

      {/* Save actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button size="sm" onClick={save} disabled={!hasChanges || saving} className="text-xs">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── File Info Grid ──────────────────────────────────────────────────

export interface InfoRow {
  label: string;
  value: string;
}

export function FileInfoGrid({ rows }: { rows: InfoRow[] }) {
  return (
    <div className="space-y-1 pt-2 border-t border-border">
      <Label className="text-[11px] text-text-muted">File Information</Label>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-text-secondary">
        {rows.map((r) => (
          <FileInfoRow key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </div>
  );
}

function FileInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="truncate">{value}</span>
    </>
  );
}

// ── Type-Specific Section ───────────────────────────────────────────

export function TypeSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <h3 id={headingId} className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{title}</h3>
      {children}
    </section>
  );
}

export function TypeDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 text-[10px]">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary truncate">{value}</span>
    </div>
  );
}

// ── Generation Info ─────────────────────────────────────────────────

export function GenerationInfo({ item }: { item: MediaItem }) {
  if (!item.generationMeta) return null;

  return (
    <TypeSection title="Generated Asset">
      <TypeDetailRow label="Provider" value={item.generationMeta.provider} />
      <TypeDetailRow label="Model" value={item.generationMeta.model} />
      <TypeDetailRow label="Status" value={item.generationMeta.status ?? "generated"} />
      {item.generationMeta.prompt && (
        <TypeDetailRow label="Prompt" value={item.generationMeta.prompt} />
      )}
      {item.generationMeta.negativePrompt && (
        <TypeDetailRow label="Negative Prompt" value={item.generationMeta.negativePrompt} />
      )}
    </TypeSection>
  );
}

// ── Version List ────────────────────────────────────────────────────

export function VersionList({ item }: { item: MediaItem }) {
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  const setCurrentVersion = useProjectStore((s) => s.setCurrentAssetVersion);
  const freshItem = mediaItems.find((m) => m.id === item.id) ?? item;
  const assetGroupId = freshItem.assetGroupId ?? freshItem.id;

  const versions = mediaItems.filter(
    (m) => (m.assetGroupId ?? m.id) === assetGroupId,
  );

  const sorted = [...versions].sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return (b.metadata?.fileSize ?? 0) - (a.metadata?.fileSize ?? 0);
  });


  return (
    <div className="space-y-2">
      <Label className="text-[11px] text-text-muted">Versions ({versions.length})</Label>
      <div className="space-y-1.5">
        {sorted.map((v) => (
          <div
            key={v.id}
            className={`flex items-center gap-3 rounded-lg border p-2 ${
              v.isCurrent ? "border-primary/40 bg-primary/5" : "border-border bg-background-secondary"
            }`}
          >
            {/* Thumbnail */}
            <div className="w-12 h-8 rounded bg-background-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
              {v.thumbnailUrl ? (
                <img src={v.thumbnailUrl} alt={v.name} className="w-full h-full object-cover" />
              ) : (
                <AssetTypeIcon type={v.type} />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate flex items-center gap-1.5">
                {v.title || v.name}
                {v.isCurrent && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold flex-shrink-0">
                    CURRENT
                  </span>
                )}
              </div>
              <div className="text-[9px] text-text-muted">
                {v.metadata?.width && v.metadata?.height
                  ? `${v.metadata.width}×${v.metadata.height}`
                  : ""}
                {v.metadata?.fileSize ? ` · ${formatSize(v.metadata.fileSize)}` : ""}
              </div>
            </div>

            {/* Promote action */}
            {!v.isCurrent && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentVersion(v.id)}
                className="h-7 text-[10px] flex-shrink-0"
              >
                <Check size={12} className="mr-1" />
                Set Current
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Asset Actions Bar ───────────────────────────────────────────────

export interface AssetActionsProps {
  item: MediaItem;
  onReplace: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  onAddToTimeline?: () => void;
}

export function AssetActions({ item, onReplace, onDelete, onDownload, onAddToTimeline }: AssetActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
      {onAddToTimeline && (
        <Button size="sm" variant="outline" onClick={onAddToTimeline} className="text-xs h-8">
          Add to Timeline
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onReplace} className="text-xs h-8">
        <RefreshCw size={12} className="mr-1.5" />
        Replace
      </Button>
      {item.blob && onDownload && (
        <Button size="sm" variant="outline" onClick={onDownload} className="text-xs h-8">
          <Download size={12} className="mr-1.5" />
          Download
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={onDelete}
        className="text-xs h-8 text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50"
      >
        <Trash2 size={12} className="mr-1.5" />
        Delete
      </Button>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function AssetTypeIcon({ type }: { type: MediaItem["type"] }) {
  const size = 14;
  switch (type) {
    case "video":
      return <Film size={size} className="text-text-muted" />;
    case "audio":
      return <Music size={size} className="text-text-muted" />;
    case "image":
      return <ImageIcon size={size} className="text-text-muted" />;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
