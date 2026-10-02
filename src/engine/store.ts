import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
    await writeFile(join(this.dir, `${workflow.name}.json`), `${JSON.stringify(workflow, null, 2)}\n`)
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

  const files = new Set<string>()
  const verify = (template: string, where: string, itemAllowed: boolean) => {
    for (const { ns, key } of references(template)) {
      if (ns === 'param' && !(key in wf.params)) throw new Error(`${where}: unknown param "${key}"`)
      if (ns === 'files' && !files.has(key))
        throw new Error(`${where}: "files.${key}" is not downloaded before`)
      if (ns === 'item' && !itemAllowed) throw new Error(`${where}: {{item.*}} is only allowed in item steps`)
    }
  }
  const walk = (steps: Step[], itemAllowed: boolean) => {
    for (const s of steps) {
      for (const field of ['url', 'value', 'file', 'text'] as const)
        if (field in s && typeof s[field as keyof Step] === 'string')
          verify(s[field as keyof Step] as string, s.id, itemAllowed)
      if (s.do === 'download') files.add(s.saveAs)
    }
  }
  walk(wf.setup, false)
  if (wf.items) {
    verify(wf.items.from, 'items.from', false)
    verify(wf.items.key, 'items.key', true)
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
