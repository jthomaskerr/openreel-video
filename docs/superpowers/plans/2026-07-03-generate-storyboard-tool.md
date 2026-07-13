# Generate Storyboard Tool Implementation Plan

> **Audit status (2026-07-13): NOT IMPLEMENTED; REVISION REQUIRED.** Canonical owner: `docs/spec/storyboard.md`. `StoryboardShot` exists, but no generation schemas, prompt implementation, route, typed client, dialog, or tests named by this plan are present. The hosted Anthropic design also conflicts with the repository's current local-Claude-Code policy unless Joseph explicitly authorizes it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend storyboard generation tool that calls an LLM (Claude via Anthropic API) with a specialized prompt combining the creative brief, confirmed song sections, timing analysis, metadata tracks, and optional lyrics, and returns validated `StoryboardShot[]` ready for display in the StoryboardPanel.

**Architecture:** A new orchestrator route `POST /api/generate/storyboard` accepts a `StoryboardGenerationRequest` payload (creative brief, confirmed sections, timing, metadata tracks), calls the Anthropic Messages API with a purpose-built system prompt and structured output via tool-use JSON mode, validates the response against a Zod schema, and returns `StoryboardGenerationResult` containing `StoryboardShot[]`. The frontend calls this route from a "Generate Storyboard" trigger in the StoryboardPanel header, first showing the section-confirmation flow from `2026-07-03-section-identification-flow.md`; generation is blocked until section boundaries are confirmed. Optional lyrics can be selected alongside the audio file or later in the storyboard configuration pane and are used to improve section identification before generation.

**Tech Stack:** Node/Express orchestrator, Anthropic TypeScript SDK, Zod for output validation, `@openreel/music-video-domain` types, Zustand, React/Tailwind, Vitest.

---

## Files

### Backend (orchestrator)
- Create: `apps/orchestrator/src/routes/storyboard.ts` — route handler + prompt builder + schema
- Create: `apps/orchestrator/src/prompts/storyboard-generation.ts` — system/user prompt templates
- Create: `apps/orchestrator/src/schemas/storyboard-generation.ts` — Zod schemas for request/output validation
- Modify: `apps/orchestrator/src/routes/index.ts` — re-export new router
- Modify: `apps/orchestrator/src/app.ts` — mount `/api/generate/storyboard`
- Modify: `apps/orchestrator/package.json` — add `@anthropic-ai/sdk` and `zod` dependencies

### Shared types (music-video-domain)
- Modify: `packages/music-video-domain/src/types.ts` — add `StoryboardGenerationRequest` and `StoryboardGenerationResult` interfaces
- Modify: `packages/music-video-domain/src/index.ts` — re-export new types

### Frontend (web)
- Create: `apps/web/src/services/anthropic/index.ts` — client for storyboard generation endpoint
- Create: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx` — dialog for triggering generation with optional brief refinement
- Modify: `apps/web/src/stores/music-video-store.ts` — add `applyStoryboardGeneration` action
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx` — add "Generate" button in header
- Modify: `apps/web/src/components/editor/storyboard/SectionConfirmationPanel.tsx` — confirm/edit inferred song sections before request submission
- Modify: `apps/web/src/components/editor/storyboard/lyrics-file.ts` — parse optional `.txt`, `.lrc`, or `.srt` lyrics for section inference
- Create: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx`

### Tests
- Create: `apps/orchestrator/tests/storyboard-generation.test.ts` — unit tests for prompt builder and schema validation
- Create: `apps/web/src/services/anthropic/anthropic.test.ts`
- Create: `apps/web/src/stores/__tests__/storyboard-generation.test.ts` — store action tests

---

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Add shared types for storyboard generation request/result | none | false | `feat(domain): add storyboard generation types` |
| 02 | Define Zod schemas for request/output validation | 01 | false | `feat(orchestrator): add generation input/output schemas` |
| 03 | Build prompt templates | 01 | true (with 02) | `feat(orchestrator): add storyboard generation prompt builder` |
| 04 | Implement orchestrator route handler | 02, 03 | false | `feat(orchestrator): add POST /api/generate/storyboard` |
| 05 | Mount route in app and add deps | 04 | false | `feat(orchestrator): wire up storyboard generation route` |
| 06 | Add `applyStoryboardGeneration` store action | 01 | false | `feat(web): add applyStoryboardGeneration store action` |
| 07 | Build GenerateStoryboardDialog component | none | true (with 06) | `feat(web): add generate storyboard dialog` |
| 08 | Add frontend API client for generation endpoint | 04 | true (with 07) | `feat(web): add storyboard generation API client` |
| 09 | Wire Generate button into StoryboardPanel | 07, 08 | false | `feat(web): wire generate storyboard trigger into panel` |
| 10 | Test backend handler and schema validation | 02, 04 | false | `test(orchestrator): add storyboard generation tests` |
| 11 | Test frontend store action and dialog | 06, 07 | true (with 10) | `test(web): add storyboard generation frontend tests` |
| 12 | Smoke test end-to-end workflow | 09, 10, 11 | false | `chore: verify full storyboard generation workflow` |

---

## Atomic task plans

### Task 01: Add shared types for storyboard generation request/result

**Goal:** Define the input and output interfaces for the storyboard generation tool in `@openreel/music-video-domain` so both the orchestrator and web app share the same contract.

**Files:**
- Modify: `packages/music-video-domain/src/types.ts` (insert before `StoryboardShot` at line 240)
- Modify: `packages/music-video-domain/src/index.ts` — re-export new types

**Sub-steps:**
- [ ] Read `packages/music-video-domain/src/types.ts:174-267` to confirm insertion point.
- [ ] Add the following interfaces after `CreativeBrief` (line 185) and before `GeneratedAsset` (line 187):

```typescript
// ── Storyboard generation ─────────────────────────────────────────────────────

export interface StoryboardGenerationRequest {
  /** The creative brief defining visual direction */
  creativeBrief: CreativeBrief;
  /** Confirmed song sections; generation is blocked until every section is confirmed by the user */
  confirmedSections: EditableSongSection[];
  /** Timing analysis with beat markers and other audio-derived markers */
  timing: TimingAnalysis;
  /** Optional parsed lyrics used for section-aware prompts */
  lyrics?: Array<{ startSeconds?: number; endSeconds?: number; text: string }>;
  /** Metadata tracks (lyrics, notes, section labels) to inform shot timing */
  metadataTracks: MetadataTrack[];
  audioDurationSeconds: number;
  /** Number of shots to generate (approximate) — default 8 */
  shotCount?: number;
}

