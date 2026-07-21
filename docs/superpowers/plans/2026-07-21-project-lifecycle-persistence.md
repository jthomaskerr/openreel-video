# Project Lifecycle Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the demonstrated project lifecycle safety gaps while retaining the existing canonical persistence implementation.

**Architecture:** `@openreel/core` supplies one pure version/shape/identity decoder used by portable files and recovery. The web store continues to assemble editor state, `BackendSaveService` keeps saves bound to their captured project identity, and focused Radix dialogs obtain explicit replacement/conflict decisions. The orchestrator transaction and Git history remain unchanged.

**Tech Stack:** TypeScript 5.9, React 18, Zustand 4, Radix dialogs through `@openreel/ui`, Vitest, Testing Library, Playwright, Node test runner.

## Global Constraints

- Managed workspace storage remains the canonical durable destination.
- A failed open, migration, recovery, or save leaves the current active and durable states unchanged.
- Explicit save reports success only after `BackendSaveService.save(fullProject, "user")` resolves; `user` is the existing explicit-save intent.
- Project-scoped work is keyed by stable project identity and cannot update another active project.
- Missing media remains explicit and is never silently removed.
- No automatic merge/diff resolver, independent worker, cross-session notification, packaged-media export, or named durable snapshot restoration.
- Every behavioral correction starts with a deterministic failing regression test.
- User-visible errors identify the project/source and a corrective action; dialog errors use `role="alert"`.

---

## File Map

- `packages/core/src/storage/project-file.ts`: pure file/recovery envelope decode, version comparison, shape and identity checks.
- `packages/core/src/storage/project-file.test.ts`: current, legacy, future, malformed, and identity tests.
- `packages/core/src/storage/project-serializer.ts`: use the pure decoder and current envelope encoder.
- `packages/core/src/storage/project-serializer.test.ts`: portable round-trip and migration tests.
- `packages/core/src/storage/index.ts` and/or `packages/core/src/index.ts`: export the new contract through the existing storage barrel.
- `apps/web/src/services/auto-save.ts`: typed events, propagated storage errors, validated recovery.
- `apps/web/src/services/auto-save.test.ts`: corruption, mismatch, storage failure, and identity regressions.
- `apps/web/src/services/backend-save.ts`: project-keyed pending snapshots, revisions, retries, and active-only status projection.
- `apps/web/src/services/backend-save.test.ts`: two-project scheduling and explicit-save regressions.
- `apps/web/src/services/project-manager.ts`: versioned serializer for every file picker/recent/download path.
- `apps/web/src/services/project-manager.test.ts`: portable current/legacy/future validation and non-mutating failure.
- `apps/web/src/stores/persistence-status-store.ts`: pure authoritative dirty-state selector.
- `apps/web/src/stores/persistence-status-store.test.ts`: dirty-state truth table.
- `apps/web/src/stores/project-store.ts`: identity-aware autosave callback, complete awaited explicit save, unsaved recovery install.
- `apps/web/src/stores/project-store.test.ts` and `apps/web/src/hooks/useProjectRecovery.test.ts`: store-level save/recovery regressions.
- `apps/web/src/stores/project-transition-store.ts`: one promise-backed Save/Discard/Cancel request.
- `apps/web/src/components/editor/ProjectTransitionDialog.tsx`: accessible project replacement dialog.
- `apps/web/src/components/editor/PersistenceConflictDialog.tsx`: export-local/reload-server recovery dialog.
- `apps/web/src/components/editor/ProjectManagerDialog.tsx`, `ProjectSwitcher.tsx`, and `Toolbar.tsx`: invoke the guard and surface source failures.
- matching `*.test.tsx` files: interaction, error, focus/disabled-state regressions.
- `apps/web/e2e/project-lifecycle.spec.ts`: browser-level create/save/switch/conflict/recovery/import evidence.

### Task 1: Add one versioned project-file decoder

**Files:**
- Create: `packages/core/src/storage/project-file.ts`
- Create: `packages/core/src/storage/project-file.test.ts`
- Modify: `packages/core/src/storage/project-serializer.ts`
- Modify: `packages/core/src/storage/project-serializer.test.ts`
- Modify: `packages/core/src/storage/index.ts`

