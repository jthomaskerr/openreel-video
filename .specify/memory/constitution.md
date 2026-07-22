<!--
Sync Impact Report
- Version change: unratified template -> 1.0.0
- Added principles:
  - I. Outcome-Driven Delivery
  - II. Deterministic Core and Explicit Judgment Boundaries
  - III. Test-First and Eval-Gated Verification
  - IV. Service Ownership and Typed Contracts
  - V. Explicit Failure, Observability, and Data Safety
  - VI. Evidence-Based Release and Repository Discipline
- Added sections:
  - Architecture and Dependency Policy
  - Development Workflow and Quality Gates
- Templates synchronized:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .agents/skills/speckit-tasks/SKILL.md
- Follow-up TODOs: none
-->

# OpenReel Video Constitution

## Core Principles

### I. Outcome-Driven Delivery

Every feature MUST name a measurable user-visible or operational outcome before
implementation. Delivery MUST include the permanent implementation, deterministic tests,
required probabilistic evals, documentation, and fresh verification evidence when feasible in
the same task. Every bug fix MUST include a regression test. Passing tests alone MUST NOT be
treated as proof when the behavior, failure modes, or user workflow remain unexplained.

Rationale: work is complete only when its intended outcome and the evidence supporting it are
clear to a reviewer and reproducible by another engineer.

### II. Deterministic Core and Explicit Judgment Boundaries

Arithmetic, time calculations, structured transformation, validation, hashing, parsing,
monitoring, and other reproducible behavior MUST be implemented as deterministic code with
typed inputs and outputs. Judgment-dependent behavior MAY use an LLM only behind an explicit
contract with representative evals. OpenReel software MUST use local Claude Code for LLM calls
unless Joseph explicitly authorizes a hosted API. Reusable LLM access MUST live under
`services/llm/` with a typed contract, tests, evals, and no direct callers of external model APIs.

Rationale: deterministic work must remain reproducible, while probabilistic work requires a
visible boundary and measured quality.

### III. Test-First and Eval-Gated Verification

Feature and bug-fix work MUST begin with a failing deterministic test for the changed behavior,
followed by the smallest implementation that passes it. Gate tests MUST be local,
non-flaky, and preferably complete within two seconds. Probabilistic behavior MUST have an eval
with an explicit pass threshold before shipping. User-interface changes MUST be reproduced and
verified in the running browser against the exact changed workflow; component or type checks
alone are insufficient.

Rationale: red-green evidence proves that a test detects the intended regression, while browser
and eval gates cover behavior deterministic unit tests cannot establish.

### IV. Service Ownership and Typed Contracts

Each service or self-contained directory MUST own one concern, its implementation,
configuration, documentation, tests, required evals, and a typed boundary. Shared contracts
MUST live in `contracts/` or `schemas/`. One service MUST NOT reach into another service's
internals or share mutable state without an explicit contract. Business logic MUST NOT live at
the repository root. New abstractions MUST serve current requirements rather than speculative
future needs.

Rationale: explicit ownership and contracts make changes independently testable,
parallel-friendly, and reviewable.

### V. Explicit Failure, Observability, and Data Safety

Missing files, media, permissions, decoding, imports, network requests, fallbacks, and other
user-visible failures MUST produce actionable UI feedback or structured logs containing the
relevant safe identifiers. Silent `catch {}`, silent omission, and unexplained null or continue
paths are prohibited for user-visible workflows. Logs and reports MUST redact credentials,
signed URLs, private native paths, raw blobs, and sensitive provider payloads. Secrets,
untracked environment files, generated build outputs, and model weights MUST NOT be committed.
Destructive, production, or irreversible actions require explicit confirmation.

Rationale: failures must be diagnosable without exposing user data or causing unapproved loss.

### VI. Evidence-Based Release and Repository Discipline

Every completed change MUST identify why it is correct, its important failure modes, and the
fresh evidence supporting each claim. External compatibility claims MUST record exact versions,
fixture or artifact identity, hashes where applicable, results, and reproducible evidence.
Commits MUST be small, coherent, conventional, and MUST NOT bypass hooks. Unrelated dirty work
MUST be preserved. UI releases require browser evidence; monitored jobs require deterministic
progress; data-changing backfills require recoverable snapshots and before/after results.

Rationale: traceable evidence and disciplined history make releases auditable and recovery
practical.

## Architecture and Dependency Policy

1. Existing standard-library or established repository patterns MUST be considered before a new
   dependency or custom utility is introduced.
2. Important cross-cutting dependencies MUST be compared on maintenance recency, adoption,
   responsiveness, production evidence, and fit. The selected option and strongest rejected
   alternative MUST be documented.
3. Architecture, destructive scope, production behavior, compatibility, and migration ambiguity
   MUST be resolved with Joseph before implementation when the choice would materially change
   the outcome.
4. Cross-service changes MUST use versioned contracts. Independent work MAY proceed in isolated
   worktrees when coordination costs justify it.
5. Security, privacy, compatibility, and recovery requirements are release gates, not deferred
   polish.

## Development Workflow and Quality Gates

1. Start coding sessions with the repository-mandated semantic tooling preflight. Use structured
   graph and symbol tools before broad text or file scans, and use Hindsight for memory.
2. Specifications MUST contain prioritized, independently testable user stories, explicit edge
   outcomes, functional requirements, and measurable success criteria.
3. Plans MUST document architecture, data and interface contracts, dependency research,
   deterministic test gates, required evals, browser verification, failure handling, and release
   evidence.
4. Task lists MUST place contracts and foundational types before dependent work. Every functional
   requirement and buildable success criterion MUST map to at least one task by identifier.
5. Tests MUST be written before implementation and observed failing for the intended reason.
   Verification MUST then run the complete relevant test, type, lint, browser, and compatibility
   gates with fresh output.
6. A plan or review with an unresolved Constitution MUST violation is blocked. Any permitted
   complexity exception MUST be explicit in the plan's Complexity Tracking section with its
   rationale and simpler rejected alternative.

## Governance

This constitution supersedes conflicting project guidance and Spec Kit templates. Amendments
require an explicit constitution update, a documented Sync Impact Report, propagation to
dependent templates and active plans, and review by Joseph. Versions follow semantic versioning:
MAJOR for incompatible governance changes or principle removals, MINOR for new or materially
expanded principles, and PATCH for non-semantic clarification. Every feature plan, task review,
and completion review MUST verify compliance. Unresolved MUST violations block implementation
and release rather than being silently waived.

**Version**: 1.0.0 | **Ratified**: 2026-07-22 | **Last Amended**: 2026-07-22
