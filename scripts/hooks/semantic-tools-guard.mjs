#!/usr/bin/env node

const mode = process.argv[2];

const startupInstruction = [
  "SEMANTIC TOOLING PREFLIGHT: Before repository exploration, call Serena initial_instructions and activate this project.",
  "Confirm Serena and Hindsight are available; if either is unavailable, stop and inform Joseph.",
  "Prefer code-review-graph for architecture, impact, callers, importers, and review context.",
  "Use Serena for targeted symbols, definitions, implementations, references, types, and diagnostics.",
  "Do not fall back to rg, grep, find, or broad file reads.",
  "Never use Serena memory tools. Use Hindsight for all memory operations.",
].join(" ");

if (mode === "session-start") {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: startupInstruction,
    },
  }));
  process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

if (mode === "pre-tool-use") {
  const payload = input ? JSON.parse(input) : {};
  const command = payload?.tool_input?.command ?? "";
  const prohibited = /(^|[;&|()\s])(rg|grep|find)(?=\s|$)/;

  if (prohibited.test(command)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext:
          "WARNING: Prefer Serena for targeted semantic code exploration. Prefer code-review-graph for architecture and impact analysis. Do not use text search as a fallback when the structured tools can answer the question.",
      },
    }));
  }
}
