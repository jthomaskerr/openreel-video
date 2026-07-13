# Alter Storyboard Tool Implementation Plan

> **Audit status (2026-07-13): NOT IMPLEMENTED; REVISION REQUIRED.** Canonical owner: `docs/spec/storyboard.md`. No `AlterStoryboard` domain, route, validator, dialog, or tests are present. The planned hosted API call also conflicts with the repository rule requiring reusable LLM work to use local Claude Code unless explicitly authorized.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an alter-storyboard tool that accepts "what to change" and "how to change it" params, receives confirmed song sections as structural context, generates a diff-driven preview, and applies changes only after user acceptance.

**Architecture:** A new `AlterStoryboardDialog` component opens from the InspectorPanel's Storyboard section, mirroring the `GenerateAssetDialog` pattern. An orchestrator route (`POST /api/tools/alter-storyboard`) accepts a structured request with confirmed song sections, calls an LLM to produce a diff/patch over the shot list or creative brief, validates the patch, and returns a diff record. The LLM must preserve section boundaries unless the user's instruction explicitly asks to change structure; section edits require the same preview/accept flow as shot edits. No project state is mutated before acceptance.

**Tech Stack:** React, Zustand, Vitest, Express (orchestrator), existing `CreativeBrief`/`StoryboardShot`/`MusicVideoProject` types from `@openreel/music-video-domain`, existing `InfoIcon`/`Button`/`Dialog` from `@openreel/ui`.

---

## Execution contract

- One task = one atomic commit.
- Each task uses TDD: write the failing test, run it and record the expected failure, implement minimum code, run passing test, commit.
- Do not batch unrelated tasks into one commit.
- The patch model is immutable-diff: the LLM returns a `StoryboardDiff` describing before/after for each changed item; the client never trusts the LLM output as-is — it validates field types and shot existence before rendering the preview.
- No project state is mutated until the user clicks "Apply".
- The orchestrator route MUST validate that requested shot IDs exist in the project before delegating to the LLM.

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Define StoryboardDiff and AlterRequest types | none | false | `feat: add alter-storyboard types` |
| 02 | Implement LLM prompt strategy for diff generation | task-01 | false | `feat: add alter-storyboard prompt strategy` |
| 03 | Add orchestrator route POST /api/tools/alter-storyboard | task-02 | false | `feat: add alter-storyboard API route` |
| 04 | Build AlterStoryboardDialog component | task-01 | true | `feat: add AlterStoryboardDialog UI` |
| 05 | Wire dialog into InspectorPanel and MVP integration | task-04, task-03 | false | `feat: wire alter-storyboard into inspector` |
| 06 | Add diff preview with accept/reject flow | task-04 | false | `feat: add diff preview and accept/reject` |
| 07 | Add validation guard layer for patch safety | task-06 | false | `feat: validate patches before apply` |
| 08 | Add tests for all layers | task-07 | false | `feat: add alter-storyboard test suite` |
| 09 | End-to-end smoke test | task-08 | false | `chore: verify alter-storyboard workflow` |

---

## Data types

### Pulled from existing types (`packages/music-video-domain/src/types.ts`)

- `StoryboardShot` — the per-shot model (id, index, label, startSeconds, endSeconds, prompt, videoPrompt, negativePrompt, model, resolution, aspectRatio, fps, style, renderMode, seed, includeMainAudio, referenceAssetIds, generatedAssetIds, validation, outputs, selected)
- `CreativeBrief` — the creative-direction model (format, genre, visualStyle, pacing, continuity, colorPalette, cameraLanguage, subjectNotes, customPrompt, defaults)
- `EditableSongSection` — confirmed arranger-style song sections from `2026-07-03-section-identification-flow.md`; alter prompts must preserve these boundaries unless explicitly asked to change them
- `MusicVideoProject.shots` — the shot array
- `MusicVideoProject.creativeBrief` — the brief object
- `patchShot(openreelProjectId, shotId, patch)` — existing store mutation
- `setShots(openreelProjectId, shots)` — existing store mutation
- `updateCreativeBrief(openreelProjectId, patch)` — from `MusicVideoState`