**Interfaces:**
- Produces: `decodeProjectFile(json, options): ProjectFileDecodeResult`, `encodeProjectFile(project): string`, `CURRENT_PROJECT_FILE_VERSION`.
- Consumed by: `ProjectSerializer`, autosave recovery, and web file import/export.

- [ ] **Step 1: Write failing decoder tests**

```ts
import type { Project } from "../types";
import { describe, expect, it } from "vitest";
import { decodeProjectFile, encodeProjectFile } from "./project-file";

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: "project",
    name: "Project",
    createdAt: 1,
    modifiedAt: 2,
    settings: { width: 1920, height: 1080, frameRate: 30 },
    timeline: { duration: 0, tracks: [], markers: [], subtitles: [] },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    ...overrides,
  } as Project;
}

describe("project file contract", () => {
  it("round-trips the current 1.0.0 envelope", () => {
    const project = projectFixture({ id: "alpha" });
    expect(decodeProjectFile(encodeProjectFile(project))).toEqual({
      ok: true,
      project,
      sourceVersion: "1.0.0",
      migrated: false,
    });
  });

  it("migrates the shipped raw-project format without mutating the source", () => {
    const project = projectFixture({ id: "legacy" });
    const { generatedImageDefinitions: _removed, ...legacyProject } = project;
    const source = JSON.stringify(legacyProject);
    const decoded = decodeProjectFile(source);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.sourceVersion).toBe("0.0.0");
      expect(decoded.migrated).toBe(true);
      expect(decoded.project.generatedImageDefinitions).toEqual([]);
    }
    expect(source).toBe(JSON.stringify(legacyProject));
  });

  it.each(["1.0.1", "1.1.0", "2.0.0"])("rejects unsupported future version %s", (version) => {
    const decoded = decodeProjectFile(JSON.stringify({ version, project: projectFixture() }));
    expect(decoded).toMatchObject({ ok: false, code: "UNSUPPORTED_VERSION" });
  });

  it("rejects incomplete shape and an expected identity mismatch", () => {
    expect(decodeProjectFile('{"id":"broken"}')).toMatchObject({ ok: false, code: "INVALID_PROJECT" });
    expect(decodeProjectFile(encodeProjectFile(projectFixture({ id: "alpha" })), { expectedProjectId: "beta" }))
      .toMatchObject({ ok: false, code: "PROJECT_ID_MISMATCH" });
  });
});
```

- [ ] **Step 2: Run the tests and confirm the contract is absent**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/storage/project-file.test.ts`

Expected: FAIL because `./project-file` does not exist.

- [ ] **Step 3: Implement the pure decoder and encoder**

```ts
import type { Project } from "../types";

export const CURRENT_PROJECT_FILE_VERSION = "1.0.0";

export type ProjectFileDecodeResult =
  | { ok: true; project: Project; sourceVersion: string; migrated: boolean }
  | { ok: false; code: "INVALID_JSON" | "INVALID_PROJECT" | "UNSUPPORTED_VERSION" | "PROJECT_ID_MISMATCH"; message: string };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function normalizeLegacy(value: Record<string, unknown>): Record<string, unknown> {
  return value.generatedImageDefinitions === undefined
    ? { ...value, generatedImageDefinitions: [] }
    : { ...value };
}

function isProjectShape(value: unknown): value is Project {
  if (!record(value) || !nonEmpty(value.id) || !nonEmpty(value.name)) return false;
  if (!finite(value.createdAt) || !finite(value.modifiedAt) || value.modifiedAt < value.createdAt) return false;
  if (!record(value.settings) || !finite(value.settings.width) || !finite(value.settings.height)
    || !finite(value.settings.frameRate) || value.settings.width <= 0 || value.settings.height <= 0
    || value.settings.frameRate <= 0) return false;
  if (!record(value.timeline) || !Array.isArray(value.timeline.tracks)
    || !Array.isArray(value.timeline.markers) || !Array.isArray(value.timeline.subtitles)) return false;
  if (!record(value.mediaLibrary) || !Array.isArray(value.mediaLibrary.items)) return false;
  return Array.isArray(value.generatedImageDefinitions);
}

