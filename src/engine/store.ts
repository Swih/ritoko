import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { paths } from './paths.ts'
import { type Step, Target, Workflow } from './schema.ts'
import { credential, references } from './template.ts'

/** Workflows are plain JSON files in ~/.ritoko/workflows, versioned on every save. */
export class Store {
  readonly dir: string

  constructor(dir = paths.workflows) {
    this.dir = dir
  }

  async list(): Promise<Pick<Workflow, 'name' | 'version' | 'description'>[]> {
    await mkdir(this.dir, { recursive: true })
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'))
    return Promise.all(
      files.map(async (f) => {
        const { name, version, description } = await this.get(f.slice(0, -5))
        return { name, version, description }
      }),
    )
  }

  async get(name: string): Promise<Workflow> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Invalid workflow name')
    const raw = await readFile(join(this.dir, `${name}.json`), 'utf8').catch(() => {
      throw new Error(`Unknown workflow "${name}"`)
    })
    return Workflow.parse(JSON.parse(raw))
  }

  /** Validates, bumps the version and writes. Returns warnings worth showing to the author. */
  async save(input: unknown): Promise<{ workflow: Workflow; warnings: string[] }> {
    const parsed = parseWorkflow(input)
    const previous = await this.get(parsed.name).catch(() => undefined)
    const workflow = { ...parsed, version: (previous?.version ?? 0) + 1 }
    const warnings = check(workflow)
    if (previous?.items && workflow.items && previous.items.scope !== workflow.items.scope)
      warnings.push(
        `items.scope changed from "${previous.items.scope}" to "${workflow.items.scope}": keys completed under the old scope are not recognized under a different one and would be submitted again.`,
      )
    if (workflow.items && !workflow.items.scope) warnings.push(UNSCOPED)
    await mkdir(this.dir, { recursive: true })
    const file = join(this.dir, `${workflow.name}.json`)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, { flag: 'wx' })
      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
    return { workflow, warnings }
  }

  async repair(name: string, stepId: string, target: unknown): Promise<Workflow> {
    const workflow = await this.get(name)
    const step = [...workflow.setup, ...workflow.item, ...workflow.teardown].find((s) => s.id === stepId)
    if (!step) throw new Error(`Unknown step "${stepId}" in workflow "${name}"`)
    if (!('target' in step)) throw new Error(`Step "${stepId}" has no target`)
    step.target = Target.parse(target)
    return (await this.save(workflow)).workflow
  }
}

/** An empty scope matches every scope in Ledger.barrier: the same key sent elsewhere counts as done. */
export const UNSCOPED =
  'items.scope is empty: such a run shares its keys with every scope of this workflow, so a key completed for one destination or account is skipped for another instead of submitted. Set items.scope from the params naming the destination/account/operation, e.g. "{{param.account}}".'

