# Media title from metadata, not filename (inbox #23)

## Problem statement

When a user imports a video, audio, or image file into OpenReel, the media
item's display name is currently always the raw filename (e.g.
`my_video_clip-01.mp4`). Many media files carry a proper title in their
container metadata (ID3 tags in MP3, MP4/QuickTime `udta`/`meta` atoms, WebM
Tags, Vorbis comments, RIFF INFO chunks) that is more meaningful than the
filename, and is already exposed by the `mediabunny` library the app uses for
media probing. When no such title exists, falling back to the filename
verbatim exposes `snake_case`/`kebab-case` artifacts (`my_video_clip-01.mp4`)
that read poorly in the UI.

The inbox request: prefer an embedded metadata title over the filename; when
falling back to filename, transform it to sentence case and drop the
extension.

## Goals

1. When a media file's metadata contains a non-empty title tag, use it as the
   display name shown in the media bin, inspector, and timeline clip labels.
2. When no metadata title is present (or it's empty/whitespace), derive a
   display name from the filename: strip the extension, convert
   snake_case/kebab-case separators to spaces, and capitalize as sentence
   case.
3. The filename-to-title transform is a pure, deterministic string function
   with unit tests — no LLM involvement.
4. Do not regress the existing "Filename" info row in the inspector (must
   keep showing the true raw filename) or any code path that depends on the
   literal filename for file-identity matching, re-linking, export naming, or
   backend upload naming.

## Non-goals

- Do not build a general "smart rename" or duplicate-detection feature.
- Do not touch EXIF/XMP extraction for images (see Open Questions — no
  metadata title source currently exists for images by container format
  alone; out of scope for this spec unless Joseph decides otherwise).
- Do not change the user-editable `title` field's existing semantics (users
  can already override it manually via `updateMediaMetadata`).
- Do not migrate previously imported/saved projects' existing `name`/`title`
  values in bulk. See Backward compatibility below.

## Current behavior (file:line references)

### Data model

`packages/core/src/types/project.ts`:
- `MediaItem` (line 68) has both:
  - `name: string` (line 70) — currently always set to the raw filename at
    import time.
  - `title?: string` (line 97-98) — already documented as "User-editable
    title for the asset (distinct from filename-based name)". Currently only
    ever populated by explicit user action via `updateMediaMetadata`; never
    populated automatically from file metadata or from a transformed
    filename.
- `MediaMetadata` (line 115) carries technical fields only (duration, width,
  height, frameRate, codec, sampleRate, channels, fileSize, bpm, key, scale,
  has_lyrics, audioTrackCount). No descriptive title/artist/album fields.

`packages/core/src/media/types.ts`:
- `MediaTrackInfo` (line 10) and `ProcessedMedia` (line 1) — the shape
  produced by the media-probing engine — carry only technical fields, no
  title/description/artist tags.

### Metadata extraction

`packages/core/src/media/mediabunny-engine.ts`:
- `MediaBunnyEngine.extractMetadata()` (line 394) is the entry point used
  during import. For images it calls `extractImageMetadata()` (line 358),
  which only reads `naturalWidth`/`naturalHeight` via an `<img>` element — no
  EXIF/XMP parsing exists anywhere in the codebase.
- For video/audio it builds a `mediabunny` `Input` via `createInput()` (line
  294) and pulls technical fields (duration, tracks, format) — it never calls
  `input.getMetadataTags()`.

`mediabunny.d.ts` (vendored type declarations for the `mediabunny` package):
- Line 1577: `Input.getMetadataTags(): Promise<MetadataTags>` — the API that
  is not currently called anywhere in the codebase (confirmed via repo-wide
  search; zero call sites).
