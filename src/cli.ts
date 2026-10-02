#!/usr/bin/env node
// `ritoko mcp` serves agents over stdio; everything else is the command line.
if (process.argv[2] === 'mcp') await import('./mcp/server.ts')
else await import('./commands.ts')
