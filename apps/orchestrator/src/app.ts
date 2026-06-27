import express from "express";
import type { Express } from "express";
import cors from "cors";
import { config } from "./env";
import { neuralframesRouter } from "./routes/index";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      wavespeed: !!config.wavespeedApiKey,
      kieAi: !!config.kieAiApiKey,
      claude: !!config.claudeToken,
    });
  });

  app.use("/api/import/neuralframes", neuralframesRouter);

  return app;
}
