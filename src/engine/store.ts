import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from './paths.ts'
import { type Step, Target, Workflow, type WorkflowInput } from './schema.ts'
import { references } from './template.ts'

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
  async save(input: WorkflowInput): Promise<{ workflow: Workflow; warnings: string[] }> {
    const parsed = Workflow.parse(input)
    const previous = await this.get(parsed.name).catch(() => undefined)
    const workflow = { ...parsed, version: (previous?.version ?? 0) + 1 }
    const warnings = check(workflow)
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

/** Structural errors throw; quality issues come back as warnings. */
export function check(wf: Workflow): string[] {
  const all = [...wf.setup, ...wf.item, ...wf.teardown]
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
    if (s.commit && !['click', 'press', 'upload'].includes(s.do))
      throw new Error(`${s.id}: only click, press or upload may be a commit`)
  }
  if ([...wf.setup, ...wf.teardown].some((s) => s.commit))
    throw new Error('Commit steps belong in item, never setup or teardown')
  const commits = wf.item.filter((s) => s.commit)
  if (commits.length > 1) throw new Error('Only one commit is supported per item')
  if (wf.readOnly && commits.length) throw new Error('A read-only workflow cannot contain a commit')
  if (wf.item.length && !wf.readOnly && commits.length !== 1)
    throw new Error('A write batch needs one commit; use readOnly for exports or reads')
  const commitIndex = wf.item.findIndex((s) => s.commit)
  const checks = wf.item.slice(commitIndex + 1).filter((s) => s.do === 'expect')
  if (wf.item.length && !checks.length) throw new Error('An item needs an expect after its commit')
  if (
    commitIndex >= 0 &&
    wf.item.slice(commitIndex + 1).some((s) => !['expect', 'wait', 'download', 'extract'].includes(s.do))
  )
    throw new Error('Only verification, waiting, downloading or extracting is allowed after commit')

  const files = new Set<string>()
  const verify = (template: string, where: string, itemAllowed: boolean) => {
    for (const { ns, key } of references(template)) {
      if (ns === 'param' && !(key in wf.params)) throw new Error(`${where}: unknown param "${key}"`)
      if (ns === 'files' && !files.has(key))
        throw new Error(`${where}: "files.${key}" is not downloaded or extracted before`)
      if (ns === 'item' && !itemAllowed) throw new Error(`${where}: {{item.*}} is only allowed in item steps`)
    }
  }
  const walk = (steps: Step[], itemAllowed: boolean) => {
    for (const s of steps) {
      for (const field of ['url', 'value', 'file', 'text'] as const)
        if (field in s && typeof s[field as keyof Step] === 'string')
          verify(s[field as keyof Step] as string, s.id, itemAllowed)
      if ('target' in s && s.target) verify(JSON.stringify(s.target), s.id, itemAllowed)
      if (s.do === 'download' || s.do === 'extract') files.add(s.saveAs)
    }
  }
  walk(wf.setup, false)
  if (wf.items) {
    verify(wf.items.from, 'items.from', false)
    verify(wf.items.key, 'items.key', true)
    verify(wf.items.scope, 'items.scope', false)
    if (references(wf.items.scope).some((r) => r.ns !== 'param'))
      throw new Error('items.scope may only reference params describing the destination/account/operation')
  }
  walk(wf.item, true)
  walk(wf.teardown, false)

  const warnings: string[] = []
  if (wf.item.length && !wf.item.some((s) => s.do === 'expect'))
    warnings.push('No "expect" step in item: results will not be verified.')
  if (wf.item.some((s) => s.do === 'click') && !wf.item.some((s) => s.commit))
    warnings.push(
      'No step marked "commit": interrupted items will be replayed from scratch. Mark the submit click.',
    )
  for (const s of all)
    if ('target' in s && s.target?.primary.by === 'css' && /\[id=|#/.test(s.target.primary.css))
      warnings.push(
        `${s.id}: primary selector uses an id; prefer role, label or visible text if the id may be generated.`,
      )
  return warnings
}