### New types (file: `packages/music-video-domain/src/types.ts`, append)

```ts
// ── Alter storyboard types ─────────────────────────────────────────────────────

/** What aspect of the storyboard to change. */
export type AlterSubject =
  | { kind: "shots"; shotIds: string[] }       // one or more shots
  | { kind: "all-shots" }                      // every shot
  | { kind: "creative-brief" }                 // the brief
  | { kind: "selected-shots" };                // shots with selected=true

/** How to change the subject — a natural-language "instruction" paired with optional overrides. */
export interface AlterInstruction {
  /** The natural-language description of what to change (e.g. "Make every scene more cinematic, add dramatic lighting") */
  text: string;
  /**
   * Optional explicit field overrides.
   * Keys are field paths (e.g. "prompt", "videoPrompt", "model", "style", "aspectRatio").
   * When both `text` and `overrides` specify the same field, the override wins.
   */
  overrides?: Record<string, string>;
}

/** Complete request body for the alter-storyboard tool. */
export interface AlterStoryboardRequest {
  projectId: string;
  subject: AlterSubject;
  instruction: AlterInstruction;
  /** Confirmed song sections from the section identification flow; used as hard structure for prompt context */
  confirmedSections: EditableSongSection[];
}

/** One change unit — a before/after pair for a single field. */
export interface FieldDiff {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/** One changed entity (shot or creative-brief). */
export interface EntityDiff {
  /** The shot ID or "creative-brief" */
  entityId: string;
  /** Human-readable label (e.g. "Scene 3", "Creative Brief") */
  label: string;
  /** Per-field changes. Empty array when the LLM left this entity untouched. */
  fields: FieldDiff[];
}

/** The full diff response from the orchestrator. */
export interface StoryboardDiff {
  /** The project these changes apply to */
  projectId: string;
  /** ISO timestamp of when the diff was generated */
  generatedAt: string;
  /** The request that produced this diff */
  request: AlterStoryboardRequest;
  /** Per-entity change set */
  entities: EntityDiff[];
  /** Summary counts */
  summary: {
    totalEntities: number;
    changedEntities: number;
    totalFields: number;
  };
  /** Validation — are all field types compatible? */
  valid: boolean;
  /** Rejection reason when valid=false */
  validationError?: string;
}

/** POST /api/tools/alter-storyboard response */
export interface AlterStoryboardResponse {
  diff: StoryboardDiff;
  /** The raw LLM output (for debugging / refinement) */
  rawLlmOutput: string;
}
```

---

## Atomic task plans

---

### Task 01: Define StoryboardDiff and AlterRequest types

**Goal:** Add all alter-storyboard types to the shared domain package.

**Files:**
- Modify: `packages/music-video-domain/src/types.ts` (append after line ~372)
- Test: `packages/music-video-domain/test/types.test.ts` (or inline if no test file exists)

**Reference files:**
- `packages/music-video-domain/src/types.ts` — existing types
- `packages/music-video-domain/src/index.ts` — export surface

**TDD steps:**
- [ ] Check if `packages/music-video-domain` has a test directory: `ls packages/music-video-domain/src/../../test/ 2>/dev/null || echo "no test dir"`.
- [ ] Write failing test: Add tests for all new type constructors — `AlterSubject`, `AlterInstruction`, `AlterStoryboardRequest`, `FieldDiff`, `EntityDiff`, `StoryboardDiff`, `AlterStoryboardResponse`.
- [ ] Run to verify red: `pnpm --filter @openreel/music-video-domain test:run` (or `vitest run` inside the package). Expected: FAIL — types not exported.
- [ ] Append types to `packages/music-video-domain/src/types.ts` (the `// ── Alter storyboard types ──` section above).
- [ ] Export from `packages/music-video-domain/src/index.ts`: add `export type { AlterSubject, AlterInstruction, AlterStoryboardRequest, FieldDiff, EntityDiff, StoryboardDiff, AlterStoryboardResponse } from "./types.js";`
- [ ] Run to verify green: `pnpm --filter @openreel/music-video-domain test:run`. Expected: PASS.
- [ ] Commit: `git add packages/music-video-domain/src/types.ts packages/music-video-domain/src/index.ts packages/music-video-domain/test/types.test.ts && git commit -m "feat: add alter-storyboard types"`

