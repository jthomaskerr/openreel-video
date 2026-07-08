import React, { useCallback } from "react";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { WaveformPreview } from "../WaveformPreview";
import { useProjectStore } from "../../../../stores/project-store";
import { Switch } from "@openreel/ui";

export interface AudioTabProps {
  clipId: string;
  clipType: string | null;
  showAudioEffects: boolean;
  noiseReductionSectionTitle: string;
  selectedNoiseReductionEffect: unknown;
}

export const AudioTab: React.FC<AudioTabProps> = ({
  clipId,
  clipType,
  showAudioEffects,
  noiseReductionSectionTitle,
  selectedNoiseReductionEffect,
}) => {
  const project = useProjectStore((s) => s.project);
  const setClipMuted = useProjectStore((s) => s.setClipMuted);
  const clip = React.useMemo(() => {
    return project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
  }, [clipId, project.timeline.tracks]);
  const mediaItem = React.useMemo(() => {
    return clip ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId) : undefined;
  }, [clip, project.mediaLibrary.items]);

  const handleMuteChange = useCallback(
    (checked: boolean) => {
      setClipMuted(clipId, checked);
    },
    [clipId, setClipMuted],
  );

  return (
    <>
      {/* Volume & Mute controls */}
      <InspectorSection title="Volume &amp; Mute" sectionId="volume-mute" defaultOpen>
        <div className="flex items-center justify-between px-1">
          <label
            htmlFor={`clip-mute-${clipId}`}
            className="text-sm text-fg-2 cursor-pointer select-none"
          >
            Mute clip audio
          </label>
          <Switch
            id={`clip-mute-${clipId}`}
            checked={clip?.muted ?? false}
            onCheckedChange={handleMuteChange}
          />
        </div>
      </InspectorSection>

      {showAudioEffects && mediaItem && (mediaItem.blob ?? mediaItem.originalUrl) && (
        <InspectorSection title="Audio Preview" sectionId="audio-preview" defaultOpen>
          <WaveformPreview item={mediaItem} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="Auto Cut Silence"
          sectionId="auto-cut-silence"
          defaultOpen={false}
        >
          <AutoCutSilenceSection clipId={clipId} />
        </InspectorSection>
      )}
      {clipType === "audio" && (
        <InspectorSection title="Beat Sync" sectionId="beat-sync" defaultOpen={false}>
          <AudioTextSyncPanel clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={noiseReductionSectionTitle}
          sectionId="background-noise-removal"
          defaultOpen={Boolean(selectedNoiseReductionEffect)}
        >
          <NoiseReductionSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <>
          <InspectorSection
            title="Audio Effects"
            sectionId="audio-effects"
            defaultOpen={false}
          >
            <AudioEffectsSection clipId={clipId} />
          </InspectorSection>
        </>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="Audio Ducking"
          sectionId="audio-ducking"
          defaultOpen={false}
        >
          <AudioDuckingSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
