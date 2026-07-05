# Asset & Project Management — UX Spec

## 1. Asset Browser (Media Tab)

### Layout
Three density modes (large grid / small grid / list) with a continuous zoom slider replacing the three-button toggle. `Ctrl+scroll` anywhere in the panel zooms thumbnails.

### Buckets (collapsible sections)
Auto-generated from asset metadata. Multiple expandable simultaneously. Collapse-all / expand-all button in the header bar.

| Bucket | Source |
|---|---|
| All Assets | everything |
| Videos / Audio / Images | `item.type` |
| By tag | `item.tags` — one bucket per tag |
| By group | `item.group` — one bucket per group |
| Recently Added | last 24h by `createdAt` (needs new field) |
| Unused | media not on any timeline track |

- Drag an asset into a tag/group bucket to assign that tag/group (optimistic update, undo-able).
- Right-click a bucket header → "Rename group" / "Delete group" (batch-removes group from all items).

### Selection
- Click selects. `Ctrl+click` / `Shift+click` range-select.
- Selection state shown as count badge in header: "3 selected".
- Selected items can be batch-tagged, grouped, or deleted via a floating action bar.
- Delete key removes selected items (with undo toast).

### Search
Single search bar. Queries across `name`, `title`, `description`, `tags`, `group`. Autocomplete dropdown suggests existing tags/groups as you type. Prefix filters: `type:video`, `tag:foo`, `group:bar`, `missing:true`.

### Sort
Dropdown: Name (A-Z, Z-A), Date Added (newest/oldest), Type, Duration, Size. Sticky per-session preference.

### Drag to timeline
Drag any thumbnail onto the timeline. If the project has no tracks yet and the first clip is video, auto-match project settings to clip resolution (existing behavior, keep).

### Import
Drag files onto the panel. Paste from clipboard. "Import" button opens OS file picker. Batch import shows per-file progress. Detects duplicates by filename+size and skips or offers "Import as new version."

---

## 2. Asset Inspector (Right Panel or Modal)

### When a single asset is selected:
Shows metadata in a right-side inspector panel (not a modal), replacing current inspector content.

**Details section:**
- Large preview thumbnail (click for lightbox)
- Filename (read-only, click to rename inline)
- Title (editable inline)
- Description (multi-line textarea, auto-save on blur)
- Tags (chip input — type tag + Enter, Backspace removes last, click × to remove)
- Group (text input with datalist autocomplete from existing groups)

**File info section (read-only):**
- Type badge (Video/Audio/Image with icon)
- Resolution (W×H)
- Duration (mm:ss.ms)
- File size
- Codec
- Frame rate / sample rate

**Version section:**
- "Versions (N)" header with count
- List of versions in same `assetGroupId`, each showing thumbnail + name + date + size
- "Set as Current" button on non-current versions
- "Add Version" button — opens file picker, imports as new version
- When no versions exist: "Duplicate to create a version" button

**Generation info (if applicable):**
- Provider + Model badges
- Prompt (collapsed by default, expand to view)
- "Regenerate" button if KieAI task ID present

**Actions:**
- Add to Timeline
- Export / Download original
- Replace (file picker)
- Delete (with confirmation)

---

## 3. Asset Versioning

### Model
- `assetGroupId: string` — shared by all versions of an asset
- `isCurrent: boolean` — only one version per group is current
- `createdAt: number` — timestamp for sort order (needs new field on MediaItem)
- Timeline clips always reference the CURRENT version's mediaId. Promoting an old version updates clip references automatically.

### Version creation
1. **Import with same filename+size** → detected as duplicate, offer version or skip
2. **Replace** from inspector → replaces current version, old becomes previous version
3. **Duplicate** from inspector → creates new version with same blob
4. **Generate** (KieAI) → creates new version, auto-sets as current

### UX
- Version list in inspector shows thumbnail + name + date + "current" badge
- Old versions are preserved in the library (visible in "all" view, filterable)
- Only the current version appears in type/tag buckets by default; toggle "show all versions" to include old ones

---

## 4. Tags

### Model
- `item.tags: string[]` — freeform, lowercase, trimmed
- No global tag registry — tags are derived from items. Deleting the last item with a tag removes the tag bucket automatically.

### Tag chips
- Rendered as small colored pills: `#b-roll`, `#interview`, `#drone`
- Clicking a tag chip filters the browser to that tag
- Right-click → "Remove tag" on individual items
- Batch tag: select multiple items → type tag in floating bar → applied to all

---

## 5. Project Management

