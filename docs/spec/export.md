# §18 Export — Operational Spec

> **Status:** Operational — derived from user directives and implementation plans.
> **Sources:**
> - `docs/spec/OPERATIONAL-SPEC-UPDATE-SUMMARY.md` §18
> - `docs/superpowers/plans/spec-update/openreel-spec-implications-report.json` (Export / Rendering category, 48 messages)
> - `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md` Task 6 (export subtitle rendering)
> - `packages/core/src/export/types.ts` — authoritative type definitions
> - `packages/core/src/export/export-engine.ts` — current export implementation
> - `packages/core/src/video/upscaling/upscaling-engine.ts` — WebGPU upscaling
> - `README.md` — feature list (Export section)

---

## 1. Scope

This spec defines the normative requirements for exporting rendered output from an OpenReel project. It covers:

- Video export formats, codecs, and container types
- Audio-only export formats
- Image sequence export
- Quality presets and custom settings
- Hardware-accelerated encoding via WebCodecs
- AI upscaling via WebGPU shaders
- Progress tracking and cancellation
- Subtitle rendering during export
- Error handling and recovery

---

## 2. Export Engine Architecture

### 2.1 Engine Singleton

The `ExportEngine` class (`packages/core/src/export/export-engine.ts`) SHALL be the single, authoritative export subsystem. It MUST be accessed via `getExportEngine()` which returns a singleton instance.

The engine MUST be initialized via `initialize()` before any export operation. Initialization SHALL:

1. Dynamically import the `mediabunny` library for muxing and encoding.
2. Initialize the `VideoEngine` and `AudioEngine` singletons.
3. Set the `initialized` flag to `true`.

Initialization failure SHALL throw an `Error` with a descriptive message.

### 2.2 GPU Initialization for Export

Before a video export begins, the engine MUST call `initializeGPUForExport(width, height)` which:

1. Initializes the `VideoEngine`'s GPU compositor at the target resolution.
2. Creates and initializes the `UpscalingEngine` with the GPU device, if available.
3. Returns `true` on success, `false` if GPU compositing is unavailable.

### 2.3 Capability Detection

The engine MUST expose capability checks:

- `isMediaBunnyAvailable()` — returns `true` when the `mediabunny` library loaded successfully.
- `isWebCodecsSupported()` — returns `true` when both `VideoEncoder` and `AudioEncoder` globals are defined.
- `isInitialized()` — returns `true` when the engine has completed initialization.

### 2.4 Disposal

`dispose()` SHALL cancel any in-progress export, terminate the export worker, release engine references, and reset `initialized` to `false`.

---

## 3. Video Export

### 3.1 Export Method

Video export SHALL be performed via the async generator method:

```typescript
async *exportVideo(
  project: Project,
  settings?: Partial<VideoExportSettings>,
  writableStream?: FileSystemWritableFileStream,
): AsyncGenerator<ExportProgress, ExportResult>
```

The method yields `ExportProgress` updates throughout the export lifecycle and returns an `ExportResult` on completion.

### 3.2 Export Formats

The system MUST support the following container formats and codec combinations:

| Container | Codec | MIME Type | Notes |
|---|---|---|---|
| MP4 | H.264 (AVC) | `video/mp4` | Universal compatibility; default format |
| MP4 | H.265 (HEVC) | `video/mp4` | Higher compression efficiency; memory-intensive |
| WebM | VP8 | `video/webm` | Legacy web format |
| WebM | VP9 | `video/webm` | Modern web format; memory-intensive |
| WebM | AV1 | `video/webm` | Next-gen codec; memory-intensive |
| MOV | ProRes Proxy | `video/quicktime` | Professional intermediate; lowest ProRes tier |
| MOV | ProRes LT | `video/quicktime` | Professional intermediate |
| MOV | ProRes Standard | `video/quicktime` | Professional intermediate |
| MOV | ProRes HQ | `video/quicktime` | Professional intermediate |
| MOV | ProRes 4444 | `video/quicktime` | Professional intermediate; alpha channel |
| MOV | ProRes 4444 XQ | `video/quicktime` | Professional intermediate; highest ProRes tier |

The `VideoExportSettings.format` field SHALL accept `"mp4"`, `"webm"`, or `"mov"`. The `codec` field SHALL accept `"h264"`, `"h265"`, `"vp8"`, `"vp9"`, `"av1"`, or `"prores"`.

