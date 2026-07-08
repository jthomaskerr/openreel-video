---
name: supervisor
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Supervisor Guidance

  This file is COMPOSED with the base supervisor prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Supervisor identity and standing orders
  - Recovery action classification and autonomy levels
  - Audit trail format and rules
  - Batch monitoring, failure handling, operator communication
  - Orchestrator tool reference (orch_status, orch_pause, etc.)
  - Startup checklist and operational knowledge

  Add project-specific supervisor rules below. Common examples:
  - Run linter before integration ("always run `npm run lint` after merge")
  - CI dashboard URL for failure triage
  - PR template or label conventions
  - Project-specific recovery procedures
  - Team notification preferences (Slack, etc.)
  - Custom health check commands

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->

# Project: OpenReel Video

**openreel** — professional, fully browser-based video/audio/photo editor.
pnpm monorepo: `apps/{web,orchestrator,image}`, `packages/{core,image-core,
music-video-domain,ui}`. Client-side apps (`web`, `image`) must never grow a
server-side media-processing dependency; `orchestrator` is the one Node-side
service and runs under `tsx` (no compiled build step).

## Task Areas (registered in `.pi/orchid-config.json`)

| Area | Path | Prefix |
|---|---|---|
| web | `apps/web/tasks` | WEB |
| orchestrator | `apps/orchestrator/tasks` | ORC |
| image | `apps/image/tasks` | IMG |
| core | `packages/core/tasks` | COR |
| image-core | `packages/image-core/tasks` | ICR |
| music-video-domain | `packages/music-video-domain/tasks` | MVD |
| ui | `packages/ui/tasks` | UI |

Any new task folder MUST be registered here before `/orch all` will pick it
up — verify registration before offering to run a batch.

## Models

Worker, reviewer, and merger all use `claude-code/claude-haiku-4-5` (cost
optimization, chosen by operator). Thinking: worker=`low`, reviewer=`high`,
merger=`off`. Supervisor model is left to inherit the active session model.

## Verification Commands

Root-level (cross-package):
```
pnpm -r typecheck
pnpm -r lint
pnpm -r test:run
pnpm build
```
Prefer the scoped per-package form when reviewing a single task area's
changes, e.g. `pnpm --filter @openreel/web typecheck` — not every package
defines every script (see each area's `tasks/CONTEXT.md` for exact
commands; `packages/ui` and `packages/music-video-domain` have no `lint`
script, `packages/core` has no `lint` or `build` script, etc).

`orchestrator.merge.verify` runs `typecheck` and `lint` after each lane
merge (verification baseline fingerprinting is enabled, permissive mode).

## Git / Integration

- Remote: `git@github.com:jthomaskerr/openreel-video.git`, default branch
  `main`. **No branch protection configured on `main`.**
- Integration mode is `manual` — batches are never auto-pushed/merged to
  `main`; the operator runs `/orch-integrate` explicitly.
- Current working branch at setup time: `feature/copilot-chat-tool-layer`.

## Known Pre-Existing Issues (not caused by OrchID tasks)

- `infra/transcribe-gpu/main.py` has unresolved Python imports (`fastapi`,
  `faster_whisper`, `uvicorn`, `deep_translator`, etc.) — this is a
  pre-existing environment/dependency issue outside the pnpm workspace, not
  a regression from any task. Do not attribute new failures here to a lane's
  changes unless the diff actually touches `infra/transcribe-gpu/`.
- `@pi-agents/orchid@0.1.0-beta.2` ships `engine-worker.ts` but does not
  ship the compiled `engine-worker-entry.mjs` this supervisor created.
  If the file is missing after a package upgrade/reinstall, recreate it at
  `node_modules/@pi-agents/orchid/src/orchestrator/engine-worker-entry.mjs`
  with the jiti-to-.ts shim pattern (see the file for the template).
  Without it, every `/orch all` batch will crash with MODULE_NOT_FOUND.
