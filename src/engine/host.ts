import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { extname, isAbsolute, join } from 'node:path'
import { destination } from './download.ts'
import { type HostProgram, type HostResult, type HostStep, hostProgram } from './host-page.ts'
import { readItems } from './items.ts'
import type { Ledger } from './ledger.ts'
import { paths } from './paths.ts'
import type { Step, Workflow } from './schema.ts'
import { check, type Store } from './store.ts'
import { references, render, type Scope } from './template.ts'

/**
 * Host mode: the agent's own integrated browser runs each item, Ritoko keeps the journal. Ritoko cannot
 * drive that browser (no external access), so it hands the agent one action at a time — open a URL, run a
 * compiled program, click the hand-off button — and records each outcome before giving the next. The
 * journal rules are the engine's: the commit is recorded before it is sent, an interrupted committed item
 * becomes review, done keys are skipped.
 */
export type HostAction =
  | { type: 'navigate'; url: string; note: string }
  /** `short` works once `code` ran in the same page (it defines the runtime); try it first. */
  | { type: 'run_js'; code: string; short: string; note: string }
  | { type: 'click'; name: string; note: string }
  | {
      type: 'done'
      status: 'done' | 'partial'
      counts: Record<string, number>
      files: Record<string, string>
    }

/** One call of the agent's JavaScript tool should not run longer than this. */
const BUDGET_MS = 90_000
const CARRY = 'ritoko-upload'
const MEDIA: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
}

type Cursor = { step: number; waitedMs: number; handoff?: string; clipboard?: string }

export class Host {
  readonly ledger: Ledger
  readonly store: Store
  readonly runsDir: string

  constructor(ledger: Ledger, store: Store, runsDir = paths.runs) {
    this.ledger = ledger
    this.store = store
    this.runsDir = runsDir
    ledger.db.exec(
      'CREATE TABLE IF NOT EXISTS host_cursor (run_id TEXT NOT NULL, idx INTEGER NOT NULL, cursor TEXT NOT NULL, PRIMARY KEY (run_id, idx))',
    )
  }

  async start(name: string, params: Record<string, string>): Promise<{ runId: string; action: HostAction }> {
    const wf = await this.store.get(name)
    check(wf)
    if (!wf.items) throw new Error('Host mode runs item batches')
    const scope: Scope = { param: params, item: {}, files: {} }
    const run = this.ledger.createRun(wf.name, wf.version, params, false, wf, render(wf.items.scope, scope))
    const rows = await readItems(render(wf.items.from, scope))
    if (!rows.length) throw new Error('Input batch is empty')
    const used = new Set(wf.items.required)
    for (const r of references(JSON.stringify(wf.item))) if (r.ns === 'item') used.add(r.key)
    this.ledger.addItems(
      run.id,
      rows.map((data, i) => {
        for (const column of used)
          if (!data[column]?.trim()) throw new Error(`Input row ${i + 1}: missing value "${column}"`)
        return { key: render(wf.items?.key ?? '', { ...scope, item: data }).trim(), data }
      }),
    )
    this.ledger.updateRun(run.id, { phase: 'items' })
    return { runId: run.id, action: await this.next(run.id) }
  }

