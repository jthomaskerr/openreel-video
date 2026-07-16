# Project persistence identity contract

## Project identity

`Project.id` is an immutable backend-reserved slug. The project display name is mutable and never changes the slug. The frontend must not manufacture project IDs or reconcile a client UUID to a backend project during normal runtime.

The backend reserves colliding names atomically with deterministic suffixes such as `project`, `project-2`, and `project-3`. Concurrent creates cannot receive the same slug.

## Creation

Creation is backend-first and online-only:

1. The user explicitly requests a new project.
2. The frontend calls the backend create endpoint without activating a local project.
3. The backend reserves the slug, commits the project, and returns the canonical project plus a complete persistence receipt.
4. The frontend validates and confirms the receipt.
5. Only then may the project become editable or autosave-capable.

A failed create or incomplete receipt leaves the previous project unchanged and editing disabled for the attempted project.

## URL startup

A supplied `projectId` is authoritative. Both `/#/editor?projectId=<slug>` and `/?projectId=<slug>#/editor` load exactly that slug. Startup failure is visible and non-mutating. It must never fall back to project creation, local autosave recovery, name matching, or another project ID.

The editor remains gated while identity and receipt resolution are pending. The unresolved store sentinel is not a project identity and must never be autosaved.

## Persistence receipts

Every writable project has a confirmed base revision containing matching `projectId`, `commitSha`, `treeSha`, and `projectBlobSha`. A save sends that base and advances it only after validating a complete committed response. Missing, incomplete, or mismatched receipts keep persistence disabled.

### Deferred save receipts

The scheduling rules that decide whether a save has a commit deadline are owned by
[Project save and commit lifecycle](./project-lifecycle.md#quiet-period-semantics).

An accepted ordinary project PUT writes the submitted snapshot to the worktree
immediately and returns before Git commit. Its receipt has:

- `saved: true`;
- `committed: false`;
- the current project ID and newly written `sourceModifiedAt`;
- a finite positive `persistedAt` recording completion of the durable worktree write;
- the existing confirmed `commitSha`, `treeSha`, and `projectBlobSha`;
- `commitDueAt`, equal to the lifecycle scheduler's current deadline or `null` when no
  semantic commit is pending;
- the canonical project snapshot, including backend-allocated media filenames.

The existing Git hashes identify the confirmed base; they do not claim that the new
worktree bytes are committed. The frontend validates all three hashes and advances its
next submitted base revision to those hashes plus the new `sourceModifiedAt`. It keeps
the last confirmed receipt separately and displays the save as awaiting commit.

A deferred response with missing confirmed hashes, a mismatched project,
non-monotonic `sourceModifiedAt`, invalid `persistedAt`, or invalid `commitDueAt` is not
a successful save.

### Background commit confirmation

After the quiet period, a successful background commit produces a normal receipt with
`committed: true` and hashes for the cumulative committed snapshot.

The backend exposes lightweight per-project persistence status so the frontend can
confirm the eventual commit without repeatedly downloading the complete project. Its
phase uses the lifecycle states defined in
[Per-project lifecycle](./project-lifecycle.md#per-project-lifecycle).

The frontend polls only while a project is deferred, beginning at `commitDueAt`, and
stops after a matching committed receipt, project change, project switch, terminal
error, or disposal. A confirmed receipt is accepted only when its
`sourceModifiedAt` matches the latest saved snapshot.

`persistedAt` means durable worktree persistence for a deferred receipt and confirmed
commit persistence for a committed receipt. Callers must inspect `committed` rather
than infer commit state from `persistedAt`.

### Conflict base while deferred

Conflict checks combine:

- the confirmed commit, tree, and project blob hashes; and
- the `sourceModifiedAt` of the latest authoritative worktree snapshot.

This permits successive saves during the debounce window while rejecting clients based
on an older worktree snapshot. A background commit changes the confirmed hashes but not
the logical project contents. A save racing that commit must receive or resolve against
the new confirmed base under the same project lock.

Commit eligibility, cumulative diff construction, path allowlisting, and LFS
verification are defined only in
[Background commit transaction](./project-lifecycle.md#background-commit-transaction).

## Recovery

Recovery is slug-only and bounded:

1. Read the local autosave.
2. Quarantine it if its project ID is a UUID.
3. Load the exact backend slug and confirm its base revision.
4. Reject a missing or mismatched backend project.
5. Upload locally stored media and make at most one recovery save.
6. Reload the confirmed project before activating it.

Recovery never creates a replacement project. Every attempt returns success or a visible terminal error, and UI controls must leave `Recovering...` after false or rejection.

## Required regression evidence

- Router tests for both supported URL forms.
- No-create tests for requested-slug load failure.
- Backend-first create and confirmed-receipt tests.
- Concurrent collision-safe slug reservation tests.
- Rename-preserves-slug tests.
- UUID quarantine tests.
- Recovery base-before-save, one-save, mismatched-slug, and terminal-dialog tests.
- Live browser verification against the frontend and orchestrator, including network proof of zero create requests during URL startup.