### Rename
- Click project name in toolbar → inline edit → Enter / blur commits (already done)
- Project name shown in window title: `{project name} — OpenReel`

### Settings
- Project settings dialog: resolution, frame rate, sample rate presets
- "Match first clip" button — sets project resolution to first video clip's dimensions

### Auto-save
- Already exists via `AutoSaveMetadata`. Surface "Last saved: HH:MM:SS" in toolbar.

### Recent projects
- Already exists via `RecentProjects` component. Add project thumbnail (first frame of timeline).

---

## 6. Character Management (Music Video Domain)

> **See also:** [Inspector Shell spec](./inspector-shell.md) §3.8 (Character Pills in Prompt Fields) for how character mentions inside scene/shot prompts render as inline, clickable pills, and §3.8.6 (Reference Images Pane) for reference-image linking behavior. Both apply to characters managed here.

### Current state
Characters exist as `MetadataBlock` entries (`kind: "continuity_note"`) on a "Characters" `MetadataTrack` inside `MusicVideoProject`. Imported from Neural Frames JSON. Inspector is read-only.

### Target
**Character library panel** — persistent, project-scoped:
- **Grid of character cards**: name, description snippet, reference image count
- **Add character** button → modal with Name, Description, Reference Images (drag thumbnails from media library)
- **Edit character** → same modal, pre-filled
- **Delete character** → confirmation dialog
- **Link to timeline**: each character can be linked to timeline metadata clips. Changing character name/description updates all linked clips.

**Character metadata clips on timeline:**
- Inspector shows editable fields (already partially done in working tree)
- "Link to character" dropdown — selects from character library
- When linked, fields are synced from library and read-only in the inspector
- Unlink button to detach

**Reference images:**
- Character's reference images stored as `assetGroupId` array
- Click reference image thumbnail → opens in media library view filtered to that group (see `inspector-shell.md` §3.8.6 for the general clickable/linking requirement)
- Images shown as small thumbnails in character card and inspector

---

## 7. Performance Architecture

### Subscriptions
- Components subscribe to the smallest possible Zustand selectors
- Function references are read once via `getState()` — they're stable in Zustand
- Arrays/objects use custom equality or `useShallow` to avoid false-positive re-renders

### Media item stability
- `useStableMediaItems` hook prevents re-renders when `structuredClone` in action executor recreates unchanged items
- Compares by `item.id` + key display fields

### Virtualization
- For libraries exceeding ~200 items, use `@tanstack/react-virtual` in the media grid
- Only render items in the viewport + overscan buffer

### Thumbnail loading
- Lazy-load thumbnails with `IntersectionObserver`
- Show skeleton placeholders while loading
- Cache thumbnails in IndexedDB keyed by media item ID + modification timestamp

### Memoization
- `React.memo` on all list item components with custom comparators
- `useMemo` on all derived data (filtered lists, bucket computation, sort order)
- No render-prop closures — pass components or stable refs

---

## 8. Implementation Order

### Phase A — Immediate (this session)
- [x] `MediaItem` type extension (title, description, tags, group) ✓
- [x] `updateMediaMetadata` action ✓
- [x] `React.memo` + custom comparators ✓
- [x] `useStableMediaItems` hook ✓
- [x] Narrow store subscriptions ✓
- [x] AssetManagerDialog (Info + Versions tabs) ✓
- [x] Collapsible asset buckets ✓
- [x] Context menu: Rename, Manage ✓

### Phase B — Polish
- [ ] Replace three-button view toggle with continuous zoom slider
- [ ] Sort dropdown
- [ ] Search autocomplete with tag/group suggestions
- [ ] Selection count badge + batch tag/group/delete
- [ ] Keyboard shortcuts (Delete, Enter, Ctrl+A)
- [ ] "Recently Added" and "Unused" smart buckets
- [ ] Collapse-all / expand-all toggle
- [ ] Drag-to-bucket for tagging/grouping
- [ ] Lightbox preview on double-click
- [ ] Skeleton thumbnails during load

### Phase C — Character Library
- [ ] Character library panel (grid of cards)
- [ ] Add/Edit/Delete character modal
- [ ] Link characters to timeline metadata clips
- [ ] Reference image management
- [ ] Sync character changes to linked clips

### Phase D — Hardening
- [ ] Virtual scrolling for large libraries (>200 items)
- [ ] Thumbnail lazy-loading with IntersectionObserver
- [ ] IndexedDB thumbnail cache
- [ ] Performance profiling pass with React DevTools
- [ ] Accessibility audit (keyboard nav, ARIA labels, screen reader)

---