**Acceptance criteria:**
- All 7 new types are exported from `@openreel/music-video-domain`.
- Types compile without error.
- `AlterSubject` correctly discriminates all 4 `kind` variants.

---

### Task 02: Implement LLM prompt strategy for diff generation

**Goal:** Build the prompt template and response parser that takes `AlterStoryboardRequest` + shot/brief context and returns a structured `StoryboardDiff`.

**Files:**
- Create: `packages/music-video-domain/src/alter-storyboard-prompt.ts`
- Create: `packages/music-video-domain/test/alter-storyboard-prompt.test.ts`
- Modify: `packages/music-video-domain/src/index.ts` (export new symbols)

**Reference files:**
- `packages/music-video-domain/src/neuralframes.ts` — existing domain logic pattern
- `packages/music-video-domain/src/adapter.ts` — data transformation pattern
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` — model-invocation pattern

**Structure of `alter-storyboard-prompt.ts`:**

```ts
export interface AlterPromptContext {
  /** The shot list (full objects — id, label, prompt, style, etc.) */
  shots: StoryboardShot[];
  /** The creative brief, if subject includes it */
  creativeBrief?: CreativeBrief;
  /** Whether the brief is in scope */
  includeBrief: boolean;
}

/**
 * Build the system prompt for the alter-storyboard LLM call.
 * The prompt instructs the LLM to output ONLY a valid StoryboardDiff JSON.
 */
export function buildAlterSystemPrompt(): string;

/**
 * Build the user message content: the request + context.
 */
export function buildAlterUserPrompt(
  request: AlterStoryboardRequest,
  context: AlterPromptContext,
): string;

/**
 * Parse the raw LLM output into a StoryboardDiff.
 * Validates that all field values match the expected types for StoryboardShot/CreativeBrief fields.
 * Returns { diff, rawLlmOutput } or throws with a descriptive error on parse failure.
 */
export function parseAlterResponse(
  rawLlmOutput: string,
  request: AlterStoryboardRequest,
): { diff: StoryboardDiff; rawLlmOutput: string };

/** Known field schema for validating patch values before returning to client. */
export const SHOT_FIELD_SCHEMA: Record<string, "string" | "number" | "boolean">;
export const BRIEF_FIELD_SCHEMA: Record<string, "string" | "number" | "boolean" | "array">;

/**
 * Validate that a StoryboardDiff passes safety checks:
 * - All entityIds referenced in entities exist in the project.
 * - Every field value matches its expected type per SHOT_FIELD_SCHEMA / BRIEF_FIELD_SCHEMA.
 * - No new fields are introduced.
 * - No shot IDs are added or removed (only field-level changes).
 */
export function validateStoryboardDiff(
  diff: StoryboardDiff,
  context: AlterPromptContext,
): { valid: boolean; error?: string };
```

**Prompt strategy (to embed in `buildAlterSystemPrompt`):**
```
You are a storyboard editing assistant. Given a music video storyboard with shots and a creative brief, produce a JSON diff describing only the changes requested.

