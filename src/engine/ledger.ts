import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type RunStatus = 'running' | 'paused' | 'done' | 'stopped'
/**
 * pending → running → done | failed | review | skipped.
 * `paused` waits for a repair; `review` means the outcome is unknown and needs a human check.
 */
export type ItemStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'review' | 'skipped'
export type Cause = 'selector' | 'verification' | 'system' | 'interrupted' | 'duplicate'

export type Run = {
  id: string
  workflow: string
  version: number
  params: Record<string, string>
  files: Record<string, string>
  status: RunStatus
  phase: 'setup' | 'items' | 'teardown'
  step: number
  /** Replay items already completed by a previous run (off by default: no double submission). */
  repeat: boolean
  message: string | null
  startedAt: string
  finishedAt: string | null
}

export type ItemRow = {
  runId: string
  idx: number
  key: string
  data: Record<string, string>
  status: ItemStatus
  step: number
  committed: boolean
  cause: Cause | null
  message: string | null
  evidence: string | null
  attempts: number
}

type RunRecord = {
  id: string
  workflow: string
  version: number
  params: string
  files: string
  status: RunStatus
  phase: Run['phase']
  step: number
  repeat: number
  message: string | null
  started_at: string
  finished_at: string | null
}

type ItemRecord = {
  run_id: string
  idx: number
  key: string
  data: string
  status: ItemStatus
  step: number
  committed: number
  cause: Cause | null
  message: string | null
  evidence: string | null
  attempts: number
}

const now = () => new Date().toISOString()

/** Durable journal of runs and items (node:sqlite). Every state change is written before moving on. */
export class Ledger {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, workflow TEXT NOT NULL, version INTEGER NOT NULL,
        params TEXT NOT NULL, files TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'setup', step INTEGER NOT NULL DEFAULT 0,
        repeat INTEGER NOT NULL DEFAULT 0, message TEXT, started_at TEXT NOT NULL, finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS items (
        run_id TEXT NOT NULL REFERENCES runs(id), idx INTEGER NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', step INTEGER NOT NULL DEFAULT 0, committed INTEGER NOT NULL DEFAULT 0,
        cause TEXT, message TEXT, evidence TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, idx), UNIQUE (run_id, key)
      );
    `)
  }

  createRun(workflow: string, version: number, params: Record<string, string>, repeat = false): Run {
    const id = `${workflow}-${now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${Math.random().toString(36).slice(2, 6)}`
    this.db
      .prepare(
        'INSERT INTO runs (id, workflow, version, params, repeat, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, workflow, version, JSON.stringify(params), Number(repeat), 'running', now())
    return this.run(id)
  }

  run(id: string): Run {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined
    if (!r) throw new Error(`Unknown run ${id}`)
    return {
      id: r.id,
      workflow: r.workflow,
      version: r.version,
      params: JSON.parse(r.params),
      files: JSON.parse(r.files),
      status: r.status,
      phase: r.phase,
      step: r.step,
      repeat: r.repeat === 1,
      message: r.message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }
  }

  updateRun(
    id: string,
    patch: Partial<Pick<Run, 'status' | 'phase' | 'step' | 'files' | 'version' | 'message'>>,
  ): void {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`)
      values.push(k === 'files' ? JSON.stringify(v) : (v as string | number | null))
    }
    if (patch.status === 'done' || patch.status === 'stopped') sets.push(`finished_at = '${now()}'`)
    this.db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  addItems(runId: string, items: { key: string; data: Record<string, string> }[]): void {
    const duplicates = items.map((i) => i.key).filter((k, i, all) => all.indexOf(k) !== i)
    if (duplicates.length)
      throw new Error(`Duplicate item keys in input: ${[...new Set(duplicates)].join(', ')}`)
    const insert = this.db.prepare(
      'INSERT INTO items (run_id, idx, key, data, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    this.db.exec('BEGIN')
    items.forEach((item, idx) => {
      insert.run(runId, idx, item.key, JSON.stringify(item.data), now())
    })
    this.db.exec('COMMIT')
  }

  items(runId: string): ItemRow[] {
    return (
      this.db.prepare('SELECT * FROM items WHERE run_id = ? ORDER BY idx').all(runId) as ItemRecord[]
    ).map((r) => ({
      runId: r.run_id,
      idx: r.idx,
      key: r.key,
      data: JSON.parse(r.data),
      status: r.status,
      step: r.step,
      committed: r.committed === 1,
      cause: r.cause,
      message: r.message,
      evidence: r.evidence,
      attempts: r.attempts,
    }))
  }

  updateItem(
    runId: string,
    idx: number,
    patch: Partial<
      Pick<ItemRow, 'status' | 'step' | 'committed' | 'cause' | 'message' | 'evidence' | 'attempts'>
    >,
  ): void {
    const sets = Object.keys(patch).map((k) => `${k} = ?`)
    const values = Object.values(patch).map((v) => (typeof v === 'boolean' ? Number(v) : (v ?? null)))
    this.db
      .prepare(`UPDATE items SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE run_id = ? AND idx = ?`)
      .run(...(values as (string | number | null)[]), now(), runId, idx)
  }

  /** Run in which this workflow already completed the item with this key, if any. */
  completedElsewhere(workflow: string, key: string, runId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT items.run_id AS id FROM items JOIN runs ON runs.id = items.run_id
         WHERE runs.workflow = ? AND items.key = ? AND items.status = 'done' AND items.run_id != ? LIMIT 1`,
      )
      .get(workflow, key, runId) as { id: string } | undefined
    return row?.id
  }

  lastRun(workflow?: string): Run | undefined {
    const row = (
      workflow
        ? this.db
            .prepare('SELECT id FROM runs WHERE workflow = ? ORDER BY started_at DESC LIMIT 1')
            .get(workflow)
        : this.db.prepare('SELECT id FROM runs ORDER BY started_at DESC LIMIT 1').get()
    ) as { id: string } | undefined
    return row && this.run(row.id)
  }
}
