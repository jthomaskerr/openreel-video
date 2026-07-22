# Feature Specification: Unified Runtime Logs

**Feature Branch**: `feature/time-machine-ai-generation`  
**Created**: 2026-07-22  
**Status**: Draft  
**Input**: User description: "Please create a logs endpoint that is posted to by the frontend every time a new log is added to the console. this is stored in a rotating json file which stores each object written by console.* in a keyed pop, any elements that are sent to the console as html, optionally capture user interactions (config flag), also add backend logs to the same file"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Diagnose a Session from One Log Trail (Priority: P1)

As a developer or operator, I can inspect one chronological log trail containing both browser and backend events so I can reconstruct what happened without collecting separate logs from multiple processes.

**Why this priority**: A unified trail is the core diagnostic outcome. Structured capture and interaction context are useful only if frontend and backend events reliably reach the same searchable record.

**Independent Test**: Generate known browser console calls and backend log events during one session, then verify that each appears exactly once in chronological order with its origin, severity, timestamp, and correlation context.

**Acceptance Scenarios**:

1. **Given** logging is enabled and the frontend emits a console message, **When** the message is added to the browser console, **Then** a corresponding frontend log entry is delivered to the backend log ingress and appears in the unified log trail without changing the original console behavior.
2. **Given** the backend emits an informational, warning, or error event, **When** the event is recorded, **Then** it appears in the same unified log trail and is distinguishable from frontend entries.
3. **Given** frontend and backend events belong to the same request or user session, **When** an operator reviews the trail, **Then** the entries contain sufficient shared correlation context to reconstruct their sequence.
4. **Given** log delivery is temporarily unavailable, **When** the frontend emits a console message, **Then** the editor remains usable, the failure is surfaced through a non-recursive diagnostic path, and retry storage remains bounded.

---

### User Story 2 - Preserve Console Arguments Faithfully (Priority: P1)

As a developer, I can see every argument supplied to each supported console call, including structured objects and rendered element snapshots, so diagnostic meaning is not lost through string coercion.

**Why this priority**: Many editor failures are diagnosable only from structured state or element context. Flattening all arguments into one string would discard property names, types, and markup.

**Independent Test**: Emit console calls containing multiple primitives, nested objects, arrays, errors, circular references, and document elements, then compare the stored entry with the expected safe representation for every argument.

**Acceptance Scenarios**:

1. **Given** a console call contains multiple arguments, **When** it is captured, **Then** every argument is preserved under a stable positional key and object property keys remain intact.
2. **Given** a console argument is a document element, **When** it is captured, **Then** the entry includes a sanitized HTML snapshot that identifies the element without executable content or sensitive field values.
3. **Given** an argument cannot be represented directly because it is circular, oversized, binary, or otherwise unsupported, **When** it is captured, **Then** the entry contains a typed, bounded placeholder explaining the loss rather than dropping the argument or failing the entire entry.
4. **Given** an argument contains a credential, signed URL, token, private form value, or other configured sensitive value, **When** it is captured, **Then** the sensitive material is replaced with a redaction marker before persistence.

---

### User Story 3 - Add Opt-in Interaction Context (Priority: P2)

As a developer investigating a difficult reproduction, I can enable interaction capture so recent navigation, pointer, keyboard-command, and control-activation context appears alongside logs without collecting typed content.

**Why this priority**: Interaction context can make intermittent UI failures reproducible, but it has higher privacy and volume risk than ordinary diagnostic logging and must therefore be explicitly enabled.

**Independent Test**: Run the same interaction sequence once with interaction capture disabled and once enabled, then verify that only the enabled run records allowlisted interaction metadata and that neither run records entered text, raw keystrokes, or sensitive attributes.

**Acceptance Scenarios**:

1. **Given** interaction capture is disabled, **When** the user clicks, navigates, types, or submits a form, **Then** no interaction entries are added to the unified log trail.
2. **Given** interaction capture is enabled, **When** the user activates an allowlisted control or navigation action, **Then** a sanitized interaction entry is added with timestamp, interaction type, safe target descriptor, session context, and correlation context.
3. **Given** interaction capture is enabled and the user enters text or uses a sensitive control, **When** the interaction is recorded, **Then** raw keystrokes, field values, clipboard content, media content, and sensitive attributes are excluded.
4. **Given** the configuration changes, **When** a new frontend or backend process starts, **Then** interaction capture follows the explicit configured state and defaults to disabled when the state is absent or invalid.

---

### User Story 4 - Bound Local Log Storage (Priority: P2)

As an operator, I can rely on automatic rotation and retention so diagnostic logging does not consume unbounded disk space while recent logs remain independently readable.

**Why this priority**: Persistent logging is unsafe operationally unless storage growth is predictable and rotation failures are visible.

