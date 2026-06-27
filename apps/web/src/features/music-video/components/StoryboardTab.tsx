import React from "react";
import { Film, CheckSquare, Square } from "lucide-react";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import type { MusicVideoProject } from "@openreel/music-video-domain";

interface Props {
  mvProject: MusicVideoProject;
  openreelProjectId: string;
}

export const StoryboardTab: React.FC<Props> = ({ mvProject, openreelProjectId }) => {
  const { selectShot, selectAllShots } = useMusicVideoStore();
  const { shots } = mvProject;

  const selectedCount = shots.filter((s) => s.selected).length;
  const allSelected = shots.length > 0 && selectedCount === shots.length;

  if (shots.length === 0) {
    return (
      <div className="p-4 text-white/40 text-xs space-y-2">
        <p>No storyboard shots yet.</p>
        <p>Import a Neural Frames storyboard or use the directed chat to generate one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-xs text-white/50">
        <button
          onClick={() => selectAllShots(openreelProjectId, !allSelected)}
          className="flex items-center gap-1 hover:text-white/80 transition-colors"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {selectedCount > 0 ? `${selectedCount} / ${shots.length} selected` : "Select all"}
        </button>
      </div>

      {/* Shot list */}
      <div className="divide-y divide-white/5">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className={`flex gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
              shot.selected ? "bg-blue-500/10" : "hover:bg-white/5"
            }`}
            onClick={() => selectShot(openreelProjectId, shot.id, !shot.selected)}
          >
            {/* Checkbox */}
            <div className="mt-0.5 flex-shrink-0 text-white/40">
              {shot.selected ? (
                <CheckSquare size={13} className="text-blue-400" />
              ) : (
                <Square size={13} />
              )}
            </div>

            {/* Shot info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Film size={11} className="text-white/30 flex-shrink-0" />
                <span className="font-medium text-white/80 truncate">{shot.label}</span>
                <span className="text-white/30 text-[10px] flex-shrink-0">
                  {shot.startSeconds.toFixed(1)}s – {shot.endSeconds.toFixed(1)}s
                </span>
              </div>
              {shot.prompt && (
                <p className="text-white/40 text-[11px] mt-0.5 line-clamp-2 leading-relaxed">
                  {shot.prompt}
                </p>
              )}
              {/* Validation warnings */}
              {shot.validation.warnings.length > 0 && (
                <div className="mt-1 text-amber-400/80 text-[10px]">
                  ⚠ {shot.validation.warnings[0].message}
                </div>
              )}
              {shot.validation.errors.length > 0 && (
                <div className="mt-1 text-red-400/80 text-[10px]">
                  ✕ {shot.validation.errors[0].message}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
