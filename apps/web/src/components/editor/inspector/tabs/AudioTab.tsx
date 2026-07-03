import React from "react";
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
  const mediaItem = React.useMemo(() => {
    const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    return clip ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId) : undefined;
  }, [clipId, project.mediaLibrary.items, project.timeline.tracks]);

  return (
    <>
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
