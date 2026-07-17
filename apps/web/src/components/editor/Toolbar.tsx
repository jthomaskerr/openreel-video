import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
  FileVideo,
  Film,
  Music,
  Sun,
  Moon,
  SunMoon,
  X,
  FileCode,
  FolderOpen,
  FolderKanban,
  Settings,
  Zap,
  Circle,
  History,
  HelpCircle,
  Diamond,
  Sparkles,
  Play,
  Undo2,
  Redo2,
  MessageSquare,
  Upload,
  Command,
  Search,
  Menu,
  Import,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { useRouter } from "../../hooks/use-router";
import {
  getExportEngine,
  getDeviceProfile,
  estimateExportTime,
  createProjectSerializer,
  createStorageEngine,
  type VideoExportSettings,
  type AudioExportSettings,
  type ExportResult,
  type DeviceProfile,
  type Project,
  type TimeEstimate,
} from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { ScreenRecorder } from "./ScreenRecorder";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SettingsDialog } from "./settings/SettingsDialog";
import { ProjectManagerDialog } from "./ProjectManagerDialog";
import { reportRuntimeError, toast } from "../../stores/notification-store";
import { useSettingsStore } from "../../stores/settings-store";
import { usePersistenceStatusStore } from "../../stores/persistence-status-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { startTour, ONBOARDING_KEY, startMoGraphTour, MOGRAPH_TOUR_KEY } from "./tour";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@openreel/ui";
import { NeuralFramesImportTab, type NeuralFramesImportTabHandle } from "../../features/music-video";
import { ORCHESTRATOR_URL } from "../../stores/music-video-store";

type ExportType =
  | "mp4"
  | "prores"
  | "gif"
  | "wav"
  | "4k-master"
  | "4k-prores"
  | "4k"
  | "1080p-high"
  | "4k-60-master"
  | "1080p-60"
  | "project";

interface ExportState {
  isExporting: boolean;
  progress: number;
  phase: string;
  error: string | null;
  complete: boolean;
  estimatedTimeRemaining?: number | null;
  framesPerSecond?: number | null;
  estimateConfidence?: "warming-up" | "observed";
  backgroundDegraded?: boolean;
}

