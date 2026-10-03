import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/engine/items.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import { check } from '../src/engine/store.ts'
import { render } from '../src/engine/template.ts'

const scope = {
  param: { month: '2026-09' },
  item: { 'First Name': 'Ada' },
  files: { 'in.xlsx': '/tmp/in.xlsx' },
}

describe('render', () => {
  it('replaces params, item columns and files', () => {
    expect(render('{{param.month}} {{ item.First Name }} {{files.in.xlsx}}', scope)).toBe(
      '2026-09 Ada /tmp/in.xlsx',
    )
  })
  it('throws on unknown references', () => {
    expect(() => render('{{item.Email}}', scope)).toThrow('Unknown item.Email')
  })
})

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and ; separators', () => {
    expect(parseCsv('a;b\r\n"x;1";"say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'say "hi"'],
    ])
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
  it('refuses a write batch without a commit or verification', () => {
    expect(() =>
      check(wf({ item: [wf().item[1] as Workflow['item'][number]].map((s) => ({ ...s, commit: false })) })),
    ).toThrow('commit')
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
})
