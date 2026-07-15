# Scene Clip Creation Implementation Plan

**Date:** 2026-07-16  
**Status:** Ready for implementation  
**Primary outcome:** A user can create and edit a scene from the Media pane, or create and immediately place one from the timeline's **Add Track** menu. Timeline creation places the projection on the active compatible track at the exact playhead time. The active track is always visually unambiguous. Scene creative data is shared by all of its projections, while duration and trim remain properties of each timeline clip.

## 1. User-visible acceptance criteria

The feature is complete only when all of the following are true:

1. The Media pane exposes a visible **Create Scene** action.
2. Creating from Media creates an unplaced scene, selects it, opens the scene editor, and focuses the title field.
3. The timeline **Add Track** dropdown contains **Create Scene** in addition to its existing track actions.
4. Creating from the timeline creates one scene and one projection on the active track at the exact current playhead time. Creation does not snap, ripple, or silently choose a different time.
5. One track is always active when any compatible track exists. Its header and full lane have a stronger, non-layout-shifting border and a supporting tint. The state remains clear with hover, focus, selection, muted, solo, and locked styles.
6. Clicking a track header, empty lane space, or a clip activates that track before any action depending on the active track is evaluated.
7. **Create Scene** is enabled only when the active track accepts a video scene and is unlocked. When disabled, the menu explains why.
8. A scene editor supports at least title, prompt, ordered reference images, associated video media, Include Audio, model/schema controls, generation state, and generation actions.
9. Scene creative fields are scene-owned and shared across projections. `startTime`, `duration`, `inPoint`, and `outPoint` are projection-owned and may differ between projections of the same scene.
10. There is no explicit audio-range input in the scene editor.
11. When Include Audio is checked, generation is disabled for an unplaced scene. The UI explains that the scene must be placed on the timeline so its projection can provide timing.
12. Generation launched from a placed scene uses the selected projection's timing. If the scene has multiple projections, the application never guesses which projection supplies timing.
13. A user can associate an existing Media-pane video asset with a scene without placing it.
14. A user can link an existing timeline video clip to an existing scene.
15. A user can convert an existing video clip into a scene clip while preserving the clip ID, media, track, placement, duration, trim, effects, transforms, transitions, and all unrelated metadata.
16. Existing projects containing legacy `metadata.kind === "scene"`, canonical storyboard-shot metadata, or NeuralFrames-created scene clips still load and remain editable.

## 2. Scope and non-goals

### In scope

- Scene creation entry points in Media and Timeline.
- A single scene creative-data model backed by the existing music-video project store.
- Scene selection and editing when no timeline projection exists.
- Projection placement and per-projection timing/trim.
- Explicit active-track state and visuals.
- Existing-media association and existing-clip linking/conversion.
- Generation-context derivation and Include Audio gating.
- Compatibility normalization for existing scene-like clips.
- Deterministic unit/component tests, generation adapter tests/evals, and browser verification.
- Canonical specification updates.

### Non-goals

- A separate manually editable audio range.
- Moving duration or trim onto the scene record.
- Automatic placement of Media-created scenes.
- Automatically choosing among multiple projections during generation.
- Audio-track scene projections.
- Rewriting existing generated media or rerunning generation during migration.
- Replacing the existing timeline clip or music-video project persistence systems.

## 3. Terminology and ownership invariants

Use these terms consistently in code, tests, copy, and documentation:

- **Scene:** The creative entity stored with the music-video project, currently represented by `StoryboardShot`. It owns identity, title/label, prompt, references, associated source/generated media, Include Audio preference, and generation settings/status.
- **Projection:** A core timeline `Clip` that points to a scene. It owns timeline placement, duration, trim, effects, transforms, transitions, and other clip-local state.
- **Placed scene:** A scene with at least one projection.
- **Selected projection:** The timeline clip currently selected in the editor. It is the only valid implicit timing source for generation.
- **Active track:** The track targeted by commands that insert a projection. It is independent from the selected clip but selecting a clip also activates its parent track.
- **Associated media:** A Media-pane video asset referenced by a scene. Association alone does not imply timeline placement.

The following invariants are architectural constraints, not implementation suggestions:

| Data | Canonical owner | Must not be copied to |
|---|---|---|
| Scene ID, title, prompt, references, Include Audio, model/schema settings, generation state | `StoryboardShot` / scene record in `music-video-store.ts` | Timeline clip except optional read-only display snapshots |
| Track ID, start time, duration, in/out trim, effects, transforms, transitions | Core timeline `Clip` | Scene record |
| Link from projection to scene | Canonical storyboard clip metadata containing `shotId` | Ad hoc component state |
| Active track ID | Editor/timeline UI store | Scene or clip metadata |
| Audio generation timing | Derived from the selected projection at command time | Persisted manual audio-range field |

If a display snapshot such as scene label or prompt is retained in clip metadata for compatibility, the scene record is authoritative. Updating the scene must not require updating every projection to preserve correctness.

## 4. Existing architecture to preserve