RULES:
- Output ONLY valid JSON. No markdown, no explanation.
- For each changed entity, list every field that differs from the original.
- Never add or remove shots.
- Never change a shot's id, index, startSeconds, endSeconds, generatedAssetIds, referenceAssetIds, or validation fields unless the instruction explicitly requests timing changes.
- When a shot prompt changes and no explicit style/negativePrompt is given, keep the existing style/negativePrompt.
- The `after` value MUST match the field's type (string for prompt/style, number for seed, boolean for includeMainAudio, etc.).
```

**TDD steps:**
- [ ] Create `alter-storyboard-prompt.ts` with exported function signatures (no-ops initially).
- [ ] Write failing test: `buildAlterSystemPrompt` returns a non-empty string; `buildAlterUserPrompt` includes shot labels and prompts in the returned string; `parseAlterResponse` correctly parses a known-good LLM JSON output and throws on invalid JSON.
- [ ] Run to verify red: `pnpm --filter @openreel/music-video-domain test:run`.
- [ ] Implement the minimal prompt builders and parser/validator.
- [ ] Run to verify green.
- [ ] Commit: `git add packages/music-video-domain/src/alter-storyboard-prompt.ts packages/music-video-domain/test/alter-storyboard-prompt.test.ts packages/music-video-domain/src/index.ts && git commit -m "feat: add alter-storyboard prompt strategy"`

**Acceptance criteria:**
- `buildAlterSystemPrompt()` returns a complete system prompt string.
- `buildAlterUserPrompt()` includes all shot labels and their current prompts.
- `parseAlterResponse()` handles valid JSON, invalid JSON, and JSON-with-markdown-fence gracefully.
- `validateStoryboardDiff()` rejects diffs with unknown fields or type mismatches.

---

### Task 03: Add orchestrator route POST /api/tools/alter-storyboard

**Goal:** New Express route in the orchestrator that accepts `AlterStoryboardRequest`, fetches shot/brief context, calls an LLM via the configured provider, parses the response, and returns `AlterStoryboardResponse`.

**Files:**
- Create: `apps/orchestrator/src/routes/alter-storyboard.ts`
- Create: `apps/orchestrator/src/services/llm-client.ts` (thin wrapper around the provider API)
- Create: `apps/orchestrator/test/routes/alter-storyboard.test.ts`
- Modify: `apps/orchestrator/src/routes/index.ts` (export new router)
- Modify: `apps/orchestrator/package.json` (add any LLM SDK dependency)

**Reference files:**
- `apps/orchestrator/src/routes/neuralframes.ts` — existing POST route pattern
- `apps/orchestrator/src/routes/wavespeed.ts` — job submission pattern
- `apps/orchestrator/src/env.js` — config/env pattern

**Route spec:**

```
POST /api/tools/alter-storyboard

Request body (json):
  projectId: string          — the music-video project ID
  subject: AlterSubject       — what to change
  instruction: AlterInstruction

Response 200 (json):
  diff: StoryboardDiff
  rawLlmOutput: string

Response 400:
  { error: "message" }

Response 500:
  { error: "message" }
```

**Implementation notes:**
- The route receives an orchestrator-level project reference (or just a project ID the client resolves). For v1, accept the projectId as a lookup key; the orchestrator can load the project from the `ProjectStore` to supply context to the LLM.
- Delegate prompt building to `@openreel/music-video-domain`'s `buildAlterSystemPrompt`/`buildAlterUserPrompt`.
- Use `fetch` to call a configurable LLM endpoint (env: `LLM_API_URL`, `LLM_API_KEY`) — keep it provider-agnostic.
- Validate the response via `validateStoryboardDiff` before returning.
- Log raw LLM output for debugging.

**TDD steps:**
- [ ] Write failing test: POST to `/api/tools/alter-storyboard` with a valid request returns 200 with a `diff` property; POST with an invalid `subject` returns 400.
- [ ] Run to verify red: `pnpm --filter @openreel/orchestrator test:run`.
- [ ] Implement the route, service, and integration.
- [ ] Run to verify green.
- [ ] Commit: `git add apps/orchestrator/src/routes/alter-storyboard.ts apps/orchestrator/src/services/llm-client.ts apps/orchestrator/test/routes/alter-storyboard.test.ts apps/orchestrator/src/routes/index.ts apps/orchestrator/package.json && git commit -m "feat: add alter-storyboard API route"`

**Acceptance criteria:**
- Route accepts valid `AlterStoryboardRequest` bodies and returns 200.
- Route returns 400 for missing/invalid fields.
- Route returns 500 when LLM call fails.
- Response includes both structured `diff` and `rawLlmOutput`.

---

### Task 04: Build AlterStoryboardDialog component

**Goal:** A new dialog component (`AlterStoryboardDialog`) that mirrors the `GenerateAssetDialog` pattern — opens from the InspectorPanel, lets the user select "what" (which shots or the brief) and "how" (a text instruction + optional overrides), submits to the API, and displays the resulting diff.

**Files:**
- Create: `apps/web/src/components/editor/alter/AlterStoryboardDialog.tsx`
- Create: `apps/web/src/components/editor/alter/AlterStoryboardSubjectPicker.tsx`
- Create: `apps/web/src/components/editor/alter/AlterStoryboardDiffPreview.tsx`
- Create: `apps/web/src/components/editor/alter/index.ts`
- Create: `apps/web/test/components/editor/alter/AlterStoryboardDialog.test.tsx`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` — dialog pattern (open/close, step state, submission flow)
- `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx` — where the button will go
- `apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx` — existing shot editing pattern
- `apps/web/src/stores/music-video-store.ts` — existing store actions

