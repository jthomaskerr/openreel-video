# Handoff: Media Import Timeline Plan

**Task:** Write `docs/superpowers/plans/2026-07-05-media-import-timeline.md`  
**Spec:** `docs/spec/media-import-timeline.md`  
**Related Plan:** `docs/superpowers/plans/2026-06-28-music-video-timeline-native.md` (covers music-video-specific import; this plan covers GENERAL import only)  
**Status:** Ready for investigator — subagent failed at rate limit before completion

---

## Investigation Scope

### Spec Sections to Cover

Read the entire media-import-timeline spec in `docs/spec/media-import-timeline.md`. Key areas:

- **Import Entry Points:** File picker, drag-drop, paste, URL import
- **Track Type Detection:** Auto-detect track type based on file type/extension
- **Track Types Supported:** Video, Audio, Subtitle, Metadata, Generated Asset
- **Metadata Tracks:** Special track type for timecode, markers, cue points, notes
- **Generated Assets:** Upscaled frames, storyboard previews, AI-generated content
- **Scene/Character/Style Import:** Project-level metadata structures
- **Track Layout:** Default positioning of imported tracks on timeline
- **Missing File Recovery:** Retry logic, placeholder behavior, user recovery options
- **Batch Import:** Multiple files at once
- **Import Progress:** Feedback to user during long imports
- **Format Support:** Which video/audio/image/subtitle formats are supported

### Current Implementation Files

Search for import-related code in `apps/web/src/`:

```bash
find apps/web/src -name "*import*" -o -name "*Import*" | head -20
grep -r "import.*file\|FileList\|drag.*drop" apps/web/src --include="*.tsx" | head -20
grep -r "addTrack\|createClip\|insertClip" apps/web/src --include="*.tsx" | head -20
```

**Expected files:**
- File picker/import dialog
- Drag-drop handler
- Format detection logic
- Track creation logic
- Import progress indicator

---

## CRITICAL: Scope Boundary with Music-Video-Timeline-Native Plan

**Important:** Do NOT duplicate the scope of `2026-06-28-music-video-timeline-native.md`.

**Investigation:**
```bash
# Read the music-video-timeline-native plan to understand what it covers
cat docs/superpowers/plans/2026-06-28-music-video-timeline-native.md | head -200
# Look for "import" or "Import" mentions
grep -i "import" docs/superpowers/plans/2026-06-28-music-video-timeline-native.md
```

**What to Determine:**
- [ ] Does music-video-timeline-native cover music/beat-based import flow?
- [ ] Does it cover video import into music-video timeline?
- [ ] What import-related tasks does it include?
- [ ] **This plan should cover:** ONLY the general (non-music-video) import flow, OR the specific gaps in media-import-timeline.md that are NOT already covered by music-video-timeline-native

**Document the boundary clearly in the plan.** Example: "This plan covers general media import flow for all timeline types. For music-video-specific import with beat detection and synchronization, see 2026-06-28-music-video-timeline-native.md (Tasks X–Y)."

---

## Key Investigations Required

### 1. Import Entry Points (Spec §2)

**Spec Requirement:** Multiple import methods:
- File picker (click button → select file)
- Drag-drop (drag files onto timeline)
- Paste (paste media from clipboard)
- URL import (paste/enter URL)

**Investigation:**
```bash
# Search for file input handling
grep -rn "<input.*type=\"file\"\|FilePickerDialog\|selectFile" apps/web/src --include="*.tsx" | head -20

# Search for drag-drop handlers
grep -rn "onDrop\|onDragOver\|DragEvent" apps/web/src --include="*.tsx" | head -20

# Search for paste handlers
grep -rn "onPaste\|ClipboardEvent" apps/web/src --include="*.tsx" | head -20

# Search for URL import
grep -rn "URL\|url.*import\|importFromUrl" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] File picker exists and functions
- [ ] Drag-drop works on timeline
- [ ] Paste from clipboard works (if supported)
- [ ] URL import works (if supported)

---

### 2. Track Type Detection (Spec §3)

**Spec Requirement:** Auto-detect track type from file:
- `.mp4`, `.webm`, `.mov` → Video track
- `.mp3`, `.wav`, `.aac`, `.ogg` → Audio track
- `.srt`, `.vtt`, `.ass` → Subtitle track
- `.json`, `.xml` → Metadata track (special format)
- Upscaled images, storyboard previews → Generated Asset track

**Investigation:**
```bash
# Search for file type detection
grep -rn "getFileType\|detectType\|extension\|mimetype" apps/web/src --include="*.tsx" | head -30

