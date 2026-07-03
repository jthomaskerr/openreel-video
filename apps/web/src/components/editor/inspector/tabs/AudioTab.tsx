import React, { useEffect, useMemo, useState } from "react";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
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
  const project = useProjectStore((state) => state.project);
  const clipMedia = useMemo(() => {
    const clip = project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    const mediaItem = clip ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId) : undefined;
    return { clip, mediaItem };
  }, [clipId, project.mediaLibrary.items, project.timeline.tracks]);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!clipMedia.mediaItem?.blob) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(clipMedia.mediaItem.blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clipMedia.mediaItem?.blob]);

  const audioUrl = blobUrl ?? clipMedia.mediaItem?.originalUrl ?? null;

  return (
    <>
      {showAudioEffects && audioUrl && (
        <InspectorSection title="Audio Preview" sectionId="audio-preview" defaultOpen>
          <audio controls src={audioUrl} className="w-full" preload="metadata" />
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
