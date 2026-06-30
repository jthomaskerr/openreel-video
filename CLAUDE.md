# CLAUDE.md — OpenReel Video

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
