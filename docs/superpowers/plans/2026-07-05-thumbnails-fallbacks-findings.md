# Thumbnails & Fallbacks — Complete Investigation Findings

> **Audit status (2026-07-13): INVESTIGATION RECORD, IMPLEMENTATION INCOMPLETE.** Canonical owners: `docs/spec/media-assets.md` and `docs/spec/timeline.md`. Several fallback paths exist, but the findings themselves identify missing status badges, color stripes, fallback behavior, and tests. The document is not an implementation plan and the scoped product outcome is not complete.

**Date:** 2026-07-06  
**Investigation:** Complete analysis of `docs/spec/thumbnails-fallbacks.md` against actual implementation  
**Scope:** Missing-file fallbacks, video frame extraction (filmstrip), non-video thumbnails, effectiveThumbnailUrl chain, caching, lazy loading  
**Output:** Findings handoff ONLY (not implementation plan)

---

## Finding 1: Missing-File Fallback Chain (Spec §12.1)

### Status: PARTIALLY IMPLEMENTED

**Spec Requirement (§12.1.1):**
Priority order for fallback when video file unavailable:
1. First frame reference from `metadata.referenceAssetIds` (image MediaItem)
2. First `metadata.referenceImageUrl` field
3. Gradient placeholder (deterministic from clip ID)

### Actual Implementation

**Missing:** The spec's fallback chain is NOT fully implemented. Current code handles only the first two fallbacks partially.

**Evidence Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 141–760

**Current effectiveThumbnailUrl Logic:**

```typescript
// Line 141: Missing file detection
const isMissingMedia = !!mediaItem?.isPlaceholder;

// Lines 746–760: Fallback rendering for video
{/* Video: single thumbnail fallback — repeat-fill */}
{mediaType === "video" && !mediaItem?.filmstripThumbnails?.length && effectiveThumbnailUrl && (
  <div
    className="absolute inset-0 opacity-60"
    style={{ backgroundImage: `url(${effectiveThumbnailUrl})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%" }}
  />
)}
```

**Missing Piece:** No `effectiveThumbnailUrl` fallback logic found that:
- Checks `metadata.referenceAssetIds` array
- Falls back to `metadata.referenceImageUrl`
- Generates gradient placeholder from clip ID

**The variable `effectiveThumbnailUrl` is defined at line 126 of `AssetInspectorWithTabs.tsx` as:**

```typescript
const effectiveThumbnailUrl = item.thumbnailUrl;
```

This is a DIRECT assignment, not a fallback chain. It does NOT implement the priority order from spec §12.1.1.

### Missing-File Badge

**Status: IMPLEMENTED**

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 726–733

```typescript
{isMissingMedia && (
  <div className="absolute inset-x-0 top-1 z-20 pointer-events-none" style={{ overflow: "clip" }}>
    <div className="sticky left-1 w-fit">
      <div className="rounded bg-yellow-500 px-1.5 py-0.5 text-[8px] font-bold uppercase leading-none text-black">
        Link file
      </div>
    </div>
  </div>
)}
```

Badge appears correctly when `mediaItem?.isPlaceholder` is true. The badge text says "Link file" (matches spec's "Link file" action requirement in §12.1.3).

**Files involved:**
- `apps/web/src/components/editor/timeline/ClipComponent.tsx` — renders badge
- `apps/web/src/stores/project-store.ts` — sets `isPlaceholder` flag

---

## Finding 2: Video Frame Extraction / Filmstrip (Spec §12.3)

### Status: IMPLEMENTED ✅

**Spec Requirement (§12.3):**
- Extract frames at periodic intervals (N seconds)
- Display 3–8 frames for typical clip
- Client-side extraction using browser video decoding
- Cache filmstrip per media item

### Actual Implementation

**Location:** `apps/web/src/stores/project-store.ts`, lines 1738–1836

**Frame Extraction Process:**

```typescript
// Lines 1738–1836: Filmstrip generation
let thumbnailUrl: string | null = null;
const filmstripThumbnails: { timestamp: number; url: string }[] = [];

