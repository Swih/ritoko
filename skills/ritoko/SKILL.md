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

1. Check the site allows automation. On a login, MFA or CAPTCHA, ask the user to complete it in the Ritoko window. Never type their passwords.
2. `browser_open` the start URL and read the snapshot.
3. Do the task once, for real, with `browser_act`, batching actions in one call. Use the first data row as values.
   Check the returned selectors: role, label or visible text are robust. An id or name made of random letters is generated: use `inspect`, or write an XPath anchored on visible text instead.
4. Confirm success on the page: confirmation message, new row, downloaded file.
5. Call `recording`, then write the workflow:
   - `setup`: repeatable preparation, free of irreversible business changes. It runs again after a crash.
   - `items`: `{ "from": "{{param.input}}" or "{{files.<saveAs>}}", "key": "{{item.<unique column>}}", "scope": "{{param.account}}" }`. Scope identifies the destination/account/operation, never the input filename. Include a period in the key for recurring operations. Columns are header names, trimmed.
   - `item`: begin with a goto for independent forms. Replace literal values with `{{item.Column}}`. Mark exactly one submission step `"commit": true`, followed by `expect` proving that specific row's success. The commit may be click, press or upload when file selection auto-submits. Only expect, wait or receipt downloads may follow it. Declare `readOnly: true` for read-only batches. Autosave counts as a write; split workflows with multiple irreversible effects.
   - `teardown`: final checks.
   - `params` for anything that changes between runs (period, file path).
   - A kebab-case `name` and a clear `description`: it is how the workflow is found later.
6. `workflow_save`, and fix the warnings it returns.
7. If the recorded task submitted a real row, call `run_adopt` with the workflow, params, exact full row and evidence note. It verifies without submitting and journals that row. Do this before replaying its CSV. A failed adoption check holds it for review.
8. Prove it: `run_start` and show the report and duration.

## Repair

`needs_repair` returns the failing step and a snapshot of the page, left as is.
1. `browser_act` with `"do": "inspect"` on the right element to get verified selectors.
2. `step_repair` with the returned `runId`, workflow, step ID and new target (keep a fallback). It changes that frozen run's target, never its action order or submission boundary.
3. `run_resume`. Do not restart the run: done items stay done.

Before commit, resume rebuilds the form from its first step. After commit, only verification may resume on the same live document. If the document was lost or reloaded, the item becomes review. Never use browser actions to submit a paused committed item again.

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