- `apps/web/src/stores/music-video-store.ts` persists one `MusicVideoProject` per OpenReel project and owns `shots: StoryboardShot[]`. Extend this collection rather than introducing a second scene store.
- `packages/music-video-domain/src/types.ts` defines `StoryboardShot`. Evolve it so a manually created, unplaced scene is valid without fake placement timing.
- `packages/core/src/types/timeline.ts` defines core `Clip`. Its `startTime`, `duration`, `inPoint`, and `outPoint` remain the source of truth for a placed projection.
- `docs/spec/timeline.md` defines canonical projection metadata with `kind: "storyboard-shot"`, `shotId`, optional display fields, and `source: "manual" | "neuralframes" | "storyboard-generation"`.
- Existing runtime data may still use `metadata.kind === "scene"`. Read paths must normalize this shape during the compatibility period.
- `SceneMetadataInspector` currently assumes a selected timeline clip. Refactor its creative controls into a shared scene editor that can receive a scene ID without a clip.
- `InspectorPanel` currently routes Media selections to `AssetInspectorWithTabs` and timeline selections to Edit. Add a scene selection route without breaking ordinary asset inspection.
- `Timeline.tsx` owns the **Add Track** dropdown and currently has no active-track state.
- `TrackHeader.tsx` and `TrackLane.tsx` currently have no active-track contract.
- `packages/music-video-domain/src/generation/contracts.ts` already supports `shotId`, `clipId`, and optional timing/audio context. Adapt callers rather than inventing a parallel generation payload.

## 5. Contract decisions

### 5.1 Scene record

Keep `StoryboardShot` as the persisted scene type, but make its contract support manually created and unplaced scenes. The domain agent must inspect all existing constructors and consumers before changing required fields. Use one of these compatible shapes, preferring the least disruptive one supported by current data:

```ts
type StoryboardShot = {
  id: string;
  title?: string;
  prompt: string;
  referenceImages: SceneReferenceImage[];
  includeAudio: boolean;
  associatedMediaId?: string;
  generation?: SceneGenerationSettingsAndState;
  // Existing storyboard-only fields remain compatible and become optional
  // where an unplaced manual scene cannot meaningfully supply them.
};
```

Requirements:

- Do not add scene-level `duration`, `trim`, `inPoint`, `outPoint`, or audio-range fields.
- If legacy storyboard flows require a duration-like planning hint, name and document it as a planning hint and never use it as projection timing. Prefer removing the requirement for manual scenes.
- IDs must use the repository's existing collision-safe ID helper.
- New manual scenes default to a localized/centralized title such as `Untitled Scene`, empty prompt/references, Include Audio off, `source: "manual"`, and idle generation state.
- Persisted readers must supply safe defaults for fields added after older projects were saved.
- Do not use array index as identity or as the link from clip to scene.

### 5.2 Projection metadata

Create or centralize a typed helper for canonical metadata. Do not let UI components construct untyped metadata literals.

```ts
type StoryboardClipMetadata = {
  kind: "storyboard-shot";
  shotId: string;
  shotIndex?: number;
  label?: string;
  prompt?: string;
  source: "manual" | "neuralframes" | "storyboard-generation";
  // Preserve extension fields already allowed by core Clip metadata.
};
```

Required helpers, names adjustable to local conventions:

```ts
isSceneProjection(clip): boolean
getSceneIdFromClip(clip): string | undefined
createSceneProjectionMetadata(scene, source): StoryboardClipMetadata
normalizeSceneProjectionMetadata(metadata): StoryboardClipMetadata | undefined
```

Normalization rules:

1. Canonical `kind: "storyboard-shot"` with a valid `shotId` passes through without dropping unknown fields.
2. Legacy `kind: "scene"` maps to canonical semantics using its existing scene/shot ID field.
3. NeuralFrames metadata maps to the same canonical link with `source: "neuralframes"`.
4. Malformed metadata without a usable scene ID is not silently treated as linked. Surface a recoverable orphan state in diagnostics/UI.
5. Writes use only the canonical shape. Reads accept canonical and documented legacy shapes until a later migration removes them.

### 5.3 Active-track contract

Add `activeTrackId: string | null` and a narrow `setActiveTrack(trackId)` action to the existing editor/timeline UI state owner. Do not persist it into project media or scene records.

Deterministic fallback algorithm, run after project load and whenever tracks change:

1. Keep the existing active track if it still exists, is visible, and is eligible for activation.
2. Otherwise use the selected clip's parent track if it exists.
3. Otherwise use the first unlocked video track.
4. Otherwise use the first visible track, even if incompatible, so the UI can explain why creation is disabled.
5. Use `null` only when there are no tracks.

Track compatibility for scene placement is exactly: track exists, track type accepts video clips, and track is not locked. Muted/solo state does not make a track incompatible.

### 5.4 Atomic scene operations

Expose operations through the appropriate store/service boundary. Components should call these operations and must not coordinate multi-store writes themselves.