**Independent Test**: Configure a small rotation threshold, write enough frontend and backend entries to exceed it several times, then verify file validity, ordering, archive limits, and explicit failure reporting.

**Acceptance Scenarios**:

1. **Given** the active log reaches its configured size threshold, **When** another entry is persisted, **Then** the current log is archived and a new active log continues the sequence without losing or duplicating entries.
2. **Given** rotation creates more archives than the configured retention count, **When** rotation completes, **Then** the oldest archive is removed and total retained storage remains within the configured bound.
3. **Given** an active or archived log is opened independently, **When** its contents are parsed, **Then** it is valid JSON and every retained record has a stable schema version.
4. **Given** persistence or rotation fails, **When** the system continues running, **Then** the failure is reported through a fallback diagnostic channel with the affected path and operation while secrets remain redacted.

### Edge Cases

- A console method is called with no arguments, `undefined`, symbols, functions, large strings, deeply nested values, typed arrays, blobs, errors with causes, or objects whose getters throw.
- The same object appears in multiple argument positions or contains self-references.
- An element is detached, belongs to another document, contains script/style content, contains password or token fields, or exceeds the capture limit.
- Console methods are reassigned by application code or browser tooling after capture is initialized.
- The logging transport itself writes to the console and could otherwise create an infinite capture loop.
- The page closes, reloads, or goes offline while entries are queued for delivery.
- Entries arrive concurrently from multiple browser tabs and backend operations with identical timestamps.
- A single entry exceeds the configured file threshold or the available disk space.
- Rotation is interrupted between archive creation and active-file replacement.
- The log ingress receives malformed, oversized, unauthenticated, or unsupported-version entries.
- The system clock changes or frontend and backend clocks disagree.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a backend log-ingress endpoint for frontend diagnostic entries and reject requests that are malformed, oversized, unauthenticated when authentication is configured, or use an unsupported schema version.
- **FR-002**: The frontend MUST capture each call to the supported console methods `debug`, `log`, `info`, `warn`, and `error` after logging initialization, while preserving the browser console's original observable behavior.
- **FR-003**: The frontend MUST attempt delivery once for every captured console call, assign a unique entry identifier before delivery, and prevent retries from creating duplicate persisted entries.
- **FR-004**: Each log entry MUST include a schema version, unique entry identifier, source (`frontend`, `backend`, or `interaction`), severity or event type, occurrence timestamp, receipt timestamp, session identifier, and available request or operation correlation identifier.
- **FR-005**: Each captured console argument MUST be stored under a stable positional key such as `arg0`, `arg1`, and `arg2`; nested object property names and array order MUST be preserved within configured depth and size limits.
- **FR-006**: Document-element arguments MUST be represented by sanitized, bounded HTML snapshots that exclude scripts, executable attributes, form values, hidden credentials, and other configured sensitive content.
- **FR-007**: Error values MUST retain their safe name, message, stack, and cause information; unsupported, circular, truncated, or failed-to-read values MUST be represented by explicit typed placeholders.
- **FR-008**: The system MUST apply the same recursive redaction policy to frontend logs, backend logs, interaction entries, serialization errors, and fallback diagnostics before any persistent write.
- **FR-009**: The redaction policy MUST cover credentials, authorization headers, API keys, session tokens, signed URLs, blob URLs, raw temporary tokens, password values, private form values, and configured sensitive property names without relying only on exact letter casing.
- **FR-010**: Backend informational, warning, and error events MUST be recorded through the same persistence path and schema as frontend entries, with backend origin metadata preserved.
- **FR-011**: The system MUST preserve a deterministic total order using occurrence time plus a collision-safe sequence or receipt order when events share timestamps or arrive out of order.
- **FR-012**: Interaction capture MUST be controlled by an explicit configuration flag, MUST default to disabled when absent or invalid, and MUST expose only its non-secret enabled/disabled state to the frontend.
- **FR-013**: When interaction capture is enabled, the system MUST capture only allowlisted navigation, pointer activation, keyboard-command, and form-submission metadata needed for diagnosis.
- **FR-014**: Interaction capture MUST NOT persist raw keystrokes, text or password field values, clipboard contents, uploaded media contents, canvas contents, or sensitive element attributes.
- **FR-015**: Frontend capture and delivery MUST prevent self-generated logging, retries, and fallback reporting from recursively producing additional captured entries.
- **FR-016**: Temporary delivery failure MUST NOT block console output or primary editor workflows; any retry queue MUST be bounded by configurable entry and byte limits and MUST discard oldest low-severity entries first when the bound is reached while retaining a redacted warning describing the loss.
- **FR-017**: The unified log MUST rotate when the configured active-file threshold is reached, retain no more than the configured number of total files, and delete the oldest archive only after the replacement active file is safely available.
- **FR-018**: The default retention policy MUST use a 10 MiB active-file threshold and retain at most five files including the active file; both values MUST be configurable and validated against safe minimum and maximum bounds.
- **FR-019**: Every active and archived log file MUST be independently parseable JSON, retain complete records only, identify its schema version, and preserve the ordering metadata needed to reconstruct the unified trail across rotations.
- **FR-020**: A single entry larger than the active-file threshold MUST be reduced to a valid bounded representation with explicit truncation metadata rather than preventing subsequent entries from being stored.
- **FR-021**: Persistence, serialization, redaction, validation, authentication, and rotation failures MUST be surfaced through a non-recursive fallback diagnostic channel with actionable operation and identifier context.
- **FR-022**: Log records MUST NOT contain executable markup, and viewing or processing a stored HTML snapshot MUST treat it as inert diagnostic data.
- **FR-023**: Logging configuration MUST support distinct controls for logging enabled state, interaction capture, file threshold, retained file count, per-entry size, serialization depth, delivery queue size, and allowlisted interaction types.
- **FR-024**: Disabling logging MUST stop new frontend delivery and backend persistence without changing ordinary console output or primary application behavior.

