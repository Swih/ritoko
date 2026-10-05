# Ritoko reference

## Input files

Columns are header names, trimmed. A CSV is read as UTF-8, or as Windows-1252 (Excel's classic CSV export) when it is not valid UTF-8, separated by `,` or `;`. Excel dates become `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SS` when they have a time. The whole input is validated before anything runs; rows are frozen in the journal.

## Extract a table to CSV

To pull data from a back office, write by hand `{"id": "export", "do": "extract", "target": <the table>, "saveAs": "customers.csv"}`, with the table's role/name from the snapshot. It reads an HTML `<table>` or a `role=table/grid/treegrid` element (not other list layouts) and writes UTF-8 CSV: header from `<thead>`/header cells or the first row (stacked headers joined, blank ones named `Column N`), hidden rows and `<tfoot>` skipped, cell text trimmed. Only rendered rows of the current page are read: wait or expect for the data first; pagination is not followed. The file appears in the run's `files` and as `{{files.customers.csv}}`, e.g. in `items.from` when extracting in setup and processing each row. It is read-only, so it may follow a commit.

## API and MCP steps

Direct `http` and `mcp` steps are sent by Ritoko itself, in order with the browser steps, journaled like them. `{ref: "agent"}` MCP servers require host mode and reuse the host agent's existing tool connection. A workflow without browser steps never opens Chrome. Every string is a template: `{{param.x}}`, `{{item.Column}}`, `{{vars.name}}`. A variable is a value kept by the `save` of an earlier step: the setup's are visible to every item, an item's own to its later steps only. Ordinary saved values are stored in the journal as text (objects as JSON). Credential-like JSON fields, variable names and pointers, and values matching known secrets, remain in memory only; setup must acquire them again after restart. Use environment-backed secret params for durable authentication. Do not save responses containing credentials as files: files preserve the original bytes.

```json
{"servers": {"shop": {"ref": "claude"}},
 "params": {"base": {"description": "API base URL"}, "token": {"secret": true, "env": "SHOP_TOKEN"}},
 "item": [
  {"id": "create", "do": "http", "method": "POST", "url": "{{param.base}}/orders",
   "headers": {"Authorization": "Bearer {{param.token}}"}, "body": {"json": {"email": "{{item.Email}}"}},
   "commit": true, "idempotencyKey": true, "expect": {"status": [201]}, "save": {"orderId": "/id"}},
  {"id": "check", "do": "mcp", "server": "shop", "tool": "get_order", "args": {"id": "{{vars.orderId}}"},
   "readOnly": true, "expect": {"json": {"/status": "paid"}}}]}
```

**http**: `method` (default GET), `url`, `headers`, `query` (appended, encoded), `body` as `{json}` (string leaves are templates, numbers stay as written: use `{text}` for a computed number), `{form}` or `{text}`. `expect.status` lists the accepted statuses (default: any 2xx); `expect.json` maps a JSON Pointer to the expected text (`/data/0/status`; numbers and booleans compare as their text). `save` maps a variable name to a pointer. `saveAs` writes the response body to the run folder like a download (sanitized, never overwriting, listed in the report's `files`). `idempotencyKey` sends `Idempotency-Key`, the same for the same workflow, scope, item and step. `session: "browser"` sends through Ritoko Chrome's own session (its cookies) and opens it. `timeoutMs` covers the whole exchange (default 30000, max 900000).
- Only GET and HEAD before the commit are sent again after a network error or a 408, 429, 502, 503 or 504 answer (at most 3 times, honoring Retry-After within the original deadline). Writes must be the item's commit, and setup/teardown integrations must only read. Nothing is automatically retried after the commit; a whole-exchange timeout ends the step.
- Redirects are followed by hand (5 at most). Headers go only to the same origin; another origin is followed for GET and HEAD only, without them.
- The host of a URL comes from the workflow or a param, never from `{{item.*}}` or `{{vars.*}}` (put those after the first `/`).

**mcp**: `server` (a key of `servers`), `tool`, `args` (string leaves are templates; direct clients convert top-level strings to numbers/booleans when the tool schema declares them and they parse cleanly: `"7"` becomes 7, `"007"` too). `servers` holds `{command, args?, env?, cwd?}` (started for the run, closed with it), `{url, headers?}` (Streamable HTTP), `{ref: "claude"}`, or `{ref: "agent"}`. Claude references read local scope under the working folder's entry in `~/.claude.json`, then the folder's `.mcp.json`, then user scope; `${VAR}` and `${VAR:-default}` come from the environment, and resolved configuration is never copied into the workflow. This supports static stdio and HTTP entries only; it does not reuse Claude's OAuth, dynamic header helpers, plugin connections, SSE, WebSocket or managed configuration. Agent references reuse tools already connected to the host agent and reject secret arguments. Strings in direct server declarations may only use `{{param.*}}`. Direct clients use the MCP v1 SDK; modern-only 2026-07-28 servers are unsupported. The result is `structuredContent`, else the first text block parsed as JSON, else `{"text": "..."}`; `expect.json` and `save` read it with pointers. `saveAs` keeps a file: the one at the pointer `file` (an absolute local path or an http(s) URL), else the first image, audio or embedded resource of the result, or its resource link (`file:` or http(s)). `readOnly: true` is the author's assertion that the tool only reads: it is allowed after the commit and in read-only workflows, unless the tool explicitly advertises `readOnlyHint: false`. Server annotations alone never make a write replayable. `timeoutMs` (default 60000, max 900000) is how long to wait for an answer or progress; all calls have a 15-minute hard limit, and connection/discovery requests have a 30-second limit.
- A tool error (`isError`), timeout, protocol error or request for more input fails the step. Calls are never retried. Timeout cancellation is best-effort: a remote business action may still finish. Direct runs close their client transports and child stdio processes when they return. Host runs keep their direct clients between batches until completion or owning-process shutdown; agent-owned connections are never closed by Ritoko. HTTP and MCP error bodies are omitted from the journal.

## Ensure and reconcile

Optional top-level `ensure` enables business lookup before an eligible direct-run item's actions:

```json
{"ensure": {
  "read": {"do": "http", "url": "{{param.base}}/orders/by-email", "query": {"email": "{{item.Email}}"}},
  "present": {"status": [200], "json": {"/email": "{{item.Email}}", "/name": "{{item.Name}}", "/status": "paid"}},
  "absent": {"status": [404], "json": {"/error": "Order not found"}}
}}
```

Choose an authoritative lookup for that exact business identity and destination/account/operation (`items.scope` is required). Presence must compare every field defining the intended result, including amount or period when relevant. Request and presence checks must bind every item or param field used in the key. Both JSON predicates must be nonempty; exactly one must match. Missing fields, mismatched records, authentication/network/tool errors and ambiguous results establish neither outcome. Omitted status means 2xx; only explicit 404/410 with matching JSON can mean absence. Do not rely on eventually consistent search to release an uncertain write. External writers can race lookup and submission; destination uniqueness/idempotency remains necessary.

Reads support direct HTTP GET (`session: "none"`) or direct MCP (`readOnly: true`, with the trusted tool also advertising `readOnlyHint: true`). An annotation is not proof of implementation behavior. No browser lookup, host mode, agent MCP refs, save/saveAs, expect, body, commit, idempotency key, saved variables or files are allowed in a lookup. Only frozen params/item references are supported. Credentials use environment-backed secret params and are loaded fresh. HTTP lookup redirects are refused; lookups do not automatically retry.

`run_reconcile {runId, key}` / CLI `reconcile <runId> <key>` runs the frozen lookup alone on the frozen row. It can settle original review and interrupted committed items: present → done, absent → failed for a later authorized resume. It does not run setup, reload CSV, submit, or reopen cancelled runs; inconclusive results leave the item unchanged. Duplicate-held items require the original run. Reports persist `{by: "reconcile", verified: true, note}`; existing records adopted by ensure use `by: "ensure"`. Lookup events preserve source, checked paths, outcome and time without bodies or secrets. Existing journal barriers still apply, and `repeat` does not bypass ensure. An old run without a lookup cannot acquire one by editing the saved workflow. `run_adopt` uses ensure when configured and requires presence; otherwise it requires an actual verification step after the skipped commit.

## Host limits and persistence

Host actions and raw-result reporting are described in [SKILL.md](SKILL.md#host-protocol). Host mode requires `items`, with no setup or teardown. It supports HTTP/MCP steps, navigation, fill, select, check, click, hover, upload, wait, expect and downloads, with 1–4 tabs. It rejects iframe targets, keyboard press, extract, hash-route navigation and HTTP `session: "browser"`. It requires a browser tool that permits page scripts for browser segments; current Codex computer-use evaluation is read-only. API-only and agent-managed MCP batches do not need browser scripts.

The loopback carry page lives for at most five minutes and carries the plan in the URL fragment; browser uploads have a 1.35 MB file limit and a 1.9 MB encoded fragment limit. Download handoffs are limited to 200 MiB and serialized through the clipboard. Sites that remove fragments or require native save dialogs are outside this driver. Runtime credentials acquired by an item survive pauses only in the same persistent process; they are excluded from SQLite and cannot survive a process restart. Environment-backed secret params are resolved again in Node. Never reference credentials in browser plans or agent-managed tool arguments.

`run_report` and `run_list` expose `driver: "direct" | "host"`. Resume with the matching driver. Host resume retries safe failed rows on a terminal run only when called without results, and rechecks rows held by another run after that original outcome was resolved. It preserves the frozen workflow and rows. Host mode does not offer repeat or selector repair yet.

**Safety**: the commit step may be an `http` or `mcp` step. Once it starts, an interrupted or failed item is `review`, never resent: the user checks the record, then `run_resolve` with `confirmChecked: true` once they confirmed that check (a `failed` resolution submits the row again on resume). Only reads may follow it. Secrets rendered into a request, a server or a message are masked everywhere Ritoko keeps something; the journal holds for each call one line (method, URL without its query, status, names of saved variables and files), never a body or a header.

## Optional document reading

Most workflows need no OCR. When images must be read, call `document_image` with a file from a run (its `runId` and the path relative to the run `dir`) or a `browser_act` download, and read it with your own model. Do not install local OCR tools or add a site-specific invoice parser to Ritoko. If the user prefers an external OCR API, ask which provider and use credentials already configured for it, or have the user configure them securely; do not ask for an API key when your own vision suffices. Each new image needs this extraction, so do not describe it as model-free replay. Verify extracted dates, identifiers and amounts before submitting their CSV.
