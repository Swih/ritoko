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
  return body
    .filter((row) => row.some((c) => cell(c) !== ''))
    .map((row) => Object.fromEntries(keys.map((k, i) => [k, cell(row[i])])))
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/** RFC 4180 CSV; auto-detects "," or ";" from the first line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split('\n', 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) rows.push([...row, field])
  return rows
}
