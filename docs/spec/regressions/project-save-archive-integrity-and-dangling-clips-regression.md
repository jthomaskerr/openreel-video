# Project-save regression: archive integrity, truthful commits, and dangling clips

## Status and scope

**Status:** Reproduced from the `vintage-tokyo` repository and current source. Specification only. No product code or project data was changed during this investigation.

This regression records a compound data-loss failure in which project snapshots, archived media, Git commit descriptions, and missing-media UI disagree. It extends, and does not replace:

- `docs/spec/backend-persistence-versioning.md`, especially §§14.1.1, 14.2.3–14.2.4, 14.3.1–14.3.5, 14.5.3–14.5.6, and 14.6;
- `docs/spec/regressions/project-save-regression.md`;
- `docs/spec/regressions/project-save-missing-media-regression.md`;
- `docs/spec/2026-07-08-backend-save-worktree-race-fix.md`;
- `docs/spec/2026-07-10-media-title-from-metadata-design.md`;
- `docs/spec/media-import-timeline.md`;
- `docs/spec/project-lifecycle.md` §§9.4–9.5; and
- `docs/spec/regressions/media-pane-missing-filter-toolbar-regression.md`.

Where `project-lifecycle.md` §9.4.1 still says commits are fire-and-forget, the later confirmed-commit contract in `backend-persistence-versioning.md` §14.2.4 and `project-save-regression.md` controls. A successful save must wait for and identify the corresponding commit.

## Measurable user-visible outcome

A successful project save or archive is a self-consistent, recoverable snapshot. It contains the complete submitted project structure and every required original media object; its Git commit describes exactly the staged change set; semantic media names remain visible in the UI; and every dangling clip is explicitly marked missing rather than displayed as an unexplained identifier.

## Incident evidence

Repository inspected read-only: `~/openreel-projects/vintage-tokyo`, branch `project/vintage-tokyo`.

The last snapshot found before the destructive test loop is:

`aa77e71d8b59f2b6939eac7c2b33c44b3dfbc252` (`2026-07-13 12:41:40 +10:00`).

At that commit:

- `project.json` is 402,074 bytes;
- the media library has 28 items;
- the timeline has 5 tracks and 13 clips;
- the tree has 38 UUID-named paths under `media/`; and
- the media paths are Git LFS pointers, so recovery additionally depends on the matching LFS objects being present locally or remotely.

The loop begins immediately afterward. Commits alternate between a roughly 602-line full project and a 36-line test-shaped project. Examples include `bc76e83` adding 566 lines followed one second later by `df798ea` deleting 566 lines. The loop later commits `media/healthy-1.mp4` (`571f8d9`) and `media/missing-1.mp4` (`a3587a4`). Current `HEAD` differs from the candidate by those two test files, `.DS_Store`, and changed `project.json`.

The incident history contains commit subjects such as `update project with 62 semantic changes` while the actual Git commit may also contain media or `.DS_Store` changes not represented by that message. This is a direct mismatch between semantic-message input and staged content.

The recovered project JSON retains semantic `MediaItem.name` values such as `car pulls up.mp4`, `door opens.mp4`, and `Just Down.srt`, while the physical archive paths use `<mediaId>.<ext>`. This UUID physical naming is a functional-spec defect. `backend-persistence-versioning.md` §§14.2.1, 14.3.1, and 14.3.2 must be corrected: persisted media files SHALL use safe, real filenames derived from the user-visible project filename, not media UUIDs. The project JSON filename and the persisted basename are one invariant and must always agree.

When the desired filename already exists in the project media directory, the save/import transaction SHALL select the first available filename by appending ` <n>` immediately before the final extension, beginning at `1`. For example, `car pulls up.mp4`, `car pulls up 1.mp4`, and `car pulls up 2.mp4`. Collision comparison SHALL use the target filesystem's effective case-sensitivity and Unicode normalization rules. The chosen collision-free name SHALL update both the persisted file and the corresponding project filename field before either is committed. IDs remain stable internal identity; they are not filenames.

