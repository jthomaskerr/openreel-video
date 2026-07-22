# Feature Specification: Authoritative Durable Identity

**Feature Branch**: `main`
**Created**: 2026-07-23
**Status**: Draft
**Input**: User description: "Eliminate the false positive that reports a durable project as unable to open and make recurring project-open failures impossible for valid or recoverable projects."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open Every Valid Durable Project (Priority: P1)

An editor opens a project that exists in managed storage and resumes work using the managed identifier assigned by the backend.

**Why this priority**: Incorrectly rejecting an existing project blocks the entire editing workflow and makes saved work appear lost.

**Independent Test**: Create otherwise equivalent durable projects whose identifiers cover every supported identifier form, open each from the recent-project list, a direct project link, and a page reload, and verify that the requested project becomes active with its saved content intact.

**Acceptance Scenarios**:

1. **Given** a durable project exists, **When** the user opens it, **Then** the editor uses its backend-managed identifier and activates the complete saved project.
2. **Given** the user creates or imports a project, **When** creation succeeds, **Then** the active project receives the backend-managed identifier and no client-created project identifier is retained.
3. **Given** the same valid project is selected from any supported open entry point, **When** loading completes, **Then** every entry point reaches the same successful project state.
4. **Given** a valid project takes longer than 300 milliseconds to open, **When** loading is still in progress, **Then** the user sees a project-specific loading status and the editor does not appear frozen.

---

### User Story 2 - Recover Supported Older Projects (Priority: P1)

An editor opens a project created by an older supported version and continues working without manually repairing its saved data.

**Why this priority**: A routine application update must not strand previously saved work or turn a compatible omission into a fatal load error.

**Independent Test**: Open representative older project fixtures with each supported missing or obsolete field, including combinations of migrations, and verify that the editor restores a complete usable project without changing the durable source until the user next saves.

**Acceptance Scenarios**:

1. **Given** an older project omits fields that have supported defaults, **When** the user opens it, **Then** the project is upgraded in memory and opens with the documented defaults.
2. **Given** an older project requires multiple supported upgrades, **When** it is opened, **Then** all upgrades are applied in order and the complete project opens.
3. **Given** a project opens with missing or inaccessible media but its editing data is valid, **When** hydration completes, **Then** the editor opens the project, preserves every media reference, identifies each unavailable item, and offers available relink or retry actions.

---

### User Story 3 - Recover Safely from a Real Load Failure (Priority: P2)

When a requested project genuinely cannot be loaded, an editor receives an accurate diagnosis and a recovery path while the currently open project and all saved work remain untouched.

**Why this priority**: Genuine failures cannot always be prevented, but they must not be confused with absence, destroy context, or trap the user in an unusable loading screen.

**Independent Test**: Exercise confirmed absence, temporary unavailability, denied access, malformed content, unsupported future format, and available local recovery-copy cases, then verify the distinct user outcome and preserved active state for each case.

**Acceptance Scenarios**:

1. **Given** the authoritative source is temporarily unreachable, **When** opening cannot be completed, **Then** the system reports temporary unavailability, keeps the current project unchanged, and offers retry without claiming that the project does not exist.
2. **Given** the requested durable project is confirmed absent but a valid recovery copy exists, **When** opening is attempted, **Then** the user is offered that same-project recovery copy and no replacement project is created automatically.
3. **Given** access is denied, content is corrupt, or the format is from an unsupported future version, **When** opening is attempted, **Then** the user receives the correct actionable reason and the system does not partially activate or overwrite the project.
4. **Given** opening fails after another project is already active, **When** the failure reaches a terminal state, **Then** the previous project, its unsaved status, history, and pending persistence remain unchanged and usable.
5. **Given** the editor was launched directly for a project that cannot currently be loaded, **When** recovery options are exhausted, **Then** the user can return to the project chooser or retry without reloading the application.

---

### User Story 4 - Detect Future False Rejections Before Release (Priority: P2)

A maintainer can prove that every supported project identity, format version, open entry point, and recoverable degradation follows the same project-opening contract.

**Why this priority**: The defect has recurred because narrow fixes protected one data shape or entry point while leaving equivalent paths unguarded.

**Independent Test**: Run a deterministic compatibility matrix covering identity forms, format generations, entry points, storage outcomes, recovery-copy availability, and media availability; any valid or recoverable project rejection fails the release gate.

