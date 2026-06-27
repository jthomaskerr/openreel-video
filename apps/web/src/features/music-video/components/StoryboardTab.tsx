import React from "react";
import { Layers, Film, Music } from "lucide-react";
import type { MusicVideoProject } from "@openreel/music-video-domain";

interface Props {
  mvProject: MusicVideoProject;
}

export const StoryboardTab: React.FC<Props> = ({ mvProject }) => {
  const { shots, metadataTracks, timing } = mvProject;

  const isEmpty = shots.length === 0 && metadataTracks.length === 0;

  if (isEmpty) {
    return (
      <div className="p-4 text-white/40 text-xs space-y-1">
        <p>Nothing imported yet.</p>
        <p>Use the Import tab to load a Neural Frames storyboard.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/5">
      {/* Timing summary */}
      {timing && (
        <div className="px-3 py-2.5 flex items-center gap-3 text-xs text-white/50">
          <Music size={11} className="flex-shrink-0" />
          <span>
            {timing.bpm ? `${timing.bpm} BPM` : "—"}
            {timing.sections.length > 0 && ` · ${timing.sections.length} sections`}
          </span>
        </div>
      )}

      {/* Shot index */}
      {shots.length > 0 && (
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-white/30 uppercase tracking-wider">
            <Film size={10} />
            {shots.length} shots
          </div>
          <div className="space-y-0.5">
            {shots.map((shot, i) => (
              <div key={shot.id} className="flex items-center gap-2 text-xs py-0.5">
                <span className="text-white/20 w-4 text-right flex-shrink-0">{i + 1}</span>
                <span className="text-white/60 truncate flex-1">{shot.label}</span>
                <span className="text-white/25 text-[10px] flex-shrink-0">
                  {shot.startSeconds.toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata tracks */}
      {metadataTracks.length > 0 && (
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-white/30 uppercase tracking-wider">
            <Layers size={10} />
            Metadata tracks
          </div>
          <div className="space-y-0.5">
            {metadataTracks.map((track) => (
              <div key={track.id} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-white/60 truncate">{track.label}</span>
                <span className="text-white/25 text-[10px] flex-shrink-0 ml-2">
                  {track.blocks.length} block{track.blocks.length !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
