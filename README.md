# Ritoko

**Turn a browser task your agent solved once into a reliable procedure.** Rerun it with new data, verified item by item, resumable after a crash, without submitting anything twice.

Works with **Claude Code** and **Codex CLI** (plugin = skill + local MCP server).

## How it works

1. **Record.** Your agent does the task once in Ritoko's Chrome window. Ritoko computes robust selectors for each action (role, label, visible text — verified unique, with fallbacks) instead of brittle ids or positions.
2. **Save.** The agent turns the recording into a workflow: parameters, a batch source (Excel/CSV), a business key per item, a `commit` step, and `expect` checks.
3. **Replay.** Ritoko runs it deterministically — no LLM, no tokens — and journals every item in SQLite.
4. **Repair.** If the site changed, the run pauses on the failing step with the page left open; the agent fixes the selector and the run resumes where it stopped.

| Status | Meaning |
|---|---|
| `done` | Verified by the workflow's `expect` steps |
| `failed` | Verification or system error, with a screenshot |
| `review` | Interrupted after the commit step: outcome unknown, check on the site — never replayed blindly |
| `skipped` | Already done by a previous run (no double submission) |

## Install

Claude Code:

```bash
claude plugin marketplace add Swih/ritoko
claude plugin install ritoko@ritoko
```

Codex CLI:

```bash
codex plugin marketplace add Swih/ritoko
```

Then open `/plugins` in Codex and install Ritoko. Requires Node 24+ and Google Chrome.

## Use

Ask your agent:

- "Record this task with Ritoko: download the September report from …"
- "Rerun the `supplier-onboarding` workflow with `suppliers.csv`"
- "Resume my last Ritoko run"

Or from a terminal, without any agent:

```bash
npx ritoko run rpa-challenge --repeat
npx ritoko report
```

Workflows, runs and the browser profile live in `~/.ritoko` (override with `RITOKO_HOME`). Logins you do once in the Ritoko window are reused by every run.

## Scope

Ritoko automates sites you are allowed to automate. It does not bypass CAPTCHAs or anti-bot protections, and it stops for logins and MFA so you complete them yourself.

## Development

```bash
pnpm install
pnpm check   # biome + tsc
pnpm test
pnpm build
```

MIT © Swih