export interface StoryboardGenerationResult {
  /** The generated storyboard shots */
  shots: StoryboardShot[];
  /** The model/prompt snapshot used for traceability */
  generationMeta: {
    provider: GenerationProvider;
    model: string;
    promptSnapshot: string;
    temperature: number;
    generatedAt: string;
  };
  /** Validation warnings about output quality (e.g. overlapping shots) */
  warnings: string[];
}
```

- [ ] Export both from `packages/music-video-domain/src/index.ts`:
  ```
  INS.POST 1:
  +export type { StoryboardGenerationRequest, StoryboardGenerationResult } from "./types.js";
  ```
- [ ] Run: `pnpm --filter @openreel/music-video-domain typecheck` and confirm PASS.
- [ ] Commit: `git add packages/music-video-domain/src/types.ts packages/music-video-domain/src/index.ts && git commit -m "feat(domain): add storyboard generation types"`

**Acceptance:**
- `StoryboardGenerationRequest` exports with all required fields.
- `StoryboardGenerationResult` exports with `shots`, `generationMeta`, `warnings`.
- No type errors in the package.

---

### Task 02: Define Zod schemas for request/output validation

**Goal:** Create Zod schemas that validate the incoming request body and the LLM's structured output, ensuring the orchestrator never passes malformed data downstream.

**File:**
- Create: `apps/orchestrator/src/schemas/storyboard-generation.ts`

**Reference files:**
- `packages/music-video-domain/src/types.ts` — all domain interfaces to mirror
- Any existing Zod usage in `packages/core/src/` or `packages/image-core/src/`

**Sub-steps:**
- [ ] Read `packages/core/src/types/actions.ts` for Zod pattern reference (if any) — may not exist; fall back to writing schemas directly.
- [ ] Create the schema file:

```typescript
// apps/orchestrator/src/schemas/storyboard-generation.ts
import { z } from "zod";

export const GenerationProviderSchema = z.string();
// .refine((v) => ["wavespeed", "kie-ai", "veo", "kling", "runway"].includes(v), {
//   message: "Unknown generation provider",
// });

export const ValidationMessageSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  fixHint: z.string().optional(),
});

export const ValidationStateSchema = z.object({
  valid: z.boolean(),
  warnings: z.array(ValidationMessageSchema),
  errors: z.array(ValidationMessageSchema),
});

export const TimingMarkerSchema = z.object({
  id: z.string(),
  timeSeconds: z.number(),
  kind: z.enum(["beat", "bar", "downbeat", "section_boundary", "custom"]),
  confidence: z.number().optional(),
});

export const EnergyPointSchema = z.object({
  timeSeconds: z.number(),
  value: z.number().min(0).max(1),
});

export const SongSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  type: z.enum(["intro", "verse", "pre_chorus", "chorus", "bridge", "drop", "outro", "custom"]),
  energy: z.number().min(0).max(1).optional(),
  key: z.string().optional(),
  bpm: z.number().optional(),
});

export const TimingAnalysisSchema = z.object({
  durationSeconds: z.number(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  timeSignature: z.string().optional(),
  markers: z.array(TimingMarkerSchema),
  energyPoints: z.array(EnergyPointSchema),
  sections: z.array(SongSectionSchema),
});

export const MetadataBlockSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  label: z.string().optional(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  kind: z.enum(["section", "note", "lyric", "beat_cue"]).optional(),
  detail: z.string().optional(),
  linkedShotIds: z.array(z.string()).optional(),
  source: z.enum(["user", "timing-analysis", "llm", "neuralframes"]).optional(),
  importSource: z.enum(["neuralframes", "manual", "llm", "audio-analysis"]).optional(),
  importId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  storyboard_prompt: z.string().optional(),
  color: z.string().optional(),
});

export const MetadataTrackSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["sections", "notes", "lyrics", "beats", "motifs", "continuity", "custom"]),
  visible: z.boolean(),
  locked: z.boolean(),
  color: z.string().optional(),
  blocks: z.array(MetadataBlockSchema),
});

export const GenerationDefaultsSchema = z.object({
  provider: z.string().optional(),
  shotModel: z.string().optional(),
  referenceModel: z.string().optional(),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
  seed: z.number().optional(),
});

export const CreativeBriefSchema = z.object({
  format: z.string(),
  genre: z.string(),
  visualStyle: z.string(),
  pacing: z.string(),
  continuity: z.string(),
  colorPalette: z.array(z.string()),
  cameraLanguage: z.string(),
  subjectNotes: z.string(),
  customPrompt: z.string(),
  defaults: GenerationDefaultsSchema,
});

export const StoryboardGenerationRequestSchema = z.object({
  creativeBrief: CreativeBriefSchema,
  timing: TimingAnalysisSchema,
  metadataTracks: z.array(MetadataTrackSchema),
  audioDurationSeconds: z.number().positive(),
  shotCount: z.number().int().min(1).max(50).optional().default(8),
});

// ── Output schema (what Claude returns) ────────────────────────────────────

export const GenerationAttemptSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["reference", "shot"]).optional().default("shot"),
  status: z.enum(["pending", "queued", "submitting", "submitted", "processing", "complete", "failed", "cancelled"]).optional().default("pending"),
  provider: z.string().optional(),
  model: z.string().optional(),
  planSnapshot: z.unknown().optional(),
});

export const StoryboardShotOutputSchema = z.object({
  index: z.number().int().min(0),
  label: z.string().min(1).max(200),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  prompt: z.string().min(1).max(2000),
  videoPrompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(1000).optional(),
  style: z.string().max(500).optional(),
  includeMainAudio: z.boolean().optional().default(true),
  referenceAssetIds: z.array(z.string()).optional().default([]),
  generatedAssetIds: z.array(z.string()).optional().default([]),
  validation: ValidationStateSchema.optional(),
  outputs: z.array(GenerationAttemptSchema).optional().default([]),
  selected: z.boolean().optional().default(false),
});

export const StoryboardGenerationOutputSchema = z.object({
  shots: z.array(StoryboardShotOutputSchema).min(1).max(50),
});

// ── Validated request type ─────────────────────────────────────────────────

export type ValidatedStoryboardRequest = z.infer<typeof StoryboardGenerationRequestSchema>;
export type ValidatedStoryboardOutput = z.infer<typeof StoryboardGenerationOutputSchema>;
```

- [ ] Create `apps/orchestrator/src/schemas/index.ts`:
  ```typescript
  export * from "./storyboard-generation.js";
  ```
- [ ] Verify the file parses: `pnpm --filter @openreel/orchestrator typecheck` (will fail until zod dep is in package.json; that's fine for now, will be added in Task 05).
- [ ] Commit: `git add apps/orchestrator/src/schemas/ && git commit -m "feat(orchestrator): add storyboard generation zod schemas"`

**Acceptance:**
- All schemas compile.
- `StoryboardGenerationRequestSchema` validates: creative brief, timing, metadata tracks, audio duration.
- `StoryboardGenerationOutputSchema` validates: array of `StoryboardShotOutput` with required prompt, timing, index.
- Invalid data (missing prompt, negative duration) throws ZodError.

---

### Task 03: Build prompt templates

**Goal:** Create the system and user prompt templates that instruct the LLM to produce a storyboard from creative brief + timing + lyrics.

**File:**
- Create: `apps/orchestrator/src/prompts/storyboard-generation.ts`

**Sub-steps:**
- [ ] Create the prompt module:

```typescript
// apps/orchestrator/src/prompts/storyboard-generation.ts
import type { ValidatedStoryboardRequest } from "../schemas/storyboard-generation.js";

