import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("orchestrator app imports through the production Node tsx loader", () => {
  const orchestratorRoot = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", "import('./src/app.ts')"],
    { cwd: orchestratorRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `production import failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
