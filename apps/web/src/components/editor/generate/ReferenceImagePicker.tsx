import type { MediaItem } from "@openreel/core";

export interface ReferenceImagePickerProps {
  mediaItems: MediaItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onUpload?: (file: File) => void;
}

export function ReferenceImagePicker({ mediaItems, selectedIds, onChange, onUpload }: ReferenceImagePickerProps) {
  const imageItems = mediaItems.filter((item) => item.type === "image");

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-text-primary">Reference Images</h4>
        {onUpload && (
          <label className="text-[10px] px-2 py-1 rounded bg-background-tertiary text-text-secondary hover:text-text-primary cursor-pointer">
            Upload
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {imageItems.length === 0 ? (
        <p className="text-[10px] text-text-muted">No image media available.</p>
      ) : (
        <div className="space-y-2">
          {imageItems.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`${selected ? "Deselect" : "Select"} ${item.name}`}
                onClick={() => toggle(item.id)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-secondary text-text-secondary hover:text-text-primary"
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
