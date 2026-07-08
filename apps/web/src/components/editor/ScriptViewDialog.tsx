import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Copy,
  Download,
  FileCode,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle
} from "lucide-react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { saveFileHandle } from "../../services/media-storage";
import {
  matchProjectJsonAssetFiles,
  type ProjectJsonAssetFile
} from "./project-json-assets";
import type { ValidationResult } from "@openreel/core/storage/schema-types";

SyntaxHighlighter.registerLanguage("json", json);

interface ScriptViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "export" | "import";
}

interface PickedProjectJsonAssetFile extends ProjectJsonAssetFile {
  readonly handle?: FileSystemFileHandle;
}

type FileWithRelativePath = File & { readonly webkitRelativePath?: string };

function fileRelativePath(file: File): string | undefined {
  return (file as FileWithRelativePath).webkitRelativePath || undefined;
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        resolve(content);
      } else {
        reject(new Error("Selected project file could not be read as text"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read project file"));
    reader.readAsText(file);
  });
}

async function scanDirectoryAssets(
  dirHandle: FileSystemDirectoryHandle,
): Promise<PickedProjectJsonAssetFile[]> {
  const files: PickedProjectJsonAssetFile[] = [];
  const pending: Array<{ handle: FileSystemDirectoryHandle; path: string }> = [
    { handle: dirHandle, path: "" },
  ];

  while (pending.length > 0) {
    const current = pending.shift()!;
    for await (const [name, handle] of current.handle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      const relativePath = current.path ? `${current.path}/${name}` : name;
      if (handle.kind === "file") {
        const fileHandle = handle as FileSystemFileHandle;
        files.push({
          file: await fileHandle.getFile(),
          relativePath,
          handle: fileHandle
        });
      } else if (handle.kind === "directory") {
        pending.push({
          handle: handle as FileSystemDirectoryHandle,
          path: relativePath
        });
      }
    }
  }

  return files;
}

async function pickProjectFolderFiles(): Promise<PickedProjectJsonAssetFile[]> {
  if ("showDirectoryPicker" in window) {
    const dirHandle = await (
      window as unknown as {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker();
    return scanDirectoryAssets(dirHandle);
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      resolve(
        Array.from(input.files ?? []).map((file) => ({
          file,
          relativePath: fileRelativePath(file)
        })),
      );
      input.remove();
    };
    input.oncancel = () => {
      resolve([]);
      input.remove();
    };
    input.click();
  });
}

