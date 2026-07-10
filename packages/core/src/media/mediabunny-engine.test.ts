import { describe, it, expect, vi } from "vitest";
import { isSupportedFormat, inferMediaType, MediaBunnyEngine } from "./mediabunny-engine";

const nextTagsHolder = vi.hoisted(() => ({ tags: {} as { title?: string } }));

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {
    constructor(public file: File | Blob) {}
  },
  Input: class {
    async computeDuration() { return 10; }
    async getMimeType() { return "audio/mpeg"; }
    async getPrimaryVideoTrack() { return null; }
    async getPrimaryAudioTrack() {
      return {
        sampleRate: 44100,
        numberOfChannels: 2,
        codec: "mp3",
        canDecode: async () => true,
      };
    }
    async getAudioTracks() { return [{}]; }
    async getMetadataTags() { return nextTagsHolder.tags; }
    [Symbol.dispose]() {}
  },
}));

// ─── isSupportedFormat ────────────────────────────────────────────────────────

describe("isSupportedFormat", () => {
  describe("WAV regression — 'unsupported format' false-positive (reported Jun 30 / Jul 3)", () => {
    // [regression] audio/wav must be accepted; was missing from SUPPORTED_AUDIO_FORMATS at one point
    it("accepts audio/wav MIME type", () => {
      expect(isSupportedFormat("audio/wav")).toBe(true);
    });

    // [regression] browsers (Chrome/Firefox) commonly report audio/x-wav for WAV files
    it("accepts audio/x-wav MIME type (browser-reported variant)", () => {
      expect(isSupportedFormat("audio/x-wav")).toBe(true);
    });

    // [regression] Safari and some legacy browsers report audio/wave
    it("accepts audio/wave MIME type (legacy browser variant)", () => {
      expect(isSupportedFormat("audio/wave")).toBe(true);
    });

    // [regression] empty MIME + .wav extension: the exact bug — browser gives '' as type,
    // code must fall back to the filename extension rather than rejecting outright
    it("accepts empty MIME with .wav filename (extension fallback path)", () => {
      expect(isSupportedFormat("", "recording.wav")).toBe(true);
    });

    // [regression] application/octet-stream is the generic binary MIME browsers emit when they
    // cannot detect the type; code must honour the .wav extension fallback
    it("accepts application/octet-stream MIME with .wav filename", () => {
      expect(isSupportedFormat("application/octet-stream", "clip.wav")).toBe(true);
    });

    // [regression] .wave extension (less common but in the map) must also work
    it("accepts empty MIME with .wave filename", () => {
      expect(isSupportedFormat("", "sound.wave")).toBe(true);
    });

    // [regression] MIME with charset parameter must not break baseMimeType stripping
    it("accepts audio/wav with charset parameter", () => {
      expect(isSupportedFormat("audio/wav; charset=utf-8")).toBe(true);
    });
  });

  describe("other audio formats still accepted", () => {
    it("accepts audio/mpeg (MP3)", () => {
      expect(isSupportedFormat("audio/mpeg")).toBe(true);
    });

    it("accepts audio/mp3", () => {
      expect(isSupportedFormat("audio/mp3")).toBe(true);
    });

    it("accepts audio/aac", () => {
      expect(isSupportedFormat("audio/aac")).toBe(true);
    });

    it("accepts audio/ogg", () => {
      expect(isSupportedFormat("audio/ogg")).toBe(true);
    });

    it("accepts audio/flac", () => {
      expect(isSupportedFormat("audio/flac")).toBe(true);
    });
  });

  describe("video formats still accepted", () => {
    it("accepts video/mp4", () => {
      expect(isSupportedFormat("video/mp4")).toBe(true);
    });

    it("accepts video/webm", () => {
      expect(isSupportedFormat("video/webm")).toBe(true);
    });

    it("accepts video/quicktime", () => {
      expect(isSupportedFormat("video/quicktime")).toBe(true);
    });

    it("accepts empty MIME with .mp4 filename", () => {
      expect(isSupportedFormat("", "movie.mp4")).toBe(true);
    });

    it("accepts empty MIME with .mov filename", () => {
      expect(isSupportedFormat("", "clip.mov")).toBe(true);
    });
  });

  describe("truly unsupported formats rejected", () => {
    it("rejects application/octet-stream with no filename", () => {
      expect(isSupportedFormat("application/octet-stream")).toBe(false);
    });

    it("rejects empty MIME with .exe filename", () => {
      expect(isSupportedFormat("", "virus.exe")).toBe(false);
    });

    it("rejects empty MIME with no filename", () => {
      expect(isSupportedFormat("")).toBe(false);
    });

    it("rejects application/pdf", () => {
      expect(isSupportedFormat("application/pdf")).toBe(false);
    });

    it("rejects text/plain", () => {
      expect(isSupportedFormat("text/plain")).toBe(false);
    });

    it("rejects empty MIME with .zip filename", () => {
      expect(isSupportedFormat("", "archive.zip")).toBe(false);
    });
  });
});