- Lines 1974-2029: `MetadataTags` type, including `title?: string` (line
  1976), plus `description`, `artist`, `album`, `albumArtist`, `genre`,
  `date`, `lyrics`, `comment`, `images` (cover art), and a `raw` passthrough
  map. Per the doc comment (lines 1958-1969), Mediabunny normalizes:
  - MP4/QuickTime: `moov`-level `udta`/`meta` atoms
  - WebM/Matroska: `Tags`/`Attachments` elements
  - MP3: ID3v2 tags (falls back to ID3v1 via the `raw['TAG']` key)
  - Ogg: Vorbis-style comment headers
  - WAVE: RIFF `INFO` chunk
  - FLAC: Vorbis comment block
  So MP3/ID3, MP4, WebM, WAV, and FLAC title tags are all reachable through
  this single API — no per-format parser needs to be written.
- There is no equivalent EXIF/XMP title extraction for images in mediabunny
  or elsewhere in this repo.

### Import flow (sets `name` to raw filename)

`apps/web/src/stores/project-store.ts`, `importMedia` action:
- SRT import branch: `name: file.name` (~line 1846, second occurrence
  ~line 1862 for the replace-existing-media path).
- Main video/audio/image import branch: `name: file.name` at line 2013-2015,
  paired with `sourceFile: { name: file.name, ... }` (line 2033).
- A near-duplicate branch (folder-drop / batch import) at line 2234 and
  2256, and another at line 2622 and 2644, all follow the identical
  `name: file.name` pattern.
- `preserveUserMediaMetadata()` (lines 101-116) is called when replacing an
  existing file; it carries forward `title`, `description`, `tags`, `group`,
  etc. from the previous item but NOT `name` — replacement always resets
  `name` to the new file's filename. This helper is the natural place to
  also decide whether to keep a previously-derived title.
- `getImportedFileName()` (line 84-86): `item.sourceFile?.name ?? item.name`
  — used for file-identity matching (`findMediaItemByFileIdentity`, line
  92-99) so that re-dropping the same file replaces rather than duplicates
  it. This MUST keep using the raw filename, not the derived title.

`apps/image/src/components/editor/panels/LeftPanel.tsx` (lines 986, 1013):
same `name: file.name` pattern for the standalone image editor's asset
import; this app manages its own `MediaAsset` type
(`packages/image-core/src/project.ts` line 260) which has `name: string`
only — no `title` field exists there today.

### Where the raw filename is currently displayed

- `apps/web/src/components/editor/AssetsPanel.tsx` (media bin/library — main
  gap): grid-card view uses `item.name` directly with no `title` fallback at
  lines 295 (`alt`), 327 (`title` attr), 329 (text), and the large-card
  layout at lines 461 (`alt`), 562 (`title` attr), 564 (text). Also used for
  search filtering (line 869: `item.name.toLowerCase().includes(query)`) and
  in the rename prompt default value (line 1176:
  `window.prompt("Rename asset:", item.name)`).
- `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`:
  already has partial precedent for preferring `title`:
  - Line 136, 161: `alt={item.title ?? item.name}` (preview image alt text).
  - Line 620: `{item.title || item.name}` (inspector header — the visible
    asset name in the inspector panel).
  - Line 204-205 (`FileTab`): `fileRows.push({ label: "Filename", value:
    item.name })` — correctly shows the raw filename in a dedicated "File"
    info tab; must NOT change to use title.
  - Line 674 (`AssetInspectorToolbar`, download handler):
    `a.download = item.name` — correctly uses the raw filename for the
    downloaded file's name; must NOT change.
- `apps/web/src/components/editor/Preview.tsx` (lines 803, 2486): uses
  `mediaItem.name` in console log/debug strings only — cosmetic, not
  user-facing display; low priority but should be updated for consistency
  in logs (optional).
- `apps/web/src/components/editor/preview/missing-video-placeholder.ts`
  (line 145): doc comment references `mediaItem.name` as the default
  override value shown in the "missing video" placeholder frame — this is a
  literal user-visible fallback display and should switch to the derived
  title.
- `apps/web/src/components/editor/panels/RecipesTab.tsx` (lines 184, 216-217):
  `selectedMedia?.name` used in toast copy and a `title` attribute for
  "Selected Clip" panel — user-visible, should prefer title.
- `apps/web/src/components/editor/asset-manager/AssetDetailShared.tsx`
  (line 321): `{v.title || v.name}` — already follows the title-first
  pattern (version history view).
