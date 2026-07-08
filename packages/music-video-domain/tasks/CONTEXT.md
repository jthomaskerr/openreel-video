# Task Area: music-video-domain

**Package:** `@openreel/music-video-domain` (`packages/music-video-domain`)
**Prefix:** MVD

## Scope

Shared domain logic for music-video-specific workflows (e.g. beat-synced
timeline behavior, music-video project templates). Consumed by both
`apps/web` and `apps/orchestrator`.

## Dependencies

None internal — foundational package. Consumed by `apps/web` and
`apps/orchestrator`. Because it is shared by both a client app and a backend
service, avoid adding browser-only APIs (e.g. DOM/WebCodecs globals) to
shared exports unless guarded/optional — `apps/orchestrator` runs under
Node via `tsx`, not a browser.

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/music-video-domain <script>`.
- Scripts: `typecheck` (`tsc --noEmit`), `test` (vitest watch), `test:run`
  (vitest run).
- No `lint` or `build` script defined for this package.

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/music-video-domain typecheck
pnpm --filter @openreel/music-video-domain test:run
```

## Reference Docs

- `docs/spec/music-video-workflow.md`, `music-video-timeline-native` spec
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
