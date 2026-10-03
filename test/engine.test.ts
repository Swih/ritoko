import { describe, expect, it } from 'vitest'
import { cell, decode, parseCsv } from '../src/engine/items.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import { check } from '../src/engine/store.ts'
import { render, renderSelector } from '../src/engine/template.ts'

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
    expect(() => render('{{item.toString}}', scope)).toThrow('Unknown item.toString')
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
