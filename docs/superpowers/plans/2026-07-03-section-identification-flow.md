# Section Identification Flow Implementation Plan

> **Audit status (2026-07-13): PARTIAL, NOT COMPLETE.** Canonical owner: `docs/spec/song-sections.md`. Basic `SongSection` types exist, but lyric/audio inference, evidence merging, confirmation/edit state, section meta-track UI, storyboard handoff, deterministic tests, evals, and browser evidence are absent.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect, display, confirm, and edit song sections so storyboard generation and alteration receive confirmed section boundaries as first-class creative structure.

**Architecture:** A new section-analysis flow combines four evidence sources: repeated or partially repeated lyrics, typical song-form heuristics, audio-energy boundary changes, and optional user-provided lyrics. The result is stored as editable `SongSection`/section metadata and rendered as an arranger-style section meta-track with draggable boundaries, split controls, color coding, and smart section naming. Storyboard generation must require a confirm/edit step for section boundaries and pass the confirmed sections into create/alter LLM requests.

**Tech Stack:** TypeScript, React, Zustand, Vitest, `@openreel/music-video-domain` `SongSection`/`TimingAnalysis`, existing timeline/metadata track components, existing audio analysis service plan (`2026-07-03-audio-analysis-and-selection.md`), existing storyboard generation/alter plans.

---

## File map

- Modify: `packages/music-video-domain/src/types.ts` — add section-confidence/evidence types and extend storyboard request types.
- Modify: `packages/music-video-domain/src/index.ts` — export new section-analysis types.
- Create: `packages/music-video-domain/src/sections.ts` — pure section inference helpers: lyric repetition, song-form heuristics, energy-boundary merge, naming.
- Create: `packages/music-video-domain/src/sections.test.ts` — deterministic unit tests for inference and naming.
- Modify: `apps/web/src/stores/music-video-store.ts` — add section CRUD and confirmation state.
- Create: `apps/web/src/components/editor/storyboard/SectionConfirmationPanel.tsx` — confirm/edit sections before storyboard generation.
- Create: `apps/web/src/components/editor/timeline/SectionMetaTrack.tsx` — arranger-style section track UI.
- Modify: `apps/web/src/components/editor/Timeline.tsx` — render section meta-track above timeline lanes.
- Modify: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx` — add optional lyrics file selector and require confirmed sections.
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx` — add storyboard configuration pane entry for later lyrics upload.
- Modify: `apps/orchestrator/src/routes/storyboard.ts` — require confirmed sections in create/alter prompt payloads.

---

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Add section evidence/domain types | none | false | `feat(domain): add section analysis types` |
| 02 | Implement lyric repetition section inference | 01 | false | `feat(domain): infer repeated lyric sections` |
| 03 | Implement song-form and energy-boundary merge | 02 | false | `feat(domain): merge section heuristics` |
| 04 | Add section CRUD and confirmation state | 01 | true | `feat(web): add editable confirmed sections` |
| 05 | Build arranger-style section meta-track | 04 | false | `feat(web): add section meta track` |
| 06 | Build SectionConfirmationPanel | 04 | true | `feat(web): add section confirmation panel` |
| 07 | Add lyrics file selection surfaces | 06 | false | `feat(web): add optional lyrics input for sections` |
| 08 | Feed confirmed sections into storyboard LLM calls | 06 | false | `feat(storyboard): include confirmed sections in prompts` |
| 09 | Run integration tests and manual smoke | 05, 07, 08 | false | `chore: verify section identification flow` |

---

## Task 01: Add section evidence/domain types

**Goal:** Represent inferred and confirmed sections with evidence, confidence, edit state, and color/naming metadata.

**Files:**
- Modify: `packages/music-video-domain/src/types.ts`
- Modify: `packages/music-video-domain/src/index.ts`
- Test: `packages/music-video-domain/src/sections.test.ts`

- [ ] **Step 1: Write failing type test**

Create `packages/music-video-domain/src/sections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SectionAnalysisResult } from "./types.js";

describe("section analysis types", () => {
  it("stores inferred and confirmed sections with evidence", () => {
    const result: SectionAnalysisResult = {
      status: "needs-confirmation",
      sections: [
        {
          id: "section-1",
          name: "Chorus 1",
          kind: "chorus",
          startSeconds: 32,
          endSeconds: 64,
          color: "#f97316",
          confidence: 0.86,
          confirmed: false,
          evidence: [
            { kind: "lyric-repetition", confidence: 0.9, note: "matches chorus at 96s" },
            { kind: "energy-boundary", confidence: 0.78, note: "energy jump at 32s" },
          ],
        },
      ],
    };

    expect(result.sections[0].kind).toBe("chorus");
    expect(result.sections[0].evidence).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/music-video-domain test:run packages/music-video-domain/src/sections.test.ts
```

