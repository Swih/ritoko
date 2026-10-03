import { writeFile } from 'node:fs/promises'
import type { Locator } from 'playwright-core'
import { bounded, destination } from './download.ts'

/** Reads the HTML or ARIA table at `target` and saves it as RFC 4180 CSV in `dir`. Returns the saved path. */
export async function extract(target: Locator, dir: string, saveAs: string): Promise<string> {
  const rows = await bounded(target.evaluate(readTable), 'Table extraction', 30_000)
  const file = destination(dir, saveAs, 'table.csv')
  const field = (s: string) => (/[",;\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
  await writeFile(file, rows.map((row) => `${row.map(field).join(',')}\r\n`).join(''), { flag: 'wx' })
  return file
}

/**
 * Runs in the page. Header = leading rows in <thead> or made only of header cells, else the first row;
 * stacked header rows are joined ("Q1 Revenue"). Spans are expanded: rowspans repeat their text, a body
 * colspan fills only its first column. Hidden rows and <tfoot> are skipped. Cell text is whitespace-collapsed.
 */
function readTable(el: Element): string[][] {
  const tables = 'table, [role=table], [role=grid], [role=treegrid]'
  const table = el.closest(tables)
  if (!table) throw new Error('extract needs a <table> or an element with role table, grid or treegrid')
  const native = table instanceof HTMLTableElement
  const rows = (
    native
      ? [...table.rows].filter((r) => r.parentElement?.tagName !== 'TFOOT')
      : [...table.querySelectorAll('[role=row]')].filter((r) => r.closest(tables) === table)
  ).map((row) => ({
    row,
    cells: native
      ? [...(row as HTMLTableRowElement).cells]
      : [
          ...row.querySelectorAll('[role=cell], [role=gridcell], [role=columnheader], [role=rowheader]'),
        ].filter((c) => c.closest('[role=row]') === row),
  }))
  const visible = rows.filter(({ cells }) => cells.some((c) => c.checkVisibility()))
  const span = (c: Element, name: 'colspan' | 'rowspan') =>
    Math.min(Math.max(Number(c.getAttribute(name) ?? c.getAttribute(`aria-${name}`)) || 1, 1), 1000)

  type Slot = { text: string; spanned: boolean }
  const grid: Slot[][] = visible.map(() => [])
  visible.forEach(({ cells }, r) => {
    let c = 0
    for (const cell of cells) {
      while (grid[r]?.[c]) c++
      const text = (cell as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      const [across, down] = [span(cell, 'colspan'), span(cell, 'rowspan')]
      for (let dr = 0; dr < down && r + dr < grid.length; dr++)
        for (let dc = 0; dc < across; dc++) (grid[r + dr] as Slot[])[c + dc] = { text, spanned: dc > 0 }
      c += across
    }
  })

  const isHeader = ({ row, cells }: (typeof visible)[number]) =>
    row.parentElement?.tagName === 'THEAD' ||
    cells.every((c) => c.tagName === 'TH' || c.getAttribute('role') === 'columnheader')
  const firstBody = visible.findIndex((r) => !isHeader(r))
  const headerRows = firstBody < 0 ? visible.length : Math.max(firstBody, 1)
  const width = Math.max(0, ...grid.map((row) => row.length))
  const seen = new Map<string, number>()
  const header = Array.from({ length: width }, (_, c) => {
    const parts = grid.slice(0, headerRows).map((row) => row[c]?.text ?? '')
    const name = parts.filter((p, i) => p && p !== parts[i - 1]).join(' ') || `Column ${c + 1}`
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n > 1 ? `${name} ${n}` : name
  })
  const body = grid
    .slice(headerRows)
    .map((row) => Array.from({ length: width }, (_, c) => (row[c]?.spanned ? '' : (row[c]?.text ?? ''))))
    .filter((row) => row.some(Boolean))
  return width ? [header, ...body] : []
}
