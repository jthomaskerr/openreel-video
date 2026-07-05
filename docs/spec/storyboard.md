# Storyboard — Operational Spec

**Status:** Operational Specification
**Version:** 1.0
**Date:** 2026-07-03
**Relates to:**
- [Storyboard UI plan](../superpowers/plans/2026-07-03-storyboard-ui.md)
- [Generate Storyboard Tool plan](../superpowers/plans/2026-07-03-generate-storyboard-tool.md)
- [Alter Storyboard Tool plan](../superpowers/plans/2026-07-03-alter-storyboard-tool.md)

---

## Overview

The Storyboard system provides a unified interface for creating, viewing, editing, and managing a sequence of visual shots for a music video project. It integrates an LLM-powered generation tool (Claude via Anthropic API) and an AI-assisted alteration tool for iterative refinement.

### Core Principle

**Ownership model:** `StoryboardShot` records own all creative metadata (label, prompt, style, timing, references). Timeline `Clip` records own placement via specialized metadata (`metadata.kind = "storyboard-shot"`, `metadata.shotId`). This separation ensures:
- Creative decisions remain independent of timeline layout.
- Shots can be reordered, deleted, or edited without breaking timeline references.
- Multiple clips can reference the same shot (shared creative intent, different placements).

---

## Data Models

### StoryboardShot

`StoryboardShot` is the authoritative record for a creative shot and its generation history.

**Location:** `packages/music-video-domain/src/types.ts`

**Interface:**
```typescript
export interface StoryboardShot {
  id: string;
  index: number;
  label: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  videoPrompt?: string;
  negativePrompt?: string;
  style?: string;
  renderMode?: string;
  seed?: number;
  includeMainAudio: boolean;
  referenceAssetIds: string[];
  generatedAssetIds: string[];
  validation?: ValidationState;
  outputs: GenerationAttempt[];
  selected?: boolean;
}
```

**Fields:**
- `id`: Unique shot identifier (UUID).
- `index`: Zero-based position in the shot sequence.
- `label`: Human-readable name (e.g., "Verse 1 - Close-up").
- `startSeconds`, `endSeconds`: Timing boundaries within the track.
- `prompt`: Primary descriptive prompt for image generation.
- `videoPrompt`: Optional video-generation-specific prompt.
- `negativePrompt`: What NOT to include.
- `style`: Visual style descriptor (e.g., "cinematic", "watercolor").
- `renderMode`: Generation technique (e.g., "single-frame", "video-clip").
- `seed`: Optional numeric seed for deterministic generation.
- `includeMainAudio`: Whether the shot should include the audio track in final render.
- `referenceAssetIds`: Array of reference image IDs.
- `generatedAssetIds`: Array of generated image/video IDs from past attempts.
- `validation`: Optional validation state summary.
- `outputs`: Array of `GenerationAttempt` records (one per generation/regeneration).
- `selected`: Optional boolean for UI multi-select state (client-side only).

### StoryboardClipMetadata

Timeline clips that represent storyboard shots carry specialized metadata.

**Location:** `packages/core/src/types/timeline.ts`

**Contract:**
```typescript
metadata: {
  kind: "storyboard-shot";
  shotId: string;           // Foreign key to StoryboardShot.id
  shotIndex?: number;       // Denormalized shot index for UI
  label?: string;           // Denormalized label
  prompt?: string;          // Denormalized prompt (for quick preview)
  referenceImageUrl?: string; // Thumbnail URL
  generatedAssetIds?: string[];
  source?: "generated" | "imported"; // Origin: AI generation or Neural Frames import
}
```

**Constraints:**
- `kind = "storyboard-shot"` is the discriminator.
- `shotId` MUST reference an existing `StoryboardShot.id` in the project.
- Denormalized fields (label, prompt, referenceImageUrl) are for display only; truth lives in `StoryboardShot`.
- Clips with this metadata appear in the storyboard panel and timeline.

### StoryboardClipLink

Join record connecting a timeline Clip to its source StoryboardShot.

