import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hook = new URL("./semantic-tools-guard.mjs", import.meta.url);

function run(mode, payload) {
  return spawnSync(process.execPath, [hook.pathname, mode], {
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: "utf8",
  });
}

test("session start eagerly injects the semantic tooling preflight", () => {
  const result = run("session-start");
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /Serena initial_instructions/);
  assert.match(output.hookSpecificOutput.additionalContext, /Hindsight/);
  assert.match(output.hookSpecificOutput.additionalContext, /code-review-graph/);
});

for (const command of ["rg thumbnail src", "grep -R thumbnail .", "find . -name '*.ts'"]) {
  test(`warns without blocking: ${command}`, () => {
    const result = run("pre-tool-use", { tool_input: { command } });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.match(output.hookSpecificOutput.additionalContext, /Prefer Serena/);
  });
}

test("allows structured-tool-independent shell commands", () => {
  const result = run("pre-tool-use", { tool_input: { command: "pnpm test" } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});
