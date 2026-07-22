# Export handoff compatibility

This document is the release gate for OpenReel handoffs to DaVinci Resolve and iMovie. A target is advertised only after at least one exact application build has a passing row with reproducible artifact hashes and import evidence.

## Advertised support

No target-editor builds are currently advertised as supported.

- DaVinci Resolve: no passing exact-build row.
- iMovie: no passing exact-build row.

The application therefore keeps both `applicationVersions` lists empty. Candidate installation is not compatibility evidence.

## Verification environment

| Field | Value |
|---|---|
| Hardware | Apple Silicon (`arm64`), 16 GiB class verification target |
| Operating system | macOS 26.3 build 25D125 |
| Node.js | 26.5.0 |
| Contract | Resolve FCPXML 1.10; iMovie MOV/H.264/AAC 1.0 |
| Verification date | 2026-07-22 |

## Exact-build matrix

| Target | Exact version and build | OS | Fixture | Artifact SHA-256 | Import or playback | One-frame timing | Dimensions and orientation | Audio sync | Screenshot or recording | Verifier | Date | Result | Known limitations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DaVinci Resolve | 21.0.3 build 21.0.30007 | macOS 26.3 build 25D125, arm64 | `basic-multitrack` | Pending | Not run | Pending | Pending | Pending | Pending | Joseph/Codex environment | 2026-07-22 | UNVERIFIED | Installed build differs from the planned 20.3.2 build 20.3.20009 candidate. No support claim is made. |
| iMovie | Not installed | macOS 26.3 build 25D125, arm64 | horizontal, vertical, square, mixed-audio, selected-range MOVs | Pending | Not run | Pending | Pending | Pending | Pending | Joseph/Codex environment | 2026-07-22 | BLOCKED | Exact-build verification requires an installed iMovie candidate. No version family is inferred or advertised. |

## Automated contract evidence

- FCPXML 1.10 is DOM-built, round-trip parsed, reference checked, traversal checked, and golden compared.
- Rational frame conversion includes a 60-minute 29.97 fps zero-frame-drift gate.
- Resolve integration covers full and selected ranges, repeated structure and media-map equivalence, streamed unique media writes, and write ordering.
- iMovie integration covers immutable MOV/H.264/AAC settings, 48 kHz stereo audio, horizontal, vertical, square, and selected-range renders through the existing exporter.
- Compatibility reports validate against `specs/006-resolve-imovie-export/contracts/compatibility-report.schema.json` for completed, blocked, cancelled, and failed outcomes.

Automated contract evidence does not replace importing the artifacts into the exact target-editor build.

## Promotion procedure

1. Generate the maintained fixture artifacts with an unchanged target contract.
2. Record SHA-256 for every required artifact.
3. Import into the exact application build shown in the row.
4. Compare every clip boundary to one frame, timeline structure, dimensions, orientation, duration, picture, and audio synchronization.
5. Attach a screenshot or recording, verifier, and date.
6. Change the row to `PASS` only when every required comparison passes.
7. Add that exact version and build to the corresponding target profile. Never add a family label such as `21.x` or `10.x`.

Any FCPXML, MOV profile, media naming, range, or report-contract change invalidates prior rows until the fixtures are regenerated and reverified.
