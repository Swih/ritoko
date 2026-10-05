import { describe, expect, it } from 'vitest'
import { cell, decode, parseCsv } from '../src/engine/items.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import { check } from '../src/engine/store.ts'
import { mask, render, renderSelector, snapshotVars } from '../src/engine/template.ts'

const scope = {
  param: { month: '2026-09' },
  item: { 'First Name': 'Ada' },
  files: { 'in.xlsx': '/tmp/in.xlsx' },
}

describe('render', () => {
  it('masks credentials inside JSON strings and excludes serialized credential objects from snapshots', () => {
    const secret = 'abc"def\\newline\n'
    const value = JSON.stringify({ nested: { token: secret } })
    const runtime = { ...scope, secrets: [secret], vars: { bundle: value, id: 'ordinary-id' } }
    expect(mask(value, runtime)).toBe('{"nested":{"token":"***"}}')
    expect(snapshotVars(runtime)).toEqual({ id: 'ordinary-id' })
  })
  it('replaces params, item columns and files', () => {
    expect(render('{{param.month}} {{ item.First Name }} {{files.in.xlsx}}', scope)).toBe(
      '2026-09 Ada /tmp/in.xlsx',
    )
  })
  it('throws on unknown references', () => {
    expect(() => render('{{item.Email}}', scope)).toThrow('Unknown item.Email')
    expect(() => render('{{item.toString}}', scope)).toThrow('Unknown item.toString')
  })
  it('replaces saved variables and explains one that was never saved', () => {
    expect(render('/orders/{{vars.id}}', { ...scope, vars: { id: 'o-1' } })).toBe('/orders/o-1')
    expect(() => render('{{vars.id}}', scope)).toThrow(
      'Unknown vars.id in "{{vars.id}}": no earlier step saved it',
    )
    expect(() => render('{{vars.toString}}', { ...scope, vars: {} })).toThrow('Unknown vars.toString')
  })
  it('quotes values inserted into selectors', () => {
    const name = { ...scope, item: { Name: `O'Brien "Bob"`, Row: '2' } }
    expect(renderSelector("//td[.='{{item.Name}}']/..//tr[{{item.Row}}]", name, 'xpath')).toBe(
      `//td[.=concat('', concat('O', "'", 'Brien "Bob"'), '')]/..//tr[2]`,
    )
    expect(() => renderSelector('//tr[{{item.Name}}]', name, 'xpath')).toThrow('inside quotes')
    expect(renderSelector('[title="{{item.Name}}"] #x{{item.Row}}', name, 'css')).toBe(
      `[title="O\\'Brien \\"Bob\\""] #x2`,
    )
  })
})

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and ; separators', () => {
    expect(parseCsv('a;b\r\n"x;1";"say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'say "hi"'],
    ])
  })
  it('picks the separator splitting every record alike', () => {
    expect(parseCsv('Name;City, State\nAda;Paris, France\n')).toEqual([
      ['Name', 'City, State'],
      ['Ada', 'Paris, France'],
    ])
    expect(parseCsv('Name,Note\nAda,a;b\nBob,c\n')[1]).toEqual(['Ada', 'a;b'])
  })
})

describe('input cells', () => {
  it('decodes UTF-8 with BOM, or Windows-1252 from a classic Excel export', () => {
    expect(decode(Buffer.from('\uFEFFName\nJosé Müller', 'utf8'))).toBe('Name\nJosé Müller')
    expect(decode(Buffer.from([0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x4d, 0xfc, 0x80]))).toBe('José Mü€')
  })
  it('keeps the time of day and drops float noise', () => {
    expect(cell(new Date(Date.UTC(2026, 9, 4)))).toBe('2026-10-04')
    expect(cell(new Date(Date.UTC(2026, 9, 4, 12)))).toBe('2026-10-04T12:00:00')
    expect(cell(0.1 + 0.2)).toBe('0.3')
    expect(cell(1e15 + 1)).toBe('1000000000000001')
  })
})