  /**
   * Records the outcome of the action given last (`result`), then returns the next one. Without a result,
   * the previous action is treated as interrupted: a committed item becomes review, others restart.
   */
  async next(runId: string, result?: HostResult | { clicked: true }): Promise<HostAction> {
    const run = this.ledger.run(runId)
    const wf = run.definition as Workflow
    const scope: Scope = { param: run.params, item: {}, files: { ...run.files } }
    const items = this.ledger.items(runId)
    let current = items.find((i) => i.status === 'running')
    if (current) {
      const cursor = this.#cursor(runId, current.idx)
      const update = (patch: Parameters<Ledger['updateItem']>[2]) =>
        this.ledger.updateItem(runId, current?.idx ?? 0, patch)
      if (!result) {
        if (cursor.clipboard !== undefined) restoreClipboard(cursor.clipboard)
        if (current.committed)
          update({
            status: 'review',
            cause: 'interrupted',
            message: 'Interrupted after the commit step: check the site.',
          })
        else this.#save(runId, current.idx, { step: 0, waitedMs: 0 })
      } else if ('clicked' in result) {
        const file = this.#receive(runId, cursor, current.data, wf, scope)
        if (file) {
          this.ledger.updateRun(runId, { files: { ...this.ledger.run(runId).files, [file.name]: file.path } })
          update({ evidence: file.path })
          this.#save(runId, current.idx, { step: cursor.step, waitedMs: 0 })
        } else update(failure(current.committed, 'The file did not reach Ritoko through the hand-off'))
      } else if (result.ok && 'pending' in result) {
        const step = wf.item[result.pending] as Step
        const waited = cursor.waitedMs + BUDGET_MS
        if (waited >= (step.timeoutMs ?? 10_000))
          update(failure(current.committed, `${step.id}: still waiting after ${waited / 1000}s`))
        else this.#save(runId, current.idx, { step: result.pending, waitedMs: waited })
      } else if (result.ok) {
        const handoff = result.staged ? `${runId}:${current.idx}:${result.next - 1}` : undefined
        this.#save(runId, current.idx, { step: result.next, waitedMs: 0 })
        if (handoff) {
          // The user's clipboard, restored after the hand-off (a stale Ritoko payload is not theirs).
          const before = readClipboard()
          const clipboard = before.startsWith('RITOKO|') ? '' : before
          this.#save(runId, current.idx, { step: result.next, waitedMs: 0, handoff, clipboard })
          return {
            type: 'click',
            name: 'Ritoko · transmettre',
            note: 'Click this button in the page with a real click (computer tool, by its name): it hands the downloaded file to Ritoko. Then call host next with {"clicked":true}.',
          }
        }
      } else {
        const step = wf.item[result.at] as Step
        update(
          failure(current.committed, `${step.id}: ${result.error}`, result.selector ? 'selector' : 'system'),
        )
      }
      current = this.ledger.items(runId).find((i) => i.idx === current?.idx)
      if (current?.status === 'running' && this.#cursor(runId, current.idx).step >= wf.item.length) {
        this.ledger.updateItem(runId, current.idx, { status: 'done', cause: null, message: null })
        current = undefined
      } else if (current?.status !== 'running') current = undefined
    }

    while (!current) {
      const candidate = this.ledger.items(runId).find((i) => i.status === 'pending')
      if (!candidate) return this.#finish(runId)
      const previous = this.ledger.barrier(wf.name, run.scope, candidate.key, runId)
      if (previous) {
        this.ledger.updateItem(
          runId,
          candidate.idx,
          previous.uncertain
            ? { status: 'review', cause: 'duplicate', message: `Outcome unknown in run ${previous.runId}` }
            : { status: 'skipped', cause: 'duplicate', message: `Already done in run ${previous.runId}` },
        )
        continue
      }
      this.ledger.updateItem(runId, candidate.idx, { status: 'running', attempts: candidate.attempts + 1 })
      this.#save(runId, candidate.idx, { step: 0, waitedMs: 0 })
      current = this.ledger.items(runId).find((i) => i.idx === candidate.idx)
    }
    scope.item = current.data
    return this.#action(runId, wf, current.idx, current.key, this.#cursor(runId, current.idx), scope)
  }

