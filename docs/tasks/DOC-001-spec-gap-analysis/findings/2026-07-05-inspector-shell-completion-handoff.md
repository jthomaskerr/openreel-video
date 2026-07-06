# Handoff: Inspector Shell Completion Plan

**Task:** Write `docs/superpowers/plans/2026-07-05-inspector-shell-completion.md`  
**Spec:** `docs/spec/inspector-shell.md`  
**Status:** Ready for investigator — subagent failed at rate limit before completion

---

## Investigation Scope

### Spec Sections to Cover

Read the entire inspector-shell spec in `docs/spec/inspector-shell.md`. Key areas:

- **Right Sidebar Layout:** 4-tab layout (Inspector, Edit, Problems, Log)
- **Tab System:** Active tab switching, tab-specific content
- **Inspector Tab:** Clip metadata display (read-only)
- **Edit Tab:** Clip property editing with live preview
- **Problems Tab:** Integration with Problems subsystem (not owned by inspector plan, but referenced)
- **Log Tab:** Read-only log viewer with filtering/search
- **Clip-Type-Specific Sub-Tabs:** Different inspector/edit content for Video, Audio, Text, Image, Shape, Storyboard, etc.
- **Character Pill System (§3.8):** Special UI for character metadata editing (noted as "not implemented" in subagent output)
- **Metadata Layout (§3.6):** Structured metadata display (name, duration, tags, source, etc.)
- **Storyboard Inspector (§3.7):** Scene/panel/dialogue metadata for storyboard clips
- **Asset Inspector (§3.9):** Media/font/effect asset metadata

### Current Implementation Files

Search for inspector components in `apps/web/src/`:

```bash
find apps/web/src -name "*nspector*" -o -name "*Inspector*" | head -20
grep -r "InspectorPanel\|InspectorTab" apps/web/src --include="*.tsx" | head -20
```

**Expected files:**
- Inspector panel container (main right sidebar)
- Tab switcher component
- Inspector tab content (clip metadata)
- Edit tab content (clip properties)
- Problems tab integration
- Log tab integration
- Clip-type-specific sub-tab systems (for Video, Audio, Text, etc.)

---

## Key Investigations Required

### 1. 4-Tab Layout Verification (Spec §1–2)

**Spec Requirement:** Right sidebar with 4 tabs: Inspector, Edit, Problems, Log

**Investigation:**
```bash
# Search for tab definitions
grep -rn "Inspector\|Edit\|Problems\|Log" apps/web/src/components/editor \
  --include="*.tsx" | grep -i "tab\|panel" | head -30

# Look for tab state management (likely Zustand store)
grep -rn "activeTab\|currentTab\|inspectorTab" apps/web/src --include="*.ts*" | head -20
```

**What to Verify:**
- [ ] All 4 tabs exist and are selectable
- [ ] Tab persistence (does sidebar remember last active tab?)
- [ ] Tab content renders correctly for each tab
- [ ] Tab icons/labels match spec

---

### 2. Clip-Type-Specific Sub-Tabs (Spec §3)

**Spec Requirement:** Different inspector/edit content for each clip type:
- Video clips: duration, codec, resolution, frame rate, effects, speed
- Audio clips: duration, format, sample rate, channels, effects, volume
- Text clips: font, size, color, alignment, animation, properties
- Image clips: dimensions, aspect ratio, opacity, effects, speed
- Shape clips: fill, stroke, rotation, size, properties
- Storyboard clips: scene, panel, dialogue, style (see §3.7)
- Generated Asset clips: type, upscale factor, quality (if applicable)

**Investigation:**
```bash
# Search for clip type discrimination
grep -rn "clip.type\|clipType\|VideoClip\|AudioClip\|TextClip" \
  apps/web/src/components/editor --include="*.tsx" | head -30

# Look for inspector content by clip type
grep -rn "if.*clip.type\|switch.*clip.type\|ClipType.*===" \
  apps/web/src/components/editor --include="*.tsx" | head -30
```

**What to Verify:**
- [ ] Inspector tab shows different metadata for each clip type
- [ ] Edit tab shows different properties for each clip type
- [ ] Sub-tabs appear below main tab switcher (e.g., "Format", "Effects", "Animation" sub-tabs under Edit)
- [ ] All clip types listed in spec have corresponding inspector/edit content

---

### 3. CRITICAL: Character Pill System (Spec §3.8 — NOT IMPLEMENTED)

**Spec Requirement:** Character metadata editing UI (pills/tags for character names, voice, costume, etc.)

**Investigation:**
```bash
# Search for character pill components
grep -rn "character\|pill" apps/web/src/components/editor --include="*.tsx" -i | head -20
grep -rn "CharacterPill\|character.*pill" apps/web/src --include="*.tsx" -i | head -20
```

