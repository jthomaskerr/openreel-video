import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./chrome-cdp.mjs";

test("parses defaults and an eval command", () => {
  assert.deepEqual(parseArgs(["eval", "document.title"]), {
    command: "eval",
    args: ["document.title"],
    options: { port: 9223, urlContains: "5173" },
  });
});

test("parses target overrides", () => {
  assert.deepEqual(
    parseArgs(["--port", "9333", "--url-contains", "/editor", "screenshot", "/tmp/app.png"]),
    {
      command: "screenshot",
      args: ["/tmp/app.png"],
      options: { port: 9333, urlContains: "/editor" },
    },
  );
});

test("rejects an unknown global option", () => {
  assert.throws(() => parseArgs(["--wat", "x", "eval", "1"]), /Unknown option/);
});