export function encodeProjectFile(project: Project): string {
  return JSON.stringify({ version: CURRENT_PROJECT_FILE_VERSION, project }, null, 2);
}

export function decodeProjectFile(
  json: string,
  options: { expectedProjectId?: string } = {},
): ProjectFileDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, code: "INVALID_JSON", message: `Invalid project JSON: ${error instanceof Error ? error.message : "parse failed"}` };
  }
  if (!record(parsed)) return { ok: false, code: "INVALID_PROJECT", message: "Project file must contain an object" };

  const enveloped = "version" in parsed || "project" in parsed;
  const sourceVersion = enveloped ? parsed.version : "0.0.0";
  if (enveloped && sourceVersion !== CURRENT_PROJECT_FILE_VERSION) {
    return { ok: false, code: "UNSUPPORTED_VERSION", message: `Unsupported project version ${String(sourceVersion)}; this editor supports ${CURRENT_PROJECT_FILE_VERSION}` };
  }
  const candidate = normalizeLegacy((enveloped ? parsed.project : parsed) as Record<string, unknown>);
  if (!isProjectShape(candidate)) {
    return { ok: false, code: "INVALID_PROJECT", message: "Project data is incomplete or contains invalid settings, timestamps, timeline, or media collections" };
  }
  if (options.expectedProjectId && candidate.id !== options.expectedProjectId) {
    return { ok: false, code: "PROJECT_ID_MISMATCH", message: `Recovery belongs to ${candidate.id}, not ${options.expectedProjectId}` };
  }
  return { ok: true, project: candidate, sourceVersion: String(sourceVersion), migrated: !enveloped };
}
```

Update `ProjectSerializer.importFromJson`, `validateProjectJson`, and `exportToJson` to delegate to this contract before existing media normalization. Keep `SCHEMA_VERSION` as a deprecated alias if current callers import it.

- [ ] **Step 4: Run core regression tests**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/storage/project-file.test.ts src/storage/project-serializer.test.ts`

Expected: PASS; current envelope and raw legacy files succeed, future/invalid files fail.

- [ ] **Step 5: Commit the file contract**

```bash
rtk git add packages/core/src/storage/project-file.ts packages/core/src/storage/project-file.test.ts packages/core/src/storage/project-serializer.ts packages/core/src/storage/project-serializer.test.ts packages/core/src/storage/index.ts
rtk git commit -m "fix(core): validate and version project files"
```

### Task 2: Fail closed for recovery and keep restored state unsaved

**Files:**
- Modify: `apps/web/src/services/auto-save.ts`
- Modify: `apps/web/src/services/auto-save.test.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/hooks/useProjectRecovery.test.ts`

**Interfaces:**
- Consumes: `decodeProjectFile(json, { expectedProjectId })`.
- Produces: typed `AutoSaveSavedEvent`; `checkForRecovery()` rejects storage errors; recovery installs local dirty state without canonical write.

- [ ] **Step 1: Write failing recovery tests**

Add tests that assert: `checkForRecovery` rejects IndexedDB read failure; corrupt JSON throws an actionable recovery error; record/project identity mismatch throws; `recoverFromAutoSave` never calls `backendSaveService.save`; successful recovery preserves the confirmed base but installs the recovered `modifiedAt` and remains dirty.

```ts
await expect(manager.checkForRecovery()).rejects.toThrow("Failed to get saves");
await expect(manager.recover("alpha-slot-0", "alpha")).rejects.toThrow("Invalid project JSON");
await expect(manager.recover("alpha-slot-0", "alpha")).rejects.toThrow("belongs to beta, not alpha");
expect(vi.spyOn(backendSaveService, "save")).not.toHaveBeenCalled();
expect(useProjectStore.getState().project.modifiedAt).toBe(recovered.modifiedAt);
```

