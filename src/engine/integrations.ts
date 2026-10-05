import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { APIRequestContext } from 'playwright-core'
import { destination, MAX_BYTES } from './download.ts'
import { SAFE_READS, send } from './http.ts'
import type { McpClients } from './mcp-client.ts'
import type { Step } from './schema.ts'
import {
  credential,
  hasSecrets,
  mask,
  references,
  rememberSecrets,
  render,
  renderJson,
  type Scope,
} from './template.ts'

/** The result of a step does not match what the workflow expects. */
export class VerificationError extends Error {}

type HttpStep = Extract<Step, { do: 'http' }>
type McpStep = Extract<Step, { do: 'mcp' }>

export type Call = {
  scope: Scope
  /** Run folder, where saved files go. */
  dir: string
  /** Journals the commit point: called just before a request leaves. */
  commit: () => void
  /** Workflow, scope, item and step, which make the same `Idempotency-Key` for the same item. */
  identity: string
  /** Disable retries after an earlier commit, including read-only verification/file requests. */
  committed?: boolean
  /** The Ritoko browser's request context, for `session: "browser"`. */
  browser?: APIRequestContext | undefined
  mcp: McpClients
  /** Internal readback: parse JSON and require MCP's positive read-only declaration. */
  readback?: boolean
}

/** `file` is a saved file; `evidence` is a compact line for the journal: never a body or a secret. */
export type Done = { file?: string | undefined; evidence: Record<string, unknown>; value?: unknown }

const JSON_BYTES = 10 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'text/html': '.html',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
}
const extension = (type: string | null | undefined) =>
  EXTENSIONS[(type ?? '').split(';')[0]?.trim().toLowerCase() ?? ''] ?? ''

/** RFC 6901 JSON Pointer: the value at `path` ("" is the whole document), or undefined when there is none. */
export function pointer(value: unknown, path: string): unknown {
  if (path === '') return value
  let at = value
  for (const token of path.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~')
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, key)) return undefined
    if (Array.isArray(at) && !/^(0|[1-9]\d*)$/.test(key)) return undefined
    at = (at as Record<string, unknown>)[key]
  }
  return at
}

const stringify = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** Applies `expect.json`, then keeps the `save` values as variables. Returns the names saved. */
function conclude(
  value: unknown,
  step: {
    expect?: { json?: Record<string, string> | undefined } | undefined
    save?: Record<string, string> | undefined
  },
  scope: Scope,
): string[] {
  rememberSecrets(value, scope)
  for (const [path, template] of Object.entries(step.expect?.json ?? {})) {
    const found = pointer(value, path)
    const wanted = render(template, scope)
    if (found === undefined || stringify(found) !== wanted)
      throw new VerificationError(
        `Expected "${wanted}" at ${path}, found ${found === undefined ? 'nothing' : `"${stringify(found).slice(0, 80)}"`}`,
      )
  }
  const saved = Object.entries(step.save ?? {}).map(([name, path]) => {
    const found = pointer(value, path)
    if (found === undefined) throw new VerificationError(`Nothing at ${path} to save as ${name}`)
    const text = stringify(found)
    if (
      scope.secretVars?.includes(name) ||
      credential.test(name) ||
      credential.test(path) ||
      hasSecrets(found, scope)
    ) {
      scope.secretVars ??= []
      if (!scope.secretVars.includes(name)) scope.secretVars.push(name)
      scope.secrets ??= []
      if (text && !scope.secrets.includes(text)) scope.secrets.push(text)
    }
    return [name, text] as const
  })
  scope.vars = { ...scope.vars, ...Object.fromEntries(saved) }
  return saved.map(([name]) => name)
}

/** Saves a file like a download: a templated name is sanitized and a taken one is never overwritten. */
async function keep(
  call: Call,
  saveAs: string,
  suggested: string,
  write: (file: string) => Promise<void>,
): Promise<string> {
  const name = render(saveAs, call.scope)
  if (mask(name, call.scope) !== name || mask(suggested, call.scope) !== suggested)
    throw new Error('A saved filename must not contain a credential')
  const file = destination(call.dir, name, suggested, references(saveAs).length > 0)
  await write(file)
  return file
}

/** The name a URL suggests, with the extension of the content type when the path has none. */
function suggestion(url: string, type: string | null): string {
  const name = basename(new URL(url).pathname)
  return extname(name) ? name : `${name || 'file'}${extension(type)}`
}