### 3.3 ProRes Fallback

ProRes encoding via WebCodecs is not universally supported in browsers. When `codec` is `"prores"` and the browser does not support ProRes encoding, the engine SHALL fall back to H.264 in an MP4 container with a bitrate of 25,000 kbps and quality 95. This fallback MUST be transparent to the caller — the `ExportResult` reflects the actual output.

### 3.4 ProRes Bitrate Table

ProRes bitrates SHALL be determined by profile and resolution per the `PRORES_BITRATES` constant:

| Profile | 1080p (kbps) | 4K (kbps) |
|---|---|---|
| Proxy | 45,000 | 180,000 |
| LT | 100,000 | 400,000 |
| Standard | 150,000 | 600,000 |
| HQ | 220,000 | 880,000 |
| 4444 | 330,000 | 1,320,000 |
| 4444 XQ | 500,000 | 2,000,000 |

### 3.5 Memory-Intensive Codec Guardrails

Codecs classified as memory-intensive (`vp9`, `av1`, `h265`) SHALL be subject to resolution and frame rate limits:

- Maximum resolution: 1920×1080.
- For timelines longer than 120 seconds, the maximum resolution SHALL be further capped at 1920×1080 and frame rate at 30 fps.
- If the requested settings exceed these limits, the engine SHALL scale down to the nearest even dimensions while preserving aspect ratio.

### 3.6 Audio in Video Export

Video export SHALL include an audio track encoded per the `VideoExportSettings.audioSettings` field. The audio codec SHALL be selected via `findSupportedAudioCodec()` which:

1. Inspects the output format's supported audio codecs.
2. Attempts the requested bitrate, then falls back through `[192000, 128000, 96000]`.
3. Falls back through codec preference: AAC → MP3 → Opus.
4. Returns the first encodable codec + bitrate combination.
5. Defaults to AAC at 128 kbps if no supported codec is found.

### 3.7 Frame Rendering Pipeline

For each frame in the export, the engine SHALL:

1. Check the `AbortController` signal; throw `CANCELLED` if aborted.
2. Compute the frame time: `time = frame / frameRate`.
3. Call `VideoEngine.renderFrame(project, time, width, height)` to produce a rendered `ImageBitmap`.
4. If upscaling is enabled and applicable (see §7), upscale the frame via `UpscalingEngine.upscaleImageBitmap()`.
5. Create a `VideoSample` from the frame image with the correct timestamp and duration.
6. Add the sample to the `VideoSampleSource`.
7. Close the sample and frame image to release GPU memory.
8. Every 5 frames, clear caches (`VideoElement` cache, `VideoEngine` cache, `MediaEngine` frame cache) and yield a 2 ms microtask to prevent blocking.

### 3.8 Muxing

After all frames are encoded:

1. The `VideoSampleSource` SHALL be closed.
2. All export decoders SHALL be disposed.
3. Caches SHALL be cleared.
4. `exportMode` on the `VideoEngine` SHALL be set to `false`.
5. `output.finalize()` SHALL be called to complete muxing.
6. The writable stream SHALL be closed.

### 3.9 Empty Timeline

If the calculated timeline duration is ≤ 0, the engine SHALL return an `ExportResult` with `success: false` and an error with code `"MUXER_ERROR"` and message `"Timeline is empty. Add clips before exporting."`.

### 3.10 Missing Writable Stream

If no `writableStream` is provided, the engine SHALL return an `ExportResult` with `success: false` and an error with code `"MUXER_ERROR"` and message `"No writable stream provided. Export requires a file destination."`.

---

## 4. Audio-Only Export

### 4.1 Export Method

Audio-only export SHALL be performed via the async generator method:

```typescript
async *exportAudio(
  project: Project,
  settings?: Partial<AudioExportSettings>,
): AsyncGenerator<ExportProgress, ExportResult>
```

### 4.2 Supported Formats

The system MUST support the following audio export formats:

| Format | Extension | Typical Bitrate | Notes |
|---|---|---|---|
| MP3 | `.mp3` | 128–320 kbps | Universal compatibility |
| WAV | `.wav` | Uncompressed | Lossless; large files |
| AAC | `.aac` / `.m4a` | 128–256 kbps | Modern compressed format |
| FLAC | `.flac` | Lossless | Compressed lossless |
| OGG (Vorbis) | `.ogg` | 128–320 kbps | Open format |