- `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx`
  (lines 20, 24, 101, 180, 185): reference-image picker chips use
  `item.name` with no title fallback — user-visible, should be updated.
- `apps/web/src/components/editor/inspector/TemplateVariablesPanel.tsx`
  (line 192): `alt={media.name}` — user-visible alt text, should prefer
  title.
- Timeline: no per-clip text label was found rendering `mediaItem.name`
  directly in `Timeline.tsx`/`TrackHeader.tsx` (those `track.name` sightings
  at Timeline.tsx:902 and TrackHeader.tsx:137 refer to a different concept —
  user-renamed *track* names, not media item names — and are out of scope).
  Clip thumbnails in the timeline pull from `filmstripThumbnails`/
  `thumbnailUrl`, not a text label, in the current UI. **Verify this
  directly in the running app before implementation**, since a text label
  could be rendered conditionally (e.g., narrow zoom levels) that this
  static search may have missed.

### Renaming and metadata-editing actions (existing infrastructure)

`apps/web/src/stores/project-store.ts`:
- `renameMedia: async (mediaId, name)` (line 2338): dispatches a
  `media/rename` action that sets `MediaItem.name`. Used by the manual
  "Rename asset" prompt.
- `updateMediaMetadata: async (mediaId, patch: { title?, description?, tags?, group?
  })` (line 2353): dispatches a `media/updateMetadata` action that sets
  `MediaItem.title` (among others). Both actions are also exposed to the
  in-app LLM tool surface (`apps/web/src/services/llm/tools/index.ts` lines
  27-28), so an agent can already rename or retitle an asset — this feature
  should reuse `title`, not introduce a third field.

### Export / serialization

`apps/web/src/services/llm/snapshot.ts` (line 284): `name: item.name` is
serialized into an LLM-facing project snapshot. `apps/web/src/services/
backend-save.ts` (line 174): `item.name` used as the display filename when
uploading media blobs to the backend (`uploadMedia(project.id, item.id,
item.blob, item.name)`) — this is a filename-for-storage argument and must
keep using the raw name, not a derived title.

No dedicated project-file JSON schema/version file was found separate from
the `Project`/`MediaItem` TypeScript interfaces above — `MediaItem` is
serialized as-is (project save/load uses the interface directly via
`project-manager.ts`). Adding a new field is additive and backward
compatible: old project JSON simply won't have `title` populated by this
feature, and reading code must tolerate `title` being absent (it already
does, since `title` is optional and used via `??`/`||` fallback in
multiple places already).

## Proposed design

### Precedence rule

For any `MediaItem`, the canonical **display name** is:

```
displayName(item) = nonEmpty(item.title) ?? nonEmpty(deriveTitleFromMetadata(item)) ?? titleCase(deriveTitleFromFilename(item.name))
```

Concretely, at import time (not at render time — see Backward compatibility
below), the app computes:

1. If the file's embedded metadata (`mediabunny` `getMetadataTags().title`)
   is present and, after trimming whitespace, non-empty → set
   `MediaItem.title` to that trimmed string.
2. Else → set `MediaItem.title` to `filenameToTitle(file.name)` (defined
   below).
3. `MediaItem.name` continues to be set to the raw `file.name` exactly as
   today — it remains the canonical "true filename" field used for file
   identity matching, re-linking, download-as, and backend upload naming.
4. All *display* call sites (media bin, inspector header, generate/reference
   pickers, template variables panel, missing-video placeholder, toast/log
   copy) read `item.title || item.name` — most of the plumbing for this
   already exists in `AssetInspectorWithTabs.tsx`; it needs to be applied
   consistently to the remaining call sites in `AssetsPanel.tsx` and others
   listed above.
5. *Identity/file-operations* call sites (`FileTab` "Filename" row, download
   handler, `getImportedFileName`, `backend-save.ts` upload naming,
   `snapshot.ts` if it is meant to reflect the literal file) continue to use
   `item.name` unchanged.