**Acceptance Scenarios**:

1. **Given** the supported compatibility fixture matrix, **When** the project-open regression suite runs, **Then** every valid fixture opens and every recoverable fixture reaches its documented recovery state.
2. **Given** a new project field, identifier form, migration, or open entry point is introduced, **When** release validation runs, **Then** missing compatibility coverage fails the gate until an explicit fixture and expected outcome are added.
3. **Given** a browser release candidate, **When** the manually migrated managed project is exercised, **Then** the project opens from the chooser and direct link, survives reload, and remains editable and saveable without any UUID project identity appearing in the URL, project data, recovery state, or persistence requests.

---

### User Story 5 - Use Final Identities from First Creation (Priority: P1)

An editor imports media, creates clips, tracks, effects, generated assets, or background jobs and can trust that the identity first attached to each object is its permanent identity for the object's entire lifetime.

**Why this priority**: Provisional identifiers create two identities for one object, break references during reload or asynchronous completion, and make recovery ambiguous.

**Independent Test**: Exercise every persisted object-creation workflow, interrupt or reload it at each asynchronous boundary, and verify that the first identity is durable, remains unchanged, and is never translated from a temporary UUID.

**Acceptance Scenarios**:

1. **Given** media is imported or generated, **When** the media first enters project state, **Then** it already has the durable identity used by uploads, clips, versions, jobs, saves, and recovery.
2. **Given** a clip, track, effect, keyframe, transition, asset group, generated definition, job, or action receipt is created, **When** it becomes referencable, **Then** its first identity is final and no temporary identity mapping exists.
3. **Given** an operation is cancelled or fails before a durable object exists, **When** cleanup completes, **Then** no placeholder domain object or temporary domain identifier remains in persisted state.
4. **Given** internal atomic-write, lock-owner, or capability randomness is required, **When** it is used, **Then** it remains an explicitly typed non-domain nonce and can never enter project data or serve as an object identity.

### Edge Cases

