# Testing Expectations — Compliance Plan

**Date:** 2026-07-05
**Spec:** `docs/spec/testing-expectations.md`
**Status:** Process/documentation gap analysis — no plan currently covers this cross-cutting mandate.

---

## Goal

`docs/spec/testing-expectations.md` is not a feature spec — it's a cross-cutting process
mandate covering TDD discipline, coverage requirements, regression-test provenance, gate
vs. periodic-eval taxonomy, and CI gating. This plan closes the gap between that mandate
and the actual state of testing infrastructure across the monorepo (`apps/*`,
`packages/*`), and lists concrete remediation tasks: missing test scripts/tooling,
undocumented coverage thresholds, no CI test-coverage gate, and CONTRIBUTING.md gaps
around TDD/regression-annotation expectations.

This is infrastructure/process work, not feature work — tasks below are scoped to
config, docs, and CI, not application logic.

---

## Current State vs. Spec (Per-Package Compliance)

| Package | Test script (`test:run`) | Vitest config present | Coverage config | Test files / source files | Notes |
|---|---|---|---|---|---|
| `apps/web` | ✅ | ✅ | ✅ (`v8`, text/json/html) | 42 / 282 | Largest app; coverage configured but **no threshold enforced** |
| `apps/image` | ✅ | ✅ | ✅ (`v8`, text/json/html) | 4 / 123 | Coverage configured, no threshold; very low test-to-source ratio |
| `apps/orchestrator` | ❌ **missing entirely** | ❌ | ❌ | 0 / 10 | No `test`/`test:run` script in `package.json`; no `vitest` devDependency; **zero test files** despite housing proxy routes with external API integration risk |
| `packages/core` | ✅ | ✅ | ✅ (`v8`, text/json/html) | 16 / 172 | Best-covered package; still no enforced threshold |
| `packages/image-core` | ✅ | ❌ **no `vitest.config.ts`** | ❌ | 3 / 9 | Runs via default vitest config only (no explicit config file found) |
| `packages/music-video-domain` | ✅ | ✅ | ❌ (no `coverage` block) | 1 / 4 | Only 1 test file (`adapter.test.ts`, 8 tests) for a domain-types package |
| `packages/ui` | ❌ **missing entirely** | ❌ | ❌ | 0 / 26 | No `vitest` devDependency at all; 26 source files (components) with **zero tests** |

**Root-level orchestration:** `package.json` has `"test": "pnpm -r test:run"` and
`"test:watch": "pnpm -r test"`. Running `pnpm -r test:run` confirms **"Scope: 7 of 8
workspace projects"** — i.e., one workspace package (`packages/ui`) is silently skipped
because it has no `test:run` script; `apps/orchestrator` is also skipped for the same
reason. This means **CI's `pnpm test` step silently never runs tests for 2 of 8
packages** — it isn't a failure, it's a silent no-op, which is worse: nobody is alerted
that these packages are untested.

**CI (`​.github/workflows/ci.yml`):** Runs `pnpm typecheck` → `pnpm lint` → `pnpm test`
→ (separate job) `pnpm build`. No coverage upload/threshold step. No distinction between
gate tests and periodic evals — spec §3.2 periodic evals don't exist yet in this repo
(no `.eval.test.ts` / `.e2e.test.tsx` files found), so there's nothing to accidentally
gate on non-determinism yet, but there's also no scaffolding for when they're added.

**Regression annotation (spec §1.2, §4.2):** Only **5 occurrences** of `[regression]`
found across the entire `apps/*/src` and `packages/*/src` tree, despite the spec listing
6 named "Required regression coverage examples" that are supposed to exist under this
convention. Not all of them were verified to carry the annotation string.

**Skipped tests:** 7 `it.skip`/`describe.skip` occurrences found (e.g.
`apps/web/src/test/export-integration.test.ts`, `apps/web/src/stores/project-store.test.ts`),
each with an inline reason ("skipped: subtitles consolidated into text clips"). The spec
doesn't currently define a policy for skipped tests (whether they must be tracked,
time-boxed, or removed) — this is a gap in the spec itself, not just the implementation,
and is noted here rather than silently fixed with an assumption.

**CONTRIBUTING.md:** Has a "Testing" section (`pnpm test`, `pnpm test:run`,
`pnpm typecheck`, `pnpm lint`) and a "Writing Tests" example using
`describe`/`it`/`expect`. It does **not** mention: the TDD red-green-commit cycle, the
`[regression]` annotation convention, the gate-vs-periodic-eval taxonomy, one-task-one-commit
discipline, or Zustand store-testing-through-public-API conventions — all of which are
explicit MUST-level requirements in the spec.

**Spec's own open questions (§6):** The spec itself flags 4 unresolved TODOs (periodic
eval pass thresholds, CI pipeline test-command matrix, gate-test coverage thresholds,
periodic-eval-to-gate promotion process). These are **spec-completeness gaps**, not
implementation gaps — Task 6 below proposes minimal, concrete defaults so the mandate
is enforceable rather than aspirational, but final numbers should be confirmed with the
operator, not unilaterally invented.

