# Authoritative Durable Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove provisional and UUID-format OpenReel domain identities, manually rewrite the sole real project, and make the first identity attached to every persisted object its permanent identity.

**Architecture:** A shared path-safe durable-ID primitive creates final identities for persisted client-created entities. Projects remain backend-slug-owned. Pending work is represented as operation state, not fake domain objects. Infrastructure randomness is isolated behind an explicitly non-domain nonce API and prohibited from project identity fields by an architecture test.

**Tech Stack:** TypeScript, React, Zustand, Express, Node.js filesystem/Git storage, Vitest, Playwright.

## Global Constraints

- No reusable runtime migration for legacy UUID projects; migrate `vintage-tokyo` once from its Git-backed worktree.
- No provisional project, media, clip, track, effect, keyframe, transition, generated asset, job, recovery, action, or receipt identity.
- No UUID-format OpenReel domain identity.
- Provider identifiers and infrastructure nonces may remain external/non-domain values but cannot enter OpenReel domain identity fields.
- All production changes follow red-green TDD and preserve user data and unrelated work.

---

### Task 1: Durable identity contract and enforcement gate

**Files:**
- Create: `packages/core/src/identity/durable-id.ts`
- Create: `packages/core/src/identity/durable-id.test.ts`
- Create: `packages/core/src/identity/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/web/src/identity/domain-identity-architecture.test.ts`

**Interfaces:**
- Produces: `createDurableId(kind: DurableEntityKind, entropy?: DurableIdEntropy): string`
- Produces: `isDurableId(value: string, kind?: DurableEntityKind): boolean`
- Produces: `createInfrastructureNonce(entropy?: DurableIdEntropy): InfrastructureNonce`

- [ ] **Step 1: Write failing unit tests for final path-safe non-UUID IDs**

```ts
expect(createDurableId("media", fixedEntropy)).toMatch(/^media-[a-z0-9]+-[a-z0-9]+$/);
expect(createDurableId("media", fixedEntropy)).not.toMatch(UUID_PATTERN);
expect(isDurableId(createDurableId("clip"), "clip")).toBe(true);
```

- [ ] **Step 2: Write a failing architecture test**

```ts
expect(scanProductionDomainIdentityGenerators()).toEqual([]);
```

The scanner rejects `uuid`, `uuidv4`, `crypto.randomUUID`, `createUnresolvedProject`, `isClientOnlyProjectId`, `tempId`, `temporaryId`, and `provisionalId` in persisted domain constructors. Its allowlist is limited to atomic filenames, locks, capabilities, and provider IDs.

- [ ] **Step 3: Run the tests and confirm RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/identity/durable-id.test.ts && rtk pnpm --filter @openreel/web exec vitest run src/identity/domain-identity-architecture.test.ts`

Expected: FAIL because the contract is absent and current production domain code uses UUID generators.

- [ ] **Step 4: Implement the minimal identity primitive**

```ts
export function createDurableId(kind: DurableEntityKind, entropy = browserEntropy): string {
  const time = entropy.now().toString(36);
  const random = encodeBase32(entropy.randomBytes(16));
  return `${kind}-${time}-${random}`;
}
```

The returned value is final at creation. `createInfrastructureNonce` returns a branded type that cannot be assigned to a domain ID without an explicit unsafe cast.

- [ ] **Step 5: Run the unit test GREEN while leaving the architecture test RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/identity/durable-id.test.ts`

Expected: PASS.

---

### Task 2: Remove fabricated and UUID project identities

**Files:**
- Modify: `apps/web/src/stores/project/types.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/stores/project/project-helpers.ts`
- Modify: `apps/web/src/services/backend-save.ts`
- Modify: `apps/web/src/hooks/useProjectRecovery.ts`
- Modify: `apps/web/src/services/project-manager.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/orchestrator/src/app.ts`
- Modify: `apps/orchestrator/src/projects/project-store.ts`
- Test: `apps/web/src/stores/project-creation.test.ts`
- Test: `apps/web/src/hooks/useProjectRecovery.test.ts`
- Test: `apps/orchestrator/src/projects/git-store-migration.test.ts`

**Interfaces:**
- Produces: explicit `project: Project | null` startup state.
- Consumes: backend-created slug project identity.

- [ ] **Step 1: Write failing tests** proving startup has no fake project, project creation adopts only the backend response ID, imported files cannot activate their embedded project ID, and recovery never classifies identity from UUID shape.
- [ ] **Step 2: Run targeted tests RED** with `rtk pnpm --filter @openreel/web exec vitest run src/stores/project-creation.test.ts src/hooks/useProjectRecovery.test.ts`.
- [ ] **Step 3: Replace `createUnresolvedProject()` with explicit no-active-project state** and guard selectors/actions until a backend load or create installs a project.
- [ ] **Step 4: Delete `isClientOnlyProjectId`, UUID quarantine branches, the dead client `ProjectManager.createProject`, and automatic `migrateUuidDirs` startup code.** Portable import creates a backend project first and retains only its managed identity.
- [ ] **Step 5: Run targeted tests and web typecheck GREEN.**

---

### Task 3: Remove UUID domain creation from media and editor state

**Files:**
- Modify: `packages/core/src/media/media-import-service.ts`
- Modify: `packages/core/src/actions/action-executor.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/stores/project/action-helpers.ts`
- Modify: `apps/web/src/bridges/effects-bridge.ts`
- Modify: `apps/web/src/components/editor/kieai/KieAIImageDialog.tsx`
- Modify: `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`
- Modify: `apps/web/src/features/music-video/timeline/metadata-media.ts`
- Test: `apps/web/src/stores/project-store.test.ts`
- Test: `apps/web/src/services/backend-save.test.ts`
- Test: `packages/core/src/media/media-import-service.test.ts`