## Noncompliance matrix and source locations

| ID | Observed noncompliance | Violated contract | Current source location and observation |
|---|---|---|---|
| PSAR-1 | A project snapshot is written and committed without proving that all referenced original media exist. | `backend-persistence-versioning.md` §14.5.4; `project-save-missing-media-regression.md` Backend contract. | `apps/orchestrator/src/projects/routes.ts:204` PUT handler loads the prior project and calls `store.saveProject(incoming)` without `scanMedia`, an ID audit, or a `409 MEDIA_INCOMPLETE` path. |
| PSAR-2 | The backend mutates `project.json` before it can establish snapshot integrity. | Missing-media regression requires no temporary/final write or commit on incomplete media. | `apps/orchestrator/src/projects/project-store.ts:135` `ProjectStore.saveProject()` writes a temporary JSON file and renames it over the authoritative file. The caller performs no pre-write completeness gate. |
| PSAR-3 | Commits can include arbitrary unreported additions and deletions from the worktree. | Immutable media in §14.3.1; truthful, complete commit contract in `project-save-regression.md`. | `apps/orchestrator/src/projects/git-store.ts:298` `GitStore.#commitInner()` executes `git add -A`, staging every deletion, test artifact, `.DS_Store` change, and unrelated file mutation. There is no expected-path allowlist or staged-diff validation. |
| PSAR-4 | Commit messages are derived from one data source while Git commits a broader data source. | `project-save-regression.md` requires a succinct subject and a body listing all semantic changes across all changed files. | `apps/orchestrator/src/projects/routes.ts:226` computes `semanticProjectChanges(prev, saved)` only from project JSON. `apps/orchestrator/src/projects/semantic-commit.ts:54` formats those paths and defaults to `fileCount = 1`. `GitStore.#commitInner()` then stages the whole worktree. |
| PSAR-5 | The save response can claim a committed snapshot even if the message does not correspond to the staged tree and even if media referential integrity is false. | Confirmed commit and persistence-receipt contracts in §§14.2.4 and 14.5.5. | `apps/orchestrator/src/projects/routes.ts:238` returns committed success after `gitStore.commit`, but does not return the commit SHA, tree ID, project blob ID, media manifest digest, or completeness result. |
| PSAR-6 | Media upload success is treated independently from project membership and snapshot completeness. | Both media and metadata must be versioned together; upload and PUT form one persistence unit. | `apps/orchestrator/src/projects/routes.ts:298` commits each upload immediately with only the uploaded file name/media ID. The project JSON referencing that object may be absent, stale, or later replaced. |
| PSAR-7 | The client silently skips items whose original Blob is unavailable and proceeds to PUT. | §14.5.4 requires recovery or visible failure, never successful incomplete persistence. | `apps/web/src/services/backend-save.ts:276` maps media items, skips a non-current remote URL, then `if (!isMediaBlob(item.blob)) return;`; it performs PUT regardless. There is no file-handle recovery or structured 409 reconciliation. |
| PSAR-8 | Upload deduplication can suppress a required upload based on session state rather than authoritative stored content. | §14.3.3 requires exact URL HEAD proof and retryable failed/missing IDs. | `apps/web/src/services/backend-save.ts:207` returns early when `uploadedIds` contains the project/media key. The set records an earlier HTTP upload, not membership in the exact snapshot being committed. |
| PSAR-9 | A clip whose `mediaId` has no media-library entry is not classified as missing. | Missing-media regression requires every dependent clip to show a persistent accessible error marker. | `apps/web/src/components/editor/timeline/ClipComponent.tsx:146` sets `mediaStatus` to `null` when `mediaItem` is absent, so `isMissingMedia` is false. Dangling references are therefore unmarked. |
| PSAR-10 | Dangling clips display an identifier fragment as their name. | Media-title design requires stable semantic titles; missing-media UX requires named, actionable failures. | `apps/web/src/components/editor/timeline/ClipComponent.tsx:666` falls back to `clip.mediaId.slice(0, 8)`. UUID prefixes can look like commit hashes and conceal the referential-integrity failure. |
| PSAR-11 | The archive has no validated portable manifest proving semantic name, expected size, physical path, and LFS object availability for every required item. | Import/restore specs require all referenced files; Git LFS spec makes object availability essential. | Current persisted state relies on `project.json`, UUID paths, and LFS pointers independently. The inspected tree contains 129–133-byte pointer blobs rather than embedded originals. No save receipt proves the corresponding LFS objects are retained or fetchable. |
| PSAR-12 | Test fixtures reached the real user project repository. | Project versions are authoritative user data; tests must use isolated temporary directories. | Incident commits `571f8d9` and `a3587a4` add `healthy-1.mp4` and `missing-1.mp4` to `vintage-tokyo`. Required regression tests must reject a configured projects directory outside their temporary fixture root. |
| PSAR-13 | A severe shrink of project structure is accepted as an ordinary autosave. | Save must preserve the submitted live project and must not silently replace it with an empty/stale snapshot. | The history repeatedly changes 602 lines to 36 lines and back. Neither PUT nor client save has a destructive-shrink guard, base-version precondition, or compare-and-swap token. |
| PSAR-14 | No concurrency/staleness token prevents an older or test snapshot from overwriting a newer full snapshot. | `project-save-regression.md` requires live-state reconciliation and serialized saves that do not erase concurrent edits. | PUT accepts only the project body and path ID. It has no expected commit SHA/ETag/base revision and unconditionally replaces `project.json`. |
| PSAR-15 | Media is physically persisted under UUID basenames rather than safe, real project filenames. | Corrective requirement overriding `backend-persistence-versioning.md` §§14.2.1, 14.3.1, and 14.3.2; `2026-07-10-media-title-from-metadata-design.md` requires semantic names. | The current upload path sends `${mediaId}${ext}` in `apps/web/src/services/backend-save.ts:223`, and the backend layout is specified as `<mediaId>.<ext>`. Both must instead use the resolved project filename. On collision, both the persisted file and project filename must become `<stem> <n>.<ext>`. |
| PSAR-16 | Filename collision handling is not an atomic project-state operation. | Persisted media path and project filename must remain identical and recoverable. | Current identity-based naming avoids collisions by hiding real names rather than resolving them. There is no deterministic allocator that checks the media directory, selects the first available ` <n>` suffix, updates the `MediaItem` filename, writes the file, and commits both changes atomically. |

