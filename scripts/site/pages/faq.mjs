// English FAQ, built at /faq when there is at least one group. The field lists are in ./types.mjs
// (FaqGroup, FaqPage). faqPage holds the page-level fields and is required once faqGroups is not empty.

/** @type {import('./types.mjs').FaqGroup[]} */
export const faqGroups = [
  {
    id: 'fit-and-setup',
    heading: 'Fit and setup',
    items: [
      {
        q: 'What is Ritoko?',
        a: 'Ritoko saves a task an agent solved as a reusable JSON workflow, then runs it with new parameters or CSV/XLSX rows. Supported steps include browser actions, HTTP requests and MCP tools. Its local journal keeps each item’s outcome. Start with the <a href="https://github.com/Swih/ritoko#quick-start">quick start</a>.',
      },
      {
        q: 'When should I use a saved workflow instead of an agent?',
        a: 'Use a workflow when the task recurs, its inputs are structured and its result can be checked. Use an agent when the task needs exploration or judgment on each run. The agent can discover a procedure and Ritoko can replay the repeated part.',
      },
      {
        q: 'What do I need to run Ritoko?',
        a: 'The local runtime requires Node.js 24 or newer. Direct browser workflows also need Google Chrome; standalone HTTP/MCP workflows can run without it. Ritoko is available as a CLI, local stdio MCP server and Claude Code or Codex plugin.',
      },
      {
        q: 'Can any MCP client connect to Ritoko?',
        a: 'A local client that can launch a stdio process can connect, subject to its own capabilities. Claude Code and Codex CLI are the tested plugin clients. An isolated cloud client cannot reach your local process or files without a separate connection mechanism.',
      },
      {
        q: 'Can Ritoko use my logged-in browser?',
        a: 'The direct runner can attach to personal Chrome with your remote-debugging permission, or use an explicitly selected clean profile. Complete login or MFA in that browser. Host browser replay needs permission to execute page scripts; current Codex computer-use evaluation is read-only and cannot execute it. See <a href="/guides/browser-api-mcp-workflows">driver choices</a>.',
      },
    ],
  },
  {
    id: 'model-usage',
    heading: 'Model usage and services',
    items: [
      {
        q: 'Does Ritoko replay without calling an LLM?',
        a: 'Its direct replay engine makes no LLM calls. Recording, repair and host orchestration can use your client agent’s model. An external MCP tool, OCR provider or generation endpoint may also invoke models and charge separately. See <a href="/guides/recurring-tasks-model-costs">recurring task costs</a>.',
      },
      {
        q: 'Do I need a separate LLM API key?',
        a: 'The direct runner does not need one. Your client agent supplies reasoning through its existing subscription or API configuration when recording, repairing or orchestrating host runs. External services require their own configured access.',
      },
      {
        q: 'Does Ritoko include OCR or an invoice parser?',
        a: 'No. Optional <code>document_image</code> returns a downloaded JPEG/PNG for your client model to read. An external OCR service is another choice. Each new document still needs interpretation and verification before its extracted values are submitted.',
      },
      {
        q: 'Can I schedule recurring runs inside Ritoko?',
        a: 'Ritoko currently has no built-in scheduler. A separate scheduler can invoke an existing CLI workflow. Arrange login, credentials, timeouts and review follow-up before running unattended, and inspect each run’s report.',
      },
    ],
  },
  {
    id: 'inputs-and-results',
    heading: 'Inputs and results',
    items: [
      {
        q: 'Which spreadsheet formats does Ritoko accept?',
        a: 'It reads <code>.xlsx</code> with a selectable sheet, and comma- or semicolon-separated CSV in UTF-8 or Windows-1252. Required values and duplicate or empty business keys are checked before processing. See <a href="/guides/resumable-csv-excel-batches">input preparation</a>.',
      },
      {
        q: 'Are hidden Excel rows and formatted identifiers imported?',
        a: 'Hidden and filtered-out XLSX rows are read too. Excel number formatting is not applied, so keep identifiers with leading zeros as Text. Formulas use their saved results; referenced formula errors or missing saved results are treated as empty.',
      },
      {
        q: 'Does editing the input file change a resumed run?',
        a: 'No. A run uses the workflow and rows frozen in its journal. Start a new batch deliberately for new or corrected data, after inspecting previous outcomes.',
      },
      {
        q: 'What does the run report contain?',
        a: 'The JSON report includes the run status, counts and per-item outcomes, causes, messages and available evidence or files. It does not currently generate an HTML or CSV audit report. A partial result still needs attention; it is not a completed batch.',
      },
    ],
  },
  {
    id: 'writes-and-recovery',
    heading: 'Writes and recovery',
    items: [
      {
        q: 'Does Ritoko guarantee no duplicate writes?',
        a: 'No. It normally skips confirmed items and holds uncertain writes within this installation’s journal. Correct business keys, destination scopes, commit boundaries and row-specific checks are essential. Independent submissions remain outside that journal. See <a href="/guides/avoid-duplicate-csv-imports">duplicate import prevention</a>.',
      },
      {
        q: 'What does review mean after a crash or timeout?',
        a: 'The write may have succeeded without a usable confirmation. Check that exact record at the destination before resolving it. An inconclusive result should remain in review, including across later runs. See <a href="/guides/uncertain-writes-after-interruption">uncertain-write recovery</a>.',
      },
      {
        q: 'How do I resolve a review item?',
        a: 'After someone checks the destination, resolve <code>done</code> if the effect exists or <code>failed</code> if it did not occur. Failed resolution permits a later submission. Both require an evidence note and explicit check confirmation; manual resolutions are recorded as unverified decisions. An agent must obtain the user’s confirmation of the destination check.',
      },
      {
        q: 'How do I resume an interrupted run?',
        a: 'Use <code>run_resume</code> or CLI <code>ritoko resume</code> for a direct run, and <code>host_next</code> for a host run. Confirmed rows stay confirmed; eligible failures can retry; uncertain writes remain held. Resolve an original uncertain run before a later duplicate-held run.',
      },
      {
        q: 'What if my demonstration already created the first record?',
        a: 'After saving the workflow, use <code>run_adopt</code> with that exact full row and an evidence note. It runs confirmation steps and journals the already submitted record so replay can skip it. Do not replay that row while its outcome remains unresolved.',
      },
      {
        q: 'Can Ritoko check the destination before writing or settle review automatically?',
        a: 'The 0.2.0 Git release candidate adds optional <code>ensure</code> lookup before a write and <code>run_reconcile</code> lookup to settle an uncertain result; npm 0.1.1 does not include them. They require direct HTTP GET or a trusted MCP read tool advertising <code>readOnlyHint: true</code>, explicit scope and predicates proving presence or absence. Inconclusive reconciliation leaves the item unchanged; it never resubmits. Browser checks, host runs and agent-managed tools are unsupported, and the lookup must exist in the frozen run. See <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#destination-lookup-ensure-and-reconcile">configuration and limits</a>.',
      },
      {
        q: 'What happens when a recorded selector changes?',
        a: 'A supported direct run can pause for <code>step_repair</code>. Check that a new target identifies the intended control; repairing the commit target requires explicit confirmation. Failures after submission can instead become review. Host mode currently has no selector repair. See <a href="/guides/robust-browser-selectors">selector recording and repair</a>.',
      },
      {
        q: 'Can I intentionally repeat completed rows?',
        a: 'Yes, an explicit <code>repeat: true</code> or CLI <code>--repeat</code> reruns completed rows. Review holds remain blocked. Use repeat only when the repeated business effect is intended.',
      },
    ],
  },
  {
    id: 'integrations-and-data',
    heading: 'Integrations and local data',
    items: [
      {
        q: 'Can a browser recording automatically become an API workflow?',
        a: 'No. Optional network capture gives fetch/XHR metadata for investigation. Verify the authorized API contract and authentication, test a row and explicitly save supported HTTP steps. An uncertain API write must not automatically fall back to another browser submission.',
      },
      {
        q: 'Can a workflow call an existing MCP tool?',
        a: 'Yes, supported configured servers can supply <code>mcp</code> steps, and host <code>{ref: "agent"}</code> references reuse an existing agent connection. Verify schemas, side effects, protocol compatibility and service charges. Tool calls are not automatically retried. See <a href="/guides/browser-api-mcp-workflows">integration choices</a>.',
      },
      {
        q: 'Where are workflows, the journal and output files stored?',
        a: 'They live under <code>~/.ritoko</code> by default; <code>RITOKO_HOME</code> changes that location. The journal contains business rows and ordinary saved values. Saved files keep their original bytes and can contain sensitive data. Treat the installation’s files as business records.',
      },
      {
        q: 'How should I store credentials?',
        a: 'Declare secret parameters backed by environment variables. Do not put credentials in workflow JSON or spreadsheets. Runtime credentials are excluded from the journal, while saved response files preserve their bytes and need their own care. Read the <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#api-and-mcp-steps">integration reference</a>.',
      },
    ],
  },
]

/** @type {import('./types.mjs').FaqPage | null} */
export const faqPage = {
  metaTitle: 'Ritoko FAQ: replay, CSV batches, models and recovery',
  description:
    'Answers about Ritoko setup, model usage, browser and API workflows, CSV/XLSX inputs, uncertain writes, duplicate protection and interrupted batch recovery.',
  h1: 'Ritoko FAQ',
  shortAnswer:
    'Ritoko saves verifiable browser, HTTP and MCP procedures and replays them with a local journal. These answers explain setup, model usage, spreadsheet inputs and the checks needed to recover uncertain writes.',
  datePublished: '2026-10-05',
  dateModified: '2026-10-05',
}
