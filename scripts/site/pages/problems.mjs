// English guides, one per problem, built at /guides/<slug>. The field list is in ./types.mjs (Page).
// Array order is the order on /guides and on the home page, which shows the first six.

/** @type {import('./types.mjs').Page[]} */
export const problemPages = [
  {
    slug: 'uncertain-writes-after-interruption',
    twin: 'uncertain-writes-after-interruption',
    lang: 'en',
    metaTitle: 'Recover an uncertain browser write after a crash — Ritoko',
    description:
      'A submission can succeed even when its confirmation is lost. Learn how to inspect the result, hold uncertain rows and resume a Ritoko batch safely.',
    h1: 'Did my browser submission succeed before the automation crashed?',
    shortAnswer:
      'A timeout or crash does not prove that the submission failed. Check the destination for that exact business record before retrying. Ritoko holds a write interrupted after its commit boundary for review and resumes other eligible rows from its journal.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Recovery', 'Browser writes'],
    sections: [
      {
        id: 'two-outcomes',
        heading: 'Why can a failed run still create a record?',
        html: '<p>Suppose row <code>INV-1042</code> fills an invoice form and clicks Submit. The server accepts it, then the connection closes before the browser displays the receipt. The local process sees an interruption; the business system may already contain the invoice. Repeating the click could create a second record.</p><p>The recovery question is therefore whether the intended effect exists, not whether the automation returned successfully. The same uncertainty applies to an HTTP write or an MCP tool that times out: the remote action can finish after the client stops waiting.</p>',
      },
      {
        id: 'check-destination',
        heading: 'What should I check before retrying?',
        html: '<ol><li>Read the run report and identify the review row, its business key and destination account.</li><li>Look up that key at the destination. Compare the fields that define this operation: for an invoice, its reference, customer, amount and period.</li><li>If the effect exists, record its receipt or record ID and resolve the item as <code>done</code>.</li><li>If you have established that the effect did not occur, resolve it as <code>failed</code>. The next resume can submit it again.</li><li>If the evidence is inconclusive, leave it in review. An empty search result during delayed processing is not necessarily proof of absence.</li></ol><p>Manual resolution requires an evidence note and explicit confirmation that someone checked the destination. It is recorded as a manual, unverified decision. An agent must ask the user to confirm that check before setting <code>confirmChecked</code>. See the <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#resolving-a-review-item">recovery reference</a> for the exact commands.</p>',
      },
      {
        id: 'resume-other-rows',
        heading: 'How does Ritoko resume the rest of the batch?',
        html: '<p>Resume the existing run, using <code>run_resume</code> for a direct run or <code>host_next</code> for a host run. Confirmed rows remain confirmed. Failures before submission can be retried; uncertain writes stay held. The run uses its saved workflow and input snapshot, so editing the spreadsheet does not rewrite the interrupted batch.</p><p>A later run with the same workflow, scope and key also respects that review hold. If another run is blocked by the original uncertain item, resolve the original run first. Do not use a new workflow name, scope or journal as a shortcut around uncertainty.</p>',
      },
      {
        id: 'design-recovery',
        heading: 'What makes the next interruption easier to resolve?',
        html: '<p>Mark the one irreversible operation with <code>commit: true</code>, then check a result specific to that row with <code>expect</code>. A generic Success banner is weak evidence; a matching reference or receipt is more useful. Treat an autosaving field or upload that creates a record as a write too.</p><p>Ritoko tracks actions through this installation. It cannot see independent submissions, make a remote site idempotent or infer the correct outcome from missing evidence. Split a task with several irreversible effects into separate procedures whose outcomes can each be verified.</p>',
      },
    ],
    faq: [
      {
        q: 'Can I retry a submission just because its request timed out?',
        a: 'No. A timeout can occur after acceptance. Check the destination and keep the item in review while its outcome remains uncertain.',
      },
      {
        q: 'Does resolving an item as failed submit it immediately?',
        a: 'The resolution records that the effect did not occur. A later resume or eligible new run can submit it again, which is why the destination check matters.',
      },
    ],
    related: ['avoid-duplicate-csv-imports', 'resumable-csv-excel-batches'],
  },
  {
    slug: 'avoid-duplicate-csv-imports',
    twin: 'avoid-duplicate-csv-imports',
    lang: 'en',
    metaTitle: 'Avoid duplicate records in repeated CSV imports — Ritoko',
    description:
      'Design a stable business key, destination scope and row-specific checks for repeated CSV imports, including the record created during your demonstration.',
    h1: 'How do I avoid duplicate records when I import the same CSV again?',
    shortAnswer:
      'Identify each operation with a stable business key and destination scope, adopt any row already submitted during recording, and verify each result. Ritoko normally skips confirmed keys and holds uncertain writes, but its local journal does not guarantee that duplicates are impossible.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['CSV imports', 'Business keys'],
    sections: [
      {
        id: 'choose-key',
        heading: 'What is a useful business key?',
        html: '<p>A key represents the business operation rather than its position in a file. For customer creation, an email address may work if the destination treats it as unique. For invoice creation, prefer an external invoice reference. For a monthly report, include the account and period so October and November are different operations.</p><p>Row numbers, timestamps generated at each run and CSV filenames change when you reorder or re-export data. They cannot reliably identify the same operation. Choose and normalize identifiers before the batch starts, preserving any leading zeros that carry meaning.</p>',
      },
      {
        id: 'choose-scope',
        heading: 'How do I separate accounts and destinations?',
        html: `<p>Deduplication uses the workflow name, <code>items.scope</code> and business key. Set scope from the destination, account and operation. A back-office URL alone is insufficient if two accounts use that same URL. The input filename must not be the scope.</p><pre><code>"items": {
  "from": "{{param.input}}",
  "key": "{{item.InvoiceReference}}",
  "scope": "{{param.base}}|{{param.account}}|create-invoice"
}</code></pre><p>This fragment illustrates an invoice workflow; its parameters and destination checks must also be defined. An empty scope shares keys across the workflow’s scopes and can make legitimate rows skip in another account. Treat the empty-scope warning as something to fix before a real batch.</p>`,
      },
      {
        id: 'adopt-demo',
        heading: 'What about the row created while I recorded the task?',
        html: '<p>That record already exists before replay begins. After saving the workflow, use <code>run_adopt</code> with the exact full input row and an evidence note. Adoption runs the confirmation steps and journals the submitted row so a later batch can skip it. Do not send the demonstration row again while adoption or its outcome remains unresolved.</p><p>For an API or MCP demonstration, plan a fresh read to verify the existing record. The original write response cannot serve as an independent recheck. The 0.2.0 Git candidate requires a destination lookup or actual verification after the skipped commit; npm 0.1.1 does not include that new adoption guard.</p><p>Test the procedure on a small authorized batch. Check the business key, scope, irreversible <code>commit</code> and row-specific <code>expect</code> before processing the rest.</p>',
      },
      {
        id: 'rerun-behavior',
        heading: 'What happens when I rerun or change the file?',
        html: '<ul><li>A confirmed key with the same row data is normally skipped.</li><li>Different data under a completed key is blocked; the create procedure does not silently become an update.</li><li>Duplicate keys inside one input file are rejected before processing.</li><li>An uncertain key remains held, including during an explicit repeat.</li></ul><p><code>repeat: true</code>, or CLI <code>--repeat</code>, intentionally reruns completed items. Use it only when a repeated effect is intended. Changing workflow names or deleting the journal can also remove the context that prevented a repeat.</p><p>For a remote HTTP API that documents idempotency-key support, Ritoko can send a stable <code>Idempotency-Key</code>. The header helps only when the receiving service honors its contract. Independent imports, manual entry and another installation remain outside this journal. See the <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#safe-workflow-contract">workflow contract</a>.</p>',
      },
    ],
    faq: [
      {
        q: 'Does using an email key guarantee no duplicates?',
        a: 'No. The key must match the destination’s business identity, and the scope and result checks must be correct. Ritoko’s journal also cannot track independent submissions.',
      },
      {
        q: 'Should I use the CSV filename as the scope?',
        a: 'No. Use destination, account and operation parameters. A new filename should not make an old business operation look new.',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'resumable-csv-excel-batches'],
  },
  {
    slug: 'recurring-tasks-model-costs',
    twin: 'recurring-tasks-model-costs',
    lang: 'en',
    metaTitle: 'Reduce model usage for recurring browser tasks — Ritoko',
    description:
      'Separate discovery and repair from repeated execution. Understand when direct replay avoids model calls and which parts still use an agent or paid service.',
    h1: 'Do I need an AI model to solve the same browser task on every run?',
    shortAnswer:
      'A stable task with explicit actions and checks can run as a saved procedure. Ritoko’s direct replay engine does not call an LLM. Recording, repair, host orchestration and external tools that use models can still consume model usage or incur charges.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Recurring tasks', 'Model usage'],
    sections: [
      {
        id: 'separate-work',
        heading: 'Which decisions need reasoning, and which can be saved?',
        html: '<p>Consider a weekly supplier import. An agent first discovers the form, determines which input field maps to each column and finds proof that a supplier was created. Once those decisions are correct, the next file may require the same actions with different values.</p><p>Save the workflow’s parameters, selectors, business key, commit boundary and verification checks. Direct replay then executes that procedure rather than asking the model to discover each step again. A task that requires interpreting new documents, choosing among changing business rules or navigating unfamiliar sites may still need reasoning for each item.</p>',
      },
      {
        id: 'cost-boundaries',
        heading: 'Which parts of a Ritoko run can still cost money?',
        html: '<ul><li><strong>Authoring and recording:</strong> the client agent uses its subscription or API configuration to solve and save the task.</li><li><strong>Direct replay:</strong> the engine executes saved browser, HTTP and MCP steps without its own LLM call. The surrounding agent can still use a model to launch or discuss the run.</li><li><strong>External services:</strong> an MCP tool, OCR API or generation endpoint may use a model and charge for every call.</li><li><strong>Repair and host mode:</strong> the agent participates again. Host orchestration is not a promise of zero model usage.</li><li><strong>Operation and maintenance:</strong> browser runtime, service access, destination limits and a person’s review time still matter.</li></ul><p>Ritoko includes no local OCR engine or invoice parser. Its optional <code>document_image</code> returns a downloaded image for the client model to read; each new image still requires interpretation. See the <a href="https://github.com/Swih/ritoko/blob/main/README.md#faq">runtime and document-reading FAQ</a>.</p>',
      },
      {
        id: 'measure-own-task',
        heading: 'How should I measure the saving on my task?',
        html: '<p>Record authoring time and model usage separately from the repeated runs. Then measure a representative small batch: elapsed time, confirmed items, review items, external service charges and repair effort. Compare complete business outcomes, including manual follow-up.</p><p>A useful budget is initial authoring cost plus repeated execution cost plus expected maintenance and review. No percentage saving follows from the architecture alone. A changing page or model-backed extraction can dominate the budget even when the replay engine itself makes no model calls.</p>',
      },
      {
        id: 'choose-replay',
        heading: 'When is saving a procedure worth the effort?',
        html: '<p>Replay fits tasks that recur, accept structured inputs and expose a result you can check. Keep an agent involved when the task is exploratory or its next action depends on judgment. Start with one verified operation and a short batch, then reuse it once the business rules are clear.</p><p>Ritoko is not the only way to avoid inference during execution: generated Playwright code and other tools’ documented replay or cache paths also do that. The relevant difference is how you want to maintain the procedure and track its business outcomes.</p>',
      },
    ],
    related: ['browser-api-mcp-workflows', 'ritoko-vs-playwright-codegen', 'ritoko-vs-stagehand'],
    sources: [
      {
        label: 'Playwright: generating executable tests',
        url: 'https://playwright.dev/docs/codegen',
        retrieved: '2026-10-05',
      },
      {
        label: 'Stagehand: caching actions',
        url: 'https://docs.stagehand.dev/v3/best-practices/caching',
        retrieved: '2026-10-05',
      },
    ],
  },
  {
    slug: 'robust-browser-selectors',
    twin: 'robust-browser-selectors',
    lang: 'en',
    metaTitle: 'Record robust browser selectors and repair drift — Ritoko',
    description:
      'Choose meaningful, unique targets for a recorded browser task, check the submitted result and repair changed selectors without blindly replaying a write.',
    h1: 'How do I keep a recorded browser workflow useful when the page changes?',
    shortAnswer:
      'Record targets that identify the intended control by meaning and uniqueness, then verify the business result. Ritoko supports selector fallbacks and pauses eligible direct runs for deliberate repair. A changed submit target needs explicit confirmation before repair.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Recording', 'Selector repair'],
    sections: [
      {
        id: 'meaningful-target',
        heading: 'What should a selector identify?',
        html: `<p>Prefer a unique field label, role and accessible name, or stable test ID. “Create customer” describes the intended button more clearly than the third button inside the second panel. Text alone can also be ambiguous when several panels repeat the same words.</p><p>Ritoko’s recorder checks whether a candidate matches only the selected element and flags fragile positional targets. Review those targets before saving. A fallback should identify the same control by another stable property, not simply match whichever button still exists.</p><pre><code>"target": {
  "primary": { "by": "role", "role": "button", "name": "Create customer" },
  "fallbacks": [{ "by": "testid", "id": "create-customer" }]
}</code></pre><p>This example applies only if both selectors uniquely identify your application’s actual submit control. Do not copy its test ID into an unrelated site.</p>`,
      },
      {
        id: 'check-result',
        heading: 'Why is a matching selector not enough?',
        html: '<p>A button can keep the same name while its behavior changes. Check the resulting record, not just that the click completed. Use an <code>expect</code> containing the current row’s email, reference or other business evidence. Check an iframe target in the correct frame, and allow enough time for a real confirmation to appear.</p><p>Build a repeatable starting point for each item, such as navigation to a new-record form. Treat autosave and auto-submitting controls as possible writes. A successful field fill is not proof that nothing irreversible happened.</p>',
      },
      {
        id: 'repair-pause',
        heading: 'What do I do when a target stops matching?',
        html: '<ol><li>Inspect the paused step, page snapshot and intended business action.</li><li>Confirm whether the page changed or whether login, MFA, an error or the wrong account caused the mismatch.</li><li>Choose a new unique target for the same action and use <code>step_repair</code>. A commit-target replacement additionally requires <code>confirmCommitTarget: true</code> after checking that it is the same submit control.</li><li>Resume the run. Before submission the item restarts its form; after submission only eligible confirmation repair can continue on the same document.</li></ol><p>Automatic recorded fallbacks must also match a single element. The direct runner reports fallback usage; a fallback on the commit step raises a warning to check the submit control. Host mode currently does not offer selector repair or report fallbacks. See <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#execution-and-recovery">execution and recovery</a>.</p>',
      },
      {
        id: 'after-submit',
        heading: 'What if the selector failure happened after submission?',
        html: '<p>Do not recreate the record to repair its receipt screen. A missing verification target can pause the first submitted item once; other failures after commit can become review. Expected text absent from the page is also a failed verification, not something a replacement selector necessarily fixes.</p><p>Use the uncertain-write recovery procedure if the result cannot be proved. Selector repair restores a target; it does not establish whether a previous business write succeeded. Test the repaired workflow on a small batch before relying on it for a large recurring job.</p>',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'ritoko-vs-playwright-mcp', 'ritoko-vs-stagehand'],
  },
  {
    slug: 'resumable-csv-excel-batches',
    twin: 'resumable-csv-excel-batches',
    lang: 'en',
    metaTitle: 'Run and resume CSV or Excel browser batches — Ritoko',
    description:
      'Prepare CSV and XLSX inputs, preserve identifiers, validate rows and resume an interrupted batch from its saved workflow and journaled input snapshot.',
    h1: 'How can I process a CSV or Excel file and resume halfway through?',
    shortAnswer:
      'Define one verifiable operation per row, validate the input and keep a durable record of each outcome. Ritoko reads CSV and XLSX files, freezes the rows and workflow in its SQLite journal, and resumes the same run while keeping confirmed rows and holding uncertain writes.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['CSV', 'Excel', 'Batch recovery'],
    sections: [
      {
        id: 'prepare-input',
        heading: 'What should I fix in the spreadsheet before running it?',
        html: '<ul><li>Use clear, unique column headers and a business key that is non-empty and unique across the batch.</li><li>Keep identifier columns as Text. Excel formatting is not applied: a numeric cell displayed as <code>07001</code> can read as <code>7001</code>, and <code>15%</code> as <code>0.15</code>.</li><li>Export only the rows you intend to process. Hidden and filtered-out XLSX rows are still read.</li><li>Save calculated results in Excel. Formula errors or formulas without saved results are treated as empty when referenced.</li><li>Keep credentials out of input files. Declare environment-backed secret parameters instead.</li></ul><p>Ritoko supports comma- or semicolon-separated CSV in UTF-8 or Windows-1252, plus <code>.xlsx</code> with a selectable sheet. It is not a general reader for every spreadsheet format. See the <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#input-files">input reference</a>.</p>',
      },
      {
        id: 'define-row',
        heading: 'How should I define the operation for each row?',
        html: '<p>Declare the input path, key, destination scope and required columns. Mark the irreversible write as <code>commit</code> and follow it with a check proving this row’s result. Use <code>readOnly: true</code> for a batch that only reads or downloads.</p><p>The entire input is validated before processing: malformed headers, duplicate or empty keys and missing referenced values are rejected. This catches input problems; it does not prove that every value is valid for the remote business system. Start with a representative small authorized batch.</p>',
      },
      {
        id: 'resume-snapshot',
        heading: 'Do I edit the spreadsheet to remove finished rows?',
        html: '<p>You do not need to remove finished rows to resume an existing run. The journal stores its rows and workflow definition. Resume by run ID with <code>run_resume</code> or CLI <code>ritoko resume</code> for direct execution; use <code>host_next</code> for host execution.</p><p>Editing the original file does not alter that saved run. Put corrected or new data into a deliberately started new batch after inspecting previous outcomes. Confirmed items remain confirmed; safe failures can retry; review items require a destination check. A new file with the same completed keys does not automatically mean a new business operation.</p>',
      },
      {
        id: 'read-report',
        heading: 'Which output tells me the batch is actually finished?',
        html: '<p>Use <code>run_report</code> or CLI <code>ritoko report</code> to inspect per-item status, causes, messages and available evidence or files. <code>done</code> means the workflow’s checks passed; <code>skipped</code> means already confirmed under the journal’s identity rules. A partial result still has failed or review items.</p><p>A run is complete only when its items are confirmed or skipped and its final checks pass. A partial result, stopped run or repair pause returns CLI exit code <code>2</code>. Keep the journal with the installation: it is the record used for recovery, not disposable cache. Current run reports are JSON; do not assume an HTML or CSV audit report exists.</p>',
      },
    ],
    faq: [
      {
        q: 'Will changing the Excel file change a resumed run?',
        a: 'No. The run uses its frozen input and workflow. Start a new batch deliberately for corrected or new data, after inspecting the previous outcomes.',
      },
    ],
    related: [
      'avoid-duplicate-csv-imports',
      'uncertain-writes-after-interruption',
      'browser-api-mcp-workflows',
    ],
  },
  {
    slug: 'browser-api-mcp-workflows',
    twin: 'browser-api-mcp-workflows',
    lang: 'en',
    metaTitle: 'Choose browser, HTTP API or MCP workflow steps — Ritoko',
    description:
      'Choose an authorized browser, HTTP API or MCP path for repeated work, with explicit result checks, credential handling and recovery after uncertain writes.',
    h1: 'Should a repeated task use the browser, an HTTP API or an MCP tool?',
    shortAnswer:
      'Use the supported interface whose business contract and permissions you can verify. Browser steps fit tasks exposed through a UI; HTTP steps fit documented endpoints; MCP steps reuse tools with known inputs and outputs. Ritoko can combine these paths under one workflow and journal.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Browser', 'HTTP API', 'MCP'],
    table: {
      caption: 'Choose a path by the contract you can verify',
      columns: ['Path', 'Useful when', 'Check before saving'],
      rows: [
        [
          'Browser',
          'The task is available in your authorized account UI',
          'Unique controls, login state, commit and visible business evidence',
        ],
        [
          'HTTP API',
          'A supported endpoint exposes the required operation',
          'Authentication, request schema, result checks and any idempotency contract',
        ],
        [
          'MCP tool',
          'A connected tool implements the operation you need',
          'Input/output schema, side effects, compatibility and tool-provider charges',
        ],
      ],
    },
    sections: [
      {
        id: 'browser-path',
        heading: 'When is the browser the practical choice?',
        html: '<p>Use the UI when it is the supported way to perform the task or when it supplies a necessary approval or business check. The direct runner connects to personal Chrome with remote-debugging permission, or an explicitly selected clean profile. Complete login and MFA in the selected browser.</p><p>Host browser replay requires a client that permits page-script execution. Current Codex computer-use evaluation is read-only and cannot execute that replay. API-only and connected MCP-tool host batches remain possible. Confirm the driver’s limits before recording a task that depends on iframes, keyboard presses or downloads.</p>',
      },
      {
        id: 'api-path',
        heading: 'Can I turn a browser recording into API calls?',
        html: '<p>Optional network capture supplies fetch/XHR metadata that can help investigate an API. Those hints are not an API contract and do not automatically create executable HTTP steps. Verify the supported endpoint, authentication, required fields and returned business result, then test one authorized row and save the replacement explicitly.</p><p>An HTTP step can check response status and JSON values, save returned IDs and feed later read-only checks. Environment-backed secret parameters keep credentials out of saved workflows. A stable <code>Idempotency-Key</code> is available when the receiving API documents support. Only eligible GET/HEAD requests before commit are automatically retried; a write with an uncertain outcome remains review.</p>',
      },
      {
        id: 'mcp-path',
        heading: 'What do I need to know about a connected MCP tool?',
        html: '<p>Check the tool’s schema and actual side effects. A declared read-only step is an author assertion, not a guarantee supplied by the protocol. Tool errors, timeouts and requests for more input fail the step; Ritoko does not automatically retry MCP calls. A timed-out write may still finish remotely.</p><p>A direct workflow can start or contact configured servers. Host <code>{ref: "agent"}</code> references reuse an existing agent connection. Direct-client protocol compatibility has limits; a modern-only server may be unsupported. An external MCP tool may itself invoke a model or a paid service even though Ritoko’s direct replay engine contains no LLM call.</p>',
      },
      {
        id: 'combine-paths',
        heading: 'How do I combine interfaces without duplicating a write?',
        html: '<p>For example, create a record through a documented API, save its ID, then retrieve its receipt with a read-only tool. Keep one irreversible commit per item and verify the intended effect after it. A workflow without browser steps does not need Chrome.</p><p>Do not switch to a browser submission automatically after an API write times out: that can submit the same record twice. Check the first outcome before changing paths. Split tasks with several independent writes into separate verifiable procedures. See the <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#api-and-mcp-steps">HTTP/MCP step reference</a> for exact shapes, authentication and driver limits.</p>',
      },
    ],
    related: [
      'uncertain-writes-after-interruption',
      'recurring-tasks-model-costs',
      'resumable-csv-excel-batches',
    ],
  },
]
