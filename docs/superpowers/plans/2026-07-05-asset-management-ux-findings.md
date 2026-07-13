# Asset Management UX Implementation Findings

## Current State (Audited 2026-07-13 16:16 AEST)

**Document type:** PARTIAL HISTORICAL FINDINGS, NOT AN EXECUTABLE PLAN. Canonical owners: [Media Assets](../../spec/media-assets.md) and [Project](../../spec/project.md). Percentages and handoff claims below describe the 2026-07-05 investigation only.

| Area | Current state |
|---|---|
| Display titles/rename | Mostly implemented; metadata extraction, filename fallback, and title-only rename exist, but every constructor/display path is not proven. |
| Asset versions | Implemented for grouped immutable versions with current-version switching and tests. |
| Asset inspector | Implemented with tabs, metadata, versions, and preview surfaces. |
| Media-pane controls | Single toolbar and missing-only reset have deterministic tests; browser evidence remains open. |
| Runtime availability/relink | Partial; no canonical temporary-vs-confirmed-missing state machine. |
| Project identity/storage | Nonconformant backend identity flow and incomplete save transaction remain owned by the project-save plan. |
| Verification | No comprehensive asset-management browser matrix or consolidated plan-level gate exists. |

**Next action:** use the media-title, Media-pane, and project-save plans for executable work; do not implement from the stale percentages below.

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/asset-management-ux.md`

---

## Summary

Asset browser **substantially implemented**. Core density/bucket/search features likely exist.

---

## Key Areas to Verify

1. **Asset Panel Layout (§1)**
   - [ ] Header with search box
   - [ ] Sidebar with bucket list
   - [ ] Main area with asset grid/list
   - [ ] Footer with view options

2. **Density Modes (§2)**
   - [ ] Compact mode (small thumbs, 12–16 per row)
   - [ ] Normal mode (medium thumbs, ~8 per row, default)
   - [ ] Expanded mode (large thumbs, 4–6 per row)
   - [ ] Toggle UI
   - [ ] Persistence (remember last choice)

3. **Asset Buckets (§3)**
   - [ ] Type-based buckets (Video, Audio, Image, Text, Effects, Fonts)
   - [ ] Source-based buckets (Imported, Generated, Stock, System)
   - [ ] Bucket list in sidebar
   - [ ] "All" bucket showing all assets
   - [ ] Bucket counts displayed

4. **Search & Filter (§4)**
   - [ ] Real-time search box
   - [ ] Filter panel/options
   - [ ] Multiple filters (AND logic)
   - [ ] Clear filters button

5. **Sort Options (§5)**
   - [ ] Sort by name (A–Z, Z–A)
   - [ ] Sort by date added (newest/oldest first)
   - [ ] Sort by file size
   - [ ] Sort by duration (if video/audio)
   - [ ] Sort by type
   - [ ] Reversible sort (ascending/descending toggle)
   - [ ] Persistence (remember last sort)

6. **Drag-to-Timeline (§6)**
   - [ ] Assets draggable
   - [ ] Timeline accepts drop
   - [ ] Clip created with asset content
   - [ ] Clip properties derived from asset

7. **Batch Operations (§7)**
   - [ ] Multi-select (checkbox or click)
   - [ ] Shift-click range select
   - [ ] Bulk delete, tag, move
   - [ ] Confirmation before delete
   - [ ] Select All / Deselect All

8. **Inline Rename (§8)**
   - [ ] Double-click enters edit mode
   - [ ] Text field editable
   - [ ] Validation (not empty, max length, no duplicates)
   - [ ] Confirm on Enter, cancel on Escape

9. **Thumbnails & Preview (§9)**
   - [ ] Video: frame capture
   - [ ] Audio: waveform or icon
   - [ ] Image: display image
   - [ ] Text: text preview or icon
   - [ ] Lazy-load thumbnails
   - [ ] Placeholder while loading

10. **Metadata Display (§10)**
    - [ ] File name, file size, duration
    - [ ] Resolution/dimensions, format, codec
    - [ ] Date added, tags, source
    - [ ] Tooltip on hover or expanded view

11. **Context Menu (§11)**
    - [ ] Right-click triggers menu
    - [ ] Delete, Rename, Preview, Show in Finder, Properties/Info

12. **Asset Upload (§12)**
    - [ ] Drag-drop onto panel uploads
    - [ ] File picker button available
    - [ ] Upload progress shown
    - [ ] Batch upload supported
    - [ ] Supported formats enforced

---

## Files to Examine

- `apps/web/src/components/editor/AssetPanel.tsx` (or similar)
- `apps/web/src/hooks/useAssetBrowser.ts` (or similar)
- Asset list/grid component
- Bucket sidebar component
- Search/filter UI

---

**Handoff Status:** 20% investigated. High priority (core workflow).