**Purpose:** Enables bidirectional navigation and selection sync.

**Usage:**
```typescript
interface StoryboardClipLink {
  clipId: string;      // Clip.id in timeline
  shotId: string;      // StoryboardShot.id
  createdAt: string;   // ISO timestamp
  source: "timeline" | "storyboard"; // Origin of the link
}
```

---

## UI Components

### StoryboardPanel

The primary UI container for shot viewing and management.

**Location:** `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`

**Responsibilities:**
- Render a responsive grid of `ShotCard` components.
- Display shot count in header.
- Provide "Select All" / "Deselect All" buttons.
- Offer "Generate Storyboard" trigger (when generation is applicable).
- Show empty state when no shots exist.
- Support a close/dismiss button when rendered as a floating panel.

**Props:**
```typescript
interface StoryboardPanelProps {
  openreelProjectId: string;
  onClose?: () => void;
}
```

**Interactions:**
- Clicking a `ShotCard` calls `selectShot()` on the store (single selection, deselects others).
- Shift+Click or Ctrl+Click (when implemented) selects/deselects without clearing others.
- "Select All" calls `selectAllShots()`.
- Grid is scrollable vertically; cards wrap horizontally.

**Empty State:**
- Icon: Film (lucide-react).
- Message: "No storyboard shots".
- Helper text: "Import a Neural Frames storyboard or use AI generation to create shots."

### ShotCard

A single visual card representing one `StoryboardShot`.

**Location:** `apps/web/src/components/editor/storyboard/ShotCard.tsx`

**Props:**
```typescript
interface ShotCardProps {
  shot: StoryboardShot;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}
```

**Layout:**
```
┌─────────────────────┐
│                     │
│   Thumbnail Area    │  (Aspect 16:9)
│                     │
├─────────────────────┤
│ Label       [Badge] │
│ Time range: start – end (duration)
│ Prompt snippet (2 lines max)
└─────────────────────┘
```

**Elements:**
- **Thumbnail:** Renders `shot.referenceImageUrl` if present; otherwise a gradient placeholder with the shot index.
- **Label:** `shot.label` (truncated if long).
- **Status badge:** Colored pill derived from `shot.outputs[last].status`:
  - "unrealized" → muted gray
  - "complete" → green
  - "processing" → blue
  - "failed" → red
- **Timing:** Displays `startSeconds`–`endSeconds` and calculated duration.
- **Prompt preview:** First 2 lines of `shot.prompt`, truncated. Character/reference `@token` mentions in the prompt MUST render as inline pills per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields), consistent with the full-size prompt editor.

**Styling:**
- Border color: `border-border` (default) → `border-accent` (hover/selected).
- Selected state: Ring around the card, accent border, subtle shadow.
- Transitions: Smooth 200ms on all state changes.
- Compact layout: ~160–200px wide ideal for fitting 4–6 cards per row.

**Interactions:**
- Single click: Trigger `onClick` callback.
- Double-click: Trigger `onDoubleClick` callback (e.g., edit mode).
- Keyboard navigation (TODO): Arrow keys to move between cards, Enter to select.

### Storyboard Inline Editing

Users can edit shot metadata directly within the `StoryboardPanel` for quick iteration.

**Editable fields:**
- `label` (text input, max 100 chars)
- `prompt` (textarea, max 2000 chars)
- `style` (text input, max 500 chars)
- `negativePrompt` (textarea, max 1000 chars)

**Interaction pattern:**
- Double-click a `ShotCard` to enter edit mode.
- Fields are shown as inputs overlaid on the card.
- Pressing Enter or clicking outside saves.
- Pressing Escape cancels without saving.
- Unsaved changes are indicated by a visual indicator (e.g., dotted border).

### Drag-to-Reorder

Users can reorder shots by dragging cards within the storyboard grid.

**Behavior:**
- Click and hold a card, then drag it to a new position.
- Other cards shift to make space.
- On drop, call `setShots()` on the store with the new order.
- Update all `index` values accordingly.
- TODO: Animated transition (framer-motion).

