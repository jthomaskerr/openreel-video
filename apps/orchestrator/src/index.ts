import { config } from "./env";
import { createApp } from "./app";

const app = createApp();

app.listen(config.port, () => {
  console.log(`\n  Music Video Orchestrator  http://localhost:${config.port}\n`);
  console.log(`  WaveSpeed : ${config.wavespeedApiKey ? "✓" : "○"}`);
  console.log(`  Kie.ai    : ${config.kieAiApiKey ? "✓" : "○"}`);
  console.log(`  Claude    : ${config.claudeToken ? "✓" : "○"}\n`);
});
