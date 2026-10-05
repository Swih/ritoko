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
  /** Selector of the iframe holding the element; nested: "iframe#a >> internal:control=enter-frame >> iframe#b". */
  frame: z.string().optional(),
})
export type Target = z.infer<typeof Target>

const base = {
  /** Optional on input: missing ids become s1, s2… */
  id: z
    .string()
    .regex(/^[\w-]+$/)
    .optional(),
  note: z.string().optional(),
  /** Point of no return (click, press, upload, select or check): an interrupted item is never replayed blindly. */
  commit: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
}
/** Steps that may wait for a slow generation (minutes): wait, expect and download. */
const patient = { timeoutMs: z.number().int().positive().max(900_000).optional() }

/** Answer to a JS alert/confirm/prompt opened by the step; any other dialog fails the step. */
const dialog = {
  onDialog: z.enum(['accept', 'dismiss']).optional(),
  /** Text typed into a prompt before accepting it. */
  dialogText: z.string().optional(),
}

/** A JSON Pointer (RFC 6901): "" is the whole document. */
const pointer = z
  .string()
  .regex(/^(\/(?:[^~]|~[01])*)?$/, 'a JSON pointer: "" or starting with /, with ~0 and ~1 escapes')
/** Checks on a JSON result: pointer -> expected text (a template), compared with the value found there. */
const checks = z.record(pointer, z.string())
/** Variables to keep from a JSON result for later steps: name -> pointer, used as `{{vars.name}}`. */
const save = z.record(z.string().regex(/^\w+$/, 'a variable name'), pointer).optional()
/** A file kept from the result, like download: a template, sanitized, never overwriting. */
const saveAs = z.string().optional()

