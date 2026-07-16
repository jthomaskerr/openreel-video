# Inspector / Right-Sidebar Shell — Operational Spec

**Status:** Canonical operational specification
**Owner:** Inspector shell and editor right-sidebar subsystem

## Scope

This specification owns right-sidebar navigation, inspector routing, edit-tab structure, panel registration, layout, waveform placement, and inline reference-pill presentation. It does not own Problems/Log behavior, media availability, generation jobs, or domain-specific data contracts.

## 1. Primary Navigation

The right sidebar has exactly four primary destinations:

```ts
type SidebarTab = "inspector" | "edit" | "problems" | "log";
```

- Inspector presents selected asset information and asset-level actions.
- Edit presents selected clip/domain-record editing controls.
- Problems hosts the canonical [Problems, Errors & Logging](./problems-errors-logging.md) Problems surface.
- Log hosts the canonical [Problems, Errors & Logging](./problems-errors-logging.md) Log surface.

The tab list uses `role="tablist"`, tabs expose selected state and keyboard navigation, and each tab controls one labelled panel. The active primary tab is UI state, not project data.

## 2. Inspector Routing

Routing is determined from stable selection identity and selected record kind, not component-local copies of the selected object.

| Selection | Inspector destination |
|---|---|
| No selection | Contextual empty state |
| Media asset | Asset inspector |
| Audio asset | Asset inspector with Audio tab |
| Subtitle clip | Subtitle inspector |
| Music-video metadata clip | Music-video inspector |
| Scene metadata clip | Scene inspector |
| Character metadata clip | Character inspector |
| Style metadata clip | Style inspector |
| Ordinary timeline clip | Clip edit inspector |
| Multiple compatible items | Explicit multi-selection summary/actions |

Unknown or malformed metadata falls back safely to a generic inspector and reports a structured diagnostic. Routing MUST NOT crash the editor or silently reinterpret one domain kind as another.

## 3. Asset Inspector

The asset inspector may expose Clip, File, Audio, Generate, Versions, and Usages secondary tabs according to capability.

- File shows display title, true filename, type, duration/dimensions, tags, provenance, and availability from [Media Assets](./media-assets.md).
- Audio shows waveform and analysis from [Audio Analysis & Subtitles](./audio-analysis-subtitles.md).
- Generate embeds the controller from [AI Generation and Providers](./generation.md).
- Versions and Usages consume canonical media/version and project-reference data.

Tabs that do not apply are omitted. Changing asset selection preserves a secondary tab only when it remains valid; otherwise it selects the first valid tab.

## 4. Edit Inspector

The ordinary clip edit surface exposes capability-based tabs such as Transform, Color, Effects, Audio, Speed, Animate, Generate, Style, and Note.

- Tab availability is derived from clip/media capability.
- Editing operates on current store identity and is undoable.
- Switching selection never applies a pending edit to the previous clip.
- Metadata/domain clips route to their specialized inspector rather than generic transform controls.
- Subtitle editing follows [Audio Analysis & Subtitles](./audio-analysis-subtitles.md).
- Generation follows [AI Generation and Providers](./generation.md).

## 5. Character and Media Reference Mentions

The complete prompt, picker, pill, reference-card, and item-navigation contract
is [References and Generated Images](./references.md). Every prompt-capable
surface uses the same `MediaMentionEditor`.

Typing `@` opens the rich character/image picker. New selections persist typed
stable IDs and render as atomic inline pills with a name and micro-thumbnail.
Immediately below the prompt, the UI shows `Type @ to refer to other media`.

Clicking a pill or reference card opens the referenced item's type-specific
editor in a focus-managed modal. Shift-click opens the same component in the
inspector sidebar. Character references route to the character editor; image
references route to the image inspector or generated-image editor. Closing a
modal restores focus to its invoking pill or card.

This is the canonical presentation contract for references inside prompt or description fields.

The stable textual syntax is `@<character-slug>` or another explicitly typed asset token. The editor renders resolved tokens as inline pills while preserving a parseable textual representation.

- Pills show a concise label and optional thumbnail.
- Keyboard navigation can enter, select, edit, and remove a pill.
- Backspace at the pill boundary removes the whole token, not a partial hidden string.
- Typing `@` opens the searchable chooser without losing surrounding text.
- Unresolved and ambiguous tokens remain visible as errors and offer resolution.
- The underlying stored prompt remains portable plain text plus explicit resolved IDs/provenance where required.

The adjacent References section is derived from prompt mentions and automatic
generation context. It lists resolved cards, origins, availability, and any
model-supported reference-role dropdown. Prompt membership remains the source
of truth for user-selected references; the section does not provide a second
add/remove mechanism.

Every prompt-capable surface, including storyboard cards and generation forms, links to and follows this contract instead of redefining pills.

## 6. Waveform

Audio-capable inspector surfaces use one shared waveform component.

- It renders a bounded downsampled representation of the selected source.
- Clicking seeks using the current source/timeline mapping.
- Current time, selection range, trim, and analysis overlays are visually distinct.
- Playback controls use the shared editor transport.
- Source changes cancel stale decoding and prevent late results from replacing the current waveform.
- The component includes keyboard controls and a non-visual time/value description.

## 7. Panel Registration and Layout

Panels are registered by stable `PanelId` with title, location, visibility, minimum/maximum size, and component routing. Registration is configuration; user sizing and visibility are UI state.

The editor layout:

- keeps the preview/timeline usable at supported widths;
- constrains sidebar resizing to safe bounds;
- does not allow content to force the grid wider than the viewport;
- provides scroll containment inside panels rather than at the entire editor page;
- restores persisted layout only after validating panel IDs and bounds;
- provides a deterministic reset layout action.

Storyboard and chat panels are independently registered surfaces and are not encoded as inspector tabs unless explicitly selected by the product navigation model.

## 8. Problems and Log Integration

This spec owns only the tabs, badges, and mounting points.

- The Problems badge reflects the unresolved count supplied by the problem store.
- Problems and Log filtering, kinds, lifecycle, actions, persistence, and rendering are owned solely by [Problems, Errors & Logging](./problems-errors-logging.md).
- Selecting a clip MUST NOT implicitly change Log filters.

## 9. Required Tests

Deterministic tests cover primary navigation, keyboard/ARIA behavior, every selection route, malformed metadata fallback, secondary-tab capability and reset, selection-safe edits, token parsing/rendering/editing, waveform source races, panel-bound validation, and Problems/Log mounting without duplicate behavior.

Browser verification covers asset, clip, metadata, subtitle, and empty selection; pill editing; waveform seeking; panel resizing; narrow layouts; and Problems/Log navigation.

## 10. Failure Modes

- Domain clips fall through to destructive generic controls.
- A stale selected object receives edits after selection changes.
- Reference pills alter or lose stored prompt text.
- The Inspector and Problems specs define conflicting problem actions.
- Invalid persisted sizing makes the editor unusable.
- A late waveform decode replaces the current asset.