- [ ] **Step 2: Run focused tests and observe current swallowing/implicit save**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/auto-save.test.ts src/hooks/useProjectRecovery.test.ts`

Expected: FAIL because storage errors become `[]`, recovery casts unchecked JSON, and the store immediately saves to the backend.

- [ ] **Step 3: Implement typed events and validated recovery**

Define:

```ts
export interface AutoSaveSavedEvent { projectId: string; timestamp: number; slot: number }
type AutoSaveEventMap = {
  saved: AutoSaveSavedEvent;
  restored: { project: Project; timestamp: number };
  error: { error: unknown; message: string };
  recoveryAvailable: { saves: AutoSaveMetadata[] };
};
```

Remove the `checkForRecovery` catch that returns `[]`. In `recover`, decode `record.data` with both `record.projectId` and the optional requested identity, emit only after successful validation, and throw validation/storage failures after emitting `error`.

In `recoverFromAutoSave`, keep the authoritative `load` to establish `baseRevision`, merge locally stored blobs into matching recovered media items, call `loadProject(recoveredWithMedia)`, retain recovery data, and do not call `backendSaveService.save` or delete recovery media. The differing `modifiedAt` is the unsaved indicator.

- [ ] **Step 4: Run recovery suites**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/auto-save.test.ts src/hooks/useProjectRecovery.test.ts src/stores/project-store.test.ts`

Expected: PASS with visible propagated failures and no canonical write during restore.

- [ ] **Step 5: Commit recovery safety**

```bash
rtk git add apps/web/src/services/auto-save.ts apps/web/src/services/auto-save.test.ts apps/web/src/stores/project-store.ts apps/web/src/hooks/useProjectRecovery.test.ts
rtk git commit -m "fix(web): validate recovery before local restore"
```

### Task 3: Bind save scheduling to project identity and await explicit save

**Files:**
- Modify: `apps/web/src/services/backend-save.ts`
- Modify: `apps/web/src/services/backend-save.test.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/stores/project-store.test.ts`

**Interfaces:**
- Produces: project-keyed scheduled snapshots/retries/base revisions; `forceSave(): Promise<void>` resolves only after complete backend save.

- [ ] **Step 1: Write failing two-project and explicit-save tests**

```ts
service.scheduleSave(projectA, 0);
service.resetForProject(projectB.id);
service.scheduleSave(projectB, 0);
await vi.runAllTimersAsync();
expect(savedIds).toEqual([projectA.id, projectB.id]);

autoSaveSavedListener({ projectId: projectA.id, timestamp: 1, slot: 0 });
expect(scheduleSave).not.toHaveBeenCalledWith(expect.objectContaining({ id: projectB.id }), expect.anything());

const promise = useProjectStore.getState().forceSave();
expect(backendSaveService.save).toHaveBeenCalledWith(fullProject, "user");
await expect(promise).resolves.toBeUndefined();
```

Also reject the backend promise and assert `forceSave` rejects, persistence remains dirty, and runtime reporting names the project.

- [ ] **Step 2: Run focused tests and observe singleton rebinding**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/backend-save.test.ts src/stores/project-store.test.ts`

Expected: FAIL because `scheduledProject`, retry timers, and base revision are singleton state, and `forceSave` sends the incomplete snapshot without awaiting it.

- [ ] **Step 3: Implement project-keyed scheduling**

Replace singleton pending/timer/chain fields with maps keyed by project ID, and keep confirmed bases in a map populated by create/load/save receipts. Every timer closure captures its key. Add a helper that projects a background update into `usePersistenceStatusStore` only when that project is currently active. `resetForProject(activeId)` changes active projection and cancels nothing belonging to another project.

Use this concrete state shape:

```ts
interface ScheduledSaveState {
  project: Project;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  chain: Promise<void>;
}

private activeProjectId: string | null = null;
private scheduledSaves = new Map<string, ScheduledSaveState>();
private confirmedBases = new Map<string, ProjectBaseRevision>();
```

Change the autosave `saved` callback to inspect `AutoSaveSavedEvent.projectId`; do not read and schedule a different currently active project. Store subscription remains the immediate captured-snapshot path.

Change `forceSave` to:

```ts
forceSave: async () => {
  const fullProject = get().getFullProject();
  await autoSaveManager.forceSave(fullProject);
  try {
    await backendSaveService.save(fullProject, "user");
  } catch (error) {
    reportRuntimeError(`Backend force-save failed for ${fullProject.id}`, error, "backend-save.force-save");
    throw error;
  }
},
```

- [ ] **Step 4: Run scheduling and save suites**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/backend-save.test.ts src/stores/project-store.test.ts`