The `AudioExportSettings.format` field SHALL accept `"mp3"`, `"wav"`, `"aac"`, `"flac"`, or `"ogg"`.

### 4.3 Audio Settings

Audio export settings SHALL include:

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"mp3" \| "wav" \| "aac" \| "flac" \| "ogg"` | `"mp3"` | Output format |
| `sampleRate` | `44100 \| 48000 \| 96000` | `48000` | Sample rate in Hz |
| `bitDepth` | `16 \| 24 \| 32` | `16` | Bit depth |
| `bitrate` | `number` | `320` | Bitrate in kbps |
| `channels` | `1 \| 2` | `2` | Mono or stereo |

### 4.4 Audio Rendering

The engine SHALL render the full timeline audio mix via `renderTimelineAudio()` which:

1. Computes the timeline duration from all tracks and clips.
2. Renders audio in chunks of 15 seconds (`AUDIO_EXPORT_CHUNK_DURATION_SECONDS`).
3. Checks the abort signal before each chunk.
4. Encodes the rendered audio buffer to the target format via MediaBunny.

### 4.5 WAV Encoding Fallback

When MediaBunny is unavailable, the engine SHALL fall back to the WASM-based WAV encoder (`getWavEncoder`) for WAV format exports.

---

## 5. Image Export

### 5.1 Single Frame Export

```typescript
async exportFrame(
  project: Project,
  time: number,
  settings?: Partial<ImageExportSettings>,
): Promise<ImageBitmap | null>
```

`exportFrame` SHALL render a single frame at the given time and return it as an `ImageBitmap`. It MUST NOT encode or mux the frame — it returns the raw rendered bitmap for caller use.

### 5.2 Still Image Export

```typescript
async exportImage(
  project: Project,
  settings?: Partial<ImageExportSettings>,
): Promise<ExportResult>
```

`exportImage` SHALL render the current playhead frame and encode it to the requested image format, returning an `ExportResult` with a `Blob`.

### 5.3 Supported Image Formats

| Format | Extension | Quality Range | Notes |
|---|---|---|---|
| JPEG | `.jpg` | 1–100 | Lossy; default quality 90 |
| PNG | `.png` | N/A | Lossless; ignores quality setting |
| WebP | `.webp` | 1–100 | Modern format; lossy or lossless |

The `ImageExportSettings.format` field SHALL accept `"jpg"`, `"png"`, or `"webp"`.

### 5.4 Image Settings

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"jpg" \| "png" \| "webp"` | `"jpg"` | Output format |
| `quality` | `number` | `90` | Compression quality (1–100) |
| `width` | `number` | `1920` | Output width in pixels |
| `height` | `number` | `1080` | Output height in pixels |

---

## 6. Image Sequence Export

### 6.1 Sequence Export

```typescript
async *exportSequence?(
  project: Project,
  settings: SequenceExportSettings,
): AsyncGenerator<ExportProgress, ExportResult>
```

> **TODO:** The `exportSequence` method is not yet implemented in the current `ExportEngine`. The `SequenceExportSettings` type is defined but the method is absent. Implementation MUST follow the same async-generator pattern as `exportVideo`.

### 6.2 Sequence Settings

`SequenceExportSettings` extends `ImageExportSettings` with:

| Field | Type | Description |
|---|---|---|
| `startFrame` | `number` | First frame to export (inclusive) |
| `endFrame` | `number` | Last frame to export (inclusive) |
| `namingPattern` | `string` | File naming pattern (e.g., `"frame_%04d"`) |

### 6.3 Sequence Behavior

The engine SHALL:

1. Render each frame from `startFrame` to `endFrame` inclusive.
2. Encode each frame to the requested image format.
3. Name each file according to `namingPattern` with the frame number substituted.
4. Yield progress updates after each frame.
5. Support cancellation via `AbortController`.
6. Return an `ExportResult` with a `Blob` containing a ZIP archive of all frames, or individual `Blob` references.

> **TODO:** Define whether the result is a single ZIP `Blob` or an array of per-frame `Blob` objects. The current `ExportResult` type only carries a single `blob?: Blob`.

---

## 7. Quality Presets

### 7.1 Preset Definitions

The system MUST provide the following built-in quality presets via `VIDEO_QUALITY_PRESETS`:

| Preset ID | Resolution | Bitrate (kbps) | Frame Rate | Quality |
|---|---|---|---|---|
| `4k-high` | 3840×2160 | 80,000 | 30 | 95 |
| `4k` | 3840×2160 | 50,000 | 30 | 90 |
| `4k-60` | 3840×2160 | 65,000 | 60 | 90 |
| `1080p-high` | 1920×1080 | 25,000 | 30 | 95 |
| `1080p` | 1920×1080 | 15,000 | 30 | 85 |
| `1080p-60` | 1920×1080 | 24,000 | 60 | 90 |
| `720p` | 1280×720 | 8,000 | 30 | 80 |
| `480p` | 854×480 | 4,000 | 30 | 75 |

### 7.2 Preset Selection

The UI SHALL expose these presets as selectable options in the export dialog. Selecting a preset SHALL populate the corresponding `VideoExportSettings` fields. The user MAY override any preset field with custom values.

### 7.3 Custom Presets

The `ExportPreset` interface supports user-defined presets:

```typescript
interface ExportPreset {
  id: string;
  name: string;
  description: string;
  settings: VideoExportSettings | AudioExportSettings | ImageExportSettings;
  category: "social" | "broadcast" | "web" | "archive" | "custom";
}
```

Custom presets SHALL be persisted in user settings and available across sessions.

---

## 8. Custom Settings

### 8.1 Video Custom Settings

Beyond presets, the user SHALL be able to configure:

| Setting | Type | Range | Description |
|---|---|---|---|
| `bitrate` | `number` | 1–300,000 kbps | Target video bitrate |
| `bitrateMode` | `"cbr" \| "vbr"` | — | Constant or variable bitrate |
| `frameRate` | `number` | 1–120 fps | Output frame rate |
| `codec` | `string` | See §3.2 | Video codec |
| `colorDepth` | `8 \| 10 \| 12` | — | Bits per color channel |
| `pixelFormat` | `"yuv420" \| "yuv422" \| "yuv444" \| "rgb"` | — | Chroma subsampling / pixel format |
| `keyframeInterval` | `number` | ≥ 1 frame | GOP size in frames |
| `quality` | `number` | 1–100 | Encoder quality level |

### 8.2 Color Depth and Pixel Format

- `colorDepth` SHALL default to `8` when unspecified.
- `pixelFormat` SHALL default to `"yuv420"` for H.264/H.265/VP8/VP9, `"yuv422"` for ProRes Standard/HQ, and `"yuv444"` for ProRes 4444.
- The engine MUST validate that the requested `colorDepth` and `pixelFormat` are supported by the selected codec. Unsupported combinations SHALL produce an `ExportError` with code `"INVALID_SETTINGS"`.

### 8.3 Default Video Settings

When no settings are provided, the engine SHALL use `DEFAULT_VIDEO_SETTINGS`:

- Format: `"mp4"`, Codec: `"h264"`
- Resolution: 1920×1080, Frame rate: 30 fps
- Bitrate: 5,000 kbps (CBR), Quality: 80
- Keyframe interval: 60 frames (2 seconds at 30 fps)
- Audio: AAC, 48 kHz, 16-bit, 192 kbps, stereo

---

## 9. Hardware Encoding via WebCodecs

### 9.1 WebCodecs Integration

The export engine SHALL use the WebCodecs API (`VideoEncoder`, `AudioEncoder`) for hardware-accelerated encoding when available. The `mediabunny` library SHALL be the primary encoding backend, wrapping WebCodecs with a higher-level API.

### 9.2 Codec Selection

Video codec selection SHALL use `getFirstEncodableVideoCodec()` from MediaBunny, which:

1. Inspects the output format's supported video codecs.
2. Returns the first codec that can encode at the requested resolution.
3. Throws `UNSUPPORTED_CODEC` if no supported codec is found.

### 9.3 Hardware Acceleration Preference

The `VideoSampleSource` SHALL be configured with `hardwareAcceleration: "prefer-software"` to prioritize stability over raw speed. This MAY be made configurable in a future release.

> **TODO:** Expose `hardwareAcceleration` as a user-configurable setting (`"prefer-hardware"`, `"prefer-software"`, `"no-preference"`).

### 9.4 Audio Codec Negotiation

Audio codec selection SHALL use `findSupportedAudioCodec()` which:

1. Gets the output format's supported audio codecs.
2. Attempts the requested bitrate with the first encodable codec.
3. Falls back through decreasing bitrates: `[requested, 192000, 128000, 96000]`.
4. Falls back through codec preference: AAC → MP3 → Opus.
5. Validates each candidate via `AudioEncoder.isConfigSupported()`.
6. Returns the first valid codec + bitrate pair, or defaults to AAC at 128 kbps.

### 9.5 WebCodecs Availability

When WebCodecs is not available (`isWebCodecsSupported()` returns `false`), the engine SHALL fall back to software encoding via MediaBunny's built-in encoders. The export MUST still succeed, albeit slower.

---

## 10. AI Upscaling via WebGPU Shaders

### 10.1 Upscaling Engine

The `UpscalingEngine` (`packages/core/src/video/upscaling/upscaling-engine.ts`) SHALL provide AI-enhanced resolution upscaling using WebGPU compute shaders. It MUST be initialized with a `GPUDevice` before use.

### 10.2 Upscaling Settings

```typescript
interface UpscalingSettings {
  enabled: boolean;       // default: false
  quality: UpscaleQuality; // "fast" | "balanced" | "quality"
  sharpening: number;     // 0.0–1.0, default: 0.3
}
```

### 10.3 Quality Modes

| Mode | Shader Pipeline | Performance | Quality |
|---|---|---|---|
| `fast` | Lanczos resize only | Fastest | Good |
| `balanced` | Lanczos + edge-directed interpolation | Moderate | Better |
| `quality` | Lanczos + edge detection + edge-directed interpolation + sharpening | Slowest | Best |

### 10.4 Upscaling Trigger

Upscaling SHALL be applied during video export when ALL of the following are true:

1. `settings.upscaling.enabled` is `true`.
2. The `UpscalingEngine` is initialized.
3. The target resolution exceeds the source resolution in either dimension (`targetWidth > sourceWidth || targetHeight > sourceHeight`).

When upscaling is not applicable (e.g., exporting at or below source resolution), the frame SHALL be used as-is without upscaling.

### 10.5 Upscaling Pipeline

For each frame where upscaling applies:

1. The rendered `ImageBitmap` is passed to `UpscalingEngine.upscaleImageBitmap(image, targetWidth, targetHeight, settings)`.
2. The original `ImageBitmap` is closed after upscaling to release GPU memory.
3. The upscaled `ImageBitmap` replaces the original in the encoding pipeline.

### 10.6 Texture Pool

The `UpscalingEngine` SHALL maintain a texture pool (`MAX_POOL_SIZE = 4`) to reduce GPU allocation overhead during batch processing. The pool SHALL be cleared on `dispose()`.

### 10.7 Shader Programs

The upscaling engine SHALL use the following WebGPU compute shaders:

- **Lanczos resize** — high-quality spatial resampling with reduced ringing artifacts.
- **Edge detection** — Sobel-based edge map computation for guided interpolation.
- **Edge-directed interpolation** — directionally-aware upscaling that preserves edge sharpness.
- **Sharpening** — unsharp mask post-processing with configurable strength.

---

## 11. Progress Tracking

### 11.1 Progress Interface

Export progress SHALL be reported via the `ExportProgress` interface:

```typescript
interface ExportProgress {
  readonly phase: "preparing" | "rendering" | "encoding" | "muxing" | "complete";
  readonly progress: number;          // 0.0–1.0
  readonly estimatedTimeRemaining: number; // seconds
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly bytesWritten: number;
  readonly currentBitrate: number;
}
```

### 11.2 Phase Lifecycle

| Phase | Progress Range | Description |
|---|---|---|
| `preparing` | 0.00–0.05 | Initializing GPU, codecs, output format, and streams |
| `rendering` | 0.05–0.90 | Frame-by-frame rendering and encoding |
| `encoding` | 0.90–0.95 | Final audio encoding pass |
| `muxing` | 0.95–0.99 | Container finalization and stream close |
| `complete` | 1.00 | Export finished successfully |

### 11.3 Progress Yield Frequency

- During `rendering`, progress SHALL be yielded after every frame.
- During `muxing`, a single progress update at 0.98 SHALL be yielded.
- The `estimatedTimeRemaining` field SHALL be computed from elapsed time, frames rendered, and total frames remaining.

### 11.4 Async Generator Pattern

Both `exportVideo` and `exportAudio` are async generators. The caller SHALL iterate over yielded `ExportProgress` values to update UI. The final `return` value is the `ExportResult`.

