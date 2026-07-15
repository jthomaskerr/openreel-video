# Timeline — Operational Spec

**Status:** Canonical operational specification
**Owner:** Timeline subsystem
**Supersedes:** [Track Grouping](./track-grouping.md) and the timeline contracts formerly contained in [Media Import & Timeline Placement](./media-import-timeline.md)

## Scope

This specification owns the editor timeline's persisted track and clip model, view-only grouping, placement behavior, context menus, selection, timeline thumbnails, and the projection of domain records such as storyboard shots onto clips.

It does not own media import and availability, creative storyboard data, generation jobs, or subtitle transcription. Those contracts live in [Media Assets](./media-assets.md), [Storyboard](./storyboard.md), [Generation](./generation.md), and [Audio Analysis & Subtitles](./audio-analysis-subtitles.md).

## 1. Persisted Model

### 1.1 Tracks

The persisted timeline consists of ordered `Track` records containing ordered `Clip` records. Supported track types include `video`, `audio`, `image`, `text`, `subtitle`, and `metadata`.

- A track type constrains which clips may be placed on it.
- Track IDs and clip IDs are stable project identifiers.
- UI grouping MUST NOT alter track order, track IDs, clip timing, or serialized project data.
- Metadata tracks MAY carry project-domain records that need timeline timing but do not render as audiovisual layers.

### 1.2 Clips

Every clip owns its timeline placement through `trackId`, `startTime`, `duration`, trim state, and its referenced `mediaId`. Domain-specific metadata MAY be stored in `clip.metadata`, but the domain record remains authoritative for creative or semantic content.

Clips whose source media is unavailable remain on the timeline with their identity, timing, edits, and metadata intact. Runtime availability state is defined by [Media Assets](./media-assets.md).

### 1.3 Storyboard Clip Projection

A clip representing a storyboard shot MUST use this single contract:

```ts
interface StoryboardClipMetadata {
  kind: "storyboard-shot";
  shotId: string;
  shotIndex?: number;
  label?: string;
  prompt?: string;
  referenceImageUrl?: string;
  generatedAssetIds?: string[];
  source?: "storyboard-generation" | "neuralframes" | "manual";
  importSource?: string;
  importId?: string;
}
```

- `shotId` is the only required foreign key beyond the discriminator.
- `shotId` SHOULD resolve to a `StoryboardShot`; an unresolved reference MUST NOT prevent the clip or other tracks from rendering.
- Denormalized fields are display caches only. [Storyboard](./storyboard.md) owns creative truth.
- New clips MUST write `kind: "storyboard-shot"`.
- During the compatibility period, readers MUST also accept legacy `kind: "scene"`
  links with a usable scene/shot ID and NeuralFrames links with a string
  `metadata.shotId` plus `metadata.importSource === "neuralframes"`, even when
  `kind` is absent. Normalization preserves unknown/provider fields. Malformed
  metadata remains an ordinary or recoverable orphan clip and MUST NOT invent an ID.
- Legacy reads may be removed only after telemetry or explicit migration evidence
  shows that no supported persisted project still contains those shapes, or as part
  of an announced breaking migration.

## 2. Track Creation and Placement

### 2.1 New Track Actions

The timeline MUST expose track creation through both the New Track control and the empty-space context menu. The user chooses the track type before creation. A context-menu action uses the pointer position that opened the menu and MUST NOT reuse a stale previous position.

### 2.2 Placement Contract

All placement entry points MUST call one shared placement operation with explicit media ID, target track ID, and intended timeline time.

- Drag from the Media pane uses the drop target track and pointer-derived time.
- The Media pane add button uses the selected compatible track and current playhead time.
- Generated output uses its explicit placement policy and shot range.
- Imported scene placement uses source timing when valid.
- A clip context-menu action uses the clicked clip, never only the globally selected clip.
- Track compatibility is validated before mutation.
- Invalid placement reports a structured problem and does not partially add a clip.

Overlaps are allowed unless a specialized operation explicitly requests replacement. Placement MUST NOT silently ripple, trim, delete, or move existing clips.

### 2.3 Time Conversion

Pointer coordinates MUST be converted with the current zoom, horizontal scroll, and timeline origin. Times are clamped to zero and quantized only when snapping is enabled. Context-menu coordinates are captured at invocation and discarded when the menu closes.

### 2.4 Scene Creation and Active Track

`activeTrackId` is view state, not persisted project or clip metadata. When tracks
change, keep the current visible track; otherwise prefer the selected clip's track,
then the first unlocked video track, then the first visible track, and use `null`
only when there are no tracks. Header, empty-lane, clip-selection, drag-source, and
successful cross-track drop interactions activate their track.

Scene placement is compatible only with an existing unlocked video track. Timeline
**Create Scene** captures the active track and playhead at activation and creates one
scene plus one projection at that exact time without snapping, rounding, gap finding,
or ripple. Media **Create Scene** creates an unplaced scene and does not move the
playhead. A scene may have multiple projections with independent placement, duration,
trim, effects, and transforms.