```ts
createScene(input?): SceneId
updateScene(sceneId, patch): Result
placeScene({ sceneId, trackId, startTime, source }): Result<ClipId>
createAndPlaceScene({ trackId, startTime }): Result<{ sceneId; clipId }>
associateSceneMedia({ sceneId, mediaId }): Result
linkClipToScene({ clipId, sceneId }): Result
convertClipToScene({ clipId, initialSceneFields? }): Result<SceneId>
```

Behavior and failure boundaries:

- `createScene` writes exactly one scene and makes it selectable independently of the timeline.
- `placeScene` validates scene existence and track compatibility before mutation, then creates one video projection with canonical metadata. It uses the passed `startTime` verbatim.
- `createAndPlaceScene` is one undoable user action. Validate the track before creating the scene. If clip insertion fails, roll back scene creation so no accidental orphan remains.
- `associateSceneMedia` accepts only existing video media. It does not create a projection or alter clip timing.
- `linkClipToScene` accepts only an existing video clip and existing scene. It changes only the scene-link metadata, preserving all other metadata fields.
- `convertClipToScene` creates a scene based on the clip/media context and then links the existing clip in place. It must not replace the core `Clip` object or generate a new clip ID.
- Operations return typed, user-displayable errors for missing scene, missing clip, missing track, incompatible track, locked track, missing media, and non-video media/clip.
- Each operation maps to one undo/redo boundary. Undoing `createAndPlaceScene` or `convertClipToScene` must remove the created scene and restore the exact prior timeline state.

## 6. UX specification

### 6.1 Media pane

Add a primary or toolbar-level **Create Scene** action where users create/import media. It must remain visible without opening a secondary context menu.

On activation:

1. Create the unplaced scene.
2. Select the new scene using an explicit inspector selection type, for example `{ type: "scene", sceneId }`.
3. Open the scene inspector/editor.
4. Focus and select the default title so typing immediately renames it.
5. Do not create a track or projection and do not move the playhead.

Represent scenes in the Media pane using the existing asset/card language, but distinguish them with a **Scene** label and placement status. A scene with zero projections says **Not on timeline**. If useful and cheap to derive, show the projection count for placed scenes. Do not store that count.

Scene card actions:

- Open/Edit.
- Place on active track at playhead, enabled only for a compatible active track.
- Associate video asset.
- Delete, following existing referenced-asset deletion confirmation patterns. If projections exist, warn that deleting the scene will orphan/remove linked projections according to the repository's chosen deletion policy. The implementing lead must freeze this policy before parallel UI work begins.

Existing video asset actions:

- **Associate with Scene…** opens a scene picker and calls `associateSceneMedia`.
- Do not overload association to mean conversion or placement.

### 6.2 Shared scene editor

Extract the creative fields from `SceneMetadataInspector` into a component driven by `sceneId` plus optional `projectionClipId`. Both Media and timeline selection routes render it.

Suggested boundary:

```tsx
<SceneEditor
  sceneId={sceneId}
  projectionClipId={selectedProjectionId}
  sourceContext="media" | "timeline"
/>
```

Sections:

1. **Scene details:** title and prompt.
2. **References:** ordered images with add, remove, and reorder controls. Preserve the generation contract's reference precedence: source, character mentions, scene/shot references, then user references.
3. **Video media:** associated media preview/name, choose/replace, and clear.
4. **Generation:** Include Audio, model, schema/settings supported by the existing adapter, generate/regenerate, progress, result, and error.
5. **Timeline projection:** rendered only when `projectionClipId` is present; reuse existing clip timing/trim controls. These controls edit the clip, never the scene.

Do not show disabled duration/trim fields for unplaced scenes. Show a concise **Not on timeline** status and an available **Place on active track** action instead.

Selection rules:

- Selecting a scene card opens creative editing without requiring a clip.
- Selecting a linked projection opens the same creative editor with projection controls.
- Selecting an ordinary video clip continues to open the ordinary asset/clip inspector.
- Selecting a malformed/orphaned scene projection shows a repair message rather than crashing.

### 6.3 Active-track appearance and interaction

The active state must cover both `TrackHeader` and `TrackLane`.

- Use an inset outline/ring or pseudo-element so the stronger border does not change track dimensions or cause timeline jitter.
- Use the same semantic accent color for header and lane, with sufficient contrast in light/dark themes.
- Add a subtle lane tint so the state is not encoded by a one-pixel border alone.
- Preserve clear keyboard focus and selected-clip states. Focus ring must remain distinguishable from active-track ring.
- Add `data-active-track` or an equivalent stable hook for deterministic component/E2E assertions.
- Add an accessible label/state such as `aria-current` where semantically valid, or include “active track” in the track's accessible name. Do not misuse `aria-selected` unless the enclosing widget implements the required selection pattern.

Activation rules:

- Pointer down/click on a header activates the track.
- Clicking empty lane space activates the track and keeps existing playhead behavior.
- Clicking/selecting a clip activates its parent track before opening contextual actions.
- Keyboard navigation that moves focus/selection to a track activates it consistently.
- Drag start activates the source track; a successful cross-track drop activates the destination track.

