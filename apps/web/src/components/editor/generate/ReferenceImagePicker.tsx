import { useState } from "react";
import { Plus, X, Upload, FolderOpen, Wand2 } from "lucide-react";
import type { MediaItem } from "@openreel/core";

export interface ReferenceImagePickerProps {
  /** All media items in the project library */
  mediaItems: MediaItem[];
  /** IDs of currently selected reference images */
  selectedIds: string[];
  /** Called when selection changes (toggle/add via picker) */
  onChange: (ids: string[]) => void;
  /** Called when user uploads a new file */
  onUpload?: (file: File) => void;
  /** Called when user wants to generate a reference image */
  onRequestGenerate?: () => void;
}

function ImageThumb({ item }: { item: MediaItem }) {
  const url = item.thumbnailUrl ?? item.originalUrl;
  if (url) {
    return <img src={url} alt={item.title || item.name} className="w-full h-full object-cover rounded" />;
  }
  return (
    <div className="w-full h-full rounded bg-background-tertiary flex items-center justify-center">
      <span className="text-[10px] text-text-muted truncate px-1">{item.title || item.name}</span>
    </div>
  );
}

export function ReferenceImagePicker({
  mediaItems,
  selectedIds,
  onChange,
  onUpload,
  onRequestGenerate,
}: ReferenceImagePickerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const imageItems = mediaItems.filter((item) => item.type === "image");
  const selectedItems = selectedIds
    .map((id) => imageItems.find((item) => item.id === id))
    .filter((item): item is MediaItem => !!item);

  const remove = (id: string) => {
    onChange(selectedIds.filter((s) => s !== id));
  };

  const addFromLibrary = (id: string) => {
    if (!selectedIds.includes(id)) {
      onChange([...selectedIds, id]);
    }
    setAddOpen(false);
  };

  const unselectedLibrary = imageItems.filter(
    (item) => !selectedIds.includes(item.id),
  );

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-text-primary">
          Reference Images
          {selectedIds.length > 0 && (
            <span className="ml-1 text-[10px] text-text-muted font-normal">
              ({selectedIds.length})
            </span>
          )}
        </h4>

        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen(!addOpen)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-background-tertiary text-text-secondary hover:text-text-primary"
          >
            <Plus size={12} />
            Add
          </button>

          {addOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg border border-border bg-background shadow-lg py-1">
                {/* Browse library */}
                {unselectedLibrary.length > 0 && (
                  <div className="px-2 py-1">
                    <p className="text-[9px] text-text-muted uppercase tracking-wider px-1 mb-1">Library</p>
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {unselectedLibrary.slice(0, 8).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => addFromLibrary(item.id)}
                          className="w-full flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-background-secondary"
                        >
                          <div className="w-5 h-5 rounded bg-background-tertiary flex-shrink-0 overflow-hidden">
                            {item.thumbnailUrl && (
                              <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <span className="truncate">{item.title || item.name}</span>
                        </button>
                      ))}
                      {unselectedLibrary.length > 8 && (
                        <p className="text-[9px] text-text-muted px-1">
                          +{unselectedLibrary.length - 8} more
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Upload */}
                {onUpload && (
                  <label className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-background-secondary cursor-pointer">
                    <Upload size={12} className="flex-shrink-0" />
                    Upload file
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onUpload(file);
                        event.target.value = "";
                        setAddOpen(false);
                      }}
                    />
                  </label>
                )}

                {/* Browse full library */}
                {unselectedLibrary.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      // Open library in parent — for now, just show all in dropdown
                      setAddOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-background-secondary"
                  >
                    <FolderOpen size={12} className="flex-shrink-0" />
                    Browse library…
                  </button>
                )}

                {/* Generate new */}
                {onRequestGenerate && (
                  <button
                    type="button"
                    onClick={() => {
                      onRequestGenerate();
                      setAddOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-background-secondary"
                  >
                    <Wand2 size={12} className="flex-shrink-0 text-primary" />
                    Generate new…
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selected cards grid */}
      {selectedItems.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {selectedItems.map((item) => (
            <div
              key={item.id}
              className="relative group rounded-lg border-2 border-primary/40 bg-background-elevated overflow-hidden aspect-square"
            >
              <ImageThumb item={item} />
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${item.title || item.name}`}
              >
                <X size={10} className="text-white" />
              </button>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                <p className="text-[9px] text-white truncate leading-tight">{item.title || item.name}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-text-muted py-3 text-center border border-dashed border-border rounded-lg">
          No reference images selected. Add images to guide generation.
        </p>
      )}
    </div>
  );
}