## 9. Project Lifecycle *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Projects MUST NOT be created automatically; creation MUST only occur via an explicit "New Project" action.
- The "New Project" action MUST prompt the user for a project name before creation.
- The `/new` command and "Start from scratch" entry point MUST both trigger the same name-prompt flow.
- Deleting a project MUST remove the entire project directory and all associated media files.
- The project picker MUST list all projects with multi-select support, bulk actions, and a per-project action toolbar.
- Importing a project MUST name the project according to importer-provided information (e.g., JSON metadata, filename).

---

## 10. Media Import & Timeline Placement *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Scenes MUST be imported as video clips on a video track, not as metadata-track entries.
- Characters and reference clips MUST use reference images as their thumbnails.
- Audio files referenced by an import JSON (`trimmed_audio_path`) MUST be imported as audio clips.
- Missing files during import MUST still create placeholder clips with a "Link file" action to resolve later.
- Generated clips MUST display status badges (e.g., pending, cancelled, failed, completed).
- Overlapping clips on a single track MUST be treated as an error.
- Timeline thumbnails MUST be shown for all clip types that support them.
- Metadata tracks MUST reuse the same visual layout as audio/video tracks.

---

## 11. Inspector / Right-Sidebar Shell *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- The primary right-sidebar tab bar MUST contain: **Inspector**, **Edit**, **Problems**, **Log**.
- The **Edit** pane MUST have secondary tabs including Transform, Color, Audio, and others as needed.
- The **Inspector** pane MUST have secondary tabs specific to the selected clip or asset type.
- Selecting a timeline clip MUST update the inspector to show that clip's properties.
- Metadata clips MUST have their own inspector sub-tabs with editable properties.
- Video clips MUST have tabs: **Clip**, **File**, **Generation**, **Versions**.
- Audio clips MUST have a **File** tab with waveform visualization, playback controls, BPM, key, and scale display.
- The waveform MUST support click-to-seek and highlight the current playback time.

---

## 12. Thumbnails & Missing-File Fallbacks *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- When a video file is missing, the thumbnail MUST fall back to the first first-frame reference or the first `reference_image` in all display contexts.
- For non-video assets (images, characters), thumbnail blocks MUST fill the clip area by repeating the thumbnail image.
- Video clips on the timeline MUST extract frames at a periodic interval (every N seconds) and display them as a frame sequence.

---

## 13. AI Generation & Providers *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- The AI Generate dialog MUST be a unified interface for all providers.
- Provider model lists MUST be cached locally and refreshed in the background.
- All provider settings MUST support multiple instances, each with an optional API key and base URL.
- Model selection MUST validate generation parameters against the selected model's capabilities.
- There MUST be a configurable default video generator model and a default image generator model.

---

## 14. Backend, Persistence & Versioning *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Project versions MUST be immutable; both media and metadata MUST be versioned.
- The version list MUST include the current version and MUST allow reverting to any prior version without losing subsequent versions.
- Relative file paths in project JSON MUST resolve relative to the project file location.
- Importing a project JSON file MUST import all referenced media files.
- Project restore MUST be backend-first, replacing any IndexedDB-based auto-restore mechanism.
- Media files MUST be stored immutably; git-lfs SHOULD be used for large media assets.

---

## 15. Problems, Errors & Logging *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Errors MUST surface in the **Problems** tab; they MUST NOT be console-only.
- The Problems tab MUST be limited to fixable issues, each with a specific fix action.
- The **Log** pane MUST contain all errors immutably, tagged with project, clip, and scope metadata, and MUST be filterable.
- Selecting a clip MUST NOT automatically filter the log to that clip.

---

## 16. Testing Expectations *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- All new behaviors MUST have corresponding tests.
- Regressions MUST have dedicated regression tests.
- Examples of required regression coverage:
  - Project auto-creation prevention.
  - Missing-file thumbnail fallback.
  - Asset title preservation across operations.

---

## 17. Audio Analysis & Subtitles *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Audio analysis MUST provide genre, beat detection, and sentiment as time-series data aligned to song sections.
- Sentiment analysis SHOULD align with the start/end boundaries of repeated lyric sections (e.g., choruses).
- Audio analysis MUST include librosa energy as a time-series metric.
- Subtitles MUST be a first-class track/clip type with rendering and editing support.

---

## 18. Export *(Operational)*

> Derived from user directives. Detailed implementation spec TBD.

- Export MUST support the following output formats:
  - MP4 (H.264 and H.265 codecs)
  - WebM
  - ProRes
  - Image sequences
  - Audio-only
