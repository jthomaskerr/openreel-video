# Task Area: web

**Package:** `@openreel/web` (`apps/web`)
**Prefix:** WEB

## Scope

The main OpenReel editor application — the browser-based UI where users edit
video, audio, and photo projects. Built with React + TypeScript + Vite, using
WebCodecs/WebGPU under the hood via `@openreel/core`.

Key source areas: `src/components` (editor UI, including `editor/timeline`),
`src/stores`, `src/bridges`, `src/services`, `src/hooks`, `src/pages`,
`src/features`, `src/config`, `src/utils`.

## Dependencies

- `@openreel/core` — video/audio/photo engine, WASM modules, export pipeline
- `@openreel/music-video-domain` — music-video specific domain logic
- `@openreel/ui` — shared UI components/design system

Do not introduce a reverse dependency (this package must not be imported by
`core`, `music-video-domain`, or `ui`).

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/web <script>` or run
  from this directory.
- Scripts: `dev` (vite), `build` (`tsc --noEmit && vite build`), `test`
  (vitest watch), `test:run` (vitest run, use this in CI/automation),
  `lint` (eslint src), `typecheck` (`tsc --noEmit`).
- 100% client-side: no server-side processing of user media. Do not add
  backend calls that upload user video/audio/photo content.
- Deploy target is Cloudflare Pages (`wrangler pages deploy`) — do not assume
  a Node server runtime in this app's own code.

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web lint
pnpm --filter @openreel/web test:run
```

## Reference Docs

- `docs/spec/` — operational specs (inspector shell, timeline, export,
  media import, storyboard, etc.)
- `CONTRIBUTING.md` — project structure and setup

---

_Items discovered during task execution are logged here by agents._