## 3. View-Only Track Grouping

### 3.1 Group Model

Track grouping is synchronously derived from tracks and clip metadata. It is a view-layer concern and MUST NOT mutate project data.

Canonical group IDs are:

```ts
type TimelineGroupId =
  | "video"
  | "storyboard"
  | "audio"
  | "image"
  | "text"
  | "subtitle"
  | "metadata";
```

Classification precedence MUST be deterministic. Storyboard-specialized video tracks are classified as `storyboard` before generic `video`; remaining tracks are classified by their persisted type.

### 3.2 Expansion State

Expansion state belongs to the UI store, keyed by `TimelineGroupId`. It MAY persist as user-interface preference but MUST NOT enter project JSON.

- Group headers expose expanded state with `aria-expanded`.
- Keyboard activation supports Enter and Space.
- Collapsing a group hides its raw tracks without changing selection or data.
- The storyboard group MAY retain a compact shot metadata strip while collapsed.
- Empty groups are not rendered.

### 3.3 Ordering

Group and track ordering are stable. A grouping function MUST return equivalent output for equivalent input without mutating its arguments. Re-rendering or toggling expansion MUST NOT reorder clips or tracks.

## 4. Timeline Rendering

### 4.1 Clip Selection

Selection is stable by clip ID. Selecting a storyboard clip MAY synchronize selection with its `StoryboardShot`, but selection synchronization MUST NOT copy creative state into the clip or change placement.

### 4.2 Visual Status

Timeline clips render media availability and generation status without conflating them:

- `verifying`, `temporarily_unavailable`, `unauthorized`, and `decode_error` use non-destructive status presentation.
- Only `confirmed_missing` presents missing-media treatment and relink as the primary action.
- A generation badge reflects the linked job/output status, not media availability.
- Status changes MUST NOT alter clip duration, timing, metadata, or identity.

### 4.3 Thumbnails and Filmstrips

- Image clips render a stable thumbnail covering the visible clip region.
- Video clips SHOULD render ordered filmstrip frames corresponding to source time.
- Current-session `blob:` thumbnail and filmstrip URLs are valid while their creating page remains active.
- Page-scoped URLs MUST be removed at the persistence boundary, not rejected by renderers solely because they use the `blob:` scheme.
- Restored media regenerates transient thumbnails from hydrated bytes or a durable source.
- Thumbnail failure never establishes that source media is missing.
- Extraction is lazy, cancellable, cached by media/version and sampling parameters, and bounded by visible demand.

Fallback image resolution and durable source availability are owned by [Media Assets](./media-assets.md).

## 5. Context Menus

Empty-space, track, and clip context menus are distinct surfaces.

- Empty-space menus operate at the captured pointer time.
- Track menus operate on the invoked track.
- Clip menus operate on the invoked clip and its track.
- Opening one menu closes any other timeline menu.
- Escape and outside click close the active menu.
- Actions unavailable for the invoked target are hidden or disabled with an accessible explanation.
- Ordinary video clips offer linking to an existing scene or in-place conversion.
  Linking changes only canonical scene-link metadata. Conversion preserves the clip
  ID, media, track, placement, duration, trim, effects, transforms, transitions, and
  unrelated or future extension metadata.

## 6. Integration Boundaries

- [Media Assets](./media-assets.md) owns import, media identity, availability, thumbnails as asset data, and relinking.
- [Storyboard](./storyboard.md) owns `StoryboardShot` and generation/alteration of creative shot records.
- [Generation](./generation.md) owns jobs, outputs, and placement policy selection; this spec owns the actual timeline mutation.
- [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) owns subtitle clips and transcription; this spec owns generic track placement and rendering behavior.
- [Inspector Shell](./inspector-shell.md) owns inspector routing for selected clips.

## 7. Required Tests

Deterministic tests MUST cover:

- pure grouping, ordering, and non-mutation;
- expansion-state defaults and persistence scope;
- each placement entry point using the shared placement operation;
- pointer-to-time conversion under zoom and scroll;
- invoked-target context-menu behavior;
- overlap behavior and track compatibility rejection;
- storyboard metadata migration and unresolved shot IDs;
- current-session object URL rendering and persistence sanitization;
- availability transitions without clip mutation;
- keyboard and ARIA behavior for group headers and menus.

Browser verification MUST reproduce drag placement, add-button placement, empty-space and clip context menus, grouping collapse/expand, restored thumbnails, and unavailable-media recovery at desktop and narrow editor widths.

## 8. Failure Modes

- A stale menu position places media at an earlier invocation point.
- A global selection is used instead of the context-menu target.
- Grouping mutates persisted track order or metadata.
- Competing `StoryboardClipMetadata` definitions drift.
- A failed thumbnail is interpreted as missing source media.
- Restored stale object URLs are rendered after reload.
- Repeated generation finalization creates duplicate clips.
- A late async result updates a different project or a replaced media version.
