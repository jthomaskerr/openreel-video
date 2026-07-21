# Durable AI Generation and Storyboard Design

## Outcome

A WaveSpeed generation or storyboard request either completes durably in the intended project or reaches an explicit, actionable failure state. Generation continues when no browser is open and regardless of which project a browser currently has active. Repeated polling, process restarts, and repeated completion signals create at most one media version, one shot attempt, and one timeline clip.

The first delivery supports WaveSpeed only for generated media and local Claude Code for storyboard generation. It preserves the installed manual storyboard, Neural Frames import, project persistence, media versioning, and timeline projection behavior.

## Existing Implementation and Demonstrated Gaps

The following installed behavior is retained:

- `FileGenerationJobRepository` provides crash-safe, per-job JSON records and provider-job indexing.
- `GenerationFinalizer` provides resumable checkpoints and stable idempotency keys.
- `GenerationRecoveryService` separates provider retry, finalization retry, placement retry, and cancellation.
- `StoryboardShot`, `MusicVideoProject`, scene editing, scene/media association, Neural Frames import, and scene timeline projection already exist.
- Project saves already use confirmed revisions and an atomic media/project transaction.

The production wiring is incomplete:

- `useGenerationJobPoller` owns polling in the mounted browser application.
- It processes all locally queued jobs through the one active `projectStore`, so an inactive project's result can target the wrong project or fail.
- Closing the browser stops polling and finalization.
- The orchestrator's persistent repository and `GenerationFinalizer` are not wired into the production request lifecycle.
- The current WaveSpeed status route treats provider completion as job completion before durable output finalization.
- Storyboard state is persisted separately in browser `localStorage` under `music-video-projects`, outside the confirmed project save transaction.
- The specified storyboard generation route and application workflow are absent.
- There is no orchestrator-to-session project-change notification channel.

These are correctness gaps, not reasons to replace working generation UI or storyboard editing wholesale.

## Scope

### Required now

- Orchestrator-owned WaveSpeed submission, monitoring, recovery, cancellation, and finalization.
- Recovery of queued, running, and partially finalized jobs after orchestrator restart.
- Correct project mutation by job `projectId`, independent of browser active-project state.
- Persisted storyboard state within the authoritative project snapshot.
- Idempotent media creation, optional shot linking, optional placement, and project commit.
- Project-scoped session notifications with safe dirty-session behavior.
- Storyboard generation through local Claude Code, preview, explicit acceptance, and durable persistence.
- Actionable job, storyboard, and persistence errors.
- Deterministic tests, browser verification, and a storyboard quality eval.

### Deferred

- Durable KieAI support and migration of its credentials and polling into the orchestrator.
- Atlascloud support.
- Storyboard alteration commands and semantic diff workflows.
- Bulk generation of media for every storyboard shot.
- Automatic whole-storyboard timeline layout beyond existing explicit scene placement.
- Distributed workers, external queues, multi-orchestrator leadership, and durable event replay.
- Tour changes and unrelated editor-shell or accessibility work.

KieAI remains outside the new durable path. Any unified control that would imply durable KieAI support must show it as unavailable rather than silently using the browser-owned path.

## Architecture

### 1. Persistent generation worker

Add a `GenerationWorker` inside the orchestrator generation service. It owns a bounded scan loop over all recoverable jobs, not jobs filtered by a browser-selected project. The file repository gains a query for all recoverable jobs while retaining its existing project-filtered query for APIs.

The worker uses a provider adapter selected from the recorded job provider. The initial registry contains only WaveSpeed. A bounded concurrency limit prevents unbounded provider polling and finalization. Each job has a next-attempt time derived from persisted state so restart does not discard backoff.

The current deployment is assumed to run one orchestrator process against one generation data directory. Multi-process leadership is explicitly deferred. The worker must refuse or warn on an unsupported provider rather than leaving the job apparently active.

### 2. WaveSpeed provider adapter

Extract WaveSpeed submission and result lookup from the route into an orchestrator service adapter. Routes validate ownership and delegate to the service. Provider terminal success begins finalization; it does not set the local job to `completed`.

Provider credentials remain orchestrator-side. Browser payloads cannot supply or override a provider key.

### 3. Project mutation port

Implement finalizer ports that load the job's project by ID, stage the downloaded media, apply an idempotent domain mutation, and commit through the existing confirmed project-save transaction.