Expected: PASS; both project IDs save independently and explicit failure rejects.

- [ ] **Step 5: Commit project-bound persistence**

```bash
rtk git add apps/web/src/services/backend-save.ts apps/web/src/services/backend-save.test.ts apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts
rtk git commit -m "fix(web): bind persistence work to project identity"
```

### Task 4: Add one authoritative dirty selector and Save/Discard/Cancel gate

**Files:**
- Modify: `apps/web/src/stores/persistence-status-store.ts`
- Create: `apps/web/src/stores/persistence-status-store.test.ts`
- Create: `apps/web/src/stores/project-transition-store.ts`
- Create: `apps/web/src/components/editor/ProjectTransitionDialog.tsx`
- Create: `apps/web/src/components/editor/ProjectTransitionDialog.test.tsx`
- Modify: `apps/web/src/components/editor/ProjectManagerDialog.tsx`
- Modify: `apps/web/src/components/editor/ProjectSwitcher.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`

**Interfaces:**
- Produces: `isProjectDirty(project, status)`, `requestProjectTransition`, and `confirmProjectReplacement(targetLabel)`.

- [ ] **Step 1: Write dirty truth-table and dialog interaction tests**

Assert mismatched ID, timestamp, pending, failed, and recovered states are dirty; only matching confirmed durable state is clean. Render the dialog and assert Save awaits `forceSave`, Discard resolves immediately, Cancel/Escape resolves false, and save failure leaves the dialog open with `role="alert"`.

- [ ] **Step 2: Run the tests and confirm no gate exists**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/stores/persistence-status-store.test.ts src/components/editor/ProjectTransitionDialog.test.tsx`

Expected: FAIL because the selector, store, and dialog do not exist.

- [ ] **Step 3: Implement selector, request store, and dialog**

```ts
export function isProjectDirty(
  project: Pick<Project, "id" | "modifiedAt">,
  status: Pick<PersistenceStatusState, "projectId" | "phase" | "persistedModifiedAt">,
): boolean {
  return status.projectId !== project.id
    || status.phase !== "persisted"
    || status.persistedModifiedAt !== project.modifiedAt;
}
```

The transition store holds one `{ projectName, targetLabel, resolve }` request and exposes `choose("save" | "discard" | "cancel")`. The dialog uses existing `Dialog`, `Button`, and semantic tokens; Save is primary, Discard is destructive, Cancel is always available, all actions are disabled while saving, and save errors render with `role="alert"`.

Mount the dialog once beside `ProjectManagerDialog` in `Toolbar`. Before manager/switcher/file-import replacement, call the shared guard. Do not install or close anything when it resolves false. Start-from-scratch on the welcome route remains unchanged because no durable active editor session exists there.

- [ ] **Step 4: Run component and store suites**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/stores/persistence-status-store.test.ts src/components/editor/ProjectTransitionDialog.test.tsx src/components/editor/ProjectManagerDialog.test.tsx`

Expected: PASS for Save, Discard, Cancel, Escape, loading, and error states.

- [ ] **Step 5: Commit guarded project replacement**

```bash
rtk git add apps/web/src/stores/persistence-status-store.ts apps/web/src/stores/persistence-status-store.test.ts apps/web/src/stores/project-transition-store.ts apps/web/src/components/editor/ProjectTransitionDialog.tsx apps/web/src/components/editor/ProjectTransitionDialog.test.tsx apps/web/src/components/editor/ProjectManagerDialog.tsx apps/web/src/components/editor/ProjectSwitcher.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/ProjectManagerDialog.test.tsx
rtk git commit -m "fix(web): guard project replacement with dirty-state choices"
```

### Task 5: Surface stale-save recovery without semantic merge scope