**Dialog flow:**
1. **Step "select"** — the user picks the subject:
   - Radio/toggle: "Selected shots", "All shots", "Creative brief"
   - When "Selected shots" is chosen, show a checklist of all shots (label + truncated prompt).
   - Text area for "how" — the `instruction.text` field.
   - Optional expandable section for field overrides (seed, model, style, aspectRatio — text inputs).
2. **Step "preview"** — the dialog calls the API and shows the `StoryboardDiff` as a side-by-side or per-shot diff list. Each changed entity shows a before/after card.
3. **Step "accepted"** — "Apply Changes" button commits via `patchShot`/`setShots`/`updateCreativeBrief`.
4. **Step "error"** — API call failed or validation failed; show error + retry.

**State management:**
- Local React state for the dialog steps (no global store needed).
- Reads shot/brief data from `useMusicVideoStore(s => s.projects[activeProjectId])`.
- On accept, dispatches existing store actions.
- The dialog does NOT hold a reference to the orchestrator; it calls a service function `submitAlterRequest(request: AlterStoryboardRequest): Promise<AlterStoryboardResponse>`.

**Service file** (`apps/web/src/services/alter-storyboard.ts`):

```ts
import { ORCHESTRATOR_URL } from "../../stores/music-video-store";
import type { AlterStoryboardRequest, AlterStoryboardResponse } from "@openreel/music-video-domain";

export async function submitAlterRequest(
  request: AlterStoryboardRequest,
): Promise<AlterStoryboardResponse> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/tools/alter-storyboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Alter request failed (${res.status})`);
  }
  return res.json();
}
```

**TDD steps:**
- [ ] Write failing test for `AlterStoryboardDialog`: renders when `open=true`, does not render when `open=false`; shows subject picker options; calls API on submit; shows diff preview on success.
- [ ] Write failing test for `submitAlterRequest`: on 200 returns parsed response; on 400 throws error.
- [ ] Run to verify red: `pnpm --filter @openreel/web test:run`.
- [ ] Implement all dialog components, the service layer, and the diff preview rendering.
- [ ] Run to verify green.
- [ ] Commit: `git add apps/web/src/components/editor/alter/ apps/web/test/components/editor/alter/ && git commit -m "feat: add AlterStoryboardDialog UI"`

**Acceptance criteria:**
- Dialog opens/closes controlled by parent via `open`/`onClose` props.
- Subject selection correctly filters shots.
- Text instruction area accepts multi-line input.
- Optional overrides section appears/collapses.
- API call fires on "Generate Preview" button.
- Diff preview renders before/after for each changed field.
- Errors shown inline with retry option.

---

### Task 05: Wire dialog into InspectorPanel and MVP integration

**Goal:** Add the "Alter Storyboard" entry point to the existing InspectorPanel's Storyboard section so users can discover and invoke the tool.

**Files:**
- Modify: `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx`
- Modify: `apps/web/src/components/editor/InspectorPanel.tsx` (if state management needed)

**Reference files:**
- `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx` — the storyboard section currently shows `<NewMetadataButton kind="scene" />`. Add an "Alter" button next to it.
- `apps/web/src/components/editor/InspectorPanel.tsx` — this is where state for the dialog will live.

**Implementation:**
- Add `const [alterOpen, setAlterOpen] = useState(false);` to `MusicVideoMetadataInspector`.
- Add a "Alter Storyboard" button in the Storyboard `<Section>` alongside the existing New Scene button. Use a `Wand2` or `Pencil` icon.
- The button opens `AlterStoryboardDialog`.
- The dialog receives `open={alterOpen}` and `onClose={() => setAlterOpen(false)}`.
- No additional store wiring needed — the dialog reads directly from the store.

**TDD steps:**
- [ ] Write failing test: Storyboard section renders an "Alter Storyboard" button; clicking it opens the dialog.
- [ ] Run to verify red.
- [ ] Add the button and state wiring.
- [ ] Run to verify green.
- [ ] Commit: `git add apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx && git commit -m "feat: wire alter-storyboard into inspector"`

**Acceptance criteria:**
- "Alter Storyboard" button visible in the Storyboard section.
- Clicking the button opens the `AlterStoryboardDialog`.
- Dialog closes when "Cancel" or the close button is clicked.
- No regressions in existing inspector tests.

---

### Task 06: Add diff preview with accept/reject flow

**Goal:** Refine the "preview" step so users see a clear per-field diff and can either accept (apply) or reject (discard and close) the changes.

**Files:**
- Modify: `apps/web/src/components/editor/alter/AlterStoryboardDialog.tsx`
- Modify: `apps/web/src/components/editor/alter/AlterStoryboardDiffPreview.tsx`
- Create: `apps/web/test/components/editor/alter/AlterStoryboardDiffPreview.test.tsx`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` — the "submitting"/"error" step pattern