- A stale browser URL, recent-project entry, or recovery record still contains the retired UUID project identity after the one-time manual migration.
- The requested identifier is syntactically unusual but safely encodable and the authoritative source recognizes it.
- The project exists, but the project summary list is unavailable or stale.
- The project summary exists, but the full project read temporarily fails.
- The load request is cancelled because the user opens a different project before the first request completes.
- An older project needs more than one migration, or already contains a mix of old and current fields.
- Project data is valid while one or more media downloads, thumbnails, decodes, or permissions fail.
- A local recovery copy is newer than the durable project, older than it, malformed, or belongs to a different project identity.
- The project is confirmed absent, access is denied, or the format version is newer than the editor supports.
- A late response for a previously requested project arrives after another project has become active.
- The editor reloads while the requested project is loading or while a recovery choice is displayed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every active project MUST use a backend-managed project identifier; the web client MUST NOT generate UUIDs or any other provisional identity for projects.
- **FR-002**: A project MUST be rejected only from evidence about that specific retrieval or its content, such as confirmed absence, denied access, malformed content, or an explicitly unsupported future format.
- **FR-003**: Every supported project-opening entry point, including the recent-project chooser, project switcher, direct project link, reload restoration, portable project import, and recovery flow, MUST apply the same availability, compatibility, and activation rules.
- **FR-004**: The system MUST validate and apply all supported project upgrades before project activation, including combinations of upgrades rather than only one missing field at a time.
- **FR-005**: Supported older projects MUST open with documented defaults for absent fields and MUST preserve all recognized project data.
- **FR-006**: Missing, inaccessible, or undecodable media MUST degrade the affected media items rather than reject an otherwise valid project; affected references and recovery actions MUST remain visible.
- **FR-007**: The system MUST distinguish confirmed absence, temporary source unavailability, denied access, malformed project content, unsupported future format, media degradation, and user cancellation as separate outcomes.
- **FR-008**: Temporary unavailability or an indeterminate response MUST NOT be reported as a nonexistent, invalid, or permanently unopenable project.
- **FR-009**: Before reporting a terminal failure, the system MUST check eligible recovery copies for the same stable project identity and present valid candidates without silently substituting them.
- **FR-010**: A failed, cancelled, superseded, or partially hydrated open attempt MUST leave the previously active project, unsaved state, editing history, media state, and pending persistence unchanged.
- **FR-011**: A requested project MUST become active only after its required project data is validated and upgraded; late results from older requests MUST NOT replace the current project.
- **FR-012**: The system MUST NOT create a blank or replacement project as an implicit response to an open failure.
- **FR-013**: Loading that exceeds 300 milliseconds MUST show a project-specific progress state, and every attempt MUST reach success, a recovery choice, cancellation, or an actionable failure state without leaving the editor indefinitely blocked.
- **FR-014**: Every terminal failure MUST identify the affected project with a safe identifier, state the accurate failure category, preserve user work, and provide the applicable next actions such as retry, relink, request access, choose a recovery copy, or return to the chooser.
- **FR-015**: Structured diagnostics MUST record the requested safe project identifier, open entry point, request outcome, failure category, and recovery decision while redacting credentials, signed URLs, native paths, blobs, and sensitive project content.
- **FR-016**: The project-open compatibility contract MUST include the single backend-managed identifier form, project format generations, upgrade expectations, open entry points, storage outcomes, recovery-copy states, and media-degradation states.
- **FR-017**: Any change to project identity, serialized project shape, compatibility rules, or a project-opening entry point MUST add or update a deterministic compatibility fixture before release.
- **FR-018**: Project creation, portable import, recovery, recent-project selection, direct-link restoration, and project switching MUST never introduce or reactivate a UUID project identity.
- **FR-020**: The one existing Git-backed project MUST be snapshotted, confirmed fully committed, manually assigned its managed identifier, and verified before UUID project support is removed; no reusable runtime migration code is required.
- **FR-021**: Stale client state that references the retired UUID project identity MUST be discarded or redirected to the managed project without presenting a false "cannot open project" terminal state.
- **FR-022**: Persisted and cross-boundary domain objects MUST receive their final durable identity before they enter application state or become referencable.
- **FR-023**: Media import, media generation, placeholder fulfillment, and asset versioning MUST use one durable media identity from creation through completion; no provisional media UUID or replacement mapping is permitted.
- **FR-024**: Clips, tracks, effects, keyframes, transitions, generated-image definitions, asset groups, jobs, recovery records, actions, receipts, and other persisted domain entities MUST NOT use UUID-format identities.
- **FR-025**: Failed or cancelled operations MUST represent pending work as operation state, not as fake projects, placeholder domain objects, or temporary domain identifiers.
- **FR-026**: The initial editor state MUST represent the absence of an active project explicitly and MUST NOT fabricate an "unresolved" project or identifier.
- **FR-027**: Random values used only for atomic filenames, lock ownership, security capabilities, or provider-issued identifiers MUST be typed and named as non-domain nonces or external identifiers and MUST be prevented from entering persisted OpenReel domain identity fields.
- **FR-028**: A repository guard MUST fail when production domain code introduces UUID generation, temporary-domain-ID terminology, or an unapproved domain identifier generator.
- **FR-029**: The one existing Git-backed project MUST have every UUID-format domain identity and reference rewritten consistently in one manual, snapshotted, validated commit before the new identity invariant is released.
- **FR-019**: The project-open failure state MUST remain navigable and operable by keyboard and assistive technology, with focus placed on the failure heading or primary recovery action.

### Verification Requirements *(mandatory)*

- **VR-001**: Regression tests MUST be observed failing before implementation because client-side project creation, import, or recovery can still introduce UUID project identities, and passing afterward when only backend-managed identities can become active.
- **VR-002**: A deterministic matrix MUST cover every combination required by FR-016, including managed projects, retired UUID references in stale client state, supported legacy omissions, combined upgrades, temporary source failure, confirmed absence, denied access, malformed data, future format, missing media, cancellation, late responses, and same-project recovery copies.
- **VR-003**: Store and service tests MUST prove that failed, cancelled, and superseded opens cannot mutate the active project or bind persistence work to the wrong project.
- **VR-004**: Browser verification MUST open the manually migrated managed project from the recent-project chooser and a direct link, reload it, edit it, save it, and reopen it; evidence MUST prove that the retired UUID identity is absent and representative content is preserved.
- **VR-005**: Browser verification MUST also exercise temporary unavailability and missing-media degradation, proving that retry or relink remains available and the editor is not trapped on a loading or generic failure screen.
- **VR-006**: Diagnostics tests MUST prove stable failure categorization and redaction of credentials, signed URLs, native paths, blobs, and project content.
- **VR-007**: No probabilistic behavior or LLM decision is involved in project eligibility, compatibility, recovery selection, or failure classification; these outcomes MUST remain deterministic and require no probabilistic eval.
- **VR-008**: Identity graph tests MUST prove that every rewritten or newly created reference resolves to exactly one durable entity and that no UUID-format domain identifiers remain.
- **VR-009**: Repository-level architecture tests MUST scan production domain sources and persisted fixtures for forbidden UUID or temporary-domain-ID generation, with an explicit allowlist limited to non-domain nonces and external provider identifiers.

