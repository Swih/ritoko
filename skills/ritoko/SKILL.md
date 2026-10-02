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

Items already done by a previous run are skipped: no double submission. Pass `repeat: true` only when the user explicitly wants to redo them (practice sites, read-only exports).

## Record a new workflow

1. Check the site allows automation. On a login, MFA or CAPTCHA, ask the user to complete it in the Ritoko window. Never type their passwords.
2. `browser_open` the start URL and read the snapshot.
3. Do the task once, for real, with `browser_act`, batching actions in one call. Use the first data row as values.
   Check the returned selectors: role, label or visible text are robust. An id or name made of random letters is generated: use `inspect`, or write an XPath anchored on visible text instead.
4. Confirm success on the page: confirmation message, new row, downloaded file.
5. Call `recording`, then write the workflow:
   - `setup`: steps done once (goto, downloading the input file, start buttons).
   - `items`: `{ "from": "{{param.input}}" or "{{files.<saveAs>}}", "key": "{{item.<unique column>}}" }`. Columns are header names, trimmed.
   - `item`: steps per row. Replace literal values with `{{item.Column}}`. Mark the step that submits or creates something with `"commit": true`. Add an `expect` step proving success (text, value or url).
   - `teardown`: final checks.
   - `params` for anything that changes between runs (period, file path).
   - A kebab-case `name` and a clear `description`: it is how the workflow is found later.
6. `workflow_save`, and fix the warnings it returns.
7. Prove it: `run_start` and show the report and duration.

## Repair

`needs_repair` returns the failing step and a snapshot of the page, left as is.
1. `browser_act` with `"do": "inspect"` on the right element to get verified selectors.
2. `step_repair` with the new target (keep a fallback).
3. `run_resume`. Do not restart the run: done items stay done.

## Statuses

- `done`
- `failed`: cause `verification` or `system`.
- `review`: interrupted after its commit step, outcome unknown. Tell the user to check on the site; never rerun it blindly.
- `skipped`: done by a previous run.
- `paused`: waiting for a repair.
