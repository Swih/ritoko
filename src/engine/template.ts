export type Scope = {
  param: Record<string, string>
  item: Record<string, string>
  files: Record<string, string>
  /** Values saved by earlier http and mcp steps: the setup's, then the current item's own. */
  vars?: Record<string, string>
  /** Business key of the current item. */
  key?: string
  /** Values of secret params, masked in every message Ritoko keeps or returns. */
  secrets?: string[]
  /** Names of runtime credentials saved from API results; their values are never journaled. */
  secretVars?: string[]
  /** True once the current item's commit boundary has been crossed. */
  committed?: boolean
  /** Folder that upload paths taken from item data must stay in. */
  inbox?: string
}

type Namespace = 'param' | 'item' | 'files' | 'vars'

const PLACEHOLDER = /\{\{\s*(param|item|files|vars)\.([^}]+?)\s*\}\}/g

function lookup(scope: Scope, ns: Namespace, key: string, template: string): string {
  const values = scope[ns] ?? {}
  const value = Object.hasOwn(values, key) ? values[key] : undefined
  if (value === undefined)
    throw new Error(
      `Unknown ${ns}.${key} in "${template}"${ns === 'vars' ? ': no earlier step saved it (see "save")' : ''}`,
    )
  return value
}

/** Replaces {{param.x}}, {{item.Column}}, {{files.name}} and {{vars.name}}; throws on any unknown reference. */
export function render(template: string, scope: Scope): string {
  return template.replace(PLACEHOLDER, (_, ns: Namespace, key: string) => lookup(scope, ns, key, template))
}

/** Renders every string inside a JSON value (keys stay as written). */
export function renderJson(value: unknown, scope: Scope): unknown {
  if (typeof value === 'string') return render(value, scope)
  if (Array.isArray(value)) return value.map((v) => renderJson(v, scope))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderJson(v, scope)]))
  return value
}

/** Hides the values of secret params: nothing Ritoko keeps or returns may contain one. */
export const mask = (text: string, scope: Scope) =>
  [...new Set((scope.secrets ?? []).flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, secret) => masked.replaceAll(secret, '***'), text)

/** Check raw strings before JSON escaping can hide a secret from literal masking. */
export function hasSecrets(value: unknown, scope: Scope): boolean {
  if (typeof value === 'string') return mask(value, scope) !== value
  if (value && typeof value === 'object') return Object.values(value).some((part) => hasSecrets(part, scope))
  return false
}

/** Snapshot only non-secret variables. Runtime credentials must be obtained again after a restart. */
export const snapshotVars = (scope: Scope): Record<string, string> =>
  Object.fromEntries(
    Object.entries(scope.vars ?? {}).filter(
      ([name, value]) => !scope.secretVars?.includes(name) && mask(value, scope) === value,
    ),
  )

/** Credential-like result fields are sensitive even when not known before the request. */
export const credential = /authorization|cookie|api[-_]?key|token|secret|passw|pwd|session/i

export function rememberSecrets(value: unknown, scope: Scope): void {
  const remember = (found: unknown) => {
    if (typeof found === 'string' && found) {
      scope.secrets ??= []
      if (!scope.secrets.includes(found)) scope.secrets.push(found)
    } else if (found && typeof found === 'object') for (const part of Object.values(found)) remember(part)
  }
  if (value && typeof value === 'object')
    for (const [name, found] of Object.entries(value))
      if (credential.test(name)) remember(found)
      else rememberSecrets(found, scope)
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