### Reveal-in-Timeline

Clicking a "reveal" button (or shortcut) on a `ShotCard` scrolls the timeline to show the corresponding `Clip`.

**Interaction:**
- Right-click menu or icon button on `ShotCard` offering "Show in Timeline".
- Calls the timeline store to scroll to the clip's position.
- Highlights or flashes the clip briefly.

---

## Store Integration

### useMusicVideoStore

**Existing actions extended:**
```typescript
// Select a single shot (deselects others)
selectShot(openreelProjectId: string, shotId: string, deselect: boolean): void;

// Select or deselect all shots in the project
selectAllShots(openreelProjectId: string, selected: boolean): void;

// Update a single shot's fields
patchShot(openreelProjectId: string, shotId: string, patch: Partial<StoryboardShot>): void;

// Replace the entire shots array (for reordering or bulk imports)
setShots(openreelProjectId: string, shots: StoryboardShot[]): void;

// Add shots generated by the generation tool
applyStoryboardGeneration(openreelProjectId: string, shots: StoryboardShot[]): void;
```

### useStoryboardLink Hook

Bidirectional selection sync between the storyboard panel and timeline.

**Location:** `apps/web/src/hooks/useStoryboardLink.ts`

**Behavior:**
- Subscribes to `useMusicVideoStore` for shot selection changes.
- When a shot is selected in the storyboard, highlights its corresponding clip(s) in the timeline.
- When a clip with `metadata.kind = "storyboard-shot"` is selected in the timeline, selects the shot in the storyboard.
- Uses `metadata.shotId` to match clip and shot.

**API:**
```typescript
export function useStoryboardLink(openreelProjectId: string) {
  const { shots, selectShot } = useMusicVideoStore();
  const { setSelectedClip } = useTimelineStore();

  // On storyboard shot selection → highlight timeline clip
  // On timeline clip selection with storyboard metadata → highlight storyboard shot

  return {
    isShotSelected: (shotId: string) => boolean;
    isClipLinkedToSelectedShot: (clipId: string) => boolean;
  };
}
```

---

## Generation Workflow

### StoryboardGenerationRequest

Request contract for the AI generation tool.

**Location:** `packages/music-video-domain/src/types.ts`

**Interface:**
```typescript
export interface StoryboardGenerationRequest {
  creativeBrief: CreativeBrief;
  confirmedSections: EditableSongSection[];
  timing: TimingAnalysis;
  lyrics?: Array<{ startSeconds?: number; endSeconds?: number; text: string }>;
  metadataTracks: MetadataTrack[];
  audioDurationSeconds: number;
  shotCount?: number; // Default: 8
}
```

**Requirements:**
- `creativeBrief` MUST be present and complete.
- `confirmedSections` MUST contain at least one section; generation is blocked until sections are confirmed.
- `timing` MUST include beat markers and energy points.
- `lyrics` is optional; when present, can inform section-aware prompting.
- `metadataTracks` may include notes, section labels, or continuity cues.
- `shotCount` defaults to 8; client-side slider controls this (1–50 range).

### StoryboardGenerationResult

Response contract from the generation tool.

**Location:** `packages/music-video-domain/src/types.ts`

**Interface:**
```typescript
export interface StoryboardGenerationResult {
  shots: StoryboardShot[];
  generationMeta: {
    provider: GenerationProvider;
    model: string;
    promptSnapshot: string;
    temperature: number;
    generatedAt: string;
  };
  warnings: string[];
}
```

**Fields:**
- `shots`: Array of fully-formed `StoryboardShot[]` ready to insert into the project.
- `generationMeta.provider`: "anthropic" (currently; extensible for other LLM providers).
- `generationMeta.model`: Claude model version (e.g., "claude-3-5-sonnet-20241022").
- `generationMeta.promptSnapshot`: Full prompt text sent to the LLM (for auditability).
- `generationMeta.temperature`: LLM temperature setting (0.0–1.0).
- `generationMeta.generatedAt`: ISO 8601 timestamp.
- `warnings`: Array of validation or consistency messages (e.g., "Shot 3 ends after audio duration; truncated to 120.5s").

