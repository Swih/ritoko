import { parseArgs } from 'node:util'
import { Browser } from './engine/browser.ts'
import { Ledger } from './engine/ledger.ts'
import { paths } from './engine/paths.ts'
import { type Outcome, Runner } from './engine/runner.ts'
import { Store } from './engine/store.ts'

const USAGE = `ritoko <command>

  mcp                                    start the MCP server (stdio), used by agent plugins
  list                                   saved workflows
  run <workflow> [--param k=v]… [--repeat] [--headless]
  resume <runId> [--headless]
  report [runId]                         latest run if omitted

Workflows and runs live in ${paths.workflows} and ${paths.runs}.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    param: { type: 'string', multiple: true, default: [] },
    repeat: { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (values.headless) process.env.RITOKO_HEADLESS = '1'

const [command, arg] = positionals
const browser = new Browser()
const runner = new Runner(browser, new Ledger(paths.db), new Store())

function print(outcome: Outcome): void {
  const { report } = outcome
  const counts = Object.entries(report.counts)
    .map(([status, n]) => `${status} ${n}`)
    .join(' · ')
  console.log(`${report.runId}  ${outcome.status}  ${(report.durationMs / 1000).toFixed(1)}s  ${counts}`)
  for (const item of report.items.filter((i) => i.status !== 'done'))
    console.log(`  #${item.idx + 1} ${item.key}: ${item.status}${item.message ? ` — ${item.message}` : ''}`)
  if (outcome.status === 'needs_repair')
    console.log(
      `\nStep "${outcome.stepId}" needs repair: ${outcome.error}\nAsk your agent to repair it, then: ritoko resume ${report.runId}`,
    )
  if (report.message && outcome.status !== 'needs_repair') console.log(report.message)
  console.log(`Evidence: ${report.dir}`)
}

try {
  switch (command) {
    case 'list':
      for (const w of await runner.store.list()) console.log(`${w.name}  v${w.version}  ${w.description}`)
      break
    case 'run': {
      if (!arg) throw new Error('run needs a workflow name')
      const params = Object.fromEntries(
        (values.param as string[]).map((p) => {
          const at = p.indexOf('=')
          if (at < 1) throw new Error(`--param expects k=v, got "${p}"`)
          return [p.slice(0, at), p.slice(at + 1)]
        }),
      )
      print(await runner.start(arg, params, { repeat: values.repeat }))
      break
    }
    case 'resume':
      if (!arg) throw new Error('resume needs a run id')
      print(await runner.resume(arg))
      break
    case 'report': {
      const id = arg ?? runner.ledger.lastRun()?.id
      if (!id) throw new Error('No run yet')
      console.log(JSON.stringify(runner.report(id), null, 2))
      break
    }
    default:
      console.log(USAGE)
  }
} catch (error) {
  console.error(`ritoko: ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
