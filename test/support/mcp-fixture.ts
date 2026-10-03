// A stdio MCP server for the tests of `mcp` steps. FIXTURE_DIR is where `path` and `link` put their files.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

if (process.env.FIXTURE_FAIL_START) {
  console.error(`fixture exploded on start ${process.env.SECRET_VALUE ?? ''}`)
  process.exit(1)
}

const server = new McpServer({ name: 'fixture', version: '1.0.0' })
const dir = process.env.FIXTURE_DIR ?? '.'
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

server.registerTool(
  'echo',
  { inputSchema: { message: z.string() }, outputSchema: { echo: z.string() } },
  async ({ message }) => ({ ...text(`echo ${message}`), structuredContent: { echo: message } }),
)
server.registerTool('plain', { inputSchema: {} }, async () => text('plain words'))
server.registerTool('jsontext', { inputSchema: {} }, async () => text('{"a":{"b":7}}'))
server.registerTool('pid', { inputSchema: {} }, async () => text(JSON.stringify({ pid: process.pid })))
server.registerTool('env', { inputSchema: { name: z.string() } }, async ({ name }) =>
  text(JSON.stringify({ value: process.env[name] ?? '' })),
)
server.registerTool('fail', { inputSchema: {} }, async () => ({
  ...text('boom: the tool refused'),
  isError: true,
}))
server.registerTool('ask', { inputSchema: {} }, async () => ({ content: [], resultType: 'input_required' }))
server.registerTool('writes', { inputSchema: {}, annotations: { readOnlyHint: false } }, async () =>
  text('{"ok":true}'),
)
server.registerTool('image', { inputSchema: {} }, async () => ({
  content: [
    {
      type: 'image' as const,
      data: Buffer.from([137, 80, 78, 71, 1]).toString('base64'),
      mimeType: 'image/png',
    },
  ],
}))
server.registerTool('path', { inputSchema: { name: z.string() } }, async ({ name }) => {
  const file = join(dir, `made-${name}.txt`)
  writeFileSync(file, `made for ${name}`)
  return text(JSON.stringify({ path: file }))
})
server.registerTool('link', { inputSchema: { uri: z.string().optional() } }, async ({ uri }) => {
  const file = join(dir, 'linked.bin')
  writeFileSync(file, 'linked')
  return {
    content: [{ type: 'resource_link' as const, name: 'linked', uri: uri ?? pathToFileURL(file).href }],
  }
})
server.registerTool(
  'typed',
  { inputSchema: { count: z.number().int(), flag: z.boolean(), label: z.string() } },
  async ({ count, flag, label }) =>
    text(JSON.stringify({ count, flag, label, kinds: `${typeof count}/${typeof flag}/${typeof label}` })),
)
server.registerTool(
  'slow',
  { inputSchema: { ms: z.number(), progress: z.boolean() } },
  async ({ ms, progress }, extra) => {
    const token = extra._meta?.progressToken
    for (let i = 1; i <= 5; i++) {
      await wait(ms / 5)
      if (progress && token !== undefined)
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken: token, progress: i, total: 5 },
        })
    }
    return text('{"slow":"done"}')
  },
)

await server.connect(new StdioServerTransport())
