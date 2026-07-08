# CLAUDE.md — OpenReel Video

## Codebase Exploration (USE GRAPH, NOT GREP)
This repo has a code-review-graph MCP server with a live knowledge graph. Prefer graph tools over grep/glob for exploring the codebase:
- `semantic_search_nodes` or `query_graph` for finding code entities
- `get_impact_radius` to understand blast radius of changes
- `detect_changes` + `get_review_context` for code review
- `query_graph` with pattern="callers_of" / "importers_of" for tracing dependencies
- `get_architecture_overview` / `list_communities` for high-level structure
Fall back to grep only when the graph doesn't cover what you need.

## Browser Verification (NON-NEGOTIABLE)
This is a browser-based video editor. Typechecking and unit tests alone CANNOT prove a UI fix works.
- Before claiming any UI fix is complete, you MUST open the app in the browser and reproduce the scenario.
- Verify the exact behavior changed — not just that the page loads or tests pass.
- Use `browser` tool: start dev server (`pnpm dev` on port 5173), open the app, reproduce the bug, apply fix, confirm it's resolved.

## Commits
- Commit small, atomic changes. One logical change per commit.
- Write detailed commit messages: what was changed, why, and how it was verified.
- Follow conventional commits: `fix:`, `feat:`, `refactor:`, `test:`, etc. (see CONTRIBUTING.md).
- Commit after each verified fix — don't batch unrelated changes.
