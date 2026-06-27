import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import type { NeuralFramesImportResult, NeuralFramesStoryboard } from "@openreel/music-video-domain";

interface Props {
  openreelProjectId: string;
  orchestratorUrl: string;
}

export const NeuralFramesImportTab: React.FC<Props> = ({
  openreelProjectId,
  orchestratorUrl,
}) => {
  const { applyNeuralFramesImport } = useMusicVideoStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<NeuralFramesImportResult | null>(null);
  const [fileName, setFileName] = useState("");

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setStatus("loading");
    setMessage("");

    let raw: NeuralFramesStoryboard;
    try {
      raw = JSON.parse(await file.text()) as NeuralFramesStoryboard;
    } catch {
      setStatus("error");
      setMessage("Not valid JSON.");
      return;
    }

    try {
      const res = await fetch(`${orchestratorUrl}/api/import/neuralframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
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
      <p className="text-white/50 text-xs">
        Import a Neural Frames storyboard JSON. Scenes become storyboard shots
        and metadata tracks. Account fields are stripped.
      </p>

      {/* Drop zone / file picker */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className="w-full border border-dashed border-white/20 hover:border-blue-400/60 rounded-lg py-8 flex flex-col items-center gap-2 text-white/40 hover:text-white/70 transition-colors cursor-pointer"
      >
        <Upload size={20} />
        <span className="text-xs">
          {fileName || "Click or drop a .storyboard.json file"}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {status === "loading" && (
        <div className="text-white/50 text-xs animate-pulse">Importing…</div>
      )}

      {status === "done" && result && (
        <div className="rounded bg-green-500/10 border border-green-500/20 px-3 py-2 text-green-300 text-xs space-y-1">
          <div>✓ {message}</div>
          <ul className="text-green-300/70 space-y-0.5 mt-1">
            <li>• {result.metadataTracks.length} metadata tracks added</li>
            <li>• {result.shots.length} storyboard shots created</li>
            {result.timingHints.bpm ? <li>• BPM: {result.timingHints.bpm}</li> : null}
          </ul>
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
