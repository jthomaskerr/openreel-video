# Handoff: Project Lifecycle UX Plan

**Task:** Write `docs/superpowers/plans/2026-07-05-project-lifecycle-ux.md`  
**Spec:** `docs/spec/project-lifecycle.md`  
**Related Plan:** `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md` (covers backend persistence; this plan covers FRONTEND UX only)  
**Status:** Ready for investigator — subagent failed at rate limit before completion

---

## Investigation Scope

### Spec Sections to Cover

Read the entire project-lifecycle spec in `docs/spec/project-lifecycle.md`. Key areas:

- **Welcome Screen:** New user onboarding (create project, open recent, open from file)
- **Project Creation Wizard:** Step-by-step flow to create new project (name, dimensions, frame rate, etc.)
- **Project Picker/Browser:** List recent projects, search, delete from picker
- **Project Renaming:** Inline or modal rename
- **Project Deletion:** Confirmation dialog, cleanup logic
- **Project Settings Panel:** Edit project-level properties (dimensions, frame rate, aspect ratio, default audio settings, export presets)
- **Recent Projects List:** Persistence, sorting, max count
- **Project Open/Load:** Loading state, error handling
- **Project State Display:** "Unsaved changes", autosave status, sync status with backend

### Current Implementation Files

Search for project-related UI in `apps/web/src/`:

```bash
find apps/web/src -name "*project*" -o -name "*Project*" | grep -i "component\|screen\|dialog" | head -20
grep -r "useProject\|ProjectStore\|projectStore" apps/web/src --include="*.tsx" | head -20
grep -r "createProject\|newProject\|openProject" apps/web/src --include="*.tsx" | head -20
```

**Expected files:**
- Welcome/landing screen
- Project picker/browser
- Project creation dialog/wizard
- Project settings panel
- Project deletion confirmation
- Recent projects list

---

## CRITICAL: Scope Boundary with Backend-Autosave-Git-LFS Plan

**Important:** Do NOT duplicate the scope of `2026-07-01-backend-autosave-git-lfs.md`.

**Investigation:**
```bash
# Read the backend-autosave-git-lfs plan to understand what it covers
cat docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md | head -200
# Look for "project" or "persistence" mentions
grep -i "project\|persistence\|save\|backend" docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md | head -30
```

**What to Determine:**
- [ ] Does backend-autosave plan cover project creation/deletion backend?
- [ ] Does it cover file persistence logic?
- [ ] Does it cover database/storage layer?
- [ ] **This plan should cover:** ONLY the FRONTEND UX (dialogs, forms, screens, user interaction), NOT the backend save logic

**Document the boundary clearly:** "This plan covers FRONTEND project lifecycle UX only (create dialog, rename, delete confirmation, project picker, settings panel). Backend persistence (autosave, Git/LFS, database) is covered in 2026-07-01-backend-autosave-git-lfs.md."

---

## Key Investigations Required

### 1. Welcome Screen (Spec §2)

**Spec Requirement:** Landing page for new users with options:
- Create new project (button)
- Open recent project (list)
- Open from file (file picker)
- Help/documentation (optional)

**Investigation:**
```bash
# Search for welcome/landing screen
grep -rn "Welcome\|Landing\|WelcomeScreen\|onboarding" apps/web/src --include="*.tsx" | head -20

# Look for recent projects display
grep -rn "RecentProjects\|recents\|lastOpened" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Welcome screen exists
- [ ] All 3 (or 4) entry points available
- [ ] Recent projects list populated
- [ ] Open from file works

---

### 2. Project Creation Wizard (Spec §3)

**Spec Requirement:** Multi-step or single-form flow to create project:
- Project name (required)
- Dimensions / preset (default: 1920×1080)
- Frame rate (default: 30 fps)
- Aspect ratio (calculated from dimensions)
- Default audio settings (sample rate, channels, bitrate)
- Optional: Color space, gamma, proxy settings

**Investigation:**
```bash
# Search for project creation dialog
grep -rn "CreateProject\|NewProject\|createProject" apps/web/src --include="*.tsx" | head -30

# Look for form inputs (name, dimensions, frame rate)
grep -rn "projectName\|dimensions\|frameRate\|aspectRatio" apps/web/src --include="*.tsx" | head -30

# Search for project presets (1080p, 4K, etc.)
grep -rn "preset\|1920\|3840\|1080\|2160" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Project creation dialog/form exists
- [ ] All required fields: name, dimensions, frame rate
- [ ] Optional fields: aspect ratio (auto), audio settings, presets
- [ ] Validation (name not empty, dimensions valid, etc.)
- [ ] Success → project created, UI navigates to editor

---

### 3. Project Picker/Browser (Spec §4)

**Spec Requirement:** List view of projects with:
- Project name, thumbnail (if available), last modified date
- Search/filter by name
- Sort by date, name
- Delete option (with confirmation)
- Open on click