# Look for track type constants
grep -rn "TrackType\|VIDEO\|AUDIO\|SUBTITLE\|METADATA" apps/web/src --include="*.tsx" | head -30
```

**What to Verify:**
- [ ] File extension mapping is correct
- [ ] MIME type detection works
- [ ] Fallback to filename if MIME unknown
- [ ] Generated Asset detection logic (if applicable)

---

### 3. Track Creation & Positioning (Spec §4–5)

**Spec Requirement:** 
- Create appropriate track when file imported
- Position imported track based on type (video usually top, audio below, subtitles at bottom, etc.)
- Respect user's current track layout preference

**Investigation:**
```bash
# Search for track creation
grep -rn "addTrack\|createTrack\|insertTrack" apps/web/src --include="*.tsx" | head -30

# Look for track positioning logic
grep -rn "trackIndex\|insertIndex\|repositionTrack" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] New track is created with correct type
- [ ] New track positioned appropriately
- [ ] Existing tracks shifted if needed (track order preserved)
- [ ] User can customize default positioning if desired

---

### 4. Metadata Tracks (Spec §6)

**Spec Requirement:** Special track type for project-level metadata (timecode, markers, cue points, notes)

**Investigation:**
```bash
# Search for metadata track handling
grep -rn "METADATA\|metadata.*track\|MetadataTrack" apps/web/src --include="*.tsx" | head -20

# Look for marker/cue point display
grep -rn "marker\|cuePoint\|timecode" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Metadata track type exists
- [ ] Metadata track can be imported from JSON/XML
- [ ] Markers/cue points display on timeline
- [ ] Timecode track displays/syncs with playhead

---

### 5. Scene/Character/Style Import (Spec §7)

**Spec Requirement:** Import project-level metadata (scene definitions, character list, style guide)

**Investigation:**
```bash
# Search for project metadata structures
grep -rn "Scene\|Character\|Style" apps/web/src --include="*.tsx" | head -30

# Look for project import/load logic
grep -rn "importProject\|loadProject\|projectData" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Scene import logic (where are scenes stored? timeline vs. project-level?)
- [ ] Character list import
- [ ] Style guide import
- [ ] Are these separate from track-level imports, or bundled?

---

### 6. Generated Assets Import (Spec §8)

**Spec Requirement:** Import upscaled frames, storyboard previews, AI-generated content as special clip type

**Investigation:**
```bash
# Search for generated asset handling
grep -rn "Generated\|generated.*asset\|upscale\|storyboard.*preview" apps/web/src --include="*.tsx" | head -20

# Look for special clip type handling
grep -rn "GeneratedAssetClip\|clipType.*generated" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Generated asset clip type exists
- [ ] Upscaled frames can be imported as clips
- [ ] Storyboard previews can be imported
- [ ] Generated assets tracked back to source (for re-generation if needed)

---

### 7. Missing File Recovery (Spec §9)

**Spec Requirement:** Handle missing files gracefully:
- Show placeholder/error state
- Offer retry (rescan, re-import)
- Offline mode (cache locally if possible)
- Fallback to lower quality if available

**Investigation:**
```bash
# Search for missing file handling
grep -rn "missing\|notFound\|fileNotFound\|placeholder" apps/web/src --include="*.tsx" | head -30

# Look for error recovery
grep -rn "retry\|recover\|fallback" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Missing file detection works
- [ ] User sees error/placeholder state
- [ ] Retry/recovery options available
- [ ] Fallback behavior documented

---

### 8. Batch Import (Spec §10)

**Spec Requirement:** Import multiple files at once; create tracks for each

**Investigation:**
```bash
# Search for batch import logic
grep -rn "batch\|multiple.*file\|FileList" apps/web/src --include="*.tsx" | head -30

# Look for file array handling
grep -rn "files\\.map\|forEach.*file" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Multiple files can be selected/dragged at once
- [ ] Tracks created for each file
- [ ] Batch progress indicator (if long)
- [ ] Order preserved (files imported in selection order)

---

### 9. Format Support (Spec §11)

**Spec Requirement:** Specific supported formats listed per track type

**Investigation:**
```bash
# Search for supported formats list
grep -rn "SUPPORTED.*FORMAT\|supportedFormats\|fileExtensions" apps/web/src --include="*.tsx" | head -30

