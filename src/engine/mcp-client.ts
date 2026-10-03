import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type CallToolResult, ErrorCode, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Workflow } from './schema.ts'
import { mask, render, type Scope } from './template.ts'

/** A tool call never runs longer than this, whatever the progress it reports. */
const MAX_CALL_MS = 900_000
const CONNECT_MS = 30_000
const STDERR_BYTES = 2_000

type Resolved =
  | {
      command: string
      args?: string[] | undefined
      env?: Record<string, string> | undefined
      cwd?: string | undefined
    }
  | { url: string; headers?: Record<string, string> | undefined }

type Connected = { client: Client; tools: Map<string, Tool>; stderr: () => string }

/** A tool of a connected server: its input schema, and a call that fails on any error result. */
export type McpTool = {
  schema: Tool['inputSchema']
  annotations?: Tool['annotations']
  call: (args: Record<string, unknown>, timeoutMs: number) => Promise<CallToolResult>
}

const each = (values: Record<string, string> | undefined, f: (value: string) => string) =>
  values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, f(v)]))

type Entry = {
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
type Config = { mcpServers?: Record<string, Entry>; projects?: Record<string, Config> }

async function read(file: string): Promise<Config | undefined> {
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${file} is not valid JSON`)
  }
}

/**
 * The server `name` of Claude Code's configuration: this folder's entry in ~/.claude.json, then .mcp.json,
 * ~/.claude.json, then its user-level servers. ${VAR} and ${VAR:-default} come from the environment. The values
 * are read when the run needs them and never stored.
 */
export async function claudeServer(
  name: string,
  cwd = process.cwd(),
  onSecret?: (value: string) => void,
): Promise<Resolved> {
  const same = (a: string, b: string) =>
    a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
  const user = await read(join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json'))
  const project = Object.entries(user?.projects ?? {}).find(([path]) => same(path, cwd))?.[1]
  const entry =
    project?.mcpServers?.[name] ??
    (await read(join(cwd, '.mcp.json')))?.mcpServers?.[name] ??
    user?.mcpServers?.[name]
  if (!entry)
    throw new Error(`Server "${name}" is not in Claude Code's configuration (.mcp.json, ~/.claude.json)`)
  const expand = (value: string) =>
    value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, variable: string, fallback?: string) => {
      const found = process.env[variable] ?? fallback
      if (found === undefined)
        throw new Error(`Set environment variable ${variable}, used by server "${name}"`)
      if (found) onSecret?.(found)
      return found
    })
  if (entry.command && (!entry.type || entry.type === 'stdio'))
    return { command: expand(entry.command), args: entry.args?.map(expand), env: each(entry.env, expand) }
  if (entry.url && (entry.type === 'http' || entry.type === 'streamable-http'))
    return { url: expand(entry.url), headers: each(entry.headers, expand) }
  throw new Error(`Server "${name}" in Claude Code's configuration is not a stdio or HTTP server`)
}

/**
 * The MCP servers one run talks to: each is connected on first use, listed once, and closed with the run
 * (the server process ends with it).
 */
export class McpClients {
  #servers: Workflow['servers']
  #scope: Scope
  #connected = new Map<string, Promise<Connected>>()

  constructor(servers: Workflow['servers'], scope: Scope) {
    this.#servers = servers
    this.#scope = scope
  }