### 6.4 Timeline Add Track dropdown

Add a separated **Create Scene** menu item to the existing dropdown in `Timeline.tsx`. Its placement in this menu is intentional even though it does not add a track.

On activation:

1. Capture `activeTrackId` and the current playhead time once.
2. Validate active-track compatibility.
3. Call `createAndPlaceScene({ trackId, startTime: playheadTime })`.
4. Select the new projection and keep the destination track active.
5. Open the scene editor in timeline context and focus the title.
6. Leave the playhead unchanged.

The exact insertion time is the captured playhead value. Do not route it through snapping, nearest-frame rounding beyond the timeline's canonical time representation, gap finding, overlap avoidance, or append-at-end behavior. Existing overlap rules may render overlapping clips; they must not shift this command's requested time.

Disabled reasons, in precedence order:

1. No tracks: `Add a video track before creating a scene.`
2. Active track missing: `Select a video track to create a scene.`
3. Locked: `Unlock the active track to create a scene.`
4. Incompatible type: `Select a video track to create a scene.`

Use the menu component's supported tooltip/description pattern so the reason is available to pointer and keyboard users.

### 6.5 Existing clip linking and conversion

For an ordinary timeline video clip, add:

- **Link to Existing Scene…**: choose a scene and call `linkClipToScene`.
- **Convert to Scene Clip**: create a new scene from available clip/media label and metadata, then call the atomic conversion operation.

Conversion preservation test must compare the entire clip before and after, allowing differences only in the documented scene-link metadata keys. Specifically preserve:

- `id`, media/source ID, track membership, `startTime`, `duration`, `inPoint`, `outPoint`;
- effects, transforms, opacity, speed, transitions, volume/audio flags if the clip type carries them;
- grouping, locking, enabled state, labels/colors, and unknown extension metadata;
- object fields added in future versions unless explicitly part of the scene-link namespace.

If the clip is already linked, show **Open Scene** or **Change Linked Scene…**, not a second conversion action.

## 7. Generation and audio rules

Create a pure selector/helper that resolves generation context from `(sceneId, optional projectionClipId, project state)`. Components use its result for both disabled UI and command payload construction.

```ts
type SceneGenerationContext =
  | { canGenerate: true; scene; projection?: Clip; timing?: GenerationTiming }
  | { canGenerate: false; reason: GenerationDisabledReason };
```

Rules:

1. An unplaced scene with Include Audio off may generate using the existing untimed visual-generation path, if the selected model supports it.
2. An unplaced scene with Include Audio on cannot generate. Reason: `Place this scene on the timeline to generate audio from its timing.`
3. A selected linked projection supplies `clipId`, `startTime`, `duration`, and trim-derived timing through the existing generation contract.
4. If Include Audio is on, derive the audio interval from that projection's canonical effective timing. Do not show or persist an audio-range field.
5. A scene with one or more projections but opened from Media has no selected projection. If Include Audio is on, disable generation and ask the user to select a timeline projection. Do not choose the first or most recent projection.
6. A `projectionClipId` is valid only if the clip exists and links to the same scene ID. A stale or mismatched clip ID produces a typed disabled reason.
7. Existing model/schema validation still applies and composes with placement gating. Return one primary actionable reason and preserve detailed validation diagnostics.
8. Generation result association updates the scene's generated/associated media through the existing adapter flow. It must not overwrite projection duration/trim unless an existing explicit user-approved workflow already does so.

Add a deterministic technical eval/contract test for request construction. No paid model call is needed for UI gating. If prompt/reference ordering is changed, run the repository's existing generation eval and retain its pass threshold; otherwise add fixtures proving the adapter receives references in the specified order.

## 8. Persistence, migration, and compatibility

Implement tolerant reads and canonical writes before changing UI entry points.

### Read compatibility

- Parse older `StoryboardShot` records missing new fields with defaults.
- Resolve canonical storyboard projections.
- Resolve legacy `kind: "scene"` projections.
- Resolve NeuralFrames projections and preserve their provider-specific metadata.
- Preserve unknown metadata keys during load/save and link/conversion operations.
- Detect a projection whose `shotId` does not exist. Keep the timeline clip intact and surface it as an orphaned scene link.

### Write behavior

- All newly created or edited links use `kind: "storyboard-shot"` and a stable `shotId`.
- New manual projections use `source: "manual"`.
- Do not rewrite every project eagerly merely by opening it.
- If the store already has a versioned migration mechanism, add an idempotent migration and bump its version. Otherwise use read normalization plus canonical-on-change writes.

### Migration fixtures

Add fixtures for:

1. A current canonical storyboard shot and projection.
2. A legacy `kind: "scene"` clip.
3. A NeuralFrames-created clip with provider metadata.
4. An unplaced manual scene.
5. One scene with two projections having different duration and trim.
6. An orphan projection referencing a missing scene.