/**
 * System prompt for storyboard generation.
 * Instructs the model to output valid JSON matching the shot schema.
 */
export function buildSystemPrompt(): string {
  return `You are a professional music video storyboard director. Your role is to translate a song's creative brief, timing analysis, and lyrics into a detailed shot-by-shot storyboard.

## Your task
Given a creative brief, timing analysis, and metadata tracks (lyrics, notes, sections), produce a sequence of shots that visually interpret the song.

## Shot structure
Each shot has:
- index (sequential, starting from 0)
- label — a short descriptive name (e.g. "Opening drone shot of city")
- startSeconds, endSeconds — precise timing aligned to song sections/beats
- prompt — a detailed text-to-video / text-to-image prompt describing the visual. Include: subject, action, setting, lighting, camera movement, mood.
- videoPrompt — optional, a shorter prompt optimized for video generation models
- negativePrompt — optional, things to avoid
- style — overall style cue (e.g. "film noir", "VHS", "cinematic")

## Rules
1. Every shot must have a unique index and a non-empty prompt.
2. Shots must be contiguous — the first shot starts at 0s, the last ends at audioDurationSeconds, and there are no gaps between shots.
3. Align shot boundaries with song sections (verse, chorus, bridge, etc.) from the timing analysis.
4. Use the lyrics in the metadata tracks to inform subject matter and pacing.
5. Match the creative brief's visual style, color palette, pacing, and camera language.
6. Keep each shot between 2 and 15 seconds. Faster pacing (rapid/beat-cut) → shorter shots.
7. Output ONLY valid JSON with no commentary before or after. The JSON must match: { "shots": [ ... ] }.

## Output format
{
  "shots": [
    {
      "index": 0,
      "label": "string",
      "startSeconds": number,
      "endSeconds": number,
      "prompt": "detailed description",
      "videoPrompt": "shorter video model prompt (optional)",
      "negativePrompt": "things to avoid (optional)",
      "style": "visual style (optional)",
      "includeMainAudio": true
    }
  ]
}`;
}

/**
 * Build the user message content from a validated request.
 */
export function buildUserPrompt(req: ValidatedStoryboardRequest): string {
  const { creativeBrief, timing, metadataTracks, audioDurationSeconds, shotCount } = req;

  const sectionsBlock = timing.sections
    .map((s) => `  [${s.type}] "${s.label}"  ${s.startSeconds}s → ${s.endSeconds}s  (energy: ${s.energy ?? "?"})`)
    .join("\n");

  const lyricsBlock = metadataTracks
    .filter((t) => t.kind === "lyrics")
    .flatMap((t) => t.blocks)
    .map((b) => `  ${b.startSeconds}s–${b.endSeconds}s: ${b.detail ?? b.label ?? ""}`)
    .join("\n");

  const notesBlock = metadataTracks
    .filter((t) => t.kind === "notes" || t.kind === "motifs")
    .flatMap((t) => t.blocks)
    .map((b) => `  ${b.startSeconds}s–${b.endSeconds}s: ${b.detail ?? b.label ?? ""}`)
    .join("\n");

  return `Generate a ${shotCount}-shot storyboard for a music video with these parameters:

## Creative Brief
- Format: ${creativeBrief.format}
- Genre: ${creativeBrief.genre}
- Visual Style: ${creativeBrief.visualStyle}
- Pacing: ${creativeBrief.pacing}
- Continuity: ${creativeBrief.continuity}
- Color Palette: ${creativeBrief.colorPalette.join(", ")}
- Camera Language: ${creativeBrief.cameraLanguage}
- Subject Notes: ${creativeBrief.subjectNotes}
${creativeBrief.customPrompt ? `- Custom Prompt: ${creativeBrief.customPrompt}` : ""}

## Timing
- Duration: ${audioDurationSeconds}s
${creativeBrief.defaults.resolution ? `- Target Resolution: ${creativeBrief.defaults.resolution}` : ""}
${creativeBrief.defaults.aspectRatio ? `- Aspect Ratio: ${creativeBrief.defaults.aspectRatio}` : ""}

## Song Sections
${sectionsBlock || "  (no sections defined)"}

## Lyrics (timed)
${lyricsBlock || "  (no lyrics loaded)"}

## Notes / Motifs
${notesBlock || "  (no notes)"}

Generate exactly ${shotCount} shots that cover the full ${audioDurationSeconds}s duration.`;
}
```

- [ ] Verify the file compiles (will need typecheck, fine if schemas aren't installed yet): `pnpm --filter @openreel/orchestrator typecheck` (expected to fail until zod is added; this is acceptable).
- [ ] Commit: `git add apps/orchestrator/src/prompts/ && git commit -m "feat(orchestrator): add storyboard generation prompt builder"`

**Acceptance:**
- `buildSystemPrompt()` returns a string containing shot structure rules.
- `buildUserPrompt(req)` returns a formatted string with creative brief, sections, lyrics, notes.
- The output prompts the model to return JSON-only structured output.

---

### Task 04: Implement orchestrator route handler

**Goal:** Create the Express route `POST /api/generate/storyboard` that validates the request, calls the Anthropic API with the prompt, validates the structured output, and returns the result.

**File:**
- Create: `apps/orchestrator/src/routes/storyboard.ts`

**Reference files:**
- `apps/orchestrator/src/routes/wavespeed.ts` — Express Router pattern with error handling
- `apps/orchestrator/src/env.ts` — `claudeToken` and `openaiToken` config access

**Sub-steps:**
- [ ] Read the wavespeed router for the exact Express Router pattern: `apps/orchestrator/src/routes/wavespeed.ts:1-30`
- [ ] Create the route file:

```typescript
// apps/orchestrator/src/routes/storyboard.ts
import { Router } from "express";
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../env.js";
import {
  StoryboardGenerationRequestSchema,
  StoryboardGenerationOutputSchema,
} from "../schemas/storyboard-generation.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts/storyboard-generation.js";
import type { StoryboardGenerationResult, StoryboardShot } from "@openreel/music-video-domain";

export const storyboardRouter = Router();