### Generate Storyboard Tool API

**Endpoint:** `POST /api/generate/storyboard`

**Location:** `apps/orchestrator/src/routes/storyboard.ts`

**Request body:**
```json
{
  "creativeBrief": { ... },
  "confirmedSections": [ ... ],
  "timing": { ... },
  "metadataTracks": [ ... ],
  "audioDurationSeconds": 150.5,
  "shotCount": 8
}
```

**Response (200 OK):**
```json
{
  "shots": [
    {
      "id": "shot-uuid-1",
      "index": 0,
      "label": "Verse 1 - Close-up",
      "startSeconds": 0,
      "endSeconds": 18.75,
      "prompt": "...",
      ...
    },
    ...
  ],
  "generationMeta": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "promptSnapshot": "...",
    "temperature": 0.8,
    "generatedAt": "2026-07-03T10:30:00Z"
  },
  "warnings": []
}
```

**Error responses:**
- `400 Bad Request`: Invalid request schema (missing creativeBrief, empty confirmedSections, etc.).
- `402 Payment Required`: API quota exceeded.
- `500 Internal Server Error`: LLM call failed or response parsing error.

### LLM Integration (Claude)

**Provider:** Anthropic Anthropic API via TypeScript SDK.

**Authentication:** `ANTHROPIC_API_KEY` environment variable.

**Model:** `claude-3-5-sonnet-20241022` (or latest available).

**Request format:** Using tool-use JSON mode for structured output.

**System prompt (outline):**
```
You are a creative storyboard director. Given a music video's creative brief,
confirmed song sections, and timing analysis, generate a sequence of shot
descriptions as a JSON array of StoryboardShot objects.

Each shot MUST:
- Have a unique label (max 100 chars)
- Map to one or more confirmed song sections
- Include a detailed image generation prompt
- Span a reasonable duration (typically 3–15 seconds)
- Align with the creative brief's visual style and pacing

Output ONLY valid JSON. No markdown, no explanation.
```

**Output validation:** Zod schema enforces:
- `shots` is a non-empty array (min 1, max 50 items).
- Each shot has required fields (id, index, label, startSeconds, endSeconds, prompt).
- Timing is contiguous and non-overlapping.
- Prompts are within length limits.

**Fallback:** If the LLM output fails validation, return a 500 error with the raw LLM text for debugging.

### Optional Lyrics File for Section Inference

Users can optionally upload a lyrics file (`.txt`, `.lrc`, or `.srt`) to inform section and shot timing.

**Supported formats:**
- `.txt`: Plain text, one line per section or verse label.
- `.lrc`: LRC format with timestamps (e.g., `[00:15] Verse 1`).
- `.srt`: SRT subtitles with timecodes.

**Processing:**
- Client parses the file and extracts `{ startSeconds?, endSeconds?, text }` tuples.
- Passes `lyrics` array to the generation request.
- LLM uses lyrics as contextual hints for shot boundaries and mood transitions.

**TODO:** Lyrics UI picker in GenerateStoryboardDialog.

---

## Alteration Workflow

### AlterStoryboardRequest

Request contract for the alteration tool.

**Location:** `packages/music-video-domain/src/types.ts`

**Interface:**
```typescript
export interface AlterStoryboardRequest {
  projectId: string;
  subject: AlterSubject;
  instruction: AlterInstruction;
  confirmedSections: EditableSongSection[];
}

export type AlterSubject =
  | { kind: "shots"; shotIds: string[] }
  | { kind: "all-shots" }
  | { kind: "creative-brief" }
  | { kind: "selected-shots" };

export interface AlterInstruction {
  text: string;
  overrides?: Record<string, string>;
}
```

