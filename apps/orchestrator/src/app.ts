import express from "express";
import type { Express } from "express";
import cors from "cors";
import { config } from "./env";
import { ProjectStore, createProjectRouter, GitStore } from "./projects";
import { neuralframesRouter, wavespeedRouter } from "./routes/index";
import { mkdirSync } from "node:fs";

export function createApp(): Express {
  const gitStore = new GitStore(config.projectsRepo);
  const projectStore = new ProjectStore(gitStore);
  void projectStore.migrateUuidDirs().catch((err) => {
    console.error("[ProjectStore] failed to migrate legacy project directories:", err);
  });
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Serve locally cached generated assets (scene images etc.)
  mkdirSync(config.generatedAssetsDir, { recursive: true });
  app.use("/assets", (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  }, express.static(config.generatedAssetsDir));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      wavespeed: !!config.wavespeedApiKey,
      kieAi: !!config.kieAiApiKey,
      claude: !!config.claudeToken,
    });
  });

  app.use("/api/import/neuralframes", neuralframesRouter);
  app.use("/api/generate/wavespeed", wavespeedRouter);
  app.use("/api/projects", createProjectRouter(projectStore, gitStore));

  return app;
}
