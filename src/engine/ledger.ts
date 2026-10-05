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
export type Cause = 'selector' | 'verification' | 'system' | 'interrupted' | 'duplicate' | 'cancelled'
/** Who settled a review item: a person, whose check Ritoko cannot see, or Ritoko reading the record back. */
export type ResolvedBy = 'manual' | 'reconcile' | 'ensure'
/** Provenance of a status set by a resolution rather than by the workflow's own checks. */
export type Resolution = { by: ResolvedBy; verified: boolean; note: string }

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
  /** Values saved by the setup's http and mcp steps, visible to every item. */
  vars: Record<string, string>
  status: RunStatus
  phase: 'setup' | 'items' | 'teardown'
  step: number
  /** Replay items already completed by a previous run (off by default: no double submission). */
  repeat: boolean
  message: string | null
  startedAt: string
  finishedAt: string | null
  /** Execution time, excluding pauses, stops and the time between them and a resume. */
  activeMs: number
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
  /** Values saved by this item's http and mcp steps. */
  vars: Record<string, string>
  /** Set while the item's status comes from a resolution: any later status change clears it. */
  resolution: Resolution | null
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
  vars: string
  status: RunStatus
  phase: Run['phase']
  step: number
  repeat: number
  message: string | null
  started_at: string
  finished_at: string | null
  active_ms: number
  active_since: number | null
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
  vars: string
  resolution: string | null
}

const itemRow = (r: ItemRecord): ItemRow => ({
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
  vars: JSON.parse(r.vars),
  resolution: r.resolution ? JSON.parse(r.resolution) : null,
})

