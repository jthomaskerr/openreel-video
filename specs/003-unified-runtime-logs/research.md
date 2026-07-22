# Phase 0 Research: Unified Runtime Logs

**Date**: 2026-07-22  
**Status**: Complete. No `NEEDS CLARIFICATION` items remain.

## Decision 1: Extend the existing logging and application boundaries

**Decision**: Preserve the existing frontend `logBus` and its console-error classification, but move the inline wrapper from `apps/web/src/main.tsx` into a dedicated browser runtime-logging service. Add the backend router through `createApp` and initialize backend console capture in `apps/orchestrator/src/index.ts`.

**Rationale**: The repository already has an in-memory diagnostic log, a Vite `/api` proxy that injects the orchestrator bearer token, centralized Express application composition, and environment parsing. Extending these points avoids a second problem store, a parallel transport stack, or browser-visible credentials.

**Alternatives considered**:

- Replace `logBus`: rejected because the spec explicitly retains existing user-facing problem reporting.
- Post directly to the configured orchestrator URL with a browser token: rejected because the current proxy intentionally keeps `ORCHESTRATOR_AUTH_TOKEN` out of the browser bundle.
- Add a separate telemetry application: rejected as unnecessary greenfield architecture.

## Decision 2: Put the typed contract and pure safety rules in `@openreel/core`

**Decision**: Add `packages/core/src/runtime-logging.ts` containing V1 ingress and persisted-record types, JSON-safe values and typed placeholders, defaults/limits, validation, and recursive redaction. Export it through the package index and use it from both apps.

**Rationale**: Both applications already resolve `@openreel/core`, including the orchestrator TypeScript configuration. The contract is runtime-agnostic and belongs at the shared boundary; DOM handling and filesystem behavior remain app-specific.

**Alternatives considered**:

- Duplicate types in each app: rejected because drift would break the wire contract.
- Import backend internals into the frontend: rejected because services must not reach into another service's internals.
- Create a fourth workspace package: rejected because one contract module does not justify new build and dependency management.

## Decision 3: Use route-local Express JSON parsing before the broad parser

**Decision**: Mount `/api/logs` before `app.use(express.json({ limit: "50mb" }))`. The logging router owns `express.json({ limit: configuredEntryLimit, type: "application/json" })`, authentication, contract validation, and a router-local four-argument error handler.

**Rationale**: Express middleware runs in registration order. The current broad parser would otherwise consume the request before a strict logging limit could apply. Current Express 4 documentation confirms that `express.json` exposes the `limit` option, returns 413 for oversized entities, reports invalid JSON as `entity.parse.failed`/400, and requires error middleware after the route/middleware that can fail.

**Alternatives considered**:

- Reuse the global 50 MiB parser: rejected because a diagnostic endpoint must have a much smaller attack and memory surface.
- Add another validation framework: rejected because the shared validator is small, typed, deterministic, and already required in the browser.
- Put credentials in the POST body: rejected because payloads are persisted and the existing proxy/header path is safer.

**Source**: Express 4.21 documentation and tests via Context7 (`/expressjs/express/4_21_2`), consulted 2026-07-22.

## Decision 4: Implement the rotating JSON writer with Node standard APIs

**Decision**: Use a focused `fs/promises` writer with a single serialized promise chain. Store each file as a valid JSON envelope with one compact record per line inside `entries`; append by replacing the closing suffix, and repair an interrupted active tail on startup by parsing complete entry lines and atomically rewriting the envelope. Rotate archives highest-to-lowest and create the next active file before accepting further entries.

**Rationale**: Node documentation states that concurrent `FileHandle.write`/`writeFile` operations without awaiting are unsafe and that filesystem promise operations are not synchronized. A service-owned queue makes ordering and corruption prevention explicit. The line-oriented interior enables deterministic tail repair while the entire file remains standard JSON during normal operation.

**Alternatives considered**:

- NDJSON/JSONL: rejected because each file would not be one independently parseable JSON document as required.
- Rewrite the complete 10 MiB array for every entry: rejected because it scales poorly at 50 events/second.
- Winston, Pino, or `rotating-file-stream`: rejected because the project has no logging dependency and their default append/rotation formats are text or NDJSON; an adapter would still need the same valid-JSON envelope, redaction, dedupe, and recovery code.
- SQLite: rejected because the user explicitly requested rotating JSON files.

**Source**: Node.js 20 `fs/promises` and `FileHandle.write` documentation via Context7 (`/websites/nodejs_latest-v20_x`), consulted 2026-07-22.

## Decision 5: Assign ordering and deduplication authoritatively on the backend

**Decision**: Browser and backend producers assign stable UUID entry IDs and occurrence timestamps. `RuntimeLogService` assigns receipt timestamps and monotonic sequence numbers, keeps a retained-ID index seeded at startup, and returns the original sequence for duplicate IDs.