For every fixture, assert load succeeds, identity remains stable, no projection timing moves, and serialization preserves unknown fields.

## 9. Parallel implementation work packages

The lead agent must land Work Package 1 contracts before dispatching dependent packages. After that, packages 2 through 8 can run in parallel only where their file ownership does not overlap. Every subagent must rebase/refresh after the contract commit and must not redesign shared contracts locally.

### WP0: Lead integration setup and contract freeze

**Owner:** Lead agent only  
**Dependencies:** None  
**Owned files:** This plan, shared task notes, and final integration changes only.

Tasks:

1. Record the measurable outcome from section 1 in the implementation task/PR.
2. Inventory exact symbols and tests for `StoryboardShot`, timeline clip mutation, selection state, undo/redo, media selection, and generation request construction using semantic tooling.
3. Freeze names and exports for scene ID, projection metadata helpers, operations, active-track state, and scene inspector selection.
4. Decide and document deletion behavior for a scene with projections before Media UI work starts.
5. Create small typed fixtures shared by domain/store tests. Avoid a monolithic fixture file that forces all agents to edit it.

**Handoff evidence:** Contract table with final symbols and import paths; affected-callers list; deletion-policy decision; baseline test commands/results.

### WP1: Domain contracts and compatibility adapters

**Owner:** Domain agent  
**Dependencies:** WP0  
**Owned files:** `packages/music-video-domain/src/types.ts`, scene/projection metadata module in that package, domain tests, generation contract types only if required.  
**Do not modify:** React components, web stores, timeline UI, inspectors.

Tasks:

1. Evolve `StoryboardShot` for unplaced manual scenes without scene-owned timing/trim.
2. Define canonical `StoryboardClipMetadata` and the four normalization/type-guard helpers from section 5.2.
3. Preserve legacy scene and NeuralFrames read compatibility.
4. Export typed disabled reasons or generation-context primitives if they belong in the domain package.
5. Add migration/normalization fixtures and exhaustive tests.

Required tests:

- Manual unplaced scene validates without fake timing.
- Canonical, legacy, and NeuralFrames metadata resolve to the same scene-link abstraction.
- Malformed metadata returns no link and does not throw.
- Unknown fields survive normalization.
- Canonical writer always emits `kind: "storyboard-shot"` and the correct source.

**Handoff evidence:** Public export list, fixture names, passing domain test command, and a note describing every accepted legacy shape.

### WP2: Scene store operations, persistence, and undo

**Owner:** State agent  
**Dependencies:** WP1  
**Owned files:** `apps/web/src/stores/music-video-store.ts`, a focused scene command/service module if needed, store tests, persistence migration tests.  
**Do not modify:** Timeline/Media/Inspector React components or track styling.

Tasks:

1. Implement all atomic operations in section 5.4 using existing store/command conventions.
2. Add selectors for scene by ID, projections by scene ID, and projection count.
3. Integrate explicit undo/redo boundaries.
4. Add tolerant persisted defaults and canonical-on-change writes.
5. Ensure multi-store mutation is transactional or compensating: failed placement leaves neither a new projection nor an unintended new scene.

Required tests:

- Create unplaced scene.
- Create and place at a fractional/exact playhead value.
- Locked/incompatible/missing tracks cause zero mutation.
- Association rejects non-video media.
- Link preserves all clip fields except link metadata.
- Conversion preserves clip identity and every unrelated field.
- Undo/redo restores both scene and timeline state.
- One scene may have two projections with independent timing/trim.
- Older persisted records load with defaults and no eager destructive rewrite.

**Handoff evidence:** Operation signatures, error union, undo semantics, passing targeted store tests.

### WP3: Active-track state and styling

**Owner:** Timeline-state agent  
**Dependencies:** WP1 contract names only  
**Owned files:** Existing editor/timeline UI state store, `TrackHeader.tsx`, `TrackLane.tsx`, their focused tests/styles.  
**Do not modify:** `Timeline.tsx` Add Track menu, scene store, Media pane, scene editor.

Tasks:

1. Add `activeTrackId`, setter, and deterministic fallback selector/effect.
2. Activate from header, empty lane, clip selection, keyboard navigation, drag source, and successful destination drop using existing event paths.
3. Pass explicit `isActive` props to header/lane.
4. Implement non-layout-shifting strong border, tint, accessibility text/state, and stable test hook.
5. Ensure deleting/reordering/locking tracks invokes fallback without transient crashes.

Required tests:

- Fallback order from section 5.3.
- Header/lane/clip interactions activate the expected track.
- Deleting active track chooses a deterministic fallback.
- Header and lane both expose active styling hooks.
- Border does not alter measured track dimensions in component/browser assertion.
- Locked active track may remain active but is reported incompatible for creation.

**Handoff evidence:** State API, activation event matrix, component test results, screenshots in light/dark theme if both exist.

### WP4: Media scene creation and scene cards

