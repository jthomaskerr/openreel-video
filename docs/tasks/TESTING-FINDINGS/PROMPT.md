# Task: TESTING-FINDINGS — Testing Expectations Implementation Findings

**Created:** 2026-07-06  
**Size:** S  
**Review Level:** 0 (docs-only, handoff format)

---

## Mission

You were previously working on analyzing `docs/spec/testing-expectations.md` and the testing infrastructure across the codebase. You got partway through before hitting a rate limit.

Write a **COMPLETE and COMPREHENSIVE handoff document** capturing **EVERYTHING you discovered**. Do NOT write the final plan. Instead capture all findings with evidence.

## Prior Findings

A previous subagent found: "7 of 8 workspace projects run test:run (packages/ui and apps/orchestrator lack the script). This is a process/checklist format, not a feature-based plan."

Build on this. Verify and expand the findings.

## Scope

Analyze and document:

1. **Test script audit** — For each package/app, audit `package.json` for test:run existence
   - `apps/web` — test:run present?
   - `apps/orchestrator` — test:run present? (previous finding: lacks script)
   - `apps/image` — test:run present?
   - `packages/core` — test:run present?
   - `packages/image-core` — test:run present?
   - `packages/music-video-domain` — test:run present?
   - `packages/ui` — test:run present? (previous finding: lacks script)

2. **Coverage tooling** — Coverage framework, thresholds, reporting
3. **CI pipeline gates** — Test execution in CI, blocking conditions, coverage gates
4. **Test naming and organization** — Conventions, structure, file naming
5. **TDD requirements** — Spec mandates for TDD adoption
6. **Regression test expectations** — Test coverage requirements per area
7. **Test infrastructure gaps** — Missing test:run scripts, coverage gaps, CI gaps
8. **Per-package remediation tasks** — Add test:run scripts where missing
9. **Coverage threshold enforcement** — Current thresholds, recommended changes
10. **ALL specific file paths, line numbers, code locations, and code snippets**
11. **Any bugs, divergences from spec, or missing infrastructure**

**Include:**
- Specific file paths to package.json files
- Current test scripts (exact commands)
- Coverage configurations and thresholds
- CI/CD pipeline configuration files
- Missing infrastructure list
- Remediation priority

## Deliverable

Write to: `docs/superpowers/plans/2026-07-05-testing-expectations-findings.md`

Format: Markdown with clear sections, code blocks, evidence citations (file:path).

**THEN STOP. Do not continue beyond completion of this handoff.**

---

## Required Reading

- `docs/spec/testing-expectations.md` (full spec, all sections)
- `package.json` files in all 8 packages/apps
- CI configuration (if exists: `.github/workflows/`, `.circleci/`, etc.)
- Coverage configuration files (if exist)

## Tools

Use grep, mcp_Read to audit package.json files and CI configs. Cite all evidence with file:path references.

## Completion

Task complete when findings document is written and saved. STOP immediately after.