// POST /api/generate/storyboard
storyboardRouter.post("/", async (req: Request, res: Response) => {
  try {
    // 1. Validate the request body
    const parsed = StoryboardGenerationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
      return;
    }

    const input = parsed.data;

    // 2. Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);
    const promptSnapshot = userPrompt.slice(0, 500); // log first 500 chars

    // 3. Choose provider: Claude (primary), fallback OpenAI (secondary)
    //    Here we use Anthropic Claude; if no token, respond with 503.
    if (!config.claudeToken) {
      res.status(503).json({
        error: "Claude API token not configured",
        hint: "Set CLAUDE_OAUTH_TOKEN in environment",
      });
      return;
    }

    const anthropic = new Anthropic({
      apiKey: config.claudeToken,
    });

    // Call Claude with tool-use structured output
    const modelName = "claude-sonnet-4-20250514"; // or "claude-3-5-sonnet-latest"
    const msg = await anthropic.beta.tools.messages.create({
      model: modelName,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          name: "generate_storyboard",
          description: "Generate a complete shot-by-shot storyboard for a music video",
          input_schema: {
            type: "object",
            properties: {
              shots: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer" },
                    label: { type: "string" },
                    startSeconds: { type: "number" },
                    endSeconds: { type: "number" },
                    prompt: { type: "string" },
                    videoPrompt: { type: "string" },
                    negativePrompt: { type: "string" },
                    style: { type: "string" },
                    includeMainAudio: { type: "boolean" },
                  },
                  required: ["index", "label", "startSeconds", "endSeconds", "prompt"],
                },
              },
            },
            required: ["shots"],
          },
        },
      ],
    });

    // 4. Extract structured output from tool_use block
    const toolBlock = msg.content.find(
      (block): block is Anthropic.Beta.Tools.ToolUseBlock =>
        block.type === "tool_use" && block.name === "generate_storyboard",
    );

    if (!toolBlock || !toolBlock.input) {
      res.status(500).json({
        error: "LLM did not return structured storyboard output",
        raw: msg.content.map((c) => c.type),
      });
      return;
    }

    // 5. Validate the LLM output against Zod schema
    const outputValidation = StoryboardGenerationOutputSchema.safeParse(toolBlock.input);
    if (!outputValidation.success) {
      res.status(422).json({
        error: "LLM output failed schema validation",
        details: outputValidation.error.flatten(),
        rawOutput: toolBlock.input,
      });
      return;
    }

    // 6. Build result with full shot objects  
    const shots: StoryboardShot[] = outputValidation.data.shots.map((s, idx) => ({
      id: `shot-gen-${Date.now()}-${idx}`,
      index: s.index,
      label: s.label,
      startSeconds: s.startSeconds,
      endSeconds: s.endSeconds,
      prompt: s.prompt,
      videoPrompt: s.videoPrompt,
      negativePrompt: s.negativePrompt,
      model: input.creativeBrief.defaults.shotModel || "veo3_fast",
      resolution: input.creativeBrief.defaults.resolution || "720p",
      aspectRatio: input.creativeBrief.defaults.aspectRatio || "16:9",
      style: s.style,
      includeMainAudio: s.includeMainAudio ?? true,
      referenceAssetIds: [],
      generatedAssetIds: [],
      validation: { valid: true, warnings: [], errors: [] },
      outputs: [],
      selected: false,
      fps: undefined,
      renderMode: undefined,
      seed: input.creativeBrief.defaults.seed,
      referenceImageUrl: undefined,
      sectionId: undefined,
    }));

    // 7. Collect warnings (overlaps, gaps)
    const warnings: string[] = [];
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1];
      const curr = shots[i];
      if (Math.abs(prev.endSeconds - curr.startSeconds) > 0.5) {
        warnings.push(
          `Gap between shot ${prev.index} (ends ${prev.endSeconds}s) and shot ${curr.index} (starts ${curr.startSeconds}s)`,
        );
      }
      if (curr.startSeconds < prev.endSeconds) {
        warnings.push(
          `Overlap between shot ${prev.index} (ends ${prev.endSeconds}s) and shot ${curr.index} (starts ${curr.startSeconds}s)`,
        );
      }
    }

    const result: StoryboardGenerationResult = {
      shots,
      generationMeta: {
        provider: "veo",
        model: modelName,
        promptSnapshot,
        temperature: 0.7,
        generatedAt: new Date().toISOString(),
      },
      warnings,
    };

    res.json(result);
  } catch (e) {
    const err = e as Error;
    console.error("[storyboard] generation failed:", err);
    res.status(500).json({
      error: err.message || "Storyboard generation failed",
    });
  }
});
```

- [ ] Run: `pnpm --filter @openreel/orchestrator typecheck` — expected to fail missing dep `@anthropic-ai/sdk` and `zod`; this is okay, dep will be added in Task 05.
- [ ] Commit: `git add apps/orchestrator/src/routes/storyboard.ts && git commit -m "feat(orchestrator): add POST /api/generate/storyboard route"`

**Acceptance:**
- Route validates request body with Zod.
- Calls Anthropic Claude with tool-use structured output mode.
- Validates LLM return against `StoryboardGenerationOutputSchema`.
- Returns 400/422/503 with structured error on failure.
- Returns `StoryboardGenerationResult` on success with warnings for gaps/overlaps.

---

### Task 05: Mount route in app and add deps

**Goal:** Wire the new route into the Express app and install required dependencies.

**Files:**
- Modify: `apps/orchestrator/src/routes/index.ts` — re-export new router
- Modify: `apps/orchestrator/src/app.ts` — mount the route
- Modify: `apps/orchestrator/package.json` — add `@anthropic-ai/sdk` and `zod` dependencies

**Sub-steps:**
- [ ] Edit `apps/orchestrator/src/routes/index.ts`:
  ```
  [index.ts#BA49]
  INS.POST 2:
  +export { storyboardRouter } from "./storyboard";
  ```
- [ ] Edit `apps/orchestrator/src/app.ts` to mount the route:
  ```
  [app.ts#2BE6]
  SWAP 6.=6:
  +import { neuralframesRouter, wavespeedRouter, storyboardRouter } from "./routes/index";
  
  [app.ts#2BE6]
  INS.POST 34:
  +app.use("/api/generate/storyboard", storyboardRouter);
  ```
- [ ] Install dependencies:
  ```bash
  cd apps/orchestrator
  pnpm add @anthropic-ai/sdk zod
  cd ../..
  ```
- [ ] Run typecheck:
  ```bash
  pnpm --filter @openreel/orchestrator typecheck
  ```
  Expected: PASS (if any errors, fix them).
- [ ] Start the orchestrator and verify route mounts:
  ```bash
  pnpm --filter @openreel/orchestrator dev &
  curl -s http://localhost:4041/api/health | grep -o '"claude":[^,}]*'
  ```
  Expected: `"claude":true` (or `false` if no token; route should still be registered).
  ```bash
  curl -s -X POST http://localhost:4041/api/generate/storyboard \
    -H "Content-Type: application/json" \
    -d '{"creativeBrief":{"format":"","genre":"","visualStyle":"","pacing":"","continuity":"","colorPalette":[],"cameraLanguage":"","subjectNotes":"","customPrompt":"","defaults":{}},"timing":{"durationSeconds":30,"markers":[],"energyPoints":[],"sections":[]},"metadataTracks":[],"audioDurationSeconds":30}' | head -c 200
  ```
  Expected: 400 with validation errors (request is intentionally sparse — proving validation works).
- [ ] Commit: `git add apps/orchestrator/package.json apps/orchestrator/src/routes/index.ts apps/orchestrator/src/app.ts pnpm-lock.yaml && git commit -m "feat(orchestrator): wire up storyboard generation route with deps"`

**Acceptance:**
- Route is mounted at `/api/generate/storyboard`.
- `@anthropic-ai/sdk` and `zod` are installed and typecheck passes.
- Health endpoint reflects Claude token presence.
- POST without valid body returns 400 with Zod error detail.

---

### Task 06: Add `applyStoryboardGeneration` store action

**Goal:** Add a store action that takes a `StoryboardGenerationResult` and populates the project's shots array, replacing any existing shots if the user confirms.

**Files:**
- Modify: `apps/web/src/stores/music-video-store.ts`

**Reference files:**
- `apps/web/src/stores/music-video-store.ts:235-263` — `applyNeuralFramesImport` pattern

**Sub-steps:**
- [ ] Read the `applyNeuralFramesImport` implementation from the store. Note how it creates shots, generated assets, and metadata tracks from the import result.
- [ ] Add the `applyStoryboardGeneration` action to the `MusicVideoState` interface (line 36-74):
  ```
  [music-video-store.ts#D617]
  INS.POST 58:
  +  applyStoryboardGeneration: (openreelProjectId: string, result: StoryboardGenerationResult, replaceExisting?: boolean) => void;
  ```
- [ ] Implement the action in the store creator (after `applyNeuralFramesImport`):
  ```
  [music-video-store.ts#D617]
  INS.POST 242:
  +      applyStoryboardGeneration: (openreelProjectId, result, replaceExisting = false) => {
  +        set((s) => {
  +          const p = s.projects[openreelProjectId];
  +          if (!p) return s;
  +          
  +          const existingShotIds = new Set(p.shots.map((sh) => sh.id));
  +          const shots = result.shots.map((shot) => ({
  +            ...shot,
  +            // Keep IDs from existing shots if they match by index (allows re-generation to preserve references)
  +            id: existingShotIds.has(shot.id) ? shot.id : shot.id || crypto.randomUUID(),
  +          }));
  +
  +          const newJobs: GenerationJob[] = [{
  +            id: crypto.randomUUID(),
  +            kind: "shot_batch",
  +            shotIds: shots.map((s) => s.id),
  +            generatedAssetIds: [],
  +            status: "complete",
  +            progress: 1,
  +            createdAt: new Date().toISOString(),
  +            completedAt: new Date().toISOString(),
  +          }];
  +
  +          return {
  +            projects: {
  +              ...s.projects,
  +              [openreelProjectId]: {
  +                ...p,
  +                shots: replaceExisting ? shots : [...p.shots, ...shots],
  +                generationJobs: [...p.generationJobs, ...newJobs],
  +                updatedAt: new Date().toISOString(),
  +              },
  +            },
  +          };
  +        });
  +      },
  ```
- [ ] Write a failing test file `apps/web/src/stores/__tests__/storyboard-generation.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach } from "vitest";
  import { useMusicVideoStore } from "../music-video-store";
  import type { StoryboardGenerationResult } from "@openreel/music-video-domain";

  function makeSampleResult(shotCount = 3): StoryboardGenerationResult {
    return {
      shots: Array.from({ length: shotCount }, (_, i) => ({
        id: `gen-shot-${i}`,
        index: i,
        label: `Shot ${i + 1}`,
        startSeconds: i * 5,
        endSeconds: (i + 1) * 5,
        prompt: `Description for shot ${i + 1}`,
        model: "veo3_fast",
        resolution: "720p",
        aspectRatio: "16:9",
        includeMainAudio: true,
        referenceAssetIds: [],
        generatedAssetIds: [],
        validation: { valid: true, warnings: [], errors: [] },
        outputs: [],
        selected: false,
      })),
      generationMeta: {
        provider: "veo",
        model: "claude-sonnet-4-20250514",
        promptSnapshot: "test prompt",
        temperature: 0.7,
        generatedAt: new Date().toISOString(),
      },
      warnings: [],
    };
  }

  describe("applyStoryboardGeneration", () => {
    const projectId = "test-project";

    beforeEach(() => {
      useMusicVideoStore.setState({ projects: {}, activeProjectId: null });
      const store = useMusicVideoStore.getState();
      store.createProject(projectId, "Test Project");
    });

    it("adds shots to an empty project", () => {
      const result = makeSampleResult(3);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, result);
      const project = useMusicVideoStore.getState().projects[projectId];
      expect(project.shots).toHaveLength(3);
      expect(project.shots[0].label).toBe("Shot 1");
    });

    it("appends shots when replaceExisting is false", () => {
      const first = makeSampleResult(2);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, first);
      const second = makeSampleResult(2);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, second);
      const project = useMusicVideoStore.getState().projects[projectId];
      expect(project.shots).toHaveLength(4);
    });

    it("replaces existing shots when replaceExisting is true", () => {
      const first = makeSampleResult(2);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, first);
      const second = makeSampleResult(3);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, second, true);
      const project = useMusicVideoStore.getState().projects[projectId];
      expect(project.shots).toHaveLength(3);
    });

    it("creates a generation job for the batch", () => {
      const result = makeSampleResult(2);
      useMusicVideoStore.getState().applyStoryboardGeneration(projectId, result);
      const project = useMusicVideoStore.getState().projects[projectId];
      expect(project.generationJobs).toHaveLength(1);
      expect(project.generationJobs[0].kind).toBe("shot_batch");
      expect(project.generationJobs[0].shotIds).toHaveLength(2);
    });
  });
  ```
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/__tests__/storyboard-generation.test.ts`
  Expected: FAIL (action not yet implemented).
