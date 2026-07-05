# Thumbnails & Missing-File Fallbacks — Operational Spec

> **Derived from user directives.** Source: 33 user messages in the Thumbnails / Fallbacks category.
> Reference plans: [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md), [Storyboard UI plan](../superpowers/plans/2026-07-03-storyboard-ui.md), [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md).
> Reference existing spec: [Asset Management UX spec](./asset-management-ux.md) §7 (Performance Architecture).

---

## 12.1 Missing Video File Fallback

### 12.1.1 Fallback Priority

When a video clip's source media file is unavailable (blob missing, file not found, or `remoteUrl` unresolvable), the system MUST render a fallback thumbnail. The fallback SHALL be resolved in the following priority order:

1. **First first-frame reference** — the first entry in the clip's `metadata.referenceAssetIds` array that resolves to an image `MediaItem` with an available blob or URL.
2. **First `reference_image`** — the first entry in the clip's `metadata.referenceImageUrl` field, if present and resolvable.
3. **Gradient placeholder** — a deterministic gradient derived from the clip's `id` (e.g., a two-color gradient using a hash of the clip ID to select hue values), with the clip index or label overlaid.

### 12.1.2 Scope

The fallback priority in §12.1.1 SHALL apply in **all display contexts** where a thumbnail for the clip is rendered, including but not limited to:

- Timeline clip blocks (both collapsed and expanded views).
- Storyboard shot cards in the `StoryboardPanel`.
- Asset browser / media library thumbnails.
- Inspector panel previews.
- Project picker thumbnails (first frame of timeline).
- Export preview / render queue items.

### 12.1.3 Missing-File Clip Behavior

A clip whose source media is missing SHALL:

- Display the resolved fallback thumbnail per §12.1.1.
- Render a "Missing file" badge or indicator on the clip block.
- Expose a **"Link file"** action in the clip's context menu and inspector, allowing the user to resolve the missing file by selecting a replacement from the local filesystem.
- Remain on the timeline at its original position and duration — missing files MUST NOT cause clips to be removed or hidden.

### 12.1.4 Recovery After Relink

When a user resolves a missing file via the "Link file" action:

- The system SHALL update the clip's `mediaId` to reference the newly imported `MediaItem`.
- The fallback thumbnail SHALL be replaced by the real thumbnail extracted from the new media.
- The "Missing file" badge SHALL be removed.

---

## 12.2 Non-Video Asset Thumbnails

### 12.2.1 Image and Character Thumbnails

For non-video assets — images, character reference images, and still-image `MediaItem` entries — the thumbnail block on the timeline SHALL fill the entire clip area by **repeating (tiling) the thumbnail image** rather than stretching or letterboxing it.

The tiling behavior SHALL:

- Use the thumbnail at its native aspect ratio, repeated in both X and Y directions to fill the clip block's bounding box.
- Apply `background-repeat: repeat` (CSS) or equivalent canvas tiling.
- NOT distort, stretch, or crop the thumbnail to fit.

### 12.2.2 Character Thumbnails

Character metadata clips on the timeline SHALL use the character's first reference image as their thumbnail. If the character has no reference images, the system SHALL fall back to a gradient placeholder with the character's name or label overlaid.

### 12.2.3 Storyboard Shot Thumbnails

Storyboard shot cards (in `StoryboardPanel` and expanded shot metadata meta-track) SHALL render:

- The shot's `referenceImageUrl` as the thumbnail when present.
- A gradient placeholder showing the shot index number when no reference image URL is available.
- A status badge (§12.5) indicating the shot's generation/realization state.

---

## 12.3 Video Frame Extraction

### 12.3.1 Frame Sequence on Timeline

Video clips on the timeline MUST display a sequence of extracted frames rather than a single thumbnail. The system SHALL:

- Extract frames at a periodic interval of **N seconds**, where N is configurable and defaults to a value that produces approximately 3–8 frames for a typical clip duration (e.g., N = 2 for clips under 30 seconds, scaling up for longer clips).
- Display the extracted frames as a horizontal sequence within the clip block, left-to-right in time order.
- Render each frame at equal width, filling the clip block's height.

### 12.3.2 Extraction Strategy

Frame extraction SHALL be performed client-side using the browser's video decoding capabilities:

- For video `MediaItem` entries with an available blob or `remoteUrl`, the system SHALL seek to each interval boundary and capture a frame via a hidden `<video>` element or `VideoFrame` API.
- Extracted frames SHALL be rendered as `<canvas>` elements or data-URL `<img>` elements.
- Extraction SHALL be deferred (lazy) — frames are only extracted when the clip block enters the viewport (§12.7).

### 12.3.3 Filmstrip Thumbnails

The extracted frame sequence is referred to as the **filmstrip**. The filmstrip:

- SHALL be cached per media item (§12.6).
- SHALL be invalidated when the source media's modification timestamp changes.
- MAY be pre-computed for the currently visible portion of the timeline to reduce jank during scrolling.

