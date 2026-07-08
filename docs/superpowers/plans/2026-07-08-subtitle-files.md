
 Plan: Update Auto Captions to Support Audio/Video Clip Input

 ### Goal

 Update the Auto Captions tool so users can generate captions from an existing selected audio or video clip, not only from live microphone recording.

 Current state:
 - AutoCaptionPanel only supports browser live speech recognition.
 - TranscriptionService already supports clip-based transcription via:
     - packages/core/src/text/transcription-service.ts
     - transcribeClip(clip, mediaItem, onProgress)
 - InspectorPanel already has similar subtitle-generation logic for selected clips.
 - GPU transcription backend exists at:
     - infra/transcribe-gpu/main.py

 ────────────────────────────────────────────────────────────────────────────────

 Implementation Steps

 ### 1. Add selected clip awareness to AutoCaptionPanel

 File:

 ```txt
   apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx
 ```

 Import useUIStore:

 ```ts
   import { useUIStore } from "../../../stores/ui-store";
 ```

 Use:

 ```ts
   const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);
   const project = useProjectStore((state) => state.project);
   const getMediaItem = useProjectStore((state) => state.getMediaItem);
 ```

 Derive the selected clip:

 ```ts
   const selectedClip = useMemo(() => {
     const selectedIds = getSelectedClipIds();
     if (selectedIds.length !== 1) return null;

     return project.timeline.tracks
       .flatMap((track) => track.clips)
       .find((clip) => clip.id === selectedIds[0]) ?? null;
   }, [getSelectedClipIds, project.timeline.tracks]);
 ```

 Only allow clip transcription when:

 ```ts
   selectedClip?.type === "audio" || selectedClip?.type === "video"
 ```

 ────────────────────────────────────────────────────────────────────────────────

 ### 2. Add a clip transcription mode to the Auto Captions UI

 Add a mode selector:

 ```ts
   type CaptionSource = "microphone" | "selected-clip";
 ```

 State:

 ```ts
   const [captionSource, setCaptionSource] = useState<CaptionSource>("selected-clip");
 ```

 UI options:

 - Selected Clip
 - Microphone Recording

 Recommended default: selected-clip when an audio/video clip is selected, otherwise microphone.

 ────────────────────────────────────────────────────────────────────────────────

 ### 3. Wire TranscriptionService into AutoCaptionPanel

 Import from core:

 ```ts
   import {
     initializeTranscriptionService,
     type WhisperTranscriptionProgress,
   } from "@openreel/core";
 ```

 Import API endpoint:

 ```ts
   import { OPENREEL_TRANSCRIBE_URL } from "../../../config/api-endpoints";
 ```

 Add progress state for backend transcription:

 ```ts
   const [clipProgress, setClipProgress] =
     useState<WhisperTranscriptionProgress | null>(null);
 ```

 Add handler:

 ```ts
   const handleTranscribeSelectedClip = useCallback(async () => {
     if (!selectedClip) return;

     const mediaItem = getMediaItem(selectedClip.mediaId);
     if (!mediaItem) {
       setError("Could not find media for selected clip");
       return;
     }

     if (selectedClip.type !== "audio" && selectedClip.type !== "video") {
       setError("Select an audio or video clip to generate captions");
       return;
     }

     setError(null);
     setSegments([]);
     setIsTranscribing(true);

     try {
       const transcriptionService = initializeTranscriptionService({
         apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
         language: selectedLanguage,
       });

       const subtitles = await transcriptionService.transcribeClip(
         selectedClip,
         mediaItem,
         setClipProgress,
       );

       subtitles.forEach((subtitle) => {
         addSubtitle(subtitle);
       });

       if (selectedStyle !== "default") {
         await applySubtitleStylePreset(selectedStyle);
       }
     } catch (err) {
       setError(err instanceof Error ? err.message : "Failed to transcribe clip");
     } finally {
       setIsTranscribing(false);
       setClipProgress(null);
     }
   }, [
     selectedClip,
     getMediaItem,
     selectedLanguage,
     selectedStyle,
     addSubtitle,
     applySubtitleStylePreset,
   ]);
 ```

 ────────────────────────────────────────────────────────────────────────────────

 ### 4. Keep microphone recording path intact

 Existing methods should remain:

 ```ts
   handleStartTranscription
   handleStopTranscription
   handleApplySegments
 ```

 But the primary button should dispatch based on mode:

 ```ts
   if (captionSource === "selected-clip") {
     await handleTranscribeSelectedClip();
   } else {
     await handleStartTranscription();
   }
 ```

 ────────────────────────────────────────────────────────────────────────────────

 ### 5. Improve disabled/error states

 Add clear UI states:

 #### No selected clip

 ```txt
   Select an audio or video clip in the timeline to generate captions.
 ```

 #### Wrong clip type

 ```txt
   Selected clip does not contain audio.
 ```

 #### No local media source

 ```txt
   This clip’s source media is unavailable. Reconnect or recover the media first.
 ```

 #### Transcription backend unavailable

 ```txt
   Transcription service is unavailable. Try again later.
 ```

 ────────────────────────────────────────────────────────────────────────────────

 ### 6. Reuse existing backend transcription flow

 The existing service already handles:

 ```txt
   packages/core/src/text/transcription-service.ts
 ```

 Important behavior:
 - Extracts audio from selected clip.
 - Honors clip.inPoint, clip.outPoint, and clip.duration.
 - Uploads WAV to /transcribe.
 - Polls /jobs/:jobId.
 - Converts word timestamps into timeline subtitles.

 No major core changes should be needed unless we discover edge cases.

 ────────────────────────────────────────────────────────────────────────────────

 ### 7. Update copy and layout

 Current copy:

 ```txt
   Speak clearly into your microphone. Captions will be generated in real-time.
 ```

 Change to conditional copy:

 ```txt
   Generate captions from the selected audio/video clip.
 ```

 or:

 ```txt
   Record live speech from your microphone.
 ```

 Button labels:

 - Selected clip mode: Generate Captions
 - Microphone mode: Start Recording
 - Active clip transcription: Generating…

 ────────────────────────────────────────────────────────────────────────────────

 ### 8. Add tests

 Recommended tests:

 #### AutoCaptionPanel

 Mock:
 - selected audio clip
 - selected video clip
 - no selected clip
 - image/text clip selected
 - successful transcribeClip
 - failed transcribeClip

 Assert:
 - Generate button enabled only for audio/video clip.
 - Progress appears during transcription.
 - addSubtitle called with returned subtitles.
 - Style preset applied when selected.

 #### TranscriptionService

 Existing service likely needs coverage for:
 - clip inPoint
 - clip duration
 - audio/video media item blob
 - failed backend response
 - polling job completion

 ────────────────────────────────────────────────────────────────────────────────

 ### 9. Browser verification

 Because this is a browser-based editor, verify manually:

 1. Start app:

 ```sh
   pnpm dev
 ```

 2. Open editor in browser.
 3. Import a video clip with speech.
 4. Add clip to timeline.
 5. Select clip.
 6. Open AI Gen → Auto Captions.
 7. Choose Selected Clip.
 8. Click Generate Captions.
 9. Confirm:
     - progress updates
     - subtitles appear on timeline
     - timings align with the selected clip
     - style preset works
 10. Repeat with an audio-only clip.

 ────────────────────────────────────────────────────────────────────────────────

 Notes

 The current LSP diagnostics in:

 ```txt
   infra/transcribe-gpu/main.py
 ```

 are unresolved Python dependency imports:

 ```txt
   fastapi
   faster_whisper
   uvicorn
   deep_translator
 ```

 These appear environment/dependency-related and should be handled separately from the frontend Auto Captions update unless backend transcription fails locally.