This means `title` becomes populated for every newly imported item (not just
user-edited ones), and its doc comment in `project.ts` needs a one-line
update to reflect the new "auto-derived on import, user can override" role
instead of purely "user-editable."

### Data model changes

`packages/core/src/types/project.ts`:
- No new field required — reuse the existing `MediaItem.title?: string`.
- Update the doc comment on `title` (line 97) from:
  ```
  /** User-editable title for the asset (distinct from filename-based name) */
  ```
  to something like:
  ```
  /** Display title for the asset: derived at import time from embedded
   * media metadata if present, otherwise from a sentence-cased filename.
   * User-editable thereafter; distinct from the raw filename in `name`. */
  ```

`packages/core/src/media/types.ts`:
- Add an optional `title?: string` field to `MediaTrackInfo` (or introduce a
  separate lightweight `descriptiveTags?: { title?: string }` field if the
  team prefers not to conflate technical/descriptive metadata — recommend
  the flat optional field for simplicity, since only `title` is needed for
  this feature and `MediaTrackInfo` already mixes some borderline fields
  like `codec`).

`packages/image-core/src/project.ts` (standalone image editor):
- `MediaAsset` (line 260) has no `title` field at all today. Out of scope
  for this spec's primary deliverable (the inbox item's context is clips —
  video editor), but flagged as a follow-up: if this app is meant to receive
  the same treatment, `MediaAsset` needs an analogous `title?: string` field
  plus the same import-time derivation, since images rarely carry a usable
  filename-independent title anyway (see Open Questions on EXIF).

### Extraction logic per media type

`packages/core/src/media/mediabunny-engine.ts`, inside `extractMetadata()`:

- **Video/audio** (MP4, MOV, WebM, MP3, WAV, FLAC, Ogg — anything routed
  through `createInput()`): after building the `Input`, call
  `await input.getMetadataTags()` and extract `.title`. Trim it; treat pure
  whitespace as absent. Populate the new `MediaTrackInfo.title` field with
  the trimmed value or leave it `undefined`.
- **Images**: `extractImageMetadata()` has no access to a `mediabunny`
  `Input` (it just loads dimensions via `<img>`). No EXIF/XMP title
  extraction exists in this repo. Recommendation: leave
  `MediaTrackInfo.title` `undefined` for images in this pass; images will
  fall through to the filename-derived title. See Open Questions for
  whether to add an EXIF reader (e.g. `exifr`) as a fast-follow.
