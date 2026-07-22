# Quickstart Validation: Unified Runtime Logs

This guide is the implementation acceptance runbook. It validates the contract, deterministic behavior, and exact browser workflow without exposing credentials or manually interpreting raw log files.

## Prerequisites

- Node.js 20 and the repository's pnpm version
- Existing local orchestrator/web environment configured as documented by the repository
- Port 4041 free for the orchestrator and port 5173 free for Vite
- A local editor project that can be opened without modifying production data
- Browser control with an existing local session

Do not place `ORCHESTRATOR_AUTH_TOKEN` in browser environment variables or evidence. The existing Vite `/api` proxy injects it server-side.

## 1. Install and run focused deterministic tests

```bash
rtk pnpm install
rtk pnpm --dir packages/core exec vitest run src/runtime-logging.test.ts
rtk pnpm --dir apps/web exec vitest run src/services/runtime-logging
rtk pnpm --dir apps/orchestrator exec node --import tsx --test \
  src/services/runtime-logging/runtime-log-writer.test.ts \
  src/services/runtime-logging/runtime-log-service.test.ts \
  src/services/runtime-logging/runtime-log-router.test.ts \
  src/services/runtime-logging/backend-console-capture.test.ts \
  src/env.test.ts
```

Expected:

- All shared contract/redaction cases pass.
- Browser tests cover all five console methods, circular/unsupported/Error/DOM values, queue overflow, retries, recursion, disabled logging, and interaction privacy.
- Orchestrator tests cover parser status mapping, configured authentication, dedupe, ordering, startup recovery, three rotations, five-file retention, and filesystem failure fallbacks.
- The focused suites complete deterministically with zero network calls outside their local test servers.

## 2. Run repository gates

```bash
rtk pnpm typecheck
rtk pnpm test
```

Expected: both commands exit 0 with no failed package.

No LLM eval is required because this feature has no probabilistic behavior.

## 3. Start with isolated logging storage and interactions disabled

Create a unique non-production directory and preserve its printed path for evidence:

```bash
OPENREEL_LOG_SMOKE_DIR="$(mktemp -d /tmp/openreel-runtime-logs.XXXXXX)"
echo "$OPENREEL_LOG_SMOKE_DIR"
OPENREEL_RUNTIME_LOG_DIR="$OPENREEL_LOG_SMOKE_DIR" \
OPENREEL_RUNTIME_LOG_ENABLED=true \
OPENREEL_RUNTIME_LOG_INTERACTIONS=false \
rtk pnpm dev
```

The command is monitored in the foreground. If the test runner needs separate terminal access, use the product's monitored background-job mechanism and record its PID and output rather than firing and forgetting.

Verify the public configuration through the authenticated Vite proxy:

```bash
rtk curl -sS http://127.0.0.1:5173/api/logs/config
```

Expected response fields:

- `schemaVersion: 1`
- `enabled: true`
- `captureInteractions: false`
- no token, filesystem path, secret-key list, or private retention setting

## 4. Verify the exact browser console workflow

Open `http://localhost:5173`, enter the editor project, and capture a baseline screenshot. Through browser evaluation, emit one marker per supported method using a unique run identifier:

```javascript
const runId = "runtime-log-smoke-v1";
const button = document.querySelector("button");
console.debug(runId, { method: "debug", nested: { count: 1 } });
console.log(runId, { method: "log" }, [1, 2, 3]);
console.info(runId, new Error("safe-smoke-error"));
console.warn(runId, { circular: (() => { const value = {}; value.self = value; return value; })() });
console.error(runId, button, { authorization: "Bearer must-not-persist" });
runId;
```

Expected browser behavior:

- All five calls still appear once in the browser console with their original argument behavior.
- The editor remains responsive and the existing Log pane still receives the `console.error` problem entry.
- No recursive transport/fallback messages appear.
- The console returns the generated `runId`; record it in evidence.

Click controls, navigate within the editor, and submit a non-destructive local form while interaction capture is disabled. These actions must not create `source: "interaction"` records.

## 5. Validate stored output deterministically

Run the repository validator rather than opening and mentally scanning raw files:

