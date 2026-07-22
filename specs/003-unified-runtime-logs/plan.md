# Implementation Plan: Unified Runtime Logs

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for each implementation slice and `superpowers:verification-before-completion` before each commit. Generate `tasks.md` with `$speckit-tasks` before implementation; that command owns executable task breakdown and tracking.

**Branch**: `feature/time-machine-ai-generation` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/003-unified-runtime-logs/spec.md`

## Summary

Build a versioned unified runtime-log pipeline that captures browser `console.debug`, `console.log`, `console.info`, `console.warn`, and `console.error` calls plus backend console events, preserves structured arguments and inert HTML snapshots, optionally records a narrow allowlist of interaction metadata, and persists all accepted events to a bounded rotating JSON file set.

The design extends existing boundaries instead of introducing a parallel application architecture. The shared wire contract and pure validation/redaction helpers live in `@openreel/core`; the existing inline `main.tsx` console-error bridge moves into a browser runtime-logging service while retaining `logBus` behavior; an Express router is mounted before the existing 50 MiB JSON parser; and a self-contained orchestrator service serializes deduplicated writes and rotation through one queue.

## Technical Context

**Language/Version**: TypeScript 5.9; Node.js 20 runtime; browser code targeting the repository's current Vite `esnext` build  
**Primary Dependencies**: Existing React 18/Vite frontend, Express 4.22 backend, `@openreel/core`; Node `crypto` and `fs/promises`; no new runtime logging dependency  
**Storage**: Local size-rotated JSON files in `OPENREEL_RUNTIME_LOG_DIR` (default `~/.openreel/logs`), with one active file and numbered archives  
**Testing**: Vitest for shared/browser units; Node `node:test` through `tsx` for orchestrator units and route integration; Playwright/browser control for the exact editor workflow  
**Target Platform**: Modern Chromium-class browsers and the local Node.js 20 orchestrator on macOS/Linux  
**Project Type**: Existing pnpm monorepo web application with `apps/web`, `apps/orchestrator`, and shared `packages/core`  
**Performance Goals**: Sustain 50 captured console calls/second; no more than 10 ms added p95 editor interaction latency; accepted entries visible within one second of backend receipt  
**Constraints**: 256 KiB default per-entry/body limit; serialization depth 8; browser queue defaults of 500 entries and 1 MiB; 10 MiB active file; five total retained files; interaction capture off by default; zero raw secrets or typed values persisted  
**Scale/Scope**: Local diagnostic workload from multiple tabs plus one orchestrator process; no remote shipping, dashboard, screenshots, media bodies, or full session replay  
**Probabilistic Evaluation**: Not applicable. Serialization, redaction, ordering, capture, and rotation behavior are deterministic and require tests rather than an LLM eval.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

The checked-in constitution is still an unfilled template and defines no enforceable project-specific gates. The repository operating standard and feature spec therefore provide the active gates.

| Gate | Pre-design | Post-design evidence |
|------|------------|----------------------|
| Reuse existing implementation before adding architecture | PASS | Retains `logBus`, Vite `/api` authentication proxy, Express `createApp`, environment parsing, and `@openreel/core`; adds only focused runtime-logging modules. |
| Typed cross-service boundary | PASS | `packages/core/src/runtime-logging.ts` owns request, response, configuration, persisted-record, validation, and redaction contracts used by both apps. |
| Deterministic tests and traceable evidence | PASS | Unit, contract, route, rotation, recovery, integration, performance, and browser scenarios are specified in [quickstart.md](./quickstart.md). |
| Explicit failures and no silent user-visible loss | PASS | Queue overflow, serialization, validation, auth, persistence, and rotation failures produce bounded redacted diagnostics through non-recursive fallbacks. |
| Secrets and private data never persisted | PASS | Browser pre-redaction plus authoritative backend redaction; interaction capture excludes values, text, raw keys, clipboard, media, queries, and sensitive attributes. |
| Simple established technology | PASS | Uses existing dependencies and Node/DOM standard APIs; [research.md](./research.md) rejects new logging libraries because the required valid-JSON envelope still needs custom persistence. |
| Independently testable service boundary | PASS | Orchestrator runtime logging is contained under `apps/orchestrator/src/services/runtime-logging/` with injected clock, IDs, filesystem path, and fallback sink. |
| UI verification for browser behavior | PASS | Quickstart requires exact console, element, interaction-flag, outage, and reload verification in the running editor on port 5173. |

No gate violations require justification.

## Project Structure

### Documentation (this feature)

```text
specs/003-unified-runtime-logs/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
├── checklists/
│   └── requirements.md
└── tasks.md                 # Created later by $speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── runtime-logging.ts               # Shared types, limits, validator, JSON-safe redaction
├── runtime-logging.test.ts           # Contract, validation, and redaction tests
└── index.ts                          # Public export

