# References and Generated Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch implementation workers with model `gpt-5.4-mini`.

**Goal:** Let a user insert stable character or image references with `@`, inspect and role-map the resolved references, and create or regenerate versioned images through provider-valid requests without exposing provider syntax or losing provenance.

**Architecture:** Add canonical reference and generated-image contracts to the project model, then build three independent cores: typed-token resolution, generated-image lifecycle commands, and provider mapping. Compose those cores through shared React surfaces (`MediaMentionEditor`, `ReferenceCards`, and `GeneratedImageEditor`) and route all existing generation entry points through the same controller. Persist only canonical IDs and drafts; create provider-native prompt syntax and temporary upload handles at the final adapter boundary.

**Tech Stack:** TypeScript, React, Zustand, Lexical (`lexical`, `@lexical/react`, `@lexical/plain-text`, `@lexical/utils`), Vitest, Testing Library, Playwright, Express orchestrator routes.

## Measurable outcome

A browser test must prove that a user can type `@`, choose a character or image by keyboard, reload the project with the same typed-ID token, see one merged reference card, choose a model-supported role, generate a new image version, cancel and retry generation, and retain the imported baseline version. Sanitized fake-provider assertions must prove that no canonical project/media IDs, local URLs, temporary URLs, credentials, or provider-native tokens enter persisted project JSON.

## Global constraints

- Prompt membership is the source of truth for user-selected references.
- Persist only `@{character:<character-id>}` and `@{media:<media-version-id>}` for new mentions. Continue reading legacy `@<character-slug>` tokens.
- Provider-native fields and prompt syntax are transient adapter output and must never enter project prompts, drafts, project JSON, or logs.
- A `MediaItem.generationMeta` record means that exact binary version was provider-generated. Never add it to an imported source version.
- Automatic source and shot references remain authoritative in their owning records and render read-only.
- One `MediaMentionEditor`, one `GeneratedImageEditor`, and one generation controller serve modal, inspector, and Edit → Generate surfaces.
- Missing, ambiguous, unavailable, unsupported, overflowed, and cyclic references remain visible with explicit diagnostics.
- Do not invent provider rules. Every enabled provider/model rule must cite an authoritative sanitized fixture or be rejected as unsupported.
- All mutations are project-scoped, undoable where specified, idempotent where network retries can repeat them, and preserve immutable prior versions.
- Gate tests are deterministic and local. Provider adherence is a maintained eval with a fixed prompt set and a pass threshold of at least 90%.
- UI completion requires browser reproduction at 280, 320, and 420 pixel sidebar widths, 200% zoom, keyboard-only input, visible focus, and reduced motion.

## Existing extension points

- `packages/core/src/types/project.ts` already has `MediaItem.assetGroupId`, `MediaItem.isCurrent`, and per-version `generationMeta`.
- `apps/web/src/features/generation/context/index.ts` already parses legacy character mentions and merges reference origins.
- `apps/web/src/features/generation/drafts/v2.ts` and `submit-generation.ts` already create stable submissions and upload reference media.
- `apps/web/src/services/wavespeed/model-capabilities.ts` already normalizes provider schemas and rejects unknown inputs.
- `apps/web/src/features/generation/finalize-generated-asset.ts` and project-store tests already support immutable generated versions.
- `apps/web/src/components/editor/AssetsPanel.tsx`, `GenerateTab.tsx`, and `AssetInspectorWithTabs.tsx` are the current integration surfaces.
- `packages/music-video-domain/src/types.ts::GeneratedAsset` is a provider attempt/output record. It must not become the persisted editable generated-image definition.

## Parallel execution map

| Wave | GPT-5.4-mini workers | Dependency | File-conflict rule |
|---|---|---|---|
| 0 | Task 1 | None | Run alone because it establishes shared contracts and migration |
| 1 | Tasks 2, 3, 4 | Task 1 | Dispatch all three in one parallel batch; each owns a separate directory |
| 2 | Tasks 5, 6, 7 | Wave 1 | Dispatch all three in one batch; no worker edits another worker's files |
| 3A | Tasks 8, 9, 10 | Wave 2 | Dispatch all three in one batch; each consumes completed navigation and reference interfaces |
| 3B | Task 11 | Tasks 8, 9, 10 | Run alone as the convergence task because it removes old paths and resolves integration imports |
| 4 | Task 12 | All prior tasks | Run alone for cross-system verification, evals, and documentation |

For every worker, use this prompt footer:

