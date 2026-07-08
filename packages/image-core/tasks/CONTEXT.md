# Task Area: image-core

**Package:** `@openreel/image-core` (`packages/image-core`)
**Prefix:** ICR

## Scope

Image processing engine shared by `apps/image`. Foundational package —
no internal `@openreel/*` dependencies.

## Dependencies

None internal. Consumed by `apps/image`. Changes here affect the image
editor's processing pipeline — check `apps/image` usage before changing
public exports (`src/index.ts`).

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/image-core <script>`.
- Scripts: `test` (vitest watch), `test:run` (vitest run), `typecheck`
  (`tsc --noEmit`).
- No `lint` or `build` script defined for this package — do not assume one
  exists.

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/image-core typecheck
pnpm --filter @openreel/image-core test:run
```

## Reference Docs

- `docs/spec/`
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