**Semantics:**
- `subject.kind = "shots"`: Alter only the specified shot IDs.
- `subject.kind = "all-shots"`: Alter every shot (but respect section boundaries).
- `subject.kind = "creative-brief"`: Alter the creative brief only.
- `subject.kind = "selected-shots"`: Alter shots with `selected = true`.
- `instruction.text`: Natural-language instruction (e.g., "Make every scene more cinematic").
- `instruction.overrides`: Explicit field overrides (e.g., `{ "style": "film noir" }`).

### StoryboardDiff

The diff record representing proposed changes.

**Location:** `packages/music-video-domain/src/types.ts`

**Interface:**
```typescript
export interface StoryboardDiff {
  projectId: string;
  generatedAt: string;
  request: AlterStoryboardRequest;
  entities: EntityDiff[];
  summary: {
    totalEntities: number;
    changedEntities: number;
    totalFields: number;
  };
  valid: boolean;
  validationError?: string;
}

export interface EntityDiff {
  entityId: string;
  label: string;
  fields: FieldDiff[];
}

export interface FieldDiff {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}
```

**Example:**
```json
{
  "projectId": "proj-123",
  "generatedAt": "2026-07-03T11:00:00Z",
  "request": { ... },
  "entities": [
    {
      "entityId": "shot-uuid-1",
      "label": "Scene 1 - Intro",
      "fields": [
        { "field": "prompt", "before": "...", "after": "..." },
        { "field": "style", "before": "natural", "after": "cinematic" }
      ]
    }
  ],
  "summary": {
    "totalEntities": 3,
    "changedEntities": 2,
    "totalFields": 4
  },
  "valid": true
}
```

### Alter Storyboard Tool API

**Endpoint:** `POST /api/tools/alter-storyboard`

**Location:** `apps/orchestrator/src/routes/alter-storyboard.ts`

**Request body:**
```json
{
  "projectId": "proj-123",
  "subject": { "kind": "shots", "shotIds": ["shot-1", "shot-2"] },
  "instruction": {
    "text": "Make these scenes more cinematic with dramatic lighting",
    "overrides": { "style": "cinematic" }
  },
  "confirmedSections": [ ... ]
}
```

**Response (200 OK):**
```json
{
  "diff": { ... },
  "rawLlmOutput": "..."
}
```

**Error responses:**
- `400 Bad Request`: Invalid request schema or non-existent shot IDs.
- `500 Internal Server Error`: LLM call failed.

### LLM Integration for Alteration

**Provider:** Anthropic Claude API.

**System prompt (outline):**
```
You are a storyboard editing assistant. Given a music video storyboard and
a natural-language instruction, produce a JSON diff describing the changes.

RULES:
- Output ONLY valid JSON.
- Never add or remove shots.
- Never change immutable fields (id, index, startSeconds, endSeconds,
  generatedAssetIds, validation) unless explicitly instructed.
- Preserve section boundaries unless the instruction asks to change them.
- All field values MUST match their expected types (string, number, boolean).
```

**Output validation:** Zod schema enforces:
- All `entityId`s reference existing shots or "creative-brief".
- All `field` names are known (from `StoryboardShot` or `CreativeBrief`).
- All `after` values match expected types.
- No immutable fields are changed.

**Post-validation guard:**
The orchestrator MUST validate the diff before returning to the client:
```typescript
function validateStoryboardDiff(
  diff: StoryboardDiff,
  project: MusicVideoProject
): { valid: boolean; error?: string }
```

Checks:
- Shot IDs in the diff exist in the project.
- Field names are recognized.
- Field value types are correct.
- Immutable fields (id, index, startSeconds, endSeconds, generatedAssetIds, validation) are never changed.
- No new shots are added or removed.
- Section boundaries are preserved (if altered, return a warning).

### Diff Preview and Accept/Reject Flow

**UI Component:** `AlterStoryboardDialog`

**Location:** `apps/web/src/components/editor/storyboard/AlterStoryboardDialog.tsx`