async function fetchFile(url: string, call: Call): Promise<{ body: Buffer; name: string }> {
  const reply = await send({
    method: 'GET',
    url,
    headers: {},
    timeoutMs: 60_000,
    retry: !call.committed && !call.scope.committed,
    maxBytes: MAX_BYTES,
  })
  if (reply.status < 200 || reply.status >= 300) throw new Error(`Fetching the file answered ${reply.status}`)
  return { body: reply.body, name: suggestion(url, reply.headers.get('content-type')) }
}

function encode(body: NonNullable<HttpStep['body']>, scope: Scope): { text: string; type: string } {
  if ('json' in body) return { text: JSON.stringify(renderJson(body.json, scope)), type: 'application/json' }
  if ('form' in body) {
    const form = Object.entries(body.form).map(
      ([name, value]) => [name, render(value, scope)] as [string, string],
    )
    return { text: new URLSearchParams(form).toString(), type: 'application/x-www-form-urlencoded' }
  }
  return { text: render(body.text, scope), type: 'text/plain; charset=utf-8' }
}

/** Sends the request of an http step, checks the reply, keeps what the step asks to keep. */
export async function runHttp(step: HttpStep, call: Call): Promise<Done> {
  const { scope } = call
  const text = (value: string) => render(value, scope)
  // WHATWG accepts backslashes and missing slashes: require an explicit web authority before parsing.
  if (!/^https?:\/\//i.test(text(step.url))) throw new Error('http steps need an explicit http(s) URL')
  const url = new URL(text(step.url))
  if (!/^https?:$/.test(url.protocol)) throw new Error(`http steps send to http(s) URLs, not ${url.protocol}`)
  if (url.username || url.password) throw new Error('http URL credentials must be supplied through headers')
  const anchor = new URL(text(step.url.replace(/\{\{\s*(?:item|vars)\.[^}]+\}\}/g, 'value')))
  if (url.origin !== anchor.origin)
    throw new Error('Item data and variables cannot change the HTTP destination')
  for (const [name, value] of Object.entries(step.query ?? {})) url.searchParams.append(name, text(value))
  const headers = Object.fromEntries(
    Object.entries(step.headers ?? {}).map(([name, value]) => [name, text(value)]),
  )
  const has = (name: string) => Object.keys(headers).some((key) => key.toLowerCase() === name)
  const body = step.body && encode(step.body, scope)
  if (body && !has('content-type')) headers['content-type'] = body.type
  if (step.idempotencyKey && !has('idempotency-key'))
    headers['Idempotency-Key'] = createHash('sha256').update(call.identity).digest('hex').slice(0, 32)
  if (step.session === 'browser' && !call.browser) throw new Error('A browser session needs the browser')

  call.commit()
  const reply = await send({
    method: step.method,
    url: url.href,
    headers,
    body: body?.text,
    timeoutMs: step.timeoutMs ?? 30_000,
    retry: !step.commit && !call.committed && !scope.committed && SAFE_READS.has(step.method),
    rejectRedirects: call.readback,
    maxBytes: step.saveAs ? MAX_BYTES : JSON_BYTES,
    browser: step.session === 'browser' ? call.browser : undefined,
  })

  const where = mask(`${url.origin}${url.pathname}`, scope)
  const accepted = step.expect?.status
    ? step.expect.status.includes(reply.status)
    : reply.status >= 200 && reply.status < 300
  if (!accepted) throw new VerificationError(`${step.method} ${where} answered ${reply.status}`)
  let value: unknown
  if (call.readback || step.save || step.expect?.json)
    try {
      value = JSON.parse(reply.body.toString('utf8'))
    } catch {
      throw new VerificationError(`${step.method} ${where} did not answer JSON`)
    }
  const saved = conclude(value, step, scope)
  const file = step.saveAs
    ? await keep(call, step.saveAs, suggestion(url.href, reply.headers.get('content-type')), (to) =>
        writeFile(to, reply.body, { flag: 'wx' }),
      )
    : undefined
  return {
    file,
    ...(call.readback && { value }),
    evidence: { method: step.method, url: where, status: reply.status, saved, file: file && basename(file) },
  }
}

/** The value of a tool result for `save`, `expect` and `file`: its structured content, else its text as JSON. */
function resultValue(result: CallToolResult): unknown {
  if (result.structuredContent) return result.structuredContent
  const first = result.content.find((block) => block.type === 'text')
  if (!first) return {}
  try {
    return JSON.parse(first.text)
  } catch {
    return { text: first.text }
  }
}

