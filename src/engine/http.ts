import { setTimeout as sleep } from 'node:timers/promises'
import type { APIRequestContext } from 'playwright-core'

const MAX_RETRIES = 3
const MAX_REDIRECTS = 5
/** Only reads are eligible for automatic retry, regardless of HTTP idempotence. */
export const SAFE_READS = new Set(['GET', 'HEAD'])
const TRANSIENT = new Set([408, 429, 502, 503, 504])
const REDIRECT = new Set([301, 302, 303, 307, 308])

type Hop = { method: string; url: string; headers: Record<string, string>; body?: string | undefined }

export type HttpRequest = Hop & {
  /** Time for the whole exchange: redirects and retries included. */
  timeoutMs: number
  /** Send again after a network error or a transient status. */
  retry: boolean
  /** A business lookup must prove its configured destination, without redirecting to another route. */
  rejectRedirects?: boolean
  maxBytes: number
  /** The browser's request context: it carries the cookies of the pages. */
  browser?: APIRequestContext | undefined
}

export type Reply = { status: number; headers: Headers; body: Buffer }

const reason = (error: unknown) => {
  const { cause, message } = error as { cause?: { code?: string; message?: string }; message: string }
  return cause?.code ?? cause?.message ?? message
}

/** Milliseconds from a Retry-After header: seconds, or a date. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const ms = Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isNaN(ms) ? undefined : Math.max(0, ms)
}

const backoff = (retries: number) => Math.min(500 * 2 ** retries, 8_000) * (0.5 + Math.random())

async function read(response: Response, max: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.length
    if (size > max) throw new Error(`The response is larger than ${max / 1024 / 1024} MB`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** One exchange, without following redirects. */
async function once(req: HttpRequest, hop: Hop, signal: AbortSignal, timeout: number): Promise<Reply> {
  const { url, method, headers, body } = hop
  if (req.browser) {
    const response = await req.browser.fetch(url, {
      method,
      headers,
      data: body,
      maxRedirects: 0,
      maxRetries: 0,
      failOnStatusCode: false,
      timeout,
    })
    try {
      const bytes = await response.body()
      if (bytes.length > req.maxBytes)
        throw new Error(`The response is larger than ${req.maxBytes / 1024 / 1024} MB`)
      return { status: response.status(), headers: new Headers(response.headers()), body: bytes }
    } finally {
      await response.dispose()
    }
  }
  const response = await fetch(url, { method, headers, body, redirect: 'manual', signal })
  return { status: response.status, headers: response.headers, body: await read(response, req.maxBytes) }
}

/**
 * Sends a request and returns the final reply, whatever its status. Redirects are followed by hand, up to
 * five: headers go only to the same origin, and a cross-origin hop is for GET and HEAD alone. A network
 * error or a transient status is retried up to three times, honoring Retry-After, when `retry` is set.
 */
export async function send(req: HttpRequest): Promise<Reply> {
  const signal = AbortSignal.timeout(req.timeoutMs)
  const deadline = Date.now() + req.timeoutMs
  const timedOut = () => new Error(`No answer within ${req.timeoutMs / 1000} s`)
  const wait = (ms: number) =>
    sleep(ms, undefined, { signal }).catch(() => {
      throw timedOut()
    })
  let hop: Hop = req
  const retry = req.retry && SAFE_READS.has(req.method)
  let retries = 0
  let hops = 0
  for (;;) {
    let reply: Reply
    try {
      reply = await once(req, hop, signal, Math.max(1, deadline - Date.now()))
    } catch (error) {
      if (signal.aborted || Date.now() >= deadline) throw timedOut()
      if (!retry || retries >= MAX_RETRIES) throw new Error(`Request failed: ${reason(error)}`)
      await wait(backoff(retries++))
      continue
    }
    const location = reply.headers.get('location')
    if (req.rejectRedirects && REDIRECT.has(reply.status))
      throw new Error('Destination lookup redirects are refused')
    if (REDIRECT.has(reply.status) && location) {
      if (++hops > MAX_REDIRECTS) throw new Error(`More than ${MAX_REDIRECTS} redirects`)
      const next = new URL(location, hop.url)
      if (!/^https?:$/.test(next.protocol)) throw new Error(`Redirect to ${next.protocol} refused`)
      if (next.username || next.password) throw new Error('Redirect URL credentials refused')
      // As in a browser: 303, and 301/302 after a POST, go on with a GET.
      const get = reply.status === 303 ? hop.method !== 'HEAD' : reply.status < 303 && hop.method === 'POST'
      const method = get ? 'GET' : hop.method
      const cross = next.origin !== new URL(hop.url).origin
      if (cross && method !== 'GET' && method !== 'HEAD')
        throw new Error(`Refused to send a ${method} to another origin (${next.origin})`)
      hop = { method, url: next.href, headers: cross ? {} : hop.headers, body: get ? undefined : hop.body }
      continue
    }
    if (retry && TRANSIENT.has(reply.status) && retries < MAX_RETRIES) {
      const delay = retryAfter(reply.headers.get('retry-after')) ?? backoff(retries)
      if (delay < deadline - Date.now()) {
        retries++
        await wait(delay)
        continue
      }
    }
    return reply
  }
}