**Workflow:**
1. User opens the dialog (from inspector or storyboard panel).
2. Enters natural-language instruction and selects shots to alter. Character/reference `@token` mentions typed into the instruction text field or shown in shot prompt previews within the dialog MUST render as inline pills per `inspector-shell.md` §3.8.
3. Clicks "Preview" → calls `POST /api/tools/alter-storyboard`.
4. Dialog shows a diff view with before/after for each changed field.
5. User can accept or reject:
   - **Accept:** Calls `applyStoryboardDiff()` to mutate the project state.
   - **Reject:** Discards the diff; no changes are made.

**No mutation before accept:** The dialog MUST NOT mutate any project state until the user clicks "Apply" / "Accept".

**Diff preview display:**
- Listed by entity (shot or brief).
- For each entity, show changed fields in a clear before/after layout.
- Highlight removals (red), additions (green), unchanged (neutral).
- Allow toggling individual field applications (allow fine-grained accept/reject).

**Validation feedback:**
- If `diff.valid = false`, display the error message and disable "Apply".
- If warnings are present (e.g., overlapping shots), show them as informational alerts.

---

## Immutability and Validation Guards

### Immutable Fields

The following fields MUST NEVER be changed by the alteration tool:
- `StoryboardShot.id`
- `StoryboardShot.index`
- `StoryboardShot.startSeconds`
- `StoryboardShot.endSeconds`
- `StoryboardShot.generatedAssetIds`
- `StoryboardShot.validation`

**Rationale:** These fields are structural anchors; changing them breaks timeline references and generation history.

### Validation Guard: Patch Safety

Before applying a diff, the client and orchestrator MUST validate:

**Client-side** (in `AlterStoryboardDialog`):
1. Check that all `entityId`s in the diff are recognized.
2. Verify that no immutable fields are being changed.
3. Warn if shot IDs are being added or removed.

**Orchestrator-side** (in `POST /api/tools/alter-storyboard`):
1. Fetch the project context (shots, creative brief).
2. Validate that the request references only existing shot IDs.
3. Parse the LLM response into a `StoryboardDiff`.
4. Call `validateStoryboardDiff()` to check field types and constraints.
5. Return the diff with `valid: true` or `valid: false` + `validationError`.

### Patch Application Logic

When a user accepts a diff:

```typescript
export function applyStoryboardDiff(
  openreelProjectId: string,
  diff: StoryboardDiff
): void {
  // For each EntityDiff in diff.entities:
  // - If entityId is a shot ID:
  //   - Extract the field updates from FieldDiff[].
  //   - Call patchShot(openreelProjectId, shotId, patch).
  // - If entityId is "creative-brief":
  //   - Call updateCreativeBrief(openreelProjectId, patch).
}
```

---

## Integration Points

### Neural Frames Import

When importing a storyboard from Neural Frames, each imported scene becomes a `StoryboardShot` with:
- `source: "imported"` (in metadata or a dedicated field).
- `label`: Scene name from Neural Frames.
- `prompt`: Generated from scene description or metadata.
- `referenceImageUrl`: Thumbnail from the imported scene.

All imported shots use the same `metadata.shotId` linkage as generated shots, ensuring a unified UI.

### Section Identification Flow

The storyboard generation workflow depends on confirmed song sections from the [Section Identification Flow plan](../superpowers/plans/2026-07-03-section-identification-flow.md) and the [Sections Identification spec](./sections-identification.md):
- User infers or manually defines sections (intro, verse, chorus, bridge, outro).
- Sections must be confirmed before generation is triggered.
- LLM prompt includes section boundaries to guide shot creation.

### Track Grouping and Timeline Layout

The storyboard panel integrates with track grouping (from the [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) and [Track Grouping spec](./track-grouping.md)):
- Storyboard shots can be grouped into "shot groups" by section.
- Timeline track grouping allows collapsing/expanding shot groups.
- Shots appear both in the storyboard panel grid and as clips in the timeline.

---

## Error Handling

### Generation Failures

If `POST /api/generate/storyboard` fails:
- Show an error toast with the failure reason.
- Provide a "Retry" button to re-trigger generation.
- Log the raw LLM output (if parsing failed) for debugging.

