import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { destination } from './download.ts'
import { type HostIo, systemIo } from './host-io.ts'
import {
  bootCode,
  type HostResult,
  type HostSelector,
  type HostStep,
  inlineCode,
  runtimeSource,
} from './host-page.ts'
import { agentArgs, type Call, type Done, finishMcp, runHttp, runMcp } from './integrations.ts'
import { readItems } from './items.ts'
import type { ItemRow, Ledger, Run } from './ledger.ts'
import { McpClients } from './mcp-client.ts'
import { paths } from './paths.ts'
import { confine } from './runner.ts'
import { type Step, Workflow } from './schema.ts'
import { check, type Store, secretVariables } from './store.ts'
import { hasSecrets, mask, references, render, renderSelector, type Scope, snapshotVars } from './template.ts'

/**
 * Host mode: the agent's own integrated browser runs each item, Ritoko keeps the journal. Ritoko cannot drive
 * that browser (no external access), so each response hands the agent a batch of actions (open a URL, run a
 * program, click the hand-off button) and the agent reports what each program returned. The journal rules are
 * the engine's: the commit is recorded before the program that can send it is handed out, an item with no
 * result after its commit becomes review, done keys are skipped, a cancelled run is final.
 *
 * An item is compiled by segment (the steps between two navigations). A navigation goes through a local page
 * (host-carry.ts) that opens the site with the runtime, plan and files in the URL fragment; the program the
 * agent then runs is a short boot snippet (host-page.ts) that takes them from the fragment.
 */
export type HostAction =
  | { type: 'navigate'; tab: number; url: string }
  | { type: 'run_js'; tab: number; code: string }
  /** A real click at a point of the tab: the page's shield covers it, so any point is safe. */
  | { type: 'click'; tab: number; x: number; y: number }
  /** Invoke an already connected tool; Ritoko never starts or closes its server. */
  | {
      type: 'tool'
      tab: number
      actionId: string
      server: string
      tool: string
      args: Record<string, unknown>
    }

export type HostResponse = {
  runId: string
  /** Echoed back by the agent: results of an older batch are refused. */
  batch: number
  /** Run in order, each on the tab of its slot (1-based). */
  actions: HostAction[]
  note: string
  done?: {
    status: 'done' | 'partial' | 'stopped'
    counts: Record<string, number>
    files: Record<string, string>
  }
}

/** One result per run_js or tool, in action order. A tool result is {actionId, result: raw MCP result}. */
export type HostInput = { batch?: number; results?: unknown[]; error?: string; completed?: number }

const BUDGET_MS = 90_000
/** A URL fragment longer than this is not reliably accepted by the browser. */
const FRAGMENT_LIMIT = 1_900_000
/** Raw bytes of upload files that still fit in it (base64 and percent-encoding included). */
const FILE_LIMIT = 1_350_000
const CLICK = { x: 200, y: 200 }
const NOTE =
  'Do actions in order. navigate/run_js/click use the tab of their slot. run_js requires a host that permits page-script execution (read-only evaluate cannot run it). click is a real click at x,y. tool: invoke that already connected server/tool with the exact args; return {actionId,result:<raw MCP result>}, including isError/structuredContent/content, without summarizing. Call host_next with batch and results = one result per run_js OR tool in action order (none for navigate/click). If execution stopped early include error and completed = number of actions fully completed; never claim an uncertain action completed.'
const SHORT_NOTE = 'Same protocol: do the actions, then host next with batch and results.'
const MEDIA: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
}
const TYPES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MEDIA).map(([type, ext]) => [ext, type])),
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
}

/** A file in flight: staged in the page, then copied to the clipboard by a click on the shield. */
type Handoff = {
  token: string
  clicked: boolean
  keep: boolean
  tries: number
  bytes: number
  type: string
  clipboard?: string
}
type Cursor = {
  /** Tab holding the item; absent once only its file is in flight. */
  slot?: number
  /** Next step to run. */
  step: number
  waitedMs: number
  /** The tab holds the plan of the current segment: the short boot form can continue it. */
  carried?: boolean
  missing?: number
  handoff?: Handoff
  files?: Record<string, string>
}
/** A program handed out in the current batch. */
type Program = {
  kind?: 'tool'
  actionId?: string
  idx: number
  /** Index of its run_js in the batch. */
  at: number
  /** First step of its segment (where a lost item starts over) and of the program itself. */
  start: number
  from: number
  /** Exclusive end of the issued program (first download included). */
  end: number
  /** A previous program may already have dispatched the commit. */
  previouslyCommitted: boolean
  download: boolean
  /** Index of the commit step when this program can send it. */
  commit?: number
  token: string
  /** Runs from the plan the page holds (carried); the long form leaves none. */
  boot: boolean
  /** Nothing in the batch navigates its tab afterwards: the page is still there at the next call. */
  last: boolean
}
type State = {
  batch: number
  parallel: number
  actions: number
  cursors: Record<number, Cursor>
  programs: Program[]
}
type Entry = {
  action: HostAction
  program?: Program /** The item whose file this click hands over. */
  click?: number
}
type Context = {
  runId: string
  run: Run
  wf: Workflow
  state: State
  entries: Entry[]
  pages: { target: string; fragment: string }[]
  /** Commit steps to journal once the whole batch is built, before it is handed out. */
  commits: { idx: number; step: number }[]
  /** Items already placed in this batch. */
  used: Set<number>
}

