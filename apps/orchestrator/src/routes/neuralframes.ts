import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { mkdirSync, createWriteStream } from "node:fs";
import { join, extname } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { importNeuralFrames } from "@openreel/music-video-domain";
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

/**
 * POST /api/import/neuralframes
 * Body: NeuralFramesStoryboard JSON (the file contents, parsed by the client)
 * Returns: NeuralFramesImportResult with outputPath rewritten to orchestrator-served URLs.
 *
 * Scene images are downloaded into generatedAssetsDir/neuralframes/<storyboardId>/
 * and served back as http://localhost:<port>/assets/... so the browser can fetch them.
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

    await Promise.all(
      result.generatedAssets.map(async (asset) => {
        if (!asset.outputPath?.startsWith("http")) return;
        const ext = extname(new URL(asset.outputPath).pathname) || ".webp";
        const localFile = join(cacheDir, `${asset.id}${ext}`);
        await downloadFile(asset.outputPath, localFile);
        const rel = localFile.slice(config.generatedAssetsDir.length);
        asset.outputPath = `http://localhost:${config.port}/assets${rel}`;
      }),
    );

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Import failed: ${(e as Error).message}` });
  }
});
