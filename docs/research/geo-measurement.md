# Measure search and answer visibility

This kit tracks what a person actually sees when they ask a fixed set of questions in an AI answer or search experience. It does not predict rankings. The baseline is **not measured** until the log contains at least one manually captured, real response. An empty log is not evidence of zero mentions.

## Fixed prompts

`scripts/geo/queries.json` defines six pain points and one English and French prompt for each. Use the wording as written so observations can be compared over time. Record the product or engine name as shown in the interface (for example, the specific search or assistant surface), the date, and the exact query variant. A repeated query on the same engine is a separate sample; do not overwrite earlier observations.

For each answer, save a durable evidence URL or a local path to a screenshot/export. Record whether Ritoko is mentioned, assess the overall answer against current product behavior, and check material claims and each citation against the cited source. Mark uncertain checks `unclear`; do not turn uncertainty into a correct result. Include only citations visible in the captured answer. If no citation is shown, leave `citationChecks` empty.

## Sample log

Create a private JSON Lines file outside the public site, such as `docs/research/geo-samples.jsonl` (the sample log is git-ignored). The following is a shape illustration only, not an observation; replace every placeholder before logging a real answer:

```json
{"engine":"REPLACE with engine and model/version","date":"YYYY-MM-DD","queryId":"uncertain-write","language":"en","query":"How can I resume a browser automation batch after a timeout without submitting the same record twice?","brandMention":"REPLACE with observed true or false","answerAccuracy":"REPLACE with assessed value","claimChecks":[],"citationChecks":[],"evidence":"REPLACE with captured answer URL or local file path","notes":"Optional observed context."}
```

`answerAccuracy` is `correct`, `partly_correct`, `incorrect`, or `unassessed`. `claimChecks` contains checked material factual claims with `accuracy` set to `correct`, `incorrect`, or `unclear`. `citationChecks` contains the exact material `claim` assessed, its cited URL, and whether that source `supports`, `does_not_support`, or is `unclear` for the claim. The answer can cite a relevant page while still making a wrong claim, so assess claims and citations separately. Keep evidence local or link directly to the captured result; do not place private user data in this repository.

Log format details:

- `engine`, ISO `date`, fixed `queryId`, `language` (`en` or `fr`), exact `query`, boolean `brandMention`, `answerAccuracy`, and `evidence` are required.
- `claimChecks` and `citationChecks` are arrays and may be empty. Use `notes` only for brief context.
- `citationChecks[].claim` records the factual statement checked; `citationChecks[].url` must be an HTTP(S) source URL. `evidence` may be an HTTP(S) page or a local path.
- The scorer rejects unknown query ids and wording that differs from the fixed prompt set. Do not silently change the prompt mid-series; add a new reviewed query-set version if the set needs to change.

## Run the deterministic report

From the repository root:

```bash
node scripts/geo/report.mjs docs/research/geo-samples.jsonl
node scripts/geo/report.mjs docs/research/geo-samples.jsonl --json
```

The report calculates mention rate, fixed query-variant coverage, answer-accuracy counts, claim-check counts, citation-check counts, and per-engine sample/mention totals. It makes no API calls and reads no credentials. The Markdown report clearly says `not measured` for a zero-line log and reserves zero mentions/rates for a nonempty set of observed answers.

This is an observational sample, not a controlled benchmark: answer surfaces change, and geography, account state, model version and time can affect results. Keep the query wording and collection conditions stable, note changes, retain the underlying answer evidence, and avoid claims about ranking or performance beyond the dated sample. Do not fabricate responses, sources or competitor comparisons. Test fixtures in `test/geo.test.ts` exist only to verify the parser and calculations; they are not measurements.
