# Task Area: core

**Package:** `@openreel/core` (`packages/core`)
**Prefix:** COR

## Scope

The video/audio/photo processing engine shared by `apps/web` (and indirectly
`apps/image` via `image-core`). Source areas include `src/video`, `src/audio`,
`src/photo`, `src/timeline`, `src/export`, `src/effects`, `src/graphics`,
`src/text`, `src/playback`, `src/editing-templates`, `src/actions`,
`src/device`, `src/animation`, `src/storage`, `src/ai`, `src/media`,
`src/template`, `src/types`, `src/utils`, and `src/wasm` (AssemblyScript
modules: FFT, WAV, beat-detection).

## Dependencies

No internal `@openreel/*` dependencies — this is a foundational package.
Consumed by `apps/web` (and transitively others). Changes here have the
widest blast radius in the monorepo — be conservative and check downstream
usage (`apps/web`) before changing public exports (`src/index.ts`).

## Conventions

- pnpm workspace package — use `pnpm --filter @openreel/core <script>`.
- WASM modules under `src/wasm/*/build/*.wasm` are **generated** by
  `build:wasm:fft` / `build:wasm:wav` / `build:wasm:beat` (AssemblyScript,
  via `asc`). Do not hand-edit `.wasm` build output — edit the
  `assembly/index.ts` source and rebuild.
- Scripts: `test` (vitest watch), `test:run` (vitest run), `typecheck`
  (`tsc --noEmit`), `clean`, plus the `build:wasm*` scripts.
- No `lint` script defined for this package — do not assume one exists.

## Verification

Run before marking a task done:
```
pnpm --filter @openreel/core typecheck
pnpm --filter @openreel/core test:run
```
If WASM sources under `src/wasm/*/assembly/` were touched, also run the
relevant `build:wasm:*` script and confirm it succeeds.

## Reference Docs

- `docs/spec/` — especially `export.md`, `audio-analysis-subtitles.md`,
  `backend-persistence-versioning.md`, `thumbnails-fallbacks.md`
- `CONTRIBUTING.md`

---

_Items discovered during task execution are logged here by agents._
