#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "$SCRIPT_DIR/../../.." && pwd)"

output="$(
    cd "$REPO_ROOT"
    SPECIFY_FEATURE=001-project-lifecycle "$SCRIPT_DIR/setup-tasks.sh" --json 2>&1
)"

[[ "$output" != *"command not found"* ]]
OUTPUT="$output" node -e 'JSON.parse(process.env.OUTPUT)'
[[ "$output" == *'"FEATURE_DIR":"'"$REPO_ROOT"'/specs/001-project-lifecycle"'* ]]
[[ "$output" == *'"TASKS_TEMPLATE":"'"$REPO_ROOT"'/.specify/templates/tasks-template.md"'* ]]
[[ "$output" == *'"research.md"'* ]]
[[ "$output" == *'"contracts/"'* ]]

echo "setup-tasks template resolution: PASS"
