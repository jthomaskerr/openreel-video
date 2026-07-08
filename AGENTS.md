# CLAUDE.md — OpenReel Video

## Semantic tooling preflight (NON-NEGOTIABLE)

At the start of every coding session, eagerly load Serena's `initial_instructions`
and activate this project before repository exploration. Confirm that both Serena
and Hindsight are available. If either is unavailable, stop and inform Joseph.
Do not fall back to `rg`, `grep`, `find`, or broad file reads.

Serena is not the exclusive code tool. Use the most appropriate structured tool:

- Prefer the code-review-graph MCP server for architecture, blast radius, callers,
  importers, and review context.
- Prefer Serena for symbol discovery, definitions, implementations, references,
  types, diagnostics, and targeted semantic retrieval.
- Other structured tools remain allowed when they fit the task.

Never use Serena's memory tools, including memory list, read, write, edit, rename,
or delete operations. Use Hindsight for all memory recall, retention, and
reflection. If Hindsight is unavailable, stop and inform Joseph.

## Codebase Exploration (USE GRAPH, NOT GREP)
This repo has a code-review-graph MCP server with a live knowledge graph. Prefer graph tools over text search for exploring the codebase:
- `semantic_search_nodes` or `query_graph` for finding code entities
- `get_impact_radius` to understand blast radius of changes
- `detect_changes` + `get_review_context` for code review
- `query_graph` with pattern="callers_of" / "importers_of" for tracing dependencies
- `get_architecture_overview` / `list_communities` for high-level structure
Use Serena when the graph does not cover the targeted code question. Do not fall
back to `rg`, `grep`, `find`, or broad file reads.

## Browser Verification (NON-NEGOTIABLE)
This is a browser-based video editor. Typechecking and unit tests alone CANNOT prove a UI fix works.
- Before claiming any UI fix is complete, you MUST open the app in the browser and reproduce the scenario.
- Verify the exact behavior changed — not just that the page loads or tests pass.
- Use `browser` tool: start dev server (`pnpm dev` on port 5173), open the app, reproduce the bug, apply fix, confirm it's resolved.

## Error Handling / Missing Data
- NEVER skip anything silently. If a file, media blob, import, decode, network request, or fallback path fails or is unavailable, surface it explicitly with actionable UI feedback and/or structured logs that include the relevant identifiers.
- Do not use empty `catch {}` blocks or silent `return null` / `continue` paths for user-visible workflows. If continuing is safe, explain why in code and emit a warning/error that can be diagnosed.

## Commits
- Commit small, atomic changes. One logical change per commit.
- Write detailed commit messages: what was changed, why, and how it was verified.
- Follow conventional commits: `fix:`, `feat:`, `refactor:`, `test:`, etc. (see CONTRIBUTING.md).
- Commit after each verified fix — don't batch unrelated changes.