---

## Gaps Summary

1. **`apps/orchestrator` has zero test infrastructure** — no `vitest`, no script, no
   test files — despite proxying external provider APIs (WaveSpeed, KieAI, Atlascloud),
   which is exactly the kind of surface spec §3.1 says needs mocked-dependency gate
   tests (`supertest` + mocked external calls).
2. **`packages/ui` has zero test infrastructure** — 26 component source files, no
   tests, no vitest devDependency.
3. **`pnpm -r test:run` silently skips both of the above** — no visibility/alerting
   that 2/8 packages contribute zero test signal to CI.
4. **No coverage thresholds anywhere** — coverage reporters exist in 3 packages
   (`web`, `image`, `core`) but nothing fails the build if coverage drops; two packages
   with vitest already configured have no coverage block at all (`image-core`,
   `music-video-domain`).
5. **CI has no dedicated coverage-reporting or coverage-gate step** — coverage is
   generated locally at best, never surfaced in CI output/artifacts.
6. **CONTRIBUTING.md doesn't encode the mandate** — new contributors have no
   documented pointer to TDD discipline, regression annotation, or gate/eval taxonomy.
7. **Spec's own 4 open questions are unresolved**, keeping several MUST-level
   requirements (coverage thresholds, periodic eval thresholds, CI test-command matrix)
   unenforceable as written.
8. **No skip-tracking policy** — 7 skipped tests exist with no spec-defined
   handling (track as issues? time-box? remove?).

---

## Remediation Tasks

### Task 1: Add test infrastructure to `apps/orchestrator`

**Files:**
- Modify: `apps/orchestrator/package.json` — add `vitest` devDependency, add
  `"test": "vitest"` and `"test:run": "vitest run"` scripts
- Create: `apps/orchestrator/vitest.config.ts` — mirror `packages/core/vitest.config.ts`
  pattern (node environment, `src/**/*.test.ts` include, `v8` coverage provider)
- Create: at least one seed test file, e.g. `apps/orchestrator/src/routes/wavespeed.test.ts`,
  using `supertest` against the Express app with the external WaveSpeed call mocked
  (spec §3.1 requirement: gate tests for route handlers MUST mock external dependencies)

**Steps:**
- [ ] Add `vitest` and `supertest`/`@types/supertest` to `devDependencies`
- [ ] Add `test`/`test:run` scripts matching the pattern used in `packages/core`
- [ ] Create `vitest.config.ts` with node environment + v8 coverage provider
- [ ] Write one seed route test (mocked external call) to prove the harness works
- [ ] Run `pnpm --filter @openreel/orchestrator test:run` and confirm pass
- [ ] Confirm `pnpm -r test:run` now reports "8 of 8 workspace projects" (or however
      many have a `test:run` script) rather than silently excluding orchestrator

**Size:** Small (config + 1 seed test). Follow-up work to backfill full route coverage
is out of scope for this plan — this task only stands up the harness so the silent gap
stops being silent.

---

### Task 2: Add test infrastructure to `packages/ui`

**Files:**
- Modify: `packages/ui/package.json` — add `vitest`, `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom` devDependencies; add `test`/`test:run` scripts
- Create: `packages/ui/vitest.config.ts` — jsdom environment (component package),
  mirror `apps/web/vitest.config.ts` pattern minus the app-specific aliases
