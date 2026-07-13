# Project Lifecycle UX Implementation Findings

## Current State (Audited 2026-07-13 16:16 AEST)

**Document type:** HISTORICAL FINDINGS, NOT AN EXECUTABLE PLAN. Canonical owner: [Project Lifecycle and Persistence](../../spec/project.md). The original completion percentage is superseded.

| Area | Current state |
|---|---|
| Picker/list/create/load/rename/delete | Routes and UI surfaces exist with targeted tests. |
| Backend identity | Nonconformant: local UUID is marked explicitly created before asynchronous backend identity replacement. |
| Save-state presentation | Backend save queue and error reporting exist; canonical queued/persisting/confirmed/conflict states are not completely modeled. |
| Git history/restore | Implemented in backend routes/services; browser restore evidence is incomplete. |
| Conflict/destructive intent | Not implemented. |
| Offline draft/reconciliation | Incomplete; local UUID fallback is not the canonical identity-less draft flow. |
| Browser lifecycle matrix | Not recorded for create, failure, reload, rename, delete, restore, and conflict. |

**Next action:** execute project-save Tasks 8-12A and rewrite creation identity before a UX-completion claim.

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/project-lifecycle.md`  
**Related Plan:** `2026-07-01-backend-autosave-git-lfs.md` (backend persistence)

---

## Summary

Project lifecycle UX **substantially implemented**. Backend persistence handled separately.

---

## Key Areas to Verify

1. **Welcome Screen (§2)**
   - [ ] Landing page for new users
   - [ ] Create new project button
   - [ ] Open recent projects list
   - [ ] Open from file option

2. **Project Creation Wizard (§3)**
   - [ ] Dialog/form exists
   - [ ] Project name input
   - [ ] Dimensions/preset selection
   - [ ] Frame rate input
   - [ ] Audio settings (sample rate, channels, bitrate)
   - [ ] Validation (name not empty, valid dimensions)

3. **Project Picker/Browser (§4)**
   - [ ] List view of projects
   - [ ] Search by name
   - [ ] Sort by date, name
   - [ ] Delete with confirmation
   - [ ] Open on click

4. **Project Renaming (§5)**
   - [ ] Inline or modal rename
   - [ ] Validation (no duplicates, not empty)

5. **Project Deletion (§6)**
   - [ ] Confirmation dialog
   - [ ] Irreversibility warning

6. **Project Settings Panel (§7)**
   - [ ] Dimensions editable
   - [ ] Frame rate editable
   - [ ] Color space, gamma settings
   - [ ] Audio defaults editable
   - [ ] Export presets editable

7. **Recent Projects List (§8)**
   - [ ] Persistent across sessions
   - [ ] Max count enforced
   - [ ] Reverse chronological order
   - [ ] No duplicates

8. **Project Load UX (§9)**
   - [ ] Loading indicator
   - [ ] Error handling
   - [ ] Cancel option

9. **State Indicators (§10)**
   - [ ] Unsaved changes indicator
   - [ ] Autosave status display
   - [ ] Backend sync status (if applicable)

---

## Scope Boundary

**This plan:** Frontend UX only (dialogs, forms, screens, user interaction)

**Backend plan:** Persistence, autosave, Git/LFS, database (2026-07-01-backend-autosave-git-lfs.md)

---

## Files to Examine

- `apps/web/src/screens/WelcomeScreen.tsx` (or similar)
- `apps/web/src/components/projects/CreateProjectDialog.tsx` (or similar)
- Project picker/browser component
- Project settings component
- Recent projects store

---

**Handoff Status:** 20% investigated. Medium priority (onboarding important).
