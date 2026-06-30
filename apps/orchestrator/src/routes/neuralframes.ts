import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { mkdirSync, createWriteStream } from "node:fs";
import { join, extname } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { createHash } from "node:crypto";
import { importNeuralFrames, normalizeImageJob } from "@openreel/music-video-domain";
import type { NeuralFramesStoryboard } from "@openreel/music-video-domain";
import { config } from "../env.js";

export const neuralframesRouter: ExpressRouter = Router();

function downloadFile(url: string, destPath: string): Promise<void> {
  let resolve!: () => void, reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  const get = url.startsWith("https") ? httpsGet : httpGet;
  get(url, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      res.resume();
      return;
    }
    const out = createWriteStream(destPath);
    res.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
  }).on("error", reject);
  return promise;
}

/** Stable 16-char file ID derived from a URL, for consistent cache filenames. */
function urlToFileId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * POST /api/import/neuralframes
 * Body: NeuralFramesStoryboard JSON (the file contents, parsed by the client)
 * Returns: NeuralFramesImportResult with ALL remote asset URLs rewritten to
 * orchestrator-served local URLs (scene images, character reference images,
 * LoRA training images). remoteUrlMap contains original→local for the client.
 *
 * Assets are cached at generatedAssetsDir/neuralframes/<storyboardId>/
 * and served as http://localhost:<port>/assets/...
 */
neuralframesRouter.post("/", async (req, res) => {
  const raw = req.body as NeuralFramesStoryboard;

  if (!raw?.storyboard_props) {
    res.status(400).json({ error: "Invalid Neural Frames storyboard: missing storyboard_props" });
    return;
  }

  try {
    const result = importNeuralFrames(raw, "");

    const cacheDir = join(config.generatedAssetsDir, "neuralframes", result.storyboardId);
    mkdirSync(cacheDir, { recursive: true });

    // Collect every remote URL from the result and the raw storyboard.
    // Using a Set so each URL is downloaded exactly once.
    const remoteUrls = new Set<string>();

    // Scene reference preview images (scene_image_url)
    for (const shot of result.shots) {
      if (shot.referenceImageUrl?.startsWith("http")) remoteUrls.add(shot.referenceImageUrl);
    }
    for (const track of result.metadataTracks) {
      for (const block of track.blocks) {
        if (block.thumbnailUrl?.startsWith("http")) remoteUrls.add(block.thumbnailUrl);
      }
    }
    for (const char of raw.storyboard_props.characters ?? []) {
      const imageJob = normalizeImageJob(char.image_job);
      for (const imgAsset of imageJob?.assets ?? []) {
        if (imgAsset.url?.startsWith("http")) remoteUrls.add(imgAsset.url);
      }
    }
    for (const lora of raw.storyboard_props.loras ?? []) {
      for (const url of lora.training_image_urls ?? []) {
        if (url?.startsWith("http")) remoteUrls.add(url);
      }
    }
    if (raw.audio?.trimmed_audio_path?.startsWith("http"))
      remoteUrls.add(raw.audio.trimmed_audio_path);
    if (raw.audio?.primary_audio_artwork_image_url?.startsWith("http"))
      remoteUrls.add(raw.audio.primary_audio_artwork_image_url);

    const remoteUrlMap: Record<string, string> = {};
    await Promise.all(
      Array.from(remoteUrls).map(async (url) => {
        const ext = extname(new URL(url).pathname) || ".webp";
        const localFile = join(cacheDir, `${urlToFileId(url)}${ext}`);
        await downloadFile(url, localFile);
        const rel = localFile.slice(config.generatedAssetsDir.length);
        remoteUrlMap[url] = `http://localhost:${config.port}/assets${rel}`;
      }),
    );

    // Rewrite shot.referenceImageUrl
    for (const shot of result.shots) {
      if (shot.referenceImageUrl && remoteUrlMap[shot.referenceImageUrl]) {
        shot.referenceImageUrl = remoteUrlMap[shot.referenceImageUrl];
      }
    }
    // Rewrite block thumbnailUrls
    for (const track of result.metadataTracks) {
      for (const block of track.blocks) {
        if (block.thumbnailUrl && remoteUrlMap[block.thumbnailUrl]) {
          block.thumbnailUrl = remoteUrlMap[block.thumbnailUrl];
        }
      }
    }
    if (result.audio?.audioUrl && remoteUrlMap[result.audio.audioUrl]) {
      result.audio.audioUrl = remoteUrlMap[result.audio.audioUrl];
    }
    if (result.audio?.artworkUrl && remoteUrlMap[result.audio.artworkUrl]) {
      result.audio.artworkUrl = remoteUrlMap[result.audio.artworkUrl];
    }

    result.remoteUrlMap = remoteUrlMap;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Import failed: ${(e as Error).message}` });
  }
});