- Create: at least one seed component test for an existing component in
  `packages/ui/src` (pick the smallest/most stable component) proving the harness
  renders and asserts DOM output per spec §3.1 ("Component tests using
  `@testing-library/react` with mocked stores")

**Steps:**
- [ ] Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` to
      `devDependencies`
- [ ] Add `test`/`test:run` scripts
- [ ] Create `vitest.config.ts` with `environment: "jsdom"`
- [ ] Write one seed component test
- [ ] Run `pnpm --filter @openreel/ui test:run` and confirm pass

**Size:** Small (config + 1 seed test). Backfilling coverage across all 26 components
is out of scope here.

---

### Task 3: Add coverage config to packages missing it

**Files:**
- Modify: `packages/image-core/package.json` / create `packages/image-core/vitest.config.ts`
  — currently has `test`/`test:run` scripts but **no vitest.config.ts at all**, so it's
  running on vitest defaults with no `v8` coverage provider wired
- Modify: `packages/music-video-domain/vitest.config.ts` — has a config file but no
  `coverage` block; add one matching `packages/core`'s block

**Steps:**
- [ ] Create `packages/image-core/vitest.config.ts` (node environment, coverage: v8,
      reporters `["text","json","html"]`) — match `packages/core/vitest.config.ts`
      structure
- [ ] Add `coverage: { provider: "v8", reporter: ["text","json","html"] }` to
      `packages/music-video-domain/vitest.config.ts`
- [ ] Run `pnpm --filter @openreel/image-core test:run -- --coverage` and
      `pnpm --filter @openreel/music-video-domain test:run -- --coverage` to confirm
      coverage reports now generate

**Size:** Trivial (config-only, ~10 lines each).

---

### Task 4: Define and wire coverage thresholds (resolves spec §6 TODO)

**Decision needed before implementation:** the spec explicitly leaves the threshold
value as an open TODO (§6: "Define coverage thresholds (if any) for gate tests"). This
plan does not invent a number unilaterally — propose starting thresholds (e.g. lines
70% / branches 60% as a floor, ratcheting up over time) to the operator for approval,
then wire them into each package's vitest config via `coverage.thresholds`.

**Files (once threshold value is approved):**
- Modify: `vitest.config.ts` in `apps/web`, `apps/image`, `packages/core`,
  `packages/image-core`, `packages/music-video-domain`, and the new configs from
  Tasks 1–2, adding a `coverage.thresholds` block (`lines`, `branches`, `functions`,
  `statements`)

**Steps:**
- [ ] Confirm threshold numbers with the operator (this is a judgment call the spec
      explicitly defers — do not guess a number that could break CI unexpectedly)
- [ ] Add `thresholds` block to each package's `vitest.config.ts`
- [ ] Run `pnpm -r test:run -- --coverage` and confirm current coverage clears the
      chosen floor (adjust floor down if a package is legitimately far below target,
      rather than blocking all merges immediately)

**Size:** Small once the number is approved; mostly config repetition across 7 packages.

---

### Task 5: Add coverage-aware CI step

**Files:**
- Modify: `.github/workflows/ci.yml` — after the existing `Run tests` step, add a
  step that runs `pnpm -r test:run -- --coverage` (or equivalent per-package coverage
  invocation) and uploads/prints the summary so coverage regressions are visible in
  the Actions log, not just enforced silently by exit code

**Steps:**
- [ ] Add a coverage step to the `test` job in `ci.yml` after typecheck/lint/test
- [ ] Decide (with operator) whether this step's failure should block PRs (once Task 4
      thresholds are wired, this step naturally starts blocking merges below threshold)
- [ ] Verify the CI job passes on a clean run of the current codebase before merging
      this workflow change (do not land a CI change that breaks existing green PRs)

**Size:** Small (single workflow step addition).

---

### Task 6: Document TDD/regression/taxonomy expectations in CONTRIBUTING.md

**Files:**
- Modify: `CONTRIBUTING.md` — expand the existing "Testing" section

**Steps:**
- [ ] Add a subsection documenting the **Red-Green-Commit cycle** (spec §2.1): write
      failing test → confirm real failure → implement minimum code → confirm pass →
      commit test+implementation together
- [ ] Add a subsection documenting the **`[regression]` annotation convention**
      (spec §4.2) with the example from the spec (`it("[regression] ...")`)
- [ ] Add a subsection documenting the **gate test vs. periodic eval taxonomy**
      (spec §3.1/§3.2): gate tests must be deterministic/local/fast (<2s/case, <60s
      suite); periodic evals may be non-deterministic but must declare a pass threshold
      and must not block CI
- [ ] Add a note on **one-task-one-commit** discipline (spec §2.2) and conventional
      commit format, cross-referencing the existing commit-message guidance already in
      CONTRIBUTING.md if present
- [ ] Add a note on **Zustand store testing** convention (spec §4.3): test store
      actions through the store's public API (`create()` + `getState()`), not as
      standalone exported functions

**Size:** Small (docs-only, additive to an existing section).

---

### Task 7: Resolve remaining spec open questions or explicitly defer them

The spec (§6) lists 4 open questions. Tasks 4 and 5 above resolve the coverage-threshold
and CI-pipeline-matrix questions once the operator approves specific numbers. The
remaining two:

- **Periodic eval pass thresholds** (LLM output, audio analysis, E2E workflows): no
  periodic eval tests exist yet in the repo (confirmed: no `.eval.test.*` /
  `.e2e.test.*` files found). This is genuinely not yet actionable — recommend leaving
  as an open TODO in the spec until the first periodic eval is written, at which point
  its threshold should be defined in that eval's own test file per spec §3.2, not
  centrally.
- **Periodic-eval-to-gate promotion process**: same reasoning — defer until there's at
  least one periodic eval to promote.

**Steps:**
- [ ] No code/doc changes required for this task beyond what Tasks 4–6 already cover;
      this task exists only to make explicit, in the prioritized plan list, that these
      two spec TODOs are intentionally deferred rather than silently dropped

**Size:** None (tracking-only; zero-effort task, included for completeness of the
prioritized list).

---

## Size / Complexity Estimate (Overall)

**Overall size: Medium.** Tasks 1–3 and 6 are small, mechanical, low-risk config/docs
changes (each independently under an hour of work). Task 4 requires an operator
decision before implementation (threshold values) — do not proceed with Task 4 without
that confirmation, as picking the wrong number could either block all merges (too high)
or ratify already-low coverage into a rubber stamp (too low). Task 5 depends on Task 4.
Task 7 is a documentation/deferral note with no implementation cost.

Suggested order: **1 → 2 → 3 → 6** (independent, can proceed immediately) → **4**
(needs operator sign-off) → **5** (depends on 4) → **7** (zero-cost, do alongside 6).
