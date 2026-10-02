import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Page } from 'playwright-core'
import { z } from 'zod'
import { Browser } from '../engine/browser.ts'
import { download } from '../engine/download.ts'
import { Ledger } from '../engine/ledger.ts'
import { candidates, describe } from '../engine/locate.ts'
import { home, paths } from '../engine/paths.ts'
import { Runner } from '../engine/runner.ts'
import { type Step, type StepBody, Target, Workflow } from '../engine/schema.ts'
import { Store } from '../engine/store.ts'

const browser = new Browser()
const store = new Store()
const runner = new Runner(browser, new Ledger(paths.db), store)
const recording: Step[] = []

const server = new McpServer({ name: 'ritoko', version: '0.1.0' })

const block = (value: unknown) => ({
  type: 'text' as const,
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
})
const text = (value: unknown) => ({ content: [block(value)] })

async function snapshot(page: Page): Promise<string> {
  return `url: ${page.url()}\ntitle: ${await page.title()}\n\n${await page.ariaSnapshot({ mode: 'ai' })}`
}

function record(step: StepBody): Step {
  const full = { id: `s${recording.length + 1}`, ...step } as Step
  recording.push(full)
  return full
}

server.registerTool(
  'browser_open',
  {
    description:
      "Open a URL in Ritoko's Chrome (dedicated profile: logins persist across runs) and return an accessibility snapshot with [ref=…] ids. Recorded as a goto step.",
    inputSchema: { url: z.string().url() },
    annotations: { openWorldHint: true },
  },
  async ({ url }) => {
    const page = await browser.page()
    await page.goto(url)
    record({ do: 'goto', url })
    return text(await snapshot(page))
  },
)

server.registerTool(
  'browser_snapshot',
  {
    description: 'Accessibility snapshot of the current page, with [ref=…] ids usable by browser_act.',
    annotations: { readOnlyHint: true },
  },
  async () => text(await snapshot(await browser.page())),
)

const Action = z.object({
  do: z.enum(['click', 'fill', 'select', 'check', 'press', 'upload', 'download', 'inspect']),
  ref: z
    .string()
    .optional()
    .describe('Element ref from the latest snapshot (e.g. "e12"). Optional for press.'),
  value: z.string().optional().describe('fill/select: the value. upload: file path.'),
  key: z.string().optional().describe('press: key such as "Enter".'),
  checked: z.boolean().optional(),
  saveAs: z.string().optional().describe('download: file name, later usable as {{files.<saveAs>}}.'),
})

