import { mkdirSync } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { resolve as absolute, basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import type { Browser } from './browser.ts'
import { withDialogs } from './dialog.ts'
import { bounded, download } from './download.ts'
import { extract } from './extract.ts'
import { readItems } from './items.ts'
import type { Cause, ItemRow, Ledger, Run } from './ledger.ts'
import { resolve, SelectorError } from './locate.ts'
import { paths } from './paths.ts'
import { type Step, Target, Workflow } from './schema.ts'
import { check, type Store } from './store.ts'
import { references, render, renderSelector, type Scope } from './template.ts'

const MAX_CONSECUTIVE_FAILURES = 3

/** Value of an input, textarea or select, or the text of a contenteditable field. */
const fieldValue = (field: Locator) => field.inputValue().catch(() => field.innerText())
const normalize = (s: string) => s.replace(/\s+/g, ' ')
const timeOrigin = (page: Page) =>
  bounded(
    page.evaluate(() => performance.timeOrigin),
    'The page',
  )
const mask = (text: string, scope: Scope) =>
  (scope.secrets ?? []).reduce((masked, secret) => masked.replaceAll(secret, '***'), text)

/** Real path of `file` (relative to `dir`), required to lie inside `dir`: item data cannot pick any local file. */
async function confine(file: string, dir: string | undefined): Promise<string> {
  if (!dir) throw new Error('Upload paths from item data need an input file')
  const [root, actual] = await Promise.all([realpath(dir), realpath(absolute(dir, file))])
  const path = relative(root, actual)
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new Error(`Upload paths from item data must stay inside ${root}, the folder of the input file`)
  return actual
}

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
  /** Downloaded and extracted files by saveAs name. */
  files: Record<string, string>
  dir: string
}

export type Outcome =
  | { status: 'done' | 'partial' | 'stopped'; report: Report }
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

type Pause = { stepId: string; error: SelectorError; phase?: 'setup' | 'teardown' }

/**
 * Executes workflows deterministically, without any LLM. A selector that no longer matches pauses the run
 * (status `needs_repair`) and leaves the page as is, so an agent can repair the step and resume.
 */
export class Runner {
  /** Runs whose browser state is still live in this process (paused, not crashed). */
  #live = new Map<string, { page: Page; document: number }>()
  /** Selector index that last worked, per run and step: skips known-broken primaries. */
  #preferred = new Map<string, number>()

  readonly browser: Pick<Browser, 'page'>
  readonly ledger: Ledger
  readonly store: Store
  readonly runsDir: string
  /** Refuse relative local paths (MCP server: its working directory means nothing to the agent). */
  readonly absolutePaths: boolean

  constructor(
    browser: Pick<Browser, 'page'>,
    ledger: Ledger,
    store: Store,
    runsDir = paths.runs,
    { absolutePaths = false } = {},
  ) {
    this.browser = browser
    this.ledger = ledger
    this.store = store
    this.runsDir = runsDir
    this.absolutePaths = absolutePaths
  }

  async start(name: string, params: Record<string, string> = {}, { repeat = false } = {}): Promise<Outcome> {
    return this.ledger.exclusive(async () => this.#start(name, params, repeat))
  }

  async #start(name: string, params: Record<string, string>, repeat: boolean): Promise<Outcome> {
    const wf = await this.store.get(name)
    check(wf)
    const resolved = this.#params(wf, params)
    this.#secrets(wf)
    const scope = render(wf.items?.scope ?? '', { param: resolved, files: {}, item: {} })
    const run = this.ledger.createRun(wf.name, wf.version, resolved, repeat, wf, scope)
    return this.#execute(run.id)
  }

