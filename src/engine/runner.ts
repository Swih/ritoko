import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import type { Browser } from './browser.ts'
import { readItems } from './items.ts'
import type { Cause, ItemRow, Ledger, Run } from './ledger.ts'
import { resolve, SelectorError } from './locate.ts'
import { paths } from './paths.ts'
import type { Step, Workflow } from './schema.ts'
import type { Store } from './store.ts'
import { render, type Scope } from './template.ts'

const MAX_CONSECUTIVE_FAILURES = 3

export class VerificationError extends Error {}

export type Report = {
  runId: string
  workflow: string
  version: number
  status: Run['status']
  message: string | null
  durationMs: number
  counts: Partial<Record<ItemRow['status'], number>>
  items: Pick<ItemRow, 'idx' | 'key' | 'status' | 'cause' | 'message' | 'evidence'>[]
  dir: string
}

export type Outcome =
  | { status: 'done' | 'stopped'; report: Report }
  | {
      status: 'needs_repair'
      runId: string
      workflow: string
      stepId: string
      itemKey?: string
      error: string
      snapshot: string
      report: Report
    }

type Pause = { stepId: string; error: SelectorError }

/**
 * Executes workflows deterministically, without any LLM. A selector that no longer matches pauses the run
 * (status `needs_repair`) and leaves the page as is, so an agent can repair the step and resume.
 */
export class Runner {
  /** Runs whose browser state is still live in this process (paused, not crashed). */
  #live = new Set<string>()
  /** Selector index that last worked, per run and step: skips known-broken primaries. */
  #preferred = new Map<string, number>()

  readonly browser: Browser
  readonly ledger: Ledger
  readonly store: Store

  constructor(browser: Browser, ledger: Ledger, store: Store) {
    this.browser = browser
    this.ledger = ledger
    this.store = store
  }

  async start(name: string, params: Record<string, string> = {}, { repeat = false } = {}): Promise<Outcome> {
    const wf = await this.store.get(name)
    const resolved: Record<string, string> = {}
    for (const [key, spec] of Object.entries(wf.params)) {
      const value = params[key] ?? spec.default
      if (value === undefined && spec.required) throw new Error(`Missing param "${key}": ${spec.description}`)
      if (value !== undefined) resolved[key] = value
    }
    const unknown = Object.keys(params).filter((k) => !(k in wf.params))
    if (unknown.length) throw new Error(`Unknown params: ${unknown.join(', ')}`)
    const run = this.ledger.createRun(wf.name, wf.version, resolved, repeat)
    return this.#execute(run.id)
  }

  resume(runId: string): Promise<Outcome> {
    return this.#execute(runId)
  }

