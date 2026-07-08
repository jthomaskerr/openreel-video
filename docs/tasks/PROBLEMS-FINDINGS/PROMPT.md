# Task: PROBLEMS-FINDINGS — Problems & Error Logging Implementation Findings

**Created:** 2026-07-06  
**Size:** M  
**Review Level:** 0 (docs-only, handoff format)

---

## Mission

You were previously working on analyzing `docs/spec/problems-errors-logging.md` and the Problems subsystem implementation in `apps/web/src/`. You got partway through before hitting a rate limit.

Write a **COMPLETE and COMPREHENSIVE handoff document** capturing **EVERYTHING you discovered**. Do NOT write the final plan. Instead capture all findings with evidence.

## CRITICAL FINDING

A previous subagent discovered a **CRITICAL BUG**: The `retry_generation` action **immediately resolves the problem**, contradicting the spec's explicit requirement that it "does NOT auto-resolve — the problem resolves only when the retry succeeds."

Verify and document this bug thoroughly. It requires a fix task in the plan.

## Scope

Analyze and document:

1. **ProblemKind registry** — All defined problem types, structure, categorization
2. **Resolve actions system** — All action types, execution flow, result handling
3. **CRITICAL BUG: retry_generation auto-resolve** — Current code, spec requirement, fix needed
4. **Problem state lifecycle** — Creation, persistence, resolution conditions
5. **Log immutability** — Append-only design, no modification logic
6. **Cross-session log persistence** — Storage mechanism, retrieval, retention limits
7. **Log size and retention** — Limits, cleanup policies, old log handling
8. **Problems tab UI integration** — Display, filtering, action buttons
9. **Log pane UI** — Log viewer, search/filter, readability
10. **Problem recovery patterns** — Automatic recovery, user-initiated recovery, manual intervention
11. **Error reporting and user feedback** — User-facing error messages, suggested actions
12. **ALL specific file paths, line numbers, code locations, and code snippets**
13. **Any bugs, divergences from spec, or missing features**
14. **Test coverage and gaps**

**Include:**
- Specific file paths, line numbers, code locations
- Code snippets showing problem creation, action execution, resolution
- All bugs with detailed evidence
- State management approach
- Error code mappings
- Test file locations and coverage gaps

## Deliverable

Write to: `docs/superpowers/plans/2026-07-05-problems-errors-logging-findings.md`

Format: Markdown with clear sections, code blocks, evidence citations (file:line).

**CRITICAL SECTION:** Include a detailed findings section on the retry_generation bug with:
- Current code snippet (lines X–Y in file Z)
- Spec requirement quote
- Impact analysis
- Recommended fix approach

**THEN STOP. Do not continue beyond completion of this handoff.**

---

## Required Reading

- `docs/spec/problems-errors-logging.md` (full spec, all sections)
- `apps/web/src/` problems-related components
- Look for: `problemBus`, `ProblemKind`, `retry_generation`, resolve actions

## Tools

Use code_graph, code_find, grep, mcp_Read to investigate. Cite all evidence with file:line references.

## Completion

Task complete when findings document is written and saved. STOP immediately after.