  /** Params journaled with the run: all but secrets, which come from the environment. */
  #params(wf: Workflow, params: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {}
    for (const [key, spec] of Object.entries(wf.params)) {
      if (spec.secret) {
        if (Object.hasOwn(params, key))
          throw new Error(
            `Param "${key}" is secret: set environment variable ${spec.env} instead of passing it`,
          )
        continue
      }
      const value = (Object.hasOwn(params, key) ? params[key] : undefined) ?? spec.default
      if (spec.required && (value === undefined || !value.trim()))
        throw new Error(`Missing param "${key}"${spec.description ? `: ${spec.description}` : ''}`)
      if (value !== undefined) resolved[key] = value
    }
    const unknown = Object.keys(params).filter((k) => !Object.hasOwn(wf.params, k))
    if (unknown.length) throw new Error(`Unknown params: ${unknown.join(', ')}`)
    return resolved
  }

  /** Secret params, read from their environment variables on every start, resume and adoption. */
  #secrets(wf: Workflow): Record<string, string> {
    const secrets: Record<string, string> = {}
    for (const [key, spec] of Object.entries(wf.params)) {
      if (!spec.secret || !spec.env) continue
      const value = process.env[spec.env]
      if (value) secrets[key] = value
      else if (spec.required)
        throw new Error(`Set environment variable ${spec.env} for secret param "${key}"`)
    }
    return secrets
  }

  #scope(wf: Workflow, params: Record<string, string>, files: Record<string, string>): Scope {
    const secrets = this.#secrets(wf)
    return {
      param: { ...params, ...secrets },
      files: { ...files },
      item: {},
      secrets: Object.values(secrets),
    }
  }

  /** A local file path: relative paths resolve against the working directory, unless absolute ones are required. */
  #local(path: string): string {
    if (isAbsolute(path)) return path
    if (this.absolutePaths)
      throw new Error(
        `"${path}" is a relative path: pass an absolute one (here it would mean ${absolute(path)})`,
      )
    return absolute(path)
  }

  /** Journal the first real recorded submission by running only its confirmation steps. */
  adopt(
    name: string,
    params: Record<string, string>,
    data: Record<string, string>,
    note: string,
  ): Promise<Outcome> {
    return this.ledger.exclusive(async () => {
      if (!note.trim()) throw new Error('Adoption needs a note describing the recorded submission')
      const wf = await this.store.get(name)
      check(wf)
      if (!wf.items || wf.readOnly) throw new Error('Adoption is for a recorded write-batch item')
      const resolved = this.#params(wf, params)
      const scope: Scope = { ...this.#scope(wf, resolved, {}), item: data }
      const key = render(wf.items.key, scope).trim()
      if (!key) throw new Error('Empty business key')
      const identity = render(wf.items.scope, scope)
      if (this.ledger.barrier(wf.name, identity, key, ''))
        throw new Error('This key already has a journal entry; inspect or resolve that run instead')
      const run = this.ledger.createRun(wf.name, wf.version, resolved, false, wf, identity)
      this.ledger.addItems(run.id, [{ key, data }])
      this.ledger.updateRun(run.id, { phase: 'items' })
      this.ledger.updateItem(run.id, 0, { status: 'running', committed: true, attempts: 1 })
      this.ledger.event(run.id, 'adopt', { key, note })
      try {
        const page = await this.browser.page()
        for (const step of wf.item.slice(wf.item.findIndex((s) => s.commit) + 1)) {
          this.ledger.updateItem(run.id, 0, { stepId: step.id })
          try {
            await this.#step(run.id, step, page, scope)
          } catch (error) {
            if (error instanceof SelectorError) {
              this.ledger.updateItem(run.id, 0, { status: 'paused', message: error.message })
              return this.#pause(run, { stepId: step.id, error }, page, scope)
            }
            throw error
          }
        }
        const item = this.ledger.items(run.id)[0] as ItemRow
        this.ledger.updateItem(run.id, 0, {
          status: 'done',
          evidence: await this.#shot(page, run.id, item, 'done'),
        })
        return this.#finish(run.id, 'done')
      } catch (error) {
        this.ledger.updateItem(run.id, 0, {
          status: 'review',
          cause: 'verification',
          message: mask((error as Error).message, scope),
        })
        return this.#finish(run.id, 'partial')
      }
    })
  }

  resume(runId: string): Promise<Outcome> {
    return this.ledger.exclusive(async () => this.#execute(runId))
  }

  /** Stops a run for good: unsubmitted items fail as cancelled, freeing their keys; submitted ones go to review. */
  cancel(runId: string): Promise<Report> {
    return this.ledger.exclusive(async () => {
      this.ledger.cancel(runId)
      this.#live.delete(runId)
      return this.report(runId)
    })
  }

  resolve(runId: string, key: string, status: 'done' | 'failed', note: string): Promise<Report> {
    return this.ledger.exclusive(async () => {
      this.ledger.resolve(runId, key, status, note)
      return this.report(runId)
    })
  }

  repair(runId: string, stepId: string, input: unknown): Promise<Workflow> {
    return this.ledger.exclusive(async () => {
      const run = this.ledger.run(runId)
      if (run.status !== 'paused' || run.stepId !== stepId)
        throw new Error('Repair must target the paused step of this run')
      const wf = await this.#definition(run)
      const step = [...wf.setup, ...wf.item, ...wf.teardown].find((s) => s.id === stepId)
      if (!step || !('target' in step)) throw new Error('The paused step has no repairable target')
      step.target = Target.parse(input)
      check(wf)
      this.ledger.updateRun(runId, { definition: wf })
      this.ledger.event(runId, 'repair', { stepId, target: step.target })
      this.#preferred.delete(`${runId}:${stepId}`)
      // Publish the repair for future runs only when no unrelated workflow edit occurred.
      const current = await this.store.get(wf.name).catch(() => undefined)
      const structure = (definition: Workflow) =>
        JSON.stringify(definition, (key, value) =>
          key === 'version' || key === 'target' ? undefined : value,
        )
      if (current && structure(current) === structure(wf))
        await this.store.repair(wf.name, stepId, step.target)
      return wf
    })
  }

  async #definition(run: Run): Promise<Workflow> {
    if (run.definition) return Workflow.parse(run.definition)
    const wf = await this.store.get(run.workflow)
    if (wf.version !== run.version)
      throw new Error(
        'Legacy run has no workflow snapshot and its version changed; verify its items before starting a new run',
      )
    check(wf)
    this.ledger.updateRun(run.id, { definition: wf })
    return wf
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
      durationMs: run.activeMs,
      counts,
      items: items.map(({ idx, key, status, cause, message, evidence }) => ({
        idx,
        key,
        status,
        cause,
        message,
        evidence,
      })),
      files: run.files,
      dir: this.#dir(runId),
    }
  }

  async #execute(runId: string): Promise<Outcome> {
    if (this.ledger.cancelled(runId))
      throw new Error(`Run ${runId} was cancelled for good: start a new run instead of resuming it.`)
    let run = this.ledger.run(runId)
    if (run.status === 'done') {
      if (this.ledger.items(runId).every((i) => ['done', 'skipped'].includes(i.status)))
        return { status: 'done', report: this.report(runId) }
      // Repair historical false-success runs instead of preserving their invalid terminal state.
      this.ledger.updateRun(runId, { status: 'partial', phase: 'items', stepId: null })
      run = this.ledger.run(runId)
    }
    if (!this.#live.has(runId)) {
      for (const item of this.ledger.items(runId))
        if (item.committed && ['running', 'paused', 'failed'].includes(item.status))
          this.ledger.updateItem(runId, item.idx, {
            status: 'review',
            cause: 'interrupted',
            message: 'Interrupted after commit; check the result on the site.',
          })
    }
    const wf = await this.#definition(run)
    check(wf)
    // Before marking the run running: a missing secret variable leaves it as it was.
    const scope = this.#scope(wf, run.params, run.files)
    this.ledger.updateRun(runId, { status: 'running', message: null })

    try {
      // Validate file inputs before browser actions when they do not depend on setup downloads.
      if (wf.items && !run.itemsLoaded && !references(wf.items.from).some((r) => r.ns === 'files'))
        await this.#loadItems(run, wf, scope)
      const page = await this.browser.page()
      const previous = this.#live.get(runId)
      const live =
        previous?.page === page && !page.isClosed() && previous.document === (await timeOrigin(page))
      const phase = run.phase
      // Recover setup before processing items. Final checks must preserve the completed page.
      if (run.phase === 'setup' || (!live && run.phase === 'items')) {
        const pause = await this.#phase(run, 'setup', wf.setup, null, page, scope, phase === 'setup')
        if (pause) return this.#pause(run, pause, page, scope)
        if (wf.items && !this.ledger.run(runId).itemsLoaded) await this.#loadItems(run, wf, scope)
        if (phase === 'setup') this.ledger.updateRun(runId, { phase: 'items', step: 0, stepId: null })
        run = this.ledger.run(runId)
      }

      if (run.phase === 'items') {
        const pause = await this.#items(run, wf, page, scope, Boolean(live))
        if (pause) return this.#pause(run, pause, page, scope)
        if (this.ledger.run(runId).status === 'stopped') return this.#finish(runId, 'stopped')
        if (this.ledger.items(runId).some((i) => !['done', 'skipped'].includes(i.status)))
          return this.#finish(runId, 'partial')
        // Final checks verify this run's effects; when every row was done by earlier runs there are none.
        if (wf.items && this.ledger.items(runId).every((i) => i.status === 'skipped')) {
          this.ledger.updateRun(runId, {
            message: 'Every row was already done by a previous run: nothing submitted, final checks skipped.',
          })
          return this.#finish(runId, 'done')
        }
        this.ledger.updateRun(runId, { phase: 'teardown', step: 0, stepId: null })
        run = this.ledger.run(runId)
      }

      const pause = await this.#phase(run, 'teardown', wf.teardown, live ? run.stepId : null, page, scope)
      if (pause) return this.#pause(run, pause, page, scope)
      await page.screenshot({ path: join(this.#dir(runId), 'final.png') }).catch(() => {})
      return this.#finish(runId, 'done')
    } catch (error) {
      this.ledger.updateRun(runId, { status: 'stopped', message: mask((error as Error).message, scope) })
      return this.#finish(runId, 'stopped')
    }
  }

  async #loadItems(run: Run, wf: Workflow, scope: Scope): Promise<void> {
    if (!wf.items) return
    const rows = await readItems(this.#local(render(wf.items.from, scope)), wf.items.sheet)
    if (!rows.length) throw new Error('Input batch is empty')
    const referenced = new Set(wf.items.required)
    for (const r of references(JSON.stringify(wf.item))) if (r.ns === 'item') referenced.add(r.key)
    const items = rows.map((data, index) => {
      for (const column of referenced)
        if (!Object.hasOwn(data, column) || !data[column]?.trim())
          throw new Error(
            `Input row ${index + 1}: missing required column/value "${column}" (an Excel formula with an error or without a saved result also reads as empty)`,
          )
      return { key: render(wf.items?.key ?? '', { ...scope, item: data }).trim(), data }
    })
    this.ledger.addItems(run.id, items)
  }

  async #phase(
    run: Run,
    phase: 'setup' | 'teardown',
    steps: Step[],
    cursor: string | null,
    page: Page,
    scope: Scope,
    persist = true,
  ) {
    const from = cursor ? steps.findIndex((s) => s.id === cursor) : 0
    if (from < 0) throw new Error(`Unknown saved step ${cursor}`)
    for (let i = from; i < steps.length; i++) {
      const step = steps[i] as Step
      if (persist) this.ledger.updateRun(run.id, { phase, step: i, stepId: step.id })
      try {
        await this.#step(run.id, step, page, scope)
      } catch (error) {
        if (error instanceof SelectorError) {
          // Recovery setup must not overwrite the interrupted item cursor.
          this.ledger.updateRun(run.id, { stepId: step.id })
          return { stepId: step.id, error, phase } satisfies Pause
        }
        throw new Error(`${phase} step "${step.id}" failed: ${(error as Error).message}`)
      }
    }
    return undefined
  }

  async #items(run: Run, wf: Workflow, page: Page, scope: Scope, live: boolean): Promise<Pause | undefined> {
    let failures = 0
    if (wf.items) scope.inbox = dirname(this.#local(render(wf.items.from, scope)))
    // A paused submitted item resumes first, while the live page still shows its own document.
    const awaiting = (i: ItemRow) => i.status === 'paused' && i.committed
    const items = this.ledger.items(run.id).sort((a, b) => Number(awaiting(b)) - Number(awaiting(a)))
    for (const item of items) {
      if (['done', 'skipped'].includes(item.status)) continue
      if (item.status === 'review' && item.cause !== 'duplicate') continue
      const update = (patch: Parameters<Ledger['updateItem']>[2]) =>
        this.ledger.updateItem(run.id, item.idx, patch)

      // Interrupted mid-item (crash): replay only if nothing irreversible happened.
      if (item.committed && (item.status === 'running' || item.status === 'failed' || !live)) {
        update({
          status: 'review',
          cause: 'interrupted',
          message: 'Interrupted after the commit step: check on the site whether it went through.',
        })
        continue
      }
      const previous = this.ledger.barrier(wf.name, run.scope, item.key, run.id)
      if (previous?.uncertain) {
        update({
          status: 'review',
          cause: 'duplicate',
          message: `Outcome unknown in run ${previous.runId}; resolve that original item first.`,
        })
        continue
      }
      if (previous && !run.repeat) {
        const canonical = (data: Record<string, string>) =>
          JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))
        if (canonical(item.data) !== canonical(previous.data)) {
          update({
            status: 'failed',
            cause: 'duplicate',
            message: `Key already completed with different data in run ${previous.runId}. Use the appropriate operation key.`,
          })
        } else {
          update({ status: 'skipped', cause: 'duplicate', message: `Already done in run ${previous.runId}` })
        }
        continue
      }

      scope.item = item.data
      const resumed = item.status === 'paused' && item.committed
      let committed = resumed
      const from = committed && live ? wf.item.findIndex((s) => s.id === item.stepId) : 0
      if (from < 0 || (committed && from <= wf.item.findIndex((s) => s.commit))) {
        update({
          status: 'review',
          cause: 'interrupted',
          message: 'Cannot safely recover the post-commit cursor.',
        })
        continue
      }
      update({ status: 'running', committed, attempts: item.attempts + 1, message: null, cause: null })
      for (let i = from; i < wf.item.length; i++) {
        const step = wf.item[i] as Step
        update({ step: i, stepId: step.id })
        this.ledger.updateRun(run.id, { stepId: step.id })
        try {
          await this.#step(run.id, step, page, scope, () => {
            if (step.commit) {
              committed = true
              update({ committed: true })
            }
          })
        } catch (error) {
          // After commit, a missing target pauses for repair only on the run's first submitted item, once.
          // Elsewhere it means the site answered differently (e.g. an error page): review and continue.
          const repairable =
            !committed ||
            (!resumed && !this.ledger.items(run.id).some((i) => i.committed && i.idx !== item.idx))
          if (error instanceof SelectorError && repairable) {
            update({
              status: 'paused',
              message: error.message,
              evidence: await this.#shot(page, run.id, item, 'paused'),
            })
            return { stepId: step.id, error }
          }
          const cause: Cause =
            error instanceof VerificationError || error instanceof SelectorError ? 'verification' : 'system'
          update({
            status: committed ? 'review' : 'failed',
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
          update({
            status: 'done',
            cause: null,
            message: null,
            evidence: await this.#shot(page, run.id, item, 'done'),
          })
          failures = 0
        }
      }
    }
    return undefined
  }

  async #step(runId: string, step: Step, page: Page, scope: Scope, beforeAction = () => {}): Promise<void> {
    const answer =
      'onDialog' in step
        ? { onDialog: step.onDialog, dialogText: step.dialogText && render(step.dialogText, scope) }
        : {}
    try {
      await withDialogs(page, answer, () => this.#act(runId, step, page, scope, beforeAction))
    } catch (error) {
      // Secret values never reach the journal, reports or the agent.
      if (error instanceof Error) error.message = mask(error.message, scope)
      throw error
    }
  }

  async #act(runId: string, step: Step, page: Page, scope: Scope, beforeAction: () => void): Promise<void> {
    const text = (s: string) => render(s, scope)
    const cacheKey = `${runId}:${step.id}`
    const locate = async (state: 'visible' | 'attached' = 'visible') => {
      if (!('target' in step) || !step.target) throw new Error(`Step "${step.id}" needs a target`)
      // Values inserted into CSS or XPath are quoted for that language.
      const target = Target.parse(
        JSON.parse(JSON.stringify(step.target), (key, value) =>
          typeof value !== 'string'
            ? value
            : key === 'css' || key === 'frame'
              ? renderSelector(value, scope, 'css')
              : key === 'xpath'
                ? renderSelector(value, scope, 'xpath')
                : text(value),
        ),
      )
      const { locator, index } = await resolve(page, target, {
        state,
        timeout: step.timeoutMs ?? 10_000,
        start: this.#preferred.get(cacheKey),
      })
      this.#preferred.set(cacheKey, index)
      return locator
    }

    switch (step.do) {
      case 'goto': {
        const url = text(step.url)
        if (!/^(https?:\/\/|about:blank$)/i.test(url))
          throw new Error(`goto only opens http(s) URLs, not "${url}"`)
        await page.goto(url)
        return
      }
      case 'click': {
        const element = await locate()
        const timeout = step.timeoutMs ?? 10_000
        // Actionability check without clicking: a covered or disabled target fails before the commit point.
        await element.click({ trial: true, timeout })
        beforeAction()
        await element.click({ timeout })
        return
      }
      case 'hover':
        await (await locate()).hover({ timeout: step.timeoutMs ?? 10_000 })
        return
      case 'fill': {
        const field = await locate()
        const value = text(step.value)
        await field.fill(value)
        if ((await fieldValue(field)) !== value)
          throw new VerificationError(`Field did not keep the filled value (${step.id})`)
        return
      }
      case 'select': {
        const field = await locate()
        beforeAction()
        await field.selectOption(text(step.value))
        return
      }
      case 'check': {
        const box = await locate()
        const timeout = step.timeoutMs ?? 10_000
        await box.setChecked(step.checked, { trial: true, timeout })
        beforeAction()
        await box.setChecked(step.checked, { timeout })
        return
      }
      case 'press': {
        const element = step.target ? await locate() : undefined
        // Focus first so that a failure to reach the target happens before the commit point.
        await element?.focus({ timeout: step.timeoutMs ?? 10_000 })
        beforeAction()
        await page.keyboard.press(step.key)
        return
      }
      case 'upload': {
        const file = references(step.file).some((r) => r.ns === 'item')
          ? await confine(text(step.file), scope.inbox)
          : this.#local(text(step.file))
        await access(file)
        const field = await locate('attached')
        beforeAction()
        await field.setInputFiles(file, { timeout: step.timeoutMs ?? 10_000 })
        return
      }
      case 'download': {
        const clean = references(step.saveAs).length > 0
        const options = { clean, timeout: step.timeoutMs }
        const file = await download(page, await locate(), this.#dir(runId), text(step.saveAs), options)
        this.#keep(runId, step.id, step.saveAs, scope, file)
        return
      }
      case 'extract': {
        const clean = references(step.saveAs).length > 0
        const file = await extract(await locate(), this.#dir(runId), text(step.saveAs), clean)
        this.#keep(runId, step.id, step.saveAs, scope, file)
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

  /**
   * Records a saved file as `files.<name>`. A templated saveAs is per item: the key is the saved file's own
   * name (unique, so the report lists every item's file) and `files.<step id>` holds the current item's file.
   */
  #keep(runId: string, stepId: string, saveAs: string, scope: Scope, file: string): void {
    const templated = references(saveAs).length > 0
    if (templated) scope.files[stepId] = file
    scope.files[templated ? basename(file) : saveAs] = file
    this.ledger.updateRun(runId, { files: scope.files })
  }

  async #expect(
    step: Extract<Step, { do: 'expect' }>,
    page: Page,
    text: (s: string) => string,
    locate: () => Promise<Locator>,
  ): Promise<void> {
    const timeout = step.timeoutMs ?? 10_000
    const fail = (what: string) => {
      throw new VerificationError(`Expected ${what}`)
    }
    if (step.url) {
      const url = text(step.url)
      await page
        .waitForURL((u) => (/^https?:/.test(url) ? u.href === url : u.pathname + u.search === url), {
          timeout,
        })
        .catch(() => fail(`URL "${url}"`))
    }
    if (step.text !== undefined) {
      const wanted = text(step.text)
      if (!wanted.trim()) fail('nonempty verification text')
      const contains = async (scope: Locator) =>
        normalize(await scope.innerText()).includes(normalize(wanted))
      const body = page.locator('body')
      // Text absent from the whole page fails verification even if the target is missing: a repair cannot help.
      const scopeLoc = step.target
        ? await locate().catch(async (error) => {
            if (error instanceof SelectorError && !(await contains(body))) fail(`text "${wanted}"`)
            throw error
          })
        : body
      const deadline = Date.now() + timeout
      while (!(await contains(scopeLoc))) {
        if (Date.now() >= deadline) fail(`text "${wanted}"`)
        await page.waitForTimeout(100)
      }
    }
    if (step.value !== undefined) {
      const wanted = text(step.value)
      const field = await locate()
      const deadline = Date.now() + timeout
      while ((await fieldValue(field)) !== wanted) {
        if (Date.now() > deadline) fail(`the expected value in ${step.id}`)
        await page.waitForTimeout(200)
      }
    }
    if (step.target && step.text === undefined && step.value === undefined) await locate()
  }

  async #pause(run: Run, pause: Pause, page: Page, scope: Scope): Promise<Outcome> {
    this.ledger.updateRun(run.id, {
      status: 'paused',
      stepId: pause.stepId,
      message: `Needs repair at step "${pause.stepId}"`,
    })
    if (pause.phase === 'setup' && run.phase !== 'setup') this.#live.delete(run.id)
    else
      this.#live.set(run.id, {
        page,
        document: await timeOrigin(page).catch(() => -1),
      })
    const item = this.ledger.items(run.id).find((i) => i.status === 'paused')
    return {
      status: 'needs_repair',
      runId: run.id,
      workflow: run.workflow,
      stepId: pause.stepId,
      itemKey: item?.key,
      error: pause.error.message,
      snapshot: mask(
        await page
          .ariaSnapshot({ mode: 'ai' })
          .catch(() => 'Page unavailable; reopen the browser before resuming.'),
        scope,
      ),
      report: this.report(run.id),
    }
  }

  #finish(runId: string, status: 'done' | 'partial' | 'stopped'): Outcome {
    if (status === 'done' && this.ledger.items(runId).some((i) => !['done', 'skipped'].includes(i.status)))
      status = 'partial'
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
    const dir = join(this.runsDir, runId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
}