apps/web/src/services/runtime-logging/
├── browser-runtime-logger.ts         # Console wrappers, bounded per-entry delivery queue, retry/unload handling
├── browser-runtime-logger.test.ts
├── console-argument.ts               # Circular-safe serialization and DOM-to-inert-HTML adapter
├── console-argument.test.ts
├── console-problem-entry.ts          # Preserved console.error to logBus classification
├── console-problem-entry.test.ts
├── interaction-capture.ts            # Opt-in capture-phase listeners and safe target descriptors
├── interaction-capture.test.ts
└── index.ts                           # Bootstrap/teardown facade

apps/web/src/
└── main.tsx                           # Replace inline console.error bridge with early runtime-logging bootstrap

apps/orchestrator/src/services/runtime-logging/
├── runtime-log-writer.ts             # Recoverable valid-JSON append, rotation, retention, startup scan
├── runtime-log-writer.test.ts
├── runtime-log-service.ts            # Validation, authoritative redaction, dedupe, sequence, serialized enqueue
├── runtime-log-service.test.ts
├── runtime-log-router.ts             # GET config and POST ingestion with route-local parser/errors/auth
├── runtime-log-router.test.ts
├── backend-console-capture.ts         # Existing console method wrappers and stderr fallback
├── backend-console-capture.test.ts
└── index.ts                           # Service construction and public exports

apps/orchestrator/src/
├── env.ts                             # Validated OPENREEL_RUNTIME_LOG_* configuration
├── env.test.ts                        # Defaults, bounds, and fail-closed boolean tests
├── app.ts                             # Dependency injection and /api/logs mount before global JSON parser
└── index.ts                           # Initialize writer, install backend capture, start server, graceful flush

