import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, FileWarning, X } from "lucide-react";
import type { ImportError } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@openreel/ui";

interface Props {
  errors: ImportError[];
}

const KIND_ICON: Record<ImportError["kind"], typeof AlertTriangle> = {
  block_failed: FileWarning,
  missing_media: AlertTriangle,
  image_failed: FileWarning,
};

const KIND_LABEL: Record<ImportError["kind"], string> = {
  block_failed: "Block failed",
  missing_media: "Missing file",
  image_failed: "Image failed",
};

const TAB_DEFS: Array<{ value: ImportError["kind"] | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing_media", label: "Files" },
  { value: "block_failed", label: "Blocks" },
  { value: "image_failed", label: "Images" },
];

function ErrorRow({
  error,
  clearImportErrors,
  handleLinkFile,
}: {
  error: ImportError;
  clearImportErrors: () => void;
  handleLinkFile: (mediaId: string) => void;
}) {
  const Icon = KIND_ICON[error.kind];
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Icon size={13} className="text-yellow-400/60 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-text-secondary leading-tight">
          {error.message}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[9px] text-yellow-400/50 uppercase tracking-wider">
            {KIND_LABEL[error.kind]}
          </span>
          {error.trackName && (
            <span className="text-[9px] text-text-muted truncate">
              · {error.trackName}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {error.kind === "missing_media" && (
          <button
            onClick={() => handleLinkFile(error.label)}
            className="px-2 py-0.5 rounded text-[9px] font-medium bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 transition-colors"
          >
            Link File
          </button>
        )}
        {(error.kind === "block_failed" || error.kind === "image_failed") && (
          <button
            onClick={clearImportErrors}
            className="px-2 py-0.5 rounded text-[9px] font-medium bg-slate-500/15 text-slate-300 hover:bg-slate-500/25 transition-colors"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
export function ImportErrorsPanel({ errors }: Props) {
  const clearImportErrors = useUIStore((s) => s.clearImportErrors);
  const replaceMediaAsset = useProjectStore((s) => s.replaceMediaAsset);
  const [activeTab, setActiveTab] = useState<string>("all");

  const handleLinkFile = useCallback((mediaId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*,image/*";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) await replaceMediaAsset(mediaId, file);
    };
    input.click();
  }, [replaceMediaAsset]);

  const byKind = useMemo(() => {
    const map: Record<string, ImportError[]> = { all: errors };
    for (const kind of ["missing_media", "block_failed", "image_failed"] as const) {
      map[kind] = errors.filter((e) => e.kind === kind);
    }
    return map;
  }, [errors]);

  const visibleTabs = TAB_DEFS.filter((def) => def.value === "all" || byKind[def.value].length > 0);

  if (errors.length === 0) return null;

  return (
    <div className="mx-3 mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-yellow-500/15">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-yellow-400" />
          <span className="text-xs font-semibold text-yellow-300">
            {errors.length} import error{errors.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={clearImportErrors}
          className="p-1 rounded hover:bg-yellow-500/10 text-yellow-400/60 hover:text-yellow-300 transition-colors"
          title="Dismiss all"
        >
          <X size={14} />
        </button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col">
        <TabsList className="mx-3 mt-2 shrink-0 justify-start gap-0 rounded-md bg-transparent p-0 h-auto border-b border-yellow-500/10 pb-0 rounded-b-none">
          {visibleTabs.map((def) => {
            const count = byKind[def.value].length;
            return (
              <TabsTrigger
                key={def.value}
                value={def.value}
                className="text-[10px] px-2.5 py-1.5 data-[state=active]:bg-yellow-500/10 data-[state=active]:text-yellow-300 data-[state=active]:shadow-none h-auto rounded-t-md rounded-b-none border-b-2 border-transparent data-[state=active]:border-yellow-500/40 transition-colors"
              >
                {def.label}
                {def.value !== "all" && count > 0 && (
                  <span className="ml-1.5 px-1 rounded text-[9px] bg-yellow-500/15 text-yellow-300/80">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {visibleTabs.map((def) => (
          <TabsContent key={def.value} value={def.value} className="mt-0">
            <div className="divide-y divide-yellow-500/10 max-h-48 overflow-y-auto">
              {byKind[def.value].map((error) => (
                <ErrorRow
                  key={error.id}
                  error={error}
                  clearImportErrors={clearImportErrors}
                  handleLinkFile={handleLinkFile}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
