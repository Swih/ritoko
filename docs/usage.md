# Advanced usage and reliability

This guide covers the configuration and recovery details behind the [Ritoko README](../README.md). Start with the README for installation, use cases and a first workflow. The [agent skill](../skills/ritoko/SKILL.md) describes the agent's operating rules, and the [integration reference](../skills/ritoko/reference.md) gives step shapes and limits.

## Execution and recovery

1. **Record.** Your agent does the task once. The Chrome recorder computes selectors for each action, each verified to match only that element, best first: role and accessible name, label, placeholder, test id, an XPath anchored on a nearby label, visible text. Only when none of these is unique does it fall back to adjacent text, a `name` or `id` attribute, or the position inside a uniquely identified container; a bare positional CSS path is the last resort and is flagged `fragile` for the agent to replace. Existing API and MCP operations can instead be written directly as steps.
2. **Save.** The agent turns the recording into a workflow: parameters, a batch source (Excel/CSV), a business key per item, a `commit` step, and `expect` checks.
3. **Replay.** Ritoko executes without a model and journals every item in SQLite. Each run keeps its workflow definition and input rows.
4. **Repair.** If a selector changed, the run pauses with the page left open. Before submission, the form restarts in full. After submission, only verification resumes on the same document; otherwise the item is held for review. A missing verification target pauses only the run's first submitted item, once. Any other miss after submission, or expected text absent from the page (such as an error page), holds the item for review and the batch continues.

A step whose primary selector no longer matches can still match one of its recorded fallbacks, which must also match exactly one element; later rows then start from that fallback. The direct runner journals a `fallback` event the first time each step of a run matches this way, and the report lists these steps under `fallbacks`. On the commit step this is also a run warning, and the message of each row submitted through the fallback says so: check that it is the intended submit control. Host mode does not report fallbacks yet.

| Status | Meaning |
|---|---|
| `done` | Verified by the workflow's `expect` steps |
| `failed` | Failure before submission, safe to retry with resume; conflicting data is blocked |
| `review` | Submission may have happened; check on the site — blocked across future runs, including repeat |
| `skipped` | Already confirmed under the same workflow, scope and key; no new submission |

A run is `done` only when all items are confirmed or skipped and its final checks passed. `partial` means some items failed or need review; `stopped` means execution could not continue. The CLI returns exit code 2 for these outcomes and for repair pauses.