scripts/
└── verify-runtime-logs.ts             # Deterministic active/archive schema, order, marker, and secret scan
```

**Structure Decision**: Keep the shared wire boundary in the already-consumed `@openreel/core` package, browser-only DOM/capture behavior in one frontend service directory, and all filesystem/auth/router behavior in one orchestrator service directory. Do not add a fourth workspace package, a telemetry framework, or a general logging abstraction beyond the feature's current needs.

## Design and Implementation Sequence

1. **Shared contract first**: Add discriminated V1 ingress and persisted-record types, safe JSON value/placeholder types, defaults, size/depth validation, and recursive redaction. Prove malicious keys, bearer tokens, signed URLs, blob URLs, cycles after normalization, and unsupported schema versions fail or redact deterministically.
2. **Persistent writer second**: Implement the JSON envelope and startup repair with a serialized promise chain. Prove first append, concurrent append ordering, three rotations, archive retention, duplicate-free recovery, oversized-entry rejection, interrupted-tail repair, and disk/rename failures in temporary directories.
3. **Backend service and route third**: Assign receipt timestamps and monotonic sequence numbers only on the backend; seed dedupe/sequence state from retained files; mount `GET /api/logs/config` and `POST /api/logs` before the broad parser; map parser/auth/validation/disabled failures to the OpenAPI contract.
4. **Backend console bridge fourth**: Wrap all five supported methods after preserving originals; enqueue normalized arguments without awaiting; use direct `process.stderr.write` fallback so writer failures never recurse; restore originals during shutdown/tests.
5. **Browser serializer fifth**: Normalize every argument to the shared JSON value model; clone DOM elements, remove script/style/template content, event attributes, sensitive attributes, and control values, then enforce byte/depth limits with explicit placeholders.
6. **Browser transport sixth**: Install console wrappers synchronously with delivery paused, retain the existing `console.error` to `logBus` classification, fetch public configuration through relative `/api/logs/config`, then enable per-entry POST delivery or discard the bounded pre-config queue when disabled. Use unique IDs for retry dedupe and preserve original console return/throw behavior.
7. **Interaction capture seventh**: Add listeners only when enabled for configured `click`, `submit`, navigation, and shortcut events. Store event type, pathname without query/hash, modifier flags, and a tag/role/index target path; never store text, raw key values except an allowlisted shortcut identifier, field values, clipboard, media, or arbitrary attributes.
8. **Integrated verification last**: Run focused tests, full typechecks, the deterministic archive validator, and browser scenarios. Capture screenshot/recording evidence plus sanitized request IDs, file paths, record IDs, sequences, redaction markers, rotation counts, and exact commands/results.

Each implementation slice follows red-green-refactor and ends in a small conventional commit. `tasks.md` must preserve this dependency order while splitting work into independently reviewable test cycles.

## Interface Boundaries

- `validateRuntimeLogIngress(value, limits): ValidationResult<RuntimeLogIngressEntryV1>` is the only acceptance boundary for frontend payloads.
- `redactRuntimeLogValue(value, policy): RedactionResult` is pure and runs in both browser normalization and backend persistence.
- `RuntimeLogService.enqueue(entry): Promise<RuntimeLogAppendResult>` owns dedupe, backend timestamps, sequence allocation, redaction, and persistence.
- `RuntimeLogWriter.initialize(): Promise<RuntimeLogIndex>` repairs the active tail, validates archives, and returns retained IDs plus maximum sequence.
- `RuntimeLogWriter.append(record): Promise<void>` and `flush(): Promise<void>` serialize every file mutation.
- `installBrowserRuntimeLogging(options): RuntimeLoggingController` and `installBackendConsoleCapture(options): () => void` both return teardown controls for deterministic tests.
- HTTP behavior is authoritative in [contracts/openapi.yaml](./contracts/openapi.yaml); stored entities and state transitions are authoritative in [data-model.md](./data-model.md).

## Requirement Traceability

| Requirements | Design owner | Verification evidence |
|--------------|--------------|-----------------------|
| FR-001, FR-003, FR-004 | Shared validator, router, service | Contract and real-socket route tests for auth, size, schema, unique ID, accepted/duplicate responses |
| FR-002, FR-015, FR-024 | Browser console controller | All-method wrapper tests, recursion test, disabled-config test, exact browser console workflow |
| FR-005 to FR-009, FR-020, FR-022 | Shared redactor and browser serializer | Structured/circular/error/DOM/security fixture matrix and archive secret scan |
| FR-010, FR-011 | Backend console bridge and service | Mixed frontend/backend ordering tests with identical timestamps and restart sequence seeding |
| FR-012 to FR-014 | Public config and interaction capture | Enabled/disabled event matrix and zero-value/zero-raw-key assertions |
| FR-016, FR-021 | Browser queue and backend fallback | Offline, queue-overflow, disk-error, rename-error, and non-recursion tests |
| FR-017 to FR-019 | Runtime log writer | Three-rotation, five-file retention, independent JSON parse, interrupted-tail repair tests |
| FR-023 | Environment parser and public config | Default/boundary/invalid configuration tests plus config endpoint contract |
| SC-001 to SC-008 | Integrated quickstart | Focused suites, performance harness, deterministic validator, and browser evidence checklist |

## Complexity Tracking

No constitution or operating-standard violations. The only custom infrastructure is the JSON writer, required because existing logging packages emit text/NDJSON or require adapters that cannot guarantee the specified independently parseable JSON envelope and recovery semantics.
