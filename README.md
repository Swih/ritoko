# Ritoko

**Turn a browser task your agent solved once into a reusable procedure.** Rerun it with new data, verify each item, and resume after interruption. Uncertain submissions are held for review and never automatically submitted again.

Works with **Claude Code** and **Codex CLI** (plugin = skill + local MCP server).

## How it works

1. **Record.** Your agent does the task once in Ritoko's Chrome window. Ritoko computes robust selectors for each action (role, label, visible text — verified unique, with fallbacks) instead of brittle ids or positions.
2. **Save.** The agent turns the recording into a workflow: parameters, a batch source (Excel/CSV), a business key per item, a `commit` step, and `expect` checks.
3. **Replay.** Ritoko executes without a model and journals every item in SQLite. Each run keeps its workflow definition and input rows.
4. **Repair.** If a selector changed, the run pauses with the page left open. Before submission, the form restarts in full. After submission, only verification resumes on the same document; otherwise the item is held for review.

| Status | Meaning |
|---|---|
| `done` | Verified by the workflow's `expect` steps |
| `failed` | Failure before submission, safe to retry with resume; conflicting data is blocked |
| `review` | Submission may have happened; check on the site — blocked across future runs, including repeat |
| `skipped` | Already done by a previous run (no double submission) |

A run is `done` only when all items are confirmed or skipped and its final checks passed. `partial` means some items failed or need review; `stopped` means execution could not continue. The CLI returns exit code 2 for these outcomes and for repair pauses.

## Install

For the current local checkout (Node 24+ and Google Chrome required), Claude Code:

```bash
claude plugin marketplace add .
claude plugin install ritoko@ritoko
```

Codex CLI:

```bash
codex plugin marketplace add .
```

Select Ritoko in the plugin directory. Restart the client after updating its installed copy. The plugin uses a Node launcher, with no npx process or dependency on a published npm release. If runtime dependencies are missing, the launcher installs them once using npm with lifecycle scripts disabled.

## Use

Ask your agent:

- "Record this task with Ritoko: download the September report from …"
- "Rerun the `supplier-onboarding` workflow with `suppliers.csv`"
- "Resume my last Ritoko run"

Or from a terminal, without any agent:

```bash
node bin/ritoko.mjs import examples/rpa-challenge.json
node bin/ritoko.mjs run rpa-challenge --repeat
node bin/ritoko.mjs report
node bin/ritoko.mjs resume <runId>
node bin/ritoko.mjs resolve <runId> <key> done --note "Matched the record on the site"
node bin/ritoko.mjs browser-close
```

Workflows, runs and the browser profile live in `~/.ritoko` (override with `RITOKO_HOME`). Chrome uses a dedicated profile and a local CDP endpoint shared by CLI and MCP. Exiting a client disconnects it and leaves Chrome available; `browser-close` closes it explicitly. Logins in that profile persist. Set `RITOKO_CHROME_PATH` for a nonstandard executable.

## Safe workflow contract

- Use one irreversible commit per write item, followed by an expect proving that specific item's result. A click, key press or file upload that auto-submits may be the commit. Only verification, waiting and receipt downloads may follow it. Declare `readOnly: true` for read-only batches.
- Keep setup repeatable and free of irreversible changes. Prefer goto at the beginning of each item so a partly filled form can be rebuilt. Autosave counts as a write; split operations with several irreversible effects into separate workflows.
- Deduplication uses workflow name + `items.scope` + business key. Set scope from destination/account/operation params, never the CSV filename. Include a period in the key for recurring operations. Different data under a completed key is blocked rather than silently skipped.
- The whole input is validated before processing. Duplicate/empty keys, missing referenced values and malformed headers are rejected. Rows are frozen in the journal; changing the source file does not alter a resumed batch.
- A recorded first submission already changed the site. After saving its workflow, call MCP `run_adopt` with the exact full row and evidence note. This runs only confirmation steps and journals the row so replay skips it. Do not replay it before adopting or resolving it.
- Resolving done confirms the effect exists. Resolving failed confirms it did not occur and enables retry. Every decision requires an evidence note and is logged. For a duplicate-held item, resolve its original run first.
- One operation controls the browser at a time. Concurrent CLI/MCP attempts return a busy error; leases from dead processes are recovered automatically.

The journal protects actions executed through this Ritoko installation. It cannot prevent independent submissions, guarantee that a website is idempotent, or infer success from a generic message. Workflows need business checks specific to the site. Legacy runs without a frozen definition resume only if their workflow version still matches; otherwise inspect their outcomes first.

Document reading is optional. `document_image` sends a downloaded JPEG/PNG to the client agent, which can read it with its current model. Ritoko includes no local OCR engine or invoice parser. For a chosen external OCR service, the agent uses that service with credentials configured by the user. Image extraction requires the agent or that service for each new document; browser-only replay remains deterministic.

## Scope

Ritoko automates sites you are allowed to automate. It does not bypass CAPTCHAs or anti-bot protections, and it stops for logins and MFA so you complete them yourself.

## Development

```bash
pnpm install
pnpm check   # biome + tsc
pnpm test
pnpm test:e2e # real Chrome, local server, isolated profiles and a killed CLI process
pnpm build
```

MIT © Swih