**DiffPreview component spec:**
- Given a `StoryboardDiff`, render a scrollable list of `EntityDiff` cards.
- Each card shows:
  - Entity label (e.g. "Scene 3")
  - Per-field rows: field name, before value (struck through / grey), after value (highlighted green).
  - If a field is unchanged, it is not shown.
- Summary badge: "X fields changed across Y entities".
- Two buttons at the bottom: "Apply Changes" (primary) and "Cancel" (secondary).

**Apply flow:**
- "Apply Changes" iterates over `diff.entities`:
  - For each `EntityDiff` where `entityId === "creative-brief"`: call `updateCreativeBrief(projectId, patch)`.
  - For other entityIds (shot IDs): call `patchShot(projectId, entityId, patch)` where `patch` is built from the field diffs.
  - For `kind: "all-shots"` subjects that changed many shots individually, call `patchShot` per shot.
  - For bulk operations affecting all shots identically, consider a single `setShots` call to batch.
- Show a brief success toast/notification.
- Close the dialog on success.

**Reject flow:**
- "Cancel" simply calls `onClose()`.
- No state is touched.

**TDD steps:**
- [ ] Write failing test: `AlterStoryboardDiffPreview` renders field diffs for each entity; "Apply Changes" calls the store actions; "Cancel" closes without mutations.
- [ ] Run to verify red.
- [ ] Implement the preview, apply logic, and action dispatching.
- [ ] Run to verify green.
- [ ] Commit: `git add apps/web/src/components/editor/alter/ apps/web/test/components/editor/alter/ && git commit -m "feat: add diff preview and accept/reject"`

**Acceptance criteria:**
- Diff preview shows per-field before/after.
- "Apply Changes" dispatches `patchShot`/`updateCreativeBrief` for each changed entity.
- "Cancel" closes the dialog without changes.
- Multiple shots can be altered in one apply.
- Brief changes dispatch `updateCreativeBrief`.

---

### Task 07: Add validation guard layer for patch safety

**Goal:** Add client-side validation before calling store actions to ensure no patch would corrupt the project state. This prevents a malicious or hallucinated LLM diff from damaging the project.

**Files:**
- Create: `apps/web/src/services/alter-storyboard-validator.ts`
- Modify: `apps/web/src/components/editor/alter/AlterStoryboardDialog.tsx` (call validator before apply)

**Reference files:**
- `packages/music-video-domain/src/types.ts` — field schemas
- `apps/web/test/services/alter-storyboard-validator.test.ts`