export class Host {
  /** Runtime credentials stay in memory, never in host_state or the journal. */
  #scopes = new Map<string, Scope>()
  #clients = new Map<string, McpClients>()
  readonly ledger: Ledger
  readonly store: Store
  readonly runsDir: string
  readonly io: HostIo

  constructor(ledger: Ledger, store: Store, runsDir = paths.runs, io: HostIo = systemIo) {
    this.ledger = ledger
    this.store = store
    this.runsDir = runsDir
    this.io = io
    ledger.db.exec('CREATE TABLE IF NOT EXISTS host_state (run_id TEXT PRIMARY KEY, state TEXT NOT NULL)')
  }

  start(name: string, params: Record<string, string> = {}, { parallel = 1 } = {}): Promise<HostResponse> {
    return this.ledger.exclusive(async () => this.#settle(await this.#start(name, params, parallel)))
  }

  async #start(name: string, params: Record<string, string>, parallel: number): Promise<HostResponse> {
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 4)
      throw new Error('Host parallel must be an integer from 1 to 4')
    const wf = await this.store.get(name)
    hostCheck(wf)
    if (!wf.items) throw new Error('Host mode runs item batches')
    const resolved = hostParams(wf, params)
    const scope: Scope = { param: resolved, item: {}, files: {} }
    const source = render(wf.items.from, scope)
    if (!isAbsolute(source)) throw new Error(`Host input path must be absolute: ${source}`)
    const rows = await readItems(source, wf.items.sheet)
    if (!rows.length) throw new Error('Input batch is empty')
    const used = new Set(wf.items.required)
    for (const r of references(JSON.stringify(wf.item))) if (r.ns === 'item') used.add(r.key)
    const items = rows.map((data, i) => {
      for (const column of used)
        if (!data[column]?.trim()) throw new Error(`Input row ${i + 1}: missing value "${column}"`)
      return { key: render(wf.items?.key ?? '', { ...scope, item: data }).trim(), data }
    })
    const run = this.ledger.createRun(wf.name, wf.version, resolved, false, wf, render(wf.items.scope, scope))
    this.ledger.addItems(run.id, items)
    this.ledger.updateRun(run.id, { phase: 'items' })
    this.#save(run.id, { batch: 0, parallel, actions: 0, cursors: {}, programs: [] })
    return this.#nextBatch(run.id)
  }

  /**
   * Records what the previous batch returned, then hands out the next one. Without results the previous
   * batch is treated as interrupted: a committed item becomes review, the others restart.
   */
  next(runId: string, input: HostInput = {}): Promise<HostResponse> {
    return this.ledger.exclusive(async () => this.#settle(await this.#nextBatch(runId, input)))
  }

  async #settle(response: HostResponse): Promise<HostResponse> {
    if (response.done) {
      await this.#clients.get(response.runId)?.close()
      this.#clients.delete(response.runId)
      for (const key of this.#scopes.keys())
        if (key.startsWith(`${response.runId}:`)) this.#scopes.delete(key)
    }
    return response
  }

  /** Called when the owning CLI/MCP process disconnects. Agent-owned servers are never touched. */
  async close(): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.close()))
    this.#clients.clear()
    this.#scopes.clear()
  }

  async #nextBatch(runId: string, input: HostInput = {}): Promise<HostResponse> {
    const run = this.ledger.run(runId)
    const state = this.#state(runId)
    if (this.ledger.cancelled(runId)) {
      const clipboard = this.io.clipboard.read()
      for (const cursor of Object.values(state.cursors))
        if (
          cursor.handoff?.clipboard !== undefined &&
          clipboard.startsWith(`RITOKO|${cursor.handoff.token}|`)
        )
          this.#restore(cursor.handoff.clipboard)
      return this.#finish(runId)
    }
    if (
      (input.results !== undefined || input.error !== undefined || input.completed !== undefined) &&
      input.batch === undefined
    )
      throw new Error('Report batch with results or error: unnumbered results could belong to an older batch')
    if (input.batch !== undefined && input.batch !== state.batch)
      throw new Error(
        `These are results of batch ${input.batch}, but the current batch is ${state.batch}: report the latest one.`,
      )
    if (!run.definition) throw new Error('Host run has no frozen workflow definition')
    const wf = Workflow.parse(run.definition)
    hostCheck(wf)
    validateInput(input, state)
    // A terminal run resumes only on an explicit call without batch results. Do not retry failures
    // while processing another lane or reporting the same completed batch again.
    if (
      run.status !== 'running' &&
      input.results === undefined &&
      input.error === undefined &&
      input.completed === undefined
    ) {
      this.ledger.transaction(() => {
        for (const item of this.ledger.items(runId)) {
          if (
            item.committed ||
            !(item.status === 'failed' || (item.status === 'review' && item.cause === 'duplicate'))
          )
            continue
          this.ledger.updateItem(runId, item.idx, {
            status: 'pending',
            step: 0,
            stepId: null,
            cause: null,
            message: null,
            vars: {},
          })
          delete state.cursors[item.idx]
          this.#scopes.delete(`${runId}:${item.idx}`)
        }
        this.ledger.updateRun(runId, { status: 'running', message: null })
        this.#save(runId, state)
      })
    }
    const ctx: Context = {
      runId,
      run,
      wf,
      state,
      entries: [],
      pages: [],
      commits: [],
      used: new Set(),
    }
    await this.#tools(ctx, input)
    this.ledger.transaction(() => {
      this.#apply(ctx, input)
      this.#collect(ctx)
      state.programs = []
      this.#save(runId, state)
    })
    return this.#compose(ctx)
  }

  /** Applies what each program of the last batch returned to its item. */
  async #tools(ctx: Context, input: HostInput): Promise<void> {
    for (const [k, program] of ctx.state.programs.entries()) {
      if (program.kind !== 'tool') continue
      const item = this.#item(ctx.runId, program.idx)
      const cursor = ctx.state.cursors[item.idx]
      if (item.status !== 'running' || !cursor) continue
      const envelope = input.results?.[k] as { actionId: string; result: unknown } | undefined
      if (!envelope) {
        const never =
          input.error !== undefined && input.completed !== undefined && program.at > input.completed
        if (never && !program.previouslyCommitted) {
          this.ledger.updateItem(ctx.runId, item.idx, { committed: false })
          cursor.step = program.from
        } else this.#interrupted(ctx, item, cursor)
        continue
      }
      const step = ctx.wf.item[program.from] as Extract<Step, { do: 'mcp' }>
      const scope = this.#scope(ctx, item)
      const mcp = new McpClients({}, scope)
      try {
        if ((envelope.result as { resultType?: string })?.resultType === 'input_required')
          throw new Error(`MCP tool "${step.tool}" asks for more input, which a workflow cannot give`)
        const result = CallToolResultSchema.parse(envelope.result)
        const done = await finishMcp(step, result, this.#call(ctx, item, step, scope, mcp))
        this.#keep(ctx, item, step, scope, done)
        Object.assign(cursor, { step: program.end, carried: false, waitedMs: 0 })
      } catch (error) {
        this.#fail(ctx, this.#item(ctx.runId, item.idx), (error as Error).message, 'system')
      } finally {
        await mcp.close()
      }
      this.#save(ctx.runId, ctx.state)
    }
    this.#finished(ctx)
  }

  /** Applies the browser results; tool results were applied above. */
  #apply(ctx: Context, input: HostInput): void {
    const { runId, wf, state } = ctx
    const results = input.results ?? []
    const step = (n: number) => wf.item[n] as Step
    const mentioned = new Set<number>()
    for (const [k, p] of state.programs.entries()) {
      mentioned.add(p.idx)
      if (p.kind === 'tool') continue
      const item = this.#item(runId, p.idx)
      const cursor = state.cursors[p.idx]
      if (item.status !== 'running' || !cursor) continue
      const r = parseResult(results[k])
      if (!r) {
        // A batch that stopped before this program ran none of it: a commit it carried never left.
        const never = input.error !== undefined && input.completed !== undefined && p.at > input.completed
        if (!never) this.#interrupted(ctx, item, cursor)
        else {
          if (p.commit !== undefined && !p.previouslyCommitted)
            this.ledger.updateItem(runId, p.idx, { committed: false })
          Object.assign(cursor, { step: p.start, waitedMs: 0, carried: false })
        }
      } else if ('missing' in r) {
        // The boot found no plan: the page is still there if nothing navigated its tab, else start the segment over.
        cursor.carried = false
        if (p.commit !== undefined && !p.previouslyCommitted)
          this.ledger.updateItem(runId, p.idx, { committed: false })
        cursor.missing = (cursor.missing ?? 0) + 1
        cursor.step = p.last ? p.from : p.start
        if (cursor.missing > 2)
          this.#fail(
            ctx,
            item,
            'The page did not keep the plan of the item (does the site remove URL fragments?)',
            'system',
          )
      } else if (r.ok && 'pending' in r) {
        if (p.commit !== undefined && !p.previouslyCommitted && r.sent < p.commit)
          this.ledger.updateItem(runId, p.idx, { committed: false })
        const waited = (r.pending === cursor.step ? cursor.waitedMs : 0) + r.waited
        if (!p.last) this.#interrupted(ctx, item, cursor)
        else if (
          waited >=
          (step(r.pending).do === 'wait' && 'ms' in step(r.pending)
            ? (step(r.pending) as Step & { ms: number }).ms
            : (step(r.pending).timeoutMs ?? 10_000))
        )
          this.#fail(ctx, item, `${step(r.pending).id}: still waiting after ${Math.round(waited / 1000)}s`)
        else Object.assign(cursor, { step: r.pending, waitedMs: waited, carried: p.boot || cursor.carried })
      } else if (r.ok) {
        Object.assign(cursor, { step: r.next, waitedMs: 0, missing: 0, carried: false })
        if (r.staged)
          cursor.handoff = {
            token: `${p.token}.${r.next - 1}`,
            clicked: false,
            keep: p.last,
            tries: 0,
            ...r.staged,
          }
      } else {
        // A failure before the commit step was dispatched: the commit never left, the item stays retryable.
        const never = !p.previouslyCommitted && p.commit !== undefined && r.sent < p.commit
        if (never) this.ledger.updateItem(runId, p.idx, { committed: false })
        this.#fail(
          ctx,
          never ? { ...item, committed: false } : item,
          `${step(r.at).id}: ${r.error}`,
          r.selector ? 'selector' : 'system',
        )
      }
    }
    this.#finished(ctx)
    // Running items the batch did not mention were lost with it (a crash between the journal and the hand-out).
    for (const item of this.ledger.items(runId, 'running'))
      if (item.status === 'running' && !mentioned.has(item.idx) && !state.cursors[item.idx]?.handoff)
        this.#interrupted(ctx, item, state.cursors[item.idx] ?? { step: 0, waitedMs: 0 })
  }

  #interrupted(ctx: Context, item: ItemRow, cursor: Cursor): void {
    this.#scopes.delete(`${ctx.runId}:${item.idx}`)
    if (item.committed)
      this.ledger.updateItem(ctx.runId, item.idx, {
        status: 'review',
        cause: 'interrupted',
        message: 'Interrupted after the commit step: check the site.',
      })
    else {
      this.ledger.updateItem(ctx.runId, item.idx, { vars: {}, attempts: item.attempts + 1 })
      ctx.state.cursors[item.idx] = { slot: cursor.slot, step: 0, waitedMs: 0 }
    }
  }

  #fail(
    ctx: Context,
    item: ItemRow,
    message: string,
    cause: 'selector' | 'system' | 'verification' = 'verification',
  ): void {
    item = this.#item(ctx.runId, item.idx)
    const scope = this.#scopes.get(`${ctx.runId}:${item.idx}`)
    this.ledger.updateItem(
      ctx.runId,
      item.idx,
      item.committed
        ? { status: 'review', cause, message: scope ? mask(message, scope) : message }
        : { status: 'failed', cause, message: scope ? mask(message, scope) : message },
    )
    this.#scopes.delete(`${ctx.runId}:${item.idx}`)
    delete ctx.state.cursors[item.idx]
  }

  /** Items whose steps are all run and whose file, if any, is in. */
  #finished(ctx: Context): void {
    for (const item of this.ledger.items(ctx.runId, 'running')) {
      const cursor = ctx.state.cursors[item.idx]
      if (item.status === 'running' && cursor && cursor.step >= ctx.wf.item.length && !cursor.handoff) {
        this.ledger.updateItem(ctx.runId, item.idx, { status: 'done', cause: null, message: null })
        this.#scopes.delete(`${ctx.runId}:${item.idx}`)
        delete ctx.state.cursors[item.idx]
      }
    }
  }

  /** Receives the files clicked in the previous batch. */
  #collect(ctx: Context): void {
    const { runId, state } = ctx
    const waiting = this.ledger
      .items(runId, 'running')
      .filter((i) => i.status === 'running' && state.cursors[i.idx]?.handoff?.clicked)
    if (!waiting.length) return
    const text = this.io.clipboard.read()
    for (const item of waiting) {
      const cursor = state.cursors[item.idx] as Cursor
      const handoff = cursor.handoff as Handoff
      const prefix = `RITOKO|${handoff.token}|`
      if (text.startsWith(prefix)) {
        try {
          const file = this.#receive(ctx, item, handoff, text.slice(prefix.length))
          this.ledger.updateRun(runId, {
            files: { ...this.ledger.run(runId).files, [file.name]: file.path, [file.key]: file.path },
          })
          this.ledger.updateItem(runId, item.idx, { evidence: file.path })
          cursor.handoff = undefined
        } catch (error) {
          // A corrupt file or a filesystem error belongs to this row, not the other lanes.
          this.#fail(ctx, item, (error as Error).message, 'system')
        }
        // Validate and save before clearing the receipt. A restoration failure still stops the call.
        if (handoff.clipboard !== undefined) this.#restore(handoff.clipboard)
      } else if (handoff.keep && handoff.tries < 2)
        Object.assign(handoff, { clicked: false, tries: handoff.tries + 1 })
      else this.#fail(ctx, item, 'The file did not reach Ritoko through the hand-off')
    }
    this.#finished(ctx)
  }

  #receive(ctx: Context, item: ItemRow, handoff: Handoff, data: string) {
    const match = /^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(data)
    const type = match?.[1]
    const encoded = match?.[2]
    if (type === undefined || encoded === undefined || encoded.length % 4 !== 0)
      throw new Error('Invalid file hand-off payload')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length !== handoff.bytes || type !== handoff.type || bytes.length > 200 * 1024 * 1024)
      throw new Error('File hand-off does not match the staged file')
    const step = ctx.wf.item[Number(handoff.token.split('.').at(-1))] as Extract<Step, { do: 'download' }>
    const dir = join(this.runsDir, ctx.runId)
    mkdirSync(dir, { recursive: true })
    const scope = this.#scope(ctx, item)
    const wanted = render(step.saveAs, scope)
    if (mask(wanted, scope) !== wanted) throw new Error('A secret cannot be used as a file name')
    const path = destination(
      dir,
      extname(wanted) ? wanted : wanted + (MEDIA[type] ?? ''),
      `download${MEDIA[type] ?? ''}`,
      true,
    )
    writeFileSync(path, bytes, { flag: 'wx' })
    const key = references(step.saveAs).length ? step.id : step.saveAs
    scope.files[step.id] = path
    scope.files[key] = path
    const cursor = ctx.state.cursors[item.idx] as Cursor
    cursor.files = { ...cursor.files, [step.id]: path, [key]: path }
    return { name: basename(path), key, path }
  }

  /** The user's text back on the clipboard (a Ritoko payload is not theirs), checked. */
  #restore(text: string): void {
    this.io.clipboard.write(text)
    if (this.io.clipboard.read() !== text)
      throw new Error('Could not restore the clipboard: check it before pasting')
  }

  async #compose(ctx: Context): Promise<HostResponse> {
    const { runId, wf, state, entries } = ctx
    for (let slot = 1; slot <= state.parallel; slot++) await this.#lane(ctx, slot)
    if (!entries.length) {
      const running = this.ledger.items(runId, 'running')
      if (running.length)
        throw new Error(`Ritoko lost track of items ${running.map((i) => i.key).join(', ')}`)
      this.#save(runId, state)
      return this.#finish(runId)
    }
    // A page is still there at the next call when nothing in the batch navigates its tab afterwards.
    for (const [at, { action, program, click }] of entries.entries()) {
      const later = entries
        .slice(at + 1)
        .some((e) => e.action.type === 'navigate' && e.action.tab === action.tab)
      if (program) Object.assign(program, { at, last: !later })
      const handoff = click === undefined ? undefined : state.cursors[click]?.handoff
      if (handoff) handoff.keep = !later
    }
    const urls = ctx.pages.length ? await this.io.carry(ctx.pages) : []
    let next = 0
    for (const { action } of entries)
      if (action.type === 'navigate' && !action.url) action.url = urls[next++] as string
    state.programs = entries.flatMap((e) => (e.program ? [e.program] : []))
    state.batch++
    state.actions = entries.length
    this.ledger.transaction(() => {
      // The commit and issued batch enter the journal together, before either can leave.
      for (const { idx, step } of ctx.commits)
        this.ledger.updateItem(runId, idx, { committed: true, step, stepId: (wf.item[step] as Step).id })
      this.#save(runId, state)
    })
    return {
      runId,
      batch: state.batch,
      actions: entries.map((e) => e.action),
      note: state.batch === 1 ? NOTE : SHORT_NOTE,
    }
  }

  /** What a slot's tab does in this batch: go on with its item, or take the next one. */
  async #lane(ctx: Context, slot: number): Promise<void> {
    const { runId, wf, state, entries } = ctx
    const held = this.ledger
      .items(runId, 'running')
      .find((i) => i.status === 'running' && state.cursors[i.idx]?.slot === slot)
    const cursor = held && state.cursors[held.idx]
    let retired: Cursor | undefined
    if (held && cursor) {
      ctx.used.add(held.idx)
      if (!cursor.handoff) {
        try {
          await this.#program(ctx, held, slot)
          if (this.#item(runId, held.idx).status === 'running') return
        } catch (error) {
          this.#fail(ctx, held, (error as Error).message, 'system')
        }
      } else {
        // The clipboard carries one file at a time, even when several tabs are generating.
        if (entries.some((e) => e.click !== undefined)) return
        // The user's clipboard is put back once the file is in.
        cursor.handoff.clipboard = clean(this.io.clipboard.read())
        cursor.handoff.clicked = true
        entries.push({ action: { type: 'click', tab: slot, ...CLICK }, click: held.idx })
        // With nothing left to run in the tab, it takes the next item while the file is in flight.
        if (cursor.step < wf.item.length) return
        retired = cursor
      }
    }
    for (;;) {
      const item = this.#next(ctx)
      if (!item) return
      const lost = state.cursors[item.idx]
      state.cursors[item.idx] = lost ? { ...lost, slot } : { slot, step: 0, waitedMs: 0 }
      ctx.used.add(item.idx)
      try {
        await this.#program(ctx, item, slot)
        if (retired) retired.slot = undefined
        if (this.#item(runId, item.idx).status === 'running') return
      } catch (error) {
        this.#fail(ctx, item, (error as Error).message, 'system')
      }
    }
  }

  /** An item that lost its tab, else the next pending one that no earlier run settled. */
  #next(ctx: Context): ItemRow | undefined {
    const { runId, run, wf, state } = ctx
    const lost = this.ledger.items(runId, 'running').find((i) => {
      const cursor = state.cursors[i.idx]
      return i.status === 'running' && !cursor?.handoff && !cursor?.slot && !ctx.used.has(i.idx)
    })
    if (lost) return lost
    for (;;) {
      const candidate = this.ledger.nextItem(runId, 'pending')
      if (!candidate) return undefined
      const previous = this.ledger.barrier(wf.name, run.scope, candidate.key, runId)
      if (previous) {
        const canonical = (data: Record<string, string>) =>
          JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))
        this.ledger.updateItem(
          runId,
          candidate.idx,
          previous.uncertain
            ? { status: 'review', cause: 'duplicate', message: `Outcome unknown in run ${previous.runId}` }
            : canonical(candidate.data) !== canonical(previous.data)
              ? {
                  status: 'failed',
                  cause: 'duplicate',
                  message: `Key already completed with different data in run ${previous.runId}. Use the appropriate operation key.`,
                }
              : { status: 'skipped', cause: 'duplicate', message: `Already done in run ${previous.runId}` },
        )
        continue
      }
      this.ledger.updateItem(runId, candidate.idx, { status: 'running', attempts: candidate.attempts + 1 })
      return this.#item(runId, candidate.idx)
    }
  }

  /** The next program of an item: a navigation through the carry page, then the run_js that boots from it. */
  async #program(ctx: Context, item: ItemRow, slot: number): Promise<void> {
    const { runId, wf, state } = ctx
    const steps = wf.item
    const cursor = state.cursors[item.idx] as Cursor
    const scope = this.#scope(ctx, item)
    let mcp = this.#clients.get(runId)
    if (!mcp) {
      mcp = new McpClients(wf.servers, scope)
      this.#clients.set(runId, mcp)
    }
    while (steps[cursor.step]?.do === 'http' || steps[cursor.step]?.do === 'mcp') {
      const step = steps[cursor.step] as Extract<Step, { do: 'http' | 'mcp' }>
      const server = step.do === 'mcp' ? wf.servers[step.server] : undefined
      if (step.do === 'mcp' && server && 'ref' in server && server.ref === 'agent') {
        const actionId = `${runId}:${state.batch + 1}:${item.idx}:${step.id}:${item.attempts}`
        const action: HostAction = {
          type: 'tool',
          tab: slot,
          actionId,
          server: step.server,
          tool: step.tool,
          args: agentArgs(step, scope),
        }
        const program: Program = {
          kind: 'tool',
          actionId,
          idx: item.idx,
          at: -1,
          start: cursor.step,
          from: cursor.step,
          end: cursor.step + 1,
          previouslyCommitted: this.#item(runId, item.idx).committed,
          download: false,
          token: actionId,
          boot: false,
          last: true,
        }
        if (step.commit) {
          program.commit = cursor.step
          ctx.commits.push({ idx: item.idx, step: cursor.step })
        }
        ctx.entries.push({ action, program })
        return
      }
      const call = this.#call(ctx, this.#item(runId, item.idx), step, scope, mcp)
      const done = await (step.do === 'http' ? runHttp(step, call) : runMcp(step, call))
      this.#keep(ctx, item, step, scope, done)
      cursor.step++
      cursor.carried = false
      this.#save(runId, state)
    }
    this.#finished(ctx)
    if (this.#item(runId, item.idx).status !== 'running') return
    const goto = (n: number) => {
      const url = render((steps[n] as Step & { do: 'goto' }).url, scope)
      const parsed = new URL(url)
      if (mask(url, scope) !== url) throw new Error('A browser URL cannot contain a runtime secret')
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hash)
        throw new Error(`${steps[n]?.id}: host goto needs an HTTP(S) URL without a fragment`)
      return url
    }
    const out: Entry[] = []
    let start = cursor.step
    // A navigation with nothing to run after it is only opened.
    while (steps[start]?.do === 'goto' && (steps[start + 1]?.do ?? 'goto') === 'goto')
      out.push({ action: { type: 'navigate', tab: slot, url: goto(start++) } })
    cursor.step = start
    if (steps[start]) {
      const fresh = steps[start]?.do === 'goto'
      const from = fresh ? start + 1 : start
      const end = steps.findIndex((s, i) => i >= from && ['goto', 'http', 'mcp'].includes(s.do))
      const segment = steps.slice(from, end < 0 ? steps.length : end)
      // A program stops at its first download, with the file staged.
      const stop = from + (segment.findIndex((s) => s.do === 'download') + 1 || segment.length)
      const commit = steps.findIndex((s, i) => i >= from && i < stop && s.commit)
      const token = `${ctx.runId.slice(-8)}.${item.idx}.${item.attempts}`
      const compiled = () => {
        const output = segment.slice(0, stop - from).map((s, i) => compile(s, from + i, scope))
        if (hasSecrets(output, scope))
          throw new Error('A browser program cannot contain a runtime secret; use a Node HTTP/MCP step')
        return output
      }
      let code: string
      if (fresh) {
        const { files, names } = await this.#files(ctx, segment.slice(0, stop - from), scope, from)
        const plan = { steps: compiled(), token, budgetMs: BUDGET_MS, settleMs: 2000, next: from }
        const fragment = encodeURIComponent(JSON.stringify({ runtime: runtimeSource, plan, files }))
        if (fragment.length > FRAGMENT_LIMIT)
          throw new Error(`${names.join(', ')}: too large to reach the page through its URL`)
        ctx.pages.push({ target: goto(start), fragment })
        out.push({ action: { type: 'navigate', tab: slot, url: '' } })
        code = bootCode(from, token, cursor.waitedMs)
      } else if (cursor.carried) code = bootCode(from, token, cursor.waitedMs)
      else {
        if (segment.some((s) => s.do === 'upload'))
          throw new Error('An upload needs a preceding goto to carry its file into the page')
        code = inlineCode({
          steps: compiled(),
          token,
          budgetMs: BUDGET_MS,
          settleMs: 2000,
          from,
          waitedMs: cursor.waitedMs,
          next: from,
        })
      }
      const program: Program = {
        idx: item.idx,
        at: -1,
        start: Math.max(
          0,
          steps.findLastIndex((s, i) => i < from && s.do === 'goto'),
        ),
        from,
        end: stop,
        previouslyCommitted: this.#item(runId, item.idx).committed,
        download: steps[stop - 1]?.do === 'download',
        token,
        boot: fresh || Boolean(cursor.carried),
        last: true,
      }
      if (commit >= 0) {
        program.commit = commit
        if (!item.committed) ctx.commits.push({ idx: item.idx, step: commit })
      }
      out.push({ action: { type: 'run_js', tab: slot, code }, program })
    }
    ctx.entries.push(...out)
  }

  #scope(ctx: Context, item: ItemRow): Scope {
    const key = `${ctx.runId}:${item.idx}`
    const scope = this.#scopes.get(key) ?? {
      param: {},
      item: item.data,
      files: {},
      vars: { ...item.vars },
      secrets: [],
      secretVars: secretVariables(ctx.wf),
    }
    scope.param = { ...ctx.run.params }
    for (const [name, spec] of Object.entries(ctx.wf.params)) {
      if (!spec.secret || !spec.env) continue
      const value = process.env[spec.env]
      if (value) {
        scope.param[name] = value
        if (!scope.secrets?.includes(value)) scope.secrets?.push(value)
      } else if (spec.required)
        throw new Error(`Set environment variable ${spec.env} for secret param "${name}"`)
    }
    scope.files = { ...this.ledger.run(ctx.runId).files, ...ctx.state.cursors[item.idx]?.files }
    scope.key = item.key
    scope.committed = item.committed
    this.#scopes.set(key, scope)
    return scope
  }

  #call(ctx: Context, item: ItemRow, step: Step, scope: Scope, mcp: McpClients): Call {
    mkdirSync(join(this.runsDir, ctx.runId), { recursive: true })
    return {
      scope,
      mcp,
      dir: join(this.runsDir, ctx.runId),
      committed: item.committed,
      identity: JSON.stringify([ctx.wf.name, ctx.run.scope, item.key, step.id, '']),
      commit: () => {
        if (!step.commit) return
        this.ledger.updateItem(ctx.runId, item.idx, {
          committed: true,
          step: ctx.state.cursors[item.idx]?.step ?? 0,
          stepId: step.id,
        })
        scope.committed = true
      },
    }
  }

  #keep(
    ctx: Context,
    item: ItemRow,
    step: Extract<Step, { do: 'http' | 'mcp' }>,
    scope: Scope,
    done: Done,
  ): void {
    if (done.file) {
      const name = references(step.saveAs ?? '').length ? basename(done.file) : (step.saveAs as string)
      this.ledger.updateRun(ctx.runId, { files: { ...this.ledger.run(ctx.runId).files, [name]: done.file } })
      const cursor = ctx.state.cursors[item.idx] as Cursor
      cursor.files = { ...cursor.files, [step.id]: done.file, [name]: done.file }
      scope.files = { ...scope.files, ...cursor.files }
    }
    this.ledger.updateItem(ctx.runId, item.idx, { vars: snapshotVars(scope) })
    this.ledger.event(ctx.runId, step.do, { item: item.key, step: step.id, ...done.evidence })
  }

  /** The upload files of a segment: data URLs by step index, and their names and sizes. */
  async #files(ctx: Context, segment: Step[], scope: Scope, from: number) {
    const inbox = dirname(render(ctx.wf.items?.from ?? '', { ...scope, item: {} }))
    const files: Record<number, string> = {}
    const names: string[] = []
    for (const [i, step] of segment.entries()) {
      if (step.do !== 'upload') continue
      const rendered = render(step.file, scope)
      const path = references(step.file).some((r) => r.ns === 'item')
        ? await confine(rendered, inbox)
        : rendered
      if (!isAbsolute(path)) throw new Error(`Upload path must be absolute: ${path}`)
      const { size } = await stat(path)
      names.push(`${basename(path)} (${size} bytes)`)
      if (size > FILE_LIMIT) throw new Error(`${names.at(-1)}: too large to reach the page through its URL`)
      const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
      files[from + i] = `data:${type};base64,${(await readFile(path)).toString('base64')}`
    }
    return { files, names }
  }

  #finish(runId: string): HostResponse {
    const items = this.ledger.items(runId)
    const counts: Record<string, number> = {}
    for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1
    const cancelled = this.ledger.cancelled(runId)
    const finished = items.every((i) => ['done', 'skipped'].includes(i.status))
    const status = cancelled ? 'stopped' : finished ? 'done' : 'partial'
    if (!cancelled) this.ledger.updateRun(runId, { status })
    return {
      runId,
      batch: this.#state(runId).batch,
      actions: [],
      note: 'The batch is over: report the counts, then each failed or review item. Resume safe failures with host_next without results; uncertain writes need run_resolve with evidence first.',
      done: { status, counts, files: this.ledger.run(runId).files },
    }
  }

  #item(runId: string, idx: number): ItemRow {
    return this.ledger.item(runId, idx)
  }

  #state(runId: string): State {
    const row = this.ledger.db.prepare('SELECT state FROM host_state WHERE run_id = ?').get(runId)
    if (!row) throw new Error(`Run ${runId} was not started in host mode`)
    return JSON.parse(String(row.state))
  }

  #save(runId: string, state: State): void {
    // Includes the ledger's lease fence before this direct SQL write.
    this.ledger.updateRun(runId, {})
    this.ledger.db
      .prepare('INSERT OR REPLACE INTO host_state (run_id, state) VALUES (?, ?)')
      .run(runId, JSON.stringify(state))
  }
}