- [ ] Implement the production code (as described above).
- [ ] Re-run test: Expected: PASS.
- [ ] Commit: `git add apps/web/src/stores/music-video-store.ts apps/web/src/stores/__tests__/storyboard-generation.test.ts && git commit -m "feat(web): add applyStoryboardGeneration store action"`

**Acceptance:**
- `applyStoryboardGeneration(id, result)` adds shots to the project.
- `replaceExisting: true` clears previous shots before adding new ones.
- A `GenerationJob` (kind: `shot_batch`) is created for traceability.
- Tests pass.

---

### Task 07: Build GenerateStoryboardDialog component

**Goal:** Create a dialog that lets the user trigger storyboard generation, optionally review/refine the creative brief, shows progress, and handles errors.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx`
- Create: `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` — multi-step dialog pattern (pick → form → submitting → error)
- Apps/web already uses `@radix-ui/react-dialog` (confirm from web package.json)

**Sub-steps:**
- [ ] Create the dialog component:

```typescript
// apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx
import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@radix-ui/react-dialog";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { ORCHESTRATOR_URL } from "../../../stores/music-video-store";
import type { StoryboardGenerationRequest, StoryboardGenerationResult } from "@openreel/music-video-domain";
import { Loader2, AlertCircle, CheckCircle2, Wand2 } from "lucide-react";

export interface GenerateStoryboardDialogProps {
  open: boolean;
  onClose: () => void;
  openreelProjectId: string;
}

type Step = "review" | "generating" | "success" | "error";