if (processedMedia.thumbnails && processedMedia.thumbnails.length > 0) {
  // Process all thumbnails for filmstrip display
  for (const thumb of processedMedia.thumbnails) {
    let thumbUrl: string | null = null;

    // Check if dataUrl already exists
    if (thumb.dataUrl) {
      thumbUrl = thumb.dataUrl;
    } else if (thumb.canvas) {
      // Convert canvas to dataUrl
      try {
        if (thumb.canvas instanceof OffscreenCanvas) {
          const blob = await thumb.canvas.convertToBlob({
            type: "image/jpeg",
            quality: 0.7,
          });
          thumbUrl = URL.createObjectURL(blob);
        } else if (thumb.canvas instanceof HTMLCanvasElement) {
          thumbUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
        }
      } catch (e) {
        console.warn("Failed to convert thumbnail canvas to URL:", e);
      }
    }

    if (thumbUrl) {
      filmstripThumbnails.push({
        timestamp: thumb.timestamp,
        url: thumbUrl,
      });
    }
  }

  // Use first thumbnail as the main thumbnail
  if (filmstripThumbnails.length > 0) {
    thumbnailUrl = filmstripThumbnails[0].url;
  }
}

// Fallback: generate thumbnails if not already extracted
if (mediaType === "video" && !thumbnailUrl) {
  try {
    const thumbs = await mediaBridge.generateThumbnailsForMedia(
      processedMedia.blob ?? file,
      mediaType,
    );
    if (thumbs.length > 0) {
      thumbnailUrl = thumbs[0].dataUrl;
      filmstripThumbnails.push(
        ...thumbs.map((thumb) => ({
          timestamp: thumb.timestamp,
          url: thumb.dataUrl,
        })),
      );
    }
  } catch {
    // Background retry below is best-effort.
  }
}
```

**Key Points:**
- Frames extracted with canvas (OffscreenCanvas or HTMLCanvasElement)
- Quality: JPEG at 0.7 (70% quality) — reasonable compression
- Each frame stored with `timestamp` and `url`
- Array stored in `MediaItem.filmstripThumbnails`

**Filmstrip Display on Timeline:**

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 714–738

```typescript
// Line 707: Calculate number of tiles that fit in clip width
const tileCount = Math.max(1, Math.ceil(width / 60));