```text
Use model gpt-5.4-mini. Work only in the files assigned to this task.
Follow TDD: add the named failing test, run it and record the expected failure,
write the smallest production change, rerun the focused test, then run the
listed package gate. Do not edit files owned by another task. Return:
1) files changed, 2) tests run with outcomes, 3) assumptions, 4) remaining
failure modes, 5) commit SHA. Stop if an interface in this plan is inconsistent.
```

---

### Task 1: Canonical project contracts and migration

**Owner:** Contract worker, run alone.

**Files:**

- Modify: `packages/core/src/types/project.ts`
- Create: `packages/core/src/generation/references.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/storage/project-serializer.ts`
- Modify: `packages/core/src/storage/project-serializer.test.ts`
- Modify: `packages/core/src/project-persistence.test.ts`
- Modify: `apps/web/src/stores/project/project-helpers.ts`
- Modify: `apps/web/src/stores/project-store.test.ts`

**Interfaces:**

- Produces: `GeneratedImageDefinition`, `GeneratedImageDraft`, `ReferenceRoleByKey`, `ResolvedGenerationReference`, `PromptReferenceDiagnostic`, `ReferenceTarget`, and `Project.generatedImageDefinitions`.
- Preserves: existing `MediaItem.assetGroupId`, `isCurrent`, and version-specific `generationMeta`.

- [ ] **Step 1: Add a failing persistence and migration test**

```ts
it("round-trips generated image definitions without moving provenance to an imported version", () => {
  const project: Project = {
    ...projectWithMissingClip(),
    mediaLibrary: { items: [importedImage] },
    generatedImageDefinitions: [definition],
  };
  const serializer = new ProjectSerializer(new MemoryStorage());

  const restored = serializer.importFromJson(serializer.exportToJson(project));

  expect(restored.generatedImageDefinitions).toEqual([definition]);
  expect(restored.mediaLibrary.items[0].generationMeta).toBeUndefined();
});
```

Run:

```bash
rtk pnpm --filter @openreel/core test:run -- src/storage/project-serializer.test.ts src/project-persistence.test.ts
```

Expected: FAIL because `generatedImageDefinitions` is not part of `Project`.

- [ ] **Step 2: Add the canonical contracts**

```ts
export type ReferenceRoleByKey = Readonly<Record<string, string>>;

export interface GeneratedImageDraft {
  readonly provider?: string;
  readonly modelId?: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly roleByReferenceKey: ReferenceRoleByKey;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export interface GeneratedImageDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly assetGroupId: string;
  readonly currentMediaVersionId?: string;
  readonly sourceMediaVersionId?: string;
  readonly title: string;
  readonly draft: GeneratedImageDraft;
  readonly attemptIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Add `readonly generatedImageDefinitions: GeneratedImageDefinition[]` to `Project`. Initialize it to `[]` in `createEmptyProject`. In deserialization, migrate a missing field to `[]`; reject definitions whose `projectId` differs from the containing project or whose asset group has no media version.

- [ ] **Step 3: Add shared provider-neutral reference contracts**

```ts
export type ReferenceOrigin = "source" | "character" | "prompt-media" | "shot";
export type ReferenceStatus =
  | "active"
  | "unresolved"
  | "ambiguous"
  | "unavailable"
  | "unsupported"
  | "overflow"
  | "cyclic";

export interface ResolvedGenerationReference {
  readonly key: string;
  readonly mediaId: string;
  readonly mediaVersionId: string;
  readonly origins: readonly ReferenceOrigin[];
  readonly role: string;
  readonly canonicalTokens: readonly string[];
  readonly order: number;
  readonly status: ReferenceStatus;
  readonly reason?: string;
}

export interface PromptReferenceDiagnostic {
  readonly code: Exclude<ReferenceStatus, "active"> | "malformed-token";
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly blocking: boolean;
}

export type ReferenceTarget =
  | { kind: "character"; id: string }
  | { kind: "imported-image"; mediaId: string }
  | { kind: "generated-image"; definitionId: string }
  | { kind: "missing"; token: string };