Results also carry `warnings` when something can make a run skip or misdirect rows: an empty `items.scope` (see [Safe workflow contract](#safe-workflow-contract)) or a commit step matched through a fallback selector. The CLI prints them under its summary line; MCP results include them.

## Resolving a review item

A `review` item may or may not have reached the destination, and Ritoko does not guess. Resolve it only after someone looked at the business record at the destination:

- `done`: the record exists. The item counts as submitted and later runs skip its key; if the record does not exist after all, it is never submitted.
- `failed`: the record does not exist. The next resume (`run_resume`, or `host_next` for a host run), or a new run with the same key, submits the row again; if the record does exist, that creates a duplicate.

Both outcomes need an evidence note and an explicit confirmation that the destination was checked: `confirmChecked: true` in MCP `run_resolve`, `--confirm-checked` on the command line. Without it the call is refused and nothing changes. An agent asks the user to check and never sets the confirmation on its own.

```bash
node bin/ritoko.mjs resolve <runId> <key> done --note "Order 1042 found in the back office" --confirm-checked
```

Ritoko cannot see that check, so it records the resolution as unverified: the item message starts with `Manually resolved (unverified):`, the report item carries `resolution: {by: "manual", verified: false, note}`, the run counts `manualResolutions`, and the journal keeps a `resolve` event with the key, outcome, note and time. A `failed` item that is then submitted again and verified by the workflow has the workflow's status again; its `resolve` event stays in the journal. A duplicate-held item is resolved in its original run first.

## Destination lookup: ensure and reconcile

An optional workflow `ensure` checks the destination before running an eligible item's steps. It marks an existing matching record done with `resolution: {by: "ensure", verified: true, note}`. It permits submission only when the declared absence predicate matches. Existing journal duplicate and uncertainty barriers still apply; `repeat` does not bypass the destination check.

```json
{
  "ensure": {
    "read": {
      "do": "http",
      "url": "{{param.base}}/orders/by-email",
      "query": {"email": "{{item.Email}}"},
      "headers": {"Authorization": "Bearer {{param.token}}"}
    },
    "present": {
      "status": [200],
      "json": {"/email": "{{item.Email}}", "/name": "{{item.Name}}", "/status": "paid"}
    },
    "absent": {"status": [404], "json": {"/error": "Order not found"}}
  }
}
```

This example is a workflow fragment: declare `base`, environment-backed secret `token`, `items.key`, `items.scope` and the normal commit/verification steps too. The endpoint must authoritatively look up the exact business key in that account. Match all relevant business fields, amount, state and operation period in `present.json`; mere success text is insufficient. Both predicates require nonempty JSON Pointer checks. The request and presence predicate must reference every item or param field used in the key. Each predicate's checks must all match, and exactly one predicate must match. Numbers and booleans compare as text, as in `expect.json`.

HTTP lookups support only direct GET with `session: "none"`. Omitted `status` means 2xx. Only explicitly listed 404/410 statuses can mean absence, and their JSON evidence must also match. Authentication errors, generic 404s, missing JSON fields, conflicting records, network errors and ambiguous results fail closed. Lookup reads reject redirects and are never automatically retried. The author must establish that an absence response is authoritative: eventually consistent searches cannot safely establish absence immediately after a timed-out write. Lookup plus submission is not an atomic transaction against outside writers; use destination uniqueness constraints or API idempotency too.

For MCP, use `read: {do: "mcp", server: "shop", tool: "lookup_order", readOnly: true, args: {email: "{{item.Email}}"}}` and omit status predicates. Choose a trusted tool whose documented behavior only reads; it must also advertise `readOnlyHint: true`. An annotation cannot prove its implementation is safe. Tool errors and requests for more input never establish absence.

To settle an original review or interrupted committed item, call MCP `run_reconcile {runId, key}` or:

```bash
node bin/ritoko.mjs reconcile <runId> <key>
```

Reconciliation runs only the lookup stored in that run's frozen workflow against its frozen row and params. It never runs setup, changes the saved workflow, reloads input or replays the submission. Presence becomes verified done; explicit absence becomes verified failed, eligible for a later authorized resume. Inconclusive results leave the item unchanged. Reports carry `resolution: {by: "reconcile", verified: true, note}`; journal lookup/resolve events keep the checked predicate paths, source, outcome and timestamp without response bodies or credentials. Cancelled runs remain cancelled. Duplicate-held rows must be reconciled in their original run first.

Lookups may use only item data and params, including environment-backed credentials reloaded at execution time. Saved variables and files, browser checks, browser-cookie HTTP, host runs and agent-managed MCP tools are unsupported and rejected. The explicit scope and lookup must exist before starting the run; an edited current workflow cannot retrofit reconciliation into an old frozen run. `run_adopt` also uses this lookup when configured, requiring presence. Without it, adoption requires verification after the commit; the skipped commit's own response check cannot verify a recording.

## Checking the installation: `ritoko doctor`

`node bin/ritoko.mjs doctor`, or the MCP tool `doctor`, checks the Node.js version (24 or newer), that `node:sqlite` and `playwright-core` load, that the Ritoko home is writable or can be created, the journal (`PRAGMA integrity_check`, and leases left by a process that exited or stopped responding), the `RITOKO_BROWSER` value and the Chrome executable. Each check is `pass`, `warn` or `fail`, with a one-line fix for the last two; `--json` prints `{ok, checks}`, as the MCP tool returns. The exit code is 1 when a check fails, otherwise 0. A missing Chrome executable is a warning with your own Chrome, which Ritoko attaches to rather than launches, and a failure when a separate Chrome must be launched (`RITOKO_BROWSER=clean`, headless runs).

The doctor starts no browser and opens the journal read-only. It does not create the home or the journal; it writes only a temporary folder, removed at once, to test that an existing home is writable, and reading the journal can leave SQLite's `ritoko.db-wal` and `ritoko.db-shm` side files, which Ritoko removes the next time it closes its journal. The `bin/ritoko.mjs` launcher itself stops on a Node.js older than 24 and installs missing dependencies before running any command, so through it the Node.js and dependency checks catch a damaged installation or a Node.js build without `node:sqlite`.

## Long-running tool calls

`run_start` returns when the whole batch is done and sends MCP progress notifications meanwhile. Codex's default tool timeout is 60 seconds. For longer batches, add the following to `~/.codex/config.toml`:

```toml
[plugins."ritoko@ritoko".mcp_servers.ritoko]
tool_timeout_sec = 1800
```

For a directly configured MCP server, set `tool_timeout_sec` under its `[mcp_servers.ritoko]` table instead. Restart the client after changing configuration. After a timeout or busy response, read the report before taking further action; do not launch the same batch again.

## Use with other agents

Ritoko is a local stdio MCP server plus an Agent Skills folder. A client needs access to that local process and run files. An isolated cloud client cannot reach them by itself. The direct runner controls local Chrome; host mode lets a compatible local agent execute browser actions or already connected MCP tools. Only Claude Code and Codex CLI are tested as plugin clients; the formats below have not been run. Two ways to point a client at the server:

- Local clone (works today): `git clone https://github.com/Swih/ritoko`, then run `node /absolute/path/to/ritoko/bin/ritoko.mjs mcp`. The first start installs dependencies once.
- npm installation: `npx --yes --prefer-online ritoko@latest mcp`. This starts the latest published release, which may differ from the current Git revision. The package ships compiled JavaScript and needs no build step. Pin an existing published version for repeatable runs; 0.1.0 was verified on npm when these instructions were updated.

Generic MCP client (Cursor `~/.cursor/mcp.json`, VS Code `.vscode/mcp.json` with `servers` instead of `mcpServers`, Gemini CLI `~/.gemini/settings.json`, Claude Desktop `claude_desktop_config.json`). Not tested yet:

Local clone:

```json
{
  "mcpServers": {
    "ritoko": {
      "command": "node",
      "args": ["/absolute/path/to/ritoko/bin/ritoko.mjs", "mcp"]
    }
  }
}
```

Published npm release:

```json
{
  "mcpServers": {
    "ritoko": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "ritoko@latest", "mcp"]
    }
  }
}
```

For VS Code, use `"servers"` as the top-level key instead of `"mcpServers"`. Use only the configuration appropriate to your client.

Also give the agent the skill ([`skills/ritoko/SKILL.md`](../skills/ritoko/SKILL.md)) when the client supports skills; without it the tools still work but the agent lacks the recording and safety rules. Clients with a tool-call timeout (Codex stops at 60 s) need it raised for long batches.

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

## CLI and browser selection

From a Git checkout, without an agent:

```bash
node bin/ritoko.mjs import examples/rpa-challenge.json
node bin/ritoko.mjs run rpa-challenge
node bin/ritoko.mjs report
node bin/ritoko.mjs resume <runId>
node bin/ritoko.mjs resolve <runId> <key> done --note "Matched the record on the site" --confirm-checked
node bin/ritoko.mjs reconcile <runId> <key>
node bin/ritoko.mjs cancel <runId>
node bin/ritoko.mjs doctor
node bin/ritoko.mjs browser-close
```

Workflows and runs live in `~/.ritoko` (override with `RITOKO_HOME`). Choose a browser that the user has authorized. Prefer the agent's integrated browser when its tools permit the required operations. Host browser replay requires page-script execution; **the current Codex computer-use `evaluate` is read-only and cannot run these programs**. Check the client's capabilities before choosing host browser mode.

The direct browser runner connects to the user's Chrome by default, after remote debugging is enabled at `chrome://inspect/#remote-debugging` and the user allows the connection. It uses its own tab and never silently launches another browser when connection fails. Use it when the user chose personal Chrome. `RITOKO_BROWSER=clean` explicitly selects a separate persistent profile without personal logins; headless runs and explicit test profiles also use an isolated profile. Closing the client disconnects without closing Chrome; `browser-close` shuts down a dedicated Chrome and disconnects from personal Chrome, leaving its tabs open. Set `RITOKO_CHROME_PATH` for a nonstandard executable.

**Trust boundary.** Local processes with access to an enabled CDP endpoint can control the connected browser. Personal Chrome includes personal sessions; a dedicated profile keeps that boundary separate. Workflows and API/MCP commands are executable configuration and need a trusted author. Private run files and downloaded business data belong in the user's local home, outside the repository.

`--repeat` explicitly requests replay of previously confirmed items, including when their data changed. It does not bypass review holds. Use it only when repeating the business action is intentional. For host runs, use `host_next` rather than direct `resume`.

The CLI's `<runId>` and `<key>` are placeholders. `resolve ... done` records that the effect exists; `resolve ... failed` records that it did not occur, and the next resume submits the row again. Both need an evidence note and `--confirm-checked` once the record was checked at the destination (see [Resolving a review item](#resolving-a-review-item)). See [update policies](release.md#maintaining-distributed-versions) when switching Git, npm or client-managed versions.

## Host batches and mixed workflows

`host_start {workflow, params, parallel: 1}` returns `{runId, batch, actions, note}`. `parallel` accepts 1–4, with one tab per slot. Execute actions once in their order, then call `host_next` with the same batch number:

- `navigate`: open the supplied URL in the slot's tab. A short-lived loopback page carries the plan in a URL fragment.
- `run_js`: execute the supplied program only through a browser tool that permits page-script execution. Preserve its raw JSON result.
- `click`: make the real click on the page's Ritoko shield to transfer a staged download. Downloads use the clipboard one at a time; Ritoko restores and checks the previous text.
- `tool`: invoke the already connected MCP server/tool with the exact arguments and return `{actionId, result: <raw MCP result>}`, including `isError`, `content` and `structuredContent`.

`results` has one entry per `run_js` or `tool`, in action order, and none for navigation or clicks. On interruption, include only known results and the number of fully completed actions. Never run an issued batch twice. Missing results after a commit are uncertain and become `review`.

Node executes direct `http` and `mcp` steps between browser segments. `save` feeds `{{vars.name}}` into later steps; files and aliases are kept per row, including parallel downloads. `{ref: "agent"}` reuses an existing tool connection, without starting or stopping that server. Agent tool arguments and browser plans cannot contain runtime credentials. API-only host batches need no browser, even in clients with read-only browser evaluation.

Reports identify `driver: "host" | "direct"`. Resume a host run with `host_next`, and a direct run with `run_resume`. A terminal host run retries safe failures only on an explicit `host_next` without results. Resolve uncertain writes with evidence first. Done rows stay done, including when a different run was previously held by their uncertain outcome.

Prefer the persistent MCP server for mixed workflows: it retains direct MCP connections and runtime credentials between host batches until the run ends or the server disconnects. Each CLI `host next` is a new process; secret values acquired earlier are not persisted and cannot survive that boundary.

Host mode currently requires `items` and an item-only workflow. Setup, teardown, iframes, keyboard `press`, table `extract`, hash-route navigation and HTTP `session: "browser"` are unsupported. Browser uploads are limited to 1.35 MB per file and a 1.9 MB encoded plan; downloads are limited to 200 MiB. Native browser download dialogs and sites that remove the plan fragment require another supported driver. Host replay and the Chrome recorder remain separate paths.

## Proposing an API from a recording

Opt in with `browser_act {captureNetwork: true}` and read `recording {network: true}`. The recorder correlates fetch/XHR metadata with each action: method, origin, route pattern, response status and top-level query/body field names. It omits header values, query values and request/response bodies, and replaces likely dynamic or credential path segments with placeholders. Path redaction is heuristic; treat hints as local site data.

Hints do not become executable API steps automatically. Verify the endpoint, authentication, required fields and business result against the site's API contract. Test one authorized row, adopt any already submitted row, then save the replacement explicitly. Keep a browser version where needed; an API write with an uncertain outcome must never automatically fall back to another submission.

## Safe workflow contract

- Use one irreversible commit per write item, followed by an expect proving that specific item's result. A click, key press, file upload, select or checkbox that auto-submits may be the commit. Only verification, waiting, receipt downloads and extracts may follow it. Declare `readOnly: true` for read-only batches.
- JS alert/confirm/prompt dialogs are never answered silently. Set `onDialog` (`accept` or `dismiss`, plus `dialogText` for a prompt) on the click or press that opens one; any other dialog is dismissed and fails its step.
- `extract` (read-only) saves a `<table>` or ARIA table/grid as UTF-8 CSV in the run directory, usable as `{{files.<saveAs>}}` (e.g. as `items.from`) and listed in the report's `files`. Other list layouts are not supported.
- `download` and `extract` `saveAs` may be a template (`"{{item.Slug}}.mp4"`) so each row gets a clean name in the run directory. The rendered name is sanitized (directories, reserved characters, Windows device names, trailing dots and spaces, length cap 120 characters), a name without extension keeps the real file's extension, and a taken name is never overwritten: it becomes `name (2).ext`. A templated name is keyed in `files` by the saved file's own name (so the report lists every row's file), and `{{files.<step id>}}` is the current row's file in later steps. A literal `saveAs` stays `{{files.<saveAs>}}`, as before.
- `http` and `mcp` steps call an API or an MCP tool with the same journal, commit and resume rules; a workflow made only of them never opens Chrome. HTTP supports headers, encoded query values, JSON/form/text bodies, status/JSON checks, saved variables, response files, stable idempotency keys and optional Ritoko browser cookies. Only GET/HEAD before the commit retry transient failures, up to three times within one deadline. Writes must be the item's commit; setup and teardown integrations only read. Redirects never carry headers to another origin, and item data or saved variables cannot choose a URL's authority.
- MCP servers may be a command, a Streamable HTTP URL, `{ref: "claude"}` for Claude Code's local/project/user configuration, or `{ref: "agent"}` for a tool the host agent calls through its existing connection. Agent references require host mode. Direct clients use the v1 SDK and its legacy protocol versions through 2025-11-25; a server requiring only the 2026-07-28 protocol is unsupported. `readOnly: true` is an author assertion; a conflicting server annotation is rejected, and an annotation alone never proves that replay is safe. Calls are never automatically retried; tool errors (`isError`), input requests, protocol errors and timeouts fail the step. A failed commit remains in `review`.
- `save` feeds later steps as `{{vars.name}}`. Ordinary variables are journaled; credential-like result fields and values matching known secrets stay in memory and must be acquired again after restart. Secret params come from environment variables. Agent-managed arguments cannot reference secrets. HTTP failure messages omit response bodies; journal events contain compact metadata. Saved files contain their original bytes and may contain sensitive business data. See the [integration reference](../skills/ritoko/reference.md) for shapes and limits.
- `wait`, `expect` and `download` accept `timeoutMs` up to 900000 (15 min) for slow generations; other steps stay capped at 120000. Progress notifications are sent at least every 15 s, even inside one long item.
- Keep setup repeatable and free of irreversible changes. Prefer goto at the beginning of each item so a partly filled form can be rebuilt. Autosave counts as a write; split operations with several irreversible effects into separate workflows.
- Deduplication uses workflow name + `items.scope` + business key. Set scope from destination/account/operation params, never the CSV filename. Include a period in the key for recurring operations. Without an explicit repeat request, different data under a completed key is blocked rather than silently skipped.
- An empty scope, or one whose params render empty, shares its keys with every scope of the workflow: a key completed for one destination or account is skipped for another instead of submitted, in both directions. `workflow_save` warns when `items.scope` is empty, and every result of a run with an empty scope carries the same warning.
- Input is .xlsx, or .csv in UTF-8 or else Windows-1252 (Excel's classic CSV export), separated by `,` or `;`. Excel number formats are not applied (`07001` reads as `7001`, `15%` as `0.15`): format identifier columns as Text. Hidden and filtered-out rows are read too. Formulas use the result Excel saved; a referenced cell holding a formula error or no saved result is rejected as empty. Never store credentials in a workflow: declare a secret param, read from an environment variable at run time and never stored in the workflow or journal.
- File paths from item data (`upload` of `{{item.File}}`) must stay inside the input file's folder, or the run folder for a downloaded or extracted input; `goto` opens only http(s) URLs. Agents pass absolute paths; the CLI resolves relative ones against its working directory.
- The whole input is validated before processing. Duplicate/empty keys, missing referenced values and malformed headers are rejected. Rows are frozen in the journal; changing the source file does not alter a resumed batch.
- A recorded first submission already changed the site. After saving its workflow, call MCP `run_adopt` with the exact full row and evidence note. This runs only confirmation steps and journals the row so replay skips it. Do not replay it before adopting or resolving it.
- Manual resolution records the user's destination check with an evidence note and explicit confirmation, and is logged as unverified (see [Resolving a review item](#resolving-a-review-item)). A configured destination lookup can instead verify an outcome with `run_reconcile` (see [ensure and reconcile](#destination-lookup-ensure-and-reconcile)). Done means the effect exists; failed permits another submission on resume. For a duplicate-held item, settle its original run first.
- One operation controls the browser at a time. Concurrent CLI/MCP attempts get a busy error naming the active run; a lease left by a process that died or stopped responding is recovered automatically. Read-only reports and page snapshots work during a run.

The journal protects actions executed through this Ritoko installation. It cannot prevent independent submissions, guarantee that a website is idempotent, or infer success from a generic message. Workflows need business checks specific to the site. Legacy runs without a frozen definition resume only if their workflow version still matches; otherwise inspect their outcomes first.

Document reading is optional. `document_image` sends a downloaded JPEG/PNG to the client agent, which can read it with its current model. Ritoko includes no local OCR engine or invoice parser. For a chosen external OCR service, the agent uses that service with credentials configured by the user. Image extraction requires the agent or that service for each new document; browser-only replay remains deterministic.

## Scope

Ritoko automates sites you are allowed to automate. It does not bypass CAPTCHAs or anti-bot protections. It does not detect logins itself: while recording, the agent asks you to complete login or MFA in the selected browser; during direct browser replay, a login page where the form was expected pauses the run as `needs_repair`.

## Validation and support

See [release gates and the validation roadmap](release.md) for required tests and the scope of the available evidence. Report reproducible issues through [GitHub Issues](https://github.com/Swih/ritoko/issues), with client and environment versions and redacted workflow/input data.