```bash
rtk pnpm exec tsx scripts/verify-runtime-logs.ts \
  --dir "$OPENREEL_LOG_SMOKE_DIR" \
  --expect-run-id runtime-log-smoke-v1 \
  --expect-methods debug,log,info,warn,error \
  --expect-interactions 0 \
  --forbid "Bearer must-not-persist"
```

Expected:

- Every retained file parses as JSON and validates against contract version 1.
- Exactly five marker entries exist, one for each method, with strictly increasing sequences.
- Nested keys and array order are preserved.
- The Error is typed with safe name/message/stack.
- The circular value is an explicit placeholder.
- The button is an inert sanitized HTML placeholder with no executable attributes or control values.
- The bearer value is absent and a redaction marker is present.
- Frontend and backend startup events coexist in the same file set.

## 6. Verify opt-in interactions

Stop the monitored dev process cleanly, then restart with the same isolated directory and interaction capture enabled:

```bash
OPENREEL_RUNTIME_LOG_DIR="$OPENREEL_LOG_SMOKE_DIR" \
OPENREEL_RUNTIME_LOG_ENABLED=true \
OPENREEL_RUNTIME_LOG_INTERACTIONS=true \
OPENREEL_RUNTIME_LOG_INTERACTION_TYPES=click,submit,navigate,shortcut.save \
rtk pnpm dev
```

Open the editor, click one control, use the configured save shortcut, navigate once, and submit one non-destructive form. Type `runtime-log-private-input-v1` into a normal text field without submitting its value as application data.

Validate:

```bash
rtk pnpm exec tsx scripts/verify-runtime-logs.ts \
  --dir "$OPENREEL_LOG_SMOKE_DIR" \
  --minimum-interactions 4 \
  --expect-interaction-types click,shortcut.save,navigate,submit \
  --forbid runtime-log-private-input-v1
```

Expected:

- Each allowlisted category appears with a text-free target descriptor and pathname without query/hash.
- No field value, raw key sequence, visible text, clipboard content, arbitrary attribute, media data, or forbidden marker is present.

## 7. Verify outage behavior

With the browser open, stop only the orchestrator and emit more console calls.

Expected:

- Original browser console behavior and editor actions continue.
- The queue remains within configured entry/byte limits.
- A single bounded fallback warning is written through the preserved console function without recursion.
- Restarting the orchestrator delivers retryable queued IDs without duplicate persisted records.

Run the validator with the original `runId` again and confirm all IDs remain unique.

## 8. Verify rotation and recovery

The writer unit suite is authoritative for deterministic threshold and interrupted-tail cases. For an end-to-end smoke test, restart with a small safe threshold:

```bash
OPENREEL_RUNTIME_LOG_DIR="$OPENREEL_LOG_SMOKE_DIR" \
OPENREEL_RUNTIME_LOG_ENABLED=true \
OPENREEL_RUNTIME_LOG_MAX_FILE_BYTES=65536 \
OPENREEL_RUNTIME_LOG_RETAINED_FILES=5 \
rtk pnpm dev
```

Emit bounded marker entries until at least three rotations occur, then run:

```bash
rtk pnpm exec tsx scripts/verify-runtime-logs.ts \
  --dir "$OPENREEL_LOG_SMOKE_DIR" \
  --minimum-rotations 3 \
  --maximum-files 5 \
  --require-strict-sequence
```

Expected: five or fewer independently parseable files, complete records only, unique IDs, reconstructable strict ordering, and total size within one maximum entry of the configured bound.

## 9. Capture delivery evidence

Store evidence under `/tmp/openreel-runtime-logging-evidence/`:

- baseline and completed-workflow screenshots
- browser recording for console, disabled interaction, enabled interaction, and outage scenarios
- run IDs and sanitized request/response samples
- active/archive filenames, record counts, first/last sequences, redaction/truncation counts
- focused/full test and typecheck commands with exit status
- validator output for normal, interaction-enabled, outage/retry, and rotation runs
- measured p95 editor interaction delta under 50 console calls/second

Do not copy raw logs into evidence. Use the validator's sanitized summary. Do not include tokens, signed URLs, blob URLs, form values, or private project content.