const wf = (patch: Partial<WorkflowInput> = {}) =>
  Workflow.parse({
    name: 'demo',
    description: 'demo',
    params: { input: { description: 'csv' } },
    items: { from: '{{param.input}}', key: '{{item.Email}}' },
    item: [
      {
        id: 'email',
        do: 'fill',
        target: { primary: { by: 'label', text: 'Email' } },
        value: '{{item.Email}}',
      },
      {
        id: 'submit',
        do: 'click',
        target: { primary: { by: 'role', role: 'button', name: 'Send' } },
        commit: true,
      },
      { id: 'ok', do: 'expect', text: 'Thanks' },
    ],
    ...patch,
  })

describe('check', () => {
  it('accepts a well-formed workflow without warnings', () => {
    expect(check(wf())).toEqual([])
  })
  it('rejects unknown params and files used before download', () => {
    expect(() => check(wf({ setup: [{ id: 'go', do: 'goto', url: '{{param.nope}}' }] }))).toThrow(
      'unknown param',
    )
    expect(() => check(wf({ items: { from: '{{files.x.xlsx}}', key: '{{item.Email}}' } }))).toThrow(
      'not downloaded',
    )
  })
  it('rejects inherited names, unknown dialog params and incomplete secrets', () => {
    expect(() => check(wf({ setup: [{ id: 'go', do: 'goto', url: '{{param.constructor}}' }] }))).toThrow(
      'unknown param',
    )
    expect(() =>
      check(
        wf({
          setup: [
            {
              id: 'confirm',
              do: 'click',
              target: { primary: { by: 'role', role: 'button', name: 'OK' } },
              onDialog: 'accept',
              dialogText: '{{param.nope}}',
            },
          ],
        }),
      ),
    ).toThrow('unknown param')
    expect(() => check(wf({ params: { input: {}, pin: { secret: true } } }))).toThrow('secret')
  })
  it('accepts a select that submits as the commit', () => {
    const select = {
      id: 'pick',
      do: 'select' as const,
      target: { primary: { by: 'label' as const, text: 'Plan' } },
      value: 'Pro',
      commit: true,
    }
    expect(check(wf({ item: [select, { id: 'ok', do: 'expect', text: 'Thanks' }] }))).toEqual([])
  })
  it('refuses a write batch without a commit or verification', () => {
    expect(() =>
      check(wf({ item: [wf().item[1] as Workflow['item'][number]].map((s) => ({ ...s, commit: false })) })),
    ).toThrow('commit')
  })
})

