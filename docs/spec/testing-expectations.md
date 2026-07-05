# Testing Expectations — Operational Spec

> Derived from user directives and plan documents. Detailed implementation spec TBD.

**Sources:**
- [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §16 (Testing category, 78 user messages)
- [OpenReel Spec Implications report](../superpowers/plans/spec-update/openreel-spec-implications-report.json) (Testing category)
- [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) (TDD discipline)
- [Alter Storyboard Tool plan](../superpowers/plans/2026-07-03-alter-storyboard-tool.md) (TDD discipline)
- [Audio Analysis & Selection plan](../superpowers/plans/2026-07-03-audio-analysis-and-selection.md) (TDD discipline)
- [Audio Auto-Subtitle Extraction plan](../superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md) (TDD discipline)
- [Storyboard UI plan](../superpowers/plans/2026-07-03-storyboard-ui.md) (TDD discipline)
- [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) (regression set)
- Collected user messages (jsonl): regression reports, test directives, TDD mandates

---

## 1. Coverage Mandate

### 1.1 New Behaviors

All new behaviors MUST have corresponding tests. A "new behavior" is any observable change in program output, state, or side effects introduced by a feature, fix, or refactor.

- Every new function, store action, API route, component, or type constructor MUST have at least one test exercising its happy path and at least one test exercising each defined error/edge case.
- Tests MUST be co-located with the module they test (e.g., `foo.ts` → `foo.test.ts` in the same directory) unless the module is a Zustand store action tested through the store's test file.
- Tests MUST assert observable behavior, not implementation details. Prefer asserting output values, state transitions, and rendered DOM over asserting internal function calls or private state shape.

### 1.2 Regressions

Every user-reported regression MUST have a dedicated regression test committed alongside the fix.

- The test MUST reproduce the exact failure mode before the fix is applied (the "red" phase of TDD).
- The test file or test case MUST be annotated with `[regression]` in its description string so future readers can trace the provenance.
- The commit message for the fix MUST reference the regression test file.

**Required regression coverage examples (from user directives):**

| Regression | Test Location | What It Guards |
|---|---|---|
| Project auto-creation prevention | Store / hook tests asserting no project is created without explicit user action | `createNewProject` is never called implicitly; `/new` and "Start from scratch" both prompt for name |
| Missing-file thumbnail fallback | `packages/core/src/media/thumbnail-utils.test.ts` | When a video file is missing, `getThumbnailUrl` / `getClipThumbnail` falls back to first-frame reference or `reference_image` |
| Asset title preservation on replace | `apps/web/src/stores/replace-media-asset.test.ts` | `replaceMediaAsset` preserves `title` and `description` from the previous item; only `name` updates to the new filename |
| `isSupportedFormat` WAV false-positive | `packages/core/src/media/mediabunny-engine.test.ts` | `audio/wav`, `audio/x-wav`, `audio/wave`, empty-MIME+`.wav`, `application/octet-stream`+`.wav` all return `true` |
| `inferMediaType` extension fallback | `packages/core/src/media/mediabunny-engine.test.ts` | When MIME type is empty or generic, `inferMediaType` falls back to file extension to correctly identify audio/video/image/srt |
| `replaceMediaAsset` title-preservation invariant | `apps/web/src/stores/replace-media-asset.test.ts` | Source code contains `title: previousItem?.title`; construction logic preserves title/description through the spread |

---

## 2. TDD Discipline

### 2.1 Red-Green-Commit Cycle

Every task MUST follow the TDD cycle as mandated across all plan documents:

1. **Red** — Write the failing test first. Run it and record the expected failure.
2. **Green** — Implement the minimum code to make the test pass. Run the test and confirm PASS.
3. **Commit** — Commit the implementation and test together in one atomic commit.

This cycle is non-negotiable for all feature work. The "red" phase MUST produce a real test failure, not a syntax error or missing import. The test MUST fail for the right reason: the behavior under test is absent or incorrect.

### 2.2 One Task = One Atomic Commit

- Each task MUST produce exactly one commit.
- A commit MUST NOT batch unrelated changes. If a task touches multiple files, all changes in that commit MUST serve the single goal stated in the task description.
- The commit message MUST follow the conventional commit format: `type(scope): description` (e.g., `feat(web): add storyboard panel id to ui store`, `fix(core): accept WAV MIME variants in isSupportedFormat`).
- Fixup commits (`--fixup`) are permitted for corrections to the immediately preceding task commit, but MUST be squashed before the branch is considered complete.

---

## 3. Test Taxonomy

### 3.1 Gate Tests (Deterministic, Local, Fast)

Gate tests are the primary test suite run on every commit and in CI. They MUST satisfy:

- **Deterministic** — Same inputs always produce the same pass/fail result. No reliance on wall-clock time, random seeds, network availability, filesystem state outside the test fixture, or external services.
- **Local** — Runnable without network access, GPU, or service dependencies. External API calls MUST be mocked.
- **Fast** — Each individual test case MUST complete in under 2 seconds. The full gate suite SHOULD complete in under 60 seconds.

Gate tests include:
- Unit tests for pure functions, type constructors, validators, and parsers
- Component tests using `@testing-library/react` with mocked stores
- Store action tests using Zustand's `create` with mocked bridges/services
- Route handler tests using `supertest` with mocked external dependencies

### 3.2 Periodic Evals (May Be Non-Deterministic)

Periodic evals are tests that exercise non-deterministic or slow paths. They MAY be non-deterministic but MUST have a defined pass threshold.

- **Examples:** LLM output validation, audio analysis accuracy checks, end-to-end browser workflows, performance benchmarks.
- **Pass threshold:** Each periodic eval MUST declare its acceptable pass rate (e.g., "≥ 80% of runs pass" or "p95 latency ≤ 500ms"). The threshold MUST be documented in the test file.
- Periodic evals MUST NOT block commits or CI. They run on a schedule or on-demand.
- A periodic eval that consistently falls below its threshold MUST generate a tracked issue.

---

## 4. Test Organization

### 4.1 File Naming

- Unit tests: `<module-name>.test.ts` or `<module-name>.test.tsx`, co-located with the source file.
- Integration tests: `<feature>.test.ts` in a `__tests__/` directory or co-located.
- E2E / periodic eval tests: `<feature>.e2e.test.tsx` or `<feature>.eval.test.ts`.

### 4.2 Regression Annotations

Every regression test MUST include `[regression]` in its `it()` or `describe()` description string. The description SHOULD include the date or commit range when the regression was reported.

Example:
```typescript
it("[regression] accepts audio/wav MIME type (reported Jun 30 / Jul 3)", () => {
  expect(isSupportedFormat("audio/wav")).toBe(true);
});
```

### 4.3 Store Action Testing

Zustand store actions that are tightly coupled to internal state and bridges MUST be tested through the store's public API:

- Create a store instance with `create()` and known initial state.
- Call the action under test.
- Assert the resulting state via `getState()`.
- Mock bridges (mediaBridge, backendSaveService, etc.) at the module level.

Do NOT export store actions as standalone functions solely for testability. Test them through the store.

---

## 5. Test Runner & Commands

- **Runner:** Vitest (configured per-package).
- **Run all gate tests:** `pnpm -r test:run`
- **Run a single test file:** `pnpm --filter @openreel/<package> test:run <path/to/test.file>`
- **Watch mode (development):** `pnpm --filter @openreel/<package> test`

---

## 6. Open Questions

- TODO: Define the exact pass threshold for each periodic eval category (LLM output, audio analysis, E2E workflows).
- TODO: Define the CI pipeline configuration — which test commands run on push vs. PR vs. schedule.
- TODO: Define coverage thresholds (if any) for gate tests.
- TODO: Define the process for promoting a periodic eval to a gate test when its non-determinism is resolved.
