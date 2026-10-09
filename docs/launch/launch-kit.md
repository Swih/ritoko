# Ritoko 0.2.0 launch kit

Prepared 9 October 2026. These are publication drafts, not records of posts already sent. Publish the version announcement only after the matching npm package, GitHub release and consumer smoke test are verified.

## Positioning

**English:** Save a browser, API or MCP task once. Replay new CSV/Excel rows, verify the results and resume with a local journal.

**Français :** Enregistre une tâche navigateur, API ou MCP. Réutilise-la avec un nouveau CSV/Excel, vérifie les résultats et reprends depuis un journal local.

The primary audience is developers and operators who already have a repeated task. Lead with a concrete customer-import example and the runnable [first-try demo](../first-run.md). Explain that workflow authors define verification, and uncertain writes remain held for review. Keep Node 24+, browser requirements and host limitations visible.

## Release and first week

| Order | Deliverable | Evidence required |
| --- | --- | --- |
| 1 | npm 0.2.0, tagged source, MCPB and official MCP Registry | Exact-commit three-system CI, archive hashes, clean registry and extracted-bundle tests |
| 2 | Smithery and Glama releases; existing directory metadata | Public version and actual tools, not just an accepted upload |
| 3 | awesome-mcp-servers contribution; Claude directory application | Submitted PR/form URL; acceptance remains the maintainer's decision |
| 4 | One English technical launch with the 34-second demo and runnable example | Maker account and author available to answer questions |
| 5 | French LinkedIn post, then English post focused on a specific workflow | Posts from the authorized account; useful answers to real feedback |
| 6 | Follow up with willing testers and turn a verified case into a tutorial | Explicit contact permission and consent before publishing names, data or quotes |

Start with these few relevant channels. Expand after learning where people finish a first run. Product Hunt can follow when there are user results to show. No paid listings or ads are included in this plan.

## Show HN draft

**Title:** Show HN: Ritoko — replay CSV workflows with verified results and crash recovery

**URL:** https://github.com/Swih/ritoko

**Maker comment:**

I built Ritoko for tasks an AI agent has already figured out but needs to repeat over a spreadsheet. You save a readable JSON procedure, identify each business item, define the submission boundary and check the result. The local runner replays the saved steps without an LLM; connected tools may still use one.

The journal records a commit before dispatch. If the process stops after a write might have reached the destination, that item is held for review. Version 0.2.0 adds scoped destination checks and read-only reconciliation; these need an authoritative HTTP GET or an explicitly read-only MCP tool.

You can try ten fake customer records locally, without a login or Chrome, then rerun and see ten skips with no additional creates. Browser workflows need Chrome, and verification quality depends on the workflow you define. The README has the runnable demo, a 34-second interruption recording, installation and the recovery limits. I'd like feedback on the first-run experience and which repeated task you'd use this for.

Check the current [Show HN rules](https://news.ycombinator.com/showhn.html) and account eligibility before submitting. Do not ask for votes or post the same launch repeatedly.

## LinkedIn — français

Une IA peut réussir une tâche une fois. Mais quand il faut refaire les mêmes étapes sur 100 lignes, comment savoir ce qui a vraiment été créé si le processus s'arrête au milieu ?

J'ai créé Ritoko pour enregistrer la procédure, la réutiliser avec un CSV/Excel et vérifier chaque résultat dans un journal local. Une soumission incertaine reste en attente de contrôle. La version 0.2.0 ajoute la vérification de la destination avant création et la réconciliation par lecture.

Le projet est open source. La démo locale permet de créer dix clients fictifs, puis de relancer le même lot sans nouvelles créations. Pas de compte nécessaire pour cette démo. Les tâches navigateur utilisent Chrome ; les workflows API peuvent fonctionner sans navigateur.

Démo et installation : https://github.com/Swih/ritoko

Si tu répètes souvent une saisie, un export ou une mise à jour, quel est le point où tu perds le plus de temps ?

## LinkedIn — English

An AI agent can solve a task once. Repeating it over a spreadsheet also needs a business key, result checks and a recovery rule when a submission's outcome is unknown.

Ritoko saves the procedure as JSON and replays browser, HTTP API or MCP steps with a local journal. Version 0.2.0 adds scoped destination checks and read-only reconciliation. Uncertain writes remain held until there is evidence.

It's open source. Try the local ten-customer demo, then rerun it and inspect the skipped items and unchanged create count. That example requires Node 24+, no account and no Chrome. Browser workflows require Chrome and explicit result checks.

Demo and install: https://github.com/Swih/ritoko

Which recurring task would you want to reuse after your agent solves it?

## Demo video description

**Title:** Ritoko: interrupt a CSV batch, resume, inspect uncertain writes

The 34-second recording runs against a local test back office that accepts duplicates. After the fifth customer reaches the service, the process is killed. Resuming preserves verified rows, holds one uncertain row for review and finishes unstarted work. The final service count is ten submissions, ten unique customer keys; one row still needs confirmation. This recording demonstrates the journal behavior, not a benchmark across customer sites. Version 0.2.0's lookup/reconciliation features are documented separately.

Watch: https://ritoko.com/watch

Recorded environment and results: https://github.com/Swih/ritoko/blob/main/site/assets/media/facts.json

Install and first try: https://github.com/Swih/ritoko

## Measuring the launch

For each channel, record the publication URL, date, visits/referrers available under existing analytics consent, installation intent and voluntarily confirmed first runs. The website strips query strings: UTM links alone do not establish campaign attribution. Do not add hidden software telemetry or count npm downloads as people.

Use a private tester log with consent, operating system/client/runtime, chosen task, first-run result, blocker and next step. Count a first run only after the tester confirms the expected outcome. Targets for the next 30 days are 20 identified testers, five real workflows and three publishable reports; these are targets, not forecasts or observed results.

Keep search observations separate from answer-engine observations. Use the existing [GEO measurement kit](../research/geo-measurement.md) and save actual answers before calculating mention or citation rates. Technical SEO does not establish ranking or recommendations.