export const Step = z.discriminatedUnion('do', [
  z.object({ ...base, do: z.literal('goto'), url: z.string() }),
  z.object({ ...base, ...dialog, do: z.literal('click'), target: Target }),
  z.object({ ...base, do: z.literal('hover'), target: Target }),
  z.object({ ...base, do: z.literal('fill'), target: Target, value: z.string() }),
  z.object({ ...base, do: z.literal('select'), target: Target, value: z.string() }),
  z.object({ ...base, do: z.literal('check'), target: Target, checked: z.boolean().default(true) }),
  z.object({ ...base, ...dialog, do: z.literal('press'), target: Target.optional(), key: z.string() }),
  z.object({ ...base, do: z.literal('upload'), target: Target, file: z.string() }),
  /**
   * Clicks the target and saves the resulting download as `files.<saveAs>`. saveAs may be a template
   * (`{{item.Slug}}.mp4`): the rendered name is sanitized and never overwrites an existing file.
   */
  z.object({ ...base, ...patient, do: z.literal('download'), target: Target, saveAs: z.string() }),
  /** Read-only: saves the target table (HTML, or ARIA table/grid) as CSV, also usable as `files.<saveAs>`. */
  z.object({
    ...base,
    do: z.literal('extract'),
    target: Target,
    saveAs: z.string().regex(/\.csv$/i, 'extract saves a .csv file'),
  }),
  /** Verification. Fails the item when the page does not match. */
  z.object({
    ...base,
    ...patient,
    do: z.literal('expect'),
    target: Target.optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    url: z.string().optional(),
  }),
  z.object({
    ...base,
    ...patient,
    do: z.literal('wait'),
    target: Target.optional(),
    ms: z.number().int().positive().optional(),
  }),
  /**
   * An HTTP request, sent by Ritoko itself (no browser unless `session` is "browser"). Every string is a
   * template. Only GET/HEAD before commit may retry; secrets come from secret params, rendered when sent.
   */
  z.object({
    ...base,
    ...patient,
    do: z.literal('http'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    body: z
      .union([
        z.strictObject({ json: z.json() }),
        z.strictObject({ form: z.record(z.string(), z.string()) }),
        z.strictObject({ text: z.string() }),
      ])
      .optional(),
    /** Default: any 2xx status. */
    expect: z
      .strictObject({ status: z.array(z.number().int()).optional(), json: checks.optional() })
      .optional(),
    save,
    saveAs,
    /** Sends `Idempotency-Key`, stable for the same workflow, scope, item and step. */
    idempotencyKey: z.boolean().optional(),
    /** "browser" sends it through the Ritoko browser's own session (its cookies). */
    session: z.enum(['none', 'browser']).default('none'),
  }),
  /** A call to a tool of an MCP server declared in the workflow's `servers`. */
  z.object({
    ...base,
    ...patient,
    do: z.literal('mcp'),
    server: z.string(),
    tool: z.string(),
    /** String values are templates; one that the tool's input schema types as a number or boolean is converted. */
    args: z.record(z.string(), z.json()).optional(),
    expect: z.strictObject({ json: checks }).optional(),
    save,
    saveAs,
    /** Pointer to a local path or URL in the result, to keep as the file (else its first image, audio or resource). */
    file: pointer.optional(),
    /** The tool only reads: allowed after the commit and in read-only workflows. */
    readOnly: z.boolean().optional(),
  }),
])
export type Step = z.infer<typeof Step> & { id: string }
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
export type StepBody = WithoutId<Step>

/** Explicit destination lookup; only a positive predicate establishes presence or absence. */
const LookupPredicate = z.strictObject({
  json: checks.refine((value) => Object.keys(value).length > 0, 'needs JSON business evidence'),
  status: z
    .array(
      z
        .number()
        .int()
        .refine(
          (value) => (value >= 200 && value < 300) || value === 404 || value === 410,
          'lookup statuses must be 2xx, 404 or 410',
        ),
    )
    .nonempty()
    .optional(),
})
const Ensure = z.strictObject({
  read: Step.transform((step): Step => ({ ...step, id: step.id ?? 'ensure-read' })),
  present: LookupPredicate,
  absent: LookupPredicate,
})

/** An MCP server a workflow calls: a program to start, a URL, or the one of the same name in Claude Code's configuration. */
const Server = z.union([
  z.strictObject({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  }),
  z.strictObject({ url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
  z.strictObject({ ref: z.enum(['claude', 'agent']) }),
])

export const Workflow = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case'),
    version: z.number().int().positive().default(1),
    description: z.string(),
    /** Explicitly opt in for batches that never change data on the target site. */
    readOnly: z.boolean().default(false),
    ensure: Ensure.optional(),
    params: z
      .record(
        z.string(),
        z.object({
          description: z.string().optional(),
          required: z.boolean().default(true),
          default: z.string().optional(),
          /** A credential: read from environment variable `env` at run time, never passed, stored or shown. */
          secret: z.boolean().optional(),
          env: z
            .string()
            .regex(/^[A-Za-z_]\w*$/, 'environment variable name')
            .optional(),
        }),
      )
      .default({}),
    /** MCP servers for `mcp` steps, started or contacted once per run. Strings are templates (params only). */
    servers: z.record(z.string().regex(/^[\w-]+$/), Server).default({}),
    /** Batch source: a template resolving to an .xlsx or .csv path, e.g. "{{files.input}}" or "{{param.input}}". */
    items: z
      .object({
        from: z.string(),
        sheet: z.union([z.string(), z.number()]).optional(),
        /** Business identity of an item, e.g. "{{item.Email}}". Must be unique in the batch. */
        key: z.string(),
        /** Destination/account/operation identity. Input file paths must not be used here. */
        scope: z.string().default(''),
        required: z.array(z.string().min(1)).default([]),
      })
      .optional(),
    setup: z.array(Step).default([]),
    item: z.array(Step).default([]),
    teardown: z.array(Step).default([]),
  })
  .transform((wf) => {
    const taken = new Set([...wf.setup, ...wf.item, ...wf.teardown].map((s) => s.id))
    let next = 0
    const named = (steps: typeof wf.item): Step[] =>
      steps.map((s) => {
        if (s.id) return { ...s, id: s.id }
        while (taken.has(`s${++next}`));
        return { ...s, id: `s${next}` }
      })
    return {
      ...wf,
      setup: named(wf.setup),
      item: named(wf.item),
      teardown: named(wf.teardown),
    }
  })
export type Workflow = z.infer<typeof Workflow>
export type WorkflowInput = z.input<typeof Workflow>
