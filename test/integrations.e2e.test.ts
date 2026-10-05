import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Ledger } from '../src/engine/ledger.ts'
import { Runner } from '../src/engine/runner.ts'
import { Store } from '../src/engine/store.ts'

function removeTemporaryHome(root: string, prefix: string) {
  const absolute = resolve(root)
  if (dirname(absolute) !== dirname(prefix) || !basename(absolute).startsWith(basename(prefix)))
    throw new Error(`Unsafe integration test cleanup: ${absolute}`)
  rmSync(absolute, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

/** Acceptance is recorded before the held response: a kill cannot undo the server's write. */
async function ordersApi() {
  const orders: { id: string; email: string; name: string; status: string }[] = []
  const accepted = Promise.withResolvers<void>()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.test')
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (request.method === 'POST' && url.pathname === '/orders') {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body) as { email: string; name: string }
      const order = { id: `order-${orders.length + 1}`, ...input, status: 'paid' }
      orders.push(order)
      if (order.email === 'b@example.test' && orders.length === 2) {
        accepted.resolve()
        return
      }
      return reply(201, { id: order.id })
    }
    const order =
      url.pathname === '/orders/by-email'
        ? orders.find((entry) => entry.email === url.searchParams.get('email'))
        : orders.find((entry) => url.pathname === `/orders/${entry.id}`)
    return order && request.method === 'GET' ? reply(200, order) : reply(404, { error: 'Order not found' })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Orders API did not start')
  return {
    orders,
    accepted: accepted.promise,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

it('recovers a compiled CLI killed after HTTP acceptance without Chrome or repeated writes', async () => {
  const prefix = resolve(tmpdir(), 'ritoko-integrations-e2e-')
  const root = mkdtempSync(prefix)
  const service = await ordersApi()
  let ledger: Ledger | undefined
  let child: ReturnType<typeof spawn> | undefined
  let ended: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let output = ''
  try {
    const cli = resolve('dist', 'cli.js')
    expect(existsSync(cli), 'Build the compiled CLI before running integration E2E').toBe(true)
    const input = join(root, 'input.csv')
    writeFileSync(input, 'Email,Name\na@example.test,Ada\nb@example.test,Bob\nc@example.test,Carol\n')
    const store = new Store(join(root, 'workflows'))
    const { workflow } = await store.save({
      name: 'http-crash',
      description: 'HTTP acceptance crash regression',
      params: { input: {}, base: { default: service.url } },
      items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.base}}' },
      item: [
        {
          id: 'create',
          do: 'http',
          method: 'POST',
          url: '{{param.base}}/orders',
          body: { json: { email: '{{item.Email}}', name: '{{item.Name}}' } },
          commit: true,
          expect: { status: [201] },
          save: { orderId: '/id' },
        },
        {
          id: 'verify',
          do: 'http',
          url: '{{param.base}}/orders/{{vars.orderId}}',
          expect: { json: { '/email': '{{item.Email}}', '/name': '{{item.Name}}', '/status': 'paid' } },
        },
      ],
    })
    child = spawn(process.execPath, [cli, 'run', workflow.name, '--param', `input=${input}`], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        RITOKO_HOME: root,
        RITOKO_CHROME_PATH: join(root, 'missing-chrome-executable'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (data) => {
      output += data
    })
    child.stderr?.on('data', (data) => {
      output += data
    })
    ended = new Promise<void>((done, reject) => {
      child?.once('error', reject)
      child?.once('close', () => done())
    })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`CLI did not reach HTTP acceptance: ${output}`)), 10_000)
    })
    await Promise.race([
      service.accepted,
      ended.then(() => {
        throw new Error(`CLI exited before the crash point: ${output}`)
      }),
      timeout,
    ])
    clearTimeout(timer)
    child.kill('SIGKILL')
    await ended

    // Open only after the process dies, so recovery uses the durable journal and dead-process lease.
    ledger = new Ledger(join(root, 'ritoko.db'))
    const run = ledger.lastRun(workflow.name)
    expect(run).toBeDefined()
    const runId = run?.id ?? ''
    expect(ledger.items(runId).map((item) => [item.status, item.committed])).toEqual([
      ['done', true],
      ['running', true],
      ['pending', false],
    ])
    const browser = {
      launched: 0,
      async page(): Promise<never> {
        browser.launched++
        throw new Error('HTTP recovery must not launch Chrome')
      },
    }
    const runner = new Runner(browser, ledger, new Store(join(root, 'workflows')), join(root, 'runs'))
    const resumed = await runner.resume(runId)
    expect(resumed.status).toBe('partial')
    expect(resumed.report.counts).toEqual({ done: 2, review: 1 })
    expect(ledger.items(runId)[1]).toMatchObject({
      key: 'b@example.test',
      status: 'review',
      committed: true,
      cause: 'interrupted',
    })
    expect(service.orders.map((order) => order.email)).toEqual([
      'a@example.test',
      'b@example.test',
      'c@example.test',
    ])
    const rerun = await runner.start(workflow.name, { input })
    expect(rerun.report.counts).toEqual({ skipped: 2, review: 1 })
    expect(service.orders).toHaveLength(3)

    // Resolve using an independent API read of the accepted payload, rather than assuming success.
    const proof = await fetch(`${service.url}/orders/by-email?email=b%40example.test`)
    expect(proof.status).toBe(200)
    const evidence = await proof.json()
    expect(evidence).toEqual({ id: 'order-2', email: 'b@example.test', name: 'Bob', status: 'paid' })
    await runner.resolve(runId, 'b@example.test', 'done', `Checked orders API: ${JSON.stringify(evidence)}`, {
      confirmChecked: true,
    })
    expect((await runner.resume(runId)).status).toBe('done')
    expect((await runner.resume(rerun.report.runId)).report.counts).toEqual({ skipped: 3 })
    expect(service.orders).toHaveLength(3)
    expect(browser.launched).toBe(0)
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await ended?.catch(() => {})
    ledger?.db.close()
    await service.close()
    removeTemporaryHome(root, prefix)
  }
})