**Investigation:**
```bash
# Search for project list/picker
grep -rn "ProjectList\|ProjectBrowser\|ProjectPicker\|projectList" apps/web/src --include="*.tsx" | head -20

# Look for search/filter
grep -rn "search\|filter.*project" apps/web/src --include="*.tsx" | head -20

# Search for delete confirmation
grep -rn "deleteProject\|ConfirmDelete\|DeleteConfirm" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Project list displays
- [ ] Search works
- [ ] Sort options available (date, name)
- [ ] Delete with confirmation
- [ ] Open on click navigates to editor

---

### 4. Project Renaming (Spec §5)

**Spec Requirement:** Inline or modal rename flow (probably inline by double-click or rename button)

**Investigation:**
```bash
# Search for rename logic
grep -rn "rename\|RenameProject\|editName" apps/web/src --include="*.tsx" | head -20

# Look for inline edit or modal
grep -rn "ContentEditable\|inlineEdit\|editMode" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Rename UI exists (inline or modal)
- [ ] Validation (name not empty, no duplicates)
- [ ] Undo/cancel option
- [ ] Confirmation (save on enter or click)

---

### 5. Project Deletion (Spec §6)

**Spec Requirement:** Confirmation dialog before delete (warning about irreversible deletion)

**Investigation:**
```bash
# Search for delete flow
grep -rn "deleteProject\|confirmDelete\|DeleteDialog" apps/web/src --include="*.tsx" | head -20

# Look for confirmation UI
grep -rn "ConfirmDialog\|AlertDialog\|areYouSure" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Delete confirmation dialog exists
- [ ] Warning text clear about irreversibility
- [ ] Delete button prominent, cancel button available
- [ ] After delete: project removed from list, UI updates

---

### 6. Project Settings Panel (Spec §7)

**Spec Requirement:** Edit project-level properties:
- Dimensions (width, height, aspect ratio presets)
- Frame rate
- Color space, gamma
- Default audio settings (sample rate, channels, bitrate)
- Export presets

**Investigation:**
```bash
# Search for project settings
grep -rn "ProjectSettings\|settings.*panel\|projectSettings" apps/web/src --include="*.tsx" | head -20

# Look for setting inputs
grep -rn "frameRate.*input\|dimensions.*input\|colorSpace" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Settings panel accessible (menu, button, or project menu)
- [ ] All editable fields present
- [ ] Changes apply immediately or on save
- [ ] Validation (e.g., frame rate >= 1 fps)
- [ ] Undo if changes reverted (if applicable)

---

### 7. Recent Projects List (Spec §8)

**Spec Requirement:** Persistent list of recently opened projects (max 10?)

**Investigation:**
```bash
# Search for recent projects storage
grep -rn "recentProjects\|lastOpened\|MRU" apps/web/src --include="*.tsx" | head -20

# Check for localStorage/persistence
grep -rn "localStorage\|sessionStorage\|persisted.*recent" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Recent projects list populated from persistent storage
- [ ] Order is reverse chronological (most recent first)
- [ ] Max count enforced (if spec defines one)
- [ ] Duplicates avoided (only unique projects)

---

### 8. Project Open/Load UX (Spec §9)

**Spec Requirement:** Loading state UI, error handling, progress indication

**Investigation:**
```bash
# Search for loading state
grep -rn "isLoading\|loading.*project\|LoadingSpinner" apps/web/src --include="*.tsx" | head -20

# Look for error handling
grep -rn "loadError\|openError\|errorMessage" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Loading spinner/indicator shown during open
- [ ] Estimated time remaining displayed (if applicable)
- [ ] Cancel option available during load
- [ ] Error message clear if load fails

---

### 9. Project State Display (Spec §10)

**Spec Requirement:** UI indicators for:
- Unsaved changes (dot/asterisk in title, warning on close)
- Autosave status (e.g., "Saving..." → "Saved at 3:45 PM")
- Backend sync status (if applicable)

**Investigation:**
```bash
# Search for unsaved indicator
grep -rn "unsaved\|modified\|isDirty\|hasChanges" apps/web/src --include="*.tsx" | head -20

# Look for autosave status
grep -rn "autosave\|Saving\|Saved" apps/web/src --include="*.tsx" | head -20
```

**What to Verify:**
- [ ] Unsaved indicator visible (title bar, tab, etc.)
- [ ] Autosave status displayed
- [ ] Warn user on close if unsaved
- [ ] Sync status shown (if backend applicable)

---

## Plan Document Structure

Write `docs/superpowers/plans/2026-07-05-project-lifecycle-ux.md` with:

### 1. **Goal Statement**
Overview of project lifecycle UX and its role in user onboarding and project management.

