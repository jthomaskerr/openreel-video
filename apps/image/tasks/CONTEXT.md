# Task Area: image

**Package:** `@openreel/image` (`apps/image`)
**Prefix:** IMG

## Scope

Browser-based photo/image editing application (companion to the video editor
in `apps/web`). Source areas: `src/filters`, `src/tools`, `src/types`,
`src/adjustments`, `src/utils`, `src/stores`, `src/components`, `src/hooks`,
`src/effects`, `src/services`.

## Dependencies

- `@openreel/image-core` — image processing engine
- `@openreel/ui` — shared UI components/design system

Do not introduce a reverse dependency (this package must not be imported by
`image-core` or `ui`).

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/image <script>`.
- Scripts: `dev` (vite), `build` (`tsc --noEmit && vite build`), `test`
  (vitest watch), `test:run` (vitest run), `lint` (eslint src),
  `typecheck` (`tsc --noEmit`).
- 100% client-side: no server-side processing of user images.
- Deploy target is Cloudflare Pages (`wrangler pages deploy --project-name=openreel-image`).

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/image typecheck
pnpm --filter @openreel/image lint
pnpm --filter @openreel/image test:run
```

## Reference Docs

- `docs/spec/`
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
