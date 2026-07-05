# Task: DOC-001 — Spec Gap Analysis & Implementation Plans

**Created:** 2026-07-05
**Size:** L

## Review Level: 1 (Light)

**Assessment:** Documentation/planning-only task (no source code changes),
but with meaningful judgment calls about scope, priority, and completeness
claims. A reviewer pass adds value without heavy process.
**Score:** 3/8 — Blast radius: 1 (docs only), Pattern novelty: 1, Security: 0,
Reversibility: 1 (docs are easy to revise)

## Canonical Task Folder

```
docs/tasks/DOC-001-spec-gap-analysis/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Evaluate every operational spec in `docs/spec/` against the current state of
the codebase (`apps/`, `packages/`) to determine implementation completeness
and correctness. For every gap found — missing functionality, partial
implementation, or spec/code divergence — write (or update) an implementation
plan in `docs/superpowers/plans/` describing how to close it.

**Do not duplicate work already covered by an existing plan file in
`docs/superpowers/plans/`.** Read every file in that directory first
(including `alignment.md`, which is a prior analysis pass, not an
implementation plan) and treat any domain/gap already addressed by an
existing plan as out of scope for *new* plan creation — even if that plan's
implementation is still incomplete. Existing incomplete plans should instead
be captured in the final prioritized list (see Deliverables) so the operator
can see the full picture in one place, not duplicated with a second plan.

## Context to Read First

- All files in `docs/spec/` (19 specs + `music-video-timeline-native/`
  subdirectory + `OPERATIONAL-SPEC-UPDATE-SUMMARY.md`)
- All files in `docs/superpowers/plans/` (11 existing plan files +
  `alignment.md` + `spec-update/` analysis artifacts)
- `docs/tasks/CONTEXT.md` (this task area's conventions)
- Use `code_find` / `code_graph` / `code_orientation` (or `grep`) against
  `apps/web`, `apps/image`, `apps/orchestrator`, and `packages/*` to verify
  claims in each spec against real implementation — do not rely on spec text
  alone or assume something is implemented because a plan exists for it.

## Environment

- **Workspace:** Project root
- **Services required:** None (read-only analysis; no dev server needed)

## File Scope

- **Read:** `docs/spec/**`, `docs/superpowers/plans/**`, `apps/**`,
  `packages/**` (read-only for source — do not edit application code)
- **Write:** New or updated Markdown files under `docs/superpowers/plans/`
  only, plus this task's own `STATUS.md`/`.reviews/`

## Steps

### Step 0: Preflight

- [ ] Verify this PROMPT.md is readable
- [ ] Verify STATUS.md exists in the same folder
- [ ] List every file in `docs/spec/` and every file in
      `docs/superpowers/plans/` to build the working inventory

### Step 1: Build the Existing-Plans Coverage Map

- [ ] For each file in `docs/superpowers/plans/` (excluding
      `alignment.md` and the `spec-update/` artifacts, which are analysis,
      not plans), identify which spec(s) in `docs/spec/` it covers and
      summarize its current completion status (if the plan itself states
      progress/checkboxes, use those; otherwise infer from a quick check of
      whether the described work exists in the codebase)
- [ ] Produce a spec → covering-plan(s) map so gaps are easy to see

### Step 2: Evaluate Each Spec for Completeness & Correctness

For every file in `docs/spec/` NOT already fully covered by an existing plan
(per Step 1's map), or where the existing plan only partially covers the
spec's scope:

- [ ] Read the spec in full
- [ ] Identify the concrete implementation surface it describes (components,
      modules, data types, workflows) and locate the corresponding code in
      `apps/`/`packages/` using `code_find`/`code_graph`/`grep`
- [ ] Classify each spec requirement as: **Implemented & Correct**,
      **Implemented but Divergent** (code exists but behavior/shape doesn't
      match spec), **Partially Implemented**, or **Not Implemented**
- [ ] Note any spec/code naming ambiguities or overlaps worth flagging (e.g.
      the pre-existing "Section" overloading noted in `alignment.md`) but do
      not re-litigate issues `alignment.md` already raised — cross-reference
      it instead of repeating it

### Step 3: Write New Implementation Plans for Genuine Gaps

- [ ] For each gap identified in Step 2 that is not already covered by an
      existing plan, write a new plan file in `docs/superpowers/plans/`
      named `2026-07-05-<kebab-case-title>.md` following the structure and
      tone of the existing plan files in that directory (read at least 2-3
      existing plans first to match format/depth)
- [ ] Each new plan must include: problem statement, current state vs. spec,
      concrete implementation steps, affected packages/files, and a rough
      size/complexity estimate
- [ ] Do not write a plan for anything already covered by an existing plan
      file, even if that plan is incomplete — see Deliverables instead

### Step 4: Prioritized Plan List (Deliverable)

- [ ] Write `docs/superpowers/plans/2026-07-05-spec-gap-priorities.md`
      containing a single prioritized list of **every** plan relevant to
      closing spec gaps — both the new plans written in Step 3 and the
      existing (including incomplete) plans found in Step 1
- [ ] For each entry include: plan filename, one-line summary, priority
      (P0/P1/P2 or High/Medium/Low — be consistent), completion status
      (Not Started / Partial / Done, based on Step 1/2 findings), and a short
      justification for the priority (e.g. blast radius, user-facing impact,
      how many other specs/plans depend on it)
- [ ] Priority should consider: how foundational the spec/plan is (e.g.
      `backend-persistence-versioning.md`, `export.md`, `inspector-shell.md`
      were flagged as heavily-cited foundations in `alignment.md`), user-
      facing impact, and how much of the described work is already done

### Step 5: Delivery

- [ ] Update this task's `STATUS.md` with a summary of specs evaluated, gaps
      found, plans written, and plans skipped (already covered) with reasons
- [ ] Confirm no application source files were modified

## Documentation Requirements

**Must Update:** `docs/superpowers/plans/` (new plan files as needed),
`docs/superpowers/plans/2026-07-05-spec-gap-priorities.md` (required)
**Check If Affected:** None (docs-only task)

## Completion Criteria

- [ ] Every spec in `docs/spec/` has been evaluated against the codebase
- [ ] Every existing plan in `docs/superpowers/plans/` has been read and
      accounted for in the coverage map (no duplicate plans created)
- [ ] A new plan file exists for every genuine gap not already covered
- [ ] `docs/superpowers/plans/2026-07-05-spec-gap-priorities.md` exists and
      lists every relevant plan (new + existing) in priority order with
      status and justification
- [ ] No files outside `docs/superpowers/plans/` and this task folder were
      modified

## Git Commit Convention

- **Implementation:** `docs(DOC-001): description`
- **Checkpoints:** `checkpoint: DOC-001 description`

## Do NOT

- Modify any application source code under `apps/` or `packages/`
- Duplicate the scope of an existing plan file with a new plan file
- Re-run or repeat the analysis already captured in `alignment.md` —
  cross-reference it instead
- Invent implementation status without checking the actual codebase
  (no guessing whether something is "probably implemented")

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