# Look for format validation
grep -rn "isSupported\|validateFormat\|checkFormat" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Supported formats match spec table (Spec §11)
- [ ] Unsupported formats rejected with user-friendly error
- [ ] Format detection is reliable

---

## Plan Document Structure

Write `docs/superpowers/plans/2026-07-05-media-import-timeline.md` with:

### 1. **Goal Statement**
Overview of media import flow and its role in project creation/editing workflows.

### 2. **Scope Boundary**
**Explicitly state:** "This plan covers general media import flow for all timeline types, excluding music-video-specific import (beat detection, synchronization) which is covered in 2026-06-28-music-video-timeline-native.md."

### 3. **Current State vs. Spec (Table)**

| Spec Section | Feature | Status | Notes |
|---|---|---|---|
| §2 | File picker, drag-drop, paste, URL import | ? | Verify all 4 methods exist... |
| §3 | Track type auto-detection | ? | File extension mapping correct?... |
| §4–5 | Track creation & positioning | ? | Default track order logic?... |
| §6 | Metadata tracks (timecode, markers) | ? | Special track type exists?... |
| §7 | Scene/character/style import | ? | Project-level metadata import?... |
| §8 | Generated assets import | ? | Upscaled frames, storyboard previews?... |
| §9 | Missing file recovery | ? | Placeholder/retry logic?... |
| §10 | Batch import | ? | Multiple files at once?... |
| §11 | Format support | ? | All formats from spec table supported?... |

### 4. **Architecture / Tech Stack**

Overview of import architecture (file picker UI, format detection, track factory, timeline insertion, error handling).

### 5. **File Map (Table)**

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/services/import/` | Create dir | Centralized import service |
| `apps/web/src/services/import/format-detector.ts` | Create | File type detection logic |
| `apps/web/src/services/import/track-factory.ts` | Create | Track creation factory |
| `apps/web/src/components/editor/ImportDialog.tsx` | Create/Modify | File picker UI |
| `apps/web/src/hooks/useMediaImport.ts` | Create/Modify | Import logic hook |
| ... | ... | ... |

### 6. **Numbered Tasks**

Example task structure:

```markdown
## Task N: Implement Batch Import Handler

**Files:**
- Create: `apps/web/src/services/import/batch-importer.ts`
- Modify: `apps/web/src/components/editor/ImportDialog.tsx`

**Steps:**

- [ ] **Step 1: Create batch import service**

```typescript
// apps/web/src/services/import/batch-importer.ts
export async function importBatch(files: File[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const file of files) {
    const result = await importFile(file);
    results.push(result);
  }
  return results;
}
```

- [ ] **Step 2: Update ImportDialog to handle multiple files**

- [ ] **Step 3: Add progress indicator for batch**

- [ ] **Verification:**
```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
```

- [ ] **Commit:**
```bash
git add apps/web/src/services/import/ apps/web/src/components/editor/ImportDialog.tsx
git commit -m "feat(import): implement batch import handler"
```
```

### 7. **Size/Complexity Estimate**

L (large) — media import is a complex subsystem with multiple entry points, format support, error handling, and batch processing.

---

## Scope Boundary Example

Include a clear statement like:

```markdown
## Scope Boundary: Music-Video-Specific Import

This plan covers **general media import flow** for all timeline types.

The **2026-06-28-music-video-timeline-native.md** plan (Tasks X–Y) covers music-video-specific import with:
- BPM/beat detection from audio
- Automatic beat-aware track positioning
- Snap-to-beat defaults for music-video timelines

Do NOT duplicate those tasks in this plan. Focus only on the general import flow that applies to all project types.
```

---

## Completion Checklist

- [ ] Spec read in full
- [ ] music-video-timeline-native plan read to understand boundary
- [ ] All 9 investigations above completed
- [ ] Scope boundary clearly stated
- [ ] Current State vs. Spec table filled in
- [ ] File map created
- [ ] All numbered tasks written with checkboxes, code, verification, commits
- [ ] Size/complexity estimate provided
- [ ] Document matches tone/structure of existing plans
- [ ] No application source files modified
- [ ] Plan file written to `docs/superpowers/plans/2026-07-05-media-import-timeline.md`

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Ready for investigator:** Yes  
**Critical:** Read music-video-timeline-native plan first to understand boundary  
**Next:** Submit plan document; supervisor will verify completeness and scope boundary
