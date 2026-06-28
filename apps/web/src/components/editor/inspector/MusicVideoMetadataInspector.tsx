import type { Clip } from "@openreel/core";

interface Props {
  clip: Clip;
}

export function MusicVideoMetadataInspector({ clip }: Props) {
  return (
    <div className="space-y-4" data-testid="music-video-metadata-inspector">
      <header>
        <h3 className="text-sm font-semibold text-text-primary">Music Video Workflow</h3>
        <p className="text-[10px] text-text-muted">Metadata clip {clip.id}</p>
      </header>
      <Section title="Brief" description="Creative brief, concept, genre, visual style, and prompt defaults." />
      <Section title="Audio Analysis" description="Beat, section, lyric, and timing analysis for the imported audio." />
      <Section title="Storyboard" description="Timeline-native scene metadata clips and shot prompts." />
      <Section title="Characters" description="Character metadata clips and reference image continuity." />
      <Section title="Reference Images" description="Selected and uploaded reference images used for generation." />
      <Section title="Generation Jobs" description="KieAI and WaveSpeed job status, retry, cancel, and results." />
      <Section title="Shot Generation" description="Generate image or video assets for storyboard shots." />
    </div>
  );
}

function Section({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-lg border border-border bg-background-secondary p-3">
      <h4 className="text-xs font-semibold text-text-primary">{title}</h4>
      <p className="text-[10px] text-text-muted mt-1">{description}</p>
    </section>
  );
}