/** Parses a workflow, with one short "path: problem" line per error instead of a raw zod dump. */
export function parseWorkflow(input: unknown): Workflow {
  const result = Workflow.safeParse(input)
  if (result.success) return result.data
  const lines = result.error.issues.map((i) => `- ${z.core.toDotPath(i.path) || 'workflow'}: ${i.message}`)
  throw new Error(`Invalid workflow:\n${lines.join('\n')}`)
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']
/** Names whose value is a credential: it must come from a secret param, not be written into the workflow. */
const CREDENTIAL = /authorization|cookie|api-?key|token|secret|passw|pwd/i

/** Part of a URL template before its path: where the request goes. Item data must not choose it. */
function authority(url: string): string {
  const flat = url.replace(/\{\{[^}]*\}\}/g, (placeholder) => placeholder.replace(/[/?#]/g, '_'))
  const start = flat.match(/^[a-z][a-z\d+.-]*:\/\//i)?.[0].length ?? 0
  const end = flat.slice(start).search(/[/?#]/)
  return url.slice(0, end < 0 ? url.length : start + end)
}

/** Variables used as credentials are runtime-only even when their source field has a neutral name. */
export function secretVariables(wf: Workflow): string[] {
  const names = new Set<string>()
  const inspect = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (credential.test(key))
        for (const ref of references(JSON.stringify(child))) if (ref.ns === 'vars') names.add(ref.key)
      inspect(child)
    }
  }
  for (const step of [...wf.setup, ...wf.item, ...wf.teardown]) {
    if ('save' in step)
      for (const [name, path] of Object.entries(step.save ?? {}))
        if (credential.test(name) || credential.test(path)) names.add(name)
    if (step.do === 'http') inspect([step.headers, step.query, step.body])
    if (step.do === 'mcp') inspect(step.args)
  }
  return [...names]
}

/** Structural errors throw; quality issues come back as warnings. */
export function check(wf: Workflow): string[] {
  const lookup = wf.ensure?.read
  const all = [...wf.setup, ...wf.item, ...wf.teardown, ...(lookup ? [lookup] : [])]
  if (wf.ensure) {
    if (!wf.items?.scope.trim() || wf.readOnly)
      throw new Error('ensure requires a write batch with an explicit items.scope')
    const read = wf.ensure.read
    if (
      read.commit ||
      !(
        (read.do === 'http' &&
          read.method === 'GET' &&
          read.session === 'none' &&
          !read.body &&
          !read.idempotencyKey) ||
        (read.do === 'mcp' && read.readOnly === true)
      ) ||
      ('save' in read && read.save) ||
      ('saveAs' in read && read.saveAs) ||
      ('expect' in read && read.expect)
    )
      throw new Error(
        'ensure.read must be a direct GET or readOnly MCP lookup without commit, save, body or expect',
      )
    if (read.do === 'mcp') {
      const server = wf.servers[read.server]
      if (server && 'ref' in server && server.ref === 'agent')
        throw new Error('ensure does not support agent-managed MCP tools')
      if (wf.ensure.present.status || wf.ensure.absent.status)
        throw new Error('ensure status predicates are only supported for HTTP')
    }
    if (references(JSON.stringify(wf.ensure)).some((r) => r.ns !== 'param' && r.ns !== 'item'))
      throw new Error('ensure may only reference frozen item data and params; no setup variables or files')
    const keys = references(wf.items.key)
    const reads = references(
      JSON.stringify(
        read.do === 'http' ? [read.url, read.query, read.headers] : read.do === 'mcp' ? read.args : {},
      ),
    )
    const matches = Object.values(wf.ensure.present.json).flatMap(references)
    if (
      !keys.some((key) => key.ns === 'item') ||
      keys.some(
        (key) =>
          !reads.some((r) => r.ns === key.ns && r.key === key.key) ||
          !matches.some((r) => r.ns === key.ns && r.key === key.key),
      )
    )
      throw new Error('ensure.read and present.json must bind every template field in the business key')
  }
  const ids = all.map((s) => s.id)
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) throw new Error(`Duplicate step ids: ${dup.join(', ')}`)
  if (wf.item.length && !wf.items) throw new Error('"item" steps need an "items" source')
  if (wf.items && !wf.item.length) throw new Error('A batch needs item steps')
  for (const s of all) {
    if (s.do === 'expect' && !s.target && s.text === undefined && s.value === undefined && !s.url)
      throw new Error(`${s.id}: expect needs a target, text, value or URL`)
    if (s.do === 'expect' && s.text !== undefined && !s.text.trim())
      throw new Error(`${s.id}: expect text must not be empty`)
    if (s.do === 'expect' && s.value !== undefined && !s.target)
      throw new Error(`${s.id}: value verification needs a target`)
    if (s.commit && !['click', 'press', 'upload', 'select', 'check', 'http', 'mcp'].includes(s.do))
      throw new Error(`${s.id}: only click, press, upload, select, check, http or mcp may be a commit`)
    if (s.do === 'http' && s.body && SAFE_METHODS.includes(s.method))
      throw new Error(`${s.id}: ${s.method} requests have no body`)
    if (s.do === 'mcp' && !Object.hasOwn(wf.servers, s.server))
      throw new Error(`${s.id}: unknown server "${s.server}": declare it in "servers"`)
    if (s.do === 'mcp' && s.file !== undefined && !s.saveAs) throw new Error(`${s.id}: "file" needs saveAs`)
    if (
      !s.commit &&
      ((s.do === 'http' && !SAFE_METHODS.includes(s.method)) || (s.do === 'mcp' && !s.readOnly))
    )
      throw new Error(
        `${s.id}: an integration that writes must be the item's commit; setup, teardown and other integration steps must only read`,
      )
    if (
      wf.readOnly &&
      ((s.do === 'http' && !SAFE_METHODS.includes(s.method)) || (s.do === 'mcp' && !s.readOnly))
    )
      throw new Error(
        `${s.id}: a read-only workflow only sends http GET or HEAD and calls readOnly mcp tools`,
      )
  }
  for (const [key, spec] of Object.entries(wf.params)) {
    if (Boolean(spec.secret) !== Boolean(spec.env) || (spec.secret && spec.default !== undefined))
      throw new Error(`param "${key}": a secret param needs "env" (its environment variable) and no default`)
  }
  if ([...wf.setup, ...wf.teardown].some((s) => s.commit))
    throw new Error('Commit steps belong in item, never setup or teardown')
  const commits = wf.item.filter((s) => s.commit)
  if (commits.length > 1) throw new Error('Only one commit is supported per item')
  if (wf.readOnly && commits.length) throw new Error('A read-only workflow cannot contain a commit')
  if (wf.item.length && !wf.readOnly && commits.length !== 1)
    throw new Error('A write batch needs one commit; use readOnly for exports or reads')
  const commitIndex = wf.item.findIndex((s) => s.commit)
  // An http or mcp step proves a result when it expects something of it (a status only if set explicitly).
  const verifies = (s: Step) =>
    s.do === 'expect' ||
    ((s.do === 'http' || s.do === 'mcp') &&
      (Object.keys(s.expect?.json ?? {}).length > 0 ||
        (s.do === 'http' && Boolean(s.expect?.status?.length))))
  if (wf.item.length && !wf.item.slice(Math.max(commitIndex, 0)).some(verifies))
    throw new Error(
      commitIndex >= 0
        ? 'An item needs an expect after its commit'
        : 'An item needs an expect checking its result',
    )
  const safeAfterCommit = (s: Step) =>
    ['expect', 'wait', 'download', 'extract'].includes(s.do) ||
    (s.do === 'http' && SAFE_METHODS.includes(s.method)) ||
    (s.do === 'mcp' && s.readOnly === true)
  if (commitIndex >= 0 && !wf.item.slice(commitIndex + 1).every(safeAfterCommit))
    throw new Error(
      'Only verification, waiting, downloading, extracting, an http GET or a readOnly mcp call is allowed after commit',
    )

  const files = new Set<string>()
  const secretVars = new Set(secretVariables(wf))
  const nonSecret = (template: string, where: string) => {
    if (
      references(template).some(
        (ref) =>
          (ref.ns === 'param' && wf.params[ref.key]?.secret) ||
          (ref.ns === 'vars' && secretVars.has(ref.key)),
      )
    )
      throw new Error(`${where}: persisted paths, URLs and identities must not reference secrets`)
  }
  const verify = (template: string, where: string, itemAllowed: boolean, vars = new Set<string>()) => {
    for (const { ns, key } of references(template)) {
      if (ns === 'param' && !Object.hasOwn(wf.params, key))
        throw new Error(`${where}: unknown param "${key}"`)
      if (ns === 'files' && !files.has(key))
        throw new Error(`${where}: "files.${key}" is not downloaded or extracted before`)
      if (ns === 'item' && !itemAllowed) throw new Error(`${where}: {{item.*}} is only allowed in item steps`)
      if (ns === 'vars' && !vars.has(key))
        throw new Error(`${where}: "vars.${key}" is not saved by an earlier step (see "save")`)
    }
  }
  /** Item steps see the setup's variables and their own, never another item's. */
  const walk = (steps: Step[], itemAllowed: boolean, vars: Set<string>) => {
    for (const s of steps) {
      const scan = (template: string) => verify(template, s.id, itemAllowed, vars)
      for (const field of ['url', 'value', 'file', 'text', 'dialogText'] as const)
        if (field in s && typeof s[field as keyof Step] === 'string') scan(s[field as keyof Step] as string)
      if ('url' in s && typeof s.url === 'string') nonSecret(s.url, s.id)
      if ('target' in s && s.target) scan(JSON.stringify(s.target))
      if (s.do === 'http') {
        // Item data and saved values may fill the path, never choose the host.
        if (references(authority(s.url)).some((r) => r.ns === 'item' || r.ns === 'vars'))
          throw new Error(`${s.id}: the host of a URL cannot come from {{item.*}} or {{vars.*}}`)
        scan(JSON.stringify([s.headers, s.query, s.body, s.expect?.json]))
      }
      if (s.do === 'mcp') {
        scan(JSON.stringify([s.args, s.expect?.json]))
        const server = wf.servers[s.server]
        if (server && 'ref' in server && server.ref === 'agent')
          for (const ref of references(JSON.stringify(s.args ?? {})))
            if (
              (ref.ns === 'param' && wf.params[ref.key]?.secret) ||
              (ref.ns === 'vars' && secretVars.has(ref.key))
            )
              throw new Error(`${s.id}: agent-managed MCP arguments must not reference secrets`)
      }
      if ('saveAs' in s && s.saveAs) {
        scan(s.saveAs)
        nonSecret(s.saveAs, s.id)
        files.add(references(s.saveAs).length ? s.id : s.saveAs)
      }
      if ('save' in s)
        for (const [name, path] of Object.entries(s.save ?? {})) {
          vars.add(name)
          if (credential.test(name) || credential.test(path)) secretVars.add(name)
        }
    }
  }
  const setupVars = new Set<string>()
  walk(wf.setup, false, setupVars)
  if (wf.items) {
    verify(wf.items.from, 'items.from', false)
    nonSecret(wf.items.from, 'items.from')
    verify(wf.items.key, 'items.key', true)
    verify(wf.items.scope, 'items.scope', false)
    nonSecret(wf.items.key + wf.items.scope, 'items.key and items.scope')
    if (references(wf.items.scope).some((r) => r.ns !== 'param'))
      throw new Error('items.scope may only reference params describing the destination/account/operation')
  }
  walk(wf.item, true, new Set(setupVars))
  if (wf.ensure) {
    walk([wf.ensure.read], true, new Set())
    verify(JSON.stringify([wf.ensure.present, wf.ensure.absent]), 'ensure predicates', true)
    nonSecret(JSON.stringify([wf.ensure.present, wf.ensure.absent]), 'ensure predicates')
  }
  walk(wf.teardown, false, new Set(setupVars))
  // A server starts once per run, before any item: only params can fill it.
  for (const [name, server] of Object.entries(wf.servers)) {
    if ('url' in server) nonSecret(server.url, `servers.${name}`)
    const values =
      'command' in server
        ? [server.command, ...(server.args ?? []), ...Object.values({ ...server.env }), server.cwd ?? '']
        : 'url' in server
          ? [server.url, ...Object.values({ ...server.headers })]
          : []
    for (const value of values) {
      if (references(value).some((r) => r.ns !== 'param'))
        throw new Error(`servers.${name}: only {{param.*}} may be used there`)
      verify(value, `servers.${name}`, false)
    }
  }

  const warnings: string[] = []
  for (const s of all)
    if ('target' in s && s.target?.primary.by === 'css' && /\[id=|#/.test(s.target.primary.css))
      warnings.push(
        `${s.id}: primary selector uses an id; prefer role, label or visible text if the id may be generated.`,
      )
  const literal = (where: string, values: Record<string, string> | undefined) => {
    for (const [name, value] of Object.entries(values ?? {}))
      if (
        CREDENTIAL.test(name) &&
        value &&
        !references(value).some((r) => r.ns === 'vars' || (r.ns === 'param' && wf.params[r.key]?.secret))
      )
        throw new Error(
          `${where}: "${name}" holds a credential written into the workflow. Use a secret param backed by an environment variable, or a saved runtime credential.`,
        )
  }
  const credentials = (where: string, value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [name, child] of Object.entries(value)) {
      if (CREDENTIAL.test(name) && child !== undefined)
        literal(where, { [name]: typeof child === 'string' ? child : JSON.stringify(child) })
      credentials(`${where}.${name}`, child)
    }
  }
  for (const s of all) {
    if (s.do === 'http') {
      literal(s.id, s.headers)
      credentials(s.id, [s.query, s.body])
    }
    if (s.do === 'mcp') credentials(s.id, s.args)
  }
  for (const [name, server] of Object.entries(wf.servers)) {
    if ('command' in server) literal(`servers.${name}`, server.env)
    if ('url' in server) literal(`servers.${name}`, server.headers)
  }
  return warnings
}