- **SRT**: subtitle files are parsed directly (bypassing MediaBunny; see
  `importMedia`'s `isSrt` branch in `project-store.ts`). SRT files have no
  embedded title metadata format; always fall back to filename-derived
  title.

At the `project-store.ts` call sites (all four `importMedia` branches: SRT,
main import, folder-drop batch import ×2), after computing `processedMedia`
(or for SRT, directly), set:

```ts
const derivedTitle =
  processedMedia?.metadata?.title?.trim() ||
  filenameToTitle(file.name);

const newMediaItem: MediaItem = {
  ...
  name: file.name,        // unchanged
  title: derivedTitle,     // new
  ...
};
```

`preserveUserMediaMetadata()` (project-store.ts lines 101-116): when
replacing an existing file (`replaceMediaAsset` flow), the current behavior
carries forward the *previous* item's `title` unconditionally. This should
remain unchanged — if a user already has a title (whether auto-derived or
manually edited) on the item being replaced, keep it; do not silently
overwrite a user's edit with a new file's metadata title just because the
blob changed. This matches the existing conservative behavior for
`description`/`tags`/`group`.

### Filename-to-title transform function

A pure function, e.g. `filenameToTitle(filename: string): string`, proposed
location: `packages/core/src/media/filename-to-title.ts` (new small module,
alongside the other pure media utilities in that directory; exported from
the package's public surface next to `inferMediaType`/`isSupportedFormat`).

**Algorithm:**

1. Strip the extension: remove everything from the last `.` onward, but
   only if there is at least one character before it and the segment after
   the last `.` looks like a plausible extension (1-10 chars, no spaces) —
   guards against dotfiles (`.gitignore`-style names, which are edge cases
   for media but should not become empty strings) and against filenames
   with no extension.
2. Replace `_` and `-` characters with a single space.
3. Collapse consecutive whitespace (including the spaces just introduced)
   into a single space.
4. Trim leading/trailing whitespace.
5. If the resulting string is empty (e.g. filename was only separators or
   only an extension), fall back to a fixed default, e.g. `"Untitled"`.
6. Apply sentence case: lowercase the entire string, then uppercase only
   the first alphabetic character of the whole string. Do NOT
   title-case every word, and do NOT alter the casing of the rest of the
   string — this preserves acronyms/deliberate internal casing like `"NASA"`
   or `"iPhone"` only if step 6 is scoped correctly (see decision below on
   whether to lowercase existing mixed-case names — recommend: only
   lowercase if the source name looks like a snake/kebab identifier, i.e.
   contains `_` or `-`; if the filename already uses spaces or camelCase
   with no separators, leave case untouched and only capitalize the first
   letter). This nuance must be pinned down with the test cases below.
7. Digits and existing punctuation (e.g. parentheses, apostrophes) are left
   untouched wherever they land after separator collapsing.
8. Unicode: use locale-aware/Unicode-safe case conversion
   (`String.prototype.toLocaleLowerCase()` / a Unicode-aware first-letter
   uppercase, e.g. via `Array.from(str)` to avoid breaking on surrogate
   pairs) rather than naive `toUpperCase()` on `str[0]`, so multi-byte
   leading characters (e.g. emoji, combining diacritics, non-Latin scripts)
   are not corrupted.

**Precise rule set** (final, deterministic):

```
function filenameToTitle(filename: string): string {
  const withoutExt = stripExtension(filename); // step 1
  const hadSeparators = /[_-]/.test(withoutExt);
  let spaced = withoutExt.replace(/[_-]+/g, " ");   // steps 2-3 (regex collapses runs)
  spaced = spaced.replace(/\s+/g, " ").trim();       // step 3-4
  if (spaced.length === 0) return "Untitled";
  if (hadSeparators) {
    spaced = spaced.toLocaleLowerCase();
  }
  return capitalizeFirst(spaced); // Unicode-safe, step 6/8
}
```

Where `capitalizeFirst` finds the first Unicode code point that
`toLocaleUpperCase()` actually changes case for (skipping leading digits/
punctuation/symbols) and uppercases only that grapheme, leaving everything
else untouched.

`stripExtension`: `filename.replace(/\.[^./\\]{1,10}$/, "")`, applied only
if the match is not the entire string (avoids turning `.hidden` into `""`
before the empty-check safety net already handles it) — using the simpler
regex and relying on the "Untitled" fallback for the pathological empty
case keeps the implementation simpler than hand-rolling dotfile detection,
and is an acceptable simplification given media files essentially never
lack extensions in practice.

**Test cases table:**

| Input filename | Expected title | Rationale |
|---|---|---|
| `my_video_clip-01.mp4` | `My video clip 01` | mixed snake/kebab, digits preserved, only first letter capitalized |
| `MyVideoClip.mov` | `MyVideoClip` | no separators → case left alone, first letter already capital (no-op) |
| `myVideoClip.mov` | `MyVideoClip` | no separators, camelCase preserved except forced-capital first letter |
| `sunset-beach.jpg` | `Sunset beach` | kebab-case, lowercased then capitalized |
| `SUNSET_BEACH.PNG` | `Sunset beach` | all-caps snake_case gets lowercased (has separators) then capitalized |
| `___leading_seps.mp3` | `Leading seps` | leading separators collapse and trim away |
| `trailing_seps___.wav` | `Trailing seps` | trailing separators collapse and trim away |
| `a---b__c.mp4` | `A b c` | multiple consecutive separators of mixed type collapse to single spaces |
| `2024-01-15_final_cut.mp4` | `2024 01 15 final cut` | leading digit is left as first char; capitalizeFirst finds no case-able char before "f" in "final" — wait, see note below |
| `.gitignore` | `Untitled` | dotfile edge case: whole name matches the "extension", nothing left, falls back to default |
| `no_extension_file` | `No extension file` | no `.` present at all — nothing stripped, still processed normally |
| `클립_영상.mp4` | `클립 영상` | non-Latin script: separators still collapse; `capitalizeFirst` is a no-op if the locale has no case distinction (Korean has none) — output unchanged apart from spacing |
| `émigré_clip.mov` | `Émigré clip` | accented Latin leading character uppercases correctly via `toLocaleUpperCase` (Unicode-safe, not byte-indexed) |
| `😀party.mp4` | `😀party` | leading non-letter grapheme (emoji) — `capitalizeFirst` skips it and finds no subsequent separator-triggered lowercase pass since no separators present; case left alone |
| `` (empty string) | `Untitled` | defensive default |
| `video.mp4` | `Video` | plain single word, gets capitalized |
| `IMG_1234.HEIC` | `Img 1234` | common camera-default filename pattern — this is the primary real-world case motivating the feature |

Note on the `2024-01-15_final_cut.mp4` row: because the string starts with
a digit, `capitalizeFirst` must skip non-case-able characters (`2`, `0`,
`2`, `4`, space...) and capitalize the first alphabetic character it finds
("f" in "final"), producing `"2024 01 15 Final cut"` — **the table entry
above is corrected to `2024 01 15 Final cut`, not `2024 01 15 final cut`**.
This is called out explicitly because it's the trickiest rule in the whole
function and must be unit-tested directly.

### Affected call sites (file:line list, action required)

Display sites to change from `item.name` to `item.title || item.name`:
- `apps/web/src/components/editor/AssetsPanel.tsx`:295, 327, 329 (grid card, small view)
- `apps/web/src/components/editor/AssetsPanel.tsx`:461, 562, 564 (grid card, large view)
- `apps/web/src/components/editor/AssetsPanel.tsx`:869 (search filter — decide whether to search both `name` and `title`; recommend searching both so users can find by either)
- `apps/web/src/components/editor/AssetsPanel.tsx`:1176 (rename prompt default value — recommend defaulting the prompt to `item.title || item.name` so users rename what they see, but keep calling `renameMedia` which sets `.name`; NOTE — see Open Questions on whether "Rename" should instead call `updateMediaMetadata({title})` given `title` is now the primary display value)
- `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx`:20, 24, 101, 180, 185
- `apps/web/src/components/editor/inspector/TemplateVariablesPanel.tsx`:192
- `apps/web/src/components/editor/panels/RecipesTab.tsx`:184, 216-217
- `apps/web/src/components/editor/preview/missing-video-placeholder.ts`:145 (doc comment + default value logic)
- `apps/web/src/components/editor/Preview.tsx`:803, 2486 (debug/log strings — optional, low priority)

Sites confirmed correct already (title-first) — no change needed:
- `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`:136, 161, 620
- `apps/web/src/components/editor/asset-manager/AssetDetailShared.tsx`:321

Sites that MUST keep using raw `item.name` — no change:
- `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`:205 (Filename info row)
- `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`:674 (download filename)
- `apps/web/src/stores/project-store.ts`:84-86 (`getImportedFileName`, file-identity matching)
- `apps/web/src/services/backend-save.ts`:174 (upload filename)

Import-time population (new logic):
- `apps/web/src/stores/project-store.ts`: all four `importMedia` branches
  (~1846, ~2013, ~2234, ~2622) plus the mirrored `sourceFile`-carrying blocks
  (~2032, ~2256, ~2644) — add `title: derivedTitle` alongside the existing
  `name: file.name`.
- `packages/core/src/media/mediabunny-engine.ts`: `extractMetadata()` (line
  394) — add a `getMetadataTags()` call for the video/audio path.
- `packages/core/src/media/types.ts`: `MediaTrackInfo` (line 10) — add
  `title?: string`.
- New file `packages/core/src/media/filename-to-title.ts` — the pure
  transform function.

Not changed by this spec (flagged for follow-up decision):
- `apps/image/src/components/editor/panels/LeftPanel.tsx`:986, 1013 and
  `packages/image-core/src/project.ts` `MediaAsset` — the standalone image
  editor has a separate, simpler asset model with no `title` field; adding
  the feature there is a proportionally larger, separate change (new field,
  no metadata-title source since images have no embedded title tag path
  today) and should be a follow-up ticket, not bundled into this one.
- `apps/web/src/services/llm/snapshot.ts`:284 — decide whether the
  LLM-facing snapshot should expose `title` too (recommend yes, additively,
  so in-app AI tools reason about the same display name a human sees) —
  low-risk additive change, but listed separately since it's an LLM-facing
  contract rather than a UI display site.

## Backward compatibility

**Recommendation: compute `title` once, at import time, and persist it in
the saved `MediaItem` — do not compute it on every render.**

Rationale:
- `title` is already a persisted field with exactly this shape (optional,
  user can override). Reusing it means zero schema migration and instant
  compatibility with all existing read paths that already do
  `item.title || item.name`.
- Computing at render time would require every display call site to import
  and invoke a metadata-tag lookup or the filename transform on every
  paint, including list virtualization in the media bin — wasteful, and
  worse, the *metadata* half of the precedence (mediabunny's
  `getMetadataTags()`) is only available from the original file/blob, which
  may not always be present in memory for every render (e.g. after a project
  reload where only a thumbnail cache is hot) — recomputing per-render would
  either require re-reading the blob or silently degrading to filename-only,
  which is worse and less deterministic than a stable persisted value.
- Downside of persisting: **existing projects already saved with `title`
  unset simply keep showing `item.name` (raw filename) until the user
  re-imports, replaces, or manually edits the title** — this feature does
  NOT retroactively fix already-imported media in old projects. This is the
  correct, safe default (no bulk migration of existing project files, no
  risk of an automated batch job silently rewriting user data), but it means
  the visible effect is import-time-only and won't "just fix" a user's
  existing library.
- A one-time, opt-in "recompute titles for existing media" action could be
  offered later as a fast-follow (e.g. a button in the media bin, or a
  migration run explicitly by the user) — but is explicitly out of scope
  here per the non-goals above (no bulk migration in this spec).

Tradeoff acknowledged: if Joseph wants existing libraries to benefit
immediately, the alternative is a render-time fallback
(`displayName = item.title || filenameToTitle(item.name)`, applied
uniformly at every display call site, with metadata-tag lookup only ever
happening at import time since it needs the blob). This still requires no
new persisted field, works for both old and new projects immediately, and
only additionally changes: every "MUST change" call site above would use
`item.title || filenameToTitle(item.name)` (not `item.title || item.name`).
This is a one-line difference in each call site and could be swapped in
later without further schema work if compatibility with existing libraries
turns out to matter more than the "stable, review-diffable persisted title"
property. Recommend starting with the persisted-at-import approach; flip to
render-time fallback only if user feedback shows old libraries need to look
right without re-import.

## Testing plan

### Unit tests (deterministic, <2s total)

New test file: `packages/core/src/media/filename-to-title.test.ts`
(colocated with the new module, existing project test-runner — check
`package.json` for `vitest`/`jest` in `packages/core`).

- All rows in the Test cases table above as individual `it(...)` cases,
  including: extension stripping, mixed separators, consecutive separators,
  leading/trailing separators, all-caps snake_case, camelCase with no
  separators (case preserved), dotfile edge case, no-extension filename,
  empty string, non-Latin script (no case distinction), accented Latin
  character, leading emoji, leading digits before first alphabetic
  character, and the primary real-world case (`IMG_1234.HEIC`-style camera
  filenames).
- A property-style test asserting the function is total (never throws) for
  a fuzzed set of inputs including `null`/`undefined`-adjacent edge cases
  coerced to string, very long filenames, and filenames containing path
  separators (`/`, `\`) that should not appear given the API only ever
  receives `File.name`, but guard defensively anyway.

New/updated tests for import-time integration:
- `apps/web/src/stores/project-store.ts` already has an existing test at
  `apps/web/src/services/auto-save.test.ts:166` asserting
  `expect(item.name).toBe("clip.mp4")` — verify this is unaffected (still
  true; only `title` changes) and add a parallel assertion that `item.title`
  is populated per the precedence rule for at least one fixture with a
  metadata title (e.g., a fixture MP3 with an ID3 title tag) and one without
  (e.g., a WebM with no tags) in whatever the existing import test
  harness/mock for `mediaBridge`/`MediaBunnyEngine` already provides.
- Test `preserveUserMediaMetadata()` explicitly retains a previously-set
  `title` across a file-replace operation (regression test for the
  "don't clobber user's title on replace" rule stated above).

### Integration / manual verification

- Import an MP3 with an ID3 title tag set (e.g. via a small fixture file
  committed to test fixtures, or `ffmpeg -metadata title="My Song"`)
  through the real `importMedia` flow and confirm the media bin card shows
  the ID3 title, not the filename.
- Import an MP4 with no title tag and a snake_case filename; confirm the
  media bin shows the sentence-cased, extension-stripped filename.
- Import an image (JPEG/PNG); confirm it falls back to the filename
  transform (no metadata-title path implemented for images in this pass).
- Confirm the inspector's "Filename" row and the "Replace"/"Download"
  actions still reference the true raw filename after this change.
- Confirm re-dropping the identical file (same name+size) still triggers
  the existing replace-not-duplicate behavior (`findMediaItemByFileIdentity`
  unaffected, since it reads `sourceFile.name`/`item.name`, not `title`).

No LLM/probabilistic eval is needed for this feature — the metadata
extraction is a deterministic library call and the filename transform is a
pure deterministic function; nothing here depends on model judgment.

## Open questions / risks

1. **Should EXIF/XMP title tags be read for images?** No such extraction
   exists in the repo today; mediabunny does not appear to expose image
   EXIF the way it does audio/video container tags (it treats images via a
   plain `<img>` load, per `extractImageMetadata()`). Adding EXIF support
   (e.g. via the `exifr` npm package) is a reasonably small addition but is
   a second, separable piece of work with its own library choice and test
   fixtures. Recommend treating it as a fast-follow rather than bundling it
   here, since the inbox item's phrasing ("if there is a title available in
   any of the metadata") could be read either way — flagging for Joseph's
   call.
2. **Should "Rename asset" (the manual rename UI, `AssetsPanel.tsx:1175-1180`)
   continue to write to `.name`, or should it now write to `.title` since
   `.title` is the primary display value?** Recommend switching the rename
   action to call `updateMediaMetadata({title})` instead of `renameMedia`,
   since a user renaming what they see in the media bin is conceptually
   editing the display title, not the underlying file's identity/filename.
   This is a UX/product decision, not purely mechanical — flagging rather
   than deciding unilaterally, since it changes which persisted field a
   user-facing action mutates.
3. **Search behavior** (`AssetsPanel.tsx:869`): should search match against
   `title`, `name`, or both? Recommend both (union match) so a user can find
   media by either its original filename or its derived/edited title, but
   this widens the search surface and could surface unexpected matches —
   worth a quick product sanity check.
4. **LLM snapshot exposure** (`snapshot.ts:284`): additive risk only (adding
   a field the in-app LLM tools can read), but confirm no downstream prompt
   template assumes a fixed shape that would break if a new key appears.
5. **Risk: `getMetadataTags()` performance/reliability.** This spec assumes
   calling `getMetadataTags()` during import is cheap and safe for all
   supported container formats. This should be validated in a quick spike
   before implementation — worst case, wrap it in a try/catch with a
   fallback to the filename transform on any extraction error, so a
   malformed or unusual metadata block never blocks import.
6. **Risk: title tags containing HTML/script-like content.** Since `title`
   is rendered as text (not `dangerouslySetInnerHTML`) throughout React,
   standard JSX escaping already protects against injection; no additional
   sanitization is anticipated, but worth a explicit note since the string
   now originates from untrusted file content rather than the OS filesystem
   (marginally different trust boundary, same mitigation).
