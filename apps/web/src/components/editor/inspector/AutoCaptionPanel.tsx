import React, { useState, useCallback, useMemo } from "react";
import { Mic, MicOff, Languages, AlertCircle, Captions, Loader2 } from "lucide-react";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { SpeechToTextEngine, initializeTranscriptionService } from "@openreel/core";
import type {
  TranscriptionProgress,
  TranscriptionSegment,
  WhisperTranscriptionProgress,
} from "@openreel/core";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
import { OPENREEL_TRANSCRIBE_URL } from "../../../config/api-endpoints";

const CAPTION_STYLE_PRESETS = [
  {
    id: "default",
    name: "Default",
    description: "White text on dark background",
  },
  { id: "modern", name: "Modern", description: "Clean, minimal style" },
  { id: "bold", name: "Bold", description: "Large, impactful text" },
  { id: "cinematic", name: "Cinematic", description: "Film-style captions" },
  { id: "minimal", name: "Minimal", description: "Subtle, understated" },
];

type CaptionSource = "microphone" | "selected-clip";

export const AutoCaptionPanel: React.FC = () => {
  const getSpeechToTextEngine = useEngineStore(
    (state) => state.getSpeechToTextEngine,
  );
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const applySubtitleStylePreset = useProjectStore(
    (state) => state.applySubtitleStylePreset,
  );
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);
  const project = useProjectStore((state) => state.project);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);

  const selectedClip = useMemo(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length !== 1) return null;

    return (
      project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedIds[0]) ?? null
    );
  }, [getSelectedClipIds, project.timeline.tracks]);

  const isTranscribableClip =
    selectedClip?.type === "audio" || selectedClip?.type === "video";

  const [captionSource, setCaptionSource] = useState<CaptionSource>(() =>
    isTranscribableClip ? "selected-clip" : "microphone",
  );

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [clipProgress, setClipProgress] =
    useState<WhisperTranscriptionProgress | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");
  const [selectedStyle, setSelectedStyle] = useState("default");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isSupported = useMemo(() => SpeechToTextEngine.isSupported(), []);
  const languages = useMemo(
    () => SpeechToTextEngine.getSupportedLanguages(),
    [],
  );

  const handleStartTranscription = useCallback(async () => {
    setError(null);
    setSegments([]);
    setIsTranscribing(true);

    try {
      const speechEngine = await getSpeechToTextEngine();

      speechEngine.setOptions({ language: selectedLanguage });

      speechEngine.onProgress((prog) => {
        setProgress(prog);
      });

      speechEngine.onSegment((segment) => {
        setSegments((prev) => [...prev, segment]);
      });

      await speechEngine.startLiveTranscription();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start transcription",
      );
      setIsTranscribing(false);
    }
  }, [getSpeechToTextEngine, selectedLanguage]);

  const handleTranscribeSelectedClip = useCallback(async () => {
    if (!selectedClip) return;

    if (selectedClip.type !== "audio" && selectedClip.type !== "video") {
      setError("Select an audio or video clip to generate captions");
      return;
    }

    const mediaItem = getMediaItem(selectedClip.mediaId);
    if (!mediaItem) {
      setError("Could not find media for selected clip");
      return;
    }

    if (!mediaItem.blob && !mediaItem.fileHandle) {
      setError(
        "This clip's source media is unavailable. Reconnect or recover the media first.",
      );
      return;
    }

    setError(null);
    setSegments([]);
    setIsTranscribing(true);

    try {
      const transcriptionService = initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
        language: selectedLanguage,
      });

      const subtitles = await transcriptionService.transcribeClip(
        selectedClip,
        mediaItem,
        setClipProgress,
      );

      subtitles.forEach((subtitle) => {
        addSubtitle(subtitle);
      });

      if (selectedStyle !== "default") {
        await applySubtitleStylePreset(selectedStyle);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to transcribe clip",
      );
    } finally {
      setIsTranscribing(false);
      setClipProgress(null);
    }
  }, [
    selectedClip,
    getMediaItem,
    selectedLanguage,
    selectedStyle,
    addSubtitle,
    applySubtitleStylePreset,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (captionSource === "selected-clip") {
      await handleTranscribeSelectedClip();
    } else {
      await handleStartTranscription();
    }
  }, [captionSource, handleTranscribeSelectedClip, handleStartTranscription]);

  const handleStopTranscription = useCallback(async () => {
    const speechEngine = await getSpeechToTextEngine();

    const result = speechEngine.stopTranscription();
    setIsTranscribing(false);
    setProgress(null);

    if (result.success && result.segments.length > 0) {
      const subtitles = speechEngine.segmentsToSubtitles(result.segments);
      subtitles.forEach((subtitle) => {
        addSubtitle(subtitle);
      });

      if (selectedStyle !== "default") {
        await applySubtitleStylePreset(selectedStyle);
      }
    }
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    selectedStyle,
  ]);

  const handleApplySegments = useCallback(async () => {
    if (segments.length === 0) return;

    const speechEngine = await getSpeechToTextEngine();

    const subtitles = speechEngine.segmentsToSubtitles(segments);
    subtitles.forEach((subtitle) => {
      addSubtitle(subtitle);
    });

    if (selectedStyle !== "default") {
      await applySubtitleStylePreset(selectedStyle);
    }

    setSegments([]);
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    segments,
    selectedStyle,
  ]);

  if (!isSupported) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-status-warning">
          <AlertCircle size={16} />
          <span className="text-[11px] font-medium">Browser Not Supported</span>
        </div>
        <p className="text-[10px] text-text-muted">
          Auto-captions require Chrome or Edge browser with Speech Recognition
          API support.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Mic size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Auto-Caption
          </span>
          <p className="text-[9px] text-text-muted">
            Generate captions from speech
          </p>
        </div>
      </div>

      <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Caption Source</span>
          <Select
            value={captionSource}
            onValueChange={(value) => setCaptionSource(value as CaptionSource)}
            disabled={isTranscribing}
          >
            <SelectTrigger
              aria-label="Caption Source"
              className="w-auto min-w-[150px] bg-background-secondary border-border text-text-primary text-[10px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              <SelectItem value="selected-clip">Selected Clip</SelectItem>
              <SelectItem value="microphone">Microphone Recording</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages size={14} className="text-text-secondary" />
            <span className="text-[10px] text-text-secondary">Language</span>
          </div>
          <Select
            value={selectedLanguage}
            onValueChange={setSelectedLanguage}
            disabled={isTranscribing}
          >
            <SelectTrigger
              aria-label="Language"
              className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Caption Style</span>
          <Select
            value={selectedStyle}
            onValueChange={setSelectedStyle}
            disabled={isTranscribing}
          >
            <SelectTrigger
              aria-label="Caption Style"
              className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {captionSource === "selected-clip" && !error && (
        <div className="p-2 bg-background-tertiary rounded-lg">
          <p className="text-[10px] text-text-secondary">
            {!selectedClip
              ? "Select an audio or video clip in the timeline to generate captions."
              : !isTranscribableClip
                ? "Selected clip does not contain audio."
                : "Generate captions from the selected audio/video clip."}
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {captionSource === "selected-clip" && isTranscribing && clipProgress && (
        <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-primary" />
            <span className="text-[10px] text-text-primary">
              {clipProgress.message}
            </span>
          </div>
          <div className="h-1.5 bg-background-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                clipProgress.phase === "error"
                  ? "bg-red-500"
                  : clipProgress.phase === "complete"
                    ? "bg-green-500"
                    : "bg-primary"
              }`}
              style={{ width: `${clipProgress.progress}%` }}
            />
          </div>
        </div>
      )}

      {captionSource === "microphone" && isTranscribing && progress && (
        <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">Status</span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-[10px] text-red-400">Recording</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">
              Segments Found
            </span>
            <span className="text-[10px] text-text-primary font-mono">
              {progress.segmentsFound}
            </span>
          </div>
        </div>
      )}

      {captionSource === "microphone" && segments.length > 0 && !isTranscribing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">
              {segments.length} caption{segments.length !== 1 ? "s" : ""}{" "}
              detected
            </span>
            <button
              onClick={handleApplySegments}
              className="px-2 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Add to Timeline
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {segments.map((segment, index) => (
              <div
                key={index}
                className="p-2 bg-background-secondary rounded text-[10px] text-text-primary"
              >
                <span className="text-text-muted font-mono">
                  [{segment.startTime.toFixed(1)}s -{" "}
                  {segment.endTime.toFixed(1)}s]
                </span>
                <span className="ml-2">{segment.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {captionSource === "selected-clip" ? (
          <button
            onClick={handlePrimaryAction}
            disabled={isTranscribing || !isTranscribableClip}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTranscribing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span className="text-[11px] font-medium">Generating…</span>
              </>
            ) : (
              <>
                <Captions size={16} />
                <span className="text-[11px] font-medium">Generate Captions</span>
              </>
            )}
          </button>
        ) : !isTranscribing ? (
          <button
            onClick={handlePrimaryAction}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          >
            <Mic size={16} />
            <span className="text-[11px] font-medium">Start Recording</span>
          </button>
        ) : (
          <button
            onClick={handleStopTranscription}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            <MicOff size={16} />
            <span className="text-[11px] font-medium">Stop Recording</span>
          </button>
        )}
      </div>

      {captionSource === "microphone" && (
        <p className="text-[9px] text-text-muted text-center">
          Record live speech from your microphone. Speak clearly — captions will
          be generated in real-time.
        </p>
      )}
    </div>
  );
};

export default AutoCaptionPanel;