**Owner:** Media UI agent  
**Dependencies:** WP1 and WP2  
**Owned files:** Media pane components, scene card/list components, Media-specific tests.  
**Do not modify:** Shared store contracts, timeline components, shared scene editor internals.

Tasks:

1. Add visible **Create Scene** action.
2. Render scene cards from the scene collection with placed/unplaced status derived from selectors.
3. Add explicit scene selection and route it toward the inspector contract frozen in WP0.
4. Implement Media actions: open/edit, place at active track/playhead, associate video, and deletion confirmation.
5. Add **Associate with Scene…** to existing video asset actions.

Required tests:

- Create action creates no projection and does not move playhead.
- New scene is selected and requests title focus.
- Projection count/status is derived correctly.
- Association picker accepts video only and does not place.
- Place action respects active-track compatibility and captured playhead.
- Keyboard and accessible labels exist for all new actions.

**Handoff evidence:** Component test results and exact selection payload emitted after create.

### WP5: Shared scene editor and inspector routing

**Owner:** Inspector agent  
**Dependencies:** WP1 and WP2  
**Owned files:** `SceneMetadataInspector`, extracted `SceneEditor`, `InspectorPanel`, `AssetInspectorWithTabs` only where routing requires it, focused tests.  
**Do not modify:** Timeline menu, Media list/cards, generation adapter implementation, track components.

Tasks:

1. Extract creative controls to a scene-ID-driven editor.
2. Support Media scene and timeline projection routes.
3. Keep projection timing/trim controls clip-bound and hide the entire section when unplaced.
4. Implement title autofocus through an explicit one-shot focus request, not unconditional autofocus on every render.
5. Show recoverable orphan/mismatch states.
6. Expose generation controls using the context selector from WP8, with temporary typed seam if WP8 lands later.

Required tests:

- Media selection renders editor without a clip.
- Timeline projection renders the same creative fields plus projection controls.
- Editing duration/trim mutates only the clip.
- Editing prompt/title mutates the scene and is visible from a second projection.
- Ordinary assets/clips retain their existing inspector route.
- Orphaned metadata does not crash.
- Focus occurs only after a create request.

**Handoff evidence:** Prop/selection contract, component test results, before/after inspector route table.

### WP6: Timeline menu creation and placement flow

**Owner:** Timeline command UI agent  
**Dependencies:** WP2 and WP3  
**Owned files:** `Timeline.tsx`, Add Track menu tests, narrowly scoped integration test helpers.  
**Do not modify:** Track header/lane styles, scene editor, store operation internals.

Tasks:

1. Add **Create Scene** to the Add Track dropdown.
2. Derive enabled/disabled state and reason from the active track.
3. Capture active track and playhead once, then call `createAndPlaceScene`.
4. Select the returned clip, retain active track, open editor, request title focus, and preserve playhead.
5. Prevent duplicate invocation from menu close/focus events.

Required tests:

- Enabled on unlocked video track.
- Disabled with each reason in section 6.4.
- Exact floating-point/canonical playhead passed through unchanged.
- One click creates exactly one scene and one clip.
- Successful flow selects clip and keeps playhead unchanged.
- Failed operation shows error and creates nothing.

**Handoff evidence:** Menu-state test matrix and placement integration result.

### WP7: Existing clip linking and conversion UI

**Owner:** Clip actions agent  
**Dependencies:** WP2 and WP5 selection contract  
**Owned files:** Timeline clip context/action menus, scene picker component, action tests.  
**Do not modify:** Domain/store operations, Media pane, Add Track menu, track styling.

Tasks:

1. Add **Link to Existing Scene…** for eligible video clips.
2. Add **Convert to Scene Clip** for unlinked video clips.
3. Replace conversion with open/change actions when already linked.
4. Build/reuse an accessible searchable scene picker.
5. On success, select/open the linked scene without changing timeline placement.

Required tests:

- Actions hidden/disabled for non-video clips.
- Picker calls link with correct stable IDs.
- Conversion maintains the same clip ID and selection.
- Existing link presents open/change behavior.
- Cancel causes zero mutation.

**Handoff evidence:** Action eligibility table and component/integration test results.

### WP8: Generation context and Include Audio gating

**Owner:** Generation agent  
**Dependencies:** WP1 and WP2 selectors  
**Owned files:** Generation context selector/helper, generation request adapter/caller, generation controls tests and deterministic eval fixture.  
**Do not modify:** General scene editor layout, Media/Timeline entry points, track components.

Tasks:

1. Implement the pure generation-context result union.
2. Derive projection timing and audio interval only from a valid selected projection.
3. Add unplaced/Media/mismatch disabled reasons.
4. Construct the existing generation contract with `shotId`, selected `clipId`, timing, audio choice, model/schema, and ordered references.
5. Ensure generation completion does not mutate projection duration/trim.

Required tests/evals:

