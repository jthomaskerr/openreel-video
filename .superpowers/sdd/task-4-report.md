# Task 4 implementation report

## Status

Implemented the durable Resolve export job and artifact service in one backend-owned project-store workflow.

## TDD evidence

- RED 1: both focused suites failed because `./job-store` and `./service` did not exist.
- RED 2: artifact paths rebound to a different job were accepted; the persisted-record validator now requires the exact `exports/resolve/{jobId}/` prefix.
- RED 3: unknown persisted fields could smuggle plaintext token material; job, selection, token, artifact, and result records are now strict.
- RED 4: a token remained usable at exactly five minutes; expiry now uses the five-minute boundary, not one millisecond after it.
- GREEN: `job-store.test.ts` and `service.test.ts` pass 20/20, including persistence recovery, atomic temp/rename, path confinement, revision locking, incomplete media, exact hashing/allowlists, hash-only expiry/single-use tokens, concurrent redemption, cancellation, result idempotency/conflicts, exact referenced-media marking for success/failure/empty lists, and rollback after result-write or Git failure.

## Implementation

- `ResolveExportJobStore` atomically writes and fsyncs `job.json` and artifacts, validates strict persisted records, recovers jobs by scanning project IDs, serializes per-job updates, and never persists a bearer token or launch URL.
- `ResolveExportService` locks the confirmed Git revision, audits canonical media, builds compatibility/FCPXML/media-map/report artifacts, hashes closed on-disk bytes, and commits an exact export allowlist.
- Launch tokens are opaque UUIDs, stored as SHA-256 only, expire at five minutes, and are redeemed once under a serialized job update. Lifecycle state changes are committed as exact `job.json` transactions.
- Import results verify the exact FCPXML digest, are idempotent by full strict result value, mark only explicitly referenced media (including failed imports), and commit `project.json`, `result.json`, and `job.json` together. Failed writes or commits restore prior bytes and unstage the exact allowlist.
- All paths returned to callers are project-relative. Media binaries remain in canonical project-store `media/` and are not copied.

## Verification

- Focused tests: 20 passed, 0 failed; 936 ms test execution.
- Orchestrator TypeScript: `node apps/orchestrator/node_modules/typescript/bin/tsc -p apps/orchestrator/tsconfig.json --noEmit` passed with no output.
- Serena diagnostics: no warnings or errors in `job-store.ts`, `job-store.test.ts`, `service.ts`, or `service.test.ts`.
- Security review: checked races, partial writes, token leakage, artifact path rebinding, exact Git scope, idempotent retries, and rollback behavior.

## Failure modes

- Missing/unconfirmed/stale projects fail before artifact creation with typed identifiers.
- Incomplete canonical media or blocked compatibility fails before export commit.
- Expired, consumed, or invalid launch tokens fail without exposing token material.
- Corrupt persisted jobs, conflicting import results, unknown referenced media, and artifact digest mismatches fail closed.
- Artifact, result, project, job-state, or Git failures surface stable typed errors; rollback restores pre-transaction bytes where mutation began.

## Corrective review round

### RED evidence

- Five confinement tests initially failed because persisted records could rebind physical project/job identity and symlinked `exports`, `resolve`, or job directories were not rejected.
- Lifecycle tests initially allowed result submission before redemption, cancellation while importing, terminal-job revival, and nondeterministic cancel/redeem races.
- The exact-snapshot regression test proved a dirty worktree with the same `modifiedAt` could be exported instead of the confirmed Git commit.
- The first journal test simulated a crash after one file publish and proved there was no durable before-image protocol.
- After adding recovery scaffolding, TypeScript reported the unused transaction path and missing `readFileAtCommit` fake, confirming public mutations were still using the old direct-write path.

### Corrective implementation

