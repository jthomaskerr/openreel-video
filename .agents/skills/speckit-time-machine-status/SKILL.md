---
name: speckit-time-machine-status
description: Show Time Machine feature queue progress
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: time-machine:commands/status.md
---

# Time Machine — Status

Display the current state of the feature queue.

## User Input

$ARGUMENTS

---

## Steps

### 1. Load the queue

Read `.specify/extensions/time-machine/features-queue.yml`.

If the file does not exist, tell the user:

```
No Time Machine queue found in this project.
Run /speckit.time-machine.analyze to get started.
```

Then stop.

---

### 2. Print the status report

Display the report in this format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Time Machine — Status Report
 Analysed: <analyzed_at>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Progress: <completed>/<total_features> features complete

  #   Status        ID                    Name                    Pushed  Branch
  ─────────────────────────────────────────────────────────────────────────────────────
  1   ✓ done        auth                  Authentication          ✓       feature/time-machine-auth
  2   ▶ in-progress user-management       User Management         —       feature/time-machine-user-management
  3   ○ pending     payments              Payments                —       —
  4   ↷ skipped     legacy-importer       Legacy Importer         —       feature/time-machine-legacy-importer
  ...

 Legend:  ✓ done  ▶ in-progress  ○ pending  ↷ skipped
 Pushed:  ✓ pushed  ✗ not pushed  — n/a

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use the actual data from the queue file. Status icons:

| Queue status  | Icon |
| ------------- | ---- |
| `done`        | `✓`  |
| `in-progress` | `▶`  |
| `pending`     | `○`  |
| `skipped`     | `↷`  |

Pushed column:

| `pushed` value | Icon |
| -------------- | ---- |
| `true`         | `✓`  |
| `false`        | `✗`  |
| `null`         | `—`  |

If a feature has `branch: null`, show `—` in the Branch column.

---

### 3. Next action hint

After the table, print the appropriate next-action hint:

- If any features are `pending` or `in-progress`:
  ```
  Next: Run /speckit.time-machine.next to continue.
  ```
- If all features are `done` or `skipped`:
  ```
  All features processed. Time Machine workflow complete!
  ```