export function GenerateStoryboardDialog({
  open,
  onClose,
  openreelProjectId,
}: GenerateStoryboardDialogProps) {
  const project = useMusicVideoStore((s) => s.projects[openreelProjectId]);
  const { applyStoryboardGeneration } = useMusicVideoStore();
  const [step, setStep] = useState<Step>("review");
  const [errorMsg, setErrorMsg] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [shotCount, setShotCount] = useState(8);
  const aborterRef = useRef<AbortController | null>(null);

  const handleClose = useCallback(() => {
    aborterRef.current?.abort();
    setStep("review");
    setErrorMsg("");
    setWarnings([]);
    onClose();
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    if (!project || !project.timing || step === "generating") return;
    setStep("generating");
    setErrorMsg("");

    const ac = new AbortController();
    aborterRef.current = ac;

    try {
      const body: StoryboardGenerationRequest = {
        creativeBrief: project.creativeBrief,
        timing: project.timing,
        metadataTracks: project.metadataTracks,
        audioDurationSeconds: project.timing.durationSeconds,
        shotCount,
      };

      const response = await fetch(`${ORCHESTRATOR_URL}/api/generate/storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Generation failed (${response.status})`);
      }

      const result: StoryboardGenerationResult = await response.json();

      // Validate result has shots
      if (!result.shots || result.shots.length === 0) {
        throw new Error("Generation returned no shots");
      }

      applyStoryboardGeneration(openreelProjectId, result, false);
      setWarnings(result.warnings || []);
      setStep("success");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setErrorMsg((err as Error).message);
      setStep("error");
    }
  }, [project, openreelProjectId, shotCount, applyStoryboardGeneration, step]);

  const existingShots = project?.shots ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Wand2 className="w-5 h-5" />
            Generate Storyboard
          </DialogTitle>
        </DialogHeader>

        {step === "review" && (
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              AI will analyze your creative brief and song timing to generate a
              shot-by-shot storyboard.
            </p>

            {existingShots.length > 0 && (
              <div className="text-sm bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800">
                This project already has {existingShots.length} shot{existingShots.length > 1 ? "s" : ""}.
                New shots will be appended.
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Shot count</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={shotCount}
                  onChange={(e) => setShotCount(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm w-8 text-right">{shotCount}</span>
              </div>
            </div>

            {project?.creativeBrief && (
              <div className="text-xs text-muted-foreground space-y-1 border rounded-md p-3">
                <div><span className="font-medium">Style:</span> {project.creativeBrief.visualStyle}</div>
                <div><span className="font-medium">Pacing:</span> {project.creativeBrief.pacing}</div>
                <div><span className="font-medium">Genre:</span> {project.creativeBrief.genre}</div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-md border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!project?.timing}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                <Wand2 className="w-4 h-4" />
                Generate
              </button>
            </div>
          </div>
        )}

        {step === "generating" && (
          <div className="px-6 pb-6 flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating storyboard from creative brief and timing...</p>
          </div>
        )}

        {step === "success" && (
          <div className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Storyboard generated</span>
            </div>
            {warnings.length > 0 && (
              <div className="text-xs text-amber-600 space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Generation failed</span>
            </div>
            <p className="text-sm text-red-700">{errorMsg}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-md border hover:bg-muted"
              >
                Close
              </button>
              <button
                onClick={() => setStep("review")}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Write the test file:
```typescript
// apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerateStoryboardDialog } from "./GenerateStoryboardDialog";
import { useMusicVideoStore } from "../../../stores/music-video-store";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("GenerateStoryboardDialog", () => {
  const projectId = "test-project";

  beforeEach(() => {
    useMusicVideoStore.setState({ projects: {}, activeProjectId: null });
    const store = useMusicVideoStore.getState();
    store.createProject(projectId, "Test");
    store.setTiming(projectId, {
      durationSeconds: 120,
      bpm: 120,
      markers: [],
      energyPoints: [],
      sections: [],
    });
  });

  it("renders the review step with shot count control", () => {
    render(
      <GenerateStoryboardDialog open={true} onClose={() => {}} openreelProjectId={projectId} />
    );
    expect(screen.getByText("Generate Storyboard")).toBeTruthy();
    expect(screen.getByText("Generate")).toBeTruthy();
  });

  it("shows generating state on generate click", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shots: [], generationMeta: {}, warnings: [] }),
    });
    render(
      <GenerateStoryboardDialog open={true} onClose={() => {}} openreelProjectId={projectId} />
    );
    await userEvent.click(screen.getByText("Generate"));
    expect(await screen.findByText(/Generating storyboard/)).toBeTruthy();
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    render(
      <GenerateStoryboardDialog open={true} onClose={() => {}} openreelProjectId={projectId} />
    );
    await userEvent.click(screen.getByText("Generate"));
    expect(await screen.findByText("Generation failed")).toBeTruthy();
    expect(screen.getByText("Network error")).toBeTruthy();
  });

  it("calls onClose when Done is clicked after success", async () => {
    const onClose = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shots: [{ id: "s1", index: 0, label: "Shot 1", startSeconds: 0, endSeconds: 10, prompt: "Test", model: "veo3_fast", resolution: "720p", aspectRatio: "16:9", includeMainAudio: true, referenceAssetIds: [], generatedAssetIds: [], validation: { valid: true, warnings: [], errors: [] }, outputs: [], selected: false }], generationMeta: {}, warnings: [] }),
    });
    render(
      <GenerateStoryboardDialog open={true} onClose={onClose} openreelProjectId={projectId} />
    );
    await userEvent.click(screen.getByText("Generate"));
    expect(await screen.findByText("Storyboard generated")).toBeTruthy();
    await userEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx`
  Expected: FAIL (component doesn't exist yet).
- [ ] Create the component file and implement as described.
- [ ] Re-run: Expected: PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx && git commit -m "feat(web): add generate storyboard dialog"`

**Acceptance:**
- Dialog opens with review step showing shot count slider and creative brief summary.
- Clicking "Generate" transitions to generating state with spinner.
- On success, shows checkmark and warnings; "Done" closes dialog.
- On error, shows error message with "Try Again" button.
- Disabled "Generate" button when no timing analysis is available.

---

### Task 08: Add frontend API client for generation endpoint

**Goal:** Create a typed client wrapper for the storyboard generation endpoint to keep the dialog thin.

**Files:**
- Create: `apps/web/src/services/anthropic/index.ts` (or `apps/web/src/services/storyboard/index.ts`)
- Create: `apps/web/src/services/anthropic/anthropic.test.ts`

**Sub-steps:**
- [ ] Create the service file:

```typescript
// apps/web/src/services/storyboard/index.ts
import { ORCHESTRATOR_URL } from "../../stores/music-video-store";
import type { StoryboardGenerationRequest, StoryboardGenerationResult } from "@openreel/music-video-domain";

export interface StoryboardGenerationOptions {
  signal?: AbortSignal;
}

export async function generateStoryboard(
  request: StoryboardGenerationRequest,
  options?: StoryboardGenerationOptions,
): Promise<StoryboardGenerationResult> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/generate/storyboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options?.signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `Storyboard generation failed (${response.status})`);
  }

  return response.json() as Promise<StoryboardGenerationResult>;
}
```

- [ ] Update `GenerateStoryboardDialog.tsx` to import and use this service instead of raw `fetch`.

- [ ] Write test:
```typescript
// apps/web/src/services/storyboard/storyboard.test.ts
import { describe, it, expect, vi } from "vitest";
import { generateStoryboard } from "./index";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("generateStoryboard", () => {
  const minimalRequest = {
    creativeBrief: {
      format: "narrative", genre: "pop", visualStyle: "noir", pacing: "medium",
      continuity: "continuous", colorPalette: ["red", "black"], cameraLanguage: "static",
      subjectNotes: "", customPrompt: "", defaults: {},
    },
    timing: { durationSeconds: 120, bpm: 120, markers: [], energyPoints: [], sections: [] },
    metadataTracks: [],
    audioDurationSeconds: 120,
  };

  it("returns result on success", async () => {
    const fakeResult = { shots: [], generationMeta: {} as any, warnings: [] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeResult,
    });
    const result = await generateStoryboard(minimalRequest);
    expect(result).toEqual(fakeResult);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Bad request" }),
    });
    await expect(generateStoryboard(minimalRequest)).rejects.toThrow("Bad request");
  });

  it("passes AbortSignal to fetch", async () => {
    const ac = new AbortController();
    const signal = ac.signal;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ shots: [], generationMeta: {} as any, warnings: [] }) });
    await generateStoryboard(minimalRequest, { signal });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal }),
    );
  });
});
```

- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/services/storyboard/storyboard.test.ts`
  Expected: PASS (after creating the service).
