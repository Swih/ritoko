---
name: ritoko
description: Turn a browser task done once into a reusable, verified, resumable procedure, then rerun it with new data (Excel/CSV) without an LLM. Use when the user wants to automate a repetitive web task, fill a web form from a spreadsheet, export or download something from a site regularly, "do it like last time", rerun or resume a saved browser workflow, or repair one that broke.
---

# Ritoko

Ritoko drives its own Chrome window (dedicated profile: logins persist). You record a task once with the `browser_*` tools, save it as a workflow, and Ritoko replays it deterministically, item by item, with a journal that survives crashes.

## Rerun a saved workflow

1. `workflow_list`, pick the matching workflow, `workflow_get` to see its params. Ask the user for missing params.
2. `run_start`. Report the counts, then each failed or review item with its message and evidence file.
3. On `needs_repair`, go to **Repair**.

Items already confirmed in the same workflow/scope are skipped. Unknown outcomes are blocked even with `repeat: true`. Only use repeat when the user explicitly requests another confirmed execution (practice sites, read-only exports).

## Record a new workflow

1. Check the site allows automation. On a login, MFA or CAPTCHA, ask the user to complete it in the Ritoko window. Never type their passwords. Never store credentials in a workflow: a credential the workflow must type goes in a param such as `{{param.password}}`, supplied at run time.
2. `browser_open` the start URL and read the snapshot.
3. Do the task once, for real, with `browser_act`, batching actions in one call. Use the first data row as values.
   Use `"do": "hover"` to open hover menus. When an action opens a JS alert/confirm/prompt, it fails: repeat it with `"dialog": "accept"` or `"dismiss"` (prompt text in `value`) only if the user intends that answer.
   Check the returned selectors: role, label or visible text are robust. An id or name made of random letters is generated: use `inspect`, or write an XPath anchored on visible text instead. Unlabeled controls get an XPath anchored on adjacent text or on their position in a container with an id. `"fragile": true` means only a positional CSS path was found: replace it by hand when you can. Elements inside an iframe get `target.frame`, the iframe's selector; their selectors apply inside it.
   Links and forms that target a new tab open in Ritoko's single working tab, when recording and replaying, so the next steps act on the opened page. Script popups (`window.open`) are not followed: `goto` their URL instead.
4. Confirm success on the page: confirmation message, new row, downloaded file.
5. Call `recording`, then write the workflow:
   - `setup`: repeatable preparation, free of irreversible business changes. It runs again after a crash.
   - `items`: `{ "from": "{{param.input}}" or "{{files.<saveAs>}}", "key": "{{item.<unique column>}}", "scope": "{{param.account}}" }`. Scope identifies the destination/account/operation, never the input filename. Include a period in the key for recurring operations. Columns are header names, trimmed. A CSV is read as UTF-8, or as Windows-1252 (Excel's classic CSV export) when it is not valid UTF-8. Excel dates become `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SS` when they have a time.
   - Step `id`s are optional: missing ones become `s1`, `s2`…
   - `item`: begin with a goto for independent forms. Replace literal values with `{{item.Column}}`. Mark exactly one submission step `"commit": true`, followed by `expect` proving that specific row's success. The commit may be click, press or upload when file selection auto-submits. Only expect, wait, receipt downloads or extracts may follow it. Declare `readOnly: true` for read-only batches. Autosave counts as a write; split workflows with multiple irreversible effects.
   - `teardown`: final checks.
   - `params` for anything that changes between runs (period, file path).
   - A kebab-case `name` and a clear `description`: it is how the workflow is found later.
6. `workflow_save`, and fix the warnings it returns.
7. If the recorded task submitted a real row, call `run_adopt` with the workflow, params, exact full row and evidence note. It verifies without submitting and journals that row. Do this before replaying its CSV. A failed adoption check holds it for review.
8. Prove it: `run_start` and show the report and duration.

## Extract a table to CSV

To pull data from a back-office, write by hand `{ "id": "export", "do": "extract", "target": <the table>, "saveAs": "customers.csv" }`, with the table's role/name from the snapshot. It reads an HTML `<table>` or a `role=table/grid/treegrid` element (not other list layouts) and writes UTF-8 CSV: header from `<thead>`/header cells or the first row (stacked headers joined, blank ones named `Column N`), hidden rows and `<tfoot>` skipped, cell text trimmed. Only rendered rows of the current page are read: wait or expect for the data first; pagination is not followed. The file appears in the report's `files` and as `{{files.customers.csv}}`, e.g. in `items.from` when extracting in setup and processing each row. It is read-only, so it may follow a commit.

## Repair

`needs_repair` returns the failing step and a snapshot of the page, left as is.
1. `browser_act` with `"do": "inspect"` on the right element to get verified selectors.
2. `step_repair` with the returned `runId`, workflow, step ID and new target (keep a fallback). It changes that frozen run's target, never its action order or submission boundary.
3. `run_resume`. Do not restart the run: done items stay done.

Before commit, resume rebuilds the form from its first step. After commit, only verification may resume on the same live document. If the document was lost or reloaded, the item becomes review. Only the run's first submitted item pauses for a missing verification target, and only once (if the page shows an error, resume without repair: it goes to review); every later miss, or expected text absent from the page, goes to review while the batch continues. Never use browser actions to submit a paused committed item again.

For review, inspect the site's business record. Use `run_resolve` only when the result is established: `done` if the effect exists, `failed` if it definitely did not occur. Supply an evidence note. If the result remains unclear, leave review unchanged. For a duplicate-held row, resolve its original run first.

## Optional document reading

Most workflows need no OCR. When images must be read, use `document_image` with the path returned by a download. Read and verify the image using your client's current model; do not install local OCR tools or add a site-specific invoice parser to Ritoko. If the user prefers an external OCR API, ask which provider and use credentials already configured for that provider, or have the user configure them securely. Do not ask for an API key when client vision is sufficient. Each new image needs agent/service extraction; do not describe this phase as model-free replay. Verify extracted dates, identifiers and amounts before submitting their CSV.

## Statuses

- `done`
- `failed`: failed before submission; resume can retry safely. Conflicting data under a completed key is also blocked as failed with cause duplicate.
- `review`: submission may have happened, including when confirmation fails. Check on the site; never rerun it blindly.
- `skipped`: done by a previous run.
- `paused`: waiting for a repair.

Run `done` means every item is confirmed or skipped and final checks passed. `partial` and `stopped` must not be presented as success. Explain outstanding rows and the next action needed.
