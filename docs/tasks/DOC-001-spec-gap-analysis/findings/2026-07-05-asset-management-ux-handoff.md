# Handoff: Asset Management UX Plan

**Task:** Write `docs/superpowers/plans/2026-07-05-asset-management-ux.md`  
**Spec:** `docs/spec/asset-management-ux.md`  
**Status:** Ready for investigator — subagent failed at rate limit before completion

---

## Investigation Scope

### Spec Sections to Cover

Read the entire asset-management-ux spec in `docs/spec/asset-management-ux.md`. Key areas:

- **Asset Panel / Browser:** Main UI for browsing and organizing assets
- **Density Modes:** Compact, normal, expanded view options (thumbnail size/layout)
- **Asset Buckets:** Organizing assets by type (video, audio, image, text, etc.) or source (imported, generated, stock, etc.)
- **Search & Filter:** Search by name, filter by type, date, duration, resolution, etc.
- **Sort Options:** Sort by name, date added, file size, duration, type, etc.
- **Drag-to-Timeline:** Drag asset to timeline to create clip
- **Batch Operations:** Select multiple assets, perform operations (delete, tag, move bucket, etc.)
- **Inline Rename:** Quick rename directly in asset list
- **Asset Preview/Thumbnail:** Display asset thumbnail or preview
- **Asset Metadata:** Show asset properties (file size, duration, resolution, format, etc.)
- **Right-Click Context Menu:** Delete, rename, preview, show in finder, etc.
- **Asset Upload:** Drag-drop or file picker to add new assets
- **Storage/Quota Display:** Optional: show storage usage and quota limits

### Current Implementation Files

Search for asset-related UI in `apps/web/src/`:

```bash
find apps/web/src -name "*asset*" -o -name "*Asset*" | grep -i "component\|panel\|browser" | head -20
grep -r "AssetBrowser\|AssetPanel\|useAsset" apps/web/src --include="*.tsx" | head -20
grep -r "assetStore\|useAssets" apps/web/src --include="*.tsx" | head -20
```

**Expected files:**
- Asset browser/panel component
- Asset list item component
- Asset bucket selector
- Search/filter UI
- Drag-drop handler
- Context menu

---

## Key Investigations Required

### 1. Asset Panel Layout (Spec §1)

**Spec Requirement:** Main asset browser panel with:
- Header with search box and filter controls
- Sidebar with bucket/category list
- Main area with asset grid/list
- Footer with density mode toggle and view options

**Investigation:**
```bash
# Search for asset panel structure
grep -rn "AssetPanel\|AssetBrowser\|AssetView" apps/web/src --include="*.tsx" | head -30

# Look for layout components (sidebar, header, footer)
grep -rn "sidebar\|header\|footer" apps/web/src/components/editor --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Asset panel exists and is visible
- [ ] All layout sections present (header, sidebar, main, footer)
- [ ] Panel is resizable (if spec requires)
- [ ] Panel can be collapsed/expanded

---

### 2. Density Modes (Spec §2)

**Spec Requirement:** 3 view modes:
- **Compact:** Small thumbnails, single-line text (max 12–16 per row)
- **Normal:** Medium thumbnails, multiline text (default, ~8 per row)
- **Expanded:** Large thumbnails, detailed metadata (4–6 per row)

**Investigation:**
```bash
# Search for density/view mode switching
grep -rn "density\|viewMode\|compact\|expanded\|normal" apps/web/src --include="*.tsx" -i | head -30