### Alteration Failures

If `POST /api/tools/alter-storyboard` fails:
- Show the validation error in the dialog.
- Disable "Apply" until the error is resolved.
- Allow editing the instruction and re-previewing.

### Network Errors

- Implement exponential backoff for retries (up to 3 attempts).
- Use `AbortController` to allow user cancellation mid-request.
- Show a spinner during processing; allow early abort.

---

## Testing Expectations

### Unit Tests

**Storyboard domain types:**
- `StoryboardShot` instantiation and validation.
- `StoryboardGenerationRequest` / `StoryboardGenerationResult` schema validation.
- `AlterStoryboardRequest` / `StoryboardDiff` schema validation.

**UI components:**
- `ShotCard` renders all fields correctly.
- `StoryboardPanel` shows shots and handles selection.
- `GenerateStoryboardDialog` sends the correct request payload.
- `AlterStoryboardDialog` displays diffs and applies changes.

**Store actions:**
- `selectShot()`, `selectAllShots()`, `patchShot()`, `setShots()` mutate state correctly.
- `applyStoryboardGeneration()` and `applyStoryboardDiff()` work as expected.

**Hooks:**
- `useStoryboardLink()` syncs storyboard and timeline selection.

**LLM integration:**
- Prompt builders generate valid input for Claude.
- Output validators reject invalid LLM responses.
- `validateStoryboardDiff()` catches immutable field changes and type mismatches.

### E2E Tests

TODO:
- Generate a storyboard from a real creative brief and confirm shots are created.
- Alter a storyboard via natural-language instruction and confirm changes are applied.
- Drag-to-reorder shots and verify timeline clip order updates.
- Select a shot and confirm the timeline clips are highlighted.

### Edge Cases

- Empty shot list → show empty state.
- Generation with `shotCount = 1` → single shot.
- Generation with `shotCount = 50` (max) → confirm no data loss.
- Alteration of non-existent shot IDs → return 400 Bad Request.
- Alteration with immutable field override → rejected by validation guard.
- LLM response with malformed JSON → return 500 with raw output.
- Cancellation mid-generation or mid-alteration → abort gracefully.

---

## Future Enhancements

- **Keyboard navigation:** Arrow keys to move between cards in the storyboard panel.
- **Batch operations:** Select multiple shots and bulk-edit fields.
- **Shot templates:** Pre-built shot prompts organized by mood, pacing, or genre.
- **Variation generation:** Re-generate a single shot with different prompts or parameters.
- **Multi-LLM support:** Support other LLM providers (e.g., GPT-4, Gemini) alongside Claude.
- **Prompt refinement:** UI for iteratively tweaking generation prompts.
- **Storyboard import/export:** Save and load storyboards as JSON or standardized formats.
- **Collaborative review:** Share storyboards with team members and collect feedback.

---

## File Inventory

**Created:**
- `/Volumes/Joseph/Projects1/ai-agents/openreel-video/docs/spec/storyboard.md` (this file)

**Referenced (not modified):**
- `packages/music-video-domain/src/types.ts` — StoryboardShot, related types
- `packages/core/src/types/timeline.ts` — Clip metadata contract
- `apps/web/src/stores/music-video-store.ts` — Store actions
- `apps/orchestrator/src/routes/storyboard.ts` — Generation API route
- `apps/orchestrator/src/routes/alter-storyboard.ts` — Alteration API route
- `apps/web/src/components/editor/storyboard/` — UI components

---

## References

- [Storyboard UI plan](../superpowers/plans/2026-07-03-storyboard-ui.md)
- [Generate Storyboard Tool plan](../superpowers/plans/2026-07-03-generate-storyboard-tool.md)
- [Alter Storyboard Tool plan](../superpowers/plans/2026-07-03-alter-storyboard-tool.md)
- [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md)
- [Section Identification Flow plan](../superpowers/plans/2026-07-03-section-identification-flow.md)
