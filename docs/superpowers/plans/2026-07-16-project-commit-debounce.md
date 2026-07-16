# Project commit debounce implementation plan

## Audience and execution model

This plan is written for a GPT-5.4-mini lead agent that will spawn its own bounded
GPT-5.4-mini implementation subagents. The lead agent owns integration, architectural
decisions already fixed by the specs, final verification, atomic commits, and push.

Subagents must receive exact file scopes and acceptance tests. They may inspect adjacent
symbols but must not independently redesign contracts. No two concurrently running
subagents may edit the same file. The lead agent must integrate and test each dependency
layer before dispatching work that depends on it.

## Fixed decisions

- Ordinary project PUTs write worktree state immediately.
- Git commit occurs after 120 seconds without a newer accepted PUT for that project.
- The delay is `config.projectCommitDebounceMs`, default `120_000`.
- Creation, import, migration, and explicit administrative rename remain synchronous.
- Deferred receipts use `committed: false`, retain current confirmed Git hashes, advance
  `sourceModifiedAt`, and include `commitDueAt`.
- The frontend advances conflict base state from a valid deferred receipt without
  replacing the last confirmed receipt.
- A lightweight backend status endpoint confirms background completion.
- Timers are per project and use generation/deadline rechecks inside the Git lock.
- Background commits compare worktree state with HEAD and commit one cumulative diff.
- Metadata-only differences never create commits.
- Acknowledged worktree data is never rolled back because a background commit fails.
- Tests use injected clocks/timers; no 120-second sleeps.

## Relevant existing code

- `apps/orchestrator/src/projects/save-transaction.ts`: foreground atomic save,
  recovery journal, media promotion, conflict and destructive-change checks.
- `apps/orchestrator/src/projects/git-store.ts`: per-project lock, strict allowlisted
  staging, commit receipt calculation, and an unused unsuitable `commitAsync`.
- `apps/orchestrator/src/projects/routes.ts`: synchronous PUT route and synchronous
  create/import/rename paths.
- `apps/orchestrator/src/app.ts` and `src/index.ts`: dependency construction and process
  lifecycle.
- `apps/orchestrator/src/env.ts`: orchestrator configuration.
- `packages/core/src/project-persistence.ts`: request, receipt, and conflict contracts.
- `apps/web/src/services/backend-save.ts`: receipt validation, scheduling, retry, and
  conflict handling.
- `apps/web/src/stores/persistence-status-store.ts`: confirmed/base revision state.
- `apps/web/src/components/editor/Toolbar.tsx`: persistence phase presentation.
- Existing transaction, route, GitStore, backend-save, and status-store tests.

## Commit 1: shared contracts and configuration

### Mini-agent task A

Files:

- `packages/core/src/project-persistence.ts`
- `packages/core/src/project-persistence.test.ts`
- `apps/orchestrator/src/env.ts`
- add a focused env/config test if none exists.

Implement:

1. Add `commitDueAt: number | null` to save receipts.
2. Add typed persistence-status response contracts:
   `clean | waiting | committing | retry-wait | settled-metadata-only`.
3. Status responses include project ID, latest `sourceModifiedAt`, `commitDueAt`, safe
   error text, and a committed receipt when available.
4. Add `config.projectCommitDebounceMs`, sourced from
   `MV_PROJECT_COMMIT_DEBOUNCE_MS`, defaulting to `120_000`.
5. Validate configuration as a finite non-negative integer and fail startup on invalid
   input.

Tests:

- receipt/status JSON shapes;
- default, override, zero-delay test mode, negative, fractional, NaN, and infinity
  configuration cases.

Lead-agent gate:

- core tests and orchestrator typecheck pass;
- no runtime implementation starts until contract names are stable.

## Commit 2: deterministic per-project scheduler

### Mini-agent task B

Files:

- add `apps/orchestrator/src/projects/project-commit-scheduler.ts`
- add `apps/orchestrator/src/projects/project-commit-scheduler.test.ts`
- export from `apps/orchestrator/src/projects/index.ts`.

Define injected interfaces for clock, timer scheduling, commit executor, dirty-project
discovery, and status publication. Production defaults may wrap `Date.now`,
`setTimeout`, and `clearTimeout`; tests use a manual deterministic clock.

Implement:

1. one state record per project;
2. `noteAcceptedSave(projectId, sourceModifiedAt, persistedAt)` that increments a
   generation and resets the deadline;