### Key Entities *(include if feature involves data)*

- **Unified Log Entry**: One versioned diagnostic record with identity, source, severity or event type, timestamps, ordering data, correlation context, structured payload, and redaction/truncation metadata.
- **Argument Map**: The stable positional collection for a console call (`arg0`, `arg1`, and so on), preserving nested keys, array order, type information, and any explicit serialization placeholders.
- **HTML Snapshot**: An inert, sanitized, size-bounded representation of a document element supplied as a console argument, with sensitive values and executable content removed.
- **Interaction Entry**: An opt-in log entry describing an allowlisted user action through safe target and navigation metadata, without typed content or sensitive attributes.
- **Logging Configuration**: The validated operational settings that control enablement, optional interaction capture, capture limits, retry bounds, rotation, retention, and allowlists.
- **Log File Set**: One active file and its ordered archives, each independently valid and collectively bounded by the configured retention policy.

### Assumptions and Dependencies

- “Keyed pop” is interpreted as a keyed property collection: each console argument receives a stable positional key and object values retain their own property keys.
- The existing frontend in-memory diagnostic log remains available; this feature adds durable unified capture rather than replacing user-facing problem reporting.
- The existing backend authentication and configuration mechanisms can protect the ingress and expose non-secret capability flags.
- Interaction capture is for local diagnostics, not product analytics or session replay, and defaults to disabled.
- Rotation defaults to 10 MiB per active file and five retained files because no retention values were specified; planning may tighten safe configuration bounds without changing these defaults.
- Browser shutdown delivery is best-effort. Failure to deliver the final queued entries must be observable on the next available diagnostic channel, but must not block page exit.

### Out of Scope

- A log viewer, search dashboard, remote log shipping, alerting, analytics, or full visual session replay.
- Capturing network bodies, media bytes, canvas pixels, screenshots, raw keyboard input, or form-field contents.
- Replacing the browser developer console or changing how existing console calls render there.
- Guaranteeing delivery after abrupt process termination when no durable queue write was possible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In deterministic coverage of every supported console method, 100% of representative frontend calls and backend events appear exactly once in the unified trail within one second of backend receipt and retain their source and severity.
- **SC-002**: For representative primitives, nested objects, arrays, errors, circular values, and document elements, 100% of argument positions remain identifiable and all unsupported or truncated data is explicitly marked rather than silently omitted.
- **SC-003**: Across security fixtures containing credentials, signed URLs, tokens, private field values, and executable markup, zero sensitive raw values or executable content appear in active files, archives, serialization errors, or fallback diagnostics.
- **SC-004**: With interaction capture disabled, zero tested user interactions produce interaction entries; with it enabled, 100% of allowlisted tested actions produce sanitized entries and zero raw typed values or keystrokes are retained.
- **SC-005**: Under a test workload that crosses the rotation threshold at least three times, all retained files parse successfully, no complete accepted entry is duplicated or partially written, ordering is reconstructable, and retained storage remains within one maximum-entry allowance of the configured file-count and size bounds.
- **SC-006**: When log delivery or persistence is unavailable, all tested editor actions and original console calls still complete, and an actionable non-recursive failure diagnostic is produced without an unbounded retry loop.
- **SC-007**: At a sustained rate of 50 console calls per second, at least 95% of ordinary editor interactions show no more than 10 ms additional response delay attributable to logging.
- **SC-008**: An operator can correlate a representative frontend failure with its associated backend request and identify the causal sequence from the unified trail in under five minutes without consulting a second log source.
