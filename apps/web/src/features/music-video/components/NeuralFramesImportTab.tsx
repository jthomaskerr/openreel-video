import React, { useState } from "react";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import type { NeuralFramesImportResult } from "@openreel/music-video-domain";

interface Props {
  openreelProjectId: string;
  orchestratorUrl: string;
}

export const NeuralFramesImportTab: React.FC<Props> = ({
  openreelProjectId,
  orchestratorUrl,
}) => {
  const { applyNeuralFramesImport } = useMusicVideoStore();
  const [filePath, setFilePath] = useState(
    "/Volumes/Joseph/Documents/Just Down/neuralframes.storyboard.json",
  );
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<NeuralFramesImportResult | null>(null);

  const handleImport = async () => {
    if (!filePath.trim()) return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch(`${orchestratorUrl}/api/import/neuralframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath.trim() }),
      });
      const data = (await res.json()) as NeuralFramesImportResult & { error?: string };
      if (!res.ok || data.error) {
        setStatus("error");
        setMessage(data.error ?? "Import failed");
        return;
      }
      applyNeuralFramesImport(openreelProjectId, data);
      setResult(data);
      setStatus("done");
      setMessage(
        `Imported ${data.scenesImported} scenes, ${data.charactersImported} characters, ${data.lorasImported} LoRAs.`,
      );
    } catch (e) {
      setStatus("error");
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-white/50 text-xs mb-3">
          Import a Neural Frames storyboard JSON file. Scenes become storyboard shots and
          metadata tracks. Account fields are stripped.
        </p>

        <label className="block text-[11px] text-white/40 mb-1.5">
          Absolute path to storyboard JSON
        </label>
        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="/path/to/neuralframes.storyboard.json"
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:border-blue-400/50"
        />
      </div>

      <button
        onClick={handleImport}
        disabled={status === "loading" || !filePath.trim()}
        className="w-full py-2 rounded bg-blue-500/80 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
      >
        {status === "loading" ? "Importing…" : "Import storyboard"}
      </button>

      {status === "done" && (
        <div className="rounded bg-green-500/10 border border-green-500/20 px-3 py-2 text-green-300 text-xs">
          ✓ {message}
          {result && (
            <ul className="mt-1.5 text-green-300/70 space-y-0.5">
              <li>• {result.metadataTracks.length} metadata tracks added</li>
              <li>• {result.shots.length} storyboard shots created</li>
              {result.timingHints.bpm && (
                <li>• BPM: {result.timingHints.bpm}</li>
              )}
            </ul>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-red-300 text-xs">
          ✕ {message}
        </div>
      )}
    </div>
  );
};
