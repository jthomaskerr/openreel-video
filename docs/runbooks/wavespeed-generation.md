# WaveSpeed generation release runbook

## Release state

WaveSpeed Generation V2 is fail-closed. Keep both controls closed:

```dotenv
GENERATION_V2_RELEASE_ENABLED=false
```

```ts
WAVESPEED_GENERATION_V2_RELEASE_ENABLED = false
```

The server flag is the authoritative submission boundary. The web flag is a
second, independent UI gate. Rollback rejects a new V2 submit before provider
reservation or upload retention. It does not stop polling, cancellation,
recovery, or finalization for a previously submitted V2 job.

The paid-provider matrix is `BLOCKED` until Joseph explicitly authorizes the
credential/provider instance and account or region, the exact model/mode/schema/
endpoint/version matrix, a maximum total spend, and the evidence retention
location and period. Do not set a provider credential while running the fake
matrix, and do not replace a missing route with a similar provider route.

## Deterministic gate

Run these commands from the repository root. The orchestrator currently has no
`test:run` package script, so its deterministic tests use the workspace `tsx`
binary directly.

```bash
rtk proxy pnpm --filter @openreel/orchestrator exec tsx --test \
  src/routes/wavespeed.integration.test.ts \
  src/services/generation/observability.test.ts \
  src/services/generation/evidence-manifest.test.ts \
  src/services/generation/generation-v2-rollback-continuation.fixture.ts \
  src/services/generation/generation-finalization-new-asset-no-source.fixture.ts
rtk proxy pnpm --filter @openreel/music-video-domain test:run -- \
  src/generation/generation-job-dispositions.fixture.ts \
  src/generation/generation-v2-rollback.fixture.ts \
  src/generation/generation-local-url-boundaries.fixture.ts
rtk proxy pnpm --filter @openreel/web test:run -- \
  src/features/generation/feature-flag.test.ts
rtk proxy pnpm --filter @openreel/orchestrator typecheck
rtk proxy pnpm --filter @openreel/web typecheck
rtk proxy pnpm --filter @openreel/web lint
rtk git diff --check
```

The gate requires all technical cases to pass, manifest validation to return no
errors, the redaction corpus to contain zero leaks, and actual artifact counts to
equal expected counts. It fails for an illegal disposition transition, a new
provider submit during rollback, a source or audio call for a new asset, any
durable `blob:`, `local:`, `file:`, loopback, signed URL, token, credential, or
raw-prompt value, or any duplicate provider/output/media-version/shot/placement
count.

## Browser evidence

Only start browser verification after the deterministic gate passes. Run the web
application on port 5173. Use the production generation controller and production
WaveSpeed route with `WaveSpeedFakeProvider`; no provider network request is
permitted.

```bash
GENERATION_V2_RELEASE_ENABLED=false rtk proxy pnpm dev
rtk proxy pnpm --filter @openreel/web test:e2e -- \
  e2e/wavespeed-generation.spec.ts --project=chromium
```

Store each run under:

```text
docs/evidence/wavespeed-generation/YYYY-MM-DD/<run-id>/
```

For scenarios 1 through 14, retain a dated screenshot or recording, sanitized
network JSON, sanitized structured-event JSON, and a manifest entry containing:

- logical and provider job IDs plus attempt history;
- all six routing fields;
- ordered reference identity, origin, active state, and recovery result;
- requested and actual audio ranges and SHA-256 hash;
- output, media, version, shot, and clip provenance;
- stage error and recovery action;
- expected versus actual placeholder, provider-submit, output, media-version,
  shot-attempt, and placement counts.

Browser storage, project JSON, provenance, network, and events must contain zero
credentials, authorization values, signed URLs, upload tokens, raw prompts, or
local/blob/file/loopback values. Do not edit captured evidence to remove a leak.
Treat the leak as a failed run, fix the boundary, and capture a new dated run.

## Evidence manifest and release decision

Validate each run with `validateWaveSpeedEvidenceManifest`. Then evaluate it with
`evaluateWaveSpeedReleaseGate`. A valid deterministic/browser manifest still
returns a closed gate while exact `gpt-5.6-sol` verification is not `PASS` or
paid-provider evidence is `BLOCKED`.

Do not set either release flag to true until an independent exact-Sol verifier
returns `PASS` after every deterministic, browser, manifest, redaction, duplicate,
and explicitly authorized provider gate. A failed or incomplete case blocks
enablement.

## Failure handling

- Routing drift: refresh and revalidate the exact route. Never substitute one.
- Reference preparation: retry only the failed reference, remove it, or deactivate
  it while preserving order and required-reference validation.
- Provider failure: retry the provider stage, which creates a new provider job ID
  under the same logical job. Do not reuse finalization retry for this.
- Download, validation, local save, shot link, placement, or persistence failure:
  retry only the recorded finalization checkpoint. Provider submit count must not
  increase.
- Cancellation: stop the local poller first, then call provider cancellation when
  supported. Record success and latency.
- Rollback: keep new submission controls hidden or disabled and preserve existing
  job poll/cancel/recovery/finalization access.

No restart is required after deterministic tests. After changing environment
flags or the route manifest, restart both `pnpm dev` processes before verifying
the new configuration.