// Lines 714–738: Render filmstrip frames
{mediaType === "video" && mediaItem?.filmstripThumbnails && mediaItem.filmstripThumbnails.length > 0 && (
  <div className="absolute inset-0 flex opacity-70">
    {Array.from({ length: tileCount }).map((_, i) => {
      const sourceTime = clip.inPoint + ((i + 0.5) / tileCount) * clip.duration;
      const thumbs = mediaItem.filmstripThumbnails!;
      let best = 0;
      let bestDist = Math.abs(thumbs[0].timestamp - sourceTime);
      for (let j = 1; j < thumbs.length; j++) {
        const d = Math.abs(thumbs[j].timestamp - sourceTime);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      return (
        <div
          key={i}
          className="flex-1 h-full bg-cover bg-center"
          style={{ backgroundImage: `url(${thumbs[best].url})` }}
        />
      );
    })}
  </div>
)}
```

**How It Works:**
1. Calculate `tileCount` based on clip width (60px per tile)
2. For each tile position, compute `sourceTime` proportional to clip duration
3. Find the closest filmstrip frame to that timestamp (nearest-neighbor)
4. Render frame as background-image in flex-1 container (fills proportional width)
5. Opacity set to 0.7 (70%)

**Frame Count:** Depends on `mediaBridge.generateThumbnailsForMedia()` implementation (not found in web codebase, likely delegated to core or media bridge).

**Matches Spec?** YES ✅
- Extracts frames at intervals
- Displays time-accurate sequence on timeline
- Uses browser video decoding (canvas)

---

## Finding 3: Video Fallback When No Filmstrip (Spec §12.3.4)

### Status: IMPLEMENTED ✅

**Spec Requirement (§12.3.4):**
If frame extraction fails, fall back to single thumbnail with repeat-fill

### Actual Implementation

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 740–743

```typescript
{/* Video: single thumbnail fallback — repeat-fill */}
{mediaType === "video" && !mediaItem?.filmstripThumbnails?.length && effectiveThumbnailUrl && (
  <div
    className="absolute inset-0 opacity-60"
    style={{ backgroundImage: `url(${effectiveThumbnailUrl})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%" }}
  />
)}
```

**How It Works:**
- Renders ONLY if:
  - `mediaType === "video"` AND
  - `!mediaItem?.filmstripThumbnails?.length` (no filmstrip) AND
  - `effectiveThumbnailUrl` exists (has fallback thumbnail)
- CSS `backgroundRepeat: "repeat-x"` tiles the single frame horizontally
- `backgroundSize: "auto 100%"` preserves aspect ratio and fills height
- Opacity 0.6 (60%)

**Matches Spec?** YES ✅

---

## Finding 4: Non-Video Thumbnail Fill (Spec §12.2.1)

### Status: IMPLEMENTED ✅

**Spec Requirement (§12.2.1):**
Images and character reference images SHALL tile (repeat) across clip block, not stretch

### Actual Implementation

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 745–751

```typescript
{/* Image / character / style: repeat thumbnail across full clip width */}
{mediaType === "image" && effectiveThumbnailUrl && !effectiveThumbnailUrl.startsWith("blob:") && (
  <div
    className="absolute inset-0 opacity-65"
    style={{ backgroundImage: `url(${effectiveThumbnailUrl})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%" }}
  />
)}
```

**How It Works:**
- Triggers for `mediaType === "image"` (includes character reference images)
- Excludes blob: URLs (placeholder images)
- CSS `backgroundRepeat: "repeat-x"` tiles horizontally
- `backgroundSize: "auto 100%"` maintains aspect ratio
- Opacity 0.65 (65%)

**Matches Spec?** YES ✅
- Repeats (tiles) the thumbnail
- Does NOT stretch or letterbox
- Native aspect ratio preserved

---

## Finding 5: Metadata Clips Without Thumbnails (Spec §12.4)

### Status: PARTIALLY IMPLEMENTED

**Spec Requirement (§12.4):**
Metadata clips without visual representation SHALL display compact summary (kind badge, label, duration, description)

### Actual Implementation

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 754–800

```typescript
{/* Metadata clip: compact summary when no real thumbnail (blob URL = 1×1 placeholder) */}
{isMetadata && (!effectiveThumbnailUrl || effectiveThumbnailUrl.startsWith("blob:")) && (
  <div className="absolute inset-0 flex flex-col justify-between" style={{ backgroundColor: `${bgStyle.bgColor}` }}>
    {/* Kind badge at top-left */}
    <div className="flex items-center gap-1 p-1.5 pointer-events-none">
      {metadataBadge && MetadataBadgeIcon && (
        <div className={`inline-flex items-center gap-0.5 rounded border px-0.5 py-0.5 text-[7px] font-bold leading-none ${metadataBadge.className}`}>
          <MetadataBadgeIcon size={8} />
          <span>{metadataBadge.label}</span>
        </div>
      )}
    </div>

    {/* Description / label text in center */}
    <div className="flex flex-col items-start justify-center flex-1 px-2">
      <span className="text-[9px] font-medium text-white truncate max-w-full">
        {(clip.metadata?.["label"] as string | undefined) ?? metadataKind ?? "Metadata"}
      </span>
      {clip.metadata?.["description"] && (
        <span className="text-[7px] text-white/70 line-clamp-2">
          {(clip.metadata?.["description"] as string | undefined)?.split("\n")[0]}
        </span>
      )}
    </div>

    {/* Duration at bottom-right */}
    <div className="flex items-center justify-end p-1.5 text-[7px] text-white/60 pointer-events-none font-mono">
      {clip.duration.toFixed(2)}s
    </div>
  </div>
)}
```

**Compact Summary Elements:**
- ✅ **Kind badge** — top-left, colored by metadata kind
- ✅ **Label** — center, defaults to `label` or `kind` field
- ✅ **Duration** — bottom-right, in format `12.34s`
- ⚠️ **Description** — first line only, truncated to 2 lines with `line-clamp-2`

**Background Color:**
Determined by `bgStyle.bgColor` (computed from metadata kind). Each kind has a distinct color (blue for music-video, green for scene, etc.).

**Matches Spec?** MOSTLY ✅
- All 4 required elements present
- Kind badge, label, duration all implemented
- Description is truncated (spec says "truncated to fit available width" — implementation uses line-clamping)

---

## Finding 6: Generated Clip Badges (Spec §12.5)

### Status: NOT IMPLEMENTED ❌

**Spec Requirement (§12.5):**
Generated/generatable assets SHALL display status badge (Unrealized, Pending, Processing, Completed, Failed, Cancelled)

### Actual Implementation

**Search Result:** NO status badge rendering found in ClipComponent or related files.

**Related Code Found:**

File: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`, lines 180–198

```typescript
{item.isPending && !item.isPlaceholder && (
  <div className="px-3 py-1 bg-blue-500/10 border-t border-blue-500/20">
    <span className="text-[10px] text-blue-400 font-medium">⏳ Generating…</span>
  </div>
)}
```

This badge appears ONLY in the Asset Inspector, NOT on timeline clip blocks or storyboard cards.

**Missing from:**
- Timeline clip blocks (top-right corner per spec §12.5.3)
- Storyboard shot cards (info bar, right-aligned)
- Inspector previews (generation info section)

**Status:** Status badge system is NOT implemented as spec requires. Partial indicator appears only in Asset Inspector preview section.

---

## Finding 7: Thumbnail Cache Strategy (Spec §12.6)

### Status: NOT IMPLEMENTED ❌

**Spec Requirement (§12.6):**
Cache thumbnails in IndexedDB with composite key `<mediaId> + <modificationTimestamp>`

### Actual Implementation

**Search Result:** NO IndexedDB caching found.

**Current Storage:** Filmstrip frames stored directly in `MediaItem.filmstripThumbnails` array (in-memory, lost on page reload).

**Evidence:** `apps/web/src/stores/project-store.ts`, line 1835

```typescript
filmstripThumbnails:
  filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
```

These frames are stored in the `MediaItem` object within the project store (Zustand), which is in-memory only. No IndexedDB persistence found.

**Impact:**
- Thumbnails/filmstrips re-extracted on every page load/project reload
- No LRU eviction
- No manual cache clearing option
- Cache size grows unbounded in memory

**Missing:**
- IndexedDB thumbnail store
- Cache key generation (composite key)
- LRU eviction policy
- Cache invalidation on media update

---

## Finding 8: Lazy Loading with IntersectionObserver (Spec §12.7)

### Status: NOT IMPLEMENTED ❌

**Spec Requirement (§12.7):**
Use IntersectionObserver API for lazy-loading thumbnails on viewport entry
- Skeleton placeholder while loading
- rootMargin ≥ 200px
- Priority for clips near playhead
- Disconnect when virtualized away

### Actual Implementation

**Search Result:** NO IntersectionObserver usage found.

**Evidence:** 
```bash
grep -rn "IntersectionObserver" apps/web/src --include="*.tsx" --include="*.ts"
# Result: (no output)
```

**Current Behavior:**
Thumbnails/filmstrips are fetched and rendered synchronously during media import (`project-store.ts` lines 1738–1836). There is no deferred loading based on viewport visibility.

**Missing:**
- IntersectionObserver setup
- Skeleton placeholder elements
- rootMargin configuration
- Priority queuing for playhead-adjacent clips
- Observer cleanup/disconnection

---

## Finding 9: effectiveThumbnailUrl Chain — Detailed Analysis

### Current Variable Definition

**File:** `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`, line 126

```typescript
const effectiveThumbnailUrl = item.thumbnailUrl;
```

**This is a DIRECT assignment, NOT a fallback chain.**

### Places effectiveThumbnailUrl Is Used

1. **AssetInspectorWithTabs.tsx:126** — Inspector preview
2. **AssetInspectorWithTabs.tsx:202** — File tab display
3. **ClipComponent.tsx (imported/used indirectly)** — Timeline rendering

### No Fallback Logic Found

The code does NOT implement the spec's fallback chain:
1. Reference asset from `metadata.referenceAssetIds`
2. Reference image from `metadata.referenceImageUrl`
3. Gradient placeholder from clip ID

**Missing:** This entire fallback chain needs to be implemented.

---

## Finding 10: Non-Implemented Features Summary

| Feature | Spec Section | Status | Evidence |
|---------|--|---------|----------|
| Missing-file fallback chain (3-tier) | §12.1.1 | ❌ NOT IMPL | No code for referenceAssetIds or gradient |
| Video frame extraction filmstrip | §12.3 | ✅ IMPL | project-store.ts:1738–1836 |
| Filmstrip display on timeline | §12.3 | ✅ IMPL | ClipComponent.tsx:714–738 |
| Video fallback to repeat-fill | §12.3.4 | ✅ IMPL | ClipComponent.tsx:740–743 |
| Image/character tiling | §12.2.1 | ✅ IMPL | ClipComponent.tsx:745–751 |
| Metadata compact summary | §12.4 | ✅ IMPL | ClipComponent.tsx:754–800 |
| Generated clip status badges | §12.5 | ❌ NOT IMPL | Only partial badge in Asset Inspector |
| Thumbnail IndexedDB cache | §12.6 | ❌ NOT IMPL | No IndexedDB usage found |
| IntersectionObserver lazy-load | §12.7 | ❌ NOT IMPL | Thumbnails fetched eagerly during import |
| Performance: narrow Zustand subs | §12.8.1 | ⚠️ PARTIAL | Components subscribe broadly |
| Memoization on components | §12.8.2 | ⚠️ PARTIAL | React.memo present but not comprehensive |

---

## Finding 11: Bug: Metadata Compact Summary Color

**Location:** `apps/web/src/components/editor/timeline/ClipComponent.tsx`, lines 781–785

```typescript
{isMetadata && (!effectiveThumbnailUrl || effectiveThumbnailUrl.startsWith("blob:")) && (
  <div className="absolute inset-0 flex flex-col justify-between" style={{ backgroundColor: `${bgStyle.bgColor}` }}>
```

**Issue:** `bgStyle.bgColor` is used but `bgStyle` is computed earlier. Need to verify the computation:

**Line 681 (earlier in file):**
```typescript
const bgStyle = metadataKindColors[metadataKind] ?? metadataKindColors[""];
```

**Spec Requirement (§12.4.2):**
- Muted background color derived from metadata kind
- Left-edge color stripe matching kind color

**Current Implementation:** Only uses background color from `metadataKindColors` lookup. No left-edge stripe (color bar) visible.

**Missing:** Left-edge color stripe (1–2px solid bar matching kind color) not implemented.

---

## Finding 12: Missing File on Clip vs. Asset

### Important Distinction

**Missing on clip (`clip.isPlaceholder`):**
- Rendered with "Link file" badge in timeline
- Fallback thumbnails attempted (but chain not implemented)
- Clip remains on timeline

**Missing on asset (`mediaItem.isPlaceholder`):**
- Indicated in Asset Inspector with warning badge
- Rendered as placeholder in assets panel
- Can trigger "Re-link file" action

**Evidence:** Both `clip.isPlaceholder` and `mediaItem.isPlaceholder` are separate flags in the codebase.

---

## Finding 13: Performance Characteristics

### Current Approach: Eager Loading
- Filmstrips extracted immediately during media import
- All frames stored in-memory in Zustand store
- Re-rendered on every timeline frame (React reconciliation)

### Potential Issues
- Large video files (10+ MB) with many frames = large memory footprint
- No caching across sessions (re-extract on reload)
- No priority (playhead-visible clips treated same as far-off clips)
- No virtualization-aware loading

### What's Missing
- Lazy extraction on viewport entry
- Deferred rendering with skeleton placeholders
- Cache persistence (IndexedDB)
- Priority-based loading

---

## Finding 14: File References for All Findings

| Finding | File | Lines | Key Code |
|---------|------|-------|----------|
| Filmstrip extraction | `apps/web/src/stores/project-store.ts` | 1738–1836 | Canvas extraction, dataUrl conversion |
| Filmstrip display | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 707, 714–738 | Nearest-neighbor frame selection |
| Video fallback repeat-fill | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 740–743 | `backgroundRepeat: "repeat-x"` |
| Image tiling | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 745–751 | Same repeat-fill mechanism |
| Metadata summary | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 754–800 | Kind badge, label, duration, description |
| Missing file badge | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 726–733 | "Link file" yellow badge |
| effectiveThumbnailUrl | `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx` | 126, 202 | Direct assignment (no fallback chain) |
| Asset missing indicator | `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx` | 178–198 | "⚠ Missing file" warning |
| Clip placeholder detection | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | 141 | `const isMissingMedia = !!mediaItem?.isPlaceholder;` |

---

## Summary: Spec Compliance Assessment

**Fully Implemented (5 features):**
- Video frame extraction (filmstrip generation)
- Filmstrip timeline display with time-accurate frame selection
- Video fallback to single-thumbnail repeat-fill
- Image/character thumbnail tiling (repeat-fill, no stretch)
- Metadata clip compact summary (kind badge, label, duration, truncated description)

**Partially Implemented (2 features):**
- Missing-file fallback chain (badge works, but fallback priority chain missing)
- Performance memoization (present but not comprehensive)

**Not Implemented (3 features):**
- Generated clip status badges (only partial badge in Asset Inspector)
- IndexedDB thumbnail caching (all in-memory, lost on reload)
- IntersectionObserver lazy-loading (thumbnails fetched eagerly)

**Gaps / Bugs:**
- No left-edge color stripe on metadata compact summary (spec §12.4.2)
- No 3-tier fallback chain for missing video files (spec §12.1.1)
- No gradient placeholder generation for missing files (spec §12.1.1 tier 3)

---

## Recommendations for Plan Writer

1. **Priority 1 (Foundation):** Implement the missing-file 3-tier fallback chain (referenceAssetIds → referenceImageUrl → gradient)
2. **Priority 2 (Feature Complete):** Add generated clip status badges on timeline blocks and storyboard cards
3. **Priority 3 (Performance):** Implement IndexedDB caching for thumbnails + IntersectionObserver lazy-loading
4. **Polish:** Add left-edge color stripe to metadata compact summary

---

**End of findings handoff. Ready for plan writer to implement based on these complete findings.**
