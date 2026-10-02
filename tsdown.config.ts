import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outExtensions: () => ({ js: '.mjs' }),
  clean: true,
})
