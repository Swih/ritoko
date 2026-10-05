import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { paths } from './engine/paths.ts'
import type { Outcome } from './engine/runner.ts'

const USAGE = `ritoko <command>

  mcp                                    start the MCP server (stdio), used by agent plugins
  list                                   saved workflows
  import <workflow.json>                  validate and save a workflow
  run <workflow> [--param k=v]… [--repeat] [--headless]
  resume <runId> [--headless]
  reconcile <runId> <key>                read the frozen ensure lookup to settle an original review item
  report [runId]                         latest run if omitted
  resolve <runId> <key> done|failed --note "site check" --confirm-checked
                                         only once the record was checked at the destination
  cancel <runId>                         stop a run for good; unsubmitted items fail as cancelled
  doctor [--json]                        check Node.js, the journal, dependencies and Chrome; starts no browser
  browser-close                          close Ritoko's Chrome explicitly
  host start <workflow> [--param k=v]… [--parallel 1..4]  print a host batch (requires script-capable browser tools)
  host next <runId> [--result <json>]    report {batch, results} of the last batch, get the next one

Workflows and runs live in ${paths.workflows} and ${paths.runs}.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    param: { type: 'string', multiple: true, default: [] },
    repeat: { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    note: { type: 'string' },
    'confirm-checked': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    result: { type: 'string' },
    parallel: { type: 'string' },
  },
})
if (values.headless) process.env.RITOKO_HEADLESS = '1'

const [command, arg] = positionals

function print(outcome: Outcome): void {
  const { report } = outcome
  const counts = Object.entries(report.counts)
    .map(([status, n]) => `${status} ${n}`)
    .join(' · ')
  console.log(`${report.runId}  ${outcome.status}  ${(report.durationMs / 1000).toFixed(1)}s  ${counts}`)
  for (const warning of report.warnings) console.log(`Warning: ${warning}`)
  // A done item has a message only when it needs a look: resolved by hand, or submitted through a fallback.
  const listed = report.items.filter((i) => i.status !== 'done' || i.message)
  for (const item of listed.slice(0, 10))
    console.log(`  #${item.idx + 1} ${item.key}: ${item.status}${item.message ? ` — ${item.message}` : ''}`)
  if (listed.length > 10)
    console.log(`  … and ${listed.length - 10} more (see \`ritoko report ${report.runId}\`)`)
  if (report.manualResolutions)
    console.log(`Resolved by hand, not verified by Ritoko: ${report.manualResolutions}`)
  for (const f of report.fallbacks)
    if (!f.commit) console.log(`Step "${f.stepId}" matched through fallback ${f.index}: ${f.selector}`)
  if (outcome.status === 'needs_repair')
    console.log(
      `\nStep "${outcome.stepId}" needs repair: ${outcome.error}\nAsk your agent to repair it, then: ritoko resume ${report.runId}`,
    )
  if (report.message && outcome.status !== 'needs_repair') console.log(report.message)
  for (const [name, file] of Object.entries(report.files)) console.log(`${name}: ${file}`)
  console.log(`Evidence: ${report.dir}`)
  if (outcome.status !== 'done') process.exitCode = 2
}

if (command === 'doctor' && !values.help) {
  // Loaded before anything that needs node:sqlite or playwright-core, or creates Ritoko's home: it checks them.
  const { diagnose, format } = await import('./engine/doctor.ts')
  const checks = await diagnose()
  const ok = !checks.some((c) => c.status === 'fail')
  console.log(values.json ? JSON.stringify({ ok, checks }, null, 2) : format(checks))
  if (!ok) process.exitCode = 1
} else await main()

async function main(): Promise<void> {
  const [{ Browser }, { Host }, { Ledger }, { Runner }, { Store }] = await Promise.all([
    import('./engine/browser.ts'),
    import('./engine/host.ts'),
    import('./engine/ledger.ts'),
    import('./engine/runner.ts'),
    import('./engine/store.ts'),
  ])
  const browser = new Browser()
  const runner = new Runner(browser, new Ledger(paths.db), new Store())
  let host: InstanceType<typeof Host> | undefined

  try {
    switch (values.help ? undefined : command) {
      case 'list':
        for (const w of await runner.store.list()) console.log(`${w.name}  v${w.version}  ${w.description}`)
        break
      case 'import':
        if (!arg) throw new Error('import needs a workflow JSON path')
        console.log(
          JSON.stringify(
            await runner.ledger.exclusive(async () =>
              runner.store.save(JSON.parse(await readFile(arg, 'utf8'))),
            ),
            null,
            2,
          ),
        )
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
        if (id) console.log(JSON.stringify(runner.report(id), null, 2))
        else console.log('No run recorded. Start one with: ritoko run <workflow>')
        break
      }
      case 'resolve': {
        const [, runId, key, status] = positionals
        if (!runId || !key || (status !== 'done' && status !== 'failed') || !values.note)
          throw new Error(
            'resolve needs <runId> <key> done|failed --note "what was checked on the site" --confirm-checked',
          )
        const confirmChecked = values['confirm-checked']
        console.log(
          JSON.stringify(await runner.resolve(runId, key, status, values.note, { confirmChecked }), null, 2),
        )
        break
      }
      case 'reconcile': {
        const [, runId, key] = positionals
        if (!runId || !key) throw new Error('reconcile needs <runId> <key>')
        console.log(JSON.stringify(await runner.reconcile(runId, key), null, 2))
        break
      }
      case 'browser-close':
        await runner.ledger.exclusive(async () => browser.shutdown())
        break
      case 'host': {
        host = new Host(runner.ledger, runner.store)
        const [, sub, target] = positionals
        if (sub === 'start' && target) {
          const params = Object.fromEntries(
            (values.param as string[]).map((p) => {
              const at = p.indexOf('=')
              if (at < 1) throw new Error(`--param expects k=v, got "${p}"`)
              return [p.slice(0, at), p.slice(at + 1)]
            }),
          )
          const started = await host.start(target, params, {
            parallel: values.parallel === undefined ? 1 : Number(values.parallel),
          })
          const { warnings } = runner.report(started.runId)
          console.log(JSON.stringify(warnings.length ? { ...started, warnings } : started))
        } else if (sub === 'next' && target) {
          const input = values.result ? JSON.parse(values.result) : undefined
          console.log(JSON.stringify(await host.next(target, input)))
        } else throw new Error('host start <workflow> | host next <runId> [--result <json>]')
        break
      }
      case 'cancel':
        if (!arg) throw new Error('cancel needs a run id')
        console.log(JSON.stringify(await runner.cancel(arg), null, 2))
        break
      default:
        console.log(USAGE)
    }
  } catch (error) {
    console.error(`ritoko: ${(error as Error).message}`)
    process.exitCode = 1
  } finally {
    await host?.close()
    await browser.close()
    runner.ledger.db.close()
  }
}
