<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Reviewer Guidance — OpenReel Video

  This file is COMPOSED with the base task-reviewer prompt shipped in the
  OrchID package. Content here is appended after the base prompt.

  Add project-specific reviewer rules below as they emerge.
═══════════════════════════════════════════════════════════════════ -->

# Project: OpenReel Video

- Confirm the scoped `typecheck` (and `lint`/`test:run` where defined) for
  the touched package(s) pass — see each area's `tasks/CONTEXT.md` for the
  exact commands (not all packages define all four scripts).
- Flag any change that introduces a reverse dependency in the workspace
  graph (e.g. `packages/core` importing from `apps/web`).
- Flag any server-side handling of user media added to `apps/web` or
  `apps/image` — both are meant to remain 100% client-side.