---

## 12. Cancellation

### 12.1 Abort Mechanism

The engine SHALL use an `AbortController` (`this.abortController`) to support cancellation. A new `AbortController` SHALL be created at the start of each export operation.

### 12.2 Cancel Method

```typescript
cancel(): void
```

Calling `cancel()` SHALL call `this.abortController.abort()`. This is a no-op if no export is in progress.

### 12.3 Cancel Checkpoints

The abort signal SHALL be checked at the following points:

1. **Before each frame** in the rendering loop — throws `CANCELLED` if aborted.
2. **Before each audio chunk** in audio encoding — throws `CANCELLED` if aborted.
3. **On error catch** — the writable stream SHALL be aborted via `writableStream.abort()`.

### 12.4 Cancel Result

When cancelled, the engine SHALL return an `ExportResult` with:

- `success: false`
- `error.code: "CANCELLED"`
- `error.message: "Export cancelled by user"`
- `error.phase`: the phase during which cancellation occurred
- `error.recoverable: false`

### 12.5 Cleanup on Cancel

After cancellation (or any error), the engine SHALL:

1. Set `this.abortController` to `null`.
2. Set `this.currentExport` to `null`.
3. Clear the `AudioEngine` cache.
4. Clear the `VideoEngine` caches.
5. Dispose all export decoders.
6. Set `VideoEngine.exportMode` to `false`.

---

## 13. Subtitle Rendering During Export

### 13.1 Subtitle Source

The export engine MUST read subtitle data from subtitle track clips, NOT from a flat `timeline.subtitles` array.

> **Source:** `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md` Task 6. The current implementation (`export-engine.ts:1395–1400`) reads from `timeline.subtitles` — this is a known workaround that MUST be migrated to track-based clips.

### 13.2 Duration Calculation

When computing the timeline duration for export, the engine SHALL include subtitle track clips:

```typescript
for (const track of timeline.tracks) {
  if (track.type === "subtitle") {
    for (const clip of track.clips) {
      const end = clip.startTime + clip.duration;
      if (end > maxEndTime) maxEndTime = end;
    }
  }
}
```

This replaces the current `timeline.subtitles` iteration.

### 13.3 Frame Rendering with Subtitles

Subtitles SHALL be rendered onto each exported frame via the same canvas rendering pipeline used for preview. The engine SHALL:

1. Extract active subtitle clips for the current frame time from subtitle tracks.
2. Pass them to `renderSubtitleToCanvas()` (or equivalent) during frame composition.
3. Support all caption animation styles: `none`, `word-highlight`, `word-by-word`, `karaoke`, `bounce`, `typewriter`.

### 13.4 Subtitle Clip Data

Each subtitle clip on a subtitle track SHALL carry:

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Caption text (may contain `\n` for multi-line) |
| `style` | `SubtitleStyle` | Font, size, color, background, outline, shadow |
| `words` | `SubtitleWord[]` (optional) | Per-word timing for animated captions |
| `animationStyle` | `CaptionAnimationStyle` (optional) | Animation style for this caption |

The export engine MUST NOT depend on the deprecated `Timeline.subtitles` flat array. All subtitle data SHALL be sourced from clips on `"subtitle"`-type tracks.

---

## 14. Error Handling

### 14.1 Error Codes

The engine SHALL use the following error codes:

| Code | Description | Recoverable |
|---|---|---|
| `ENCODER_INIT_FAILED` | Video or audio encoder could not be initialized | `false` |
| `FRAME_ENCODE_FAILED` | A single frame failed to encode | `true` |
| `AUDIO_ENCODE_FAILED` | Audio encoding failed | `false` |
| `MUXER_ERROR` | Container muxing failed (empty timeline, no stream, finalization error) | `false` |
| `DISK_FULL` | Storage quota exceeded | `false` |
| `CANCELLED` | User cancelled the export | `false` |
| `TIMEOUT` | Export exceeded time limit | `false` |
| `MEMORY_EXCEEDED` | Memory limit exceeded | `false` |
| `UNSUPPORTED_CODEC` | Requested codec is not supported by the browser | `false` |
| `INVALID_SETTINGS` | Requested settings are invalid or incompatible | `false` |

### 14.2 Error Interface

```typescript
interface ExportError {
  code: ExportErrorCode;
  message: string;
  phase: ExportProgress["phase"];
  frameNumber?: number;
  recoverable: boolean;
}
```