- [ ] Commit: `git add apps/web/src/services/storyboard/ && git commit -m "feat(web): add storyboard generation API client"`

**Acceptance:**
- `generateStoryboard()` calls orchestrator POST endpoint.
- Throws with server error message on failure.
- Passes AbortSignal for cancellation.
- Tests pass.

---

### Task 09: Wire Generate button into StoryboardPanel

**Goal:** Add a "Generate" button to the `StoryboardPanel` header that opens the `GenerateStoryboardDialog`.

**Files:**
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`

**Reference files:**
- `docs/superpowers/plans/2026-07-03-storyboard-ui.md:237-320` for existing StoryboardPanel structure

**Sub-steps:**
- [ ] Read the existing `StoryboardPanel.tsx` to find the header section.
- [ ] Add the generate button import and trigger in the header, between the shot count and the close button:

```typescript
// In imports
import { GenerateStoryboardDialog } from "./GenerateStoryboardDialog";
import { Wand2 } from "lucide-react";  // Add to existing lucide-react imports

// In component body, add state
const [genOpen, setGenOpen] = useState(false);

// In the header section (after shot count display)
{/* Add generate button */}
<button
  onClick={() => setGenOpen(true)}
  className="p-1 hover:bg-muted rounded text-xs flex items-center gap-1"
  title="Generate storyboard from creative brief"
>
  <Wand2 className="w-3.5 h-3.5" />
</button>

// At the bottom of the component, before the closing fragment
{genOpen && (
  <GenerateStoryboardDialog
    open={genOpen}
    onClose={() => setGenOpen(false)}
    openreelProjectId={openreelProjectId}
  />
)}
```

- [ ] Re-export from `apps/web/src/components/editor/storyboard/index.ts` (if GenerateStoryboardDialog isn't already there).
- [ ] Run typecheck: `pnpm --filter @openreel/web typecheck` — Expected: PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/StoryboardPanel.tsx apps/web/src/components/editor/storyboard/index.ts && git commit -m "feat(web): wire generate storyboard button into panel"`

**Acceptance:**
- Storyboard panel header shows a wand icon button.
- Clicking opens `GenerateStoryboardDialog`.
- Dialog generates shots and the panel re-renders with new shots.

---

### Task 10: Test backend handler and schema validation

**Goal:** Unit test the Zod schema validation and the prompt builder independently. Integration-test the route with a mocked Anthropic client.

**Files:**
- Create: `apps/orchestrator/tests/storyboard-generation.test.ts`

**Sub-steps:**
- [ ] Create the test file:

```typescript
// apps/orchestrator/tests/storyboard-generation.test.ts
import { describe, it, expect } from "vitest"; // or node:test
import {
  StoryboardGenerationRequestSchema,
  StoryboardGenerationOutputSchema,
} from "../src/schemas/storyboard-generation.js";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompts/storyboard-generation.js";

describe("StoryboardGenerationRequestSchema", () => {
  const validRequest = {
    creativeBrief: {
      format: "narrative",
      genre: "pop",
      visualStyle: "noir",
      pacing: "medium",
      continuity: "continuous",
      colorPalette: ["red"],
      cameraLanguage: "static",
      subjectNotes: "A story about loss",
      customPrompt: "",
      defaults: {},
    },
    timing: {
      durationSeconds: 120,
      bpm: 120,
      markers: [],
      energyPoints: [],
      sections: [
        { id: "s1", label: "Intro", startSeconds: 0, endSeconds: 16, type: "intro" },
      ],
    },
    metadataTracks: [],
    audioDurationSeconds: 120,
  };

  it("accepts a valid request", () => {
    const result = StoryboardGenerationRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("requires audioDurationSeconds to be positive", () => {
    const result = StoryboardGenerationRequestSchema.safeParse({
      ...validRequest,
      audioDurationSeconds: -1,
    });
    expect(result.success).toBe(false);
  });

  it("defaults shotCount to 8", () => {
    const result = StoryboardGenerationRequestSchema.parse(validRequest);
    expect(result.shotCount).toBe(8);
  });

  it("accepts explicit shotCount", () => {
    const result = StoryboardGenerationRequestSchema.parse({
      ...validRequest,
      shotCount: 12,
    });
    expect(result.shotCount).toBe(12);
  });
});

describe("StoryboardGenerationOutputSchema", () => {
  it("accepts a valid shot array", () => {
    const output = {
      shots: [
        {
          index: 0,
          label: "Opening shot",
          startSeconds: 0,
          endSeconds: 10,
          prompt: "A lone figure walks through a neon-lit city at night, slow push-in",
        },
        {
          index: 1,
          label: "Verse 1",
          startSeconds: 10,
          endSeconds: 30,
          prompt: "Close up of the figure's face, rain on window, moody blue lighting",
        },
      ],
    };
    const result = StoryboardGenerationOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
    expect(result.data!.shots).toHaveLength(2);
  });

  it("rejects shots with missing prompt", () => {
    const output = {
      shots: [
        {
          index: 0,
          label: "Bad shot",
          startSeconds: 0,
          endSeconds: 10,
          // prompt missing
        },
      ],
    };
    const result = StoryboardGenerationOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects empty shot arrays", () => {
    const result = StoryboardGenerationOutputSchema.safeParse({ shots: [] });
    expect(result.success).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("returns a string containing shot guidance", () => {
    const prompt = buildSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("storyboard");
    expect(prompt).toContain("shots");
  });
});

describe("buildUserPrompt", () => {
  it("formats creative brief and timing into a prompt", () => {
    const req = StoryboardGenerationRequestSchema.parse({
      creativeBrief: {
        format: "narrative",
        genre: "pop",
        visualStyle: "noir",
        pacing: "rapid",
        continuity: "independent shots",
        colorPalette: ["red", "black"],
        cameraLanguage: "handheld",
        subjectNotes: "Urban decay theme",
        customPrompt: "Make it gritty",
        defaults: { provider: "veo", shotModel: "veo3_fast", referenceModel: "", resolution: "720p", aspectRatio: "16:9" },
      },
      timing: {
        durationSeconds: 60,
        bpm: 128,
        markers: [],
        energyPoints: [],
        sections: [
          { id: "s1", label: "Drop", startSeconds: 0, endSeconds: 30, type: "drop" },
          { id: "s2", label: "Verse", startSeconds: 30, endSeconds: 60, type: "verse" },
        ],
      },
      metadataTracks: [],
      audioDurationSeconds: 60,
      shotCount: 6,
    });

    const prompt = buildUserPrompt(req);
    expect(prompt).toContain("noir");
    expect(prompt).toContain("rapid");
    expect(prompt).toContain("handheld");
    expect(prompt).toContain("60s");
    expect(prompt).toContain("6 shots");
    expect(prompt).toContain("Make it gritty");
  });
});
```

