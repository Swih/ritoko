import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { readSheet } from 'read-excel-file/node'

export type Item = Record<string, string>

/** Reads an .xlsx or .csv file into rows keyed by trimmed header names. */
export async function readItems(path: string, sheet?: string | number): Promise<Item[]> {
  const ext = extname(path).toLowerCase()
  let rows: unknown[][]
  if (ext === '.xlsx') rows = await readSheet(path, sheet ?? 1)
  else if (ext === '.csv') rows = parseCsv(await readFile(path, 'utf8'))
  else throw new Error(`Unsupported input file "${path}" (use .xlsx or .csv)`)

  const [header, ...body] = rows
  if (!header) return []
  const keys = header.map((h) => cell(h).trim())
  if (keys.some((key) => !key)) throw new Error('Input contains an empty column header')
  if (new Set(keys).size !== keys.length) throw new Error('Input contains duplicate column headers')
  return body
    .filter((row) => row.some((c) => cell(c) !== ''))
    .map((row, index) => {
      if (row.length > keys.length) throw new Error(`Input row ${index + 1} has more cells than headers`)
      return Object.fromEntries(keys.map((k, i) => [k, cell(row[i])]))
    })
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/** RFC 4180 CSV; auto-detects "," or ";" from the first line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  let headerQuoted = false
  let commas = 0
  let semicolons = 0
  for (const ch of src) {
    if (ch === '"') headerQuoted = !headerQuoted
    if (!headerQuoted && (ch === '\n' || ch === '\r')) break
    if (!headerQuoted && ch === ',') commas++
    if (!headerQuoted && ch === ';') semicolons++
  }
  const sep = semicolons > commas ? ';' : ','
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