### 12.3.4 Fallback for Unavailable Video

If frame extraction fails (e.g., unsupported codec, corrupted file, missing blob), the system SHALL fall back to the missing-file fallback chain defined in §12.1.1.

---

## 12.4 Metadata Clips Without Thumbnails

### 12.4.1 Compact Summary Display

Metadata clips that have no associated thumbnail image (no `referenceImageUrl`, no `referenceAssetIds`, and no realizable visual representation) MUST display a **compact summary** in place of a thumbnail block on the timeline.

The compact summary SHALL include:

- **Kind badge** — a small colored badge indicating the metadata clip's `kind` (e.g., "music-video", "scene", "character", "style", "section", "note", "director-notes").
- **Label** — the clip's `label` or a derived label (e.g., "Shot 3", "Character: Alice").
- **Duration** — the clip's time range in a compact format (e.g., "12.0s–16.0s").
- **Truncated description** — the first line of the clip's prompt, description, or detail text, truncated to fit the available width.

### 12.4.2 Visual Treatment

The compact summary SHALL be rendered as a text block with:

- A muted background color derived from the metadata kind (e.g., blue for music-video, green for scene, purple for character, amber for style).
- A left-edge color stripe matching the kind color.
- Monospace or small sans-serif typography for the label and duration.
- The kind badge positioned at the top-left or as a prefix to the label.

### 12.4.3 Director Notes and Other Special Kinds

Metadata clips of kind `"director-notes"` or other kinds that lack a visual thumbnail SHALL use the compact summary display. The system MUST NOT attempt to render a thumbnail placeholder for these clip types.

---

## 12.5 Generated Clip Badges

### 12.5.1 Status Badge Display

Every clip that represents a generated or generatable asset SHALL display a **status badge** indicating its generation/realization state. The badge SHALL be rendered as a small colored pill or icon overlay on the clip block (timeline) or shot card (storyboard panel).

### 12.5.2 Status Values

The badge SHALL reflect one of the following statuses, derived from the clip's metadata or associated generation job:

| Status | Condition | Visual Treatment |
|---|---|---|
| **Unrealized** | No `outputs` array, or `outputs` is empty, and no active generation job exists. | Gray/muted pill with "Unrealized" label. |
| **Pending** | A generation job is `queued` or `submitting` for this clip. | Blue pill with spinner icon and "Pending" label. |
| **Processing** | A generation job is `submitted` or `processing` for this clip. | Blue animated pill with progress indicator and "Processing" label. |
| **Completed** | The last entry in `outputs` has `status: "complete"`. | Green pill with checkmark and "Complete" label. |
| **Failed** | The last entry in `outputs` has `status: "failed"`, or the generation job is `failed`. | Red pill with exclamation icon and "Failed" label. |
| **Cancelled** | The generation job is `cancelled`. | Amber pill with "Cancelled" label. |

### 12.5.3 Badge Positioning

- On timeline clip blocks: the badge SHALL appear in the top-right corner of the clip block, above the filmstrip or thumbnail.
- On storyboard shot cards: the badge SHALL appear in the info bar, right-aligned next to the shot label.
- On inspector previews: the badge SHALL appear adjacent to the clip title or in the generation info section.

### 12.5.4 Badge Interactivity

- Clicking a "Failed" badge on a clip SHOULD open the generation job details or the retry action.
- Clicking a "Processing" badge SHOULD navigate to the job management panel for that job.
- "Unrealized" badges on storyboard shots SHOULD be clickable to trigger generation for that shot.

---

## 12.6 Thumbnail Cache Strategy

### 12.6.1 Storage Backend

The system SHALL cache thumbnails and filmstrip frames in **IndexedDB**. The cache SHALL be keyed by a composite key:

```
<mediaId> + <modificationTimestamp>
```

Where `modificationTimestamp` is the `MediaItem.modifiedAt` or the blob's last-modified time. This ensures that when a media item is replaced or updated, the old cached thumbnails are naturally invalidated (the key changes).

### 12.6.2 Cache Contents

The IndexedDB thumbnail store SHALL hold:

- **Single thumbnails** for image assets — a single data-URL or `Blob` representing the thumbnail at a standard resolution (e.g., 320px wide).
- **Filmstrip frames** for video assets — an array of data-URLs or `Blob` entries, one per extracted frame, stored as a single JSON-serializable record keyed by the composite key.
- **Metadata** — the `mediaId`, `modificationTimestamp`, `cachedAt` timestamp, and frame count (for filmstrips).

### 12.6.3 Cache Population

- On first access to a media item's thumbnail, the system SHALL check IndexedDB for a cache hit.
- On cache miss, the system SHALL generate the thumbnail (or extract filmstrip frames) and write the result to IndexedDB before rendering.
- Cache writes SHALL be asynchronous and non-blocking — the thumbnail MAY render after a brief delay on first access.

