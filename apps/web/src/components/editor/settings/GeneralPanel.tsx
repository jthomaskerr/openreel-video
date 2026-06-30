import React, { useCallback } from "react";
import { Switch } from "@openreel/ui";
import { Label } from "@openreel/ui";
import { useSettingsStore, type TtsProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { ORCHESTRATOR_URL } from "../../../stores/music-video-store";

const ASPECT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: "16:9 Landscape (1080p)", width: 1920, height: 1080 },
  { label: "9:16 Vertical (TikTok/Reels)", width: 1080, height: 1920 },
  { label: "1:1 Square", width: 1080, height: 1080 },
  { label: "4:5 Portrait", width: 1080, height: 1350 },
  { label: "4:3 Standard", width: 1440, height: 1080 },
  { label: "21:9 Cinematic", width: 2560, height: 1080 },
  { label: "4K Landscape", width: 3840, height: 2160 },
];

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
  } = useSettingsStore();

  const projectWidth = useProjectStore((s) => s.project.settings.width);
  const projectHeight = useProjectStore((s) => s.project.settings.height);
  const updateProjectSettings = useProjectStore((s) => s.updateSettings);

  const [draftWidth, setDraftWidth] = React.useState(String(projectWidth));
  const [draftHeight, setDraftHeight] = React.useState(String(projectHeight));

  React.useEffect(() => {
    setDraftWidth(String(projectWidth));
    setDraftHeight(String(projectHeight));
  }, [projectWidth, projectHeight]);

  // Remote repository
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [remoteDirty, setRemoteDirty] = React.useState(false);
  const [remoteSaving, setRemoteSaving] = React.useState(false);
  const [remoteStatus, setRemoteStatus] = React.useState<"" | "saved" | "error">("");

  // Load remote URL from backend on mount
  React.useEffect(() => {
    fetch(`${ORCHESTRATOR_URL}/api/projects/config`)
      .then((res) => res.json())
      .then((cfg: { remote?: string }) => setRemoteUrl(cfg.remote ?? ""))
      .catch(() => {});
  }, []);

  const saveRemote = useCallback(async () => {
    setRemoteSaving(true);
    setRemoteStatus("");
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/projects/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remote: remoteUrl.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRemoteDirty(false);
      setRemoteStatus("saved");
      setTimeout(() => setRemoteStatus(""), 3000);
    } catch {
      setRemoteStatus("error");
    } finally {
      setRemoteSaving(false);
    }
  }, [remoteUrl]);

  const applyDimensions = useCallback(
    async (width: number, height: number) => {
      const w = Math.max(16, Math.min(7680, Math.round(width)));
      const h = Math.max(16, Math.min(7680, Math.round(height)));
      await updateProjectSettings({ width: w, height: h });
    },
    [updateProjectSettings],
  );

  const handleApplyCustom = useCallback(() => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyDimensions(w, h);
    }
  }, [draftWidth, draftHeight, applyDimensions]);

  const ttsProviders = [
    { id: "piper", label: "Piper (Free / Built-in)" },
    ...(configuredServices.includes("elevenlabs")
      ? [{ id: "elevenlabs", label: "ElevenLabs" }]
      : []),
  ];

  return (
    <div className="space-y-6 pb-4">
      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            Project Composition
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Set the canvas dimensions for your project. Pick a preset for TikTok,
            Reels, YouTube, or enter custom values.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
              preset.width === projectWidth && preset.height === projectHeight;
            return (
              <button
                key={preset.label}
                onClick={() => applyDimensions(preset.width, preset.height)}
                className={`text-left px-3 py-2 rounded-md text-xs transition-colors border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-text-muted text-[10px] mt-0.5">
                  {preset.width} × {preset.height}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-text-secondary">Width</Label>
            <input
              type="number"
              min={16}
              max={7680}
              value={draftWidth}
              onChange={(e) => setDraftWidth(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-text-secondary">Height</Label>
            <input
              type="number"
              min={16}
              max={7680}
              value={draftHeight}
              onChange={(e) => setDraftHeight(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <button
            onClick={handleApplyCustom}
            className="h-9 px-3 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">Auto-Save</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-text-secondary">Enable auto-save</Label>
            <p className="text-xs text-text-muted mt-0.5">
              Automatically save your project at regular intervals
            </p>
          </div>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Label className="text-sm text-text-secondary whitespace-nowrap">
              Save every
            </Label>
            <select
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
        )}
      </div>


      {/* Remote Repository */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">Remote Repository</h3>
        <p className="text-xs text-text-muted">
          Git remote URL for project backups. All projects are stored as branches in a single shared repository.
        </p>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-text-secondary">Git Remote URL</Label>
            <input
              type="text"
              placeholder="git@github.com:you/openreel-projects.git"
              value={remoteUrl}
              onChange={(e) => {
                setRemoteUrl(e.target.value);
                setRemoteDirty(true);
                setRemoteStatus("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRemote();
              }}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono"
            />
          </div>
          <button
            onClick={saveRemote}
            disabled={remoteSaving || !remoteDirty}
            className="h-9 px-3 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {remoteSaving ? "Saving…" : "Save"}
          </button>
        </div>

        {remoteStatus === "saved" && (
          <p className="text-xs text-green-500">Remote URL saved successfully.</p>
        )}
        {remoteStatus === "error" && (
          <p className="text-xs text-red-500">Failed to save remote URL. Check the backend is running.</p>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Default TTS Provider */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          Default TTS Provider
        </h3>
        <p className="text-xs text-text-muted">
          Choose which service to use by default for text-to-speech.
          Configure API keys in the &quot;API Keys&quot; tab first.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              Text to Speech/Voice To Speech/Sound Effects
            </Label>
            <select
              value={defaultTtsProvider}
              onChange={(e) => setDefaultTtsProvider(e.target.value as TtsProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
            >
              {ttsProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
