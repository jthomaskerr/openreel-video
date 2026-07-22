# macOS Task 1: Internal Resolve Python adapter

## Outcome

The stdlib-only `OpenReelBridge.py` adapter imports a redeemed OpenReel job into Resolve's current project, never creates or switches projects, chooses a collision-safe final name, verifies every downloaded artifact, imports the FCPXML with its decoded media root, validates the resulting timeline, saves, and posts one structured import result.

The shared fixture matches the current orchestrator redemption response exactly:

- top level: `jobId`, `projectId`, `revision`, `artifacts`
- artifact: `name`, `url`, `mediaType`, `byteLength`, `sha256`
- all three committed artifacts: FCPXML, manifest, and compatibility report

The adapter derives result submission from the redeemed project/job identifiers. Capability-bearing artifact URLs remain internal to the backend port and are never copied into results or failure messages.

## TDD evidence

### RED

Command:

```bash
rtk /usr/bin/python3 -m unittest discover -s apps/resolve-bridge/resolve/tests -v
```

Initial result: discovery failed with `ModuleNotFoundError: No module named 'OpenReelBridge'`.

### GREEN

The same command passed after implementation:

- 9 tests passed
- 0 failures or errors
- Duration: 0.005 seconds

## Verification

- `/usr/bin/python3 -m py_compile` passed for the adapter and test module.
- Serena reported no diagnostics for either Python file.
- `rtk git diff --check` passed.

## Behaviors and failure modes covered

- Strict current backend redemption DTO and exact artifact hashes/lengths.
- Import into the current provisional project only; `CreateProject` is forbidden by the fake.
- Collision-safe rename without overwriting another Resolve project.
- FCPXML import options include timeline name, source-clip import, and decoded common media root.
- Destination project name, timeline name, duration, video/audio track counts, and clip counts are verified.
- Exact referenced media IDs come from the verified manifest.
- Offline media is reported with stable `OFFLINE_MEDIA` evidence.
- Artifact mismatch, FCPXML rejection/count mismatch, save failure, and missing Resolve API return stable schema codes.
- Every success and tested failure posts exactly one result.
- Capability tokens and raw source paths are absent from diagnostic results.
