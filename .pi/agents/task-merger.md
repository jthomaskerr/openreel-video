<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Merger Guidance — OpenReel Video

  This file is COMPOSED with the base task-merger prompt shipped in the
  OrchID package. Content here is appended after the base prompt.

  Add project-specific merge rules below as they emerge.
═══════════════════════════════════════════════════════════════════ -->

# Project: OpenReel Video

- After merging lanes, run `pnpm -r typecheck` and `pnpm -r lint` (the
  configured `orchestrator.merge.verify` commands) before concluding the
  merge is clean.
- No branch protection is configured on `main` for this repo — integration
  mode is `manual`, so nothing is pushed automatically; the operator runs
  `/orch-integrate` explicitly.
