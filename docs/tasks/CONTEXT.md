# Task Area: docs

**Prefix:** DOC

## Scope

Cross-cutting documentation and planning work that doesn't belong to a
single package area: operational specs (`docs/spec/`), implementation plans
(`docs/superpowers/plans/`), and alignment/gap-analysis work between the two.

This area produces **planning documents**, not code changes. Tasks here are
generally not parallelizable against each other when they touch the same
plan set — check `docs/superpowers/plans/` for tasks already in flight
before starting a new one.

## Key Files

| Category | Path |
|---|---|
| Operational specs | `docs/spec/*.md` |
| Implementation plans | `docs/superpowers/plans/*.md` |
| Prior alignment analysis | `docs/superpowers/plans/alignment.md` |

## Conventions

- Plans are named `YYYY-MM-DD-<kebab-case-title>.md` in
  `docs/superpowers/plans/`.
- Do not duplicate an existing plan's scope — read all files in
  `docs/superpowers/plans/` first and treat their covered scope as already
  planned (even if implementation is incomplete), unless the task explicitly
  asks you to also audit/update those plans.
- This area has no code to typecheck/lint/test — verification is a matter of
  cross-referencing spec claims against the actual source tree (use
  `code_find`/`code_graph`/`grep` against `apps/` and `packages/`).

## Reference Docs

- `docs/spec/OPERATIONAL-SPEC-UPDATE-SUMMARY.md` — meta-summary of spec state
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
