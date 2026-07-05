# Inspector / Right-Sidebar Shell — Operational Spec

> Derived from user directives and existing implementation patterns.
> Sources: [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §11, [OpenReel Spec Implications report](../superpowers/plans/spec-update/openreel-spec-implications-report.json) (Inspector / UI Shell category), [Storyboard UI plan](../superpowers/plans/2026-07-03-storyboard-ui.md) (panel registration), `ui-store.ts` (PanelId / DEFAULT_PANELS), `InspectorPanel.tsx`, `AssetInspectorWithTabs.tsx`, `clip-tabs.config.ts`, `WaveformPreview.tsx`, `ProblemsPanel.tsx`, `LogPanel.tsx`, `SceneMetadataInspector.tsx` (character pill / `@token` prompt parsing).

---

## 1. Primary Right-Sidebar Tab Bar

The right sidebar MUST present a primary tab bar with exactly four tabs, rendered as a horizontal row of icon+label buttons at the top of the sidebar panel.

### 1.1 Tab Set

| Tab ID | Label | Icon | Behavior |
|---|---|---|---|
| `inspector` | Inspector | `Info` (lucide) | Shows clip/asset properties; the default active tab. |
| `edit` | Edit | `Pencil` (lucide) | Shows per-clip-type editing controls (Transform, Color, Audio, etc.). |
| `problems` | Problems | `AlertTriangle` (lucide) | Shows a list of detected problems with resolve actions. Displays a badge count when problems exist. |
| `log` | Log | `List` (lucide) | Shows an immutable, filterable log of project events. |

### 1.2 State

- The active primary tab MUST be stored as `sidebarTab` in the UI store with type `"inspector" | "edit" | "problems" | "log"`.
- The default value MUST be `"inspector"`.
- Switching tabs MUST call `setSidebarTab(id)`.

### 1.3 Rendering

- The tab bar MUST use `role="tablist"` with `aria-label="Sidebar tabs"`.
- Each tab button MUST use `role="tab"` with `aria-selected` reflecting the active state.
- The active tab MUST be visually distinguished with an accent-colored bottom border (`border-b-2`).
- The Problems tab MUST show a badge (e.g., `{problemCount}`) when `problemCount > 0`, rendered as a small yellow pill.

### 1.4 Requirements

- The primary tab bar MUST be visible at all times when the right sidebar is open.
- Selecting a clip or asset MUST NOT change the active primary tab unless the selection context requires it (e.g., opening an asset inspector MAY switch to the Inspector tab).
- The Problems tab MUST display a live count of unresolved problems from the problem store.

---

## 2. Inspector Pane

The Inspector pane is shown when `sidebarTab === "inspector"`.

### 2.1 Asset Inspector

When an asset is inspected (via `inspectedAsset` in the UI store or by selecting a single timeline clip whose media item is resolved), the pane MUST render `AssetInspectorWithTabs`.

#### 2.1.1 Secondary Tabs (Asset-Level)

The asset inspector MUST present a secondary tab bar with tabs determined by the asset type:

| Tab ID | Label | Icon | Applicable To |
|---|---|---|---|
| `clip` | Clip | `Film` | All asset types |
| `file` | File | `FileText` | All asset types |
| `audio` | Audio | `Music` | Audio assets only |
| `generation` | Generation | `Sparkles` | Assets with `generationMeta` |
| `versions` | Versions | `GitBranch` | Assets with version history |
| `usages` | Usages | `Link2` | Assets used on the timeline |

- The secondary tab bar MUST use `role="tablist"` with `aria-label="Asset inspector tabs"`.
- Tab availability MUST be computed from the asset's type and metadata; unavailable tabs MUST be omitted from the bar.
- The active secondary tab MUST be tracked in local component state (not persisted globally).

#### 2.1.2 Clip Tab

The Clip tab MUST show:
- A large preview thumbnail (clickable for lightbox).
- Filename (read-only, inline-rename on click).
- Title (editable inline).
- Description (multi-line textarea, auto-save on blur).
- Tags (chip input: type tag + Enter to add, Backspace to remove last, click × to remove).
- Group (text input with datalist autocomplete from existing groups).

#### 2.1.3 File Tab

The File tab MUST show:
- **For all types**: Filename, Type, Size, Duration, Dimensions (if applicable).
- **For video assets**: Frame Rate, Codec, Audio Channels, Audio Track Count, Sample Rate.
- **For image assets**: Codec, Thumbnail availability.
- **Filmstrip**: If `filmstripThumbnails` is present, a horizontally scrollable row of frame thumbnails with timestamp tooltips.

#### 2.1.4 Audio Tab (Audio Assets Only)

The Audio tab MUST show:
- **Audio Analysis section**: BPM (formatted as `{value} BPM` or `—`), Key, Scale, Has Lyrics (Yes/No).
- **Audio section**: Sample Rate, Channels, Codec, Audio Track Count.

#### 2.1.5 Generation Tab

The Generation tab MUST show (when `generationMeta` is present):
- **Provider section**: Provider name, Model, Job ID, Status (color-coded badge).
- **Prompt section**: Editable textarea for the generation prompt, auto-saved on blur.
- **Negative Prompt section**: Editable textarea for the negative prompt.
- **Inputs section**: Key-value display of generation inputs, excluding `sourceAssets` and `sourceMetadataBlockIds`.
- **Source Assets section**: Linked thumbnails of source assets used in generation, clickable to navigate to those assets.

#### 2.1.6 Versions Tab

The Versions tab MUST show:
- A list of all versions in the same `assetGroupId`, each with thumbnail, name, date, size.
- "Set as Current" action on non-current versions.
- "Add Version" action (opens file picker).
- When no versions exist: "Duplicate to create a version" prompt.

#### 2.1.7 Usages Tab

The Usages tab MUST show:
- A list of timeline clips that reference this asset, each with thumbnail, clip ID, track name, and time range.
- Clicking a usage entry MUST navigate to that clip on the timeline.

### 2.2 Empty State

When no clip is selected and no asset is inspected, the Inspector pane MUST show an empty state:
- Icon or muted text: "No selection".
- Subtext: "Select a clip to view its properties".

### 2.3 Requirements

- Selecting a single timeline clip MUST update the inspector to show that clip's media item properties.
- When a clip is selected and no explicit asset is pinned via `inspectedAsset`, the clip's `mediaId` MUST be resolved to the corresponding `MediaItem` and displayed.
- The `effectiveInspectedAsset` MUST always be re-resolved from the project store (via `getMediaItem`) to reflect live updates (e.g., after `replaceMediaAsset`).

---

## 3. Edit Pane

The Edit pane is shown when `sidebarTab === "edit"`.

### 3.1 Clip Header

When a clip is selected, the Edit pane MUST render a clip header showing:
- Clip name (truncated ID).
- Duration in seconds.
- Type label (video, audio, image, text, shape, svg, sticker, note).

### 3.2 Secondary Tabs (Clip-Level)

The Edit pane MUST present a secondary tab bar with tabs determined by the selected clip's type, as defined in `clip-tabs.config.ts`:

| Clip Type | Available Tabs |
|---|---|
| `video` | Transform, Color, Effects, Audio, Speed, Animate, AI |
| `image` | Transform, Color, Effects, Speed, Animate, AI |
| `audio` | Audio, AI |
| `text` | Transform, Style, Effects, Animate |
| `shape` | Transform, Style, Effects, Animate |
| `svg` | Transform, Style, Effects, Animate |
| `sticker` | Transform, Effects, Animate |
| `note` | Note |

### 3.3 Tab Definitions

Each tab MUST have an `InspectorTabId`, label, and icon:

| Tab ID | Label | Icon |
|---|---|---|
| `transform` | Transform | `Move` |
| `color` | Color | `Palette` |
| `effects` | Effects | `Wand2` |
| `audio` | Audio | `Volume2` |
| `speed` | Speed | `Gauge` |
| `animate` | Animate | `Film` |
| `ai` | AI | `Sparkles` |
| `style` | Style | `Type` |
| `note` | Note | `StickyNote` |

### 3.4 Tab State

- The active secondary tab MUST be stored as `inspectorActiveTab` in the UI store (type `string`, default `"transform"`).
- When the selected clip changes and the current `inspectorActiveTab` is not valid for the new clip type, the active tab MUST reset to the first available tab for that clip type.

### 3.5 Tab Content

Each tab MUST render its content inside an `InspectorTabPanel` wrapper that shows/hides based on the active tab. Each tab panel MUST be wrapped in an `InspectorTabErrorBoundary` to isolate rendering failures.

#### 3.5.1 Transform Tab

MUST show position (X, Y), scale (X, Y), rotation, anchor point (X, Y), and opacity controls. Changes MUST call `updateClipTransform`.

#### 3.5.2 Color Tab

MUST show color grading controls including brightness, contrast, saturation, and temperature. MUST integrate with the `ChromaKeyEngine` for background removal when applicable.

#### 3.5.3 Effects Tab

MUST show a list of applied video effects with toggle, reorder, and parameter editing. MUST support adding new effects from the effects library.

#### 3.5.4 Audio Tab

MUST show:
- **Audio Preview section**: `WaveformPreview` component (see §5).
- **Audio Effects section** (when applicable): noise reduction, equalizer, compression controls.

#### 3.5.5 Speed Tab

MUST show playback speed control and duration display.

#### 3.5.6 Animate Tab

MUST show keyframe animation controls for the selected clip.

#### 3.5.7 AI Tab

MUST show AI-powered editing controls (background removal, auto-caption, text-to-speech, filter presets, music library, templates, multi-camera).

#### 3.5.8 Style Tab

MUST show text/font styling controls for text, shape, and SVG clips.

#### 3.5.9 Note Tab

MUST show a simple note editor for note-type clips.

### 3.6 Metadata Clip Handling

When the selected clip is a metadata clip (`type === "metadata"`), the Edit pane MUST route to `MetadataClipInspector`, which dispatches to kind-specific inspectors:

| `metadata.kind` | Inspector Component | Content |
|---|---|---|
| `"music-video"` | `MusicVideoMetadataInspector` | Workflow sections: Brief, Audio Analysis, etc. |
| `"scene"` | `SceneMetadataInspector` | Prompt (with inline character pills, see §3.8), shot metadata, linked shots. |
| `"character"` | `CharacterMetadataInspector` | Name, description, reference images (see §3.8.6 for reference-image pill linking). |
| `"style"` | `StyleMetadataInspector` | LoRA / style inputs. |
| `"note"` | `DirectorNotesInspector` or `NoteMetadataInspector` | Director notes or generic note fields. |
| _(unknown)_ | Fallback | Read-only display of the kind name. |

- Metadata clip inspectors MUST support editable properties where applicable.
- Unknown metadata kinds MUST render a minimal read-only fallback without crashing.

### 3.7 Scene Metadata on Video Clips

When a video clip has `metadata.kind === "scene"`, the Edit pane MUST render a `SceneMetadataInspector` section above the secondary tab content, showing scene-specific metadata (prompt, shot linkage) while still allowing access to the standard video clip tabs below.

### 3.8 Character Pills in Prompt Fields

Any prompt or description field that can reference a character or another timeline asset (scene prompts, video-clip descriptions/prompts, generation prompts) MUST render those references as inline **pills**, not as raw text or a separate "referenced assets" list.

> This is the canonical section for character/reference pill behavior. Other spec documents (storyboard, media import, AI generation, asset management) MUST link back here rather than redefine pill rendering rules.

#### 3.8.1 Token Syntax

- A character reference in prompt text MUST use the token form `@<token>`, where `<token>` matches `[A-Za-z0-9_.-]+`.
- `<token>` MUST resolve (case-insensitively) against either:
  - the character's `characterId` (`metadata.importId` on the character clip), or
  - the character's `name` with spaces replaced by underscores (e.g. `Jane Doe` → `@jane_doe`).
- Tokens that do not resolve to a known character MUST be left as plain text — they MUST NOT be silently dropped or throw.
- Reference clips (non-character assets explicitly referred to in a prompt — e.g. a style, prop, or location clip) MUST use the same `@token` mechanism and MUST resolve against that clip's own id/name in the same way.

#### 3.8.2 Pill Rendering

- Parsed prompt text MUST render as a sequence of tokens: plain-text spans interleaved with pill components, not as a single unstyled string.
- Pills MUST render **inline within the prompt text itself** — never as a separate list, sidebar, or "mentioned characters" panel below the text. (User directive: "the character pills MUST be inline in the fucking prompt".)
- A character pill MUST show:
  - the character's thumbnail image (if available) as a small circular avatar, or a generic person icon as fallback;
  - the character's display name.
- A reference-clip pill (non-character) MUST show an icon matching the referenced clip's media type (image, audio, or video icon) instead of a person icon, plus the clip's label/name.
- Pills MUST be visually distinct from surrounding text (e.g. rounded pill background, accent border/color) so they read as interactive chips, not inline text.

#### 3.8.3 Interaction

- Clicking a pill MUST select the corresponding character/reference clip in the timeline (dispatch the standard selection action with that clip's `id` and `trackId`) — pills are navigational links, not just decoration.
- Clicking a pill MUST NOT enter prompt edit mode or otherwise interfere with the surrounding editable text (`stopPropagation` on the pill's click handler).
- Hovering a pill SHOULD show a tooltip identifying the target (e.g. `Select <name> clip`).

#### 3.8.4 Edit Mode

- While the prompt field is in edit mode (raw textarea), the underlying text MUST show the literal `@token` syntax so it remains editable as plain text.
- Leaving edit mode (blur / save) MUST re-render the saved text through the pill parser so newly typed `@token`s immediately resolve to pills.

#### 3.8.5 Scope

Pill rendering and the `@token` parser MUST be applied consistently to every field, panel, and card that displays or edits a generation prompt or description referencing characters/assets, including at minimum:

| Location | Field(s) | Spec reference |
|---|---|---|
| `SceneMetadataInspector` (Edit pane, scene metadata clips) | Prompt | This section (canonical implementation) |
| Video clip description/prompt fields (`metadata.kind === "scene"` on video clips, and any other video-clip prompt/description field) | Description, prompt | §3.7 |
| `CharacterMetadataInspector` reference images grid | Reference image labels/links | §3.8.6 (Reference Images Pane) |
| Storyboard `ShotCard` prompt preview | `shot.prompt` truncated preview | `storyboard.md` §"ShotCard Component" |
| `GenerateStoryboardDialog` / `AlterStoryboardDialog` prompt fields | Shot prompt, instruction text | `storyboard.md` (Generate/Alter Storyboard sections) |
| `ShotMetadataMetaTrack` expanded shot cards (timeline) | Prompt text (truncated to 3 lines) | `track-grouping.md` §"Expanded Shot Metadata Meta-Track" |
| AI Generate dialog prompt/negative-prompt fields | Generation prompt | `ai-generation-providers.md` §3 (Unified Generate Dialog) |
| Job management panel job rows | Truncated prompt display | `ai-generation-providers.md` §"Job Management Panel" |
| Character Library panel (asset management) | Character description, linked-clip references | `asset-management-ux.md` §6 (Character Management) |

There is no "compact preview" exception: truncation, small card sizes, and read-only contexts affect how much text is shown, never whether `@token` mentions render as pills. Any future generation-prompt field that accepts character/asset mentions MUST also apply this parser — it is not an optional enhancement.

A regression where a prompt/description field, storyboard card, or reference-image entry falls back to plain single-line text or an unlinked thumbnail without pill/link behavior MUST be treated as a bug, not an acceptable degraded state.

#### 3.8.6 Reference Images Pane

The Reference Images pane (rendered inside `SceneMetadataInspector`, `CharacterMetadataInspector`, `StyleMetadataInspector`, and any other inspector accepting reference images) displays a grid of reference/generated images attached to the selected clip via URL fields (`referenceImageUrls`, `characterImageUrls`, `thumbnailUrl`, etc.) or asset-ID fields (`referenceAssetIds`, `linkedGeneratedAssetIds`).

- Each grid entry MUST be a clickable link/button, not a static image.
- When a grid entry resolves to a known `MediaItem` in the project's media library (via an asset-ID field), clicking it MUST open that media item (e.g., in the asset inspector or a lightbox), consistent with the "reference clips... must be rendered likewise with an image/audio/video icon" directive applied to prompt pills in §3.8.2.
- When a grid entry resolves to a character or timeline clip (not just a raw media item), clicking it MUST select that clip in the timeline — the same navigational behavior as a character pill (§3.8.3), so the Reference Images pane and inline prompt pills stay behaviorally consistent.
- Entries with no resolvable URL MUST show a "No image" placeholder rather than a broken image.
- Each entry MUST show a media-type icon (image/audio/video) when the entry represents a non-image reference (e.g., an audio or video reference clip), matching the reference-clip pill styling in §3.8.2.
- The pane MUST include a "Generate" action that opens the AI Generate dialog scoped to the current clip (see `ai-generation-providers.md` §3).

### 3.9 Subtitle Selection

When a subtitle is selected (not a clip), the Edit pane MUST show:
- Subtitle header with time range.
- Text content editor (textarea).
- Timing controls (start time, end time).
- Position selector (top, center, bottom).
- Animation style selector with description of each style.

### 3.10 Requirements

- The Edit pane MUST show an empty state when no clip or subtitle is selected.
- Import errors MUST be displayed via `ImportErrorsPanel` at the top of the edit content area.
- The secondary tab bar MUST use `role="tablist"` with `aria-label="Inspector tabs"` (or equivalent).

---

## 4. Problems Pane

The Problems pane is shown when `sidebarTab === "problems"`.

### 4.1 Problem Kinds

The Problems pane MUST display problems of the following kinds, each with a distinct icon and color:

| Kind | Label | Icon | Color |
|---|---|---|---|
| `missing_media` | Missing file | `FileQuestion` | Yellow |
| `block_failed` | Import failed | `AlertTriangle` | Red |
| `image_failed` | Image failed | `ImageOff` | Orange |
| `import_error` | Import error | `AlertTriangle` | Red |
| `generation_failed` | Generation failed | `Sparkles` | Purple |

### 4.2 Problem Row

Each problem row MUST show:
- Kind icon and label.
- Problem description/message.
- Available resolve actions as buttons (e.g., "Link file", "Remove media", "Retry generation").
- Dismiss button (×) to clear the problem.

### 4.3 Resolve Actions

Resolve actions MUST be defined per problem kind and executed via `executeResolveAction`:
- `link_file`: Opens a file picker to relink a missing media file.
- `remove_media`: Removes the problematic media item from the project.
- `retry_generation`: Retries a failed AI generation job.

### 4.4 Requirements

- Problems MUST be surfaced in the Problems tab, not only in the browser console.
- Fixable problems MUST present fix actions inline.
- The problem count badge on the primary tab bar MUST reflect the live count from the problem store.

---

## 5. Log Pane

The Log pane is shown when `sidebarTab === "log"`.

### 5.1 Log Entries

The Log pane MUST display an immutable, chronological list of log entries from the log store. Each entry MUST include:
- Timestamp.
- Kind icon and label (mapped from `KIND_ICON` / `KIND_LABEL`).
- Message text.
- Optional scope tags (project, clip, track).

### 5.2 Filtering

The Log pane MUST support filtering by:
- **Text search**: Free-text search across log messages.
- **Kind filter**: Checkbox toggles for each log kind.
- **Scope filter**: Filter by project, clip, or track scope.

### 5.3 Requirements

- The log MUST be immutable — entries are append-only and never modified.
- Filters MUST be local to the Log pane and MUST NOT auto-filter based on clip selection.
- The log MUST persist across sessions (via the log store's persistence mechanism).

---

## 6. Waveform Component

The waveform component (`WaveformPreview`) MUST be used in both the asset inspector (Audio tab / File tab preview) and the Edit pane (Audio tab).

### 6.1 Rendering

- The waveform MUST be rendered using WaveSurfer.js.
- The waveform container MUST have `data-testid="audio-waveform"`.
- Waveform height MUST be 72px with `barWidth: 2`, `barGap: 1`, `barRadius: 2`.
- Wave color MUST be `rgba(148, 163, 184, 0.45)` (muted).
- Progress color MUST be `rgb(34, 197, 94)` (green).
- Cursor color MUST be `rgb(34, 197, 94)` (green) with `cursorWidth: 2`.

### 6.2 Click-to-Seek

- The waveform MUST support click-to-seek via WaveSurfer's `dragToSeek: true` option.
- Clicking or dragging anywhere on the waveform MUST seek the playback position to that point.

### 6.3 Current-Time Highlight

- The waveform MUST display a progress bar (the `progressColor` region) that fills from the start to the current playback time.
- The waveform MUST display a cursor line at the current playback position.
- The current time MUST be tracked via WaveSurfer's `timeupdate` event and displayed as a formatted duration (`m:ss`) below the waveform.

### 6.4 Playback Controls

- A play/pause toggle button MUST be rendered below the waveform.
- The button MUST use `aria-label="Play audio preview"` or `aria-label="Pause audio preview"` depending on state.
- The button icon MUST toggle between `Play` and `Pause` (lucide icons).
- Playback MUST stop automatically when the audio reaches the end (`finish` event).

### 6.5 Audio Source

- The waveform MUST use `item.originalUrl` as the primary audio source.
- If `item.blob` is available, a blob URL MUST be created via `URL.createObjectURL` and used instead.
- Pre-computed waveform peaks (`item.waveformData`) MUST be passed to WaveSurfer when available.
- Blob URLs MUST be revoked on cleanup.

### 6.6 Requirements

- The waveform MUST be re-created when the item's `id`, `blob`, `originalUrl`, `duration`, or `waveformData` changes.
- The waveform MUST be destroyed and its resources cleaned up on unmount.

---

## 7. Panel Registration

All resizable panels in the editor MUST be registered through the `PanelId` type and `DEFAULT_PANELS` record in the UI store.

### 7.1 PanelId Type

The `PanelId` union type MUST enumerate all registered panel identifiers:

```typescript
export type PanelId =
  | "mediaLibrary"
  | "inspector"
  | "effects"
  | "audioMixer"
  | "colorGrading"
  | "subtitles"
  | "chat"
  | "storyboard";
```

### 7.2 PanelState

Each panel MUST have a `PanelState` with:
- `visible: boolean` — whether the panel is currently shown.
- `width: number` — the panel's width in pixels.

### 7.3 DEFAULT_PANELS

The `DEFAULT_PANELS` record MUST provide default state for every `PanelId`:

| Panel ID | Default Visible | Default Width |
|---|---|---|
| `mediaLibrary` | `true` | `300` |
| `inspector` | `true` | `300` |
| `effects` | `false` | `300` |
| `audioMixer` | `false` | `300` |
| `colorGrading` | `false` | `400` |
| `subtitles` | `false` | `300` |
| `chat` | `false` | `360` |
| `storyboard` | `false` | `400` |

### 7.4 Panel Actions

The UI store MUST provide these actions for all registered panels:
- `togglePanel(panelId: PanelId)` — toggles visibility.
- `setPanelVisible(panelId: PanelId, visible: boolean)` — sets visibility explicitly.
- `setPanelWidth(panelId: PanelId, width: number)` — sets width.
- `setPanelCollapsed(panelId: PanelId, collapsed: boolean)` — sets collapsed state.

### 7.5 Storyboard Panel

The storyboard panel MUST be registered as `"storyboard"` in `PanelId` and `DEFAULT_PANELS`. It MUST:
- Render a grid of `ShotCard` components from `useMusicVideoStore`.
- Support shot selection, select-all/deselect-all, and inline editing.
- Communicate with the timeline through shared store state and storyboard clip metadata — no direct timeline DOM manipulation.
- Be toggleable via the existing `togglePanel("storyboard")` infrastructure.

### 7.6 Chat Panel

The chat panel MUST be registered as `"chat"` in `PanelId` and `DEFAULT_PANELS`. It MUST:
- Render the session-based chat interface.
- Be resizable independently of the inspector via a drag handle.
- Be toggleable via `togglePanel("chat")`.

### 7.7 Requirements

- Adding a new panel MUST require only: (a) adding the ID to `PanelId`, (b) adding a default entry to `DEFAULT_PANELS`. No new store actions are required.
- Existing `PanelId` values MUST NOT be changed or removed without a migration.
- Panel visibility and width MUST be persisted across sessions via the UI store's persistence mechanism.

---

## 8. Layout Integration

### 8.1 Grid Layout

The editor interface MUST use a CSS Grid layout with resizable columns:
- **Left**: Media library panel (`--media-w`).
- **Center**: Stage/preview (`1fr`).
- **Right**: Inspector panel (`--inspector-w`).
- **Far right** (when visible): Chat panel.

Resize handles MUST be placed between each column, draggable to adjust widths.

### 8.2 Resize Constraints

- Inspector minimum width: `MIN_INSPECTOR_W` (implementation-defined, e.g., 260px).
- Inspector maximum width: constrained by available space minus minimum stage width.
- Resize MUST be handled via `mousedown` on the handle, `mousemove` to track delta, and `mouseup` to commit.

### 8.3 Requirements

- The right sidebar MUST always contain the primary tab bar at the top, regardless of which pane is active.
- The inspector and chat panels MUST be independently resizable.
- Panel widths MUST be persisted in the UI store.

---

## 9. Open Questions

- TODO: Should the Edit pane secondary tabs be user-customizable (reorder, hide)?
- TODO: Should the Problems pane support bulk-dismiss or "dismiss all"?
- TODO: Should the Log pane support export (e.g., download as JSON/CSV)?
- TODO: Should the waveform support zoom/scroll for long audio files?
- TODO: Should the storyboard panel render in the right sidebar or in the timeline band? (Current plan places it in the timeline band; sidebar placement is a future option.)
- TODO: Should the chat panel auto-open when a new session message arrives?