Expected: fail because `SectionAnalysisResult` does not exist.

- [ ] **Step 3: Add types**

Add to `packages/music-video-domain/src/types.ts`:

```ts
export type SongSectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "breakdown"
  | "drop"
  | "solo"
  | "outro"
  | "unknown";

export interface SectionEvidence {
  kind: "lyric-repetition" | "song-form" | "energy-boundary" | "manual" | "lyrics-file";
  confidence: number;
  note: string;
}

export interface EditableSongSection {
  id: string;
  name: string;
  kind: SongSectionKind;
  startSeconds: number;
  endSeconds: number;
  color: string;
  confidence: number;
  confirmed: boolean;
  evidence: SectionEvidence[];
}

export interface SectionAnalysisResult {
  status: "needs-confirmation" | "confirmed";
  sections: EditableSongSection[];
}
```

- [ ] **Step 4: Export types**

Update `packages/music-video-domain/src/index.ts` to export the new types from `types.js` using the existing export pattern.

- [ ] **Step 5: Run passing test**

Run:

```bash
pnpm --filter @openreel/music-video-domain test:run packages/music-video-domain/src/sections.test.ts
```

Expected: pass.

---

## Task 02: Implement lyric repetition section inference

**Goal:** Identify repeated or partially repeated lyric blocks as likely choruses/refrains.

**Files:**
- Create: `packages/music-video-domain/src/sections.ts`
- Modify: `packages/music-video-domain/src/sections.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `sections.test.ts`:

```ts
import { inferSectionsFromLyrics } from "./sections.js";

it("labels repeated lyric blocks as choruses", () => {
  const lyrics = [
    { startSeconds: 0, endSeconds: 8, text: "walking down the same old road" },
    { startSeconds: 8, endSeconds: 16, text: "looking for a sign" },
    { startSeconds: 32, endSeconds: 40, text: "we rise up we rise up tonight" },
    { startSeconds: 40, endSeconds: 48, text: "nothing can stop the light" },
    { startSeconds: 88, endSeconds: 96, text: "we rise up we rise up tonight" },
    { startSeconds: 96, endSeconds: 104, text: "nothing can stop the light" },
  ];

  const result = inferSectionsFromLyrics(lyrics, 120);

  expect(result.sections.some((section) => section.kind === "chorus")).toBe(true);
  expect(result.sections.filter((section) => section.kind === "chorus")).toHaveLength(2);
});
```

- [ ] **Step 2: Implement normalizer and repetition matching**

Create `packages/music-video-domain/src/sections.ts`:

```ts
import type { EditableSongSection, SectionAnalysisResult } from "./types.js";

