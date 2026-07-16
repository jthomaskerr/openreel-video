# Project save and commit lifecycle

## Status and relationship

This specification normatively owns scheduling, commit eligibility, Git execution,
concurrency, restart, and failure handling between an accepted project `PUT` and its
eventual Git commit.

[Project persistence identity contract](./project-persistence.md) separately owns
project identity, save-receipt fields, conflict bases, and frontend confirmation. This
file links to that contract instead of restating it. The broader project lifecycle
remains documented in [Project Lifecycle Persistence](./project.md).

See the
[project-save integrity verification runbook](../runbooks/project-save-integrity-verification.md)
for read-only receipt, Git, and LFS checks.

## User-visible outcome

Every accepted project save is durably and atomically written to its project worktree
before the HTTP response is returned. Git history advances once, in the background,
after that project has received no newer semantic change for 120 seconds.

The 120-second quiet period is backend configuration, not a frontend delay. Its
default is `120_000` milliseconds and it must be exposed by the orchestrator
configuration as `projectCommitDebounceMs`.

## Scope

The debounce applies to ordinary `PUT /api/projects/:id` saves.

These operations remain synchronous because they establish or administratively change
the confirmed base:

- project creation;
- project import;
- legacy project migration;
- explicit administrative rename operations.

Media upload remains a separate pending operation. A project save that references a
pending upload must promote the media bytes and project JSON into the worktree before
returning, but Git staging and LFS pointer verification occur in the background commit.

## Per-project lifecycle

Each project has an independent lifecycle:

1. `clean`: the worktree has no semantic change relative to HEAD;
2. `dirty`: at least one accepted save is durably present but not committed;
3. `waiting`: a commit deadline is scheduled for 120 seconds after the latest accepted
   semantic change;
4. `committing`: the deadline has elapsed and the worker holds the project Git lock;
5. `retry-wait`: the worktree remains authoritative after a commit failure and a retry
   is scheduled;
6. `settled-metadata-only`: the only difference from HEAD is ignored metadata such as
   `modifiedAt`, so no commit is required.

One project must never delay or commit another project.

## Accepted-save transaction

Under the existing per-project transaction lock, the backend must:

1. recover any interrupted foreground save;
2. validate the submitted base revision against the current worktree and confirmed
   Git revision;
3. enforce destructive-change intent and required-media completeness;
4. allocate canonical media filenames;
5. write a recovery journal before moving pending media;
6. promote referenced pending media;
7. audit the proposed snapshot against worktree media without requiring staged LFS
   pointers;
8. atomically write and fsync `project.json`, then fsync its directory;
9. remove the foreground recovery journal and obsolete pending-upload records;
10. classify whether the accepted snapshot changed semantic state;
11. schedule or reset that project's commit deadline only for a semantic change;
12. return the deferred save receipt defined by
    [Project persistence identity contract](./project-persistence.md#deferred-save-receipts).

The response must not wait for Git staging, LFS pointer verification, or `git commit`.
No acknowledged worktree write may be rolled back merely because a later background
commit fails.

## Quiet-period semantics

The backend compares the newly accepted authoritative snapshot with the previously
authoritative worktree snapshot using the canonical semantic comparison that excludes
`modifiedAt`.

A save resets the same project's deadline only when that comparison contains at least
one semantic project or media change.

Changing `modifiedAt` and nothing else:

- is still written durably to `project.json` before the PUT returns;
- does not create a timer when no semantic commit is pending;
- does not reset or extend an existing timer;
- does not create a Git commit.

If a semantic commit is already pending, a later `modifiedAt`-only write leaves its
original deadline unchanged. The eventual semantic commit may contain the newest
`modifiedAt` value alongside the pending semantic changes.

When the timer fires, the worker must acquire the project Git lock and recheck the
generation and deadline inside the lock. If a newer save has arrived, the stale worker
must exit without staging or committing.

The worker compares the complete current worktree snapshot with HEAD, not with the
snapshot from the most recent request. It creates one cumulative commit containing all
semantic changes accepted during the quiet period.

`modifiedAt` and other explicitly ignored metadata do not make a semantic commit. A
metadata-only worktree difference is left uncommitted and must not be rescheduled
forever. The next semantic commit may include the latest metadata value alongside its
semantic changes.

## Background commit transaction

The worker must:

1. recover/reset transaction-owned stale index state;
2. read the committed project snapshot from HEAD and the current worktree snapshot;
3. return successfully without a commit if no semantic change exists;
4. audit the current required-media manifest;
5. derive the exact changed paths, restricted to `project.json` and project media;
6. stage only those paths;
7. verify staged LFS pointers and payload integrity;
8. build a deterministic cumulative semantic commit message;
9. commit under the same per-project Git lock;
10. publish the new confirmed receipt and clear pending scheduler state.

Unexpected or unallowlisted worktree/index paths must fail the commit visibly and remain
uncommitted. The existing fire-and-forget `GitStore.commitAsync()` is not a valid
implementation because its failures are not observable and it has no quiet-period
generation check.

## Concurrency

- A save and background commit for the same project are serialized by the same lock.
- A save accepted before the worker obtains the lock invalidates that worker generation.
- A semantic save accepted after a worker commits starts a new 120-second period from
  that save.
- Different projects may save and commit concurrently.
- A stale client base is rejected even when newer state is durable only in the
  worktree.

## Restart, crash, and shutdown

Foreground recovery journals protect only unacknowledged save transactions. Once a PUT
has returned success, its dirty worktree is authoritative and recovery must not restore
HEAD over it.

At startup, the orchestrator scans project worktrees for semantic differences from HEAD.
For each dirty project it reconstructs the remaining quiet period from the newest
changed-path modification time. If the quiet period already elapsed, the project is
eligible immediately. Metadata-only differences are classified as settled and are not
continually rescheduled.

If a process exits after staging but before committing, startup recovery resets only
transaction-owned allowed paths, re-audits the worktree, and reschedules the commit.

Graceful shutdown cancels in-memory timers but does not force an early commit. Durable
worktree state is recovered and scheduled at the next startup.

Commit failures never discard acknowledged worktree data. They enter observable retry
state and retry without a tight loop. A newer semantic save supersedes the failed
generation and starts a fresh quiet period. A `modifiedAt`-only save updates the
authoritative worktree but does not postpone that retry.

## Required evidence

Deterministic tests must prove:

- worktree JSON and promoted media are visible before a PUT returns;
- HEAD and commit count remain unchanged during the quiet period;
- repeated saves reset the deadline precisely;
- a `modifiedAt`-only save never creates, resets, or extends a deadline;
- a `modifiedAt`-only save during a pending semantic change leaves the original
  deadline unchanged;
- exactly one cumulative commit occurs after 120 seconds of quiet;
- metadata-only saves never create a commit;
- projects have independent timers and locks;
- a save racing a timer invalidates the stale worker;
- staged LFS verification occurs at commit time;
- failures preserve dirty worktree state and retry observably;
- restart recovery schedules semantic dirt and ignores metadata-only dirt;
- creation, import, migration, and administrative rename remain synchronous;
- no test depends on wall-clock sleeps.