**Interfaces:**
- Consumes: `createDurableId("media" | "clip" | "track" | "effect" | "keyframe" | "transition" | "action" | "draft")`.
- Produces: one media ID that survives import/generation from first reference through durable save.

- [ ] **Step 1: Write failing tests** asserting imported and generated media have path-safe non-UUID IDs, placeholder completion preserves the first media ID, and cancellation leaves no placeholder media item.
- [ ] **Step 2: Run tests RED.**
- [ ] **Step 3: Replace every editor-domain `uuidv4()` and `crypto.randomUUID()` call with the typed durable-ID factory and remove UUID imports.** Do not create a second ID at async completion.
- [ ] **Step 4: Represent pending generation/import as operation records until the final media object can be created, or reserve the final durable media ID and retain it unchanged through fulfillment.**
- [ ] **Step 5: Run targeted tests GREEN.**

---

### Task 4: Remove UUID domain creation from remaining persisted subsystems

**Files:**
- Modify: `packages/core/src/animation/animation-importer.ts`
- Modify: `packages/core/src/video/mask-engine.ts`
- Modify: `packages/core/src/video/motion-tracking-engine.ts`
- Modify: `packages/core/src/video/adjustment-layer-engine.ts`
- Modify: `packages/core/src/text/transcription-service.ts`
- Modify: `packages/core/src/text/title-engine.ts`
- Modify: `packages/core/src/graphics/graphics-engine.ts`
- Modify: `packages/core/src/timeline/nested-sequence-engine.ts`
- Modify: `packages/music-video-domain/src/adapter.ts`
- Modify: `packages/music-video-domain/src/neuralframes.ts`
- Modify: `apps/web/src/stores/music-video-store.ts`
- Modify: `apps/web/src/stores/chat-store.ts`
- Modify: `apps/web/src/stores/settings-store.ts`
- Modify: `apps/orchestrator/src/resolve-exports/service.ts`
- Modify: `apps/orchestrator/src/services/generation/uploads.ts`
- Test: colocated tests for each changed subsystem.

**Interfaces:**
- Consumes: shared durable-ID factory for persisted domain objects.
- Consumes: branded infrastructure nonce for locks, atomic paths, capabilities, and launch tokens.

- [ ] **Step 1: Extend the architecture test expected failures to every persisted subsystem listed above and observe RED.**
- [ ] **Step 2: Replace persisted UUID identity generation with typed durable IDs.**
- [ ] **Step 3: Rename and type internal random values as non-domain nonces; preserve atomicity and capability entropy without exposing them as domain identity.**
- [ ] **Step 4: Run all changed-package tests and typechecks GREEN.**
- [ ] **Step 5: Run the architecture test GREEN with no production domain UUID generators outside the explicit non-domain allowlist.**

---

### Task 5: Manually rewrite and commit Vintage Tokyo identity graph

**Files:**
- Snapshot: `/tmp/openreel-authoritative-identity-vintage-tokyo/`
- Modify outside code repo: `/Volumes/Joseph/openreel-projects/vintage-tokyo/project.json`
- Inspect/update when references exist: configured generation job data and project-scoped manifests for `vintage-tokyo`.

**Interfaces:**
- Consumes: clean Git branch `project/vintage-tokyo` and current `project.json`.
- Produces: complete old-to-new mapping CSV and rewritten project graph with referential integrity.

- [ ] **Step 1: Verify and commit current project data before migration.** Run `rtk git -C /Volumes/Joseph/openreel-projects/vintage-tokyo status --short`; if dirty, commit through the normal project Git workflow before continuing.
- [ ] **Step 2: Snapshot** the branch with a Git bundle plus exact project JSON, hashes, media manifest, and identity audit under `/tmp/openreel-authoritative-identity-vintage-tokyo/`.
- [ ] **Step 3: Generate a deterministic mapping** sorted by entity kind and old identity, using readable durable IDs such as `media-0001`, `track-0001`, `clip-0001`, `keyframe-0001`, `transition-0001`, `asset-group-0001`, and `generated-image-0001`.
- [ ] **Step 4: Rewrite every declaration and reference atomically** in project data and any project-scoped job/manifests. Provider model/job IDs and non-domain hashes remain unchanged.
- [ ] **Step 5: Validate** zero UUID-format OpenReel domain IDs, unique declarations, every media/track/clip/transition/generated-image reference resolving exactly once, unchanged media count 53, unchanged clip count 42, and unchanged file hashes.
- [ ] **Step 6: Commit the migrated project** with a detailed conventional commit and preserve mapping/evidence under `/tmp` only.

---

### Task 6: Full verification, browser proof, documentation, and release

**Files:**
- Modify: `specs/007-prevent-project-open-failures/spec.md`
- Modify: `specs/007-prevent-project-open-failures/checklists/requirements.md`
- Create: `specs/007-prevent-project-open-failures/quickstart.md`

- [ ] **Step 1: Run changed-package unit suites, complete web/orchestrator typechecks, lint, and the identity architecture gate.**
- [ ] **Step 2: Start the orchestrator and web app, then open `vintage-tokyo` from the chooser and direct link.**
- [ ] **Step 3: Reload, edit, save, and reopen 10 consecutive times.** Confirm no cannot-open state, no UUID domain identity in project data or requests, and preserved media/timeline content.
- [ ] **Step 4: Exercise media import and one generated-media workflow.** Confirm the first observed media ID is the saved ID and failure/cancellation leaves no temporary object.
- [ ] **Step 5: Update documentation and requirement evidence, then commit and push small coherent commits without bypassing hooks.**