### 2. **Scope Boundary**
**Explicitly state:** "This plan covers FRONTEND project lifecycle UX only (welcome screen, create dialog, picker, rename, delete confirmation, settings panel, state indicators). Backend persistence and autosave logic is covered in 2026-07-01-backend-autosave-git-lfs.md."

### 3. **Current State vs. Spec (Table)**

| Spec Section | Feature | Status | Notes |
|---|---|---|---|
| §2 | Welcome screen | ? | All 3–4 entry points?... |
| §3 | Create project wizard | ? | All fields (name, dims, FPS)?... |
| §4 | Project picker/browser | ? | List, search, sort, delete?... |
| §5 | Project rename | ? | Inline or modal?... |
| §6 | Project delete confirmation | ? | Warning dialog clear?... |
| §7 | Settings panel | ? | All editable fields?... |
| §8 | Recent projects list | ? | Persistent, max count?... |
| §9 | Load UX | ? | Loading indicator, error handling?... |
| §10 | State indicators | ? | Unsaved/autosave/sync status?... |

### 4. **Architecture / Tech Stack**

Overview of project lifecycle management (state store, UI components, routing, recent projects persistence).

### 5. **File Map (Table)**

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/screens/WelcomeScreen.tsx` | Create/Modify | Welcome/onboarding |
| `apps/web/src/components/projects/CreateProjectDialog.tsx` | Create/Modify | Project creation |
| `apps/web/src/components/projects/ProjectPicker.tsx` | Create/Modify | Project browser/list |
| `apps/web/src/components/projects/ProjectRenameDialog.tsx` | Create/Modify | Rename modal |
| `apps/web/src/components/projects/ProjectDeleteConfirm.tsx` | Create/Modify | Delete confirmation |
| `apps/web/src/components/projects/ProjectSettingsPanel.tsx` | Create/Modify | Settings |
| `apps/web/src/hooks/useProjectLifecycle.ts` | Create/Modify | Lifecycle logic |
| `apps/web/src/stores/recentProjectsStore.ts` | Create/Modify | Recent projects persistence |
| ... | ... | ... |

### 6. **Numbered Tasks**

Example task structure:

```markdown
## Task N: Implement Project Creation Wizard

**Files:**
- Create: `apps/web/src/components/projects/CreateProjectDialog.tsx`
- Modify: `apps/web/src/hooks/useProjectLifecycle.ts`

**Steps:**

- [ ] **Step 1: Design project creation form**

Form fields:
- Project name (text input, required)
- Dimensions preset (dropdown: 1080p, 4K, custom)
- Frame rate (number input, default 30)
- Aspect ratio (auto-calculated, display only)
- Default audio: sample rate, channels, bitrate

- [ ] **Step 2: Create CreateProjectDialog component**

```typescript
// apps/web/src/components/projects/CreateProjectDialog.tsx
export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  // Form state, validation, submit handler
}
```

- [ ] **Step 3: Add validation**

```typescript
// Validate:
// - name is not empty
// - name is <= 255 chars
// - dimensions are valid (> 0)
// - frame rate is 1–120 fps
```

- [ ] **Step 4: Implement submit**

Calls backend to create project, then navigates to editor.

- [ ] **Verification:**
```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
```

- [ ] **Commit:**
```bash
git add apps/web/src/components/projects/CreateProjectDialog.tsx
git commit -m "feat(project): implement project creation wizard"
```
```

### 7. **Size/Complexity Estimate**

L (large) — project lifecycle UX is complex with many entry points, forms, dialogs, and state management.

---

## Scope Boundary Example

Include a clear statement like:

```markdown
## Scope Boundary: Backend Persistence

This plan covers **FRONTEND project lifecycle UX only**.

The **2026-07-01-backend-autosave-git-lfs.md** plan covers:
- Autosave logic and timing
- Project file persistence (Git/LFS)
- Database/storage layer
- Sync between client and server

This plan focuses only on user-facing screens and dialogs:
- Welcome screen
- Create project dialog
- Project picker/browser
- Rename/delete UX
- Settings panel
- State indicators

Do NOT implement backend saving logic here; it's handled by the autosave plan.
```

---

## Completion Checklist

- [ ] Spec read in full
- [ ] backend-autosave-git-lfs plan read to understand boundary
- [ ] All 9 investigations above completed
- [ ] Scope boundary clearly stated
- [ ] Current State vs. Spec table filled in
- [ ] File map created
- [ ] All numbered tasks written with checkboxes, code, verification, commits
- [ ] Size/complexity estimate provided
- [ ] Document matches tone/structure of existing plans
- [ ] No application source files modified
- [ ] Plan file written to `docs/superpowers/plans/2026-07-05-project-lifecycle-ux.md`

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Ready for investigator:** Yes  
**Critical:** Read backend-autosave-git-lfs plan first to understand scope boundary  
**Next:** Submit plan document; supervisor will verify completeness and boundary
