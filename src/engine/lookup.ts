import { type Call, pointer, runHttp, runMcp, VerificationError } from './integrations.ts'
import type { Workflow } from './schema.ts'
import { mask, render } from './template.ts'

/** Reads once. A missing field, conflict, error or ambiguous answer establishes neither outcome. */
export async function lookup(ensure: NonNullable<Workflow['ensure']>, call: Call) {
  try {
    const read = ensure.read
    const options = { ...call, readback: true, committed: true, commit: () => {} }
    const statuses = (predicate: typeof ensure.present) =>
      predicate.status ?? Array.from({ length: 100 }, (_, i) => 200 + i)
    const result =
      read.do === 'http'
        ? await runHttp(
            {
              ...read,
              expect: { status: [...new Set([...statuses(ensure.present), ...statuses(ensure.absent)])] },
            },
            options,
          )
        : read.do === 'mcp'
          ? await runMcp(read, options)
          : (() => {
              throw new Error('Unsupported lookup mode')
            })()
    const matches = (predicate: typeof ensure.present) =>
      (read.do !== 'http' || statuses(predicate).includes(Number(result.evidence.status))) &&
      Object.entries(predicate.json).every(([path, template]) => {
        const found = pointer(result.value, path)
        return (
          found !== undefined &&
          (typeof found === 'string' ? found : JSON.stringify(found)) === render(template, call.scope)
        )
      })
    const present = matches(ensure.present)
    const absent = matches(ensure.absent)
    if (present === absent)
      throw new VerificationError(
        'Lookup is inconclusive: expected exactly one of present or absent business predicates',
      )
    const outcome = present ? 'present' : 'absent'
    // Predicate paths identify the checked evidence without persisting response bodies or credentials.
    return {
      outcome,
      evidence: {
        ...result.evidence,
        outcome,
        checked: Object.keys(ensure[outcome].json),
        at: new Date().toISOString(),
      },
    } as const
  } catch (error) {
    if (error instanceof Error) error.message = mask(error.message, call.scope)
    throw error
  }
}
