import React, { useState } from "react";
import { Music, Film, Layers, Import } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useMusicVideoStore, ORCHESTRATOR_URL } from "../../../stores/music-video-store";
import { StoryboardTab } from "./StoryboardTab";
import { NeuralFramesImportTab } from "./NeuralFramesImportTab";

interface MusicVideoPanelProps {
  onClose: () => void;
}

type Tab = "storyboard" | "assets" | "import";

export const MusicVideoPanel: React.FC<MusicVideoPanelProps> = ({ onClose }) => {
  const openreelProject = useProjectStore((s) => s.project);
  const projectId = openreelProject.id;

  const { getProject, createProject } = useMusicVideoStore();
  const mvProject = getProject(projectId) ?? createProject(projectId, openreelProject.name ?? "Music Video");

  const [tab, setTab] = useState<Tab>("storyboard");

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 font-semibold text-white/90">
          <Music size={15} className="text-blue-400" />
          Music Video
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 transition-colors text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/10">
        {(
          [
            { id: "storyboard", label: "Storyboard", icon: Film },
            { id: "assets", label: "Assets", icon: Layers },
            { id: "import", label: "Import", icon: Import },
          ] as { id: Tab; label: string; icon: React.FC<{ size?: number; className?: string }> }[]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
              tab === id
                ? "border-blue-400 text-blue-300"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "storyboard" && (
          <StoryboardTab mvProject={mvProject} openreelProjectId={projectId} />
        )}
        {tab === "assets" && (
          <div className="p-4 text-white/40 text-xs">
            Generated assets will appear here once shots are generated.
          </div>
        )}
        {tab === "import" && (
          <NeuralFramesImportTab
            openreelProjectId={projectId}
            orchestratorUrl={ORCHESTRATOR_URL}
          />
        )}
      </div>
    </div>
  );
};