/** Params of a run: defaults applied, required ones checked; a secret would pass through the agent. */
function hostParams(wf: Workflow, params: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, spec] of Object.entries(wf.params)) {
    if (spec.secret) {
      if (Object.hasOwn(params, key))
        throw new Error(`Param "${key}" is secret: set environment variable ${spec.env}`)
      if (spec.required && !process.env[spec.env ?? ''])
        throw new Error(`Set environment variable ${spec.env} for secret param "${key}"`)
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

/** A result as the agent passed it (an object, or its JSON text); anything else counts as no result. */
function parseResult(value: unknown): HostResult | undefined {
  let result = value
  if (typeof result === 'string')
    try {
      result = JSON.parse(result)
    } catch {
      return undefined
    }
  return result && typeof result === 'object' && 'ok' in result ? (result as HostResult) : undefined
}

/** Host scripts cannot reproduce trusted keyboard or iframe browser automation. Refuse unsupported plans. */
function hostCheck(wf: Workflow): void {
  check(wf)
  if (wf.ensure)
    throw new Error('ensure requires the direct runner; host mode does not support destination lookup')
  if (wf.setup.length || wf.teardown.length)
    throw new Error('Host mode does not support setup or teardown yet; use an item-only workflow')
  for (const step of wf.item) {
    if (step.do !== 'http' && step.do !== 'mcp') {
      const sensitive = secretVariables(wf)
      if (
        references(JSON.stringify(step)).some(
          (ref) =>
            (ref.ns === 'param' && wf.params[ref.key]?.secret) ||
            (ref.ns === 'vars' && sensitive.includes(ref.key)),
        )
      )
        throw new Error(`${step.id}: a browser program cannot reference secrets; use a Node HTTP/MCP step`)
    }
    if (step.do === 'http' && step.session === 'browser')
      throw new Error(
        `${step.id}: host mode cannot share browser cookies with Node; use session: none or the browser runner`,
      )
    if (step.do === 'extract' || step.do === 'press')
      throw new Error(
        `${step.id}: host mode does not support ${step.do}; use the browser runner for this workflow`,
      )
    if ('target' in step && step.target?.frame)
      throw new Error(`${step.id}: host mode does not support iframe targets`)
  }
}

/** Validate the complete report before any journal changes. A bogus index cannot clear a commit or finish a row. */
function validateInput(input: HostInput, state: State): void {
  if (input.batch !== undefined && (!Number.isInteger(input.batch) || input.batch < 0))
    throw new Error('batch must be a nonnegative integer')
  if (input.results !== undefined && !Array.isArray(input.results))
    throw new Error('results must be an array')
  if (
    input.completed !== undefined &&
    (!Number.isInteger(input.completed) ||
      input.completed < 0 ||
      input.completed > state.actions ||
      input.error === undefined)
  )
    throw new Error('completed must count actions finished before the error')
  if ((input.results?.length ?? 0) > state.programs.length) throw new Error('Too many program results')
  for (const [i, value] of (input.results ?? []).entries()) {
    const p = state.programs[i]
    if (!p) throw new Error(`No issued program for result ${i + 1}`)
    if (p.kind === 'tool') {
      const envelope = value as { actionId?: unknown; result?: unknown } | null
      if (
        !envelope ||
        envelope.actionId !== p.actionId ||
        (!CallToolResultSchema.safeParse(envelope.result).success &&
          (envelope.result as { resultType?: string })?.resultType !== 'input_required')
      )
        throw new Error(`Invalid tool result ${i + 1}: return its actionId and raw MCP result`)
      if (input.completed !== undefined && p.at >= input.completed)
        throw new Error(`Result ${i + 1} belongs to an unfinished action`)
      continue
    }
    const r = parseResult(value)
    const index = (v: unknown) => Number.isInteger(v) && Number(v) >= p.from && Number(v) < p.end
    if (!r || typeof r.ok !== 'boolean') throw new Error(`Invalid program result ${i + 1}`)
    if ('missing' in r) {
      if (r.ok !== false || r.missing !== true) throw new Error(`Invalid missing result ${i + 1}`)
      continue
    }
    if (!Number.isInteger(r.sent) || (r.sent !== -1 && !index(r.sent)))
      throw new Error(`Invalid sent index in result ${i + 1}`)
    if (r.ok) {
      if ('pending' in r) {
        if (
          !index(r.pending) ||
          !Number.isFinite(r.waited) ||
          r.waited < 0 ||
          r.sent >= r.pending ||
          (p.commit !== undefined && r.pending > p.commit && r.sent < p.commit)
        )
          throw new Error(`Invalid pending result ${i + 1}`)
      } else if (
        r.next !== p.end ||
        Boolean(r.staged) !== p.download ||
        (p.commit !== undefined && r.sent < p.commit) ||
        (r.staged &&
          (r.sent !== p.end - 1 ||
            !Number.isInteger(r.staged.bytes) ||
            r.staged.bytes < 0 ||
            r.staged.bytes > 200 * 1024 * 1024 ||
            typeof r.staged.type !== 'string'))
      )
        throw new Error(`Invalid completion result ${i + 1}`)
    } else if (
      !index(r.at) ||
      r.sent > r.at ||
      typeof r.error !== 'string' ||
      typeof r.selector !== 'boolean'
    )
      throw new Error(`Invalid failure result ${i + 1}`)
    if (input.completed !== undefined && p.at >= input.completed)
      throw new Error(`Result ${i + 1} belongs to an unfinished action`)
  }
}

const clean = (clipboard: string) => (clipboard.startsWith('RITOKO|') ? '' : clipboard)

function compile(step: Step, index: number, scope: Scope): HostStep {
  const out: HostStep = { index, id: step.id as string, do: step.do, timeoutMs: step.timeoutMs ?? 10_000 }
  if (step.commit) out.commit = true
  if ('target' in step && step.target) {
    const selector = (s: typeof step.target.primary) =>
      Object.fromEntries(
        Object.entries(s).map(([key, value]) => [
          key,
          typeof value !== 'string'
            ? value
            : key === 'css' || key === 'xpath'
              ? renderSelector(value, scope, key)
              : render(value, scope),
        ]),
      ) as HostSelector
    out.target = {
      ...step.target,
      primary: selector(step.target.primary),
      fallbacks: step.target.fallbacks.map(selector),
    }
  }
  if ('value' in step && step.value !== undefined) out.value = render(step.value, scope)
  if (step.do === 'upload') out.fileName = basename(render(step.file, scope))
  if ('checked' in step) out.checked = step.checked
  if ('key' in step) out.key = step.key
  if ('text' in step && step.text) out.text = render(step.text, scope)
  if (step.do === 'expect' && step.url) out.url = render(step.url, scope)
  if (step.do === 'wait' && step.ms) out.ms = step.ms
  if ('onDialog' in step && step.onDialog) {
    out.onDialog = step.onDialog
    if (step.dialogText) out.dialogText = render(step.dialogText, scope)
  }
  return out
}
