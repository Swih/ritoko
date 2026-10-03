import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

/** A streamable HTTP MCP server with an `echo` tool, recording the Authorization header of every request. */
export async function mcpOverHttp() {
  const authorizations: (string | undefined)[] = []
  const server = createServer(async (req, res) => {
    authorizations.push(req.headers.authorization)
    // Stateless: a server and a transport per request.
    const mcp = new McpServer({ name: 'remote', version: '1.0.0' })
    mcp.registerTool(
      'echo',
      { inputSchema: { message: z.string() }, outputSchema: { echo: z.string() } },
      async ({ message }) => ({
        content: [{ type: 'text', text: message }],
        structuredContent: { echo: message },
      }),
    )
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MCP server did not start')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    authorizations,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