# Look for thumbnail sizing logic
grep -rn "thumbnail.*size\|gridSize\|itemSize" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] 3 density modes exist
- [ ] UI toggle to switch between modes
- [ ] Persistence (remember user's last choice)
- [ ] Layout re-renders correctly for each mode

---

### 3. Asset Buckets (Spec §3)

**Spec Requirement:** Organize assets by:
- **Type-based buckets:** Video, Audio, Image, Text, Effects, Fonts, etc.
- **Source-based buckets:** Imported, Generated, Stock Library, System, etc.
- **Custom buckets:** User-defined categories

**Investigation:**
```bash
# Search for bucket/category system
grep -rn "bucket\|Bucket\|category\|Category" apps/web/src --include="*.tsx" | head -30

# Look for bucket filter logic
grep -rn "filterBy\|bucket.*filter\|assetType" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Bucket list displayed in sidebar
- [ ] Clicking bucket filters asset list
- [ ] Bucket counts shown (e.g., "Video (42)")
- [ ] "All" bucket shows all assets
- [ ] Custom bucket support (if applicable)

---

### 4. Search & Filter (Spec §4)

**Spec Requirement:** 
- Search by asset name (real-time as you type)
- Filter options: type, date range, duration, resolution, file size, tag
- Clear filters button

**Investigation:**
```bash
# Search for search/filter implementation
grep -rn "search\|Search\|filter\|Filter" apps/web/src/components/editor --include="*.tsx" | head -30

# Look for input field
grep -rn "searchInput\|filterInput\|query" apps/web/src --include="*.tsx" | head -20

# Check for filter state
grep -rn "filterState\|filters\|searchQuery" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Search box present and functional
- [ ] Search is real-time (no submit button needed)
- [ ] Filter panel/sidebar available
- [ ] Multiple filters can be applied (AND logic)
- [ ] Clear/reset all filters button

---

### 5. Sort Options (Spec §5)

**Spec Requirement:** Sort by:
- Name (A–Z, Z–A)
- Date added (oldest first, newest first)
- File size (small to large, large to small)
- Duration (if applicable for video/audio)
- Type
- Manually (drag-reorder)

**Investigation:**
```bash
# Search for sort logic
grep -rn "sort\|Sort\|orderBy\|order.*by" apps/web/src --include="*.tsx" | head -30

# Look for sort dropdown/selector
grep -rn "sortBy\|sortOrder\|SortDropdown" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Sort dropdown/menu exists
- [ ] All sort options present
- [ ] Sort is reversible (ascending/descending toggle)
- [ ] Persistence (remember user's sort choice)
- [ ] Default sort is logical (usually by date added, newest first)

---

### 6. Drag-to-Timeline (Spec §6)

**Spec Requirement:** Drag asset from panel → drop on timeline to create clip

**Investigation:**
```bash
# Search for drag-drop handling
grep -rn "onDrag\|onDrop\|draggable" apps/web/src --include="*.tsx" | head -30

# Look for asset → clip creation
grep -rn "assetToClip\|createClipFromAsset\|draggedAsset" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Assets are draggable (cursor changes to drag indicator)
- [ ] Timeline accepts drop
- [ ] Clip created at drop location with asset content
- [ ] Clip properties (duration, etc.) derived from asset

---

### 7. Batch Operations (Spec §7)

**Spec Requirement:** Select multiple assets, perform operations:
- Multi-select (checkbox or shift-click)
- Delete selected
- Tag/organize selected
- Move to different bucket
- Export selected (optional)

**Investigation:**
```bash
# Search for multi-select logic
grep -rn "selected\|isSelected\|checkbox" apps/web/src --include="*.tsx" | head -30

# Look for bulk operations
grep -rn "bulkDelete\|bulkTag\|bulkMove" apps/web/src --include="*.tsx" | head -20

# Check for selection state
grep -rn "selectedAssets\|selection.*set" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Checkbox or click-to-select mechanism
- [ ] Shift-click/range select supported (if applicable)
- [ ] Bulk operations available (delete, tag, move)
- [ ] Confirmation before destructive operations (delete)
- [ ] "Select All" / "Deselect All" buttons

---

### 8. Inline Rename (Spec §8)

**Spec Requirement:** Rename asset directly in list (double-click or rename button)

**Investigation:**
```bash
# Search for rename UI
grep -rn "rename\|Rename\|editName\|contentEditable" apps/web/src --include="*.tsx" | head -30

# Look for inline edit mode
grep -rn "editMode\|isEditing\|inlineEdit" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Double-click (or rename button) enters edit mode
- [ ] Text field appears with current name
- [ ] Validation (name not empty, max length)
- [ ] Confirm on Enter, cancel on Escape
- [ ] No duplicates (if applicable)

---

### 9. Asset Preview & Thumbnails (Spec §9)

**Spec Requirement:** Display thumbnail or preview for each asset:
- Video: frame capture or video thumbnail
- Audio: waveform preview or generic icon
- Image: display image itself
- Text: text preview or generic icon
- Effects/Fonts: generic icon or sample

**Investigation:**
```bash
# Search for thumbnail/preview generation
grep -rn "thumbnail\|Thumbnail\|preview\|Preview" apps/web/src --include="*.tsx" | head -30

# Look for asset type-specific rendering
grep -rn "assetType\|switch.*type" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Thumbnails display for all asset types
- [ ] Video thumbnails show frame capture
- [ ] Audio shows waveform or icon
- [ ] Images display actual image
- [ ] Lazy-load thumbnails (for performance)
- [ ] Placeholder while loading

---

### 10. Asset Metadata Display (Spec §10)

**Spec Requirement:** Show asset properties in expanded view or hover tooltip:
- File name
- File size
- Duration (for video/audio)
- Resolution / dimensions
- Format / codec
- Date added
- Tags
- Source

**Investigation:**
```bash
# Search for metadata display
grep -rn "metadata\|fileSize\|duration\|resolution" apps/web/src --include="*.tsx" | head -30

# Look for hover/tooltip
grep -rn "Tooltip\|onHover\|metadata.*tooltip" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Metadata visible in expanded density mode
- [ ] Hover tooltip with key metadata (for compact mode)
- [ ] All relevant fields present
- [ ] Format clear and readable

---

### 11. Right-Click Context Menu (Spec §11)

**Spec Requirement:** Right-click → context menu with actions:
- Delete
- Rename
- Preview
- Show in Finder / File Explorer
- Copy path (optional)
- Properties / Info

**Investigation:**
```bash
# Search for context menu
grep -rn "contextMenu\|ContextMenu\|rightClick\|onContextMenu" apps/web/src --include="*.tsx" | head -30

# Look for menu items
grep -rn "Delete\|Rename\|Preview\|Properties" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Right-click triggers context menu
- [ ] Menu positioned correctly
- [ ] All actions available
- [ ] Keyboard shortcuts (optional)

---

### 12. Asset Upload (Spec §12)

**Spec Requirement:** Add new assets via drag-drop or file picker

**Investigation:**
```bash
# Search for upload
grep -rn "upload\|Upload\|addAsset\|import" apps/web/src --include="*.tsx" | head -30

# Look for file input
grep -rn "input.*file\|FileList" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Drag-drop onto asset panel uploads
- [ ] File picker button available
- [ ] Upload progress shown
- [ ] Batch upload (multiple files)
- [ ] Supported formats enforced

---

## Plan Document Structure

Write `docs/superpowers/plans/2026-07-05-asset-management-ux.md` with:

### 1. **Goal Statement**
Overview of asset management UX and its role in organizing and reusing media.

### 2. **Current State vs. Spec (Table)**

| Spec Section | Feature | Status | Notes |
|---|---|---|---|
| §1 | Asset panel layout | ? | Header, sidebar, main, footer?... |
| §2 | Density modes (compact/normal/expanded) | ? | 3 modes, toggle, persist?... |
| §3 | Asset buckets | ? | Type-based? Source-based?... |
| §4 | Search & filter | ? | Real-time search, filter panel?... |
| §5 | Sort options | ? | All sort keys (name, date, size, etc.)?... |
| §6 | Drag-to-timeline | ? | Asset → clip creation?... |
| §7 | Batch operations | ? | Multi-select, bulk delete/tag/move?... |
| §8 | Inline rename | ? | Double-click edit?... |
| §9 | Thumbnails & preview | ? | Video frames, audio waveform?... |
| §10 | Metadata display | ? | File info tooltip or expanded view?... |
| §11 | Context menu | ? | Right-click actions?... |
| §12 | Asset upload | ? | Drag-drop, file picker?... |

### 3. **Architecture / Tech Stack**

Overview of asset management architecture (asset store, UI components, drag-drop handling, thumbnail generation).

### 4. **File Map (Table)**

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/components/editor/AssetPanel.tsx` | Create/Modify | Main asset browser |
| `apps/web/src/components/editor/assets/AssetList.tsx` | Create/Modify | Asset grid/list |
| `apps/web/src/components/editor/assets/AssetItem.tsx` | Create/Modify | Single asset card |
| `apps/web/src/components/editor/assets/AssetBucketSidebar.tsx` | Create/Modify | Bucket list |
| `apps/web/src/components/editor/assets/AssetSearch.tsx` | Create/Modify | Search/filter UI |
| `apps/web/src/components/editor/assets/AssetContextMenu.tsx` | Create/Modify | Right-click menu |
| `apps/web/src/hooks/useAssetDragDrop.ts` | Create/Modify | Drag-drop logic |
| `apps/web/src/hooks/useAssetBrowser.ts` | Create/Modify | Asset browsing logic |
| ... | ... | ... |

### 5. **Numbered Tasks**

Example task:

```markdown
## Task N: Implement Density Mode Switching

**Files:**
- Modify: `apps/web/src/components/editor/AssetPanel.tsx`
- Modify: `apps/web/src/components/editor/assets/AssetList.tsx`

**Steps:**

- [ ] **Step 1: Add density state to component**

```typescript
const [density, setDensity] = useState<"compact" | "normal" | "expanded">("normal");
```

- [ ] **Step 2: Update layout based on density**

```typescript
const gridCols = density === "compact" ? "grid-cols-12" : 
                 density === "normal" ? "grid-cols-8" : 
                 "grid-cols-4";
```

- [ ] **Step 3: Add density toggle to footer**

Three buttons: Compact | Normal | Expanded

- [ ] **Step 4: Persist density choice**

Save to localStorage when changed.

- [ ] **Verification:**
```bash
pnpm --filter @openreel/web typecheck
```

- [ ] **Commit:**
```bash
git add apps/web/src/components/editor/
git commit -m "feat(assets): implement density mode switching"
```
```

### 6. **Size/Complexity Estimate**

L (large) — asset management UI is complex with many features (buckets, search, drag-drop, preview, batch ops).

---

## Completion Checklist

- [ ] Spec read in full
- [ ] All 12 investigations above completed
- [ ] Current State vs. Spec table filled in
- [ ] File map created
- [ ] All numbered tasks written with checkboxes, code, verification, commits
- [ ] Size/complexity estimate provided
- [ ] Document matches tone/structure of existing plans
- [ ] No application source files modified
- [ ] Plan file written to `docs/superpowers/plans/2026-07-05-asset-management-ux.md`

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Ready for investigator:** Yes  
**Next:** Submit plan document; supervisor will verify completeness