3. timer callback that reacquires/checks generation and deadline before executing;
4. independent project timers;
5. explicit `clean`, `waiting`, `committing`, `retry-wait`, and
   `settled-metadata-only` status;
6. retry scheduling without a tight loop;
7. newer saves superseding failed or waiting generations;
8. startup scheduling from discovered dirty-path timestamps;
9. disposal that cancels timers without forcing commits;
10. status lookup used by HTTP routes.

Tests, all with fake time:

- no execution before 120,000ms;
- execution exactly at the deadline;
- repeated notes reset the full delay;
- stale callback exits after a newer generation;
- two projects execute independently;
- executor metadata-only result settles without rescheduling;
- failure enters retry state and preserves generation;
- newer save supersedes retry;
- startup uses remaining elapsed quiet time;
- disposal cancels callbacks.

Lead-agent gate:

- scheduler tests complete below two seconds;
- scheduler contains no Git, Express, filesystem, or frontend imports.

## Commit 3: Git cumulative-diff executor

### Mini-agent task C

Files:

- `apps/orchestrator/src/projects/git-store.ts`
- focused new or existing GitStore tests;
- `apps/orchestrator/src/projects/semantic-commit.ts` and tests only if a reusable
  HEAD-to-worktree message helper is required.

Implement a lock-aware operation used by the scheduler that:

1. reads HEAD `project.json` and current worktree `project.json`;
2. computes semantic changes with ignored metadata removed;
3. reports metadata-only without staging;
4. derives exact worktree changes under `project.json` and `media/`;
5. rejects unexpected staged or worktree paths;
6. resets only transaction-owned stale index entries;
7. stages the derived allowlist;
8. verifies expected name/status entries;
9. invokes staged manifest/LFS audit through a callback while still locked;
10. commits with a cumulative deterministic message and returns a complete receipt;
11. unstages owned paths after pre-ref failure without modifying worktree bytes.

Do not use or extend fire-and-forget `commitAsync`; remove it if no compatibility caller
exists.

Tests:

- multiple worktree edits become one commit;
- metadata-only yields no commit and clean index;
- media addition is staged as LFS and included;
- unexpected `.DS_Store` or other path fails visibly;
- pre-commit failure restores clean index but dirty worktree;
- concurrent save operation cannot interleave under the project lock;
- different projects remain concurrent.

Lead-agent gate:

- inspect the actual Git diff and index after every failure-path test;
- retain strict allowlist behavior.

## Commit 4: foreground save becomes durable and deferred

### Mini-agent task D

Files:

- `apps/orchestrator/src/projects/save-transaction.ts`
- `apps/orchestrator/src/projects/save-transaction.test.ts`
- destructive-change or media-manifest tests only where behavior genuinely changes.

Refactor the accepted-save transaction:

1. preserve base revision, destructive intent, media completeness, filename allocation,
   and per-project locking;
2. preserve the journal until project JSON and promoted media are durable;
3. audit promoted media from worktree bytes without staged-pointer requirements;
4. do not stage or commit in the request;
5. remove the journal before returning success;
6. remove consumed/redundant pending upload records;
7. return canonical project data and a deferred receipt using the existing confirmed
   hashes, new `sourceModifiedAt`, positive `persistedAt`, and scheduler `commitDueAt`;
8. notify the scheduler only after foreground durability succeeds;
9. keep exact-byte and metadata-only saves valid without Git commits;
10. ensure recovery rolls back only a transaction that was never acknowledged.

The scheduler dependency must be an explicit typed callback/interface, not a module
global.

Tests:

- project bytes are readable before the promise resolves;
- HEAD and index remain unchanged;
- pending media is promoted but unstaged;
- deferred receipt retains confirmed hashes and new source timestamp;
- scheduler is not notified after validation/audit/write failure;
- scheduler is notified once after durable success;
- restart recovery never restores HEAD over an acknowledged dirty snapshot;
- subsequent saves use confirmed hashes plus latest source timestamp;
- commit failure is outside and cannot roll back foreground save.

Lead-agent gate:

- run save transaction, destructive-change, media-manifest, and GitStore suites together.

## Commit 5: backend wiring, startup recovery, and status API

### Mini-agent task E

Files:

- `apps/orchestrator/src/projects/routes.ts`
- `apps/orchestrator/src/projects/routes.test.ts`
- `apps/orchestrator/src/app.ts`
- `apps/orchestrator/src/index.ts`
- minimal project discovery helpers and their tests.

Implement:

