import React, { useEffect, useState } from "react";
import { Music, Film, Import } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useMusicVideoStore, ORCHESTRATOR_URL } from "../../../stores/music-video-store";
import { StoryboardTab } from "./StoryboardTab";
import { NeuralFramesImportTab } from "./NeuralFramesImportTab";

interface MusicVideoPanelProps {
  onClose: () => void;
}

type Tab = "storyboard" | "import";

export const MusicVideoPanel: React.FC<MusicVideoPanelProps> = ({ onClose }) => {
  const openreelProject = useProjectStore((s) => s.project);
  const projectId = openreelProject.id;

  // Reactive selector — re-renders whenever the project changes in the store
  const mvProject = useMusicVideoStore((s) => s.projects[projectId]);
  const createProject = useMusicVideoStore((s) => s.createProject);

  useEffect(() => {
    if (!mvProject) {
      createProject(projectId, openreelProject.name ?? "Music Video");
    }
  }, [projectId, mvProject, createProject, openreelProject.name]);

  const [tab, setTab] = useState<Tab>("storyboard");

  const shotCount = mvProject?.shots.length ?? 0;

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
            { id: "storyboard" as Tab, label: "Storyboard", icon: Film, badge: shotCount || undefined },
            { id: "import" as Tab, label: "Import", icon: Import, badge: undefined },
          ]
        ).map(({ id, label, icon: Icon, badge }) => (
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
            {badge !== undefined && (
              <span className="ml-0.5 px-1 py-px rounded text-[10px] bg-white/10 text-white/60 leading-none">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "storyboard" ? (
          mvProject
            ? <StoryboardTab mvProject={mvProject} />
            : <div className="p-4 text-white/40 text-xs">Loading…</div>
        ) : (
          <NeuralFramesImportTab
            openreelProjectId={projectId}
            orchestratorUrl={ORCHESTRATOR_URL}
            onImported={() => setTab("storyboard")}
          />
        )}
      </div>
    </div>
  );
};