**Rationale**: Browser clocks and tabs cannot establish a total order. Backend receipt order plus a monotonic sequence produces deterministic reconstruction, while IDs make frontend retries idempotent across transient failures and process restarts.

**Alternatives considered**:

- Sort only by timestamps: rejected because equal/skewed timestamps are common and ambiguous.
- Let each producer allocate sequences: rejected because independent producers will collide.
- Treat retries as new events: rejected because it violates exactly-once persistence expectations.

## Decision 6: Redact in both producer and persistence boundaries

**Decision**: Apply the shared recursive redactor after browser normalization and again immediately before backend persistence. Sensitive key matching is case-insensitive; value matching covers bearer credentials, token-like secrets, signed URLs, blob URLs, and configured key names. Redaction replaces values with typed markers instead of silently dropping object structure.

**Rationale**: Browser redaction reduces exposure in transit and retry memory. Backend redaction remains authoritative for malicious or outdated clients and backend-originated events. Typed markers preserve diagnostic shape and make loss visible.

**Alternatives considered**:

- Browser-only redaction: rejected because clients are not trusted.
- Backend-only redaction: rejected because raw secrets would enter network and retry queues.
- Reuse only the WaveSpeed redactor: rejected because it does not cover size/depth placeholders, DOM values, all required secret categories, or the shared browser contract.

## Decision 7: Serialize DOM elements as inert bounded snapshots

**Decision**: Browser serialization clones an element, removes `script`, `style`, `template`, executable/event attributes, URLs with sensitive schemes/query values, and all live control values, then stores bounded `outerHTML` as a typed `$type: "html"` value. Stored markup is never inserted into the application DOM.

**Rationale**: A clone avoids mutating the live editor. An allowlist/denylist sanitizer plus byte limit meets diagnostic needs without creating a rendering dependency. Keeping the value typed forces future viewers to treat it as inert text.

**Alternatives considered**:

- Store `String(element)`: rejected because it loses useful structure.
- Store raw `outerHTML`: rejected because it can contain credentials, form values, or executable attributes.
- Add DOMPurify: rejected for this scope because snapshots are never rendered; explicit transformations are smaller and fully testable. If a future viewer renders snapshots, that viewer must add an independent sanitizer.

## Decision 8: Capture interactions narrowly and only after explicit enablement

**Decision**: Default interaction capture to false. When enabled, capture only configured click/control activation, submit, navigation, and allowlisted keyboard-command metadata. Persist pathname without query/hash, modifier flags, event category, and a text-free target path based on tag, role, sibling index, and explicit safe logging identifiers.

**Rationale**: This provides causal context without becoming analytics or session replay. Excluding text, raw keys, arbitrary attributes, field values, clipboard data, pixels, and media enforces the privacy boundary in the spec.

**Alternatives considered**:

- Reuse PostHog autocapture: rejected because the requirement is local unified logging and PostHog has separate retention/privacy semantics.
- Record every DOM event: rejected because of volume, performance, and privacy risk.
- Record visible text/labels: rejected because editor content may be private.

## Decision 9: Use a bounded per-entry browser queue with non-recursive fallback

**Decision**: Install console wrappers synchronously with delivery paused, fetch non-secret public configuration, then deliver each entry separately through relative `/api/logs`. Limit queue entries and bytes, use bounded retry attempts with backoff, use best-effort beacon delivery on page exit, and discard oldest low-severity entries first on overflow while emitting one direct-original-console warning.

**Rationale**: One entry per request matches the requested event trigger and simplifies idempotency. Paused startup capture avoids losing early console events without sending while logging is disabled. Direct calls to preserved console functions and backend `stderr` prevent recursive capture.

**Alternatives considered**:

- Batch entries: rejected because the explicit behavior requests a post for each newly added console event.
- Block console calls until delivery: rejected because diagnostics must not break or stall the editor.
- Unbounded retry/local storage: rejected because outages could exhaust memory or persist sensitive diagnostic data unexpectedly.

## Decision 10: Prove behavior with deterministic tests plus exact browser verification

**Decision**: Use injected clocks, UUID factories, fetchers, filesystem paths, and fallback sinks. Test all capture methods, serialization classes, redaction fixtures, auth/parser statuses, dedupe/order, interrupted-tail recovery, three rotations, configuration boundaries, outage behavior, and a 50 events/second performance harness. Then verify the exact editor workflow in the browser and validate produced files with `scripts/verify-runtime-logs.ts`.

**Rationale**: Unit and route tests prove deterministic invariants, but only browser verification proves console rendering remains unchanged, DOM elements are captured correctly, interaction gating works, and the editor stays responsive.

**Alternatives considered**:

- Typecheck/unit tests only: rejected by the repository's browser verification requirement.
- Manual file inspection only: rejected because repeated workflows need reproducible scripts and measurable evidence.
- LLM eval: rejected because no probabilistic behavior exists in this feature.
