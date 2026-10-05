// English comparisons with other tools, built at /compare/<slug>. The field list is in ./types.mjs (Page).
// A comparison needs at least one source with the date it was checked. Array order is the order on /compare.

/** @type {import('./types.mjs').Page[]} */
const checked = '2026-10-05'
const source = (label, url) => ({ label, url, retrieved: checked })
const base = { lang: 'en', datePublished: checked, dateModified: checked, tags: ['Tool comparison'] }

export const comparisonPages = [
  {
    ...base,
    slug: 'ritoko-vs-playwright-mcp',
    metaTitle: 'Ritoko vs Playwright MCP: exploration or replay?',
    description:
      'Compare live browser exploration with Playwright MCP and saved Ritoko batch workflows. Choose by task stability, result checks and interruption recovery.',
    h1: 'Ritoko or Playwright MCP for repeated browser work?',
    shortAnswer:
      'Choose Playwright MCP when an agent needs to inspect and explore a browser task. Choose Ritoko when the procedure is known and you want to replay structured rows with per-item outcome tracking. The tools can serve different stages of the same task.',
    table: {
      caption: 'Different jobs in an agent-assisted browser workflow',
      columns: ['Decision', 'Ritoko', 'Playwright MCP'],
      rows: [
        ['Primary use', 'Saved browser, HTTP and MCP procedures', 'Live browser tools for a client agent'],
        [
          'Page interaction',
          'Recorded selectors and saved steps',
          'Structured accessibility snapshots and browser actions',
        ],
        [
          'Repeated input',
          'CSV/XLSX rows with keys and scopes',
          'Define iteration and business checks in your client or application',
        ],
        [
          'After an uncertain write',
          'Journal holds the item for review',
          'This README does not establish an equivalent business-row recovery contract',
        ],
      ],
      note: 'Documentation comparison checked 5 October 2026. No measured reliability or cost ranking.',
    },
    sections: [
      {
        id: 'when-playwright-mcp',
        heading: 'When is Playwright MCP the better fit?',
        html: '<p>Playwright MCP exposes browser actions and structured accessibility snapshots to an MCP client. It is useful for inspecting an unfamiliar UI, debugging a page or letting an agent choose the next action as it learns the task. Its README distinguishes that interactive use from the Playwright CLI and skills path.</p><p>Pick it when discovering what to do is the main work. It does not need to be replaced just because a task may eventually recur. <a href="https://github.com/microsoft/playwright-mcp">Source: Playwright MCP README</a>.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'When does Ritoko’s procedure and journal help?',
        html: '<p>Consider a customer import where the form is known and the next input is a spreadsheet. Save the fields, a business key, the account scope, one irreversible commit and a check for the created customer. Ritoko can replay those decisions and report each row as confirmed, failed, skipped or review.</p><p>The direct engine itself makes no model calls. Authoring, repair, host orchestration and model-backed external tools can still use a model. A journal hold is also conditional on a correctly authored workflow and covers only this installation’s actions.</p>',
      },
      {
        id: 'combine',
        heading: 'Can I use both?',
        html: '<p>Use an exploratory tool to understand the task, then explicitly author supported Ritoko steps for the repeatable portion. There is no automatic importer of a Playwright MCP conversation into a Ritoko workflow. Check the driver, selector and authentication requirements before replaying.</p><p>If exploration already submitted a real record, adopt the exact row and its evidence before running the batch. Keep one system responsible for the write; do not run both tools against the same uncertain item to see which succeeds.</p>',
      },
      {
        id: 'evaluate',
        heading: 'What should I test before choosing?',
        html: '<p>Run a small authorized example through the actual site. Ask whether the task needs live reasoning on every item, how a successful business result is checked and who owns recovery after an accepted write loses its confirmation. A screenshot or conversation history can help investigation, but your application still needs a clear business outcome.</p><p>Our review is limited to the linked README. “Not established here” does not mean a client or custom application cannot implement recovery. See Ritoko’s <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#safe-workflow-contract">workflow contract</a> for its own limits.</p>',
      },
    ],
    related: [
      'robust-browser-selectors',
      'uncertain-writes-after-interruption',
      'ritoko-vs-playwright-codegen',
    ],
    sources: [source('Microsoft: Playwright MCP README', 'https://github.com/microsoft/playwright-mcp')],
  },
  {
    ...base,
    slug: 'ritoko-vs-playwright-codegen',
    metaTitle: 'Ritoko vs Playwright codegen: batches or test code?',
    description:
      'Both saved workflows and generated Playwright code can execute without inference. Compare maintenance, custom logic and spreadsheet recovery responsibilities.',
    h1: 'Should I save a Ritoko workflow or generate Playwright code?',
    shortAnswer:
      'Choose Playwright codegen when you want editable automation or test code and control over its application logic. Choose Ritoko when its supported workflow steps and built-in row journal fit a recurring spreadsheet operation. Both can execute saved actions without model inference.',
    table: {
      caption: 'Generated code and declarative business batches',
      columns: ['Decision', 'Ritoko', 'Playwright codegen'],
      rows: [
        [
          'Saved output',
          'JSON workflow with parameters and checks',
          'Editable code generated from browser interactions',
        ],
        [
          'Model needed for replay',
          'No LLM call in the direct engine itself',
          'Generated ordinary automation code needs no LLM',
        ],
        [
          'Custom behavior',
          'Limited to supported workflow schema',
          'Extend the generated program with your own code',
        ],
        [
          'Business-row recovery',
          'SQLite outcome journal and review holds',
          'Design persistence and recovery in your application',
        ],
      ],
      note: 'Codegen is an authoring tool; the generated program’s behavior depends on what you add.',
    },
    sections: [
      {
        id: 'when-codegen',
        heading: 'When is generated code the better starting point?',
        html: '<p>Playwright codegen records interactions and generates code with locators, prioritizing roles, text and test IDs. It can also record assertions. The documentation encourages inspecting and improving the generated test.</p><p>Choose this route when your deliverable is a maintained test suite or application code with custom branching and integration logic. You own the resulting program and can review it through your normal development process. <a href="https://playwright.dev/docs/codegen">Source: Playwright test generator</a>.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'When is a JSON workflow more convenient?',
        html: '<p>A repeated supplier import can have a fixed procedure and changing CSV rows. Ritoko saves that procedure with a stable business key, scope, commit and verification rules. Its journal stores the run’s workflow and input snapshot, skips normally confirmed keys and holds uncertain writes.</p><p>This reduces the amount of batch-state logic you need to author when the supported schema fits. It also limits expressiveness: a complex program should remain code when representing it as a fixed workflow would obscure the business rules.</p>',
      },
      {
        id: 'retry-vs-recover',
        heading: 'Why does retry behavior matter for production data?',
        html: '<p>For a real invoice creation, repeating the operation after a timeout can create another invoice if the first request succeeded. Whatever execution framework you choose, distinguish a failure before the write from an outcome lost after it. Store the business identity and verify the destination before deciding to resubmit.</p><p>Ritoko makes that boundary explicit. This is not a guarantee against all duplicates: independent writes, incorrect scopes and weak verification remain risks. With generated code, design the same policy in your application if you need it.</p>',
      },
      {
        id: 'migration',
        heading: 'Can I move a generated test into Ritoko?',
        html: '<p>There is no automatic Playwright-code importer in Ritoko. Translate only operations supported by its schema, then review selector uniqueness, parameters, side effects and checks. A recorded test’s constants do not automatically become a safe business key or destination scope.</p><p>Keep Playwright code when its custom behavior is the valuable part. Use a Ritoko workflow for a separately verified repetitive operation, and adopt any row already submitted during the demonstration before replaying it.</p>',
      },
    ],
    related: ['recurring-tasks-model-costs', 'resumable-csv-excel-batches', 'ritoko-vs-playwright-mcp'],
    sources: [source('Playwright: test generator', 'https://playwright.dev/docs/codegen')],
  },
  {
    ...base,
    slug: 'ritoko-vs-browser-use',
    metaTitle: 'Ritoko vs browser-use: saved batches or browser agents?',
    description:
      'Compare Ritoko’s saved row workflows with browser-use’s agent and history replay paths, including model usage and the business recovery you need to verify.',
    h1: 'When should I use Ritoko rather than browser-use?',
    shortAnswer:
      'Choose browser-use when you need an agent to work through unfamiliar or variable browser tasks. Choose Ritoko for a known, verifiable operation repeated over structured rows. browser-use also has saved-history replay, so replay alone is not the distinction.',
    table: {
      caption: 'Agent exploration, history replay and batch outcomes',
      columns: ['Decision', 'Ritoko', 'browser-use'],
      rows: [
        [
          'Starting point',
          'A saved procedure authored by an agent or person',
          'Browser-capable agent, CLI or hosted service',
        ],
        [
          'Execution options',
          'Local direct runner or compatible host execution',
          'Local/cloud browser options documented in the README',
        ],
        [
          'Replay',
          'Saved steps; no LLM in the direct engine itself',
          'Saved history with variable substitution; some replay work can use models',
        ],
        [
          'Spreadsheet recovery',
          'Input snapshot, row keys, statuses and review holds',
          'Verify or implement the required business-row policy for your deployment',
        ],
      ],
      note: 'Review covers the linked README and replay source, not every cloud feature or integration.',
    },
    sections: [
      {
        id: 'when-browser-use',
        heading: 'When is browser-use the better fit?',
        html: '<p>browser-use offers a Python agent library, a browser CLI for existing agents and a fully hosted cloud path. The README describes local or cloud browsers, custom tools, structured output and a choice of models.</p><p>That flexibility is useful when the site or next action varies. For example, researching a new supplier across unfamiliar pages is a different problem from entering known supplier rows through one fixed form. <a href="https://github.com/browser-use/browser-use">Source: browser-use README</a>.</p>',
      },
      {
        id: 'history-replay',
        heading: 'Does browser-use already replay saved work?',
        html: '<p>Yes. Its agent source includes <code>rerun_history</code> and <code>load_and_rerun</code>, including variable substitution. Replay supports retry controls; AI extraction steps and the final summary can use a model. It would be inaccurate to describe every browser-use execution as fresh reasoning for every action.</p><p>Check the exact replay options and actions your task uses. <a href="https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/agent/service.py">Source: browser-use agent implementation</a>.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'What does Ritoko add for a known row operation?',
        html: '<p>For a recurring customer import, Ritoko declares the input, business key, destination scope and checks in one workflow. Its local journal preserves confirmed items and holds an uncertain write rather than automatically trying that business operation again.</p><p>A direct run needs no model inside the replay engine, while recording and repair still use the author or agent. External MCP tools can invoke models. Choose this shape when explicit batch inputs and inspectable outcomes fit your operating process.</p>',
      },
      {
        id: 'combine-and-check',
        heading: 'How should I evaluate or combine them?',
        html: '<p>Use an agent to discover a task, then explicitly author the repeatable portion as supported Ritoko steps if useful. Ritoko has no automatic browser-use history importer. Verify any demonstrated write and adopt its row before replaying it.</p><p>Test the failure that matters: the destination accepts a write but its confirmation is lost. Ask where the business key and outcome persist, which actions can retry and how a person checks the result. Our source review does not establish an equivalent browser-use per-row recovery contract; that is a scope of evidence, not proof that a custom application cannot implement one. There is no measured cost or reliability ranking here.</p>',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'recurring-tasks-model-costs', 'ritoko-vs-skyvern'],
    sources: [
      source('browser-use: repository and usage paths', 'https://github.com/browser-use/browser-use'),
      source(
        'browser-use: history replay implementation',
        'https://raw.githubusercontent.com/browser-use/browser-use/main/browser_use/agent/service.py',
      ),
    ],
  },
  {
    ...base,
    slug: 'ritoko-vs-stagehand',
    metaTitle: 'Ritoko vs Stagehand: replay, caching and row recovery',
    description:
      'Compare Stagehand’s natural-language actions, replay and version-specific caches with Ritoko’s saved workflows and local business-row recovery journal.',
    h1: 'Should I use Stagehand or Ritoko for a recurring browser task?',
    shortAnswer:
      'Choose Stagehand for browser automation that combines natural-language discovery with code. Choose Ritoko when supported saved steps and a local spreadsheet outcome journal fit the job. Both have ways to avoid model inference during repeated execution; Stagehand’s cache behavior depends on its version and path.',
    table: {
      caption: 'Replay is shared; the surrounding workflow differs',
      columns: ['Decision', 'Ritoko', 'Stagehand'],
      rows: [
        [
          'Authoring',
          'Agent-authored JSON procedure',
          'Natural-language actions and discovered executable actions',
        ],
        [
          'Repeated execution',
          'Saved direct steps without its own LLM call',
          'Action replay and documented caching paths',
        ],
        [
          'Cache location',
          'No model-result cache required for saved direct steps',
          'v3 local filesystem cache; v4 server cache needs Browserbase',
        ],
        [
          'Row outcomes',
          'CSV/XLSX snapshot and durable item statuses',
          'Add or verify the business-row contract your application needs',
        ],
      ],
      note: 'Version-specific official docs checked 5 October 2026; do not assume v3 and v4 cache options are interchangeable.',
    },
    sections: [
      {
        id: 'when-stagehand',
        heading: 'When is Stagehand the more useful building block?',
        html: '<p>Stagehand’s <code>observe()</code> discovers executable actions that can be inspected before acting. Its documentation describes saving discovered actions to avoid repeated model calls. Pick that approach when you want discovery and explicit code in the same application, including work on variable pages. <a href="https://docs.stagehand.dev/v3/basics/observe">Source: Stagehand observe</a>.</p>',
      },
      {
        id: 'cache-versions',
        heading: 'Can Stagehand replay locally without inference?',
        html: '<p>Yes, there are documented replay paths. The v3 caching docs describe <code>cacheDir</code> filesystem caches for action and agent steps in LOCAL and BROWSERBASE environments. The v4 docs describe a Browserbase server cache, which does not apply to a local browser. v4 cache misses or unresolved cached selectors can fall back to inference.</p><p>Do not turn the v4 server-cache requirement into a claim that all local Stagehand replay needs a model. Check the installed version and exact API you use. Sources: <a href="https://docs.stagehand.dev/v3/best-practices/caching">v3 caching</a> and <a href="https://docs.stagehand.dev/v4/best-practices/caching">v4 caching</a>.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'When does Ritoko’s row journal become the deciding factor?',
        html: '<p>For a fixed invoice-entry procedure, a successful cache hit does not by itself answer whether yesterday’s invoice was submitted before a crash. Ritoko couples the saved actions to business keys, destination scopes and per-row verification. Its journal holds uncertain writes for review across later runs.</p><p>It pauses supported direct workflows for deliberate selector repair rather than independently choosing a replacement submit control. That can suit a process where changes must be inspected. It also requires someone to maintain the procedure when the UI changes. Correct keys, scopes and checks remain essential.</p>',
      },
      {
        id: 'combine',
        heading: 'Can discovery and durable batch execution be combined?',
        html: '<p>You can use a discovery tool to understand the UI, then explicitly author Ritoko’s supported steps. There is no built-in Stagehand-plan importer. A custom integration also needs a clear owner of the business write, verification and recovery decision.</p><p>Compare complete workflows on a representative small batch: authoring effort, verified outcomes, repair behavior and external service usage. Ritoko’s direct engine has no LLM client, but authoring, host orchestration and model-backed tools can still consume usage. This comparison does not measure either tool’s reliability or total cost.</p>',
      },
    ],
    related: ['robust-browser-selectors', 'recurring-tasks-model-costs', 'ritoko-vs-playwright-codegen'],
    sources: [
      source('Stagehand v3: observe and Action discovery', 'https://docs.stagehand.dev/v3/basics/observe'),
      source(
        'Stagehand v3: local and Browserbase caches',
        'https://docs.stagehand.dev/v3/best-practices/caching',
      ),
      source('Stagehand v4: server-cache contract', 'https://docs.stagehand.dev/v4/best-practices/caching'),
    ],
  },
  {
    ...base,
    slug: 'ritoko-vs-skyvern',
    metaTitle: 'Ritoko vs Skyvern: local batches or adaptive workflows?',
    description:
      'Compare Skyvern’s AI workflows and cached code with Ritoko’s local saved procedures, spreadsheet row journal and deliberate recovery of uncertain writes.',
    h1: 'When does a Ritoko batch fit better than a Skyvern workflow?',
    shortAnswer:
      'Choose Skyvern when you want AI browser workflows and automatic agent fallback from cached code. Choose Ritoko for a known local procedure with explicit row checks and review holds after uncertain writes. Skyvern also documents replay without inference, so that feature alone does not separate them.',
    table: {
      caption: 'Adaptive browser workflows and explicit local batches',
      columns: ['Decision', 'Ritoko', 'Skyvern'],
      rows: [
        ['Runtime shape', 'Local CLI, MCP server or agent plugin', 'SDK, cloud API and local-server options'],
        ['Replay without inference', 'Direct engine executes saved steps', 'Documented cached code path'],
        [
          'Page changes',
          'Eligible direct run pauses for deliberate repair',
          'Cached-code failure can fall back to the agent and regenerate cache',
        ],
        [
          'Spreadsheet work',
          'CSV/XLSX input with key, scope and row journal',
          'Workflow Loop and File Parser blocks include CSV/Excel handling',
        ],
      ],
      note: 'Cloud and self-hosted feature availability must be checked for the chosen Skyvern deployment.',
    },
    sections: [
      {
        id: 'when-skyvern',
        heading: 'When is Skyvern the better fit?',
        html: '<p>Skyvern’s README describes AI page commands, structured extraction and multi-step agent workflows, with SDK, cloud and local-server options. Its workflow documentation includes Loop and File Parser blocks for spreadsheet data.</p><p>Choose that broader workflow platform when the task needs adaptive browser reasoning and the chosen deployment provides the features you need. <a href="https://github.com/Skyvern-AI/skyvern">Source: Skyvern README</a>; <a href="https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/docs/cloud/building-agents/configure-blocks.mdx">source: workflow blocks</a>.</p>',
      },
      {
        id: 'cached-code',
        heading: 'Does Skyvern also avoid model calls on repeated work?',
        html: '<p>Its code-caching documentation describes recording a successful agent run, then executing cached code with <code>run_with="code"</code>. If the page changes and cached code fails, it can fall back to the agent and regenerate the cache. Some block types are not cached.</p><p>That is a real alternative to repeated inference, with adaptation that can consume model usage again. The source does not establish identical caching availability in every self-hosted deployment. <a href="https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/docs/developers/features/code-caching.mdx">Source: Skyvern code caching</a>.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'When is an explicit local batch simpler?',
        html: '<p>Use Ritoko when one known operation repeats across rows and its result has concrete evidence. Save the input schema, business key, scope, commit and checks. The local journal then distinguishes completed rows from safe failures and uncertain writes.</p><p>For example, invoice entry needs to know whether reference INV-1042 exists after the process stops. A replacement selector or automatic agent fallback does not itself resolve that question. Ritoko keeps the row held until its outcome is checked. This remains conditional on a correct workflow and covers this installation’s journal.</p>',
      },
      {
        id: 'evaluate',
        heading: 'What should I verify in a trial?',
        html: '<p>Try a representative small authorized workflow in the intended deployment. Examine which actions invoke a model, which run from cached code, where data and credentials live, and what happens when an accepted write loses its confirmation. Define who checks the destination and how a later run recognizes the same operation.</p><p>The linked Skyvern sources do not establish an equivalent per-business-row review hold across separate runs. That is a documentation boundary, not proof of absent capability. No price or reliability ranking is inferred here. A custom combination also needs one clear owner of each write and must never submit through a second path while the first result is uncertain.</p>',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'resumable-csv-excel-batches', 'ritoko-vs-browser-use'],
    sources: [
      source('Skyvern: repository and runtime options', 'https://github.com/Skyvern-AI/skyvern'),
      source(
        'Skyvern: cached code and fallback',
        'https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/docs/developers/features/code-caching.mdx',
      ),
      source(
        'Skyvern: Loop and File Parser blocks',
        'https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/docs/cloud/building-agents/configure-blocks.mdx',
      ),
    ],
  },
  {
    ...base,
    slug: 'ritoko-vs-taprun',
    metaTitle: 'Ritoko vs taprun: saved replay and write recovery',
    description:
      'Both tools save browser tasks for local replay. Compare Ritoko’s spreadsheet journal with taprun’s drift checks and uncertain intents, with source caveats.',
    h1: 'How does Ritoko compare with taprun for saved browser tasks?',
    shortAnswer:
      'Both save browser tasks for local replay without a live model choosing every action. Ritoko focuses on CSV/XLSX rows, explicit business keys and a local recovery journal. taprun documents drift verification, script converters and uncertain-intent resolution. Check its engine licensing and exact recovery semantics before adopting it.',
    table: {
      caption: 'Overlapping replay goals, different verified contracts',
      columns: ['Decision', 'Ritoko', 'taprun'],
      rows: [
        ['Saved representation', 'JSON workflow', 'JSON plan'],
        [
          'Browser path',
          'Personal Chrome or explicitly chosen clean profile',
          'README describes Chrome extension and Playwright paths; check version',
        ],
        [
          'Drift and maintenance',
          'Fallbacks and deliberate supported selector repair',
          'Documented verify verdicts and re-capture path',
        ],
        [
          'Uncertain write',
          'Review item resolved after a destination check',
          'Documented intent_uncertain and mark resolution',
        ],
        [
          'Spreadsheet recovery',
          'CSV/XLSX input and durable row outcomes',
          'Equivalent CSV/XLSX crash-resume contract not established by sources read',
        ],
        [
          'Engine licence',
          'MIT repository and runtime',
          'Public statements conflict; obtain clarification for the exact binary',
        ],
      ],
      note: 'taprun documentation is not an independent engine audit. Different vendor sources describe different runtime and licence scopes.',
    },
    sections: [
      {
        id: 'overlap',
        heading: 'What do the two approaches share?',
        html: '<p>taprun’s README describes capture into a saved plan, deterministic replay, local browser paths, drift checks and converters from Playwright, Puppeteer and Stagehand scripts. It is a relevant alternative for recurring browser work, not a tool that necessarily reasons through every repeated action. <a href="https://raw.githubusercontent.com/LeonTing1010/tap/main/README.md">Source: taprun README</a>.</p><p>Ritoko likewise separates discovering a task from executing supported saved steps. In both cases, inspect the actual task contract and the work still needed for authoring, maintenance and verification.</p>',
      },
      {
        id: 'when-taprun',
        heading: 'When might taprun be the more useful choice?',
        html: '<p>Consider it when its plan ecosystem, existing-script converters or explicit drift-check command fit your task. Its vendor index documents <code>verify</code> verdicts and <code>mark</code> to resolve an <code>intent_uncertain</code> run as committed or aborted. It would be unfair to claim that taprun has no uncertain-write handling. <a href="https://taprun.dev/llms.txt">Source: vendor tool index</a>.</p><p>Before a production write batch, verify what a key represents, how long any deduplication state lasts, whether uncertainty blocks later submissions and how state survives a crash. The sources read do not establish a matching spreadsheet row-resume contract.</p>',
      },
      {
        id: 'when-ritoko',
        heading: 'When is Ritoko’s spreadsheet contract a useful fit?',
        html: '<p>Choose Ritoko when the input is CSV/XLSX and the job is a known, verifiable operation per row. A workflow declares the key, destination scope, one irreversible commit and result checks. Its SQLite journal freezes the workflow and rows, normally skips confirmed keys and holds uncertain writes across later runs.</p><p>Direct replay contains no LLM call, but recording, repair, host orchestration and model-backed external tools can consume model usage. Ritoko’s evidence is limited too: controlled demos and tests do not establish reliability on every site, and its journal cannot track independent submissions.</p>',
      },
      {
        id: 'licence-caveat',
        heading: 'What remains uncertain about taprun’s licence?',
        html: '<p>The live homepage calls taprun MIT-licensed, while the public packages README describes the consuming Tap CLI as proprietary and closed-source. The main README limits its MIT statement to the extension and docs. These are conflicting primary-source statements about different parts of the distribution.</p><p>We therefore do not label the engine MIT, AGPL or proprietary as a settled conclusion. Check the exact binary’s terms with the maintainer before relying on a licence assumption. Sources: <a href="https://taprun.dev/">live homepage</a> and <a href="https://raw.githubusercontent.com/LeonTing1010/tap/main/packages/README.md">public packages and engine boundary</a>. No vendor benchmark or claimed cost advantage is treated as a measured comparison with Ritoko.</p>',
      },
    ],
    related: [
      'avoid-duplicate-csv-imports',
      'uncertain-writes-after-interruption',
      'ritoko-vs-playwright-codegen',
    ],
    sources: [
      source(
        'taprun: README and licence scope',
        'https://raw.githubusercontent.com/LeonTing1010/tap/main/README.md',
      ),
      source('taprun: verify and uncertain-intent verbs', 'https://taprun.dev/llms.txt'),
      source(
        'taprun: public packages and closed-engine statement',
        'https://raw.githubusercontent.com/LeonTing1010/tap/main/packages/README.md',
      ),
      source('taprun: live homepage licence statement', 'https://taprun.dev/'),
    ],
  },
]