**Files:**
- Create: `apps/web/src/components/editor/PersistenceConflictDialog.tsx`
- Create: `apps/web/src/components/editor/PersistenceConflictDialog.test.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Modify: `apps/web/src/stores/persistence-status-store.ts`

**Interfaces:**
- Consumes: existing `conflictingProject`, `projectManager.saveProjectAs`, `backendSaveService.load`, and `loadProject`.
- Produces: explicit export-local, reload-server, and keep-editing actions.

- [ ] **Step 1: Write failing conflict recovery tests**

Render phase `conflict` and assert the dialog names the project, shows local/server modification times and element counts, exports the local state without replacing it, reloads only after confirmation, and keeps the local project on cancel or load failure.

- [ ] **Step 2: Run the component test**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/PersistenceConflictDialog.test.tsx`

Expected: FAIL because the conflict state has no consumer.

- [ ] **Step 3: Implement the focused conflict dialog**

The dialog displays only stable summary differences: name, `modifiedAt`, timeline track/clip counts, and media count. It does not compute entity/field diffs. Actions:

```ts
const exportLocal = async () => {
  const saved = await projectManager.saveProjectAs(localProject);
  if (!saved) setError(`Local copy for ${localProject.id} was not exported. Try again before reloading.`);
};

const reloadDurable = async () => {
  const durable = await backendSaveService.load(localProject.id);
  if (!durable) throw new Error(`Could not reload newer durable project ${localProject.id}`);
  loadProject(durable);
};
```

Keep editing closes only the modal presentation; it does not clear the conflict or mark the project saved. Export/reload errors stay inline with `role="alert"`.

- [ ] **Step 4: Run conflict and backend-save tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/PersistenceConflictDialog.test.tsx src/services/backend-save.test.ts`

Expected: PASS; server state is never overwritten automatically.

- [ ] **Step 5: Commit conflict recovery UI**

```bash
rtk git add apps/web/src/components/editor/PersistenceConflictDialog.tsx apps/web/src/components/editor/PersistenceConflictDialog.test.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/stores/persistence-status-store.ts
rtk git commit -m "fix(web): expose safe stale-save recovery actions"
```

### Task 6: Route every portable file and chooser error through safe contracts

**Files:**
- Modify: `apps/web/src/services/project-manager.ts`
- Create: `apps/web/src/services/project-manager.test.ts`
- Modify: `apps/web/src/components/editor/ProjectManagerDialog.tsx`
- Modify: `apps/web/src/components/editor/ProjectManagerDialog.test.tsx`

**Interfaces:**
- Consumes: `ProjectSerializer` current envelope and decoder validation.
- Produces: versioned export, legacy import, future rejection, and visible per-source chooser errors with retry.

- [ ] **Step 1: Write failing portable-file and chooser tests**

Assert save handle and download emit a `1.0.0` envelope; open picker, fallback input, and recent handle all accept the raw legacy format through migration; invalid/future files reject without changing `currentFileHandle` or recent projects; autosave/recent/backend listing failures appear in an announced message and successful sources still render.

- [ ] **Step 2: Run tests and observe unchecked casts/silent catches**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/project-manager.test.ts src/components/editor/ProjectManagerDialog.test.tsx`

Expected: FAIL because `ProjectManager` serializes raw projects, import paths cast `JSON.parse`, and chooser failures are ignored.

- [ ] **Step 3: Implement serializer use and partial-source error display**

Create one serializer instance in `ProjectManager`. Replace `JSON.stringify(project)` with `serializer.exportToJson(project)` and every parse cast with `serializer.importFromJsonWithValidation(content)`. Throw a message joined from validation errors when no project is returned; set `currentFileHandle` and recent metadata only after success.

In `ProjectManagerDialog`, collect source results independently. A null backend list is a backend-source failure. Render available projects plus an inline `role="alert"` list such as `Could not load managed projects. Check that the orchestrator is running, then retry.` Add a Retry button that reruns the same loader. Never close the dialog after a failed open.

