# Task Area: orchestrator

**Package:** `@openreel/orchestrator` (`apps/orchestrator`)
**Prefix:** ORC

## Scope

Backend/server-side orchestration service. Entry point `src/app.ts`; source
areas include `src/projects` and `src/routes`. Runs via `tsx` (dev: `tsx watch
src/index.ts`, start: `tsx src/index.ts`).

## Dependencies

- `@openreel/music-video-domain` — shared music-video domain logic

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/orchestrator <script>`.
- No `build` script defined yet — this package runs directly via `tsx`
  (no compiled `dist` step beyond `clean`). Confirm before assuming a build
  step exists.
- Scripts: `dev`, `start`, `typecheck`, `clean`.
- This is a Node-side service, distinct from the client-only `apps/web` and
  `apps/image` — server-side logic is expected here (unlike the browser apps).

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/orchestrator typecheck
```

## Reference Docs

- `docs/spec/` — operational specs
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