- [ ] Run: `cd apps/orchestrator && npx vitest run tests/storyboard-generation.test.ts` (or `node --test tests/storyboard-generation.test.ts` if orchestrator uses node:test). If vitest isn't configured, use `node --import tsx --test tests/storyboard-generation.test.ts`.
  Expected: all tests PASS.
- [ ] Commit: `git add apps/orchestrator/tests/storyboard-generation.test.ts && git commit -m "test(orchestrator): add storyboard generation schema and prompt tests"`

**Acceptance:**
- Request validation accepts valid payloads, rejects negative duration.
- Output validation accepts valid shot arrays, rejects missing prompts.
- System prompt contains shot structure guidance.
- User prompt interpolates creative brief fields and timing data.

---

### Task 11: Test frontend store action and dialog

**Goal:** Already partially covered in Task 06 and Task 07. Run all frontend tests for the storyboard generation feature together.

**Sub-steps:**
- [ ] Run ALL storyboard generation frontend tests:
  ```bash
  pnpm --filter @openreel/web test:run \
    apps/web/src/stores/__tests__/storyboard-generation.test.ts \
    apps/web/src/services/storyboard/storyboard.test.ts \
    apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.test.tsx
  ```
  Expected: All PASS.
- [ ] If any fail, debug and fix —- do not commit broken tests.
- [ ] Commit: `git add --all && git commit -m "test(web): verify storyboard generation store, service, and dialog"` (only if test files weren't already committed in their task commits).

**Acceptance:**
- All 10+ unit tests pass for store actions, API client, and dialog component.

---

### Task 12: Smoke test end-to-end workflow

**Goal:** Verify the full flow works: orchestrator route responds, storyboard dialog triggers generation, shots appear in the panel.

**Sub-steps:**
- [ ] Start the orchestrator:
  ```bash
  pnpm --filter @openreel/orchestrator dev &
  ```
- [ ] Verify the route is mounted:
  ```bash
  curl -s http://localhost:4041/api/health | python3 -m json.tool
  ```
  Expected: `"claude": true` or `false` (depending on token presence).
- [ ] Send a minimal storyboard generation request (will fail with 503 if no CLAUDE_OAUTH_TOKEN, proving validation works):
  ```bash
  curl -s -X POST http://localhost:4041/api/generate/storyboard \
    -H "Content-Type: application/json" \
    -d '{
      "creativeBrief": {
        "format": "narrative", "genre": "pop", "visualStyle": "noir",
        "pacing": "medium", "continuity": "continuous",
        "colorPalette": ["red","black"], "cameraLanguage": "static",
        "subjectNotes": "Test", "customPrompt": "", "defaults": {}
      },
      "timing": {
        "durationSeconds": 30, "bpm": 120, "markers": [],
        "energyPoints": [],
        "sections": [{"id":"s1","label":"V1","startSeconds":0,"endSeconds":30,"type":"verse"}]
      },
      "metadataTracks": [],
      "audioDurationSeconds": 30,
      "shotCount": 4
    }' | python3 -m json.tool
  ```
  Expected: if CLAUDE_OAUTH_TOKEN set -> `{ "shots": [...], "generationMeta": {...}, "warnings": [...] }`; if not set -> `{ "error": "Claude API token not configured", "hint": "..." }`.

- [ ] Kill the background orchestrator: `kill %1`

- [ ] Skip the full browser-based E2E test (depends on storyboard UI being complete from the parallel plan), but verify the dialog imports and compiles:
  ```bash
  pnpm --filter @openreel/web build
  ```
  Expected: Build succeeds with no errors.

- [ ] **If CLAUDE_OAUTH_TOKEN is set** and the orchestrator is running, the generation should return real shots. Document any issues as follow-up items.

- [ ] Commit: no code changes — this is a verification step only.

**Acceptance:**
- Orchestrator route responds to valid requests with structured JSON.
- If Claude token is configured and API is reachable, real storyboard shots are generated.
- Frontend builds without errors.
- Full workflow: dialog opens -> calls API -> shots appear in storyboard panel.

---

## Risks and unresolved decisions

1. **Claude model availability**: The plan targets `claude-sonnet-4-20250514`. If this model isn't available or has regressions, fall back to `claude-3-5-sonnet-latest` or `claude-opus-4-20250514`. The route uses a single `model` variable that can be swapped per deployment.
2. **Structured output reliability**: Claude's tool-call JSON mode is used. If the model sometimes returns free text instead of a tool call, the route catches this and returns a 500 with the raw content types. Future improvement: add a retry loop (max 2 attempts) with the previous response as a correction hint.
3. **OpenAI fallback**: The orchestrator has `OPENAI_TOKEN` configured. If Claude consistently fails, a future enhancement could switch to OpenAI with `response_format: { type: "json_object" }` for structured output. Not in scope for this plan.
4. **Shot count vs. timing edge case**: If the user requests 30 shots for a 30-second song, each shot would be ~1 second, which may produce unrealistic output. The Zod schema limits shotCount to max 50, and the prompt includes a 2–15 second per-shot guidance. Add post-generation validation that warns when shots are under 1s.
5. **UI integration dependency**: The `GenerateStoryboardDialog` is wired into `StoryboardPanel`, which is being built concurrently in the storyboard UI plan. The type imports and dialog interface are designed to not block — the panel just conditionally renders the dialog. If the panel isn't ready, the dialog can be tested and used independently.
6. **Token cost**: A full storyboard generation with 12 shots for a 4-minute song might consume 2K–4K input tokens and generate ~2K output tokens. At Claude Sonnet 4 pricing (~$3/M input, $15/M output), this is approximately $0.04 per generation. Free tier users hitting this frequently could run up costs — consider adding a confirmation step or rate limit in a follow-up.
7. **Cancellation**: The dialog uses `AbortController` to cancel in-flight requests. The orchestrator route does not currently propagate abort signals to the Anthropic API — the HTTP connection is closed but the Anthropic request may still complete server-side. This is acceptable for v1.