  /** The next slice of the item: a navigation, or the steps up to the next navigation, commit or download. */
  async #action(
    runId: string,
    wf: Workflow,
    idx: number,
    key: string,
    cursor: Cursor,
    scope: Scope,
  ): Promise<HostAction> {
    const steps = wf.item
    const first = steps[cursor.step] as Step
    const label = `item ${idx + 1} (${key})`
    if (first.do === 'goto') {
      const url = render(first.url, scope)
      this.#save(runId, idx, { ...cursor, step: cursor.step + 1 })
      const upload = steps.slice(cursor.step + 1).find((s) => s.do === 'goto' || s.do === 'upload')
      if (upload?.do === 'upload') {
        const file = render(upload.file, scope)
        if (!isAbsolute(file)) throw new Error(`Upload path must be absolute: ${file}`)
        return {
          type: 'navigate',
          url: await carry(file, url),
          note: `Open this URL in the integrated browser (${label}), then call host next with {"ok":true,"next":${cursor.step + 1}}.`,
        }
      }
      return {
        type: 'navigate',
        url,
        note: `Open this URL in the integrated browser (${label}), then call host next with {"ok":true,"next":${cursor.step + 1}}.`,
      }
    }
    const slice: HostStep[] = []
    for (let i = cursor.step; i < steps.length; i++) {
      const step = steps[i] as Step
      if (step.do === 'goto' || ((step.commit || step.do === 'download') && slice.length)) break
      slice.push(compile(step, i, scope))
      if (step.do === 'download') break
      // The commit is journaled before it can be sent: an interruption from here on means review.
      if (step.commit) this.ledger.updateItem(runId, idx, { committed: true, step: i, stepId: step.id })
    }
    const program: HostProgram = {
      steps: slice,
      budgetMs: BUDGET_MS,
      token: `${runId}:${idx}:${(slice.at(-1) as HostStep).index}`,
      carry: CARRY,
    }
    return {
      type: 'run_js',
      code: `(globalThis.__ritokoHost ??= ${String(hostProgram)})(${JSON.stringify(program)})`,
      short: `__ritokoHost(${JSON.stringify(program)})`,
      note: `Run short with the integrated browser's JavaScript tool; if __ritokoHost is not defined (new page), run code instead (${label}, steps ${slice.map((s) => s.id).join(', ')}), then call host next with its JSON result.`,
    }
  }

  #receive(runId: string, cursor: Cursor, item: Record<string, string>, wf: Workflow, scope: Scope) {
    const text = readClipboard()
    if (cursor.clipboard !== undefined) restoreClipboard(cursor.clipboard)
    const prefix = `RITOKO|${cursor.handoff}|`
    if (!text.startsWith(prefix)) return undefined
    const data = text.slice(prefix.length)
    const type = data.slice(5, data.indexOf(';'))
    const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
    const step = wf.item[Number(cursor.handoff?.split(':').at(-1))] as Extract<Step, { do: 'download' }>
    const dir = join(this.runsDir, runId)
    mkdirSync(dir, { recursive: true })
    const wanted = render(step.saveAs, { ...scope, item })
    const path = destination(
      dir,
      extname(wanted) ? wanted : wanted + (MEDIA[type] ?? ''),
      `download${MEDIA[type] ?? ''}`,
      true,
    )
    writeFileSync(path, bytes, { flag: 'wx' })
    return { name: path.split(/[\\/]/).pop() as string, path }
  }

  #finish(runId: string): HostAction {
    const items = this.ledger.items(runId)
    const counts: Record<string, number> = {}
    for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1
    const status = items.every((i) => ['done', 'skipped'].includes(i.status)) ? 'done' : 'partial'
    this.ledger.updateRun(runId, { status })
    return { type: 'done', status, counts, files: this.ledger.run(runId).files }
  }

  #cursor(runId: string, idx: number): Cursor {
    const row = this.ledger.db
      .prepare('SELECT cursor FROM host_cursor WHERE run_id = ? AND idx = ?')
      .get(runId, idx)
    return row ? JSON.parse(String(row.cursor)) : { step: 0, waitedMs: 0 }
  }

  #save(runId: string, idx: number, cursor: Cursor): void {
    this.ledger.db
      .prepare('INSERT OR REPLACE INTO host_cursor (run_id, idx, cursor) VALUES (?, ?, ?)')
      .run(runId, idx, JSON.stringify(cursor))
  }
}

function failure(
  committed: boolean,
  message: string,
  cause: 'selector' | 'system' | 'verification' = 'verification',
) {
  return committed
    ? { status: 'review' as const, cause, message }
    : { status: 'failed' as const, cause, message }
}

function compile(step: Step, index: number, scope: Scope): HostStep {
  const out: HostStep = { index, id: step.id as string, do: step.do, timeoutMs: step.timeoutMs ?? 10_000 }
  if ('target' in step && step.target)
    out.target = JSON.parse(render(JSON.stringify(step.target), scope)) as HostStep['target']
  if ('value' in step && step.value !== undefined) out.value = render(step.value, scope)
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

/**
 * Brings a local file into the page: a short-lived local page (no CSP) reads it and opens `to` with the
 * file in the URL fragment, which never leaves the browser; the upload step turns it back into a File.
 */
async function carry(file: string, to: string): Promise<string> {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
  await readFile(file)
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'host-carry.ts'), String(port), file, to, CARRY],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  child.unref()
  for (let i = 0; i < 50; i++) {
    const ready = await fetch(`http://127.0.0.1:${port}/ping`)
      .then((r) => r.ok)
      .catch(() => false)
    if (ready) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return `http://127.0.0.1:${port}/`
}

function readClipboard(): string {
  if (process.platform === 'win32')
    return execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],
      {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
      },
    ).replace(/\r?\n$/, '')
  if (process.platform === 'darwin')
    return execFileSync('pbpaste', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return execFileSync('xclip', ['-selection', 'clipboard', '-o'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** Puts the user's text back on the clipboard, and checks it is really there. */
function restoreClipboard(text: string): void {
  writeClipboard(text)
  if (readClipboard() !== text) throw new Error('Could not restore the clipboard: check it before pasting')
}

function writeClipboard(text: string): void {
  if (process.platform === 'win32')
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Console]::InputEncoding=[Text.Encoding]::UTF8; $t=[Console]::In.ReadToEnd(); if ($t) { Set-Clipboard -Value $t } else { Set-Clipboard -Value $null }',
      ],
      { input: text, windowsHide: true },
    )
  else if (process.platform === 'darwin') execFileSync('pbcopy', { input: text })
  else execFileSync('xclip', ['-selection', 'clipboard'], { input: text })
}
