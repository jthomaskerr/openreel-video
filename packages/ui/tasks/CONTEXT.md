# Task Area: ui

**Package:** `@openreel/ui` (`packages/ui`)
**Prefix:** UI

## Scope

Shared UI component library / design system used by `apps/web` and
`apps/image`. Source areas: `src/components`, `src/lib`, `src/styles`.

## Dependencies

None internal — foundational package. Consumed by `apps/web` and
`apps/image`. Changes here can affect both apps simultaneously — check both
consumers before changing a shared component's public props/API.

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/ui <script>`.
- Only a `typecheck` script (`tsc --noEmit`) is defined for this package —
  no `test`, `lint`, or `build` script. Do not assume these exist.
- Keep components presentational/reusable — avoid coupling to
  `apps/web`-specific or `apps/image`-specific state/stores.

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/ui typecheck
```

## Reference Docs

- `docs/spec/`
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