server.registerTool(
  'browser_act',
  {
    description:
      'Perform one or more actions on elements of the current page, by ref. Each action is recorded as a step whose target holds robust selectors (role, label, visible text… verified unique) computed by Ritoko. "inspect" only returns the selector candidates. Batch several actions in one call.',
    inputSchema: { actions: z.array(Action).min(1), snapshot: z.boolean().default(true) },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async ({ actions, snapshot: wantSnapshot }) => {
    const page = await browser.page()
    const results: unknown[] = []
    for (const a of actions) {
      if (a.do === 'press' && !a.ref) {
        await page.keyboard.press(a.key ?? 'Enter')
        results.push(record({ do: 'press', key: a.key ?? 'Enter' }))
        continue
      }
      if (!a.ref) throw new Error(`"${a.do}" needs a ref`)
      const found = await candidates(page, a.ref)
      if (a.do === 'inspect') {
        results.push({ ref: a.ref, candidates: found })
        continue
      }
      const element = page.locator(`aria-ref=${a.ref}`)
      const value = a.value ?? ''
      let saveAs: string | undefined
      switch (a.do) {
        case 'click':
          await element.click()
          break
        case 'fill':
          await element.fill(value)
          break
        case 'select':
          await element.selectOption(value)
          break
        case 'check':
          await element.setChecked(a.checked ?? true)
          break
        case 'press':
          await element.press(a.key ?? 'Enter')
          break
        case 'upload':
          await element.setInputFiles(value)
          break
        case 'download': {
          const dir = join(home, 'recordings')
          mkdirSync(dir, { recursive: true })
          saveAs = basename(await download(page, element, dir, a.saveAs))
          break
        }
      }
      const [primary, ...fallbacks] = found
      if (!primary) {
        results.push({
          warning: `Action done, but no robust selector found for ${a.ref}: write the target by hand.`,
          action: a,
        })
        continue
      }
      const target = { primary, fallbacks: fallbacks.slice(0, 2) }
      const step = {
        click: { do: 'click', target },
        fill: { do: 'fill', target, value },
        select: { do: 'select', target, value },
        check: { do: 'check', target, checked: a.checked ?? true },
        press: { do: 'press', target, key: a.key ?? 'Enter' },
        upload: { do: 'upload', target, file: value },
        download: { do: 'download', target, saveAs: saveAs ?? 'download' },
      }[a.do] as StepBody
      results.push({ step: record(step), selectors: found.map(describe) })
    }
    return { content: wantSnapshot ? [block(results), block(await snapshot(page))] : [block(results)] }
  },
)

server.registerTool(
  'recording',
  {
    description:
      'Steps recorded since the last clear (goto, act). Use them to write the workflow: replace literal values with {{item.Column}} or {{param.name}}, add expect steps, mark the submit step commit: true.',
    inputSchema: { clear: z.boolean().default(false) },
  },
  async ({ clear }) => {
    const steps = [...recording]
    if (clear) recording.length = 0
    return text(steps)
  },
)

server.registerTool(
  'workflow_save',
  {
    description:
      'Validate and save a workflow (new version on each save). Returns warnings to fix (missing verification, missing commit step, fragile selectors).',
    inputSchema: { workflow: Workflow },
  },
  async ({ workflow }) => text(await store.save(workflow)),
)

server.registerTool(
  'workflow_list',
  { description: 'List saved workflows.', annotations: { readOnlyHint: true } },
  async () => text(await store.list()),
)

server.registerTool(
  'workflow_get',
  {
    description: 'Get a saved workflow.',
    inputSchema: { name: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ name }) => text(await store.get(name)),
)

server.registerTool(
  'run_start',
  {
    description:
      'Run a saved workflow deterministically (no LLM). Items already done by a previous run are skipped unless repeat is true. Returns a report, or status "needs_repair" with the failing step and a page snapshot: then fix it with step_repair and call run_resume.',
    inputSchema: {
      workflow: z.string(),
      params: z.record(z.string(), z.string()).default({}),
      repeat: z.boolean().default(false),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async ({ workflow, params, repeat }) => text(await runner.start(workflow, params, { repeat })),
)

server.registerTool(
  'run_resume',
  {
    description:
      'Resume a paused or interrupted run. Done items are kept; an item interrupted after its commit step is marked "review", never replayed blindly.',
    inputSchema: { runId: z.string() },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async ({ runId }) => text(await runner.resume(runId)),
)

server.registerTool(
  'run_report',
  {
    description:
      'Per-item report of a run (latest run if no id): done, failed, review, skipped, with evidence.',
    inputSchema: { runId: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ runId }) => {
    const id = runId ?? runner.ledger.lastRun()?.id
    if (!id) throw new Error('No run yet')
    return text(runner.report(id))
  },
)

server.registerTool(
  'step_repair',
  {
    description:
      'Replace the target of a workflow step (after needs_repair). Use browser_act with do "inspect" to get verified selectors first. Saves a new workflow version.',
    inputSchema: { workflow: z.string(), stepId: z.string(), target: Target },
  },
  async ({ workflow, stepId, target }) => text(await store.repair(workflow, stepId, target)),
)

process.on('SIGINT', () => browser.close().finally(() => process.exit(0)))
await server.connect(new StdioServerTransport())