export const Toolbar: React.FC = () => {
  const {
    project,
    undo,
    redo,
  } = useProjectStore();
  const {
    openModal,
    selectedItems,
    setExportState: setGlobalExportState,
    keyframeEditorOpen,
    toggleKeyframeEditor,
    panels,
    togglePanel,
    setProjectManagerOpen,
  } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const { navigate } = useRouter();
  const { openSettings } = useSettingsStore();
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { importMedia } = useProjectStore();
  const { track } = useAnalytics();
  const persistencePhase = usePersistenceStatusStore((state) => state.phase);
  const persistedProjectId = usePersistenceStatusStore((state) => state.projectId);
  const persistedAt = usePersistenceStatusStore((state) => state.persistedAt);
  const persistedModifiedAt = usePersistenceStatusStore((state) => state.persistedModifiedAt);
  const persistenceError = usePersistenceStatusStore((state) => state.error);
  const persistencePhaseStartedAt = usePersistenceStatusStore((state) => state.phaseStartedAt);
  const [statusNow, setStatusNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setStatusNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (persistencePhase !== "pending" && persistencePhase !== "saving") return;
    const deadlineMs = persistencePhase === "pending" ? 7_000 : 20_000;
    const elapsed = persistencePhaseStartedAt ? statusNow - persistencePhaseStartedAt : deadlineMs;
    if (elapsed < deadlineMs) return;

    const message = persistencePhaseStartedAt
      ? `${persistencePhase} persistence timed out after ${deadlineMs}ms for project ${project.id}`
      : `${persistencePhase} persistence state for project ${project.id} survived HMR without an active operation`;
    usePersistenceStatusStore.getState().markFailed(project.id, message);
    console.error("[Persistence] header watchdog detected a stale operation", {
      projectId: project.id,
      phase: persistencePhase,
      elapsed,
    });
    reportRuntimeError("Backend persistence stalled", new Error(message), "persistence-status.watchdog");
  }, [persistencePhase, persistencePhaseStartedAt, project.id, statusNow]);

  const neuralFramesImportRef = useRef<NeuralFramesImportTabHandle>(null);
  // Autosave timestamp from the project's modifiedAt date.
  const autosaveLabel = useMemo(() => {
    const ts = project.modifiedAt ?? Date.now();
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }, [project.modifiedAt]);

  const persistenceLabel = useMemo(() => {
    if (persistedProjectId !== project.id) return "not persisted";
    if (persistencePhase === "pending") return "queued";
    if (persistencePhase === "saving") return "persisting…";
    if (persistencePhase === "deferred") return "awaiting change";
    if (persistencePhase === "failed") return `failed: ${persistenceError ?? "unknown error"}`;
    if (!persistedAt || persistedModifiedAt !== project.modifiedAt) return "stale";
    const seconds = Math.max(0, Math.floor((statusNow - persistedAt) / 1000));
    if (seconds < 2) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }, [persistedAt, persistedModifiedAt, persistedProjectId, persistenceError, persistencePhase, project.id, project.modifiedAt, statusNow]);

  const persistenceOperating = persistencePhase === "pending" || persistencePhase === "saving";
  const persistenceConfirmed =
    persistencePhase === "persisted" &&
    persistedProjectId === project.id &&
    persistedModifiedAt === project.modifiedAt;
  const persistenceDotClass = persistencePhase === "failed"
    ? "bg-red-500"
    : persistenceConfirmed
      ? "bg-emerald-500"
      : persistenceOperating
        ? "bg-amber-400"
        : "bg-zinc-500";

  const handleUndo = useCallback(() => {
    void undo();
  }, [undo]);
  const handleRedo = useCallback(() => {
    void redo();
  }, [redo]);

  const handleStartTour = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    startTour();
  }, []);

  const handleStartMoGraphTour = useCallback(() => {
    localStorage.removeItem(MOGRAPH_TOUR_KEY);
    startMoGraphTour();
  }, []);

  const fileImportRef = useRef<HTMLInputElement>(null);
  const [isImportingFile, setIsImportingFile] = useState(false);

  const handleOpenProjectFromFile = useCallback(() => {
    fileImportRef.current?.click();
  }, []);

  const handleFileImportSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImportingFile(true);
      try {
        const text = await file.text();
        const serializer = createProjectSerializer(createStorageEngine());
        const validation = serializer.validateProjectJson(text);
        if (!validation.valid) {
          toast.error("Invalid project file", validation.errors?.join(", "));
          return;
        }
        const { project } = serializer.importFromJsonWithValidation(text);
        if (!project) {
          toast.error("Invalid project file", "Could not parse project data");
          return;
        }

        // Create the project in the backend first
        const response = await fetch("/api/projects/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(project),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          toast.error("Failed to create project", err.error || "Unknown backend error");
          return;
        }
        const savedProject = (await response.json()) as Project;

        // Load into the store and update the URL so the editor is scoped to the new project
        useProjectStore.getState().loadProject(savedProject);
        navigate("editor", { projectId: savedProject.id });
        toast.success("Project opened", `Loaded "${savedProject.name}"`);
      } catch (err) {
        toast.error(
          "Import failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        setIsImportingFile(false);
        // Reset the file input so the same file can be re-selected
        e.target.value = "";
      }
    },
    [navigate],
  );

  const handleOpenProjectManager = useCallback(() => {
    setProjectManagerOpen(true);
  }, [setProjectManagerOpen]);

  // selectedItems drives related UX in the editor (e.g. inspector context).
  // Kept on the destructure list so future tweaks don't have to rewire it.
  void selectedItems;

  const [exportState, setExportState] = useState<ExportState>({
    isExporting: false,
    progress: 0,
    phase: "",
    error: null,
    complete: false,
  });
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [exportEstimates, setExportEstimates] = useState<Map<string, TimeEstimate>>(new Map());

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
      estimatedTimeRemaining: exportState.estimatedTimeRemaining ?? null,
      framesPerSecond: exportState.framesPerSecond ?? null,
      estimateConfidence: exportState.estimateConfidence ?? "warming-up",
      backgroundDegraded: exportState.backgroundDegraded ?? false,
    });
  }, [exportState, setGlobalExportState]);

  useEffect(() => {
    if (deviceProfile) return;
    void getDeviceProfile().then(setDeviceProfile);
  }, [deviceProfile]);

  useEffect(() => {
    if (!deviceProfile || !project.timeline?.duration) {
      return;
    }

    const duration = project.timeline.duration;
    const estimates = new Map<string, TimeEstimate>();

    const configs: Array<{ key: string; width: number; height: number; frameRate: number; codec: "h264" | "h265" | "vp9" | "av1" }> = [
      { key: "mp4", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
      { key: "4k", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "4k-60-master", width: 3840, height: 2160, frameRate: 60, codec: "h264" },
      { key: "4k-master", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "1080p-high", width: 1920, height: 1080, frameRate: 30, codec: "h264" },
      { key: "1080p-60", width: 1920, height: 1080, frameRate: 60, codec: "h264" },
      { key: "prores", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
    ];

    for (const config of configs) {
      const estimate = estimateExportTime(deviceProfile, {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        duration,
        codec: config.codec,
      });
      estimates.set(config.key, estimate);
    }

    setExportEstimates(estimates);
  }, [deviceProfile, project.timeline?.duration, project.settings.width, project.settings.height]);

  const runExport = useCallback(
    async (videoSettings: Partial<VideoExportSettings>, _ext: string, writableStream: FileSystemWritableFileStream) => {
      const engine = getExportEngine();
      await engine.initialize();

      const generator = engine.exportVideo(project, videoSettings, writableStream);
      let finalResult: ExportResult | undefined;

      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          finalResult = value;
          break;
        }
        setExportState((prev) => ({
          ...prev,
          progress: value.progress * 100,
          phase: value.phase === "complete" ? "Complete!" : `${value.phase}...`,
          estimatedTimeRemaining:
            value.estimateConfidence === "observed"
              ? value.estimatedTimeRemaining
              : null,
          framesPerSecond:
            value.estimateConfidence === "observed"
              ? value.framesPerSecond
              : null,
          estimateConfidence: value.estimateConfidence,
          backgroundDegraded: value.backgroundDegraded,
        }));
      }

      if (finalResult?.success) {
        setExportState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: videoSettings.format ?? "mp4",
          codec: videoSettings.codec ?? "h264",
          width: videoSettings.width ?? project.settings.width,
          height: videoSettings.height ?? project.settings.height,
          frameRate: videoSettings.frameRate ?? project.settings.frameRate,
          duration: project.timeline?.duration ?? 0,
        });
      } else {
        throw new Error(finalResult?.error?.message || "Export failed");
      }
    },
    [project, track],
  );

  const showSavePicker = useCallback(async (filename: string, ext: string): Promise<FileSystemWritableFileStream> => {
    const mimeMap: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      wav: "audio/wav",
    };
    const mime = mimeMap[ext] || "application/octet-stream";

    if ("showSaveFilePicker" in window) {
      const handle = await (window as unknown as {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Media file",
          accept: { [mime]: [`.${ext}`] },
        }],
      });
      return handle.createWritable();
    }

    let buffer = new Uint8Array(16 * 1024 * 1024);
    let length = 0;
    let cursor = 0;

    const grow = (needed: number) => {
      if (needed <= buffer.length) return;
      let newSize = buffer.length;
      while (newSize < needed) newSize *= 2;
      const next = new Uint8Array(newSize);
      next.set(buffer.subarray(0, length));
      buffer = next;
    };

    const triggerDownload = () => {
      const blob = new Blob([buffer.slice(0, length)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const writeBytes = (bytes: Uint8Array, position: number) => {
      const end = position + bytes.byteLength;
      grow(end);
      buffer.set(bytes, position);
      if (end > length) length = end;
      cursor = end;
    };

    return {
      seek(position: number) {
        cursor = position;
        return Promise.resolve();
      },
      write(data: unknown) {
        if (data instanceof ArrayBuffer) {
          writeBytes(new Uint8Array(data), cursor);
        } else if (ArrayBuffer.isView(data)) {
          writeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cursor);
        }
        return Promise.resolve();
      },
      close() {
        triggerDownload();
        return Promise.resolve();
      },
      abort() {
        return Promise.resolve();
      },
      truncate() {
        return Promise.resolve();
      },
    } as unknown as FileSystemWritableFileStream;
  }, []);

  const handleExport = useCallback(
    async (type: ExportType) => {
      try {
        if (type === "wav") {
          const writable = await showSavePicker(`${project.name || "export"}.wav`, "wav");

          setExportState({
            isExporting: true,
            progress: 0,
            phase: "Initializing...",
            error: null,
            complete: false,
          });

          const engine = getExportEngine();
          await engine.initialize();

          const audioSettings: Partial<AudioExportSettings> = {
            format: "wav",
            sampleRate: 48000,
            channels: 2,
            bitDepth: 24,
          };

          const generator = engine.exportAudio(project, audioSettings);
          let finalResult: ExportResult | undefined;

          while (true) {
            const { value, done } = await generator.next();
            if (done) {
              finalResult = value;
              break;
            }
            setExportState((prev) => ({
              ...prev,
              progress: value.progress * 100,
              phase: value.phase === "complete" ? "Complete!" : `${value.phase}...`,
            }));
          }

          if (finalResult?.success && finalResult.blob) {
            if ("showSaveFilePicker" in window) {
              await finalResult.blob.stream().pipeTo(writable as unknown as WritableStream<Uint8Array>);
            } else {
              const url = URL.createObjectURL(finalResult.blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${project.name || "export"}.wav`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
            setExportState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
            track(AnalyticsEvents.PROJECT_EXPORTED, {
              format: "wav",
              duration: project.timeline?.duration ?? 0,
            });
          } else {
            try {
              await writable.abort();
            } catch (error) {
              void error;
            }
            throw new Error(finalResult?.error?.message || "Export failed");
          }
        } else {
          const base = {
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          };

          const presets: Record<string, { settings: Partial<VideoExportSettings>; ext: string }> = {
            mp4: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            gif: { settings: { ...base, format: "webm", codec: "vp9", bitrate: 8000 }, ext: "webm" },
            project: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            "4k-60-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 60, format: "mov", codec: "h265", bitrate: 100000, quality: 95 }, ext: "mov" },
            "4k-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "h265", bitrate: 80000, quality: 95 }, ext: "mov" },
            "4k-prores": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "prores", bitrate: 880000, quality: 100 }, ext: "mov" },
            "4k": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mp4", codec: "h264", bitrate: 50000, quality: 90 }, ext: "mp4" },
            "1080p-60": { settings: { ...base, width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 }, ext: "mp4" },
            "1080p-high": { settings: { ...base, width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 }, ext: "mp4" },
            prores: { settings: { ...base, format: "mov", codec: "prores", bitrate: 220000, quality: 100 }, ext: "mov" },
          };

          const preset = presets[type] ?? presets.mp4;
          const writable = await showSavePicker(`${project.name || "export"}.${preset.ext}`, preset.ext);

          setExportState({
            isExporting: true,
            progress: 0,
            phase: "Initializing...",
            error: null,
            complete: false,
          });

          await runExport(preset.settings, preset.ext, writable);
        }

        setTimeout(() => {
          setExportState({ isExporting: false, progress: 0, phase: "", error: null, complete: false });
        }, 2000);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project, track, runExport, showSavePicker],
  );

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings) => {
      setIsExportDialogOpen(false);

      try {
        const ext = settings.format === "mov" ? "mov" : settings.format === "webm" ? "webm" : "mp4";
        const writable = await showSavePicker(`${project.name || "export"}.${ext}`, ext);

        setExportState({
          isExporting: true,
          progress: 0,
          phase: "Initializing...",
          error: null,
          complete: false,
        });

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        setTimeout(() => {
          setExportState({ isExporting: false, progress: 0, phase: "", error: null, complete: false });
        }, 2000);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project, track, runExport, showSavePicker],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          "Recording failed",
          "No video data was captured. Please try again.",
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? "Screen and webcam added to assets. Use the timeline to composite them."
            : "Screen recording added to assets.",
        );
      } else if (errors.length > 0) {
        toast.error("Import failed", errors.join(". "));
      }
    },
    [importMedia],
  );

  const projectRes = `${project.settings.width}×${project.settings.height}`;
  const aspectRatio = project.settings.width / project.settings.height;
  const isVertical = aspectRatio < 0.9;

  const exportOptions: Array<{
    label: string;
    icon: typeof FileVideo;
    desc: string;
    type: ExportType;
    recommended?: boolean;
    separator?: boolean;
  }> = [
    {
      label: "MP4 Standard",
      icon: Zap,
      desc: `${projectRes} H.264 - Web & social`,
      type: "mp4",
      recommended: true,
    },
    {
      label: "",
      icon: Film,
      desc: "",
      type: "mp4",
      separator: true,
    },
    ...(isVertical
      ? []
      : [
          {
            label: "4K Standard",
            icon: FileVideo,
            desc: "3840×2160 - YouTube 4K",
            type: "4k" as ExportType,
          },
        ]),
    {
      label: "1080p High Quality",
      icon: FileVideo,
      desc: "1920×1080 30fps - High bitrate",
      type: "1080p-high",
    },
    {
      label: "1080p 60fps",
      icon: FileVideo,
      desc: "1920×1080 - Smooth playback",
      type: "1080p-60",
    },
    {
      label: "Audio Only (WAV)",
      icon: Music,
      desc: "Uncompressed audio",
      type: "wav",
    },
  ];

  return (
    <header className="h-topbar grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 px-3 bg-bg border-b border-border shrink-0 z-30 relative">
      {/* ─── Left: window dots + autosave ─────────────────────── */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <button
          onClick={() => navigate("welcome")}
          className="flex items-center gap-1.5 pr-1.5"
          title="Back to home"
        >
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.7_0.18_25)]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.78_0.14_80)]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.7_0.15_145)]" />
        </button>

        <span className="text-[11px] text-fg-3 flex min-w-0 items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full bg-accent motion-reduce:animate-none ${persistenceOperating ? "animate-pulse" : ""}`} />
          {exportState.isExporting
            ? `Exporting… ${Math.round(exportState.progress)}%`
            : `Auto saved: ${autosaveLabel}`}
        </span>
        {!exportState.isExporting && (
          <span
            className="text-[11px] text-fg-3 flex min-w-0 items-center gap-1.5 max-w-[260px]"
            title={persistenceError ?? "Confirmed only after the backend Git commit completes"}
          >
            <span className={`w-2 h-2 shrink-0 rounded-full motion-reduce:animate-none ${persistenceDotClass} ${persistenceOperating ? "animate-pulse" : ""}`} />
            <span className="truncate">Persisted {persistenceLabel}</span>
          </span>
        )}
      </div>

      {/* ─── Center: project name ────────────────────────────── */}
      <div className="flex min-w-0 items-center justify-center gap-1.5 overflow-hidden text-[12.5px] font-medium tracking-tight">
        <ProjectSwitcher />
      </div>

      {/* ─── Right: undo/redo, history, comments, pro, export ── */}
      <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1.5">
        {/* Quick search (preserved from existing flow) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => openModal("search")}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
              data-tip="Search (⌘K)"
            >
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Search tools, effects, or ask AI… (⌘K)</TooltipContent>
        </Tooltip>

        {/* Undo / Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleUndo}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Undo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleRedo}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Redo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-1" />

        {/* History */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsHistoryOpen((v) => !v)}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                isHistoryOpen
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <History size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Action history</TooltipContent>
        </Tooltip>

        {/* Keyframe editor (moved here from old toolbar) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleKeyframeEditor}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                keyframeEditorOpen
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Diamond size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Keyframe editor</TooltipContent>
        </Tooltip>

        {/* Audio mixer (moved) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => togglePanel("audioMixer")}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                panels.audioMixer?.visible
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Music size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Audio mixer</TooltipContent>
        </Tooltip>

        {/* Chat panel */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => togglePanel("chat")}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                panels.chat?.visible
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <MessageSquare size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Chat</TooltipContent>
        </Tooltip>
        <div className="w-px h-4 bg-border mx-1" />

        {/* Pro pill — opens more menu (theme, settings, tours, recorder) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Open editor menu"
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Menu size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={toggleTheme} className="gap-2">
              {themeMode === "light" ? <Sun size={14} /> : themeMode === "dark" ? <Moon size={14} /> : <SunMoon size={14} />}
              <span className="flex-1">Theme: {themeMode}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openSettings()} className="gap-2">
              <Settings size={14} />
              <span>Settings & API keys</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsRecorderOpen(true)} className="gap-2">
              <Circle size={14} className="fill-current text-status-error" />
              <span>Screen recorder</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleStartTour} className="gap-2">
              <Play size={14} />
              <span>Editor tour</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleStartMoGraphTour} className="gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span>Animation & effects tour</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-fg-muted">
              <HelpCircle size={14} />
              <span>Help & shortcuts (press ?)</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleOpenProjectManager} className="gap-2">
              <FolderKanban size={14} />
              <span>Projects</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openModal("scriptView")} className="gap-2">
              <FileCode size={14} />
              <span>Project JSON</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openModal("scriptView", { tab: "import" })} className="gap-2">
              <Upload size={14} />
              <span>Load Project JSON</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleOpenProjectFromFile}
              disabled={isImportingFile}
              className="gap-2"
            >
              <FolderOpen size={14} />
              <span>{isImportingFile ? "Opening..." : "Open Project from File"}</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Upload size={14} />
                <span>Export</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <div className="space-y-0.5 max-h-[360px] overflow-y-auto">
                  {exportOptions.map((option, index) =>
                    option.separator ? (
                      <DropdownMenuSeparator key={`sep-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={option.type + index}
                        className={`flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-hover focus:bg-hover ${
                          option.recommended ? "bg-accent-soft" : ""
                        }`}
                        onClick={() => handleExport(option.type)}
                      >
                        <div
                          className={`shrink-0 p-1 rounded-md transition-colors ${
                            option.recommended
                              ? "bg-accent-soft text-accent"
                              : "bg-bg-2 text-fg-2"
                          }`}
                        >
                          <option.icon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm font-medium leading-tight ${
                              option.recommended ? "text-accent" : "text-fg"
                            }`}
                          >
                            {option.label}
                            {option.recommended && (
                              <span className="ml-2 text-[10px] bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                                Best match
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-fg-muted mt-0.5 leading-snug">
                            {option.desc}
                          </div>
                          {exportEstimates.get(option.type) && (
                            <div className="text-[10px] text-fg-3 mt-1 leading-none">
                              Est. {exportEstimates.get(option.type)?.formatted}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ),
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-hover focus:bg-hover"
                    onClick={() => setIsExportDialogOpen(true)}
                  >
                    <div className="shrink-0 p-1 bg-accent-soft rounded-md text-accent">
                      <Settings size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-accent leading-tight">
                        Custom export…
                      </div>
                      <div className="text-[11px] text-fg-muted mt-0.5 leading-snug">
                        Full settings with AI upscaling
                      </div>
                    </div>
                  </DropdownMenuItem>
                </div>
                <div className="bg-bg-2 px-2.5 py-1.5 text-[10px] text-center text-fg-muted border-t border-border">
                  {project.settings.width}×{project.settings.height} •{" "}
                  {project.settings.frameRate}fps
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onClick={() => neuralFramesImportRef.current?.openFilePicker()}
              className="gap-2"
            >
              <Import size={14} />
              <span>Import Neural Frames</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-fg-muted">
              <Command size={14} />
              <span>⌘K to search</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Hidden file input for "Open Project from File" */}
        <input
          ref={fileImportRef}
          type="file"
          accept=".json,.openreel"
          className="hidden"
          onChange={handleFileImportSelected}
        />
      </div>

      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
        projectWidth={project.settings?.width ?? 1920}
        projectHeight={project.settings?.height ?? 1080}
      />

      <ScreenRecorder
        isOpen={isRecorderOpen}
        onClose={() => setIsRecorderOpen(false)}
        onRecordingComplete={handleRecordingComplete}
      />

      <SettingsDialog />

      <ProjectManagerDialog />

      {isHistoryOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="text-sm font-medium text-fg">Action history</span>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}

      {/* Neural Frames Import — hidden, triggered via ref from toolbar button */}
      <NeuralFramesImportTab
        ref={neuralFramesImportRef}
        openreelProjectId={project.id}
        orchestratorUrl={ORCHESTRATOR_URL}
      />
    </header>
  );
};

export default Toolbar;
