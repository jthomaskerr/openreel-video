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
