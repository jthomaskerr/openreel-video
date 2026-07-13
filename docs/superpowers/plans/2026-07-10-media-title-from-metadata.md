# Media Title From Metadata Implementation Plan

> **Audit status (2026-07-13): PARTIAL, NOT COMPLETE.** Canonical owner: `docs/spec/media-assets.md` section 3. `filenameToTitle`, container-title extraction, main-import population, display fallbacks, and tests exist. The plan requires every import/version/replacement path, rename behavior, full-suite gates, and real browser verification; current code evidence shows title derivation only on the main processed-media import path, so archival is premature.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a media file carries a title in its container metadata (ID3, MP4/QuickTime atoms, WebM tags, Vorbis comments, RIFF INFO, FLAC comments), use that as the media item's display name instead of the raw filename. When no such title exists, derive a readable title from the filename (strip extension, convert snake_case/kebab-case to spaces, sentence-case).

**Architecture:** Add a pure `filenameToTitle()` utility in `packages/core/src/media`. Extend `mediabunny-engine.ts`'s `extractMetadata()` to call the already-available (but currently unused) `Input.getMetadataTags()` and surface `.title` on `MediaTrackInfo`. At every `importMedia` call site in `project-store.ts`, populate `MediaItem.title` from `metadata.title?.trim() || filenameToTitle(file.name)`. Update the remaining UI display call sites that still read raw `item.name` to prefer `item.title`. Convert the manual "Rename asset" action to write to `title` via `updateMediaMetadata` instead of mutating `name`.

**Tech Stack:** TypeScript, Vitest (unit tests), fast-check (property-based tests, already a devDependency in `packages/core`), React (UI call sites), mediabunny (media probing library).

## Global Constraints

- `MediaItem.name` (raw filename) and `sourceFile.name` must never change meaning — file-identity matching (`findMediaItemByFileIdentity`), the inspector's "Filename" row, the download handler, and `backend-save.ts` upload naming all continue to use `item.name` unchanged.
- No new persisted field — reuse existing `MediaItem.title?: string` (`packages/core/src/types/project.ts:97-98`).
- Title derivation happens once, at import time, and is persisted — not recomputed on every render.
- The filename-to-title transform is a pure, deterministic function with unit tests — no LLM involvement.
- Images get no metadata-title extraction in this pass (no EXIF/XMP reader exists in the repo); they always fall through to the filename transform. This is out of scope per the spec's non-goals.
- Manual "Rename asset" (per user decision) now writes to `MediaItem.title` via `updateMediaMetadata`, not to `MediaItem.name`.
- Search already matches both `item.name` and `item.title` (`AssetsPanel.tsx:869-874`) — no change needed there.

---

### Task 1: `filenameToTitle` pure function + unit tests

**Files:**
- Create: `packages/core/src/media/filename-to-title.ts`
- Test: `packages/core/src/media/filename-to-title.test.ts`

**Interfaces:**
- Produces: `export function filenameToTitle(filename: string): string` — used by Task 3 (mediabunny engine, only indirectly via project-store) and Task 4 (project-store import sites).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/media/filename-to-title.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { filenameToTitle } from "./filename-to-title";