describe('check for http and mcp steps', () => {
  const post = {
    id: 'send',
    do: 'http' as const,
    method: 'POST' as const,
    url: 'https://api.example.test/orders',
    commit: true,
    expect: { status: [201] },
  }
  const read = (patch: object = {}) => ({
    id: 'read',
    do: 'http' as const,
    url: 'https://api.example.test/orders/1',
    expect: { json: { '/status': 'paid' } },
    ...patch,
  })
  const tool = (patch: object = {}) => ({
    id: 'tool',
    do: 'mcp' as const,
    server: 'shop',
    tool: 'get_order',
    readOnly: true,
    expect: { json: { '/status': 'paid' } },
    ...patch,
  })
  const servers = { shop: { command: 'node', args: ['shop.js'] } }
  const api = (item: WorkflowInput['item'], patch: Partial<WorkflowInput> = {}) =>
    wf({ item, servers, ...patch })

  it('accepts a request or a tool call as the commit, verified by its own expect or a read after it', () => {
    expect(check(api([post]))).toEqual([])
    expect(check(api([{ ...post, expect: undefined }, read()]))).toEqual([])
    expect(check(api([{ ...post, method: 'DELETE', expect: undefined, commit: true }, tool()]))).toEqual([])
    expect(check(api([tool({ readOnly: undefined, commit: true })]))).toEqual([])
  })

  it('needs an explicit proof: a default 2xx status is not one', () => {
    expect(() => check(api([{ ...post, expect: undefined }]))).toThrow(
      'An item needs an expect after its commit',
    )
    expect(() => check(api([{ ...post, expect: {} }]))).toThrow('An item needs an expect after its commit')
    expect(() => check(api([{ ...post, expect: undefined }, read({ expect: undefined })]))).toThrow(
      'after its commit',
    )
    expect(check(api([post, read()]))).toEqual([])
  })

  it('allows only reads after the commit', () => {
    expect(() => check(api([post, read({ method: 'POST' })]))).toThrow("must be the item's commit")
    expect(() => check(api([post, tool({ readOnly: false })]))).toThrow("must be the item's commit")
    expect(check(api([post, read({ method: 'HEAD' }), tool()]))).toEqual([])
  })

  it('lets a read-only workflow send reads only', () => {
    expect(check(api([read(), tool()], { readOnly: true }))).toEqual([])
    expect(() => check(api([read({ method: 'PUT' })], { readOnly: true }))).toThrow(
      "must be the item's commit",
    )
    expect(() => check(api([tool({ readOnly: false })], { readOnly: true }))).toThrow(
      "must be the item's commit",
    )
  })

  it('keeps item data and saved values out of the host of a URL', () => {
    const to =
      (url: string, patch: Partial<WorkflowInput> = {}) =>
      () =>
        check(api([post, read({ url })], patch))
    for (const url of [
      'https://{{item.Host}}/x',
      '{{item.Url}}',
      '{{param.input}}{{item.Path}}',
      'https://api.example.test{{item.Path}}',
      'https://{{item.a/b}}/x',
    ])
      expect(to(url, { params: { input: {} } }), url).toThrow('host of a URL')
    expect(() =>
      check(api([read({ id: 'save', save: { u: '/url' } }), post, read({ url: '{{vars.u}}/x' })])),
    ).toThrow('host of a URL')
    for (const url of [
      '{{param.input}}/orders/{{item.Id}}?q={{item.Q}}',
      'https://api.example.test/{{item.Id}}',
      'https://api.example.test?next={{item.Next}}@evil.test',
    ])
      expect(to(url, { params: { input: {} } })).not.toThrow()
  })

  it("knows the variables a step can use: the setup's, then its own item's", () => {
    const save = read({ id: 'save', save: { id: '/id' } })
    const use = read({ id: 'use', url: 'https://api.example.test/orders/{{vars.id}}' })
    expect(check(api([save, post, use]))).toEqual([])
    expect(() => check(api([post, use]))).toThrow('"vars.id" is not saved by an earlier step')
    expect(check(api([post, read()], { setup: [save], teardown: [use] }))).toEqual([])
    // Another item's variables do not exist in the teardown, nor in the batch description.
    expect(() => check(api([save, post], { teardown: [use] }))).toThrow('"vars.id" is not saved')
    expect(() =>
      check(api([save, post], { items: { from: '{{param.input}}', key: '{{vars.id}}' } })),
    ).toThrow('"vars.id" is not saved')
  })

  it('checks servers, files and bodies', () => {
    expect(() => check(api([post, tool({ server: 'other' })]))).toThrow('unknown server "other"')
    expect(() => check(api([post, tool({ file: '/path' })]))).toThrow('"file" needs saveAs')
    expect(() => check(api([read({ body: { text: 'x' } }), post]))).toThrow('GET requests have no body')
    expect(() => check(api([post, tool()], { servers: { shop: { command: '{{item.Cmd}}' } } }))).toThrow(
      'only {{param.*}}',
    )
    expect(() =>
      check(api([post, tool()], { servers: { shop: { url: 'https://{{vars.h}}/mcp' } } })),
    ).toThrow('only {{param.*}}')
    expect(check(api([post, tool()], { servers: { shop: { ref: 'claude' } } }))).toEqual([])
  })

  it('refuses credentials written into workflow headers or server configuration', () => {
    const secret = { input: {}, key: { secret: true, env: 'SHOP_KEY' } }
    const literal = read({
      headers: { Authorization: 'Bearer abc', 'X-Api-Key': '{{param.key}}', Accept: 'a/b' },
    })
    expect(() => check(api([post, literal], { params: secret }))).toThrow(
      '"Authorization" holds a credential',
    )
    expect(
      check(api([read({ headers: { 'X-Api-Key': '{{param.key}}' } }), post], { params: secret })),
    ).toEqual([])
    expect(() =>
      check(
        api([post, tool()], {
          servers: { shop: { url: 'https://x.test/mcp', headers: { Authorization: 'abc' } } },
        }),
      ),
    ).toThrow('servers.shop: "Authorization" holds a credential')
    expect(() => check(api([tool({ readOnly: undefined }), post]))).toThrow("must be the item's commit")
  })

  it('allows long waits and strict bodies in the schema', () => {
    const parse = (step: object) => Workflow.parse({ name: 'x', description: 'x', item: [step] })
    expect(() => parse({ do: 'http', url: 'https://x.test', timeoutMs: 900_000 })).not.toThrow()
    expect(() => parse({ do: 'mcp', server: 's', tool: 't', timeoutMs: 900_000 })).not.toThrow()
    expect(() => parse({ do: 'http', url: 'https://x.test', timeoutMs: 900_001 })).toThrow()
    expect(() => parse({ do: 'http', url: 'https://x.test', body: { json: {}, text: 'x' } })).toThrow()
    expect(() => parse({ do: 'http', url: 'https://x.test', save: { 'bad name': '/x' } })).toThrow()
    expect(() =>
      parse({ do: 'http', url: 'https://x.test', expect: { json: { 'no-slash': 'x' } } }),
    ).toThrow()
    expect(parse({ do: 'http', url: 'https://x.test' }).item[0]).toMatchObject({
      method: 'GET',
      session: 'none',
    })
  })

  it('refuses replayable writes outside the commit and secret references in agent-managed arguments', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(() => check(api([read({ method }), post]))).toThrow("must be the item's commit")
      expect(() => check(api([post], { setup: [read({ method })] }))).toThrow("must be the item's commit")
      expect(() => check(api([post], { teardown: [read({ method })] }))).toThrow("must be the item's commit")
    }
    expect(() =>
      check(
        api([post, tool({ args: { token: '{{param.key}}' } })], {
          params: { input: {}, key: { secret: true, env: 'SHOP_KEY' } },
          servers: { shop: { ref: 'agent' } },
        }),
      ),
    ).toThrow('must not reference secrets')
    expect(() =>
      check(
        api([post, tool({ args: { token: '{{vars.auth}}' } })], {
          setup: [read({ id: 'auth', save: { auth: '/access_token' } })],
          servers: { shop: { ref: 'agent' } },
        }),
      ),
    ).toThrow('must not reference secrets')
    expect(() =>
      Workflow.parse({
        name: 'x',
        description: 'x',
        setup: [{ do: 'http', url: 'https://x.test', save: { id: '/invalid~escape' } }],
      }),
    ).toThrow()
  })

  it('keeps credentials out of persisted filenames, source paths, URLs and business identities', () => {
    const params = { input: {}, key: { secret: true, env: 'SHOP_KEY' } }
    expect(() => check(api([post, read({ saveAs: '{{param.key}}.json' })], { params }))).toThrow(
      'must not reference secrets',
    )
    expect(() => check(api([post, read({ url: 'https://x.test/{{param.key}}' })], { params }))).toThrow(
      'must not reference secrets',
    )
    expect(() =>
      check(api([post], { params, items: { from: '{{param.key}}', key: '{{item.Email}}' } })),
    ).toThrow('must not reference secrets')
    expect(() =>
      check(api([post], { params, items: { from: '{{param.input}}', key: '{{param.key}}' } })),
    ).toThrow('must not reference secrets')
    expect(() =>
      check(
        api([post, read({ saveAs: '{{vars.auth}}.json' })], {
          setup: [read({ id: 'auth', save: { auth: '/access_token' } })],
        }),
      ),
    ).toThrow('must not reference secrets')
  })
})