  report(runId: string): Report {
    const run = this.ledger.run(runId)
    const items = this.ledger.items(runId)
    const counts: Report['counts'] = {}
    for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1
    return {
      runId,
      workflow: run.workflow,
      version: run.version,
      status: run.status,
      message: run.message,
      durationMs: Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt),
      counts,
      items: items.map(({ idx, key, status, cause, message, evidence }) => ({
        idx,
        key,
        status,
        cause,
        message,
        evidence,
      })),
      dir: this.#dir(runId),
    }
  }

  async #execute(runId: string): Promise<Outcome> {
    let run = this.ledger.run(runId)
    if (run.status === 'done') return { status: 'done', report: this.report(runId) }
    const wf = await this.store.get(run.workflow)
    this.ledger.updateRun(runId, { status: 'running', version: wf.version, message: null })
    const page = await this.browser.page()
    const live = this.#live.has(runId)
    this.#live.add(runId)
    const scope: Scope = { param: run.params, files: { ...run.files }, item: {} }

    try {
      // Setup: after a crash the page state is gone, so setup always restarts from its first step.
      if (run.phase === 'setup' || !live) {
        const from = run.phase === 'setup' && live ? run.step : 0
        const pause = await this.#phase(run, 'setup', wf.setup, from, page, scope)
        if (pause) return this.#pause(run, pause, page)
        if (wf.items && this.ledger.items(runId).length === 0) {
          const rows = await readItems(render(wf.items.from, scope), wf.items.sheet)
          this.ledger.addItems(
            runId,
            rows.map((data) => ({ key: render(wf.items?.key ?? '', { ...scope, item: data }), data })),
          )
        }
        if (run.phase === 'setup') this.ledger.updateRun(runId, { phase: 'items', step: 0 })
        run = this.ledger.run(runId)
      }

      if (run.phase === 'items') {
        const pause = await this.#items(run, wf, page, scope)
        if (pause) return this.#pause(run, pause, page)
        if (this.ledger.run(runId).status === 'stopped') return this.#finish(runId, 'stopped')
        this.ledger.updateRun(runId, { phase: 'teardown', step: 0 })
        run = this.ledger.run(runId)
      }

      const pause = await this.#phase(run, 'teardown', wf.teardown, live ? run.step : 0, page, scope)
      if (pause) return this.#pause(run, pause, page)
      await page.screenshot({ path: join(this.#dir(runId), 'final.png') }).catch(() => {})
      return this.#finish(runId, 'done')
    } catch (error) {
      this.ledger.updateRun(runId, { status: 'stopped', message: (error as Error).message })
      return this.#finish(runId, 'stopped')
    }
  }

  async #phase(run: Run, phase: 'setup' | 'teardown', steps: Step[], from: number, page: Page, scope: Scope) {
    for (let i = from; i < steps.length; i++) {
      const step = steps[i] as Step
      this.ledger.updateRun(run.id, { phase, step: i })
      try {
        await this.#step(run.id, step, page, scope)
      } catch (error) {
        if (error instanceof SelectorError) return { stepId: step.id, error } satisfies Pause
        throw new Error(`${phase} step "${step.id}" failed: ${(error as Error).message}`)
      }
    }
    return undefined
  }

  async #items(run: Run, wf: Workflow, page: Page, scope: Scope): Promise<Pause | undefined> {
    let failures = 0
    for (const item of this.ledger.items(run.id)) {
      if (!['pending', 'running', 'paused'].includes(item.status)) continue
      const update = (patch: Parameters<Ledger['updateItem']>[2]) =>
        this.ledger.updateItem(run.id, item.idx, patch)

      // Interrupted mid-item (crash): replay only if nothing irreversible happened.
      if (item.status === 'running' && item.committed) {
        update({
          status: 'review',
          cause: 'interrupted',
          message: 'Interrupted after the commit step: check on the site whether it went through.',
        })
        continue
      }
      const previous = run.repeat ? undefined : this.ledger.completedElsewhere(wf.name, item.key, run.id)
      if (previous) {
        update({ status: 'skipped', cause: 'duplicate', message: `Already done in run ${previous}` })
        continue
      }

      scope.item = item.data
      let committed = item.status === 'paused' && item.committed
      update({ status: 'running', attempts: item.attempts + 1 })
      for (let i = item.status === 'paused' ? item.step : 0; i < wf.item.length; i++) {
        const step = wf.item[i] as Step
        if (step.commit) committed = true
        update({ step: i, committed })
        try {
          await this.#step(run.id, step, page, scope)
        } catch (error) {
          if (error instanceof SelectorError) {
            update({
              status: 'paused',
              message: error.message,
              evidence: await this.#shot(page, run.id, item, 'paused'),
            })
            return { stepId: step.id, error }
          }
          const cause: Cause = error instanceof VerificationError ? 'verification' : 'system'
          update({
            status: committed && cause === 'system' ? 'review' : 'failed',
            cause,
            message: `${step.id}: ${(error as Error).message.split('\n')[0]}`,
            evidence: await this.#shot(page, run.id, item, 'failed'),
          })
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.ledger.updateRun(run.id, {
              status: 'stopped',
              message: `${failures} consecutive item failures`,
            })
            return undefined
          }
          break
        }
        if (i === wf.item.length - 1) {
          update({ status: 'done', cause: null, message: null })
          failures = 0
        }
      }
    }
    return undefined
  }

  async #step(runId: string, step: Step, page: Page, scope: Scope): Promise<void> {
    const text = (s: string) => render(s, scope)
    const cacheKey = `${runId}:${step.id}`
    const locate = async (state: 'visible' | 'attached' = 'visible') => {
      if (!('target' in step) || !step.target) throw new Error(`Step "${step.id}" needs a target`)
      const { locator, index } = await resolve(page, step.target, {
        state,
        start: this.#preferred.get(cacheKey),
      })
      this.#preferred.set(cacheKey, index)
      return locator
    }

    switch (step.do) {
      case 'goto':
        await page.goto(text(step.url))
        return
      case 'click':
        await (await locate()).click()
        return
      case 'fill': {
        const field = await locate()
        const value = text(step.value)
        await field.fill(value)
        if ((await field.inputValue()) !== value)
          throw new VerificationError(`Field did not keep the value "${value}"`)
        return
      }
      case 'select':
        await (await locate()).selectOption(text(step.value))
        return
      case 'check':
        await (await locate()).setChecked(step.checked)
        return
      case 'press':
        if (step.target) await (await locate()).press(step.key)
        else await page.keyboard.press(step.key)
        return
      case 'upload':
        await (await locate('attached')).setInputFiles(text(step.file))
        return
      case 'download': {
        const target = await locate()
        const [download] = await Promise.all([page.waitForEvent('download'), target.click()])
        const file = join(this.#dir(runId), step.saveAs)
        await download.saveAs(file)
        scope.files[step.saveAs] = file
        this.ledger.updateRun(runId, { files: scope.files })
        return
      }
      case 'wait':
        if (step.target) await locate()
        else await page.waitForTimeout(step.ms ?? 1_000)
        return
      case 'expect':
        return this.#expect(step, page, text, locate)
    }
  }

  async #expect(
    step: Extract<Step, { do: 'expect' }>,
    page: Page,
    text: (s: string) => string,
    locate: () => Promise<Locator>,
  ): Promise<void> {
    const timeout = 10_000
    const fail = (what: string) => {
      throw new VerificationError(`Expected ${what}`)
    }
    if (step.url) {
      const url = text(step.url)
      await page
        .waitForURL((u) => u.href.includes(url), { timeout })
        .catch(() => fail(`URL containing "${url}"`))
    }
    if (step.text !== undefined) {
      const wanted = text(step.text)
      const scopeLoc = step.target ? await locate() : page.locator('body')
      await scopeLoc
        .getByText(wanted)
        .first()
        .waitFor({ timeout })
        .catch(() => fail(`text "${wanted}"`))
    }
    if (step.value !== undefined) {
      const wanted = text(step.value)
      const field = await locate()
      const deadline = Date.now() + timeout
      while ((await field.inputValue()) !== wanted) {
        if (Date.now() > deadline) fail(`value "${wanted}"`)
        await page.waitForTimeout(200)
      }
    }
  }

  async #pause(run: Run, pause: Pause, page: Page): Promise<Outcome> {
    this.ledger.updateRun(run.id, { status: 'paused', message: `Needs repair at step "${pause.stepId}"` })
    const item = this.ledger.items(run.id).find((i) => i.status === 'paused')
    return {
      status: 'needs_repair',
      runId: run.id,
      workflow: run.workflow,
      stepId: pause.stepId,
      itemKey: item?.key,
      error: pause.error.message,
      snapshot: await page.ariaSnapshot({ mode: 'ai' }),
      report: this.report(run.id),
    }
  }

  #finish(runId: string, status: 'done' | 'stopped'): Outcome {
    this.ledger.updateRun(runId, { status })
    this.#live.delete(runId)
    return { status, report: this.report(runId) }
  }

  async #shot(page: Page, runId: string, item: ItemRow, label: string): Promise<string | null> {
    const file = join(this.#dir(runId), `item-${item.idx + 1}-${label}.png`)
    return page
      .screenshot({ path: file })
      .then(() => file)
      .catch(() => null)
  }

  #dir(runId: string): string {
    const dir = join(paths.runs, runId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
}