**Expected Finding:** Subagent noted this is "not implemented" — likely a TOD or missing entirely.

**What to Verify:**
- [ ] Is the character pill system implemented?
- [ ] If not, note as a "Not Implemented" task in the plan

---

### 4. Metadata Inspector Content (Spec §3.6)

**Spec Requirement:** Display clip metadata in a structured format (name, duration, tags, source, created date, etc.)

**Investigation:**
```bash
# Search for metadata display
grep -rn "metadata\|Metadata" apps/web/src/components/editor/inspector --include="*.tsx" | head -30

# Look for read-only property display
grep -rn "readOnly\|disabled.*input" apps/web/src/components/editor/inspector --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Metadata is displayed in Inspector tab
- [ ] Metadata is read-only (no editing in Inspector tab)
- [ ] All metadata fields match spec (name, duration, tags, source, created date, codec, resolution, etc. as applicable)

---

### 5. Edit Tab Property Editing (Spec §3.5)

**Spec Requirement:** Live editing of clip properties with real-time preview

**Investigation:**
```bash
# Search for property form/editor
grep -rn "Edit\|PropertyEditor\|SettingsPanel" apps/web/src/components/editor --include="*.tsx" | head -30

# Look for onChange handlers (likely triggering preview updates)
grep -rn "onChange\|onPropertyChange" apps/web/src/components/editor --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Edit tab contains form inputs for clip properties
- [ ] Changes apply immediately (or on-blur for performance)
- [ ] Preview updates in real-time as properties change
- [ ] Properties per clip type match spec requirements

---

### 6. Problems Tab Integration (Spec §3.10)

**Spec Requirement:** Problems tab shows problems for the current clip (if any)

**Investigation:**
```bash
# Search for Problems panel integration
grep -rn "Problems\|ProblemKind\|problemBus" apps/web/src/components/editor --include="*.tsx" | head -30

# Check if Problems tab filters by selected clip
grep -rn "selectedClip\|currentClip.*problem" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Problems tab exists and renders
- [ ] Problems are filtered for the current clip (if multi-clip problems possible)
- [ ] Resolve actions are available in Problems tab
- [ ] Problems subsystem integration is working (this is owned by problems-errors-logging plan, but inspector references it)

---

### 7. Log Tab Implementation (Spec §3.11)

**Spec Requirement:** Read-only log viewer with optional filtering/search

**Investigation:**
```bash
# Search for Log tab
grep -rn "Log\|LogPane\|LogViewer" apps/web/src/components/editor --include="*.tsx" | head -30

# Check for log store
grep -rn "logStore\|useLogStore\|getLogStore" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Log tab exists and shows log entries
- [ ] Log is read-only (append-only)
- [ ] Optional search/filter works
- [ ] Log entries show timestamp, level, message
- [ ] Log size/retention limits are applied

---

### 8. Update Triggers (Spec §3.12)

**Spec Requirement:** Inspector updates when:
- Clip is selected (selection change)
- Clip property is edited (from Edit tab)
- Clip duration/timing changes (from timeline drag)
- Clip content changes (from media update)

**Investigation:**
```bash
# Search for selection change handlers
grep -rn "onSelect\|selectedClip\|clipSelected" apps/web/src --include="*.tsx" | head -30

# Look for reactive updates
grep -rn "useEffect\|useMemo.*selectedClip" apps/web/src/components/editor --include="*.tsx" | head -30
```

**What to Verify:**
- [ ] Inspector re-renders when selection changes
- [ ] Inspector updates live as properties are edited
- [ ] No stale data displayed

---

## Plan Document Structure

Write `docs/superpowers/plans/2026-07-05-inspector-shell-completion.md` with:

### 1. **Goal Statement**
Brief description of the inspector shell's role in the project workflow.

### 2. **Current State vs. Spec (Table)**

Create a comprehensive table summarizing implementation status:

| Spec Section | Feature | Status | Notes |
|---|---|---|---|
| §1 | 4-tab layout | ✅/❌ | Verify all 4 tabs exist... |
| §2 | Tab switching | ? | Check tab state persistence... |
| §3.1–3.5 | Inspector/Edit tabs | ? | Verify content for each clip type... |
| §3.6 | Metadata display | ? | Is read-only metadata shown?... |
| §3.7 | Storyboard inspector | ? | Special handling for storyboard clips?... |
| §3.8 | Character pill system | ❌ | Not implemented (per subagent finding) |
| §3.9 | Asset inspector | ? | Asset-specific metadata display?... |
| §3.10 | Problems tab | ? | Integration with problems subsystem?... |
| §3.11 | Log tab | ? | Log viewer with filtering?... |
| §3.12 | Update triggers | ? | Inspector responsive to selection/edits?... |