### 12.6.4 Cache Eviction

- The cache SHALL have a configurable maximum size (e.g., 100 MB). When the cache exceeds this limit, the system SHALL evict the least-recently-accessed entries.
- Entries for media items that no longer exist in the project's media library SHOULD be evicted on project load or periodically.
- The user MAY manually clear the thumbnail cache via a settings action.

### 12.6.5 Cache Invalidation

- When a `MediaItem` is replaced, version-switched, or re-imported, its `modifiedAt` timestamp changes, which produces a new composite key — the old cache entry is effectively orphaned and subject to eviction.
- The system MUST NOT attempt to proactively delete old cache entries on every media update; eviction is handled by the LRU policy.

---

## 12.7 Lazy Loading with IntersectionObserver

### 12.7.1 Viewport-Based Loading

All thumbnail and filmstrip rendering SHALL use lazy loading via the `IntersectionObserver` API. A thumbnail or filmstrip frame MUST NOT be loaded or extracted until its container element enters the viewport (or a configurable root margin).

### 12.7.2 Implementation

- Each clip block, shot card, or asset thumbnail SHALL be wrapped in an observed container element.
- When the container intersects the viewport, the system SHALL:
  1. Check the IndexedDB cache for the thumbnail/filmstrip.
  2. On cache hit: render immediately.
  3. On cache miss: generate the thumbnail (or extract frames), write to cache, then render.
- While loading, the container SHALL display a **skeleton placeholder** — a pulsing or shimmer rectangle matching the expected aspect ratio of the thumbnail.

### 12.7.3 Root Margin

The `IntersectionObserver` SHALL be configured with a `rootMargin` of at least **200px** in the scroll direction to begin loading thumbnails slightly before they become visible, reducing perceived latency during scrolling.

### 12.7.4 Disconnection

When a container element is unmounted (e.g., the clip scrolls far out of view and is virtualized away), the observer SHALL be disconnected for that element. The rendered thumbnail MAY remain in the DOM if the element is kept alive by a virtualizer; otherwise, re-mounting triggers a new observation cycle.

### 12.7.5 Priority

Thumbnails for clips that are closer to the playhead or currently selected SHOULD be loaded with higher priority. The system MAY use a priority queue or multiple observers with different root margins to implement this.

---

## 12.8 Integration with Performance Architecture

This section extends §7 (Performance Architecture) of [Asset Management UX spec](./asset-management-ux.md).

### 12.8.1 Narrow Subscriptions

Components that render thumbnails SHALL subscribe to the narrowest possible Zustand selectors:

- A `ClipComponent` SHALL subscribe only to its own clip's `mediaId`, `metadata`, and timing fields — not the entire clip array.
- A `ShotCard` SHALL subscribe only to its own shot's `referenceImageUrl`, `outputs`, and `selected` state.

### 12.8.2 Memoization

- `React.memo` SHALL be applied to all thumbnail-rendering components with custom comparators that skip re-render when the thumbnail source (mediaId + modificationTimestamp) is unchanged.
- Filmstrip frame arrays SHALL be memoized with `useMemo` keyed by the composite cache key.

### 12.8.3 Virtualization Compatibility

When the timeline or asset grid uses virtual scrolling (e.g., `@tanstack/react-virtual`), the lazy-loading observer SHALL integrate with the virtualizer's measurement lifecycle:

- Placeholder height SHALL be estimated and provided to the virtualizer before the thumbnail loads.
- Once the thumbnail loads and its actual height is known, the virtualizer SHALL be notified to remeasure.

---

## 12.9 Open Questions

- **Configurable frame interval N**: What is the exact default value for N? Should it be a fixed value (e.g., 2 seconds) or adaptive based on clip duration? Should the user be able to configure it per-project or per-clip?
- **Filmstrip frame count**: Is there a maximum number of frames per filmstrip? Should very long clips (e.g., 10+ minutes) use a different strategy (e.g., one frame per 30 seconds)?
- **Thumbnail resolution**: What is the target resolution for cached thumbnails? Should it adapt to the display's device pixel ratio?
- **Cache size limit**: Is 100 MB the correct default maximum for the IndexedDB thumbnail cache? Should it be configurable?
- **Offscreen canvas for frame extraction**: Should frame extraction use `OffscreenCanvas` in a Web Worker to avoid blocking the main thread?
- **Generated clip badge for multi-output shots**: When a shot has multiple `outputs` entries (e.g., one failed, one completed), which status takes precedence? The spec currently uses the last entry.
- **Missing-file detection**: How is "missing" determined — by attempting to load the blob and catching the error, or by a flag on the `MediaItem`? Should the system proactively check blob availability on project load?
- **Tiling for non-square clip blocks**: When a clip block's aspect ratio differs significantly from the thumbnail's native aspect ratio, does tiling still apply, or should there be a threshold beyond which letterboxing is used?