// ─── inferMediaType ───────────────────────────────────────────────────────────

describe("inferMediaType", () => {
  describe("WAV regression — must return 'audio', not null (reported Jun 30 / Jul 3)", () => {
    // [regression] audio/wav must resolve to 'audio'
    it("returns 'audio' for audio/wav", () => {
      expect(inferMediaType("audio/wav")).toBe("audio");
    });

    // [regression] audio/x-wav (Chrome/Firefox) must resolve to 'audio'
    it("returns 'audio' for audio/x-wav", () => {
      expect(inferMediaType("audio/x-wav")).toBe("audio");
    });

    // [regression] audio/wave (Safari) must resolve to 'audio'
    it("returns 'audio' for audio/wave", () => {
      expect(inferMediaType("audio/wave")).toBe("audio");
    });

    // [regression] empty MIME + .wav extension must fall back to 'audio' via extension map
    it("returns 'audio' for empty MIME with .wav filename", () => {
      expect(inferMediaType("", "recording.wav")).toBe("audio");
    });

    // [regression] octet-stream + .wav must fall back to 'audio'
    it("returns 'audio' for application/octet-stream with .wav filename", () => {
      expect(inferMediaType("application/octet-stream", "sound.wav")).toBe("audio");
    });
  });

  describe("other audio formats return 'audio'", () => {
    it("returns 'audio' for audio/mpeg", () => {
      expect(inferMediaType("audio/mpeg")).toBe("audio");
    });

    it("returns 'audio' for audio/aac", () => {
      expect(inferMediaType("audio/aac")).toBe("audio");
    });

    it("returns 'audio' for audio/ogg", () => {
      expect(inferMediaType("audio/ogg")).toBe("audio");
    });

    it("returns 'audio' for empty MIME with .mp3 filename", () => {
      expect(inferMediaType("", "track.mp3")).toBe("audio");
    });
  });

  describe("video formats return 'video'", () => {
    it("returns 'video' for video/mp4", () => {
      expect(inferMediaType("video/mp4")).toBe("video");
    });

    it("returns 'video' for video/webm", () => {
      expect(inferMediaType("video/webm")).toBe("video");
    });

    it("returns 'video' for video/quicktime", () => {
      expect(inferMediaType("video/quicktime")).toBe("video");
    });

    it("returns 'video' for empty MIME with .mp4 filename", () => {
      expect(inferMediaType("", "movie.mp4")).toBe("video");
    });

    it("returns 'video' for empty MIME with .webm filename", () => {
      expect(inferMediaType("", "clip.webm")).toBe("video");
    });
  });

  describe("unsupported formats return null", () => {
    it("returns null for application/octet-stream with no filename", () => {
      expect(inferMediaType("application/octet-stream")).toBeNull();
    });

    it("returns null for empty MIME with no filename", () => {
      expect(inferMediaType("")).toBeNull();
    });

    it("returns null for empty MIME with .exe filename", () => {
      expect(inferMediaType("", "virus.exe")).toBeNull();
    });

    it("returns null for text/plain", () => {
      expect(inferMediaType("text/plain")).toBeNull();
    });
  });
});

// ─── extractMetadata: title tag extraction ────────────────────────────────────

describe("MediaBunnyEngine.extractMetadata title extraction", () => {
  async function initializedEngine(): Promise<MediaBunnyEngine> {
    const engine = new MediaBunnyEngine();
    await engine.initialize();
    return engine;
  }

  it("extracts a non-empty title tag from container metadata", async () => {
    nextTagsHolder.tags = { title: "My Song" };
    const engine = await initializedEngine();
    const file = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

    const result = await engine.extractMetadata(file);

    expect(result.title).toBe("My Song");
  });

  it("trims whitespace around a title tag", async () => {
    nextTagsHolder.tags = { title: "  My Song  " };
    const engine = await initializedEngine();
    const file = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

    const result = await engine.extractMetadata(file);

    expect(result.title).toBe("My Song");
  });

  it("leaves title undefined when the tag is whitespace-only", async () => {
    nextTagsHolder.tags = { title: "   " };
    const engine = await initializedEngine();
    const file = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

    const result = await engine.extractMetadata(file);

    expect(result.title).toBeUndefined();
  });

  it("leaves title undefined when no title tag is present", async () => {
    nextTagsHolder.tags = {};
    const engine = await initializedEngine();
    const file = new File([new Uint8Array([0])], "track.mp3", { type: "audio/mpeg" });

    const result = await engine.extractMetadata(file);

    expect(result.title).toBeUndefined();
  });
});