## Required invariants

1. The authoritative snapshot is a tuple of project JSON, required media manifest, reachable original media objects, and Git commit/tree identity. None may be confirmed independently as the whole save.
2. PUT performs a non-mutating completeness and consistency audit before replacing `project.json`.
3. The commit stages an explicit allowlist produced by the save transaction. It MUST NOT use an unconstrained worktree-wide `git add -A` for a project save or media upload.
4. The generated commit message is based on the final staged diff, after staging, and covers every staged path. If the staged paths differ from the transaction allowlist, the commit fails.
5. A successful receipt includes at least `commitSha`, `treeSha`, `projectBlobSha`, `sourceModifiedAt`, and a deterministic media-manifest digest. The returned commit must contain exactly the audited snapshot.
6. Required LFS object existence is checked in local object storage and, when a remote is the durability target, confirmed uploaded before persistence is presented as durable.
7. A missing media-library item referenced by any clip is itself a missing condition. It is not dependent on `getMediaStatus(mediaItem)` because no item exists to classify.
8. Each file-backed media item has a safe real project filename. Its persisted basename and project filename field are byte-for-byte identical after the platform's defined Unicode normalization.
9. Filename collisions are resolved deterministically by selecting the lowest available positive ` <n>` suffix before the final extension. The resolver updates the persisted file and project JSON in one transaction; it never overwrites the existing file.
10. Media UUIDs remain stable internal identifiers and MUST NOT be used as persisted basenames or primary user-facing labels.
11. Semantic display names come from the persisted project filename. An ID prefix may appear only as secondary diagnostic text.
12. Tests and eval fixtures may write only beneath their assigned temporary project root. A test process must fail closed if configured with the normal user projects directory.
13. Destructive structural changes require optimistic concurrency. A stale base revision returns `409 PROJECT_CONFLICT`; it does not overwrite the current snapshot.

