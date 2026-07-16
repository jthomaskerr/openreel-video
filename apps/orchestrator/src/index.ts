import { config } from "./env";
import { createApp } from "./app";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`\n  Music Video Orchestrator  http://localhost:${config.port}\n`);
  console.log(`  WaveSpeed : ${config.wavespeedApiKey ? "✓" : "○"}`);
  console.log(`  Kie.ai    : ${config.kieAiApiKey ? "✓" : "○"}`);
  console.log(`  Claude    : ${config.claudeToken ? "✓" : "○"}\n`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[Orchestrator] ${signal} received; stopping HTTP server and commit timers`);
  app.dispose();
  server.close((error) => {
    if (error) {
      console.error("[Orchestrator] graceful shutdown failed", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