  async open(server: string, name: string): Promise<McpTool> {
    let connection = this.#connected.get(server)
    if (!connection) {
      connection = this.#connect(server)
      this.#connected.set(server, connection)
      connection.catch(() => this.#connected.delete(server))
    }
    const { client, tools, stderr } = await connection
    const tool = tools.get(name)
    if (!tool)
      throw new Error(
        `MCP server "${server}" has no tool "${name}" (it has ${[...tools.keys()].join(', ') || 'none'})`,
      )
    return {
      schema: tool.inputSchema,
      annotations: tool.annotations,
      call: async (args, timeoutMs) => {
        let result: CallToolResult
        try {
          result = (await client.callTool({ name, arguments: args }, undefined, {
            timeout: timeoutMs,
            // A tool that reports progress may take longer than the wait for a first answer.
            resetTimeoutOnProgress: true,
            maxTotalTimeout: MAX_CALL_MS,
            onprogress: () => {},
          })) as CallToolResult
        } catch (error) {
          const timedOut = error instanceof McpError && error.code === ErrorCode.RequestTimeout
          throw failure(
            server,
            timedOut
              ? `"${name}" gave no answer or progress within ${timeoutMs / 1000} s; it may still be running`
              : (error as Error).message,
            stderr(),
            this.#scope,
          )
        }
        return result
      },
    }
  }

  async #connect(name: string): Promise<Connected> {
    const spec = await this.#resolve(name)
    const client = new Client({ name: 'ritoko', version: '0.1.0' }, { capabilities: {} })
    let stderr = ''
    let transport: StdioClientTransport | StreamableHTTPClientTransport
    if ('command' in spec) {
      transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        // The transport starts the program with a minimal environment: nothing else is inherited.
        env: { ...getDefaultEnvironment(), ...spec.env },
        cwd: spec.cwd,
        stderr: 'pipe',
      })
      transport.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-STDERR_BYTES)
      })
    } else {
      const url = new URL(spec.url)
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        throw new Error(`MCP server "${name}" needs an http(s) URL without embedded credentials`)
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: spec.headers, redirect: 'error' },
      })
    }
    const tail = () => stderr.replace(/\s+/g, ' ').trim().slice(-300)
    const tools = new Map<string, Tool>()
    try {
      await client.connect(transport, { timeout: CONNECT_MS, maxTotalTimeout: CONNECT_MS })
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await client.listTools({ cursor }, { timeout: CONNECT_MS, maxTotalTimeout: CONNECT_MS })
        for (const tool of page.tools) tools.set(tool.name, tool)
        cursor = page.nextCursor
        if (cursor && seen.has(cursor)) throw new Error('MCP tools/list repeated its pagination cursor')
        if (cursor) seen.add(cursor)
        if (seen.size > 100) throw new Error('MCP tools/list exceeded 100 pages')
      } while (cursor)
    } catch (error) {
      await client.close().catch(() => {})
      throw failure(name, `could not connect: ${(error as Error).message}`, tail(), this.#scope)
    }
    return { client, tools, stderr: tail }
  }

  async #resolve(name: string): Promise<Resolved> {
    const spec = this.#servers[name]
    if (!spec) throw new Error(`Unknown MCP server "${name}": declare it in the workflow's "servers"`)
    if ('ref' in spec) {
      if (spec.ref === 'agent') throw new Error(`MCP server "${name}" uses ref: agent and requires host mode`)
      const found = await claudeServer(name, process.cwd(), (value) => {
        this.#scope.secrets ??= []
        this.#scope.secrets.push(value)
      })
      // Whatever this configuration holds may be a credential: it is masked like a secret param.
      this.#scope.secrets ??= []
      for (const value of Object.values(('command' in found ? found.env : found.headers) ?? {}))
        if (value) {
          this.#scope.secrets.push(value)
          const token = value.match(/^(?:Bearer|Basic)\s+(.+)$/i)?.[1]
          if (token) this.#scope.secrets.push(token)
        }
      if ('command' in found) {
        for (const value of found.args ?? []) if (value) this.#scope.secrets.push(value)
      } else {
        this.#scope.secrets.push(found.url)
        for (const value of new URL(found.url).searchParams.values())
          if (value) this.#scope.secrets.push(value)
      }
      return found
    }
    const fill = (value: string) => render(value, this.#scope)
    return 'command' in spec
      ? {
          command: fill(spec.command),
          args: spec.args?.map(fill),
          env: each(spec.env, fill),
          cwd: spec.cwd && fill(spec.cwd),
        }
      : { url: fill(spec.url), headers: each(spec.headers, fill) }
  }

  async close(): Promise<void> {
    const all = [...this.#connected.values()]
    this.#connected.clear()
    await Promise.allSettled(all.map(async (connection) => (await connection).client.close()))
  }
}

const failure = (server: string, message: string, stderr: string, scope: Scope) =>
  new Error(mask(`MCP server "${server}": ${message}${stderr ? ` (server stderr: ${stderr})` : ''}`, scope))
