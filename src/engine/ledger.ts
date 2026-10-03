import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Workflow } from './schema.ts'

export type RunStatus = 'running' | 'paused' | 'done' | 'partial' | 'stopped'
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
  definition: Workflow | null
  scope: string
  stepId: string | null
  itemsLoaded: boolean
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
  stepId: string | null
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
  definition: string | null
  scope: string
  step_id: string | null
  items_loaded: number
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
  step_id: string | null
  committed: number
  cause: Cause | null
  message: string | null
  evidence: string | null
  attempts: number
}

const now = () => new Date().toISOString()

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Durable journal of runs and items (node:sqlite). Every state change is written before moving on. */
export class Ledger {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
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
      CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS items_business_key ON items(key);
    `)
    this.transaction(() => {
      for (const [table, additions] of Object.entries({
        runs: {
          definition: 'TEXT',
          scope: "TEXT NOT NULL DEFAULT ''",
          step_id: 'TEXT',
          items_loaded: 'INTEGER NOT NULL DEFAULT 0',
        },
        items: { step_id: 'TEXT' },
      })) {
        const columns = this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r) => r.name)
        for (const [column, type] of Object.entries(additions))
          if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }
      this.db.exec(
        'UPDATE runs SET items_loaded = 1 WHERE EXISTS (SELECT 1 FROM items WHERE run_id = runs.id)',
      )
    })
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async exclusive<T>(fn: () => Promise<T>, resource = 'execution'): Promise<T> {
    const owner = randomUUID()
    this.transaction(() => {
      const held = this.db.prepare('SELECT pid FROM leases WHERE resource = ?').get(resource)
      if (held && processAlive(Number(held.pid)))
        throw new Error(`Ritoko is busy (${resource}, process ${held.pid}). Wait for the active operation.`)
      this.db
        .prepare('INSERT OR REPLACE INTO leases (resource, owner, pid) VALUES (?, ?, ?)')
        .run(resource, owner, process.pid)
    })
    try {
      return await fn()
    } finally {
      this.db.prepare('DELETE FROM leases WHERE resource = ? AND owner = ?').run(resource, owner)
    }
  }

  createRun(
    workflow: string,
    version: number,
    params: Record<string, string>,
    repeat = false,
    definition: Workflow | null = null,
    scope = '',
  ): Run {
    const id = `${workflow}-${randomUUID()}`
    this.db
      .prepare(
        'INSERT INTO runs (id, workflow, version, params, repeat, status, started_at, definition, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        workflow,
        version,
        JSON.stringify(params),
        Number(repeat),
        'running',
        now(),
        definition ? JSON.stringify(definition) : null,
        scope,
      )
    return this.run(id)
  }

  run(id: string): Run {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined
    if (!r) throw new Error(`Unknown run ${id}`)
    return {
      id: r.id,
      workflow: r.workflow,
      version: r.version,
      definition: r.definition ? JSON.parse(r.definition) : null,
      scope: r.scope,
      stepId: r.step_id,
      itemsLoaded: r.items_loaded === 1,
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
    patch: Partial<
      Pick<
        Run,
        | 'status'
        | 'phase'
        | 'step'
        | 'stepId'
        | 'files'
        | 'version'
        | 'message'
        | 'definition'
        | 'itemsLoaded'
      >
    >,
  ): void {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k === 'stepId' ? 'step_id' : k === 'itemsLoaded' ? 'items_loaded' : k} = ?`)
      values.push(
        k === 'files' || k === 'definition'
          ? JSON.stringify(v)
          : typeof v === 'boolean'
            ? Number(v)
            : (v as string | number | null),
      )
    }
    if (patch.status) {
      sets.push('finished_at = ?')
      values.push(['done', 'partial', 'stopped'].includes(patch.status) ? now() : null)
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  addItems(runId: string, items: { key: string; data: Record<string, string> }[]): void {
    if (items.some((i) => !i.key.trim())) throw new Error('Empty business key in input')
    const duplicates = items.map((i) => i.key).filter((k, i, all) => all.indexOf(k) !== i)
    if (duplicates.length)
      throw new Error(`Duplicate item keys in input: ${[...new Set(duplicates)].join(', ')}`)
    const insert = this.db.prepare(
      'INSERT INTO items (run_id, idx, key, data, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    this.transaction(() => {
      items.forEach((item, idx) => {
        insert.run(runId, idx, item.key, JSON.stringify(item.data), now())
      })
      this.updateRun(runId, { itemsLoaded: true })
    })
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
      stepId: r.step_id,
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
      Pick<
        ItemRow,
        'status' | 'step' | 'stepId' | 'committed' | 'cause' | 'message' | 'evidence' | 'attempts'
      >
    >,
  ): void {
    const sets = Object.keys(patch).map((k) => `${k === 'stepId' ? 'step_id' : k} = ?`)
    const values = Object.values(patch).map((v) => (typeof v === 'boolean' ? Number(v) : (v ?? null)))
    this.db
      .prepare(`UPDATE items SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE run_id = ? AND idx = ?`)
      .run(...(values as (string | number | null)[]), now(), runId, idx)
  }

  /** Run in which this workflow already completed the item with this key, if any. */
  completedElsewhere(workflow: string, key: string, runId: string): string | undefined {
    const found = this.barrier(workflow, this.run(runId).scope, key, runId)
    return found && !found.uncertain ? found.runId : undefined
  }

  /** Uncertain outcomes take precedence over completions, even when repeat is requested. */
  barrier(
    workflow: string,
    scope: string,
    key: string,
    runId: string,
  ): { runId: string; status: ItemStatus; uncertain: boolean; data: Record<string, string> } | undefined {
    const row = this.db
      .prepare(
        `SELECT i.* FROM items i JOIN runs r ON r.id = i.run_id
         WHERE r.workflow = ? AND (r.scope = ? OR r.scope = '' OR r.definition IS NULL) AND i.key = ? AND i.run_id != ?
         AND (i.status = 'done' OR (COALESCE(i.cause, '') != 'duplicate'
           AND (i.committed = 1 OR i.status IN ('review', 'running', 'paused'))))
         ORDER BY CASE WHEN i.status = 'done' THEN 1 ELSE 0 END, i.updated_at DESC LIMIT 1`,
      )
      .get(workflow, scope, key, runId) as ItemRecord | undefined
    return row
      ? {
          runId: row.run_id,
          status: row.status,
          uncertain: row.status !== 'done',
          data: JSON.parse(row.data),
        }
      : undefined
  }

  event(runId: string, kind: string, detail: unknown): void {
    this.db
      .prepare('INSERT INTO events (run_id, kind, detail, at) VALUES (?, ?, ?, ?)')
      .run(runId, kind, JSON.stringify(detail), now())
  }

  resolve(runId: string, key: string, status: 'done' | 'failed', note: string): void {
    if (!note.trim()) throw new Error('Resolution needs a note describing the check on the site')
    const item = this.items(runId).find((i) => i.key === key)
    if (item?.status !== 'review') throw new Error('Only a review item can be resolved')
    if (item.cause === 'duplicate') throw new Error(`Resolve the original run first: ${item.message}`)
    this.transaction(() => {
      this.updateItem(runId, item.idx, {
        status,
        committed: status === 'done',
        step: 0,
        stepId: null,
        cause: null,
        message: `Manually resolved: ${note}`,
      })
      this.event(runId, 'resolve', { key, status, note })
      this.updateRun(runId, { status: 'partial', phase: 'items', stepId: null })
    })
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