**Validation rules:**
1. Every `entityId` in the diff must correspond to an existing shot or "creative-brief".
2. No shot IDs are added or removed (the diff only edits existing entities).
3. Every field name in each `FieldDiff` must match a known field of `StoryboardShot` or `CreativeBrief`.
4. Every `after` value must match the field's expected type (string, number, boolean).
5. Immutable fields (`id`, `index`, `generatedAssetIds`, `referenceAssetIds`, `outputs`, `validation`, `selected`) are NEVER changed — any diff touching them is rejected.
6. `startSeconds`/`endSeconds` changes are only allowed when `instruction.text` explicitly mentions timing or duration.
7. `model` changes are validated against a known set of providers (warn on unknown, allow).

**Implementation:**
```ts
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePatch(
  diff: StoryboardDiff,
  shots: StoryboardShot[],
): ValidationResult;
```

**TDD steps:**
- [ ] Write failing tests: validator passes a valid diff; rejects diff with unknown entityId; rejects diff changing immutable field; rejects type mismatch.
- [ ] Run to verify red.
- [ ] Implement validator.
- [ ] Wire into dialog's apply flow — show errors and block apply if `valid === false`.
- [ ] Run to verify green.
- [ ] Commit: `git add apps/web/src/services/alter-storyboard-validator.ts apps/web/test/services/ && git commit -m "feat: validate patches before apply"`

**Acceptance criteria:**
- Valid diff passes validation.
- Invalid diffs (unknown entityId, immutable field change, type mismatch) are blocked with clear error messages.
- Warnings about unusual model names are surfaced but don't block.
- Apply is disabled when validation fails.

---

### Task 08: Add tests for all layers

**Goal:** Comprehensive test coverage across the domain prompt strategy, orchestrator route, validator, and dialog component.

**Files:**
- Modify: `packages/music-video-domain/test/alter-storyboard-prompt.test.ts` (complete coverage)
- Modify: `apps/orchestrator/test/routes/alter-storyboard.test.ts` (complete coverage)
- Modify: `apps/web/test/components/editor/alter/AlterStoryboardDialog.test.tsx` (complete coverage)
- Create: `apps/web/test/services/alter-storyboard-validator.test.ts`
- Create: `apps/orchestrator/src/services/llm-client.test.ts` (or inline in route test)

**Coverage targets:**

**Domain prompt strategy (`alter-storyboard-prompt.test.ts`):**
- System prompt is non-empty and contains instructions about JSON-only output.
- User prompt includes shot labels and prompts from context.
- User prompt includes creative brief when context.includeBrief is true.
- User prompt omits brief when includeBrief is false.
- `parseAlterResponse` parses plain JSON correctly.
- `parseAlterResponse` parses JSON inside markdown code fences.
- `parseAlterResponse` throws on unparseable output.
- `parseAlterResponse` throws on missing `entities` field.
- `validateStoryboardDiff` passes valid diff.
- `validateStoryboardDiff` rejects unknown entityId.
- `validateStoryboardDiff` rejects type mismatch (string after for boolean field).
- `validateStoryboardDiff` rejects immutable field change.

**Orchestrator route (`alter-storyboard.test.ts`):**
- POST valid request → 200 with `diff.entities` array.
- POST request with empty `instruction.text` → 400.
- POST request with missing `projectId` → 400.
- POST request with invalid subject kind → 400.
- POST request when LLM returns unparseable → 500 with error message.
- POST request when `validateStoryboardDiff` fails → 500 with validation error.

**Validator (`alter-storyboard-validator.test.ts`):**
- Passes valid StoryboardDiff.
- Rejects entityId not in project.
- Rejects change to `id`, `index`, `generatedAssetIds` fields.
- Accepts change to `prompt`, `style`, `model`, `includeMainAudio`.
- Warns on unknown/novel model provider.

**Dialog (`AlterStoryboardDialog.test.tsx`):**
- Renders when `open=true`.
- Does not render when `open=false`.
- Shows subject selection options.
- Text area for instruction is editable.
- Shows "Generate Preview" button.
- Calls `submitAlterRequest` on button click.
- Shows diff preview on success response.
- Shows error state on API failure.
- Apply button dispatches `patchShot` for each changed entity.
- Cancel button closes dialog without mutations.