/** A string that the tool's input schema types as a number, integer or boolean becomes one, if it reads cleanly. */
function coerce(args: Record<string, unknown>, schema: { properties?: Record<string, unknown> | undefined }) {
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => {
      const declared = (schema.properties?.[name] as { type?: string | string[] } | undefined)?.type
      const types = [declared].flat()
      if (typeof value !== 'string' || types.includes('string')) return [name, value]
      if (types.includes('boolean') && /^(true|false)$/.test(value)) return [name, value === 'true']
      if (
        /^-?\d+(\.\d+)?$/.test(value) &&
        (types.includes('number') || (types.includes('integer') && !value.includes('.')))
      )
        return [name, Number(value)]
      return [name, value]
    }),
  )
}

/** Saves the file of a tool result: what `file` points to, else its first image, audio or resource. */
async function mcpFile(step: McpStep, result: CallToolResult, value: unknown, call: Call): Promise<string> {
  const saveAs = step.saveAs as string
  const saveBytes = (bytes: Buffer, name: string) =>
    bytes.length > MAX_BYTES
      ? Promise.reject(new Error(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB`))
      : keep(call, saveAs, name, (to) => writeFile(to, bytes, { flag: 'wx' }))
  let uri: string | undefined
  if (step.file !== undefined) {
    const found = pointer(value, step.file)
    if (typeof found !== 'string' || !found)
      throw new VerificationError(`Expected a path or URL at ${step.file}`)
    uri = found
  } else
    for (const block of result.content) {
      if (block.type === 'image' || block.type === 'audio')
        return saveBytes(Buffer.from(block.data, 'base64'), `file${extension(block.mimeType)}`)
      if (block.type === 'resource' && 'blob' in block.resource)
        return saveBytes(
          Buffer.from(block.resource.blob, 'base64'),
          `file${extension(block.resource.mimeType)}`,
        )
      if (block.type === 'resource_link') {
        uri = block.uri
        break
      }
    }
  if (!uri)
    throw new VerificationError('The result holds no file: no image, audio, resource or "file" pointer')
  if (/^https?:\/\//i.test(uri)) {
    const { body, name } = await fetchFile(uri, call)
    return saveBytes(body, name)
  }
  const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri
  if (!isAbsolute(path)) throw new Error('The result names a file by a relative path')
  if ((await stat(path)).size > MAX_BYTES)
    throw new Error(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB`)
  return keep(call, saveAs, basename(path), (to) => copyFile(path, to, constants.COPYFILE_EXCL))
}

/** Calls the tool of an mcp step, checks its result, keeps what the step asks to keep. */
export async function runMcp(step: McpStep, call: Call): Promise<Done> {
  const tool = await call.mcp.open(step.server, step.tool)
  if (call.readback && tool.annotations?.readOnlyHint !== true)
    throw new Error('A lookup MCP tool must explicitly declare readOnlyHint: true')
  if (step.readOnly && tool.annotations?.readOnlyHint === false)
    throw new Error(
      `MCP tool "${step.tool}" declares that it writes; it cannot be called with readOnly: true`,
    )
  const args = coerce(renderJson(step.args ?? {}, call.scope) as Record<string, unknown>, tool.schema)
  call.commit()
  const result = await tool.call(args, step.timeoutMs ?? 60_000)
  return finishMcp(step, result, call)
}

/** Safe arguments exposed to a host agent: runtime credentials cannot leave Ritoko in tool actions. */
export function agentArgs(step: McpStep, scope: Scope): Record<string, unknown> {
  if (
    references(JSON.stringify(step.args ?? {})).some(
      (ref) => ref.ns === 'vars' && scope.secretVars?.includes(ref.key),
    )
  )
    throw new Error(`MCP step "${step.id}" uses a secret in agent-managed arguments`)
  const args = renderJson(step.args ?? {}, scope) as Record<string, unknown>
  if (hasSecrets(args, scope))
    throw new Error(`MCP step "${step.id}" uses a secret in agent-managed arguments`)
  return args
}

/** Complete a direct or agent-managed MCP call, with the same result/error and persistence semantics. */
export async function finishMcp(step: McpStep, result: CallToolResult, call: Call): Promise<Done> {
  rememberSecrets(result.structuredContent, call.scope)
  // Error bodies can contain credentials not known to Ritoko. Keep only tool context in the journal.
  if (result.isError) throw new Error(`MCP tool "${step.tool}" failed (isError: true)`)
  if ((result as { resultType?: string }).resultType === 'input_required')
    throw new Error(`MCP tool "${step.tool}" asks for more input, which a workflow cannot give`)
  const value = resultValue(result)
  const saved = conclude(value, step, call.scope)
  const file = step.saveAs ? await mcpFile(step, result, value, call) : undefined
  return {
    file,
    ...(call.readback && { value }),
    evidence: { server: step.server, tool: step.tool, saved, file: file && basename(file) },
  }
}
