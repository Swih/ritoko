import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { readSheet } from 'read-excel-file/node'

export type Item = Record<string, string>

/** Reads an .xlsx or .csv file into rows keyed by trimmed header names. */
export async function readItems(path: string, sheet?: string | number): Promise<Item[]> {
  const ext = extname(path).toLowerCase()
  let rows: unknown[][]
  if (ext === '.xlsx') rows = await readSheet(path, sheet ?? 1)
  else if (ext === '.csv') rows = parseCsv(decode(await readFile(path)))
  else throw new Error(`Unsupported input file "${path}" (use .xlsx or .csv)`)

  const [header, ...body] = rows
  if (!header) return []
  const keys = header.map((h) => cell(h).trim())
  // Excel exports may end each line with a separator: drop trailing columns without header or data.
  while (keys.length && !keys.at(-1) && body.every((row) => cell(row[keys.length - 1]) === '')) keys.pop()
  if (keys.some((key) => !key)) throw new Error('Input contains an empty column header')
  if (new Set(keys).size !== keys.length) throw new Error('Input contains duplicate column headers')
  return body
    .filter((row) => row.some((c) => cell(c) !== ''))
    .map((row, index) => {
      if (row.slice(keys.length).some((c) => cell(c) !== ''))
        throw new Error(`Input row ${index + 1} has more cells than headers`)
      return Object.fromEntries(keys.map((k, i) => [k, cell(row[i])]))
    })
}

/** Spreadsheet cell as text: a date, or a date-time without time zone, and numbers without float noise. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const iso = new Date(Math.round(value.getTime() / 1000) * 1000).toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19)
  }
  // 15 significant digits drop binary artifacts (0.1 + 0.2 = 0.30000000000000004); integers stay exact.
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Number(value.toPrecision(15)))
  return String(value)
}

/** UTF-8 when valid (BOM stripped), otherwise Windows-1252: the encoding of Excel's classic CSV export. */
export function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * "," or ";": the one found as many times (outside quotes) in each of the first records, the semicolon on
 * a tie since commas also occur in text and decimals; otherwise the most frequent.
 */
function separator(src: string): ',' | ';' {
  const lines: Record<',' | ';', number>[] = []
  let line = { ',': 0, ';': 0 }
  let filled = false
  let quoted = false
  for (const ch of src) {
    if (ch === '"') quoted = !quoted
    if (quoted || ch === '\r') continue
    if (ch === '\n') {
      if (filled) lines.push(line)
      if (lines.length === 5) break
      line = { ',': 0, ';': 0 }
      filled = false
      continue
    }
    filled = true
    if (ch === ',' || ch === ';') line[ch]++
  }
  if (filled && lines.length < 5) lines.push(line)
  const steady = (s: ',' | ';') => {
    const first = lines[0]?.[s] ?? 0
    return lines.every((l) => l[s] === first) ? first : 0
  }
  if (steady(',') || steady(';')) return steady(';') >= steady(',') ? ';' : ','
  const total = (s: ',' | ';') => lines.reduce((n, l) => n + l[s], 0)
  return total(';') > total(',') ? ';' : ','
}

/** RFC 4180 CSV, separated by "," or ";". */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const sep = separator(src)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
        closedQuote = true
      } else field += ch
    } else if (closedQuote && ch !== sep && ch !== '\r' && ch !== '\n') {
      throw new Error('Malformed CSV: characters after closing quote')
    } else if (ch === '"') {
      if (field.length) throw new Error('Malformed CSV: unexpected quote')
      quoted = true
    } else if (ch === sep) {
      row.push(field)
      field = ''
      closedQuote = false
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      closedQuote = false
    } else field += ch
  }
  if (quoted) throw new Error('Malformed CSV: unclosed quoted field')
  if (field !== '' || row.length || closedQuote) rows.push([...row, field])
  return rows
}
