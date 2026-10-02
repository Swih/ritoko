import { z } from 'zod'

export const Selector = z.discriminatedUnion('by', [
  z.object({
    by: z.literal('role'),
    role: z.string(),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.object({ by: z.literal('label'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ by: z.literal('placeholder'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ by: z.literal('text'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ by: z.literal('testid'), id: z.string() }),
  z.object({ by: z.literal('css'), css: z.string() }),
  z.object({ by: z.literal('xpath'), xpath: z.string() }),
])
export type Selector = z.infer<typeof Selector>

export const Target = z.object({
  primary: Selector,
  fallbacks: z.array(Selector).default([]),
  description: z.string().optional(),
})
export type Target = z.infer<typeof Target>

const base = {
  id: z.string().regex(/^[\w-]+$/),
  note: z.string().optional(),
  /** Point of no return: once started, an interrupted item is never replayed blindly. */
  commit: z.boolean().optional(),
}

export const Step = z.discriminatedUnion('do', [
  z.object({ ...base, do: z.literal('goto'), url: z.string() }),
  z.object({ ...base, do: z.literal('click'), target: Target }),
  z.object({ ...base, do: z.literal('fill'), target: Target, value: z.string() }),
  z.object({ ...base, do: z.literal('select'), target: Target, value: z.string() }),
  z.object({ ...base, do: z.literal('check'), target: Target, checked: z.boolean().default(true) }),
  z.object({ ...base, do: z.literal('press'), target: Target.optional(), key: z.string() }),
  z.object({ ...base, do: z.literal('upload'), target: Target, file: z.string() }),
  /** Clicks the target and saves the resulting download as `files.<saveAs>`. */
  z.object({ ...base, do: z.literal('download'), target: Target, saveAs: z.string() }),
  /** Verification. Fails the item when the page does not match. */
  z.object({
    ...base,
    do: z.literal('expect'),
    target: Target.optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    url: z.string().optional(),
  }),
  z.object({
    ...base,
    do: z.literal('wait'),
    target: Target.optional(),
    ms: z.number().int().positive().optional(),
  }),
])
export type Step = z.infer<typeof Step>
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
export type StepBody = WithoutId<Step>

export const Workflow = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case'),
  version: z.number().int().positive().default(1),
  description: z.string(),
  params: z
    .record(
      z.string(),
      z.object({
        description: z.string(),
        required: z.boolean().default(true),
        default: z.string().optional(),
      }),
    )
    .default({}),
  /** Batch source: a template resolving to an .xlsx or .csv path, e.g. "{{files.input}}" or "{{param.input}}". */
  items: z
    .object({
      from: z.string(),
      sheet: z.union([z.string(), z.number()]).optional(),
      /** Business identity of an item, e.g. "{{item.Email}}". Must be unique in the batch. */
      key: z.string(),
    })
    .optional(),
  setup: z.array(Step).default([]),
  item: z.array(Step).default([]),
  teardown: z.array(Step).default([]),
})
export type Workflow = z.infer<typeof Workflow>
export type WorkflowInput = z.input<typeof Workflow>
