# OpenThreads

> Part of the **DeepDucks** ecosystem

A web server that abstracts communication channels (Slack, Discord, Telegram, WhatsApp, etc.) into a unified ingress/egress interface with native human-in-the-loop support.

See [VISION.md](VISION.md) for the full project document.

---

## Agentic Development Workflows

This repository uses three GitHub Actions workflows powered by [Claude Code](https://github.com/anthropics/claude-code-action) to autonomously implement issues from a structured plan. The system is designed to be **generic** — it works for any project, not just OpenThreads.

### Architecture

```
Human comments @claude
on meta issue (kickstart)
        │
        ▼
   ┌──────────────────────────────────────────┐
   │         claude-meta.yml                   │
   │  1. Determine meta issue (#N)             │
   │  2. Ensure branch meta/<N> exists         │
   │  3. Check merged PRs → mark done          │
   │  4. Find next ready issues                │
   │  5. Comment @claude on them               │
   └──────────────┬───────────────────────────┘
                  │ comments @claude on task issue
                  ▼
   ┌──────────────────────────────────────────┐
   │         claude-task.yml                   │
   │  1. Extract base branch from comment      │
   │  2. Checkout meta/<N> (not main)          │
   │  3. Implement the issue                   │
   │  4. Auto-create PR → auto-merge           │
   │  5. Comment @claude on meta issue ←────── │─── loop closure
   └──────────────┬───────────────────────────┘
                  │ comment triggers meta workflow
                  ▼
              loops back to claude-meta.yml
                  │
          (when all tasks done)
                  ▼
   meta agent opens final PR: meta/<N> → main
```

> **Loop closure note:** GitHub Actions events triggered by `GITHUB_TOKEN` do not fire other workflows (to prevent infinite loops). This means a PR merge done by the task worker's post-step does NOT trigger `pull_request: closed`. Instead, the task worker comments `@claude` on the meta issue after merging, which triggers the orchestrator via `issue_comment`. This is the primary loop mechanism.

### Branch Model

```
main
 ├── meta/17                          ← meta issue #17's integration branch
 │    ├── claude/17-issue-1-20260410  ← task #1 branch
 │    ├── claude/17-issue-3-20260410  ← task #3 branch
 │    └── claude/17-issue-7-20260410  ← task #7 branch
 │
 └── meta/42                          ← another meta issue's branch
      └── claude/42-issue-1-20260410
```

- Each **meta issue** gets its own integration branch: `meta/<issue_number>`
- Each **task** branches from the meta branch: `claude/<meta>-issue-<task>-<date>`
- Task PRs target the meta branch (not `main`)
- When all tasks are done, a final PR merges `meta/<N>` → `main`

---

## Prerequisites

1. **Install the Claude Code GitHub App** on the repository:
   https://github.com/apps/claude

2. **Add the `CLAUDE_CODE_OAUTH_TOKEN` secret** to the repository settings:
   Settings → Secrets and variables → Actions → New repository secret

---

## Workflows

### 1. Meta Orchestrator (`claude-meta.yml`)

The brain of the loop. Reads a meta issue, tracks progress, and assigns work.

| | |
|---|---|
| **Triggers** | PR merged into `meta/*` branch; `@claude` comment on a `meta`-labeled issue |
| **Mode** | Automation (runs a fixed `prompt`) |
| **Model** | `claude-sonnet-4-6` |
| **Timeout** | 60 minutes |

### 2. Task Worker (`claude-task.yml`)

The hands. Implements a single issue, creates a PR, and merges it.

| | |
|---|---|
| **Triggers** | `@claude` comment on a non-meta issue (excludes `@claude fix`) |
| **Mode** | Interactive (reads issue body + comment as context) |
| **Model** | `claude-sonnet-4-6` |
| **Timeout** | 60 minutes |

### 3. Fix Agent (`claude-fix.yml`)

The safety net. Picks up failed tasks and tries to complete or fix them.

| | |
|---|---|
| **Triggers** | `@claude fix` comment on a non-meta issue |
| **Mode** | Interactive (reads issue body + all comments including error context) |
| **Model** | `claude-sonnet-4-6` |
| **Timeout** | 60 minutes |

---

## How to Use

### Starting a new implementation plan

1. **Create task issues** with detailed descriptions, acceptance criteria, and dependency references (e.g., "Depends on #2").

2. **Create a meta issue** with:
   - Label: `meta`
   - Body containing a dependency graph and wave-based execution order with checkboxes:

   ```markdown
   ## Dependency Graph
   #1 → #2 → #3

   ## Execution Order
   ### Wave 1
   - [ ] #1 Task title `P0`

   ### Wave 2
   - [ ] #2 Task title `P0`
   ```

3. **Kickstart the loop** by commenting on the meta issue:
   ```
   @claude
   ```

4. The orchestrator will:
   - Create the `meta/<N>` branch
   - Assign Wave 1 issues by commenting `@claude` on them
   - Post a summary on the meta issue

5. From here, the loop runs autonomously:
   - Task workers implement → create PRs → merge → comment on meta issue
   - Each comment triggers the orchestrator → marks done → assigns next wave
   - Repeats until all waves are complete
   - Final PR: `meta/<N>` → `main`

### Handling failures

When a task worker fails:

1. A notification is automatically posted on both the **meta issue** and the **task issue** with a link to the failed run.

2. To retry, comment on the failed task issue:
   ```
   @claude fix
   ```

3. The fix agent will:
   - Pick up the existing branch (partial progress)
   - Read the error context from previous comments
   - Attempt to complete or fix the implementation
   - Create/merge the PR if successful

4. If the fix agent also fails, it posts a notification indicating **manual intervention is needed**.

### Manual retry (orchestrator)

If the meta orchestrator fails, comment on the meta issue:
```
@claude
```

This re-triggers the orchestrator, which is idempotent — it reads the current state and picks up where it left off.

### Priority labels

Issues with the `priority:P0` label are flagged for auto-merge in the orchestrator's comments. Higher priority issues (`P1`, `P2`, `P3`) may require human review before merging (depending on your branch protection rules).

### Multiple implementation plans

Multiple meta issues can coexist. Each gets its own `meta/<N>` branch and operates independently. Task workers are scoped to their meta issue's branch via the `Base branch` instruction in the orchestrator's comment.

---

## Guardrails

| Guardrail | Description |
|---|---|
| **60-minute timeout** | All agent jobs have a hard time limit to prevent runaway costs |
| **Failure notifications** | Failures are reported on both the meta and task issues |
| **Fix agent** | `@claude fix` provides semi-automated recovery |
| **Idempotent orchestrator** | Re-running the meta agent is always safe — it reads current state |
| **Conflict resolution** | Task worker auto-resolves merge conflicts via API merge |
| **Bot allowlist** | Only `claude[bot]` can trigger task workers, preventing spam |
| **Loop closure via comment** | Task workers comment on meta issue after merge (GITHUB_TOKEN merges don't emit PR events) |

### Known limitations

| Limitation | Workaround |
|---|---|
| `GITHUB_TOKEN` events don't trigger other workflows | Task post-step comments on meta issue to close the loop |
| Workflow validation fails when workflow files change between trigger and execution | Re-trigger via `@claude` comment on meta issue (uses latest workflow from `main`) |
| `git` auth not available in post-steps | Post-steps use `gh api` and `gh` CLI instead of `git` commands |
| Parallel tasks in the same wave may cause merge conflicts | Post-step tries direct merge, falls back to API merge; unresolvable conflicts trigger failure notification |
