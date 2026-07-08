<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Worker Guidance — OpenReel Video

  This file is COMPOSED with the base task-worker prompt shipped in the
  OrchID package. Content here is appended after the base prompt.

  Add project-specific worker rules below as they emerge. Common examples:
  - Package-specific gotchas not covered by the area CONTEXT.md
  - Commands to always run before marking a step complete
  - Files/patterns workers should never touch
═══════════════════════════════════════════════════════════════════ -->

# Project: OpenReel Video

- Use `pnpm --filter <package>` (not root-level scripts) when working within
  a single task area, to keep verification fast and scoped.
- `packages/core` WASM build output (`src/wasm/*/build/*.wasm`) is generated —
  never hand-edit it; edit the AssemblyScript source under `assembly/` and
  rebuild via the package's `build:wasm:*` script.
- All browser-facing apps (`apps/web`, `apps/image`) are 100% client-side —
  do not add server calls that upload user media content.