export const ScriptViewDialog: React.FC<ScriptViewDialogProps> = ({
  isOpen,
  onClose,
  initialTab = "export"
}) => {
  const { project } = useProjectStore();
  const [activeTab, setActiveTab] = useState<"export" | "import">(initialTab);
  const [importJson, setImportJson] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonRelativePath, setJsonRelativePath] = useState<string>();
  const [assetFiles, setAssetFiles] = useState<PickedProjectJsonAssetFile[]>([]);
  const [isImportingProject, setIsImportingProject] = useState(false);

  const storage = useMemo(() => createStorageEngine(), []);
  const serializer = useMemo(() => createProjectSerializer(storage), [storage]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  const exportedJson = useMemo(() => {
    if (!project) return "";
    return serializer.exportToJsonWithMetadata(
      project,
      `Exported from ${project.name}`,
    );
  }, [project, serializer]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, [exportedJson]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([exportedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = project?.modifiedAt ?? Date.now();
    const d = new Date(ts);
    const dateSuffix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
    a.download = `${project?.name || "project"}_${dateSuffix}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportedJson, project?.name, project?.modifiedAt]);

  const processImportJson = useCallback(
    (jsonString: string, jsonFile?: File, candidateFiles: readonly File[] = []) => {
      setImportJson(jsonString);
      setJsonRelativePath(jsonFile ? fileRelativePath(jsonFile) || jsonFile.name : undefined);
      setAssetFiles(
        candidateFiles.map((file) => ({
          file,
          relativePath: fileRelativePath(file)
        })),
      );
      setValidation(null);
      try {
        const result = serializer.validateProjectJson(jsonString);
        setValidation(result);
      } catch (error) {
        setValidation({
          valid: false,
          errors: [
            `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
          ],
          warnings: []
        });
      }
    },
    [serializer],
  );

  const handleFileUpload = useCallback(
    async (file: File, candidateFiles: readonly File[] = []) => {
      try {
        processImportJson(await readTextFile(file), file, candidateFiles);
      } catch (error) {
        setValidation({
          valid: false,
          errors: [
            `Import error: ${error instanceof Error ? error.message : "Unknown error"}`,
          ],
          warnings: []
        });
      }
    },
    [processImportJson],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const projectFile = files.length > 0 ? files[0] : undefined;
      if (projectFile) {
        void handleFileUpload(
          projectFile,
          files.filter((file) => file !== projectFile),
        );
      }
      e.target.value = "";
    },
    [handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      const projectFile = files.length > 0 ? files[0] : undefined;
      if (projectFile) {
        void handleFileUpload(
          projectFile,
          files.filter((file) => file !== projectFile),
        );
      }
    },
    [handleFileUpload],
  );

  const handleChooseProjectFolder = useCallback(async () => {
    try {
      const files = await pickProjectFolderFiles();
      setAssetFiles(files);
      if (files.length > 0) {
        toast.success(`Loaded ${files.length} project folder file${files.length !== 1 ? "s" : ""}`);
      }
    } catch {
      // User cancelled the folder picker.
    }
  }, []);

  const handleValidate = useCallback(() => {
    setIsValidating(true);
    try {
      const result = serializer.validateProjectJson(importJson);
      setValidation(result);
    } catch (error) {
      setValidation({
        valid: false,
        errors: [
          `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        warnings: []
      });
    } finally {
      setIsValidating(false);
    }
  }, [importJson, serializer]);

  const handleImport = useCallback(async () => {
    if (!validation?.valid || isImportingProject) return;

    setIsImportingProject(true);
    try {
      const { project: importedProject } =
        serializer.importFromJsonWithValidation(importJson);
      if (!importedProject) return;

      let candidateFiles = assetFiles;
      let matches = matchProjectJsonAssetFiles(
        importedProject,
        candidateFiles,
        jsonRelativePath,
      );

      if (matches.length === 0 && importedProject.mediaLibrary.items.some((item) => getMediaStatus(item) === MediaStatus.MISSING)) {
        try {
          candidateFiles = await pickProjectFolderFiles();
          setAssetFiles(candidateFiles);
          matches = matchProjectJsonAssetFiles(
            importedProject,
            candidateFiles,
            jsonRelativePath,
          );
        } catch {
          // User cancelled the folder picker; import the project with placeholders.
        }
      }

      const { loadProject, replaceMediaAsset } = useProjectStore.getState();
      loadProject(importedProject);

      let importedAssetCount = 0;
      for (const match of matches) {
        try {
          const matchedSource = candidateFiles.find((candidate) => candidate.file === match.file);
          if (matchedSource?.handle) {
            await saveFileHandle(match.file.name, match.file.size, matchedSource.handle);
          }
          const result = await replaceMediaAsset(match.mediaId, match.file, match.sourceFolder);
          if (result.success) importedAssetCount++;
        } catch (error) {
          console.error(`[Project JSON] Failed to import ${match.file.name}:`, error);
        }
      }

      onClose();

      const missingCount = useProjectStore
        .getState()
        .project.mediaLibrary.items.filter((item) => getMediaStatus(item) === MediaStatus.MISSING).length;
      if (importedAssetCount > 0) {
        toast.success(`Imported ${importedAssetCount} referenced asset${importedAssetCount !== 1 ? "s" : ""}`);
      }
      if (missingCount > 0) {
        toast.warning(
          `${missingCount} asset${missingCount !== 1 ? "s" : ""} need relinking`,
          "Choose the folder containing the project JSON so relative asset paths can be resolved.",
        );
      }
    } catch (error) {
      setValidation({
        valid: false,
        errors: [
          `Import error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        warnings: []
      });
    } finally {
      setIsImportingProject(false);
    }
  }, [assetFiles, importJson, isImportingProject, jsonRelativePath, onClose, serializer, validation]);

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col" style={{ height: "70vh" }}>
        <DialogHeader className="p-4 border-b border-border space-y-0">
          <div className="flex items-center gap-3">
            <FileCode size={20} className="text-primary" />
            <div>
              <DialogTitle className="text-lg font-semibold text-text-primary">
                Project JSON
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted">
                Export or import project as JSON
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex gap-1 p-2 border-b border-border">
          <button
            onClick={() => setActiveTab("export")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "export"
                ? "bg-background-tertiary text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            Export JSON
          </button>
          <button
            onClick={() => setActiveTab("import")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "import"
                ? "bg-background-tertiary text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            Import
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === "export" && (
            <>
              {exportedJson ? (
                <>
                  <div className="flex gap-2 p-3 border-b border-border">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      {copySuccess ? (
                        <>
                          <CheckCircle2 size={16} className="text-primary" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownload}>
                      <Download size={16} />
                      Download JSON
                    </Button>
                  </div>

                  <div className="flex-1 overflow-auto custom-scrollbar p-4">
                    <div className="rounded-lg overflow-hidden border border-border">
                      <SyntaxHighlighter
                        language="json"
                        style={vs2015}
                        showLineNumbers
                        customStyle={{
                          margin: 0,
                          padding: "1rem",
                          background: "#1e1e1e",
                          fontSize: "12px"
                        }}
                      >
                        {exportedJson}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <FileCode size={40} className="text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    No project data to export.
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === "import" && (
            <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
              {/* File upload drop zone */}
              <input
                ref={fileInputRef}
                type="file"
                accept="*"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-text-muted hover:bg-background-tertiary"
                }`}
              >
                <Upload
                  size={32}
                  className={
                    isDragging ? "text-primary" : "text-text-muted"
                  }
                />
                <div className="text-center">
                  <p className="text-sm text-text-primary font-medium">
                    {isDragging
                      ? "Drop JSON file here"
                      : "Drop a JSON file here or click to browse"}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Select the JSON file. Drop or select extra files to import referenced assets.
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleChooseProjectFolder}
                className="self-start"
              >
                <Upload size={16} />
                Choose project folder for referenced files
              </Button>

              {/* Show loaded file info */}
              {importJson && (
                <div className="flex items-center gap-2 p-3 bg-background-tertiary border border-border rounded-lg">
                  <FileCode size={16} className="text-text-secondary" />
                  <span className="text-sm text-text-primary flex-1">
                    {importJson.length.toLocaleString()} characters loaded
                    {assetFiles.length > 0 ? ` · ${assetFiles.length} asset candidate${assetFiles.length !== 1 ? "s" : ""}` : ""}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setImportJson("");
                      setValidation(null);
                      setAssetFiles([]);
                      setJsonRelativePath(undefined);
                    }}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleValidate}
                    disabled={isValidating}
                  >
                    {isValidating ? "Validating..." : "Re-validate"}
                  </Button>
                </div>
              )}

              {/* Validation results */}
              {validation && (
                <div className="space-y-2">
                  {validation.valid && (
                    <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                      <CheckCircle2 size={16} className="text-primary" />
                      <span className="text-sm text-primary">
                        Valid project JSON — ready to import
                      </span>
                    </div>
                  )}

                  {validation.errors.length > 0 && (
                    <div className="p-3 bg-error/10 border border-error/30 rounded-lg space-y-1">
                      <div className="flex items-center gap-2 text-error font-medium text-sm">
                        <AlertCircle size={16} />
                        Errors
                      </div>
                      <ul className="list-disc list-inside text-xs text-error/80 space-y-0.5">
                        {validation.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validation.warnings.length > 0 && (
                    <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg space-y-1">
                      <div className="flex items-center gap-2 text-warning font-medium text-sm">
                        <AlertTriangle size={16} />
                        Warnings
                      </div>
                      <ul className="list-disc list-inside text-xs text-warning/80 space-y-0.5">
                        {validation.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validation.missingAssets &&
                    validation.missingAssets.length > 0 && (
                      <div className="p-3 bg-background-tertiary border border-border rounded-lg space-y-1">
                        <div className="text-sm font-medium text-text-secondary">
                          Missing Assets ({validation.missingAssets.length})
                        </div>
                        <p className="text-xs text-text-muted">
                          Relative paths are resolved from the project JSON file.
                          On import, referenced files are loaded from the selected
                          folder or extra dropped files when they match.
                        </p>
                      </div>
                    )}
                </div>
              )}

              {/* Import button */}
              {importJson && (
                <Button onClick={handleImport} disabled={!validation?.valid || isImportingProject}>
                  <Upload size={16} />
                  {isImportingProject ? "Importing..." : "Import Project"}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