describe('Ledger', () => {
  it('tracks items and finds completions from previous runs', () => {
    const ledger = new Ledger(':memory:')
    const first = ledger.createRun('demo', 1, {})
    ledger.addItems(first.id, [{ key: 'a@x', data: {} }])
    ledger.updateItem(first.id, 0, { status: 'done' })
    const second = ledger.createRun('demo', 1, {})
    expect(ledger.completedElsewhere('demo', 'a@x', second.id)).toBe(first.id)
    expect(ledger.completedElsewhere('demo', 'b@x', second.id)).toBeUndefined()
  })
  it('refuses duplicate business keys in one batch', () => {
    const ledger = new Ledger(':memory:')
    const run = ledger.createRun('demo', 1, {})
    expect(() =>
      ledger.addItems(run.id, [
        { key: 'a', data: {} },
        { key: 'a', data: {} },
      ]),
    ).toThrow('Duplicate item keys')
  })

  /** A run whose two items may have been submitted: both wait for review. */
  const reviewed = () => {
    const ledger = new Ledger(':memory:')
    const run = ledger.createRun('demo', 1, {})
    ledger.addItems(run.id, [
      { key: 'a', data: {} },
      { key: 'b', data: {} },
    ])
    for (const idx of [0, 1]) ledger.updateItem(run.id, idx, { status: 'review', committed: true })
    return { ledger, run }
  }

  it('resolves by hand only once the person confirmed checking the destination, for either outcome', () => {
    const { ledger, run } = reviewed()
    expect(() => ledger.resolve(run.id, 'a', 'failed', 'Not in the shop', { by: 'manual' })).toThrow(
      'Resolving "a" as failed means the run will submit this row again on resume, which creates a duplicate if the record already exists at the destination.',
    )
    expect(() => ledger.resolve(run.id, 'a', 'done', 'In the shop', { by: 'manual' })).toThrow(
      'later runs skip this row, so if it does not exist it is never submitted',
    )
    for (const status of ['done', 'failed'] as const)
      expect(() =>
        ledger.resolve(run.id, 'a', status, 'checked', { by: 'manual', confirmChecked: false }),
      ).toThrow('Ask the user to check the record at the destination first, and pass confirmChecked: true')
    expect(ledger.items(run.id)[0]).toMatchObject({ status: 'review', committed: true, resolution: null })
    expect(ledger.events(run.id, 'resolve')).toEqual([])
  })

  it('records who resolved an item and whether it was verified, until a later status replaces it', () => {
    const { ledger, run } = reviewed()
    ledger.resolve(run.id, 'a', 'done', 'Order 12 found in the shop', { by: 'manual', confirmChecked: true })
    expect(() => ledger.resolve(run.id, 'b', 'failed', 'No order', { by: 'reconcile' })).toThrow('evidence')
    ledger.resolve(run.id, 'b', 'failed', 'No order for b', {
      by: 'reconcile',
      evidence: 'GET /orders?email=b returned []',
    })
    const [a, b] = ledger.items(run.id)
    expect(a).toMatchObject({
      status: 'done',
      committed: true,
      message: 'Manually resolved (unverified): Order 12 found in the shop',
      resolution: { by: 'manual', verified: false, note: 'Order 12 found in the shop' },
    })
    expect(b).toMatchObject({
      status: 'failed',
      committed: false,
      message: 'Reconciled (verified): No order for b',
      resolution: { by: 'reconcile', verified: true, note: 'No order for b' },
    })
    expect(ledger.events(run.id, 'resolve')).toEqual([
      {
        key: 'a',
        status: 'done',
        note: 'Order 12 found in the shop',
        by: 'manual',
        verified: false,
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      },
      {
        key: 'b',
        status: 'failed',
        note: 'No order for b',
        by: 'reconcile',
        verified: true,
        evidence: 'GET /orders?email=b returned []',
        at: expect.any(String),
      },
    ])
    // Retrying b makes its next status the workflow's own, not the resolution's.
    ledger.updateItem(run.id, 1, { status: 'running', message: null })
    expect(ledger.items(run.id).map((i) => i.resolution?.by ?? null)).toEqual(['manual', null])
  })
})
