import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { importNeuralFrames } from "@openreel/music-video-domain";
import type { NeuralFramesStoryboard } from "@openreel/music-video-domain";

export const neuralframesRouter: ExpressRouter = Router();

/**
 * POST /api/import/neuralframes
 * Body: NeuralFramesStoryboard JSON (the file contents, parsed by the client)
 * Returns: NeuralFramesImportResult
 *
 * The client reads the file locally and sends the parsed JSON — no server-side
 * filesystem access needed. Account/user identity fields are stripped.
 */
neuralframesRouter.post("/", (req, res) => {
  const raw = req.body as NeuralFramesStoryboard;

  if (!raw?.storyboard_props) {
    res.status(400).json({ error: "Invalid Neural Frames storyboard: missing storyboard_props" });
    return;
  }

  try {
    const result = importNeuralFrames(raw, "");
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Import failed: ${(e as Error).message}` });
  }
});