interface LyricLine {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function normalizeLyric(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function sectionColor(kind: EditableSongSection["kind"]): string {
  const colors: Record<EditableSongSection["kind"], string> = {
    intro: "#64748b",
    verse: "#3b82f6",
    prechorus: "#a855f7",
    chorus: "#f97316",
    bridge: "#14b8a6",
    breakdown: "#ef4444",
    drop: "#22c55e",
    solo: "#eab308",
    outro: "#64748b",
    unknown: "#94a3b8",
  };
  return colors[kind];
}

export function inferSectionsFromLyrics(lines: LyricLine[], durationSeconds: number): SectionAnalysisResult {
  const phrases = lines.map((line) => ({ ...line, key: normalizeLyric(line.text) })).filter((line) => line.key.length > 12);
  const repeatedKeys = new Set<string>();
  for (const phrase of phrases) {
    if (phrases.filter((candidate) => candidate.key === phrase.key).length > 1) repeatedKeys.add(phrase.key);
  }

  const repeatedLines = phrases.filter((line) => repeatedKeys.has(line.key));
  const sections: EditableSongSection[] = repeatedLines.map((line, index) => ({
    id: `section-chorus-${index + 1}`,
    name: `Chorus ${index + 1}`,
    kind: "chorus",
    startSeconds: Math.max(0, line.startSeconds - 4),
    endSeconds: Math.min(durationSeconds, line.endSeconds + 8),
    color: sectionColor("chorus"),
    confidence: 0.85,
    confirmed: false,
    evidence: [{ kind: "lyric-repetition", confidence: 0.85, note: `Repeated lyric: ${line.text}` }],
  }));

  return { status: "needs-confirmation", sections };
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm --filter @openreel/music-video-domain test:run packages/music-video-domain/src/sections.test.ts
```

Expected: pass.

---

## Task 03: Implement song-form and energy-boundary merge

**Goal:** Merge lyric-derived sections with audio energy boundaries and typical pop-song flow to produce complete intro/verse/prechorus/chorus/bridge/outro candidates.

**Files:**
- Modify: `packages/music-video-domain/src/sections.ts`
- Modify: `packages/music-video-domain/src/sections.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests for:
- no repeated lyrics creates heuristic intro/verse/chorus/outro boundaries
- high energy jump near a boundary moves the nearest section start/end to the energy jump
- section names are sequential (`Verse 1`, `Verse 2`, `Chorus 1`, `Chorus 2`)

- [ ] **Step 2: Implement merge API**

Add exported function:

```ts
export interface EnergyBoundary {
  timeSeconds: number;
  confidence: number;
}

export function inferSongSections(input: {
  durationSeconds: number;
  lyrics?: LyricLine[];
  energyBoundaries?: EnergyBoundary[];
}): SectionAnalysisResult {
  const lyricResult = input.lyrics?.length ? inferSectionsFromLyrics(input.lyrics, input.durationSeconds) : { status: "needs-confirmation" as const, sections: [] };
  const hasChorus = lyricResult.sections.some((section) => section.kind === "chorus");
  const base = hasChorus ? lyricResult.sections : buildSongFormSkeleton(input.durationSeconds);
  return {
    status: "needs-confirmation",
    sections: snapSectionsToEnergy(base, input.energyBoundaries ?? [], input.durationSeconds),
  };
}
```

Implement `buildSongFormSkeleton` using this conservative shape for songs longer than 90s:
- Intro: 0–8%
- Verse 1: 8–25%
- Prechorus 1: 25–34%
- Chorus 1: 34–50%
- Verse 2: 50–64%
- Chorus 2: 64–80%
- Bridge or Breakdown: 80–90%
- Outro: 90–100%

Implement `snapSectionsToEnergy` so boundaries move only when an energy boundary is within ±4 seconds and confidence ≥ 0.65.

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm --filter @openreel/music-video-domain test:run packages/music-video-domain/src/sections.test.ts
```

Expected: pass.

---

## Task 04: Add section CRUD and confirmation state

**Goal:** Store inferred sections, allow edits, and mark the section map confirmed before storyboard generation.

**Files:**
- Modify: `apps/web/src/stores/music-video-store.ts`
- Test: `apps/web/src/stores/music-video-store.test.ts`

- [ ] **Step 1: Add failing store tests**

Test actions:
- `setInferredSections(projectId, sections)` stores sections as unconfirmed
- `updateSectionBoundary(projectId, sectionId, startSeconds, endSeconds)` edits one section
- `splitSection(projectId, sectionId, splitSeconds)` creates two sections
- `confirmSections(projectId)` marks all sections confirmed and sets section analysis status to `confirmed`

- [ ] **Step 2: Implement store actions**

Add methods to `MusicVideoState`:

```ts
setInferredSections: (openreelProjectId: string, sections: EditableSongSection[]) => void;
updateSectionBoundary: (openreelProjectId: string, sectionId: string, startSeconds: number, endSeconds: number) => void;
splitSection: (openreelProjectId: string, sectionId: string, splitSeconds: number) => void;
renameSection: (openreelProjectId: string, sectionId: string, kind: SongSectionKind, name: string) => void;
confirmSections: (openreelProjectId: string) => void;
```

Store the result under the existing music-video project object as `sectionAnalysis: SectionAnalysisResult`.

- [ ] **Step 3: Run store tests**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/stores/music-video-store.test.ts
```

Expected: pass.

---

## Task 05: Build arranger-style section meta-track

**Goal:** Render sections as a meta-track above timeline lanes, similar to Studio One's arranger track.

**Files:**
- Create: `apps/web/src/components/editor/timeline/SectionMetaTrack.tsx`
- Modify: `apps/web/src/components/editor/Timeline.tsx`
- Test: `apps/web/src/components/editor/timeline/SectionMetaTrack.test.tsx`

- [ ] **Step 1: Add failing component test**

Test renders two colored section blocks, labels them `Verse 1` and `Chorus 1`, and calls `onBoundaryDrag` when a drag handle moves.

- [ ] **Step 2: Implement component**

Component props:

```ts
interface SectionMetaTrackProps {
  sections: EditableSongSection[];
  pixelsPerSecond: number;
  onBoundaryDrag: (sectionId: string, edge: "start" | "end", timeSeconds: number) => void;
  onSplit: (sectionId: string, timeSeconds: number) => void;
  onRename: (sectionId: string, kind: SongSectionKind, name: string) => void;
}
```

Render:
- a 28px-high horizontal track above normal tracks
- colored blocks by section `color`
- start/end drag handles
- split button at cursor/time on context menu or inline control
- smart section-name dropdown with sequential names: `Verse 1`, `Verse 2`, `Prechorus 1`, `Chorus 1`, `Bridge`, `Breakdown`, `Drop`, `Intro`, `Outro`, `Solo`

- [ ] **Step 3: Wire into Timeline**

Render `SectionMetaTrack` above track lanes when the active music-video project has `sectionAnalysis.sections.length > 0`.

---

## Task 06: Build SectionConfirmationPanel

**Goal:** Provide a confirmation/edit screen in the storyboard generation flow.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/SectionConfirmationPanel.tsx`
- Test: `apps/web/src/components/editor/storyboard/SectionConfirmationPanel.test.tsx`

- [ ] **Step 1: Add failing test**

Test that unconfirmed sections require clicking `Confirm sections` before `onConfirmed` fires.

- [ ] **Step 2: Implement panel**

Panel shows:
- section list sorted by `startSeconds`
- evidence badges (`lyrics`, `energy`, `song form`, `manual`)
- confidence percentage
- inline name dropdown
- `Confirm sections` button disabled when sections overlap or have invalid duration

---

## Task 07: Add lyrics file selection surfaces

**Goal:** Allow optional lyrics input at storyboard generation and later in storyboard configuration.

**Files:**
- Modify: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx`
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`
- Create: `apps/web/src/components/editor/storyboard/lyrics-file.ts`

- [ ] **Step 1: Add parser tests**

Support `.txt`, `.lrc`, and `.srt`:

```ts
expect(parseLyricsFile("[00:32.00]We rise up")).toEqual([
  { startSeconds: 32, text: "We rise up" },
]);
```

- [ ] **Step 2: Add selection in generation dialog**

Add an optional file input beside audio/storyboard generation controls. Parsed lyrics feed into `inferSongSections` before confirmation.

- [ ] **Step 3: Add later upload in storyboard config pane**

Add `Upload lyrics` action in the storyboard configuration pane; re-run section inference while preserving manually confirmed sections unless the user chooses `Replace sections`.

---

## Task 08: Feed confirmed sections into storyboard LLM calls

**Goal:** Storyboard create/alter calls receive confirmed sections as hard timing/structure input.

**Files:**
- Modify: `packages/music-video-domain/src/types.ts`
- Modify: `apps/orchestrator/src/prompts/storyboard-generation.ts`
- Modify: `apps/orchestrator/src/routes/storyboard.ts`
- Modify: `apps/orchestrator/src/routes/alter-storyboard.ts` if created by the alter-storyboard plan

- [ ] **Step 1: Extend request types**

Add `confirmedSections: EditableSongSection[]` to storyboard generation and alter-storyboard requests.

- [ ] **Step 2: Update prompt builders**

Prompt rule:

```text
You must preserve the provided section boundaries. Create shots that start/end inside these sections unless explicitly instructed otherwise. Chorus sections should usually contain repeated visual motifs or returning imagery.
```

- [ ] **Step 3: Route validation**

Reject generation when no confirmed sections exist:

```ts
if (!body.confirmedSections?.length || body.confirmedSections.some((section) => !section.confirmed)) {
  res.status(400).json({ error: "Confirm song sections before generating storyboard" });
  return;
}
```

---

## Task 09: Run integration tests and manual smoke

- [ ] Run domain tests:

```bash
pnpm --filter @openreel/music-video-domain test:run packages/music-video-domain/src/sections.test.ts
```

Expected: pass.

- [ ] Run web tests:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/SectionConfirmationPanel.test.tsx apps/web/src/components/editor/timeline/SectionMetaTrack.test.tsx
```

Expected: pass.

- [ ] Manual smoke:
  1. Import or select an audio file.
  2. Upload optional `.lrc` lyrics in Generate Storyboard.
  3. Confirm generated `Intro`, `Verse 1`, `Chorus 1`, etc.
  4. Drag a chorus boundary.
  5. Split a verse section.
  6. Generate storyboard.
  7. Confirm generated shots align with section boundaries.

---

## Handoff notes

- This plan is a prerequisite for the section-aware parts of:
  - `2026-07-03-audio-analysis-and-selection.md`
  - `2026-07-03-generate-storyboard-tool.md`
  - `2026-07-03-alter-storyboard-tool.md`
- Sentiment analysis must be emitted as a time series aligned to these sections, not as a single media-level label.
- The UI should never silently accept inferred sections for storyboard generation; the user confirms or edits the sections first.