### 14.3 Error Recovery

- `FRAME_ENCODE_FAILED` is marked `recoverable: true`. The engine SHOULD skip the failed frame and continue with the next frame, logging the failure.
- All other errors are non-recoverable. The export SHALL be terminated and the writable stream aborted.
- On any error, the engine SHALL perform the cleanup steps described in §12.5.

### 14.4 Result Shape

```typescript
interface ExportResult {
  success: boolean;
  blob?: Blob;
  error?: ExportError;
  stats?: ExportStats;
}

interface ExportStats {
  duration: number;        // total export time in ms
  framesRendered: number;  // total frames processed
  averageSpeed: number;    // frames per second
  fileSize: number;        // output size in bytes
  averageBitrate: number;  // average bitrate in bps
}
```

---

## 15. Export Worker

### 15.1 Worker Purpose

The `export-worker.ts` module provides a Web Worker interface for off-main-thread encoding. It SHALL:

1. Accept `initialize` messages with `VideoExportSettings` and project name.
2. Accept `addFrame` messages with `ImageBitmap` frames (transferred, not copied).
3. Accept `addAudio` messages with audio `Float32Array` data.
4. Accept `finalize` messages to complete muxing.
5. Accept `cancel` messages to abort encoding.
6. Post progress and completion messages back to the main thread.

### 15.2 Frame Queue

The worker SHALL maintain an internal frame queue with async processing. Frames are queued via `queueFrame()` and processed sequentially via `processFrameQueue()`. This ensures encoding order is preserved even when frames arrive out of order.

### 15.3 Worker Lifecycle

- The worker SHALL be created and terminated by the `ExportEngine`.
- `terminateWorker()` SHALL call `worker.terminate()` and set the reference to `null`.
- The worker SHALL be terminated on `dispose()`.

---

## 16. Download Helper

### 16.1 `downloadBlob`

```typescript
function downloadBlob(blob: Blob, filename: string): void
```

The `downloadBlob` helper SHALL:

1. Create an object URL from the `Blob`.
2. Create a temporary `<a>` element with `download` attribute set to `filename`.
3. Programmatically click the element to trigger the browser download.
4. Remove the element from the DOM.
5. Revoke the object URL after 60 seconds.

This is a convenience utility for triggering browser downloads of export results. It is NOT part of the export engine itself.

---

## 17. Codec Mapping

The engine SHALL use the following codec string mapping for WebCodecs compatibility:

| Internal Codec | WebCodecs String |
|---|---|
| `h264` | `"avc"` |
| `h265` | `"hevc"` |
| `vp8` | `"vp8"` |
| `vp9` | `"vp9"` |
| `av1` | `"av1"` |
| `prores` | `"prores"` |

---

## 18. Open Questions

- **ProRes browser support:** Which browsers support ProRes encoding via WebCodecs? The current fallback to H.264 is a stopgap. Should the UI hide ProRes options when unsupported, or show them with a warning?
- **Image sequence result format:** Should `exportSequence` return a single ZIP `Blob` or an array of per-frame `Blob` objects? The current `ExportResult` only carries a single `blob`.
- **Hardware acceleration preference:** Should `hardwareAcceleration` be user-configurable? The current `"prefer-software"` default prioritizes stability. Power users may want `"prefer-hardware"` for speed.
- **Export queue:** Should the system support queuing multiple exports? Currently only one export can run at a time (single `AbortController`).
- **Export presets persistence:** Where are custom `ExportPreset` objects persisted? User settings store? Project-scoped?
- **Subtitle rendering in export:** The current export engine does not call `renderSubtitleToCanvas` during frame rendering. After the subtitle track migration (Task 5–6 of the subtitle-track-clip-type plan), the export path MUST be verified to include subtitle rendering. Is the export path using the same canvas pipeline as preview, or does it need a separate subtitle rendering call?
- **Audio-only export with video timeline:** When exporting audio-only from a project with video tracks, should the audio mix include audio from video clips, or only from dedicated audio tracks?
- **Export to GIF:** The README roadmap lists GIF export as "In Progress." What are the requirements? Animated GIF with palette optimization? Frame rate limits?
- **Export progress granularity:** Currently progress is yielded every frame. For very long exports (e.g., 4K@60fps for 30 minutes = 108,000 frames), should progress be throttled to reduce message overhead?