- Unplaced + Include Audio off follows existing supported visual path.
- Unplaced + Include Audio on is disabled with exact actionable copy.
- Placed + Include Audio on sends selected projection timing.
- Scene with multiple projections uses the explicitly selected clip.
- Media-opened scene with projections does not guess.
- Mismatched/stale projection is disabled.
- Reference ordering matches the generation spec.
- Generation result leaves projection timing/trim byte-for-byte unchanged.

**Handoff evidence:** Context truth table, serialized request fixtures, test/eval command and pass result.

### WP9: NeuralFrames and legacy integration audit

**Owner:** Compatibility agent  
**Dependencies:** WP1, WP2, WP8  
**Owned files:** NeuralFrames adapters/integration tests and legacy scene call sites not owned above.  
**Do not modify:** Canonical contracts without lead approval, general UI/layout.

Tasks:

1. Replace ad hoc `kind === "scene"` checks with canonical helpers.
2. Ensure NeuralFrames-created scene clips link to the same scene collection and retain provider metadata/source.
3. Audit all scene-link consumers for canonical/legacy support.
4. Add end-to-end fixture coverage for loading and editing old projects.

Required tests:

- Existing NeuralFrames clip opens the shared scene editor.
- Legacy clip remains at identical timing and retains provider/unknown metadata after edit/save.
- New NeuralFrames writes use canonical metadata.

**Handoff evidence:** Audited call-site list and compatibility test results.

### WP10: Lead integration, specification, and browser verification

**Owner:** Lead agent  
**Dependencies:** WP1–WP9  
**Owned files:** Integration conflict resolution, `docs/spec/timeline.md`, related scene/generation spec, E2E tests.  

Tasks:

1. Merge in dependency order: WP1, WP2/WP3, WP4/WP5/WP6/WP7/WP8, WP9.
2. Resolve only through frozen contracts; reject duplicated scene stores or UI-local orchestration.
3. Update canonical specs with ownership, metadata, active-track behavior, generation gating, and compatibility period.
4. Run all focused tests, typecheck, and existing relevant suites.
5. Start the editor and reproduce every browser scenario in section 11.
6. Inspect console errors, persistence after reload, keyboard behavior, and both normal and failure paths.

**Handoff evidence:** Final command log, browser scenario checklist with screenshots where useful, no new console errors, and list of any unverified assumptions.

## 10. Merge-conflict prevention and subagent protocol

Each GPT-5.4-mini subagent receives:

- This plan and only the contract sections relevant to its package.
- The exact base commit containing WP1 contracts.
- Owned files and explicit do-not-modify boundaries.
- Required tests and the required handoff evidence.

Rules for all packages:

1. Inspect exact symbols and callers with semantic tooling before editing.
2. Do not rename or widen a frozen contract. Report a blocker to the lead with a minimal proposed contract diff.
3. Do not add a second source of truth for scenes, projection timing, or active track.
4. Add deterministic tests in the same commit as implementation.
5. Keep commits atomic and conventional, one package concern per commit.
6. Return changed-file list, test commands/results, assumptions, and remaining failure modes.
7. Never “fix” unrelated dirty files or reformat shared files outside ownership.

Recommended concurrency after WP1 lands:

```text
WP1 contracts
 ├─ WP2 store ─┬─ WP4 Media UI
 │             ├─ WP5 Inspector
 │             ├─ WP7 Clip actions
 │             └─ WP8 Generation
 ├─ WP3 active track ── WP6 Timeline menu
 └─ WP9 compatibility waits for WP2 + WP8

WP4–WP9 ── WP10 integration and browser QA
```

Do not run WP4, WP5, WP6, or WP7 against guessed store APIs. If parallelism is needed before WP2 finishes, their agents may write tests/components against the frozen typed interface, but the lead must keep interface ownership in WP2 and resolve wiring after it lands.

## 11. Verification plan

### 11.1 Deterministic test matrix

At minimum, cover these cross-layer cases:

| Scenario | Expected evidence |
|---|---|
| Create in Media | One scene, zero projections, scene inspector selected, playhead unchanged |
| Create in Timeline | One scene and one projection on active video track at exact playhead |
| Locked active track | Disabled item/reason; zero mutation |
| Audio on, unplaced | Generate disabled with placement message |
| Audio off, unplaced | Visual generation available when model supports it |
| Multiple projections | Selected projection alone supplies timing |
| Edit projection duration/trim | Only selected clip changes |
| Edit scene prompt/title | All projections resolve updated creative data |
| Associate Media video | Scene media changes; no projection appears |
| Link existing clip | Only canonical link metadata changes |
| Convert existing clip | Same clip ID and all non-link fields preserved |
| Legacy/NeuralFrames load | Opens, edits, saves with stable timing and preserved metadata |
| Delete active track | Deterministic fallback becomes highlighted |
| Undo/redo timeline create | Scene and projection removed/restored together |

Use existing test infrastructure and focused files. Expected command shapes, adjusted to actual scripts discovered by the lead:

```bash
rtk pnpm --filter @openreel/music-video-domain test
rtk pnpm --filter @openreel/web test:run -- <focused-test-files>
rtk pnpm --filter @openreel/web typecheck
rtk pnpm --filter @openreel/web test:e2e -- <scene-creation-spec>
```

