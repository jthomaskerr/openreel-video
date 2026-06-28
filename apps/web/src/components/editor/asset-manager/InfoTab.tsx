import { useState, useCallback, type KeyboardEvent } from "react";
import type { MediaItem } from "@openreel/core";
import { Input, Button, Label } from "@openreel/ui";
import { X } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";

interface InfoTabProps {
  item: MediaItem;
  onClose: () => void;
}

export function InfoTab({ item, onClose }: InfoTabProps) {
  const updateMeta = useProjectStore((s) => s.updateMediaMetadata);
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);
  // Re-read fresh item data (may have been updated by sibling dialogs)
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
    onClose();
  }, [freshItem.id, title, description, tags, group, updateMeta, onClose]);

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

  // Gather unique existing groups for autocomplete
  const groupOptions = Array.from(
    new Set(mediaItems.map((m) => m.group).filter((g): g is string => !!g && g !== freshItem.group)),
  ).sort();

  return (
    <div className="space-y-4 px-1">
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

      {/* Asset info (read-only) */}
      <div className="space-y-1 pt-2 border-t border-border">
        <Label className="text-[11px] text-text-muted">File Information</Label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-text-secondary">
          <span className="text-text-muted">Filename</span>
          <span className="truncate">{freshItem.name}</span>
          <span className="text-text-muted">Type</span>
          <span>{freshItem.type}</span>
          {freshItem.metadata?.width && (
            <>
              <span className="text-text-muted">Resolution</span>
              <span>{freshItem.metadata.width}×{freshItem.metadata.height}</span>
            </>
          )}
          {freshItem.metadata?.duration ? (
            <>
              <span className="text-text-muted">Duration</span>
              <span>{freshItem.metadata.duration.toFixed(1)}s</span>
            </>
          ) : null}
          {freshItem.metadata?.fileSize ? (
            <>
              <span className="text-text-muted">Size</span>
              <span>{formatSize(freshItem.metadata.fileSize)}</span>
            </>
          ) : null}
          {freshItem.assetGroupId && (
            <>
              <span className="text-text-muted">Versions</span>
              <span>
                {mediaItems.filter((m) => (m.assetGroupId ?? m.id) === (freshItem.assetGroupId ?? freshItem.id)).length}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!hasChanges || saving} className="text-xs">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}