describe("filenameToTitle", () => {
  const cases: Array<[string, string]> = [
    ["my_video_clip-01.mp4", "My video clip 01"],
    ["MyVideoClip.mov", "MyVideoClip"],
    ["myVideoClip.mov", "MyVideoClip"],
    ["sunset-beach.jpg", "Sunset beach"],
    ["SUNSET_BEACH.PNG", "Sunset beach"],
    ["___leading_seps.mp3", "Leading seps"],
    ["trailing_seps___.wav", "Trailing seps"],
    ["a---b__c.mp4", "A b c"],
    ["2024-01-15_final_cut.mp4", "2024 01 15 Final cut"],
    [".gitignore", "Untitled"],
    ["no_extension_file", "No extension file"],
    ["émigré_clip.mov", "Émigré clip"],
    ["😀party.mp4", "😀party"],
    ["", "Untitled"],
    ["video.mp4", "Video"],
    ["IMG_1234.HEIC", "Img 1234"],
  ];

  it.each(cases)("filenameToTitle(%j) === %j", (input, expected) => {
    expect(filenameToTitle(input)).toBe(expected);
  });

  it("never throws for arbitrary string input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => filenameToTitle(s)).not.toThrow();
        expect(typeof filenameToTitle(s)).toBe("string");
      }),
    );
  });

  it("never throws for filenames containing path separators", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(() => filenameToTitle(`${a}/${b}\\x.mp4`)).not.toThrow();
      }),
    );
  });

  it("handles Korean (no case distinction) without altering spacing", () => {
    expect(filenameToTitle("클립_영상.mp4")).toBe("클립 영상");
  });
});
```

Note on the `2024-01-15_final_cut.mp4` case: the string has separators, so the whole body is lowercased first (`"2024 01 15 final cut"`), then `capitalizeFirst` scans for the first alphabetic character — the digits and spaces are skipped — and uppercases it. That first letter is the "f" in "final", so the result is `"2024 01 15 Final cut"`. This is the trickiest rule in the function; it's called out explicitly here because it's easy to assume the whole string stays lowercase.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/media/filename-to-title.test.ts`
Expected: FAIL with "Cannot find module './filename-to-title'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/media/filename-to-title.ts

function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]{1,10}$/, "");
}

function capitalizeFirst(s: string): string {
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const upper = chars[i].toLocaleUpperCase();
    if (upper !== chars[i]) {
      chars[i] = upper;
      return chars.join("");
    }
    // Already uppercase (or no case distinction e.g. CJK) — still counts as
    // "found the first letter", stop here so later letters are untouched.
    if (/\p{L}/u.test(chars[i])) {
      return chars.join("");
    }
  }
  return chars.join("");
}