The mutation uses stable IDs derived from the job and finalization stage. On a base-revision conflict it reloads the latest project and reapplies the same idempotent mutation if its preconditions still hold. If an existing stable ID has different content, or the requested shot/placement target was deleted or incompatibly changed, the job becomes `needs-attention`; the worker never overwrites the newer project.

### 4. Persisted music-video extension

Extend the serialized core project with a JSON extension envelope. The core contract owns only the JSON-safe envelope; `music-video-domain` owns the typed codec for its namespaced payload. This avoids a dependency from core into the music-video package while keeping parsing and validation typed.

The persisted music-video payload contains the existing `MusicVideoProject`, including creative brief, timing, metadata tracks, generated assets, storyboard shots, and generation history. `StoryboardShot` remains the owner of creative intent and shot generation history. `MediaItem` remains the owner of binary output and technical metadata. `Clip` remains the owner of timeline placement.

The web music-video store hydrates from and writes through the active project snapshot. Its old local-storage payload is only a migration source.

### 5. Project event broker

Add an in-memory project event broker and an authenticated server-sent event endpoint. A session registers the project IDs it wants to observe. Events contain a project ID, confirmed revision, event kind, generation job ID when applicable, and a small human-readable change summary. Events are hints; persisted project and job state remain authoritative.

Clean sessions fetch and install the newer confirmed snapshot. Dirty sessions keep local edits, retain the external event, and show an action describing the change, for example, `Generated asset added to Shot 4 in vintage-tokyo`. They do not silently reload or overwrite local state. Reconnection compares confirmed revisions, so missing an in-memory event cannot hide a persisted change.

## Generation Data Flow

1. The web application assembles and validates the typed effective generation context.
2. The orchestrator validates the model, references, ownership, and WaveSpeed configuration.
3. A placeholder and persistent job are created once using the submission idempotency key.
4. WaveSpeed submission records the provider job ID before the response is returned.
5. The worker discovers the job and polls WaveSpeed with persisted bounded backoff.
6. A terminal success signal enters the existing finalization checkpoint state machine.
7. The finalizer downloads, verifies, and inspects the output.
8. The project mutation port creates or finalizes exactly one media version.
9. If `shotId` was explicitly supplied, it records exactly one output/attempt on that shot.
10. If placement was explicitly requested, it creates exactly one linked clip using the existing placement rules.
11. Media and project JSON are committed together through the project transaction.
12. The job becomes complete only after the confirmed project receipt is recorded.
13. The broker publishes the confirmed project change to registered sessions.

No-source generation creates a new asset group. It is not attached to a storyboard shot unless the request explicitly identifies one. A source-based variation remains a new immutable version in the source asset group.

## Storyboard Generation

### Local LLM boundary

Create a self-contained `services/llm/` service with:

- a typed request/result contract under the shared contracts area;
- a local Claude Code process adapter;
- timeout, cancellation, stdout/stderr capture, and structured error mapping;
- schema validation before returning a result;
- unit tests and an eval harness.

The orchestrator depends on a `StoryboardGeneratorPort`, not on subprocess details. No hosted model API or browser API key is introduced.

### Request and response

Add `POST /api/generate/storyboard`. The request contains only persisted, validated project context: confirmed song sections, creative brief, selected references, and an optional requested shot count. The model response is parsed into candidate `StoryboardShot` records. Invalid JSON, invalid ordering, missing required fields, or unusable timing returns a structured problem and performs no mutation.

Storyboard generation is blocked before invoking Claude when confirmed song sections are absent. The UI explains which setup step is required.

### Review and application

The web application shows the candidate storyboard before mutation. The user can:

- accept and append, which is the default;
- explicitly replace existing shots;
- reject, which changes nothing.

Acceptance performs one project mutation and confirmed save. Replacement is explicit because silently discarding manual scenes would be destructive. Existing manual editing, scene/media association, and reveal/placement behavior continue unchanged.

The initial workflow supports generating WaveSpeed media for an individual accepted shot. Bulk shot generation is deferred.

## Failure Handling and Recovery

