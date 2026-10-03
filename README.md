# Ritoko

**Turn a browser task your agent solved once into a reusable procedure.** Rerun it with new data, verify each item, and resume after interruption. Uncertain submissions are held for review and never automatically submitted again.

Works with **Claude Code** and **Codex CLI** (plugin = skill + local MCP server), and with any local MCP client (see [Use with other agents](#use-with-other-agents)).

## How it works

1. **Record.** Your agent does the task once in Ritoko's Chrome window. Ritoko computes selectors for each action, each verified to match only that element, best first: role and accessible name, label, placeholder, test id, an XPath anchored on a nearby label, visible text. Only when none of these is unique does it fall back to adjacent text, a `name` or `id` attribute, or the position inside a uniquely identified container; a bare positional CSS path is the last resort and is flagged `fragile` for the agent to replace.
2. **Save.** The agent turns the recording into a workflow: parameters, a batch source (Excel/CSV), a business key per item, a `commit` step, and `expect` checks.
3. **Replay.** Ritoko executes without a model and journals every item in SQLite. Each run keeps its workflow definition and input rows.
4. **Repair.** If a selector changed, the run pauses with the page left open. Before submission, the form restarts in full. After submission, only verification resumes on the same document; otherwise the item is held for review. A missing verification target pauses only the run's first submitted item, once. Any other miss after submission, or expected text absent from the page (such as an error page), holds the item for review and the batch continues.

| Status | Meaning |
|---|---|
| `done` | Verified by the workflow's `expect` steps |
| `failed` | Failure before submission, safe to retry with resume; conflicting data is blocked |
| `review` | Submission may have happened; check on the site — blocked across future runs, including repeat |
| `skipped` | Already done by a previous run (no double submission) |

A run is `done` only when all items are confirmed or skipped and its final checks passed. `partial` means some items failed or need review; `stopped` means execution could not continue. The CLI returns exit code 2 for these outcomes and for repair pauses.

## Install

Requires Node 24+ and Google Chrome. Claude Code:

```bash
claude plugin marketplace add Swih/ritoko
claude plugin install ritoko@ritoko
```

Codex CLI:

```bash
codex plugin marketplace add Swih/ritoko
codex plugin add ritoko@ritoko
```

Restart the client after installing or updating. The plugin uses a Node launcher, with no npx process or published npm release. On first start it installs its runtime dependencies once (about 6 s and 43 MB), with npm lifecycle scripts disabled and the exact versions pinned in `package-lock.json`. To try a local checkout, use `.` instead of `Swih/ritoko`.

Used on Windows 11. CI runs the unit tests and the real-Chrome end-to-end tests on Windows, Linux and macOS.

`run_start` returns when the whole batch is done and sends MCP progress notifications meanwhile. Codex stops a tool call after 60 s by default: for long batches or generations lasting minutes, add `tool_timeout_sec = 1800` under `[plugins."ritoko@ritoko".mcp_servers.ritoko]` in `~/.codex/config.toml`.

## Use with other agents

Ritoko is a stdio MCP server plus an Agent Skills folder, so any agent that runs on your machine can use it. Cloud agents (ChatGPT, Meta Muse) are out of scope: Ritoko drives your local Chrome. Only Claude Code and Codex CLI are tested; the rest below follow each vendor's documented format but have not been run. Two ways to point a client at the server:

- Local clone (works today): `git clone https://github.com/Swih/ritoko`, then run `node /absolute/path/to/ritoko/bin/ritoko.mjs mcp`. The first start installs dependencies once.
- npm (works once a release is published): `npx -y ritoko mcp`. The package ships compiled JavaScript and needs no install step.

Generic MCP client (Cursor `~/.cursor/mcp.json`, VS Code `.vscode/mcp.json` with `servers` instead of `mcpServers`, Gemini CLI `~/.gemini/settings.json`, Claude Desktop `claude_desktop_config.json`). Not tested yet:

```json
{ "mcpServers": { "ritoko": { "command": "node", "args": ["/absolute/path/to/ritoko/bin/ritoko.mjs", "mcp"] } } }
{ "mcpServers": { "ritoko": { "command": "npx", "args": ["-y", "ritoko", "mcp"] } } }
```

Also give the agent the skill (`skills/ritoko/SKILL.md`) when the client supports skills; without it the tools still work but the agent lacks the recording and safety rules. Clients with a tool-call timeout (Codex stops at 60 s) need it raised for long batches.

**Kimi Code CLI** (not tested yet; the repo has a `kimi.plugin.json`). Inside Kimi: `/plugins install https://github.com/Swih/ritoko`, then `/plugins reload`.

**OpenClaw** (not tested yet). Register the server and the skill folder:

```bash
openclaw mcp add ritoko --command node --arg /absolute/path/to/ritoko/bin/ritoko.mjs --arg mcp
openclaw mcp doctor ritoko --probe
```

then add `/absolute/path/to/ritoko/skills` to `skills.load.extraDirs` in your OpenClaw config, or copy `skills/ritoko` into `<workspace>/skills`. Not published to ClawHub.

**Hermes Agent** (not tested yet). In `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  ritoko:
    command: "node"
    args: ["/absolute/path/to/ritoko/bin/ritoko.mjs", "mcp"]
    timeout: 1800
skills:
  external_dirs:
    - /absolute/path/to/ritoko/skills
```

## Use

Ask your agent:

- "Record this task with Ritoko: download the September report from …"
- "Rerun the `supplier-onboarding` workflow with `suppliers.csv`"
- "Resume my last Ritoko run"
- "How did the last run go?"

Or from a terminal, without any agent:

```bash
node bin/ritoko.mjs import examples/rpa-challenge.json
node bin/ritoko.mjs run rpa-challenge --repeat
node bin/ritoko.mjs report
node bin/ritoko.mjs resume <runId>
node bin/ritoko.mjs resolve <runId> <key> done --note "Matched the record on the site"
node bin/ritoko.mjs cancel <runId>
node bin/ritoko.mjs browser-close
```

Workflows, runs and the browser profile live in `~/.ritoko` (override with `RITOKO_HOME`), created readable by your user only. Chrome uses a dedicated profile and a local CDP endpoint shared by CLI and MCP. Exiting a client disconnects it and leaves Chrome running, so logins and page state persist for the next client; `browser-close` closes it explicitly. Chrome reopens with its previous session ("continue where you left off"), so logins persist, session cookies included; Ritoko then keeps a single working tab. Chrome writes cookies to disk within about 30 seconds: a login is lost if Chrome is killed right after it, rather than closed. Set `RITOKO_CHROME_PATH` for a nonstandard executable.

**Trust boundary.** While Ritoko's Chrome is open, its CDP endpoint on 127.0.0.1 is unauthenticated: any local process running as your user can drive that Chrome and read the cookies of the Ritoko profile. That is the same trust level as your user account, but on a shared or untrusted machine run `ritoko browser-close` when you are done, and do not sign the Ritoko profile in to accounts that other local software must not reach.

## Safe workflow contract

- Use one irreversible commit per write item, followed by an expect proving that specific item's result. A click, key press, file upload, select or checkbox that auto-submits may be the commit. Only verification, waiting, receipt downloads and extracts may follow it. Declare `readOnly: true` for read-only batches.
- JS alert/confirm/prompt dialogs are never answered silently. Set `onDialog` (`accept` or `dismiss`, plus `dialogText` for a prompt) on the click or press that opens one; any other dialog is dismissed and fails its step.
- `extract` (read-only) saves a `<table>` or ARIA table/grid as UTF-8 CSV in the run directory, usable as `{{files.<saveAs>}}` (e.g. as `items.from`) and listed in the report's `files`. Other list layouts are not supported.
- `download` and `extract` `saveAs` may be a template (`"{{item.Slug}}.mp4"`) so each row gets a clean name in the run directory. The rendered name is sanitized (directories, reserved characters, Windows device names, trailing dots and spaces, length cap 120 characters), a name without extension keeps the real file's extension, and a taken name is never overwritten: it becomes `name (2).ext`. A templated name is keyed in `files` by the saved file's own name (so the report lists every row's file), and `{{files.<step id>}}` is the current row's file in later steps. A literal `saveAs` stays `{{files.<saveAs>}}`, as before.
- `wait`, `expect` and `download` accept `timeoutMs` up to 900000 (15 min) for slow generations; other steps stay capped at 120000. Progress notifications are sent at least every 15 s, even inside one long item.
- Keep setup repeatable and free of irreversible changes. Prefer goto at the beginning of each item so a partly filled form can be rebuilt. Autosave counts as a write; split operations with several irreversible effects into separate workflows.
- Deduplication uses workflow name + `items.scope` + business key. Set scope from destination/account/operation params, never the CSV filename. Include a period in the key for recurring operations. Different data under a completed key is blocked rather than silently skipped.
- Input is .xlsx, or .csv in UTF-8 or else Windows-1252 (Excel's classic CSV export), separated by `,` or `;`. Excel number formats are not applied (`07001` reads as `7001`, `15%` as `0.15`): format identifier columns as Text. Hidden and filtered-out rows are read too. Formulas use the result Excel saved; a referenced cell holding a formula error or no saved result is rejected as empty. Never store credentials in a workflow: declare a secret param, read from an environment variable at run time and never stored in the workflow or journal.
- File paths from item data (`upload` of `{{item.File}}`) must stay inside the input file's folder, or the run folder for a downloaded or extracted input; `goto` opens only http(s) URLs. Agents pass absolute paths; the CLI resolves relative ones against its working directory.
- The whole input is validated before processing. Duplicate/empty keys, missing referenced values and malformed headers are rejected. Rows are frozen in the journal; changing the source file does not alter a resumed batch.
- A recorded first submission already changed the site. After saving its workflow, call MCP `run_adopt` with the exact full row and evidence note. This runs only confirmation steps and journals the row so replay skips it. Do not replay it before adopting or resolving it.
- Resolving done confirms the effect exists. Resolving failed confirms it did not occur and enables retry. Every decision requires an evidence note and is logged. For a duplicate-held item, resolve its original run first.
- One operation controls the browser at a time. Concurrent CLI/MCP attempts get a busy error naming the active run; a lease left by a process that died or stopped responding is recovered automatically. Read-only reports and page snapshots work during a run.

The journal protects actions executed through this Ritoko installation. It cannot prevent independent submissions, guarantee that a website is idempotent, or infer success from a generic message. Workflows need business checks specific to the site. Legacy runs without a frozen definition resume only if their workflow version still matches; otherwise inspect their outcomes first.

Document reading is optional. `document_image` sends a downloaded JPEG/PNG to the client agent, which can read it with its current model. Ritoko includes no local OCR engine or invoice parser. For a chosen external OCR service, the agent uses that service with credentials configured by the user. Image extraction requires the agent or that service for each new document; browser-only replay remains deterministic.

## Scope

Ritoko automates sites you are allowed to automate. It does not bypass CAPTCHAs or anti-bot protections. It does not detect logins itself: while recording, the agent asks you to log in or complete MFA in the Ritoko window; during replay, a login page where the form was expected pauses the run as `needs_repair`.

## Development

```bash
pnpm install
pnpm check   # biome + tsc
pnpm test
pnpm test:e2e # real Chrome, local server, isolated profiles and a killed CLI process
```

## Credits

Built by [Swih](https://github.com/Swih) together with Claude (Anthropic) and Codex (OpenAI): both agents wrote, reviewed and audited code in this repository, and are credited as co-authors in its history.

MIT © Swih