1. construct one scheduler per orchestrator application;
2. inject it into the project router/save transaction;
3. keep create/import/migration/administrative rename synchronous;
4. change PUT logging from “Git commit confirmed” to durable/deferred terminology;
5. add lightweight `GET /api/projects/:id/persistence-status`;
6. status endpoint validates project ID and returns the scheduler/confirmed state;
7. on startup discover dirty worktrees, classify semantic versus metadata-only changes,
   and reconstruct remaining delay from newest changed-path mtime;
8. expose application disposal for tests and graceful server shutdown;
9. SIGINT/SIGTERM close the HTTP server and dispose timers without forcing commits;
10. surface background failures in status/logs without leaking stack traces to clients.

Tests:

- PUT returns before a controlled background commit completes;
- status transitions waiting -> committing -> clean;
- route keeps synchronous operations synchronous;
- invalid/missing project status handling;
- startup dirty and metadata-only classification;
- shutdown cancels timers;
- no open handles remain after tests.

Lead-agent gate:

- route suite and typecheck pass;
- verify no fire-and-forget promise rejection.

## Commit 6: frontend deferred-base and confirmation flow

### Mini-agent task F

Files:

- `apps/web/src/stores/persistence-status-store.ts` and tests;
- `apps/web/src/services/backend-save.ts` and tests;
- `apps/web/src/components/editor/Toolbar.tsx` and focused tests.

Implement:

1. validate deferred receipts as strictly as committed receipts, including existing Git
   hashes, positive `persistedAt`, and `commitDueAt`;
2. `markDeferred(projectId, receipt)` advances `baseRevision` to confirmed hashes plus
   the deferred `sourceModifiedAt`;
3. retain the previous `confirmedReceipt` until background confirmation;
4. schedule one status poll at `commitDueAt`, with bounded follow-up polling only while
   waiting/committing/retry-wait;
5. cancel polling on newer save, project switch, reset, terminal conflict, or disposal;
6. accept committed confirmation only for the latest source timestamp;
7. update canonical filenames immediately from the deferred PUT response;
8. present waiting, committing, and retry state accurately in the toolbar;
9. never trigger an additional project save merely to learn commit status.

Tests use fake timers and mocked fetch:

- valid deferred receipt advances only base revision;
- malformed deferred receipts fail;
- next save submits latest deferred source timestamp;
- poll begins at due time and stops on clean confirmation;
- stale confirmation is ignored;
- newer save replaces prior poll;
- project switch/disposal cancels poll;
- retry state remains visible without a tight request loop.

Lead-agent gate:

- backend-save and status-store suites pass under fake time;
- no browser work begins until these deterministic tests pass.

## Commit 7: integrated verification and operational evidence

### Lead agent, with optional read-only mini-agent reviewers

Run:

1. orchestrator typecheck;
2. core persistence tests;
3. scheduler tests;
4. GitStore allowlist/concurrency/LFS tests;
5. save transaction, route, destructive-change, and recovery tests;
6. web backend-save/status/toolbar tests;
7. `git diff --check`;
8. repository-required lint/typecheck gates.

Add one integration test using a short configured delay and real temporary Git
worktree. It must prove:

- PUT response observes durable worktree bytes;
- HEAD remains unchanged before fake/short deadline;
- multiple saves produce one cumulative commit;
- committed project and media match the latest accepted snapshot;
- status returns the final confirmed receipt;
- worktree and index are clean except permitted metadata-only drift.

Then run browser verification:

1. start orchestrator and web app;
2. load an existing project by URL;
3. make a semantic edit;
4. prove `project.json` changes immediately;
5. prove HEAD does not change before the configured test delay;
6. prove one commit appears after quiet;
7. confirm toolbar transitions through deferred to persisted;
8. check browser and server consoles for errors.

Record exact commands and evidence in the final handoff. Do not weaken the production
120-second default to make browser verification faster; use an environment override.

## Required lead-agent review before completion

The lead agent must explicitly inspect and explain:

- why no acknowledged worktree write can be lost on commit failure or restart;
- why stale timers cannot commit before the newest deadline;
- why the next save after a deferred receipt does not conflict with itself;
- why media is not left staged during the debounce window;
- why metadata-only worktrees do not create commits or startup loops;
- why unrelated worktree files cannot enter a commit;
- how background errors become observable;
- whether any generated files, secrets, `.env` files, or binaries are staged.

Commit each numbered layer separately using conventional commit messages. Never bypass
hooks. Push the implementation branch only after all required tests and browser
verification pass.