**TDD steps:**
- [ ] One pass through each test file: write failing tests, run, implement, run green, commit.
- [ ] After all tests green, run full suite: `pnpm -r test:run` to confirm no regressions.
- [ ] Commit per file or batch: `git add packages/music-video-domain/test/ apps/orchestrator/test/ apps/web/test/ && git commit -m "feat: add alter-storyboard test suite"`

**Acceptance criteria:**
- All test files exist at the paths listed above.
- Every test passes independently.
- `pnpm -r test:run` reports no failures.
- Test coverage >80% for new code paths.

---

### Task 09: End-to-end smoke test

**Goal:** Manual or automated E2E verification that the full flow works: open dialog → select shots → enter instruction → preview diff → apply changes → project updates.

**Files:**
- Create: `apps/web/test/e2e/alter-storyboard.spec.ts` (Playwright or Vitest integration test)

**Smoke test steps:**
- [ ] Start the orchestrator with `LLM_API_URL` pointing to a test/mock endpoint (or wire the test to mock `fetch` at the network level).
- [ ] Start the web app dev server.
- [ ] Load a project with at least 3 imported shots and a creative brief.
- [ ] Open the InspectorPanel and click "Alter Storyboard".
- [ ] Select "All Shots", enter "Make all shots more dramatic", click "Generate Preview".
- [ ] Confirm the diff preview shows 3+ entities with changed prompt fields.
- [ ] Click "Apply Changes".
- [ ] Confirm the store now has updated prompts for all shots.
- [ ] Repeat with "Selected Shots" — check only chosen shots changed.
- [ ] Repeat with "Creative Brief" — confirm `updateCreativeBrief` was called.
- [ ] Test error path: disconnect orchestrator → click "Generate Preview" → confirm error shown.
- [ ] Test cancel: click "Cancel" → confirm no changes applied and dialog closed.

**Run:**
```bash
# Integration test
pnpm --filter @openreel/web test:run apps/web/test/e2e/alter-storyboard.spec.ts
```

**Acceptance criteria:**
- Full flow works end-to-end.
- All error paths display helpful messages.
- No project state is mutated before explicit "Apply Changes".
- Multiple alteration subjects work correctly.

---

## Risks and unresolved decisions

1. **LLM provider choice:** The prompt is designed provider-agnostic (generic fetch + env URL). The actual model choice (OpenAI, Anthropic, local) is deferred to deploy-time config. The plan assumes a JSON-capable instruction-tuned model — if the model cannot reliably produce valid JSON, add an `outputFormat: "json_object"` response_format parameter when supported.

2. **Shot timing changes:** Altering `startSeconds`/`endSeconds` is explicitly restricted unless the instruction mentions timing. This may be too conservative — revisit if users frequently need timing adjustments from the tool. For v1, the restriction prevents accidental timeline corruption.

3. **Project context size:** When a project has 50+ shots, the entire shot list in the prompt may exceed context limits. For v1, truncate to first 30 shots with a note. Add pagination/summarization in a follow-up.

4. **Concurrent edits:** The diff is generated against the project state at request time. If the user makes other edits before applying, the patch could conflict. For v1, re-validate entity existence and field types at apply time and reject if state diverged.

5. **No undo:** After "Apply Changes", the diff is committed via individual `patchShot` calls. The existing Zustand undo stack (if any) would capture these at the action level. No additional undo mechanism is planned for v1.

6. **Orchestrator project access:** The orchestrator route needs access to the project data to supply context to the LLM. v1 reads from the same `ProjectStore` used elsewhere in the orchestrator. If the orchestrator doesn't have music-video project data, the route should accept shot/brief data directly in the request body instead.

7. **Multiple LLM calls for large diffs:** If a "how" instruction is very broad ("reimagine every scene"), the LLM may produce drift across many shots. Consider a follow-up task that batches shot groups or calls the LLM per-shot for consistency.