- Every start, cancel, redeem, and import-result mutation now uses one durable transaction protocol: an fsynced journal records before/after images and SHA-256 digests, each published path is durably marked, Git stages and verifies the exact expected entries, and the journal is removed only after the ref update is confirmed.
- Startup recovery compares every journal after-image with the authoritative confirmed Git ref. It rolls forward committed generations or restores all before-images for uncommitted generations, emits sanitized `rolled-forward`/`rolled-back` diagnostics, and is idempotent across another fresh service instance.
- Git exposes lifecycle hooks after staging, after tree creation, before ref update, and after ref update. `readFileAtCommit` supplies the authoritative committed bytes used by reconciliation.
- Export planning reads `project.json` from the requested confirmed commit and rejects worktree bytes whose Git blob SHA differs from the confirmed receipt, even when metadata timestamps match.
- Stored `projectId` and `job.id` must match their physical load location. Symlinked managed export directories are rejected and real paths must remain contained by the project root.
- The lifecycle table permits only `ready -> importing` by redemption, `ready -> cancelled` by cancellation, and `importing -> completed|failed` by result submission. Project-level Git serialization makes cancel/redeem races deterministic.
- Token-digest lookup and redemption use `timingSafeEqual`. Transaction cleanup no longer uses silent suppression; recovery failures surface the sanitized `RECOVERY_FAILED` error.
- Import completion writes the backend-owned `externallyReferenced` media marker in the same journaled Git transaction as `result.json` and `job.json`. Existing project-store invariants allow metadata updates while rejecting deletion, marker clearing, or canonical-path replacement for those media records.

### Crash-recovery evidence

- Start: 8/8 crash points pass, covering all four published files plus Git stage, tree, before-ref, and after-ref boundaries.
- Cancel: 5/5 crash points pass, covering its published `job.json` plus all four Git boundaries.
- Redeem: 5/5 crash points pass, covering its published `job.json` plus all four Git boundaries.
- Import result: 7/7 crash points pass, covering `job.json`, `result.json`, `project.json`, and all four Git boundaries.
- Each pre-ref crash restores the prior lifecycle/project/artifact state. Each after-ref crash rolls forward to the committed state. A second fresh service finds no journal and preserves the recovered state.

### Final verification

- Resolve focused suites: 56 passed, 0 failed (`job-store.test.ts`: 14; `service.test.ts`: 42).
- Real Git-store allowlist and concurrency suites: 8 passed, 0 failed, including production hook ordering and committed-file reads.
- Orchestrator TypeScript: `tsc -p apps/orchestrator/tsconfig.json --noEmit` exited 0.
- Serena diagnostics: no warnings or errors in all six changed source/test files.
- `git diff --check` exited 0.

## Fix Round 2

### RED evidence

- Thirteen corrupt-journal cases exposed eleven integrity failures: tampered before/after images, malformed or duplicate writes, invalid published paths, noncanonical base64, unknown keys, invalid kind/timestamp/base SHA, an empty write set, and physical job/transaction rebinding.
- Six recovery cases proved the classifier trusted ambiguous Git reads: receipt failure, committed-file read failure, invalid current SHA, ancestry failure, a conflicting descendant, and a corrupt pending image all proceeded instead of failing closed.

### Corrective implementation

- Transaction journals now require an exact schema, full base commit SHA, canonical timestamps and base64, matching before/after SHA-256 digests, a nonempty unique confined write set, and project/job/transaction identities bound to the physical journal location. The complete journal is validated and every image decoded before any publish, restore, or deletion mutation.
- Git recovery reads now distinguish proven absence from operational failure, validate full commit identities, prove committed-path presence before reading, and classify ancestry with `merge-base --is-ancestor`.
- Recovery rolls back only when the authoritative ref exactly equals the journal base. Roll-forward requires a descendant ref and exact after-image hashes for every committed path. Missing, invalid, conflicting, or unreadable Git state returns sanitized `RECOVERY_FAILED` with safe project/job identifiers before any unstage, file restore, or journal deletion.

### GREEN evidence

- Journal suite: 27 passed, 0 failed, including all thirteen corrupt-journal regressions.
- Resolve service suite: 48 passed, 0 failed, including all six fail-closed recovery regressions and the existing 25-point crash matrix.
- Real Git-store allowlist and concurrency suites: 9 passed, 0 failed, including strict present/absent reads, invalid revision rejection, and both ancestry outcomes.
- Orchestrator TypeScript: `tsc -p apps/orchestrator/tsconfig.json --noEmit` exited 0 with no output.