- Provider polling uses bounded exponential backoff with persisted retry timing.
- Missing WaveSpeed credentials reject submission with configuration guidance.
- Unsupported providers enter a visible non-retryable failure state.
- Invalid, oversized, or unreachable provider output records the failed finalization checkpoint and exposes the appropriate retry action.
- Project conflicts are retried only through an idempotent rebase. Unsafe conflicts become `needs-attention` and preserve both the confirmed project and downloaded output.
- Downloaded but unreferenced media is recorded for deterministic cleanup; cleanup never deletes referenced media.
- Cancellation is locally authoritative, attempts provider cancellation when supported, logs provider cancellation failure with job identifiers, and stops further worker polling.
- Missing local Claude Code, timeout, cancellation, malformed output, or schema failure leaves the storyboard unchanged and produces a visible error.
- Event-stream disconnection reconnects with backoff. Revision comparison recovers missed notifications.
- No user-visible workflow uses an empty catch, silent `null`, or silent continuation.

## User Experience

- Generation UI shows the durable job phase derived from provider state and finalization checkpoints.
- Retry actions remain distinct: provider retry, finalization retry, and placement retry do not resubmit unnecessarily.
- Completed inactive-project jobs produce a notification naming the project and an Open action.
- Dirty sessions receive a meaningful external-change summary and keep their local work.
- Storyboard generation shows progress, candidate shots, append/replace choice, and explicit accept/reject actions.
- All blocking errors include the affected project/job identifiers and a specific recovery action where one exists.

## Migration

On first project hydration after this feature:

1. Prefer a valid persisted music-video extension.
2. If absent, look up the matching legacy `music-video-projects` entry.
3. Validate and normalize it with the existing domain codec.
4. Attach it to the project extension and mark the project dirty.
5. Remove or mark the legacy entry migrated only after a confirmed project save receipt.

Migration is idempotent. A failed save leaves the legacy source available. No unrelated local-storage projects are deleted.

## Tests and Evidence

### Deterministic tests

- A queued or running job resumes after worker restart.
- A partially completed checkpoint sequence resumes at the first incomplete stage.
- Repeated provider completion creates one media version, shot attempt, and clip.
- An inactive project's job cannot mutate the active browser project.
- No-source output creates a new asset group and no implicit shot link.
- A project revision conflict safely rebases an additive generation mutation or becomes `needs-attention` without overwriting edits.
- Worker cancellation stops future polls and records provider cancellation failure.
- Unsupported providers and missing credentials are explicit failures.
- Project events are scoped to registered project IDs and include confirmed revisions.
- Legacy storyboard data migrates once and is retained until confirmed persistence.
- Storyboard parsing rejects malformed, unordered, or incomplete output without mutation.
- Append, replace, and reject behavior is deterministic and preserves shot/media/clip ownership.
- The local Claude adapter maps success, timeout, cancellation, missing executable, malformed output, and non-zero exit status.

Gate tests must be local, deterministic, non-flaky, and targeted to run in under two seconds where practical.

### Browser verification

- Submit a WaveSpeed job, close the browser, reopen it, and observe the confirmed result.
- Complete a job for an inactive project and verify the active project is unchanged and the notification opens the correct project.
- Reconnect after an event-stream interruption and recover the confirmed revision.
- Generate a storyboard, preview it, reject it without mutation, then accept it and verify persistence after reload.
- Exercise actionable missing-credential, provider failure, output failure, dirty-session external-change, and missing-Claude presentations.

### Storyboard eval

Run local Claude Code against representative song structures and score:

- schema validity;
- coverage of confirmed song sections;
- chronological and non-overlapping timing;
- prompt specificity sufficient for media generation;
- adherence to the supplied creative brief.

The shipping threshold is at least 90% aggregate pass rate, with schema validity required for every accepted sample. Eval failures retain the exact sanitized input, output, rubric result, and model/version evidence.

## Operational Evidence

Expose structured worker logs and a read-only job-status API. Logs include job ID, project ID, provider, provider job ID, phase/checkpoint, attempt, elapsed time, and structured error code. The status API reports real persisted job state; it does not infer progress from browser timers.

Important known limitation: the initial file repository and worker are single-orchestrator components. Running multiple orchestrators against the same generation directory is unsupported until a durable lease or external queue is added.

## Acceptance Criteria

The design is complete when all of the following are demonstrated:

1. Generation continues and finalizes with no browser session.
2. The result is committed to the job's project, never whichever project is active elsewhere.
3. Restart and replay do not duplicate media, shot history, or clips.
4. Storyboard state survives confirmed project reload and legacy state migrates without loss.
5. Local Claude Code can generate a reviewable storyboard that mutates nothing until acceptance.
6. Registered sessions receive project-scoped change notifications without losing dirty edits.
7. Every failure mode above is visible, diagnosable, and covered by deterministic evidence or the required eval.