## Destructive-shrink policy

A large deletion can be legitimate, so size alone must not permanently block a save. It must trigger a protected path when any configured invariant is crossed, including media-library count, clip count, track count, or serialized structural size dropping beyond a deterministic threshold.

The protected path SHALL require both:

- a matching base commit/tree token proving the client edited the current version; and
- an explicit destructive-change intent for user-initiated bulk removal, or a server-side transaction whose semantic diff enumerates every removed item and dependent reference.

Autosave, test code, recovery, or stale clients must never infer destructive intent.

## Acceptance criteria

- Saving a project that references one absent original returns `409 MEDIA_INCOMPLETE`, leaves the authoritative JSON, index, working tree, HEAD, and LFS refs unchanged, and reports the missing semantic name and media ID.
- A save cannot stage `.DS_Store`, test fixtures, pre-existing deletions, or any path outside its transaction allowlist.
- A media upload cannot produce a durable orphan silently. It is either attached to a project snapshot transaction or remains explicitly pending/unreferenced and is excluded from a project persistence receipt.
- The commit body and reported file count match `git diff --cached --name-status` exactly. Media additions/deletions and project JSON changes are all represented.
- A committed receipt can be independently verified by resolving its commit/tree/blob IDs and manifest digest.
- Missing local or remote LFS objects fail durability confirmation visibly. LFS pointer presence alone is not accepted as original-media presence.
- A stale client cannot replace a newer project. It receives `409 PROJECT_CONFLICT` with current and submitted base revisions.
- A transition from 28 media items/13 clips to a test-shaped or nearly empty snapshot is rejected unless it has current-base proof and explicit destructive intent.
- Every clip with an absent media-library target renders a persistent Missing/Error marker and an accessible explanation containing the semantic name when recoverable from the manifest.
- The primary clip label never consists solely of a UUID/commit-hash-looking prefix.
- A newly saved media file is persisted under its safe real project filename, never `<mediaId>.<ext>`.
- Importing or saving `clip.mp4` when `clip.mp4` already exists persists the new file as `clip 1.mp4` and updates the new item's project filename to exactly `clip 1.mp4` before commit.
- If `clip.mp4` and `clip 1.mp4` exist, the next collision resolves to `clip 2.mp4`. Gaps use the lowest available positive suffix.
- Collision resolution never overwrites or renames the pre-existing media item and never changes either item's stable media ID.
- Test execution against `~/openreel-projects` or any non-temporary configured root fails before writing.

## Required deterministic regression tests

### Backend transaction and Git tests

- Seed a temporary repository with a complete project and media. Delete a media working-tree file out of band, then save a JSON-only edit. Assert the save fails and neither the deletion nor JSON edit is committed.
- Place `.DS_Store`, `healthy-1.mp4`, and `missing-1.mp4` as unrelated untracked files. Save a project change and assert none is staged or committed.
- Stage an allowed project JSON and media addition, generate the message from the staged diff, and assert every staged path and semantic change appears exactly once and `Files changed` is exact.
- Inject a mismatch between the audited manifest and staged tree. Assert commit aborts and HEAD is unchanged.
- Remove an LFS object while retaining its pointer. Assert archive verification fails with the media ID, semantic name, and object ID.
- Submit two saves from the same base revision. Commit the first, then assert the second returns `PROJECT_CONFLICT` and cannot replace the first.
- Reproduce the 602-line to 36-line shrink as an autosave without destructive intent and assert rejection without mutation.
- Configure the fixture with a path outside the test temp root and assert startup fails before any repository command.
- Import `clip.mp4` into an empty fixture and assert the persisted basename and project filename are both `clip.mp4`, while the media ID remains independent.
- Import a second and third `clip.mp4`; assert atomic allocation of `clip 1.mp4` and `clip 2.mp4` in both storage and project JSON with no overwritten bytes.
- Seed `clip.mp4` and `clip 2.mp4`; import another `clip.mp4` and assert the lowest free result is `clip 1.mp4`.
- Cover names with multiple dots, no extension, Unicode normalization equivalents, and case-only collisions according to the target filesystem policy.