```

Export these contracts from `@openreel/core` so the browser resolver and orchestrator adapter do not import from one another.

- [ ] **Step 4: Add invariant tests**

Cover exactly one current item per asset group, source/current IDs belonging to the definition's group, stable round-trip, old-project migration, and rejection of cross-project definitions.

- [ ] **Step 5: Run focused and package gates**

```bash
rtk pnpm --filter @openreel/core test:run -- src/storage/project-serializer.test.ts src/project-persistence.test.ts
rtk pnpm --filter @openreel/web test:run -- src/stores/project-store.test.ts
rtk pnpm --filter @openreel/core typecheck
rtk pnpm --filter @openreel/web typecheck
```

- [ ] **Step 6: Commit**

```bash
rtk git add packages/core/src/types/project.ts packages/core/src/generation/references.ts packages/core/src/index.ts packages/core/src/storage/project-serializer.ts packages/core/src/storage/project-serializer.test.ts packages/core/src/project-persistence.test.ts apps/web/src/stores/project/project-helpers.ts apps/web/src/stores/project-store.test.ts
rtk git commit -m "feat(references): persist generated image definitions"
```

### Task 2: Typed prompt tokenizer and canonical resolver

**Owner:** Reference-domain worker, Wave 1.

**Files:**

- Create: `apps/web/src/features/generation/references/tokens.ts`
- Create: `apps/web/src/features/generation/references/tokens.test.ts`
- Create: `apps/web/src/features/generation/references/resolve.ts`
- Create: `apps/web/src/features/generation/references/resolve.test.ts`
- Modify: `apps/web/src/features/generation/context/index.ts`
- Modify: `apps/web/src/features/generation/context/context.test.ts`

**Interfaces:**

```ts
export type PromptReferenceToken =
  | { kind: "character"; id: string; source: string; start: number; end: number; legacy: false }
  | { kind: "media"; id: string; source: string; start: number; end: number; legacy: false }
  | { kind: "legacy-character"; slug: string; source: string; start: number; end: number; legacy: true };

export function tokenizePromptReferences(prompt: string): readonly PromptReferenceToken[];
export function canonicalCharacterToken(id: string): string;
export function canonicalMediaToken(mediaVersionId: string): string;

export interface ReferenceCandidate {
  readonly mediaId: string;
  readonly mediaVersionId: string;
  readonly canonicalTokens: readonly string[];
  readonly defaultRole: string;
}

export interface ResolveReferencesInput {
  readonly prompt: string;
  readonly source?: ReferenceCandidate;
  readonly characters: readonly ProjectCharacter[];
  readonly mediaVersions: readonly MediaVersionAccess[];
  readonly shotReferences: readonly ReferenceCandidate[];
  readonly legacyBindings?: readonly CharacterBinding[];
  readonly roleByReferenceKey: ReferenceRoleByKey;
}

