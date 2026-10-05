# Alternatives to Ritoko: verified facts

Retrieved 2026-10-05. Data and every source URL: [competitors.json](competitors.json).

Competitor facts come only from the vendor's own docs, README, LICENSE, pricing page or package registry, opened on that date. "Not found" means we read the pages listed in the JSON and did not see it. Ritoko facts cite this repository's code at commit `1daf6eb` (R1 to R8 below). Many vendor sites were blocked from this environment; where a vendor builds its docs site from its own GitHub repository, we read those source files instead (see [Coverage](#coverage)).

## Summary

| | Ritoko today (code) | Claude in Chrome | Playwright MCP | Playwright codegen | browser-use | workflow-use | Stagehand | Skyvern | taprun |
|---|---|---|---|---|---|---|---|---|---|
| Saved procedure replays without a model | Yes, direct runner only (R1) | Not documented | No: the LLM calls each tool; recording returns code | Yes: generated test code | Partly: `rerun_history` still uses an LLM for extract steps and the summary | Yes: `run_with_no_ai` | Yes: replay of an observed Action; server cache on Browserbase only | Yes: code caching (`run_with="code"`) | Yes: "$0 in tokens" |
| Page changed | Pauses for repair; new submit target needs confirmation (R2) | Model picks each step from screenshots | Left to the agent | `healer` agent in your AI tool | LLM decides every step | Falls back to browser-use (LLM) | `selfHeal`: re-infer, retry once | Agent fallback, cache regenerated automatically | `verify`, then re-capture with your AI key |
| Spreadsheet batch | CSV, XLSX (R3) | Prompt example only | Not found | CSV-driven test data | Not found (docs blocked) | Not found | Not found | Loop + File Parser (CSV, Excel) | Not found (`foreach` op) |
| Per-row journal, crash resume | Yes, SQLite (R4) | Not found | Not found | Not found | Not found | Not found | Not found | Not found | Run records; batch resume not found |
| Write with unknown outcome | Held for review; key blocked across runs (R5) | Approval prompts; not found | Not found | Not found | Not found | Not found | Retry advice only | Not found | Write `key`, dedup TTL, `mark` for uncertain intents |
| Scheduling | No (R8) | Yes | Not found | Not found | Not found | Not found | Not found | Yes (cron) | Your own cron |
| Run evidence | JSON report, screenshots; no HTML/CSV (R6) | Session and permission history | Trace, video, session file | HTML report, traces | History file, GIF, LLM judge | GUI logs | Recordings, OTel (Browserbase) | Recordings, HAR, traces | Run records, diffable plans |
| Ships as | MCP server, Claude Code and Codex plugins, CLI (R7) | Extension, Desktop, Claude Code | MCP server; CLI with skills | CLI, VS Code | Library, CLI skill, MCP, cloud | CLI, extension, GUI | SDK (TS, Python, Go), hosted MCP | SDK, API, MCP, UI | Claude Code plugin, MCP, CLI |
| Licence | MIT | No OSS licence found | Apache-2.0 | Apache-2.0 | MIT | AGPL-3.0 | MIT (SDK) | AGPL-3.0, cloud anti-bot excluded | Sources conflict |
| Price | Free; your agent's plan pays for recording, repair, host mode | Paid Claude plans: Pro $20/mo ($17 annual), Max from $100/mo | Free | Free | Library free; cloud price conflicting | Free | SDK free; Browserbase not verified | $0 / $29 / $149 / custom (docs table) | Free; $99/mo done-for-you |
| Maturity | 0.1.1 (2026-10-03), 0 stars | GA per product page | 37.8k stars, 0.0.83 (2026-09-28) | 97.1k stars, 1.63.0 (2026-09-04) | 117k stars, 0.13.10 (2026-09-04) | 4.2k stars, 0.2.11 (2025-11-19) | 25.5k stars, 4.1.0 (2026-09-09) | 23.1k stars, 1.0.55 (2026-10-01) | 18 stars, 0.30.0 (2026-08-02) |

ChatGPT agent / Operator is not in the table: every OpenAI host was blocked, so nothing about it is verified. Optional records (n8n, Anchor Browser, Zapier) are in the JSON with mostly unverified fields.

## Ritoko today: evidence in the code

- **R1 Replay without a model, direct runner only.** `src/engine/runner.ts:76-79`; runtime dependencies are only `@modelcontextprotocol/sdk`, `playwright-core`, `read-excel-file`, `zod` (`package.json`); the MCP client declares no capabilities, so a connected server cannot request sampling through it (`src/engine/mcp-client.ts:150`); `src/` has no `createMessage` or sampling call (grep, 2026-10-05). Host mode hands each batch to the agent's own browser or tools (`src/engine/host.ts:25-34`), so the agent's model runs; an `mcp` step calls a tool that may itself use a model (`src/engine/integrations.ts:294-305`); recording and repair are done by the agent.
- **R2 Repair, not heal.** A target that stops matching pauses the run as `needs_repair` with a snapshot (`src/engine/runner.ts:589-612`, `870-899`); `step_repair` changes only the target, and the commit step needs `confirmCommitTarget: true` (`src/mcp/server.ts:724-775`); the fix becomes a new workflow version only if nothing else changed (`src/engine/runner.ts:289-312`).
- **R3 Batch input.** `.csv` (comma or semicolon, UTF-8 or Windows-1252) and `.xlsx` (`src/engine/items.ts:8-13`); required columns checked before any browser action (`src/engine/runner.ts:447-462`); duplicate keys in one file refused (`src/engine/ledger.ts:344-349`).
- **R4 Journal and resume.** SQLite with WAL and `synchronous = FULL`, tables runs, items, events, in `~/.ritoko/ritoko.db` (`src/engine/ledger.ts:124-156`, `src/engine/paths.ts:4-10`); resume keeps done items, retries failed ones, and turns items interrupted after the commit into review (`src/engine/runner.ts:353-376`, `514-521`); an execution lease fences a second process (`src/engine/ledger.ts:213-246`). Test: `test/e2e.test.ts:543`.
- **R5 Writes with an unknown outcome.** Business key plus scope barrier: done keys are skipped, uncertain keys are held for review in later runs (`src/engine/ledger.ts:409-437`, `src/engine/runner.ts:523-545`); exactly one commit and an `expect` after it are required (`src/engine/store.ts:150-169`); a failure after the commit becomes review (`src/engine/runner.ts:614-621`); HTTP retries only GET/HEAD before the commit, optional `Idempotency-Key` (`src/engine/http.ts:6-7`, `src/engine/integrations.ts:184-195`); `run_adopt` journals the demonstrated row (`src/engine/runner.ts:199-260`). `repeat: true` re-runs done rows on request (`src/engine/runner.ts:532`). Test: `test/runner.test.ts:294`.
- **R6 Evidence.** JSON report with counts and per-item status, cause, message, screenshot (`src/engine/runner.ts:46-59`, `326-351`, `911-918`; `src/mcp/server.ts:619-645`); events table without bodies or secrets (`src/engine/ledger.ts:439-444`). No HTML or CSV report.
- **R7 Distribution.** `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, CLI commands in `src/commands.ts:10-24`, MIT `LICENSE`, npm `ritoko` 0.1.1.
- **R8 No scheduler.** The only timers are the lease heartbeat and MCP progress notifications (`src/engine/ledger.ts:235`, `src/mcp/server.ts:197`).

## Claims Ritoko may make

Each claim must keep its qualifier wherever it appears.

1. **"The direct runner replays saved steps without calling a model."** Add: in host mode the agent's own browser or tools do the work, an `mcp` step can call a tool that uses a model, and recording and repair use your agent. Evidence: R1.
2. **"Pay the model once, not per row"**, for rows replayed by the direct runner, with the same qualifier; a repair costs agent time again. Evidence: R1, R2.
3. **"Every row is journaled and resumable; a write interrupted after its commit step is held for review instead of being resubmitted."** Evidence: R4, R5, `test/e2e.test.ts:543`, and the recorded crash demo in `site/assets/media/facts.json` (10 submissions received, 10 unique, 1 review item; Ritoko 0.1.0, Windows).
4. **"Rows already confirmed are skipped when the same workflow, scope and business key run again, unless you ask for `repeat`."** Evidence: `src/engine/runner.ts:532-545`.
5. **"When a selector stops matching, the run pauses for repair; changing the submit step's target needs explicit confirmation."** Evidence: R2.
6. **"A write workflow declares one commit step and a check after it."** Evidence: `src/engine/store.ts:150-169`.
7. **"Reads CSV and Excel (.xlsx) files as the batch."** Evidence: R3. Fair context: Skyvern documents a Loop block with a File Parser for CSV and Excel; Claude Code's Chrome docs show a CSV handled through a prompt; Playwright documents CSV-driven tests.
8. **"Runs locally, MIT-licensed; installs as a Claude Code or Codex plugin, a stdio MCP server or a CLI."** Evidence: R7.
9. **"As far as we found (checked 2026-10-05), Claude in Chrome, Playwright MCP, Playwright codegen, browser-use, workflow-use, Stagehand and Skyvern do not document a per-row journal that holds a write with an unknown outcome for review across runs."** Sources: the `notDocumented` entries in the JSON; for browser-use only the README and source code could be read (its docs site was blocked). Do not extend this to taprun (it documents uncertain intents) or to ChatGPT agent (unverified). Always pair it with what those tools do better (below).
10. **"Stagehand's server-side cache needs a Browserbase browser ('With a local browser ... every call runs inference'); Ritoko's direct runner replays with your local Chrome."** Must also say that Stagehand replays an observed Action without inference on any browser.
11. **"Skyvern regenerates cached code through its agent automatically when a page changes; Ritoko pauses and asks for a repair, and never changes the submit target without confirmation."** Present as a design difference, not as better: automatic recovery is what many users want.

## Claims Ritoko must not make

1. **"First", "only", "unique", "best" at replaying without a model.** Skyvern (code caching), Stagehand (Action replay, cache), workflow-use (`run_with_no_ai`), taprun ("$0 in tokens") and Playwright codegen (generated code) all document it. The honesty policy forbids these words anyway.
2. **"Zero model calls" without the direct-runner qualifier.** Host mode, `mcp` steps, recording and repair involve a model (R1).
3. **"No duplicates" or "never resubmits" as an unconditional promise.** `repeat: true` re-runs done rows (`src/engine/runner.ts:532`); submissions made outside this installation are not in the journal; the guarantees depend on a correct key, scope, commit and expect (README FAQ). Say: "no automatic resubmission of an uncertain write; held for review".
4. **"Self-healing".** Ritoko has no automatic heal (R2).
5. **Scheduling, HTML/CSV report, `ensure`, `reconcile`, `check` preflight, `ritoko doctor`, heal journal.** None exists in the code (R6, R8).
6. **"taprun charges for heal."** Its repository says "All features free during v0.x. No tier gating in the engine" (docs/llms.txt); re-capture uses the user's own AI key; the paid offer is a $99/month done-for-you service that includes breakage fixes. The deployed taprun.dev could not be checked.
7. **"taprun is closed source" as a plain fact.** Its own sources conflict: README and packages README call the engine proprietary and closed-source, npm declares AGPL-3.0, and its site source says MIT. Safe wording: "its engine source was not in its public repository on 2026-10-05".
8. **"taprun does not handle uncertain writes."** Its plan schema requires a `key` for writes, has `dedup_ttl_seconds`, and `mark` resolves an `intent_uncertain` run to committed or aborted.
9. **"Stagehand needs Browserbase" or "Stagehand always calls a model."** It runs on a local browser, and observed Actions replay without inference.
10. **"Playwright MCP cannot record."** `browser_start_recording` returns the demonstrated actions as Playwright code.
11. **"browser-use cannot replay."** `rerun_history` / `load_and_rerun` replay a saved history with new variables.
12. **"Skyvern cannot process spreadsheets" or "always needs an LLM".** Loop + File Parser and code caching are documented.
13. **Token or cost figures for Claude in Chrome runs.** Anthropic documents that Claude decides from screenshots and that use counts against plan limits, with no per-run figures. Quote those sentences only.
14. **Anything about ChatGPT agent or Operator.** Nothing could be verified.
15. **"Cheaper than X" with numbers.** Browserbase prices are unverified, browser-use cloud prices conflict, and Ritoko's real cost includes the agent subscription used for recording and repair; no measured comparison exists.
16. **Maturity or adoption comparisons in Ritoko's favour.** Ritoko is 0.1.1, first published 2026-10-03, with 0 stars on 2026-10-05.
17. **"Works with any MCP client."** The README names Claude Code and Codex CLI as the tested plugin clients.
18. **"Proves every write succeeded."** Only as good as the `expect` step; the README says a generic "Success" banner usually cannot prove the result.

## What the alternatives do better

- **Claude in Chrome:** no authoring (demonstrate or describe), built-in scheduling, run-time adaptation by the model, documented prompt-injection defenses and admin site controls, 1Password sign-in, sessions across devices.
- **Playwright MCP:** Microsoft-maintained, 37.8k stars, four browsers, recording to code in four languages, tracing and video, frequent releases.
- **Playwright codegen:** mature multi-language tooling, assertions in the recorder, HTML reports, an LLM healer for failing tests.
- **browser-use:** handles sites never seen before, cloud browsers with stealth and CAPTCHA solving, history replay with variables, an LLM judge, 117k stars.
- **workflow-use:** automatic LLM fallback per step, workflow generation from a sentence, visual GUI.
- **Stagehand:** self-healing `act()`, observable cache hits, three SDK languages, hosted browsers and a hosted MCP server.
- **Skyvern:** cached code with automatic agent recovery, no-code builder, scheduling, loops and file parsing, 2FA and password managers, rich artifacts, self-hosting.
- **taprun:** the same model-free replay promise plus a `verify` drift check, an explicit uncertain-intent resolve verb, converters from Playwright, Puppeteer and Stagehand scripts, and a done-for-you service.

## Coverage

Fields per tool: 14 (category, positioning, localOrCloud, license, pricing, replayModel, selfHeal, batchInput, journalResume, duplicateProtection, auditReport, distribution, maturity, strengthsVsRitoko).

| Tool | Verified | Partial | Unverified |
|---|---|---|---|
| Claude in Chrome | 12 | 2 | 0 |
| Playwright MCP | 14 | 0 | 0 |
| Playwright codegen | 14 | 0 | 0 |
| browser-use | 12 | 2 | 0 |
| workflow-use | 13 | 1 | 0 |
| Stagehand / Browserbase | 13 | 1 | 0 |
| Skyvern | 13 | 1 | 0 |
| taprun | 12 | 1 | 1 |
| ChatGPT agent / Operator | 0 | 0 | 14 |
| n8n (optional) | 7 | 2 | 5 |
| Anchor Browser (optional) | 3 | 5 | 6 |
| Zapier (optional) | 0 | 0 | 14 |

Unreachable on 2026-10-05 (egress proxy): openai.com, help.openai.com, chatgpt.com, platform.openai.com, developers.openai.com, cdn.openai.com, taprun.dev, dev.to, docs.stagehand.dev, www.browserbase.com, docs.browserbase.com, browser-use.com, docs.browser-use.com, www.skyvern.com, playwright.dev, chromewebstore.google.com, anchorbrowser.io, zapier.com, n8n.io, docs.n8n.io. api.github.com refused (repository access not enabled); github.com/LeonTing1010/tap-core returned 404.

Substitutes used: repository sources of the Stagehand, Skyvern, Playwright and taprun docs sites (may differ from the deployed pages); GitHub pages through WebFetch for star counts; npm and PyPI JSON for release dates.

## Notes for maintainers

- The GitHub About text of Swih/ritoko reads "never resubmits a journaled row". `repeat: true` re-runs done rows (`src/engine/runner.ts:532`), so the sentence is broader than claims 3 and 4 above. Suggested: "never automatically resubmits a row the journal marks done or uncertain".
- `site/story.js:146` shows the hero label "Saved replay · 0 model calls". It is true for the direct runner only; the surrounding copy should carry the R1 qualifier.
- The positioning brief describes taprun as "closed binary, heal is paid". Its repository says engine features are free during v0.x and its licence statements conflict (claims 6 and 7 above).
