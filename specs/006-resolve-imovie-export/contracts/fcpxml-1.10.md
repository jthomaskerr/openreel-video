# FCPXML 1.10 Mapping Contract

**Contract ID**: `fcpxml-1.10`
**Target**: DaVinci Resolve
**Purpose**: Deterministic rough-cut timeline handoff with collected media.

## Document Shape

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <!-- format and asset resources -->
  </resources>
  <library>
    <event name="...">
      <project name="...">
        <sequence format="..." duration="..." tcStart="0s" tcFormat="NDF">
          <spine>
            <!-- projected clips -->
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```

Required ordering:

1. XML declaration;
2. FCPXML doctype;
3. `resources`;
4. `library/event/project/sequence/spine`.

Resource IDs and element order are deterministic.

## Names and IDs

| Value | Rule |
|-------|------|
| Format ID | `r1` |
| Asset IDs | `r2`, `r3`, ... in media-ID sort order |
| Event name | Sanitized project name |
| Project name | Sanitized project name |
| Clip name | Source clip label, XML-escaped by the serializer |
| Asset name | Immutable media source name |

Native destination paths, file handles, URLs with credentials, and signed query parameters never appear.

## Format Resource

```xml
<format
  id="r1"
  name="OpenReel <width>x<height> <rate>"
  frameDuration="<rational-seconds>"
  width="<width>"
  height="<height>"/>
```

Rules:

- Width and height are positive project settings.
- `frameDuration` is the reciprocal of the canonical project timebase.
- No color-space claim is emitted until OpenReel has a persisted color-space contract.
- Drop-frame timecode is not emitted because the project model has no drop-frame/timecode-start setting. `tcFormat="NDF"` and `tcStart="0s"`.

## Asset Resource

```xml
<asset
  id="rN"
  name="<source-name>"
  src="Media/<percent-encoded-output-name>"
  start="0s"
  duration="<known-source-duration>"
  hasVideo="1"
  hasAudio="1"/>
```

Rules:

- `src` is relative to the FCPXML document and cannot escape `Media/`.
- Filename path segments are percent-encoded after sanitization.
- `hasVideo` and `hasAudio` reflect validated media metadata.
- Omit `duration` only when the source is a still image or duration is genuinely unavailable and Resolve fixture validation passes.
- One asset resource exists per required media ID, not per clip.

## Timeline Mapping

### Range Origin

- The exported sequence starts at frame zero.
- A full export uses project time zero as its origin.
- A range export subtracts the selected start frame from every included clip boundary.
- Clips intersecting a range boundary are trimmed to the intersection.
- Source start advances by the same number of trimmed timeline frames for normal-speed media.

### Track and Lane Mapping

- Preserve source track order in the handoff plan.
- The first included visible video track forms the primary spine lane.
- Additional visible video tracks map to positive connected-clip lanes using a stable lane number derived from track order.
- Audible audio-only tracks map to negative lanes using stable lane numbers derived from track order.
- Hidden video tracks and muted audio tracks are excluded.
- Empty tracks are represented in the compatibility report but do not create empty XML elements.

The exact lane mapping must pass the maintained Resolve multitrack fixture before the target version is marked supported.

### Video Clip

```xml
<asset-clip
  name="<clip-name>"
  ref="rN"
  offset="<timeline-start>"
  start="<source-start>"
  duration="<timeline-duration>"
  lane="<lane>"/>
```

### Audio Clip

Use `asset-clip` with the same timing rules and an audio lane. The initial contract does not emit destination-specific audio roles.

### Still Image

Use `asset-clip` referencing an image asset. Timeline duration comes from the projected clip; source start is `0s`.

### Gaps

Primary-spine gaps are explicit when required to preserve the following clip offset. Connected-lane gaps are represented by offsets and do not receive separate media resources.

## Time Representation

### Canonical Rates

| Project rate | Canonical FPS | Frame duration |
|--------------|---------------|----------------|
| 23.976 | `24000/1001` | `1001/24000s` |
| 29.97 | `30000/1001` | `1001/30000s` |
| 59.94 | `60000/1001` | `1001/60000s` |
| Positive integer `N` | `N/1` | `1/Ns` |

### Boundary Conversion

```text
startFrame = round(startSeconds × fpsNumerator / fpsDenominator)
endFrame   = round(endSeconds × fpsNumerator / fpsDenominator)
duration   = endFrame - startFrame
```

FCPXML time for `frameCount`:

```text
(frameCount × fpsDenominator) / fpsNumerator seconds
```

Reduce the fraction by greatest common divisor. Serialize zero exactly as `0s`.

Rules:

- Every nonzero projected clip has a positive frame duration.
- An intersection that collapses to zero frames is blocking.
- Adjacent source boundaries converted from the same project time must share the same frame index.
- Safe-integer overflow is blocking.

## Representability Matrix

### Supported in Initial Contract

- Multiple video and audio tracks through lane mapping;
- video, audio, and still-image media clips;
- clip order, gaps, start, end, source in-point, and source duration;
- normal-speed playback;
- full timeline and selected-range projection;
- hidden-video and muted-audio exclusion;
- duplicate uses of one source asset;
- Unicode names through standards-based XML escaping;
- deterministic collision-safe collected-media names.

### Blocking

- Missing or inaccessible required media;
- invalid or unsupported frame rate;
- source range outside known media duration;
- a positive segment collapsed to zero destination frames;
- non-unit speed, reverse, freeze-frame, or variable retime;
- transforms, crop, opacity changes, blend modes, stabilization, or keyframes that change the picture;
- video/audio effects or automation that change picture or sound;
- transitions;
- text, subtitles, graphics, shapes, stickers, or generated compound semantics;
- nested/compound sequences;
- any property not classified by the versioned matrix when it can affect picture, sound, or timing.

### Informational Only

- Track locked state;
- markers not emitted by the initial contract;
- editor-only labels or metadata that do not affect picture, sound, or timing.

Informational omissions must appear in `compatibility-report.md`.

## Validation Contract

Every generated document must pass:

1. standards-based XML parse round trip;
2. root name and version assertion;
3. unique resource ID assertion;
4. every `ref` resolves to one resource;
5. every media URL is relative and contained by `Media/`;
6. all time values parse as non-negative rational seconds;
7. every clip duration is positive;
8. deterministic golden-fixture comparison after normalizing only the XML declaration's insignificant formatting;
9. import into every Resolve version marked supported in `docs/export-compatibility.md`;
10. one-frame timing and zero-drift fixture comparison.

## Compatibility Change Policy

Any change to these items requires a new contract or matrix version and fresh Resolve evidence:

- FCPXML `version`;
- lane mapping;
- timebase canonicalization or rounding;
- resource ID/media naming;
- supported/blocked feature classification;
- relative media URL form;
- emitted element or attribute set.