export function filenameToTitle(filename: string): string {
  const withoutExt = stripExtension(filename);
  const hadSeparators = /[_-]/.test(withoutExt);

  let spaced = withoutExt.replace(/[_-]+/g, " ");
  spaced = spaced.replace(/\s+/g, " ").trim();

  if (spaced.length === 0) return "Untitled";

  if (hadSeparators) {
    spaced = spaced.toLocaleLowerCase();
  }

  return capitalizeFirst(spaced);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/media/filename-to-title.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/media/filename-to-title.ts packages/core/src/media/filename-to-title.test.ts
git commit -m "feat(core): add filenameToTitle pure transform for media titles"
```

---

### Task 2: Export `filenameToTitle` from package surface

**Files:**
- Modify: `packages/core/src/media/index.ts`

**Interfaces:**
- Consumes: `filenameToTitle` from Task 1 (`packages/core/src/media/filename-to-title.ts`).
- Produces: `filenameToTitle` importable as `@openreel/core/media` (or whatever the existing barrel export path is) for use by `apps/web`.

- [ ] **Step 1: Read the current barrel file**

Read `packages/core/src/media/index.ts` to see the existing export pattern (e.g. `export * from "./types"`, `export { inferMediaType } from "./media-import-service"`, etc.).

- [ ] **Step 2: Add the export**

Add this line following the file's existing export style (adjust to match, e.g. if other utilities are re-exported individually rather than via `export *`):

```typescript
export { filenameToTitle } from "./filename-to-title";
```

- [ ] **Step 3: Verify it resolves**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/media/index.ts
git commit -m "feat(core): export filenameToTitle from media package surface"
```

---

### Task 3: Extract metadata title tag in `MediaBunnyEngine.extractMetadata()`

**Files:**
- Modify: `packages/core/src/media/types.ts:10-28` (add `title?: string` to `MediaTrackInfo`)
- Modify: `packages/core/src/media/mediabunny-engine.ts:395-476` (`extractMetadata` method)
- Test: `packages/core/src/media/mediabunny-engine.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new — uses `mediabunny`'s existing `Input.getMetadataTags()` (already in `mediabunny.d.ts:1577`, currently uncalled anywhere in the repo — confirmed via `search_for_pattern`).
- Produces: `MediaTrackInfo.title?: string` — consumed by Task 4 (`project-store.ts` import sites), which reads `processedMedia.metadata.title`.

- [ ] **Step 1: Add `title` to `MediaTrackInfo`**

In `packages/core/src/media/types.ts`, add one field to the interface (after `audioTrackCount`):

```typescript
export interface MediaTrackInfo {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  sampleRate: number;
  channels: number;
  fileSize: number;
  mimeType: string;
  hasVideo: boolean;
  hasAudio: boolean;
  rotation: number;
  canDecode: boolean;
  videoBitrate?: number;
  audioBitrate?: number;
  audioTrackCount?: number;
  /** Title tag read from container metadata (ID3, MP4 atoms, WebM tags, Vorbis comments, RIFF INFO), if present and non-empty */
  title?: string;
}
```

- [ ] **Step 2: Write the failing test**

First read `packages/core/src/media/mediabunny-engine.test.ts` to see how `Input`/mocking is currently set up for `extractMetadata` tests, then add a case following that same mocking pattern. Example shape (adjust mock construction to match the file's existing conventions once read):

```typescript
it("extracts a non-empty title tag from container metadata", async () => {
  // Arrange: mock createInput()'s returned Input so getMetadataTags()
  // resolves to { title: "My Song" }, following this file's existing
  // mock setup for computeDuration/getMimeType/etc.
  const engine = new MediaBunnyEngine();
  const fakeFile = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

  const result = await engine.extractMetadata(fakeFile);

  expect(result.title).toBe("My Song");
});

it("leaves title undefined when the tag is empty or whitespace-only", async () => {
  // Arrange: mock getMetadataTags() to resolve to { title: "   " }
  const engine = new MediaBunnyEngine();
  const fakeFile = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

  const result = await engine.extractMetadata(fakeFile);

  expect(result.title).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/media/mediabunny-engine.test.ts -t "title"`
Expected: FAIL — `result.title` is `undefined` in the first case (feature not implemented yet), or the mock setup itself needs adjusting to match how `createInput` is actually mocked in this file (inspect existing tests before writing the mock).

- [ ] **Step 4: Implement metadata tag extraction**

In `packages/core/src/media/mediabunny-engine.ts`, inside `extractMetadata()` (after `getMimeType()`, before the `return` block), wrap the tag lookup in try/catch so malformed metadata never blocks import:

```typescript
      const duration = await input.computeDuration();
      const mimeType = await input.getMimeType();

      let title: string | undefined;
      try {
        const tags = await input.getMetadataTags();
        const trimmed = tags.title?.trim();
        if (trimmed) title = trimmed;
      } catch {
        // Malformed or unsupported metadata block — fall through without a title.
      }
```

Then add `title` to the returned object:

```typescript
      return {
        duration,
        width,
        height,
        frameRate,
        codec: videoCodec || audioCodec,
        sampleRate,
        channels,
        fileSize: file.size,
        mimeType,
        hasVideo: !!videoTrack,
        hasAudio: !!audioTrack,
        rotation,
        canDecode: canDecodeVideo || canDecodeAudio,
        videoBitrate,
        audioTrackCount,
        title,
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/media/mediabunny-engine.test.ts`
Expected: PASS, including all pre-existing tests in this file (no regression).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/media/types.ts packages/core/src/media/mediabunny-engine.ts packages/core/src/media/mediabunny-engine.test.ts
git commit -m "feat(core): extract container metadata title tag in extractMetadata"
```

---

### Task 4: Populate `MediaItem.title` at every import site in `project-store.ts`

**Files:**
- Modify: `apps/web/src/stores/project-store.ts` (four `importMedia` branches: SRT ~1846/1862, main import ~2013-2033, replace-existing ~2231-2257, folder-drop/version ~2621-2645; plus `preserveUserMediaMetadata` at 101-116)
- Test: `apps/web/src/services/auto-save.test.ts` (extend existing file, per spec's note about the existing assertion at line 166)

**Interfaces:**
- Consumes: `filenameToTitle` from Task 2 (`@openreel/core` media export), `processedMedia.metadata.title` from Task 3.
- Produces: every newly-imported `MediaItem` now has `title` populated. Later tasks (5, 6) rely on `item.title` being reliably set for non-SRT and SRT imports alike.

- [ ] **Step 1: Write the failing test**

First read `apps/web/src/services/auto-save.test.ts` around line 166 to see the existing import-flow test fixture and how `importMedia` is invoked/mocked there. Add a new test in the same file (or a new colocated test file `apps/web/src/stores/project-store.import-title.test.ts` if `auto-save.test.ts` isn't the right harness — inspect first and pick whichever existing test infra already exercises `importMedia`):

```typescript
it("derives title from filename when no metadata title is present", async () => {
  // Arrange: same import harness as the existing "clip.mp4" test at line 166,
  // with the mocked media engine's extractMetadata() returning no title.
  // ... invoke importMedia with a File named "my_video_clip-01.mp4" ...

  const item = /* the resulting MediaItem from store state */;
  expect(item.name).toBe("my_video_clip-01.mp4");
  expect(item.title).toBe("My video clip 01");
});

it("prefers metadata title over filename-derived title when present", async () => {
  // Arrange: mock extractMetadata() to resolve with metadata.title = "Real Song Title"
  // for a file named "IMG_1234.HEIC" (or an audio equivalent).

  const item = /* resulting MediaItem */;
  expect(item.name).toBe(/* original filename */);
  expect(item.title).toBe("Real Song Title");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/services/auto-save.test.ts -t "title"` (or the new test file path chosen in Step 1)
Expected: FAIL — `item.title` is `undefined`.

- [ ] **Step 3: Add the import and derive-title helper**

At the top of `apps/web/src/stores/project-store.ts`, add the import:

```typescript
import { filenameToTitle } from "@openreel/core/media";
```

(Adjust the import path if Task 2's barrel export uses a different path — verify against `packages/core/package.json`'s `exports` map: `"./*": { "import": "./src/*.ts" }` means `@openreel/core/media` resolves to `packages/core/src/media/index.ts`.)

Add a small local helper near `getImportedFileName` (line 84):

```typescript
function deriveMediaTitle(fileName: string, metadataTitle?: string): string {
  const trimmed = metadataTitle?.trim();
  return trimmed || filenameToTitle(fileName);
}
```

- [ ] **Step 4: Populate `title` at the SRT import site (~line 1846)**

Read the surrounding code first (lines ~1830-1866) to confirm the exact object shape, then add `title` alongside `name: file.name`:

```typescript
    const newMediaItem: MediaItem = preserveUserMediaMetadata({
      id: srtMediaId,
      name: file.name,
      title: deriveMediaTitle(file.name), // SRT has no container metadata title
      type: "srt" as MediaItem["type"],
      fileHandle: null,
      blob: file,
      // ...unchanged rest
```

- [ ] **Step 5: Populate `title` at the main import site (~line 2013)**

```typescript
          const newMediaItem: MediaItem = {
            id: uuidv4(),
            name: file.name,
            title: deriveMediaTitle(file.name, processedMedia.metadata.title),
            type: mediaType,
            fileHandle: null,
            blob: file,
            // ...unchanged rest
```

- [ ] **Step 6: Populate `title` at the replace-existing site (~line 2231)**

This branch already spreads `...previousItem` and then explicitly re-sets `title: previousItem?.title` at line 2253 (preserving the old title across a file replace, per `preserveUserMediaMetadata`'s intent). Per the spec, a file replace should still refresh the *derived* title if the previous item never had a user-set one, but must not clobber a title the user manually edited. There's no field distinguishing "auto-derived" from "user-edited" titles, so the safe rule is: **only fill in a title on replace if the previous item had none.**

```typescript
          const previousItem = project.mediaLibrary.items.find((item) => item.id === mediaId);
          const updatedItem: MediaItem = {
            ...previousItem,
            id: mediaId,
            name: file.name,
            type: mediaType,
            fileHandle: null,
            blob: file,
            metadata: {
              // ...unchanged
            },
            thumbnailUrl,
            filmstripThumbnails:
              filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
            // Preserve user-editable metadata — replace only the file, not the asset identity
            title: previousItem?.title || deriveMediaTitle(file.name, processedMedia.metadata.title),
            description: previousItem?.description,
            tags: previousItem?.tags,
            group: previousItem?.group,
            sourceFile: { name: file.name, size: file.size, lastModified: file.lastModified, folder: sourceFolder },
          };
```

- [ ] **Step 7: Populate `title` at the folder-drop/version site (~line 2621)**

Same reasoning as Step 6 — this branch carries forward `title: sourceItem.title` at line 2640:

```typescript
          const versionItem: MediaItem = {
            id: uuidv4(),
            name: file.name,
            type: mediaType,
            fileHandle: null,
            blob: file,
            metadata: {
              // ...unchanged
            },
            thumbnailUrl,
            filmstripThumbnails:
              filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
            title: sourceItem.title || deriveMediaTitle(file.name, metadata.title),
            description: sourceItem.description,
            tags: sourceItem.tags,
            group: sourceItem.group,
            generationMeta: sourceItem.generationMeta,
            sourceFile: { name: file.name, size: file.size, lastModified: file.lastModified, folder: sourceFolder },
          };
```

(Note: confirm the local variable name is `metadata` not `processedMedia.metadata` at this call site by re-reading lines 2560-2621 before editing — the read above showed a bare `metadata.duration` etc. reference, implying the destructured variable here is named `metadata`, not `processedMedia.metadata` like the other three sites.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/services/auto-save.test.ts`
Expected: PASS, including the pre-existing `expect(item.name).toBe("clip.mp4")` assertion (unchanged — `name` must never be affected by this change) plus the new title assertions.

- [ ] **Step 9: Run full project-store test suite to check for regressions**

Run: `cd apps/web && npx vitest run src/stores/project-store`
Expected: PASS, no regressions in existing import/replace/rename tests.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/stores/project-store.ts apps/web/src/services/auto-save.test.ts
git commit -m "feat(web): populate MediaItem.title from metadata or filename at import"
```

---

### Task 5: Convert "Rename asset" to write `title` instead of `name`

**Files:**
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx:1175-1180`

**Interfaces:**
- Consumes: `useProjectStore.getState().updateMediaMetadata(mediaId, patch)` — existing action, signature `(mediaId: string, patch: { title?: string; description?: string; tags?: string[]; group?: string }) => Promise<ActionResult>` (`apps/web/src/stores/project-store.ts:2354`).
- Produces: renaming an asset in the UI now edits `item.title`, leaving `item.name` (the true filename) untouched.

This reflects the explicit product decision: renaming in the media bin is conceptually editing the *display title*, not the underlying file's identity.

- [ ] **Step 1: Write the failing test**

First check whether `AssetsPanel.tsx` has an existing test file (e.g. `AssetsPanel.test.tsx`); if not, this is a small enough UI interaction to verify via a targeted unit test of the handler logic extracted, or via existing component test infra. Read the directory for a sibling test file before deciding. If no test harness exists for this component, add a minimal one:

```typescript
// apps/web/src/components/editor/AssetsPanel.rename.test.tsx
import { describe, it, expect, vi } from "vitest";
// ... import whatever this codebase's existing pattern is for testing a
// hook/callback in isolation, following the pattern of other *.test.tsx
// files in this directory (inspect one before writing this test) ...

it("rename action calls updateMediaMetadata with the new title, not renameMedia", async () => {
  const updateMediaMetadata = vi.fn().mockResolvedValue({ success: true });
  const renameMedia = vi.fn();
  // ... wire mocks into useProjectStore.getState() per this codebase's
  // existing store-mocking convention ...

  // simulate window.prompt returning "New Title" and triggering onRenameRef
  vi.spyOn(window, "prompt").mockReturnValue("New Title");

  // ... invoke the rename handler with a fake item { id: "abc", name: "clip.mp4", title: undefined } ...

  expect(updateMediaMetadata).toHaveBeenCalledWith("abc", { title: "New Title" });
  expect(renameMedia).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/editor/AssetsPanel.rename.test.tsx`
Expected: FAIL — current code calls `renameMedia`, not `updateMediaMetadata`.

- [ ] **Step 3: Implement the change**

In `apps/web/src/components/editor/AssetsPanel.tsx`, replace lines 1175-1180:

```typescript
  const onRenameRef = useRef((item: MediaItem) => {
    const newName = window.prompt("Rename asset:", item.title ?? item.name);
    const trimmed = newName?.trim();
    if (trimmed && trimmed !== (item.title ?? item.name)) {
      useProjectStore.getState().updateMediaMetadata(item.id, { title: trimmed });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/editor/AssetsPanel.rename.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetsPanel.rename.test.tsx
git commit -m "feat(web): rename asset action edits title, not filename"
```

---

### Task 6: Switch remaining display call sites from `item.name` to `item.title || item.name`

**Files:**
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx:295, 327, 329` (small card)
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx:461, 562, 564` (large card)
- Modify: `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx:20, 24, 101, 180, 185`
- Modify: `apps/web/src/components/editor/inspector/TemplateVariablesPanel.tsx:192`
- Modify: `apps/web/src/components/editor/panels/RecipesTab.tsx:184, 216-217`
- Modify: `apps/web/src/components/editor/preview/missing-video-placeholder.ts:145` (doc comment + literal default)

**Interfaces:**
- Consumes: `MediaItem.title` populated by Task 4.
- Produces: no new interface — pure display-layer change.

Sites confirmed already correct (no change): `AssetInspectorWithTabs.tsx:136,161,620`, `AssetDetailShared.tsx:321`, `AssetsPanel.tsx:869-874` (search — already unioned).

Sites that MUST keep raw `item.name` (no change): `AssetInspectorWithTabs.tsx:205` (Filename info row), `AssetInspectorWithTabs.tsx:674` (download filename), `project-store.ts:84-86` (`getImportedFileName`), `backend-save.ts:174` (upload filename).

- [ ] **Step 1: Write the failing test for the small-card display**

First check for an existing `AssetsPanel` snapshot/render test; if none exists for this specific display logic, add a minimal one:

```typescript
// apps/web/src/components/editor/AssetsPanel.display.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// ... import the small-card row component (read AssetsPanel.tsx around
// line 250-340 to find its exported/internal component name) ...

it("small card shows title when present, falls back to name otherwise", () => {
  // render with item = { name: "my_clip.mp4", title: "My Clip", ... }
  // expect(screen.getByText("My Clip")).toBeInTheDocument();

  // render with item = { name: "my_clip.mp4", title: undefined, ... }
  // expect(screen.getByText("my_clip.mp4")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/editor/AssetsPanel.display.test.tsx`
Expected: FAIL — component currently always renders `item.name`.

- [ ] **Step 3: Update small-card display (lines 295, 327, 329)**

```typescript
          {effectiveThumbnailUrl ? (
            <img src={effectiveThumbnailUrl} alt={item.title || item.name} className="w-full h-full object-cover" />
          ) : (
```

```typescript
          <div
            className={`text-[11px] truncate font-medium ${isSelected ? "text-primary" : "text-text-primary"}`}
            title={item.title || item.name}
          >
            {item.title || item.name}
          </div>
```

- [ ] **Step 4: Update large-card display (lines 461, 562, 564)**

```typescript
          <img
            src={effectiveThumbnailUrl}
            alt={item.title || item.name}
            className="w-full h-full object-cover"
          />
```

```typescript
        <div
          className={`text-[10px] truncate font-medium ${
            isSelected ? "text-primary" : "text-text-primary"
          }`}
          title={item.title || item.name}
        >
          {item.title || item.name}
        </div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/editor/AssetsPanel.display.test.tsx`
Expected: PASS.

- [ ] **Step 6: Update remaining call sites (no new test — mechanical, covered by Step 8's manual verification)**

Read each file at the listed lines first, then apply the same `item.title || item.name` (or `media.title || media.name`, matching the local variable name) substitution:

- `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx:20, 24, 101, 180, 185`
- `apps/web/src/components/editor/inspector/TemplateVariablesPanel.tsx:192` (`alt={media.title || media.name}`)
- `apps/web/src/components/editor/panels/RecipesTab.tsx:184, 216-217`
- `apps/web/src/components/editor/preview/missing-video-placeholder.ts:145` — this is a doc comment plus a default value; update the comment text to mention title-first precedence and use `mediaItem.title || mediaItem.name` in the actual placeholder-text logic if it constructs display text (read the surrounding function first — if the "logic" is only in the doc comment illustrating a caller's behavior, update only the comment, don't invent new logic that doesn't exist there).

- [ ] **Step 7: Run full apps/web test suite**

Run: `cd apps/web && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetsPanel.display.test.tsx apps/web/src/components/editor/generate/ReferenceImagePicker.tsx apps/web/src/components/editor/inspector/TemplateVariablesPanel.tsx apps/web/src/components/editor/panels/RecipesTab.tsx apps/web/src/components/editor/preview/missing-video-placeholder.ts
git commit -m "feat(web): prefer title over filename across remaining display sites"
```

---

### Task 7: Update `MediaItem.title` doc comment + manual verification pass

**Files:**
- Modify: `packages/core/src/types/project.ts:97` (doc comment only)

**Interfaces:**
- Consumes: nothing — documentation only.
- Produces: nothing — no code behavior change.

- [ ] **Step 1: Update the doc comment**

```typescript
  /** Display title for the asset: derived at import time from embedded media
   * metadata if present, otherwise a sentence-cased version of the filename.
   * User-editable thereafter via the "Rename asset" action; distinct from
   * the raw filename stored in `name`. */
  readonly title?: string;
```

- [ ] **Step 2: Run full monorepo typecheck**

Run: `cd packages/core && npx tsc --noEmit && cd ../../apps/web && npx tsc --noEmit`
Expected: no new errors in either package.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/project.ts
git commit -m "docs(core): clarify MediaItem.title as auto-derived-then-editable"
```

- [ ] **Step 4: Manual verification pass (run dev server, drive real flows)**

Start the dev server and verify, per the spec's testing plan:
1. Import an MP3 with an ID3 title tag set (e.g. via `ffmpeg -i in.wav -metadata title="My Song" out.mp3` to produce a test fixture) — confirm the media bin card shows "My Song", not the filename.
2. Import an MP4/MOV with no title tag and a snake_case filename (e.g. `test_clip_01.mp4`) — confirm the media bin shows "Test clip 01".
3. Import an image (JPEG/PNG) — confirm it falls back to the filename transform (no metadata-title path for images in this pass).
4. Open the inspector's "File" tab — confirm the "Filename" row still shows the true raw filename, unaffected.
5. Use the download action — confirm the downloaded file still uses the raw filename.
6. Re-drop an identical file (same name + size) — confirm it still triggers replace-not-duplicate (per inbox item #13's existing behavior), unaffected by this change.
7. Use "Rename asset" on a media item — confirm it now edits the title (verify by checking the inspector's "Filename" row is unchanged while the display name updates).
8. Search the media bin by a term matching only a derived/edited title (not the filename) — confirm it still finds the item (already-existing behavior, just confirming no regression).

Record pass/fail for each numbered check.

---

## Post-plan notes (fast-follow, not part of this plan)

Per the spec's Open Questions, out of scope here:
- EXIF/XMP title extraction for images (no reader exists in the repo; would need a new dependency like `exifr`).
- Bulk migration/recompute of titles for already-imported media in existing saved projects (existing items simply keep showing `name` until re-imported, replaced, or manually retitled — this is the intended, safe behavior per the spec's non-goals).
- `apps/image/src/components/editor/panels/LeftPanel.tsx` and `packages/image-core/src/project.ts`'s standalone `MediaAsset` type (separate app, no `title` field exists there yet).
- `apps/web/src/services/llm/snapshot.ts:284` — additive risk only if the LLM-facing snapshot should also expose `title`; not required for this feature to function.
