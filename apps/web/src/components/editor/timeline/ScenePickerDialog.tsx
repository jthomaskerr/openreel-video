import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@openreel/ui";

export interface ScenePickerItem {
  id: string;
  label: string;
  prompt?: string;
}

export interface ScenePickerDialogProps {
  open: boolean;
  title: string;
  scenes: readonly ScenePickerItem[];
  currentSceneId?: string;
  onSelect: (sceneId: string) => void;
  onCancel: () => void;
}

export function ScenePickerDialog({
  open,
  title,
  scenes,
  currentSceneId,
  onSelect,
  onCancel,
}: ScenePickerDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filteredScenes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return scenes;
    return scenes.filter((scene) =>
      `${scene.label} ${scene.prompt ?? ""}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, scenes]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose the scene to associate with this timeline clip.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-sm">
          <span className="text-text-secondary">Search scenes</span>
          <Input
            aria-label="Search scenes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </label>
        <div
          className="max-h-72 space-y-1 overflow-y-auto"
          role="listbox"
          aria-label="Scenes"
        >
          {filteredScenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              role="option"
              aria-selected={scene.id === currentSceneId}
              className="w-full rounded-md px-3 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => onSelect(scene.id)}
            >
              <span className="block text-sm font-medium">{scene.label || "Untitled scene"}</span>
              {scene.prompt && (
                <span className="block truncate text-xs text-text-muted">{scene.prompt}</span>
              )}
            </button>
          ))}
          {filteredScenes.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-text-muted">
              No matching scenes.
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