export interface ResolveReferencesResult {
  readonly references: readonly ResolvedGenerationReference[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
}

export function resolveGenerationReferences(input: ResolveReferencesInput): ResolveReferencesResult;
```

- [ ] **Step 1: Write table-driven failing tokenizer tests**

Include typed character/media tokens, legacy slugs, emails, partial words, adjacent punctuation, duplicate occurrences, exact UTF-16 ranges, and malformed partial typed tokens. Assert that occurrences are retained while identity order is deduplicated separately.

- [ ] **Step 2: Implement one-pass tokenization**

Use explicit anchored patterns and source offsets. Do not infer titles or mutate the prompt. Return malformed typed-token ranges as diagnostics from the resolver rather than silently treating them as text.

- [ ] **Step 3: Write failing resolution tests**

Assert first-frame → first mention → shot ordering, media-version deduplication with merged origins, rename stability by ID, retained legacy bindings, missing IDs, unavailable character primary images, and no fallback to a different image.

- [ ] **Step 4: Implement the resolver**

Return the Task 1 shared `ResolvedGenerationReference` and `PromptReferenceDiagnostic` contracts. Use `mediaVersionId` as the deduplication identity and a stable `reference:<mediaVersionId>` key for role storage.

- [ ] **Step 5: Preserve the old exports as compatibility wrappers**

Make `tokenizeCharacterMentions` and the old context resolver delegate to the new module until every caller migrates in Task 11.

- [ ] **Step 6: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/generation/references/tokens.test.ts src/features/generation/references/resolve.test.ts src/features/generation/context/context.test.ts
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/web/src/features/generation/references apps/web/src/features/generation/context
rtk git commit -m "feat(references): resolve typed prompt references"
```

### Task 3: Generated-image lifecycle commands

**Owner:** Lifecycle worker, Wave 1.

**Files:**

- Create: `apps/web/src/features/generation/generated-images/commands.ts`
- Create: `apps/web/src/features/generation/generated-images/commands.test.ts`
- Create: `apps/web/src/features/generation/generated-images/selectors.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/stores/project-store.test.ts`

**Interfaces:**

```ts
export interface GeneratedImageCommands {
  createGeneratedImage(input: { title: string }): Promise<ActionResult & { definitionId?: string; mediaId?: string }>;
  convertImportedImage(input: { mediaId: string }): Promise<ActionResult & { definitionId?: string }>;
  updateGeneratedImageDraft(input: { definitionId: string; patch: Partial<GeneratedImageDraft> }): Promise<ActionResult>;
  deleteGeneratedImage(input: { definitionId: string }): Promise<ActionResult>;
}
```

- [ ] **Step 1: Write failing command tests**

Assert that create atomically adds one group, one unrealized image placeholder, and one definition; conversion preserves imported bytes, filename, ID, and absent `generationMeta`; repeated conversion returns the existing definition; draft updates are undoable; deletion uses affected-use confirmation.

- [ ] **Step 2: Implement pure mutation builders**

Build complete next-project values before committing them to the store. Generate IDs once per command. On any validation failure, leave all arrays unchanged and return a typed `ActionResult` error with project, media, and definition IDs.

- [ ] **Step 3: Add cycle detection**

Implement:

```ts
export function findGeneratedImageDependencyCycle(
  definitions: readonly GeneratedImageDefinition[],
  referencesByDefinitionId: ReadonlyMap<string, readonly string[]>,
  startDefinitionId: string,
): readonly string[] | null;
```

Test direct self-reference, transitive cycles, and an acyclic diamond.

- [ ] **Step 4: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/generation/generated-images/commands.test.ts src/stores/project-store.test.ts
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/web/src/features/generation/generated-images apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts
rtk git commit -m "feat(references): add generated image lifecycle commands"
```

### Task 4: Provider capability fixtures and reference mapping

**Owner:** Adapter worker, Wave 1.

**Files:**

- Create: `apps/orchestrator/src/services/generation/references/types.ts`
- Create: `apps/orchestrator/src/services/generation/references/map.ts`
- Create: `apps/orchestrator/src/services/generation/references/map.test.ts`
- Create: `apps/orchestrator/src/services/generation/references/fixtures/wavespeed.ts`
- Modify: `apps/web/src/services/wavespeed/model-capabilities.ts`
- Modify: `apps/web/src/services/wavespeed/model-capabilities.test.ts`
- Modify: `apps/web/src/services/wavespeed/adapters/sanitize-inputs.ts`

**Interfaces:**

```ts
export interface ProviderReferenceFixture {
  readonly provider: string;
  readonly modelId: string;
  readonly evidenceUrl: string;
  readonly evidenceCapturedAt: string;
  readonly acceptedFields: readonly string[];
  readonly roles: Readonly<Record<string, { field: string; cardinality: "one" | "many" }>>;
  readonly minReferences: number;
  readonly maxReferences: number;
  readonly promptTokenRule: "remove" | "preserve" | { template: string };
  readonly exampleRequest: Readonly<Record<string, unknown>>;
}

export function mapProviderReferences(
  fixture: ProviderReferenceFixture,
  prompt: string,
  references: readonly ResolvedGenerationReference[],
): { prompt: string; inputs: Readonly<Record<string, unknown>> };
```

- [ ] **Step 1: Write failing fixture-validation tests**

Reject fixtures with undocumented fields, duplicate role fields, inconsistent cardinality, missing concrete examples, or template placeholders that cannot be resolved.

- [ ] **Step 2: Capture authoritative WaveSpeed fixtures**

Derive model-specific accepted fields and role limits from the normalized live schema already handled by `model-capabilities.ts`. Store only sanitized examples. Set unsupported models to a typed unsupported result; do not guess token spelling.

- [ ] **Step 3: Implement final-order mapping**

Filter inactive references, validate count and roles, assign provider positions after filtering, rewrite/remove canonical tokens, and pass the resulting inputs through the existing schema sanitizer. Assert that unknown fields fail before any network call.

- [ ] **Step 4: Add boundary leakage tests**

Recursively inspect the request and logs for `projectId`, `mediaId`, `mediaVersionId`, `blob:`, `file:`, localhost URLs, credential-like keys, and canonical `@{...}` tokens where the fixture requires removal.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/orchestrator exec tsx --test src/services/generation/references/map.test.ts
rtk pnpm --filter @openreel/web test:run -- src/services/wavespeed/model-capabilities.test.ts
rtk pnpm --filter @openreel/orchestrator typecheck
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/orchestrator/src/services/generation/references apps/web/src/services/wavespeed
rtk git commit -m "feat(references): map canonical references at provider boundary"
```

### Task 5: Lexical media mention editor

**Owner:** Mention-editor worker, Wave 2.

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/editor/generate/mentions/MediaMentionEditor.tsx`
- Create: `apps/web/src/components/editor/generate/mentions/MentionNode.ts`
- Create: `apps/web/src/components/editor/generate/mentions/MentionTypeaheadPlugin.tsx`
- Create: `apps/web/src/components/editor/generate/mentions/MediaMentionEditor.test.tsx`

**Interfaces:**

```ts
export interface MediaMentionOption {
  readonly kind: "character" | "media";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly thumbnailUrl?: string;
  readonly available: boolean;
}

export interface MediaMentionEditorProps {
  readonly value: string;
  readonly options: readonly MediaMentionOption[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
  readonly onChange: (canonicalPrompt: string) => void;
  readonly onOpenReference: (target: ReferenceTarget, event: React.MouseEvent | React.KeyboardEvent) => void;
}
```

- [ ] **Step 1: Install the focused Lexical packages**

```bash
rtk pnpm --filter @openreel/web add lexical @lexical/react @lexical/plain-text @lexical/utils
```

Use `LexicalComposer`, `PlainTextPlugin`, `ContentEditable`, `HistoryPlugin`, `OnChangePlugin`, and `LexicalTypeaheadMenuPlugin`. Implement the pill as a token-mode custom text entity so deletion, selection, undo, IME composition, and plain-text export remain deterministic.

- [ ] **Step 2: Write failing interaction tests**

Cover `@` filtering, arrow navigation, Enter and Tab selection, Escape, pointer selection without lost focus, copy/paste, undo/redo, reload serialization, atomic Backspace/Delete, unresolved error pills, and combobox/listbox announcements.

- [ ] **Step 3: Implement canonical import/export**

On external `value` changes, parse canonical tokens into mention nodes without resetting selection when the value originated locally. Export every mention node back to its canonical token. Never store labels or thumbnails in the prompt.

- [ ] **Step 4: Render the required accessible hint**

Render `Type @ to refer to other media` below the editor as persistent help text linked by `aria-describedby`, not placeholder text.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/components/editor/generate/mentions/MediaMentionEditor.test.tsx
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/editor/generate/mentions
rtk git commit -m "feat(references): add accessible media mention editor"
```

### Task 6: Reference cards, role state, and overflow warning

**Owner:** Reference-card worker, Wave 2.

**Files:**

- Create: `apps/web/src/components/editor/generate/references/ReferenceCards.tsx`
- Create: `apps/web/src/components/editor/generate/references/ReferenceCards.test.tsx`
- Create: `apps/web/src/features/generation/references/roles.ts`
- Create: `apps/web/src/features/generation/references/roles.test.ts`
- Create: `apps/web/src/stores/reference-warning-preferences.ts`

**Interfaces:**

```ts
export function reconcileReferenceRoles(input: {
  rolesByKey: ReferenceRoleByKey;
  references: readonly ResolvedGenerationReference[];
  capability: GenerationModelCapability;
}): { references: readonly ResolvedGenerationReference[]; rolesByKey: ReferenceRoleByKey };
```

- [ ] **Step 1: Write failing role-state tests**

Cover role visibility only when more than one role applies, compatible model switching, preserved-but-inactive incompatible roles, overflow ordering, stale role removal after pill deletion, and warning suppression scoped to warning class.

- [ ] **Step 2: Implement pure role reconciliation**

Never delete user role data on model change. Mark invalid references inactive with a reason and exclude them from submission. Remove role entries only when the corresponding prompt-derived reference no longer exists.

- [ ] **Step 3: Write and implement card interaction tests**

Cards must render fixed-aspect thumbnail, display name, description, availability, all merged origins, invalid badge, and normalized role labels. The section has no add/remove control.

- [ ] **Step 4: Implement the confirmation contract**

Before submit, return every excluded reference and reason. The dialog's `Do not show again` hides only future dialogs for `reference-overflow`; badges and inactive cards remain.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/generation/references/roles.test.ts src/components/editor/generate/references/ReferenceCards.test.tsx
rtk git add apps/web/src/components/editor/generate/references apps/web/src/features/generation/references/roles.ts apps/web/src/features/generation/references/roles.test.ts apps/web/src/stores/reference-warning-preferences.ts
rtk git commit -m "feat(references): render model-aware reference cards"
```

### Task 7: Reference navigation for modal and inspector

**Owner:** Navigation worker, Wave 2.

**Files:**

- Create: `apps/web/src/features/references/navigation.ts`
- Create: `apps/web/src/features/references/navigation.test.ts`
- Create: `apps/web/src/components/editor/references/ReferenceEditorModal.tsx`
- Create: `apps/web/src/components/editor/references/ReferenceEditorModal.test.tsx`
- Modify: `apps/web/src/stores/ui-store.ts`
- Modify: `apps/web/src/components/editor/InspectorPanel.tsx`

**Interfaces:**

```ts
export function openReferenceTarget(target: ReferenceTarget, placement: "modal" | "inspector"): void;
```

- [ ] **Step 1: Write failing routing tests**

Click routes to modal; Shift-click routes to inspector without opening modal; each type selects its editor; missing targets show recovery; modal close restores focus to the invoking pill/card.

- [ ] **Step 2: Implement a single route resolver**

Resolve target type from stable IDs and current project state. Do not copy selected objects into local state. Emit a structured diagnostic if a target disappears between click and open.

- [ ] **Step 3: Implement focus-managed modal**

Use the repository dialog primitive for focus trap, accessible title, Escape close, and restoration. Render the same editor component that the inspector route uses.

- [ ] **Step 4: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/references/navigation.test.ts src/components/editor/references/ReferenceEditorModal.test.tsx
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/web/src/features/references apps/web/src/components/editor/references apps/web/src/stores/ui-store.ts apps/web/src/components/editor/InspectorPanel.tsx
rtk git commit -m "feat(references): route referenced items to modal or inspector"
```

### Task 8: Media pane create and Regenerate commands

**Owner:** Media-entry worker, Wave 3A.

**Files:**

- Modify: `apps/web/src/components/editor/AssetsPanel.tsx`
- Modify: `apps/web/src/components/editor/AssetsPanel.test.tsx`
- Modify: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`
- Create: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.generation.test.tsx`

**Interfaces:** Consumes Task 3 commands and Task 7 navigation. Produces no new domain contract.

- [ ] **Step 1: Write failing Media toolbar tests**

Replace the icon-only Create Scene action with one keyboard-accessible create dropdown containing exactly `Add Scene` and `Add Generated Image`. Assert that generated-image creation opens the returned definition in the inspector and leaves a valid placeholder when closed.

- [ ] **Step 2: Implement the create dropdown**

`Add Scene` delegates to the existing scene command. `Add Generated Image` calls `createGeneratedImage`, selects its placeholder, and opens `generated-image` inspector routing only after the atomic command succeeds.

- [ ] **Step 3: Write failing image-inspector tests**

For every available image, render `Regenerate` immediately next to `Replace`. Imported image conversion must preserve the original media object and open the new definition. Existing generated image must open the existing definition without submitting.

- [ ] **Step 4: Implement Regenerate**

Call `convertImportedImage` only when no definition owns the image's asset group. Never load the source blob merely to open the editor and never write generation provenance during conversion.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/components/editor/AssetsPanel.test.tsx src/components/editor/inspector/AssetInspectorWithTabs.generation.test.tsx
rtk git add apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetsPanel.test.tsx apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx apps/web/src/components/editor/inspector/AssetInspectorWithTabs.generation.test.tsx
rtk git commit -m "feat(references): add generated image media entry points"
```

### Task 9: Shared GeneratedImageEditor

**Owner:** Generated-image UI worker, Wave 3A.

**Files:**

- Create: `apps/web/src/components/editor/generate/GeneratedImageEditor.tsx`
- Create: `apps/web/src/components/editor/generate/GeneratedImageEditor.test.tsx`
- Create: `apps/web/src/features/generation/generated-images/controller.ts`
- Create: `apps/web/src/features/generation/generated-images/controller.test.ts`
- Modify: `apps/web/src/components/editor/inspector/tabs/generation/GenerateTab.tsx`
- Modify: `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**Interfaces:** Consumes Tasks 2, 3, 5, 6, and 7. Produces one controller used by all generation surfaces.

- [ ] **Step 1: Write failing controller tests**

Cover draft persistence by definition ID, model/provider changes, reference resolution, role reconciliation, duplicate-submit blocking, validation, cost/limit display data, cancel, retry, and active-job restoration.

- [ ] **Step 2: Implement the controller**

The controller reads canonical project state by IDs, writes draft patches through Task 3 commands, and invokes existing submit/cancel/retry ports. Closing a view does not clear the draft.

- [ ] **Step 3: Write failing shared-render tests**

Render the same `GeneratedImageEditor` in modal and inspector harnesses. Assert provider/model, title, mention prompt, References, negative prompt, schema inputs, validation, Generate, status, Cancel, Retry, and version history appear according to capability and job state.

- [ ] **Step 4: Replace provider-specific dialog internals**

Keep `GenerateAssetDialog` as a compatibility shell that resolves a target/definition and renders `GeneratedImageEditor`. Make `GenerateTab` use the same editor/controller instead of duplicating prompt and reference UI.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/generation/generated-images/controller.test.ts src/components/editor/generate/GeneratedImageEditor.test.tsx src/components/editor/inspector/tabs/generation/GenerateTab.test.tsx
rtk pnpm --filter @openreel/web typecheck
rtk git add apps/web/src/components/editor/generate apps/web/src/components/editor/inspector/tabs/generation/GenerateTab.tsx apps/web/src/features/generation/generated-images
rtk git commit -m "feat(references): unify generated image editing"
```

### Task 10: Submission, finalization, and provenance integration

**Owner:** Pipeline worker, Wave 3A.

**Files:**

- Modify: `apps/web/src/features/generation/drafts/v2.ts`
- Modify: `apps/web/src/features/generation/drafts/v2.test.ts`
- Modify: `apps/web/src/features/generation/submit-generation.ts`
- Modify: `apps/web/src/features/generation/submit-generation.test.ts`
- Modify: `apps/web/src/features/generation/finalize-generated-asset.ts`
- Modify: `apps/web/src/features/generation/finalize-generated-asset.test.ts`
- Modify: `apps/orchestrator/src/routes/wavespeed.ts`
- Modify: `apps/orchestrator/src/routes/wavespeed.test.ts`

**Interfaces:** Consumes resolved active references from Task 2, provider mapping from Task 4, lifecycle definitions from Task 3, and warning decisions from Task 6.

- [ ] **Step 1: Write failing end-to-end service tests**

Use a fake upload port and fake provider server. Assert final validated ordering, role mapping, token rewriting, uploaded provider-reachable values, overflow acknowledgement, cycle rejection, no network call on invalid input, and no secret/local-ID leakage.

- [ ] **Step 2: Extend the immutable submission draft**

Store canonical prompt, stable reference keys, roles, media/version IDs, and provider-neutral inputs. Perform upload and provider mapping only inside `executeSubmission` after validation and ordering.

- [ ] **Step 3: Integrate finalization**

On success, create a new immutable media version in the definition's asset group, attach complete `generationMeta` only to that output version, update `currentMediaVersionId`, append the attempt ID once, and apply the explicit current-version policy through the existing idempotent finalizer.

- [ ] **Step 4: Preserve cancel and retry invariants**

Cancellation stops polling and leaves draft/current version unchanged. Retry creates a new attempt but not a duplicate placeholder, definition, media version, or storyboard artifact.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm --filter @openreel/web test:run -- src/features/generation/drafts/v2.test.ts src/features/generation/submit-generation.test.ts src/features/generation/finalize-generated-asset.test.ts
rtk pnpm --filter @openreel/orchestrator exec tsx --test src/routes/wavespeed.test.ts
rtk git add apps/web/src/features/generation apps/orchestrator/src/routes/wavespeed.ts apps/orchestrator/src/routes/wavespeed.test.ts
rtk git commit -m "feat(references): submit and finalize generated image references"
```

### Task 11: Integration convergence and old-path removal

**Owner:** Integration worker, Wave 3B after Tasks 8, 9, and 10 commits are accepted.

**Files:**

- Modify: `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx`
- Modify: `apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx`
- Modify: `apps/web/src/components/editor/inspector/ReferenceImages.tsx`
- Modify: `apps/web/src/features/generation/context/scene-generation.ts`
- Modify: `apps/web/src/features/generation/context/scene-generation.test.ts`
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx` only to resolve integration conflicts from Task 8

**Interfaces:** Deletes duplicate selection and presentation paths after all callers use the canonical modules.

- [ ] **Step 1: Add a failing integration test**

Mount a prompt surface with project characters, image versions, model capabilities, and a shot source. Select two mentions, remove one pill, switch models, and assert the canonical prompt, merged cards, roles, diagnostics, and submission draft agree.

- [ ] **Step 2: Replace legacy picker/card callers**

Turn `ReferenceImagePicker` and `ReferenceImages` into compatibility re-exports or delete them when no callers remain. There must be no second user-reference list and no second prompt editor.

- [ ] **Step 3: Remove compatibility wrappers**

After repository-wide callers use `tokenizePromptReferences` and the canonical resolver, remove the Task 2 legacy wrappers. Verify no provider dialog maintains independent job or draft state.

- [ ] **Step 4: Run affected and full gates**

```bash
rtk pnpm --filter @openreel/web test:run
rtk pnpm --filter @openreel/orchestrator exec tsx --test
rtk pnpm typecheck
rtk pnpm lint
```

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor apps/web/src/features/generation/context
rtk git commit -m "refactor(references): converge generation reference surfaces"
```

### Task 12: Browser verification, provider eval, and release evidence

**Owner:** Verification worker, run alone.

**Files:**

- Create: `apps/web/e2e/references-generated-images.spec.ts`
- Create: `apps/orchestrator/src/services/generation/references/provider-reference.eval.test.ts`
- Create: `apps/orchestrator/src/services/generation/references/fixtures/reference-adherence.json`
- Create: `docs/verification/references-generated-images.md`

**Interfaces:** Produces the release evidence; does not change production behavior.

- [ ] **Step 1: Add deterministic browser fixtures**

Seed one character with a primary image, one imported image with a baseline version, one generated-image definition, source/shot references, two fake models with different roles/limits, and a fake provider with submit/status/cancel/retry responses.

- [ ] **Step 2: Implement Playwright coverage**

Verify keyboard mention selection and pill serialization; card ordering/origin merge; model-dependent role controls; click modal and Shift-click inspector routing; Add Generated Image; imported-image Regenerate without baseline loss; generate/cancel/retry/current-version selection; focus restoration; 280/320/420 pixel panels; 200% zoom; visible focus; reduced motion.

- [ ] **Step 3: Add provider adherence eval**

Use a fixed sanitized prompt set with multiple-reference image and video cases. Score exact reference count, order, role, and provider request field adherence. Fail below 90%, on any duplicate output identity, or on any detected secret/local-ID leakage.

- [ ] **Step 4: Run release gates and capture evidence**

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm --filter @openreel/web test:e2e -- references-generated-images.spec.ts
rtk pnpm --filter @openreel/orchestrator exec tsx --test src/services/generation/references/provider-reference.eval.test.ts
```

Record exact commands, commit SHAs, pass counts, eval percentage, browser viewport/zoom matrix, and remaining unverified provider models in `docs/verification/references-generated-images.md`.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/e2e/references-generated-images.spec.ts apps/orchestrator/src/services/generation/references docs/verification/references-generated-images.md
rtk git commit -m "test(references): verify generated image reference workflow"
```

## Mini-agent integration protocol

1. Create one isolated worktree per worker with branch names `codex/references-task-<n>`.
2. Give each GPT-5.4-mini worker only its task section, Global constraints, and interfaces it consumes.
3. Dispatch every worker in a wave in one parallel batch.
4. Require each worker to commit before returning.
5. Review each commit against the task's tests and file ownership before cherry-picking.
6. Cherry-pick in numeric task order within a wave, resolve only integration imports at the convergence task, and never accept silent catch blocks or skipped assertions.
7. Run the focused tests after every cherry-pick and the wave gate before dispatching the next wave.
8. Close every implementer and reviewer subagent when its task is accepted.

## Failure modes and evidence

| Failure mode | Prevention | Evidence |
|---|---|---|
| Rename changes prompt identity | Persist typed IDs, resolve labels at render time | Task 2 rename-stability test |
| Partial hidden token after editing | Lexical token entity and atomic deletion | Task 5 deletion/copy/paste tests |
| Role/model changes lose user data | Preserve incompatible role state as inactive | Task 6 model-switch tests |
| Overflow silently drops media | Explicit pre-submit list and scoped suppression | Tasks 6 and 10 tests |
| Imported source claims generated provenance | Version-only `generationMeta` | Tasks 1, 3, and 10 tests |
| Duplicate outputs after retry/reload | Existing idempotent finalization claim plus attempt identity | Task 10 retry tests |
| Provider receives local IDs or secrets | Final-boundary mapping, recursive leakage assertion | Tasks 4, 10, and 12 |
| Dependency cycle reaches provider | Pre-submit graph traversal | Tasks 3 and 10 |
| Modal/inspector diverge | Same editor component and controller | Tasks 7 and 9 |
| UI passes unit tests but fails in editor | Browser matrix and fake provider workflow | Task 12 |

## Completion criteria

- All deterministic unit, integration, typecheck, lint, and browser gates pass.
- Every supported provider/model has an authoritative sanitized fixture or is explicitly unavailable.
- Provider adherence is at least 90% over the fixed eval set.
- Technical pipeline completion is 100%.
- Duplicate artifact count is zero.
- Secret/local-ID leakage count is zero.
- No restart is required beyond restarting `rtk pnpm dev` after dependency installation.
