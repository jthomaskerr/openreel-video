# macOS Task 5 report: Resolve live acceptance verifier

## Outcome

The deterministic acceptance verifier and its regression suite are ready. No live DaVinci Resolve evidence is claimed, and the exact-build compatibility row remains `UNVERIFIED`.

The verifier validates committed backend evidence for:

- Vintage Tokyo on DaVinci Resolve 21.0.3 build 21.0.30007;
- 38 clips across 4 tracks;
- an FCPXML duration of exactly 7,980 frames;
- zero offline media and unique referenced-media identifiers;
- a successful saved result with a consistent 40-character Git revision;
- SHA-256 metadata against the committed artifacts;
- repeat-run collision safety and an unchanged first-run baseline.

The current backend result contract does not expose a direct Resolve project save timestamp. That check remains `pending-live-observation` and must be recorded manually or added to the backend contract before it can be verified automatically.

## Deterministic evidence

The regression suite was first run before the verifier existed and failed because `live-acceptance.py` was absent. After implementation, the verifier suite passes 5 tests and the existing Resolve importer suite passes 9 tests.

## Live commands

After OpenReel has produced committed backend result evidence for the first live import:

```bash
OPENREEL_PROJECT_DIR="/absolute/path/to/vintage-tokyo" \
rtk /usr/bin/python3 apps/resolve-bridge/scripts/live-acceptance.py \
  --latest \
  --output /tmp/openreel-resolve-acceptance/result.json
```

Expected first-run result:

```text
PASS: pending-second-run
```

Repeat the OpenReel export/import into a second collision-safe Resolve project, then run the same command again. Expected result:

```text
PASS: pass
```

Inspect the sanitized report:

```bash
rtk json /tmp/openreel-resolve-acceptance/result.json
```

Do not mark live acceptance complete until both runs and the direct save observation have real evidence.