- [ ] **Step 4: Run portable and chooser suites**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/project-manager.test.ts src/components/editor/ProjectManagerDialog.test.tsx src/services/auto-save.test.ts`

Expected: PASS; no invalid candidate reaches `loadProject`.

- [ ] **Step 5: Commit safe portable files and visible discovery errors**

```bash
rtk git add apps/web/src/services/project-manager.ts apps/web/src/services/project-manager.test.ts apps/web/src/components/editor/ProjectManagerDialog.tsx apps/web/src/components/editor/ProjectManagerDialog.test.tsx
rtk git commit -m "fix(web): validate project copies and surface chooser failures"
```

### Task 7: Prove the complete lifecycle in deterministic suites and the browser

**Files:**
- Create: `apps/web/e2e/project-lifecycle.spec.ts`
- Modify: `specs/001-project-lifecycle/quickstart.md` only if verified commands differ.

**Interfaces:**
- Verifies all current-scope contracts; adds no production interface.

- [ ] **Step 1: Add the focused browser regression**

Use real UI controls and the local orchestrator to cover create/save/reload, dirty switch Save/Discard/Cancel, stale conflict export/reload, newer recovery restore as unsaved, and future/corrupt import rejection. Assert project names, status text, URL identity, dialog choices, and unchanged timeline markers rather than only page load.

- [ ] **Step 2: Run all deterministic gates**

```bash
rtk pnpm --filter @openreel/core exec vitest run src/storage/project-file.test.ts src/storage/project-serializer.test.ts
rtk pnpm --filter @openreel/web exec vitest run src/services/backend-save.test.ts src/services/auto-save.test.ts src/services/project-manager.test.ts src/stores/persistence-status-store.test.ts src/stores/project-store.test.ts src/hooks/useProjectRecovery.test.ts src/components/editor/ProjectManagerDialog.test.tsx src/components/editor/ProjectTransitionDialog.test.tsx src/components/editor/PersistenceConflictDialog.test.tsx
rtk node --import tsx --test apps/orchestrator/src/projects/routes.test.ts apps/orchestrator/src/projects/save-transaction.test.ts apps/orchestrator/src/projects/git-store-migration.test.ts
rtk pnpm --dir apps/web exec tsc --noEmit
```

Expected: all commands exit 0 with no lifecycle test skipped.

- [ ] **Step 3: Start the application and reproduce every UI scenario**

Run the repository development command on port 5173 with the orchestrator. Open the app in the browser, execute the seven scenarios in `specs/001-project-lifecycle/quickstart.md`, and capture exact pass/fail evidence. Verify keyboard Escape/Tab behavior and both normal and narrow viewport layouts for the new dialogs.

- [ ] **Step 4: Run the Playwright regression**

Run: `rtk pnpm --filter @openreel/web exec playwright test e2e/project-lifecycle.spec.ts --project=chromium`

Expected: PASS with the real editor and orchestrator.

- [ ] **Step 5: Run a Future Scope leakage scan and final diff review**

```bash
rtk grep -n "BroadcastChannel\|WebSocket\|three-way merge\|packaged media\|named snapshot" packages/core/src apps/web/src apps/orchestrator/src
rtk git diff --check
rtk git status --short
```

Expected: no new Future Scope implementation, no whitespace errors, and only scoped lifecycle files plus pre-existing unrelated changes.

- [ ] **Step 6: Commit verification evidence**

```bash
rtk git add apps/web/e2e/project-lifecycle.spec.ts specs/001-project-lifecycle/quickstart.md
rtk git commit -m "test(web): verify durable project lifecycle"
```

## Self-Review Results

- Spec coverage: FR-001 through FR-004, FR-008, FR-011, FR-015 through FR-017, and FR-019 are already covered by the baseline implementation and regression suites. Tasks 1-6 cover every demonstrated gap in FR-002, FR-005 through FR-007, FR-009 through FR-014, FR-018, FR-020, and FR-021.
- Placeholder scan: no unresolved marker, “similar to”, or unspecified error/test step remains.
- Type consistency: all tasks use `Project`, `ProjectBaseRevision`, `ProjectSaveReceipt`, `SaveIntent`, `AutoSaveSavedEvent`, and `ProjectFileDecodeResult` consistently with the contracts above.
- Future Scope: explicitly excluded in Global Constraints and checked again in Task 7.