If a listed script does not exist, use the repository's equivalent and record it. Do not add a duplicate test runner solely to match this plan.

### 11.2 Required browser scenarios

Browser verification is mandatory because component and type tests cannot prove timeline interaction or visual highlighting.

Start the app using the repository workflow, normally:

```bash
rtk pnpm dev
```

Verify in the real editor:

1. Load a project with two video tracks plus an audio track. Confirm exactly one track is strongly highlighted across header and lane.
2. Click each header, empty lane, and clip. Confirm activation follows the interaction and does not move clips.
3. Put the playhead at a non-zero, non-integer-representable UI position supported by the editor. Use timeline **Add Track → Create Scene**. Confirm the clip starts exactly at the displayed/canonical playhead time and is on the active track.
4. Confirm title focus, selection, unchanged playhead, and no duplicate scene/clip.
5. Activate audio and locked video tracks in turn. Confirm disabled copy and zero mutation.
6. Create from Media. Confirm **Not on timeline**, no clip, and creative editor availability.
7. Check Include Audio. Confirm Generate disables and displays the placement explanation. Uncheck it and confirm the supported visual path becomes available.
8. Place the scene, select its projection, enable audio, and inspect/request generation. Confirm projection timing is used and there is no audio-range field.
9. Place the same scene twice with different durations/trims. Confirm editing one projection does not alter the other. Open from Media with audio enabled and confirm generation asks for a selected projection.
10. Associate an existing video asset with an unplaced scene. Confirm it remains unplaced.
11. Link an existing video clip to an existing scene. Confirm placement/trim/effects remain unchanged.
12. Convert a richly configured video clip. Compare before/after values and confirm the clip ID is unchanged.
13. Reload a fixture/project containing legacy and NeuralFrames clips. Confirm they open in the shared editor and remain stable after save/reload.
14. Delete or reorder the active track and confirm fallback/highlight updates without console errors.
15. Exercise keyboard navigation and menu activation. Confirm the active state and disabled explanations are perceivable without a pointer.
16. Check narrow and standard editor widths plus supported light/dark themes. Confirm the active ring does not shift lane geometry.

Record console output and treat new runtime errors, React warnings, persistence errors, or unhandled promise rejections as failures.

## 12. Failure modes and required handling

- **Track disappears between menu open and click:** Operation revalidates captured ID; show a recoverable error and create nothing.
- **Playhead changes while menu is open:** Capture at command activation, not menu-open time, unless existing menu semantics explicitly freeze command context. Test the chosen behavior; default is activation time.
- **Scene deleted while picker/editor is open:** Close or show missing-scene state; never write to a replacement by array index.
- **Clip no longer links to the supplied scene:** Generation and inspector show mismatch/orphan state; do not use its timing.
- **Associated media deleted:** Preserve the scene and show missing-media state with replace/clear actions.
- **Partial cross-store failure:** Roll back transaction/compound command; no accidental orphan scene or half-linked clip.
- **Legacy metadata lacks a usable ID:** Keep the clip ordinary/orphaned and offer repair; do not invent an unstable link.
- **Multiple projections:** Never infer generation timing from array order.
- **Locked track becomes active:** Highlight may remain, but creation is disabled and explains unlock requirement.
- **Undo after conversion:** Restore exact original metadata and remove only the scene created by that conversion if it has not gained independent references; encode the compound-command policy in tests.
- **Generation completes after projection deletion:** Associate result with the scene if still valid, but do not recreate or mutate the deleted projection; follow existing cancellation/result policy.

## 13. Documentation updates

Update `docs/spec/timeline.md` and the relevant generation/storyboard spec to state:

- `StoryboardShot`/scene owns creative content.
- Timeline `Clip` owns placement, duration, and trim.
- Canonical projection metadata and accepted legacy forms.
- Media creation is unplaced; timeline creation targets active track at exact playhead.
- Active-track fallback and compatibility rules.
- Include Audio requires an explicitly selected placed projection for timing.
- There is no explicit persisted audio-range input.
- Existing clip linking/conversion preservation guarantees.
- Compatibility removal criteria: legacy reads may be removed only after persisted-project telemetry/migration evidence shows no supported legacy records remain, or after an explicit breaking migration.

## 14. Definition of done

Do not mark the implementation complete until:

- All sixteen user-visible acceptance criteria pass.
- Domain, store, component, integration, and generation request tests pass.
- Relevant pre-existing tests and web typecheck pass.
- Browser scenarios pass in the actual editor with no new console errors.
- Duration, trim, and audio range have not been added to the scene record.
- Conversion preservation has a whole-object regression test.
- Legacy and NeuralFrames fixtures pass load/edit/save verification.
- Specs match the shipped contracts.
- Each package has traceable handoff evidence and atomic commits.
- The final report states why the implementation is correct, identifies remaining failure modes, and links each claim to test or browser evidence.