### Frontend save tests

- Provide a media item with no Blob, no readable handle, and no proven current remote object. Assert the service does not silently PUT and exposes incomplete persistence.
- Make `uploadedIds` contain the media ID while backend HEAD/audit reports it absent. Assert the original is re-uploaded or the save fails visibly.
- Return `MEDIA_INCOMPLETE`, recover one original, retry once, and verify no recursive retry and no stale-snapshot overwrite.

### Timeline and media UI tests

- Render a clip whose `mediaId` has no media-library entry. Assert it has a missing marker, accessible label, repair action, and semantic manifest title; assert the UUID prefix is secondary only.
- Render one missing media item referenced by multiple clips and assert every clip is marked.
- Resolve/relink the item, obtain a confirmed receipt, and assert markers clear only then.
- Cover grid, list, grouped media, compact timeline, search, and missing-only filtering so the failure cannot disappear in a view variant.

## Browser verification required for implementation sign-off

Use an isolated fixture project, never `vintage-tokyo`:

1. Load a complete project and record its receipt commit/tree/manifest identities.
2. Remove one backend original while leaving its LFS pointer or JSON reference, then reload. Confirm both the media item and every clip are marked missing.
3. Trigger autosave. Confirm `409 MEDIA_INCOMPLETE`, failed persistence UI, no new commit, and unchanged last-good project JSON.
4. Relink the correct original, save, reload, and verify the semantic clip name and marker clearing.
5. Simulate a stale tab and a destructive shrink. Confirm `PROJECT_CONFLICT` and preservation of the newer full project.
6. Inspect the resulting commit and verify its message, staged file list, manifest, and LFS object availability agree.

## Important failure modes

- Checking only filesystem filenames misses absent LFS payloads behind valid pointers.
- Auditing after `saveProject()` is too late because the authoritative JSON has already been replaced.
- Allowlisting only additions but not intentional removals can leave stale objects; removals must be explicit transaction entries with dependency validation.
- Generating a message before staging recreates the observed message/content mismatch.
- Treating a missing media-library row as `mediaStatus = null` suppresses the most serious missing-reference case.
- Restoring only commit `aa77e71` may recover project structure but not playable media if the corresponding LFS objects are unavailable.
- Using the real projects directory in tests can repeat the incident even if assertions later fail.

## Recovery note for `vintage-tokyo`

The identified structural restoration candidate is `aa77e71d8b59f2b6939eac7c2b33c44b3dfbc252`. Do not reset or check out the user repository without explicit approval. Before restoration, preserve the current branch/ref, inventory all required LFS OIDs, verify which objects are locally present or fetchable, and restore into a separate recovery worktree or directory for comparison. The candidate is evidence for the last full pre-test structure, not proof that every original media payload is recoverable.

## Backend-outage clarification

Archive integrity is a durable snapshot fact; runtime media availability is session state. A dangling clip whose media-library target is absent is `confirmed_missing`, but a present backend-identified media item without a current Blob is not. It begins `verifying`, and transport/server/browser failure becomes `temporarily_unavailable`; authorization and decode failures remain distinct. Only authoritative mapping/object absence after race-safe verification and applicable local recovery checks enables the Missing/Relink workflow.

The implementation plan SHALL therefore include bounded, deduplicated, cancellable, project/version-scoped verification; atomic cross-surface updates; recovery without reload; and regression coverage proving backend outage, HMR, `5xx`, offline, `401`/`403`, thumbnail failure, and decode failure never create false missing markers, counts, relink actions, semantic project mutations, or autosave changes.
