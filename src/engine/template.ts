export type Scope = {
  param: Record<string, string>
  item: Record<string, string>
  files: Record<string, string>
  /** Values of secret params, masked in every message Ritoko keeps or returns. */
  secrets?: string[]
  /** Folder that upload paths taken from item data must stay in. */
  inbox?: string
}

type Namespace = 'param' | 'item' | 'files'

const PLACEHOLDER = /\{\{\s*(param|item|files)\.([^}]+?)\s*\}\}/g

function lookup(scope: Scope, ns: Namespace, key: string, template: string): string {
  const value = Object.hasOwn(scope[ns], key) ? scope[ns][key] : undefined
  if (value === undefined) throw new Error(`Unknown ${ns}.${key} in "${template}"`)
  return value
}

/** Replaces {{param.x}}, {{item.Column}} and {{files.name}}; throws on any unknown reference. */
export function render(template: string, scope: Scope): string {
  return template.replace(PLACEHOLDER, (_, ns: Namespace, key: string) => lookup(scope, ns, key, template))
}

export function references(template: string): { ns: Namespace; key: string }[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => ({ ns: m[1] as Namespace, key: m[2] as string }))
}

/** XPath 1.0 string literal for any value: quotes cannot be escaped, so mixed ones are concatenated. */
const xpathLiteral = (value: string) =>
  !value.includes("'")
    ? `'${value}'`
    : !value.includes('"')
      ? `"${value}"`
      : `concat('${value.split("'").join(`', "'", '`)}')`

/**
 * Renders a CSS or XPath selector template, quoting each inserted value for where it lands, so that data
 * such as O'Brien can neither break nor retarget the selector. Inside a quoted string, a CSS value is
 * backslash-escaped and an XPath literal is split with concat(). Outside quotes, a CSS value is escaped as
 * an identifier; an XPath value must be a number (e.g. a position).
 */
export function renderSelector(template: string, scope: Scope, language: 'css' | 'xpath'): string {
  let out = ''
  let quote = ''
  let opened = 0
  let split = false
  const copy = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] as string
      if (language === 'css' && ch === '\\') {
        out += ch + (text[++i] ?? '')
        continue
      }
      if (!quote && (ch === '"' || ch === "'")) {
        quote = ch
        opened = out.length
      } else if (ch === quote) {
        quote = ''
        if (split) {
          out = `${out.slice(0, opened)}concat(${out.slice(opened)}${ch})`
          split = false
          continue
        }
      }
      out += ch
    }
  }
  let last = 0
  for (const m of template.matchAll(PLACEHOLDER)) {
    copy(template.slice(last, m.index))
    last = m.index + m[0].length
    const value = lookup(scope, m[1] as Namespace, m[2] as string, template)
    if (language === 'css')
      out += quote
        ? value.replace(/[\\"']/g, '\\$&').replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)
        : value.replace(/[^\w-]/gu, (c) => `\\${c.codePointAt(0)?.toString(16)} `)
    else if (!quote) {
      if (!/^\d+$/.test(value))
        throw new Error(`XPath "${template}": put {{${m[1]}.${m[2]}}} inside quotes, or use a number there`)
      out += value
    } else if (value.includes(quote)) {
      out += `${quote}, ${xpathLiteral(value)}, ${quote}`
      split = true
    } else out += value
  }
  copy(template.slice(last))
  return out
}
