import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { Button } from "@openreel/ui";
import { Plus } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { addTimelineClip, type TimelineClipStore } from "../../../features/music-video/timeline/timeline-clips";

interface Props {
  clip: Clip;
}

const TRACK_CONFIG: Record<string, { trackName: string; color: string; label: string }> = {
  character: { trackName: "Characters", color: "#a855f7", label: "Character" },
  scene: { trackName: "Scenes", color: "#3b82f6", label: "Scene" },
  style: { trackName: "Style / LoRAs", color: "#f59e0b", label: "Style" },
};

export function MusicVideoMetadataInspector({ clip }: Props) {
  return (
    <div className="space-y-4" data-testid="music-video-metadata-inspector">
      <header>
        <h3 className="text-sm font-semibold text-text-primary">Music Video Workflow</h3>
        <p className="text-[10px] text-text-muted">Metadata clip {clip.id}</p>
      </header>

      <Section title="Brief" description="Creative brief, concept, genre, visual style, and prompt defaults." />
      <Section title="Audio Analysis" description="Beat, section, lyric, and timing analysis for the imported audio." />

      <Section title="Storyboard" description="Timeline-native scene metadata clips and shot prompts.">
        <NewMetadataButton kind="scene" />
      </Section>

      <Section title="Characters" description="Character metadata clips and reference image continuity.">
        <NewMetadataButton kind="character" />
      </Section>

      <Section title="Style" description="Style/LoRA metadata clips for generation context.">
        <NewMetadataButton kind="style" />
      </Section>

      <Section title="Reference Images" description="Selected and uploaded reference images used for generation." />
      <Section title="Generation Jobs" description="KieAI and WaveSpeed job status, retry, cancel, and results." />
      <Section title="Shot Generation" description="Generate image or video assets for storyboard shots." />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-background-secondary p-3">
      <h4 className="text-xs font-semibold text-text-primary">{title}</h4>
      <p className="text-[10px] text-text-muted mt-1">{description}</p>
      {children && <div className="mt-2">{children}</div>}
    </section>
  );
}

function NewMetadataButton({ kind }: { kind: "character" | "scene" | "style" }) {
  const { addTrack, addClip, addGeneratedMedia, renameTrack } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const config = TRACK_CONFIG[kind];

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const storeIface: TimelineClipStore = {
        get project() {
          return useProjectStore.getState().project;
        },
        addTrack,
        renameTrack,
        addGeneratedMedia,
        addClip,
      };

      const result = await addTimelineClip(storeIface, {
        trackName: config.trackName,
        kind,
        label: `New ${config.label}`,
        color: config.color,
        startTime: 0,
        duration: 5,
        metadata: {},
      });

      if (!result.success) {
        console.error(`[MV] Failed to create ${kind} clip:`, result.error);
      }
    } finally {
      setCreating(false);
    }
  }, [kind, config, addTrack, addClip, addGeneratedMedia, renameTrack]);

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleCreate}
      disabled={creating}
      className="text-[10px] h-7 px-2"
    >
      <Plus size={11} className="mr-1" />
      {creating ? "Creating…" : `New ${config.label}`}
    </Button>
  );
}