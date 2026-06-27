import express from "express";
import cors from "cors";
import { config } from "./env.js";
import { neuralframesRouter } from "./routes/index.js";

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

app.listen(config.port, () => {
  console.log(`\n  Music Video Orchestrator`);
  console.log(`  http://localhost:${config.port}\n`);
  console.log(`  WaveSpeed : ${config.wavespeedApiKey ? "✓" : "○ (WAVESPEED_API_KEY unset)"}`);
  console.log(`  Kie.ai    : ${config.kieAiApiKey ? "✓" : "○ (KIE_AI_API_KEY unset)"}`);
  console.log(`  Claude    : ${config.claudeToken ? "✓" : "○ (CLAUDE_OAUTH_TOKEN unset)"}\n`);
});
