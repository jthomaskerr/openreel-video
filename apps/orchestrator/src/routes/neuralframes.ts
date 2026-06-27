import { Router } from "express";
import { readFileSync } from "node:fs";
import { importNeuralFrames } from "@openreel/music-video-domain";
import type { NeuralFramesStoryboard } from "@openreel/music-video-domain";

export const neuralframesRouter = Router();

/**
 * POST /api/import/neuralframes
 * Body: { path: "/absolute/path/to/neuralframes.storyboard.json" }
 * Returns: NeuralFramesImportResult
 *
 * Strips all account/user identity fields — only creative content is returned.
 */
neuralframesRouter.post("/", (req, res) => {
  const { path: filePath } = req.body as { path?: string };
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }

  let raw: NeuralFramesStoryboard;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as NeuralFramesStoryboard;
  } catch (e) {
    res.status(400).json({ error: `Could not read file: ${(e as Error).message}` });
    return;
  }

  try {
    const result = importNeuralFrames(raw, filePath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Import failed: ${(e as Error).message}` });
  }
});