### 3. **Architecture / Tech Stack**

Overview of how the inspector panel is structured (container component, tab router, clip-type dispatcher, Zustand state for selected clip, etc.)

### 4. **File Map (Table)**

List all files to create/modify:

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/components/editor/InspectorPanel.tsx` (or similar) | Modify | [4-tab layout, routing] |
| `apps/web/src/components/editor/inspector/InspectorTab.tsx` | Modify | [Metadata display] |
| `apps/web/src/components/editor/inspector/EditTab.tsx` | Modify | [Property editing] |
| `apps/web/src/components/editor/inspector/ProblemsTab.tsx` | Verify | [Problems subsystem integration] |
| `apps/web/src/components/editor/inspector/LogTab.tsx` | Verify | [Log viewer] |
| `apps/web/src/components/editor/inspector/clips/VideoClipInspector.tsx` | Create/Modify | [Video-specific content] |
| `apps/web/src/components/editor/inspector/clips/AudioClipInspector.tsx` | Create/Modify | [Audio-specific content] |
| `apps/web/src/components/editor/inspector/clips/TextClipInspector.tsx` | Create/Modify | [Text-specific content] |
| `apps/web/src/components/editor/inspector/clips/StoryboardClipInspector.tsx` | Create/Modify | [Storyboard-specific content] |
| `apps/web/src/components/editor/inspector/CharacterPillEditor.tsx` | Create | [Character pill system (NOT YET IMPLEMENTED)] |
| ... | ... | ... |

### 5. **Numbered Tasks**

For each gap/item, create a task:

```markdown
## Task N: [Task Title — e.g., "Implement Character Pill System"]

**Files:**
- Create: `apps/web/src/components/editor/inspector/CharacterPillEditor.tsx`
- Modify: `apps/web/src/components/editor/inspector/EditTab.tsx`

**Steps:**

- [ ] **Step 1: Define character pill data structure**

```typescript
interface CharacterPill {
  id: string;
  name: string;
  voice?: string;
  costume?: string;
  // ... other fields from spec §3.8
}
```

- [ ] **Step 2: Create CharacterPillEditor component**

```typescript
// apps/web/src/components/editor/inspector/CharacterPillEditor.tsx
export function CharacterPillEditor({ clip }: { clip: Clip }) {
  // Render pills for character metadata
  // Allow adding/removing/editing pills
  // Save changes back to clip
}
```

- [ ] **Step 3: Integrate into EditTab for clip types that support characters**

```typescript
// In apps/web/src/components/editor/inspector/EditTab.tsx
if (clip.type === "text" || clip.type === "storyboard") {
  return <CharacterPillEditor clip={clip} />;
}
```

- [ ] **Verification:**
```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web lint
```

- [ ] **Commit:**
```bash
git add apps/web/src/components/editor/inspector/
git commit -m "feat(inspector): implement character pill system for text/storyboard clips"
```
```

### 6. **Size/Complexity Estimate**

L (large) — inspector is complex with multiple clip types, sub-tabs, and integration points.

---

## Known Issues to Document

1. **Character Pill System NOT IMPLEMENTED** — Spec §3.8 requires character metadata editing (name, voice, costume). This is a new component that needs to be built.

2. **Sub-Tab System Clarity** — Verify that sub-tabs (under Edit tab, e.g., "Format", "Effects", "Animation") are clearly defined for each clip type.

3. **Problems/Log Tab Ownership** — These tabs reference other subsystems; verify integration points but do not re-implement those subsystems in this plan.

---

## Completion Checklist

- [ ] Spec read in full
- [ ] All 8 investigations above completed
- [ ] Current State vs. Spec table filled in
- [ ] Character pill system status confirmed (NOT IMPLEMENTED)
- [ ] File map created (including CharacterPillEditor.tsx for new component)
- [ ] All numbered tasks written with:
  - [ ] Files subsection
  - [ ] Steps subsection (checkboxes)
  - [ ] Code examples where helpful
  - [ ] Verification commands
  - [ ] Git commit step
- [ ] Size/complexity estimate provided
- [ ] Known issues documented (especially character pill system)
- [ ] Document matches tone/structure of existing plans
- [ ] No application source files modified
- [ ] Plan file written to `docs/superpowers/plans/2026-07-05-inspector-shell-completion.md`

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Ready for investigator:** Yes  
**Critical Note:** Character pill system is not yet implemented; this is a significant scope item.  
**Next:** Submit plan document; supervisor will verify completeness