const now = () => new Date().toISOString()
/** A lease holder refreshes its heartbeat this often; a lease silent for LEASE_EXPIRY_MS is abandoned. */
const HEARTBEAT_MS = 5_000
export const LEASE_EXPIRY_MS = 60_000

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
  /** Lease held by this client for the running operation: every journal write is fenced by it. */
  #owner: string | null = null

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
      CREATE INDEX IF NOT EXISTS items_run_status ON items(run_id, status, idx);
      CREATE INDEX IF NOT EXISTS events_run_kind ON events(run_id, kind);
    `)
    this.transaction(() => {
      for (const [table, additions] of Object.entries({
        runs: {
          definition: 'TEXT',
          scope: "TEXT NOT NULL DEFAULT ''",
          step_id: 'TEXT',
          items_loaded: 'INTEGER NOT NULL DEFAULT 0',
          active_ms: 'INTEGER NOT NULL DEFAULT 0',
          active_since: 'INTEGER',
          vars: "TEXT NOT NULL DEFAULT '{}'",
        },
        items: { step_id: 'TEXT', vars: "TEXT NOT NULL DEFAULT '{}'", resolution: 'TEXT' },
        leases: { heartbeat: 'INTEGER NOT NULL DEFAULT 0' },
      })) {
        const columns = this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r) => r.name)
        for (const [column, type] of Object.entries(additions)) {
          if (columns.includes(column)) continue
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
          // Earlier runs only kept wall-clock bounds.
          if (column === 'active_ms')
            this.db.exec(
              'UPDATE runs SET active_ms = CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER) WHERE finished_at IS NOT NULL',
            )
          // Every earlier resolution was a person's word: manual and unverified.
          if (column === 'resolution')
            this.db.exec(
              `UPDATE items SET resolution = json_object('by', 'manual', 'verified', json('false'), 'note', substr(message, 20)) WHERE message LIKE 'Manually resolved: %'`,
            )
        }
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

  /** Host checkpoints also identify runs made before driver reporting was added. */
  driver(runId: string): 'host' | 'direct' {
    const exists = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'host_state'")
      .get()
    return exists && this.db.prepare('SELECT 1 FROM host_state WHERE run_id = ?').get(runId)
      ? 'host'
      : 'direct'
  }

  /**
   * Fencing: a holder whose lease was taken over (heartbeat silent for LEASE_EXPIRY_MS, e.g. a suspended
   * laptop) must not write to the journal or go on to submit; its next write fails instead.
   */
  #fence(): void {
    if (this.#owner && !this.db.prepare('SELECT 1 FROM leases WHERE owner = ?').get(this.#owner))
      throw new Error('Ritoko lost its execution lease to another process: this operation was stopped.')
  }

  async exclusive<T>(fn: () => Promise<T>, resource = 'execution'): Promise<T> {
    const owner = randomUUID()
    const outer = this.#owner
    this.transaction(() => {
      const held = this.db.prepare('SELECT pid, heartbeat FROM leases WHERE resource = ?').get(resource)
      // A recycled PID or a hung process stops the heartbeat even though the PID looks alive.
      if (held && processAlive(Number(held.pid)) && Date.now() - Number(held.heartbeat) < LEASE_EXPIRY_MS)
        throw new Error(`Ritoko is busy (${resource}, process ${held.pid}). Wait for the active operation.`)
      this.db
        .prepare('INSERT OR REPLACE INTO leases (resource, owner, pid, heartbeat) VALUES (?, ?, ?, ?)')
        .run(resource, owner, process.pid, Date.now())
    })
    if (resource === 'execution') this.#owner = owner
    const beat = setInterval(() => {
      this.db.prepare('UPDATE leases SET heartbeat = ? WHERE owner = ?').run(Date.now(), owner)
    }, HEARTBEAT_MS)
    beat.unref()
    try {
      return await fn()
    } finally {
      clearInterval(beat)
      this.#owner = outer
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
        'INSERT INTO runs (id, workflow, version, params, repeat, status, started_at, definition, scope, active_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        Date.now(),
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
      vars: JSON.parse(r.vars),
      status: r.status,
      phase: r.phase,
      step: r.step,
      repeat: r.repeat === 1,
      message: r.message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      activeMs: r.active_ms + (r.active_since === null ? 0 : Date.now() - r.active_since),
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
        | 'vars'
        | 'version'
        | 'message'
        | 'definition'
        | 'itemsLoaded'
      >
    >,
  ): void {
    this.#fence()
    const sets: string[] = []
    const values: (string | number | null)[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k === 'stepId' ? 'step_id' : k === 'itemsLoaded' ? 'items_loaded' : k} = ?`)
      values.push(
        k === 'files' || k === 'vars' || k === 'definition'
          ? JSON.stringify(v)
          : typeof v === 'boolean'
            ? Number(v)
            : (v as string | number | null),
      )
    }
    if (patch.status) {
      sets.push('finished_at = ?')
      values.push(['done', 'partial', 'stopped'].includes(patch.status) ? now() : null)
      // Any status change closes the current execution segment; running opens a new one.
      const time = Date.now()
      sets.push('active_ms = active_ms + COALESCE(? - active_since, 0)', 'active_since = ?')
      values.push(time, patch.status === 'running' ? time : null)
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  addItems(runId: string, items: { key: string; data: Record<string, string> }[]): void {
    if (items.some((i) => !i.key.trim())) throw new Error('Empty business key in input')
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const { key } of items) (seen.has(key) ? duplicates : seen).add(key)
    if (duplicates.size) throw new Error(`Duplicate item keys in input: ${[...duplicates].join(', ')}`)
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

  items(runId: string, status?: ItemStatus): ItemRow[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM items WHERE run_id = ? AND status = ? ORDER BY idx').all(runId, status)
      : this.db.prepare('SELECT * FROM items WHERE run_id = ? ORDER BY idx').all(runId)
    return (rows as ItemRecord[]).map(itemRow)
  }

  item(runId: string, idx: number): ItemRow {
    const row = this.db.prepare('SELECT * FROM items WHERE run_id = ? AND idx = ?').get(runId, idx) as
      | ItemRecord
      | undefined
    if (!row) throw new Error(`Unknown item ${idx} in run ${runId}`)
    return itemRow(row)
  }

  nextItem(runId: string, status: ItemStatus): ItemRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM items WHERE run_id = ? AND status = ? ORDER BY idx LIMIT 1')
      .get(runId, status) as ItemRecord | undefined
    return row && itemRow(row)
  }

  updateItem(
    runId: string,
    idx: number,
    patch: Partial<
      Pick<
        ItemRow,
        | 'status'
        | 'step'
        | 'stepId'
        | 'committed'
        | 'cause'
        | 'message'
        | 'evidence'
        | 'attempts'
        | 'vars'
        | 'resolution'
      >
    >,
  ): void {
    this.#fence()
    // A status set by anything but a resolution replaces the resolved one.
    const changes = 'status' in patch && !('resolution' in patch) ? { ...patch, resolution: null } : patch
    const sets = Object.keys(changes).map((k) => `${k === 'stepId' ? 'step_id' : k} = ?`)
    const values = Object.values(changes).map((v) =>
      typeof v === 'boolean' ? Number(v) : v && typeof v === 'object' ? JSON.stringify(v) : (v ?? null),
    )
    this.db
      .prepare(`UPDATE items SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE run_id = ? AND idx = ?`)
      .run(...(values as (string | number | null)[]), now(), runId, idx)
  }

  /** Run in which this workflow already completed the item with this key, if any. */
  completedElsewhere(workflow: string, key: string, runId: string): string | undefined {
    const found = this.barrier(workflow, this.run(runId).scope, key, runId)
    return found && !found.uncertain ? found.runId : undefined
  }

  /**
   * Uncertain outcomes take precedence over completions, even when repeat is requested. Only completed,
   * submitted or review items block a key: an item interrupted before its commit never reached the site.
   * A run without scope sees every scope of the workflow, and a scoped run sees unscoped runs.
   */
  barrier(
    workflow: string,
    scope: string,
    key: string,
    runId: string,
  ): { runId: string; status: ItemStatus; uncertain: boolean; data: Record<string, string> } | undefined {
    const row = this.db
      .prepare(
        `SELECT i.* FROM items i JOIN runs r ON r.id = i.run_id
         WHERE r.workflow = ? AND (?2 = '' OR r.scope = ?2 OR r.scope = '' OR r.definition IS NULL)
         AND i.key = ? AND i.run_id != ?
         AND (i.status = 'done' OR (COALESCE(i.cause, '') != 'duplicate' AND (i.committed = 1 OR i.status = 'review')))
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
    this.#fence()
    this.db
      .prepare('INSERT INTO events (run_id, kind, detail, at) VALUES (?, ?, ?, ?)')
      .run(runId, kind, JSON.stringify(detail), now())
  }

  /** Details of a run's events of one kind, oldest first. */
  events(runId: string, kind: string): unknown[] {
    return this.db
      .prepare('SELECT detail FROM events WHERE run_id = ? AND kind = ? ORDER BY rowid')
      .all(runId, kind)
      .map((r) => JSON.parse(String(r.detail)))
  }

  /**
   * Settles a review item. A person's resolution is recorded as unverified and needs their confirmation that
   * they checked the destination: a wrong done loses the write for good, a wrong failed submits it again.
   * A reconciliation (by Ritoko reading the record back) carries what it read as evidence.
   */
  resolve(
    runId: string,
    key: string,
    status: 'done' | 'failed',
    note: string,
    {
      by,
      evidence,
      confirmChecked = false,
    }: { by: Exclude<ResolvedBy, 'ensure'>; evidence?: string; confirmChecked?: boolean },
  ): void {
    if (!note.trim()) throw new Error('Resolution needs a note describing the check on the site')
    const item = this.items(runId).find((i) => i.key === key)
    if (item?.status !== 'review') throw new Error('Only a review item can be resolved')
    if (item.cause === 'duplicate') throw new Error(`Resolve the original run first: ${item.message}`)
    if (by === 'manual' && !confirmChecked) {
      const risk =
        status === 'done'
          ? `Resolving "${key}" as done tells Ritoko the record exists: later runs skip this row, so if it does not exist it is never submitted.`
          : `Resolving "${key}" as failed means the run will submit this row again on resume, which creates a duplicate if the record already exists at the destination.`
      throw new Error(
        `${risk} Ask the user to check the record at the destination first, and pass confirmChecked: true (CLI: --confirm-checked) only once they confirm that check; never set it on your own.`,
      )
    }
    if (by === 'reconcile' && !evidence?.trim())
      throw new Error('A reconciliation needs the evidence it read back')
    const verified = by === 'reconcile'
    this.transaction(() => {
      this.updateItem(runId, item.idx, {
        status,
        committed: status === 'done',
        step: 0,
        stepId: null,
        cause: null,
        message: `${verified ? 'Reconciled (verified)' : 'Manually resolved (unverified)'}: ${note}`,
        resolution: { by, verified, note },
      })
      this.event(runId, 'resolve', {
        key,
        status,
        note,
        by,
        verified,
        ...(evidence && { evidence }),
        at: now(),
      })
      // A paused run keeps waiting for its repair; other runs finish items on resume; a cancelled run stays stopped.
      if (this.run(runId).status !== 'paused' && !this.cancelled(runId))
        this.updateRun(runId, { status: 'partial', phase: 'items', stepId: null })
    })
  }

  /**
   * Stops a run for good: items it never submitted become failed (cancelled), so other runs may process
   * their keys; items possibly submitted are held for review.
   */
  cancel(runId: string): void {
    if (this.run(runId).status === 'done') throw new Error('Run already done')
    this.transaction(() => {
      for (const item of this.items(runId))
        if (['pending', 'running', 'paused'].includes(item.status))
          this.updateItem(
            runId,
            item.idx,
            item.committed
              ? {
                  status: 'review',
                  cause: 'interrupted',
                  message: 'Run cancelled after the commit step: check on the site whether it went through.',
                }
              : { status: 'failed', cause: 'cancelled', message: 'Run cancelled before submission' },
          )
      this.event(runId, 'cancel', {})
      this.updateRun(runId, { status: 'stopped', stepId: null, message: 'Cancelled' })
    })
  }

  /** A cancelled run is final: resuming it would replay items its cancellation released to other runs. */
  cancelled(runId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM events WHERE run_id = ? AND kind = 'cancel'").get(runId))
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
