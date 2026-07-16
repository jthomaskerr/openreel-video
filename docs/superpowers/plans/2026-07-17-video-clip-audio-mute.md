# Video Clip Audio Mute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a muted timeline video clip's embedded audio is excluded from editor preview playback while the video continues rendering normally.

**Architecture:** Keep the repair at the shared preview-audio eligibility boundary, `getAudioPlaybackClips`, which feeds both native-video and multi-track preview scheduling. Add no new state or APIs because `clip.muted` is already persisted and export already honors it.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Vite, OpenReel real-time audio graph

## Global Constraints

- Do not change visual clip rendering.
- Preserve linked/separated-audio duplicate suppression, including when the separated audio is muted.
- Treat an absent `clip.muted` field as unmuted for backward compatibility.
- Do not modify the clip model, persistence, inspector, or export engine.

---

### Task 1: Exclude muted clips from preview audio scheduling

**Files:**
- Modify: `apps/web/src/components/editor/preview-audio-playback.ts:63-70`
- Test: `apps/web/src/components/editor/preview-audio-playback.test.ts:17-38`
- Test: `apps/web/src/components/editor/preview-audio-playback.test.ts:209-225`

**Interfaces:**
- Consumes: `Clip.muted?: boolean` and `getAudioPlaybackClips(tracks: Track[], getMediaItem: GetMediaItem, time: number, lookAheadSeconds?: number): AudioPlaybackClip[]`
- Produces: The existing `getAudioPlaybackClips` result with explicitly muted clips excluded.

- [ ] **Step 1: Extend the clip fixture and add failing regression tests**

Change the fixture override type and returned clip:

```typescript
overrides: Partial<{ startTime: number; duration: number; muted: boolean }> = {},
```

```typescript
volume: 1,
muted: overrides.muted ?? false,
keyframes: [],
```

Add these tests beside the existing muted-track tests:

```typescript
it("excludes a muted video clip with embedded audio", () => {
  const v = clip("v1", "media-1", "vt", "video", { muted: true });
  const tracks = [track("vt", "video", [v])];

  const result = getAudioPlaybackClips(
    tracks,
    lookup([media("media-1", "video", 2)]),
    0,
  );

  expect(result).toHaveLength(0);
});

it("excludes a muted audio-only clip", () => {
  const a = clip("a1", "media-1", "at", "audio", { muted: true });
  const tracks = [track("at", "audio", [a])];

  const result = getAudioPlaybackClips(
    tracks,
    lookup([media("media-1", "audio", 2)]),
    0,
  );

  expect(result).toHaveLength(0);
});
```

- [ ] **Step 2: Run the focused test and verify the new cases fail for the expected reason**

Run:

```bash
rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview-audio-playback.test.ts
```

Expected: the two new cases fail because `getAudioPlaybackClips` returns one scheduled clip; existing cases pass.

- [ ] **Step 3: Implement the minimal eligibility check**

Add the explicit clip-level filter before media lookup and linked-audio handling:

```typescript
for (const clip of track.clips) {
  if (clip.muted) continue;
  if (!isClipInPlaybackWindow(clip, time, lookAheadSeconds)) continue;
```

- [ ] **Step 4: Run focused and affected deterministic verification**

Run:

```bash
rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview-audio-playback.test.ts
rtk pnpm --filter @openreel/web typecheck
```

Expected: all preview-audio tests pass, including linked-audio suppression, and type checking exits successfully without new errors.

- [ ] **Step 5: Verify the rendered editor flow in the Browser**

Open `http://localhost:5174/editor?projectId=vintage-tokyo`, select a video clip that contains embedded audio, and perform:

1. Start preview playback and confirm the video advances with audible clip audio.
2. Enable **Mute clip audio** in the Audio inspector.
3. Restart preview playback and confirm the video still advances while the clip audio is silent.
4. Disable **Mute clip audio** and confirm audio returns at the preserved volume.
5. Confirm there is no framework error overlay and no relevant console error or warning.

- [ ] **Step 6: Commit the verified repair**

```bash
rtk git add apps/web/src/components/editor/preview-audio-playback.ts apps/web/src/components/editor/preview-audio-playback.test.ts
rtk git commit -m "fix(web): honor video clip audio mute in preview"
```