### Key Entities

- **Project Open Request**: A request to activate one stable project identity from a named entry point, with cancellation and supersession state.
- **Project Identity**: The opaque stable identifier that relates summaries, durable content, recovery copies, media, saves, and diagnostics; its syntax does not prove where the project originated or whether it exists.
- **Authoritative Project Record**: The complete durable project data returned for a specific identity, together with enough format and revision information to evaluate compatibility.
- **Compatibility Outcome**: The deterministic result of assessing project content: current, supported and upgraded, unsupported future format, or malformed.
- **Recovery Copy**: A separately stored candidate tied to the same project identity and timestamp, offered only after its identity and compatibility are verified.
- **Open Failure**: A terminal categorized outcome with safe diagnostics, preserved prior state, and one or more actionable next steps.
- **Durable Domain Identity**: The single final path-safe identity assigned to an OpenReel object before it becomes referencable and retained unchanged for that object's lifetime.
- **Non-Domain Nonce**: A random value used only for atomicity, lock ownership, capability security, or another bounded infrastructure purpose; it is not an object identity and cannot be persisted into the project graph.

### Assumptions

- Managed storage remains the canonical durable source, while portable files and local recovery copies remain explicit alternate sources.
- Only one existing project requires identity conversion, and its Git history is the recovery source for a one-time manual migration rather than reusable application migration logic.
- Supported older formats are those for which the product defines deterministic defaults or upgrades; unknown future formats remain blocked to prevent partial or destructive loading.
- Media availability is separable from project-data validity, so missing media should not prevent access to the rest of a valid project.
- The feature hardens existing project-opening behavior and does not add collaboration, sharing, deletion, or automatic content repair for malformed projects.

### Out of Scope

- Guessing or reconstructing malformed project content when no deterministic recovery rule exists.
- Automatically merging divergent durable and recovery copies.
- Changing project authorization or retention policy.
- Treating unsupported future project formats as compatible without an explicit upgrade path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across the complete deterministic compatibility matrix, 100% of valid current and supported older project fixtures open successfully from every supported entry point using only backend-managed project identities.
- **SC-002**: Across all recoverable fixtures, 100% reach the correct recovery or degraded editing state without creating a replacement project or losing recognized project data.
- **SC-003**: Across all failed, cancelled, superseded, and late-response cases, 100% preserve the previously active project's content, unsaved status, history, and pending persistence ownership.
- **SC-004**: Under normal local verification conditions, a loading status appears within 300 milliseconds and every project-open attempt reaches a usable success, recovery, cancellation, or actionable failure state within 5 seconds after its final source response.
- **SC-005**: In browser verification, the manually migrated managed project opens from both the chooser and direct link, survives reload, accepts an edit and save, and reopens with that edit preserved in 100% of 10 consecutive runs, with zero UUID project identities observed.
- **SC-006**: In accessibility verification, all project-open progress, recovery, and failure outcomes expose a readable status and keyboard-operable next action with no keyboard trap.
- **SC-007**: For every induced terminal failure, diagnostics contain the safe project identifier, entry point, and stable failure category, while 100% of tested sensitive values are absent.
- **SC-008**: After release, supported-project false-rejection reports attributable to identifier classification or missing supported upgrades remain at zero.
- **SC-009**: The migrated Vintage Tokyo project contains zero UUID-format values in OpenReel domain identity or reference fields, and 100% of its 53 media items and 42 clips retain valid referential links.
- **SC-010**: Across all automated creation, cancellation, failure, reload, recovery, and completion cases, zero persisted domain objects change identity after first becoming referencable and zero temporary-domain-ID mappings are created.
