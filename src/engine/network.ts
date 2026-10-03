import type { Page, Request, Response } from 'playwright-core'

/** Routing and field metadata for a proposed API step; no headers or request/response values. */
export type NetworkHint = {
  method: string
  origin: string
  path: string
  queryKeys: string[]
  bodyKeys: string[]
  status?: number
}

const LIMIT = 30
const names = (values: Iterable<string>) => [...new Set(values)].slice(0, 30)

/** Keep routing structure; opaque IDs and credentials in a path become placeholders. */
export function route(raw: string): Pick<NetworkHint, 'origin' | 'path' | 'queryKeys'> {
  const url = new URL(raw)
  let credential = false
  const path = url.pathname
    .split('/')
    .map((part) => {
      const sensitive = credential
      credential =
        /^(?:(?:access|refresh|csrf)[-_]?token|api[-_]?key|session[-_]?id|token|key|secret|password|auth|session|signature)$/i.test(
          part,
        )
      return sensitive || /\d/.test(part) || part.length > 40 || /%|@/.test(part) ? ':value' : part
    })
    .join('/')
  return { origin: url.origin, path, queryKeys: names(url.searchParams.keys()) }
}

/** Only top-level field names. Malformed/opaque bodies provide no hint. */
export function bodyKeys(body: string | null, contentType: string): string[] {
  if (!body || body.length > 100_000) return []
  try {
    if (/\bjson\b/i.test(contentType)) {
      const value: unknown = JSON.parse(body)
      return value && typeof value === 'object' && !Array.isArray(value) ? names(Object.keys(value)) : []
    }
    if (/application\/x-www-form-urlencoded/i.test(contentType))
      return names(new URLSearchParams(body).keys())
  } catch {
    // Capturing hints must never affect the user's browser action.
  }
  return []
}

/** Correlates fetch/xhr requests with the action during which they started. Bounded and opt-in. */
export class NetworkCapture {
  #page?: Page
  #active?: string
  #hints = new Map<string, NetworkHint[]>()
  #pending = new WeakMap<Request, NetworkHint>()

  #request = (request: Request) => {
    if (!this.#active || !['fetch', 'xhr'].includes(request.resourceType())) return
    const hints = this.#hints.get(this.#active)
    if (!hints || hints.length >= LIMIT) return
    try {
      const hint: NetworkHint = {
        method: request.method(),
        ...route(request.url()),
        bodyKeys: bodyKeys(request.postData(), request.headers()['content-type'] ?? ''),
      }
      hints.push(hint)
      this.#pending.set(request, hint)
    } catch {
      // A request URL or encoding the recorder cannot inspect is simply omitted.
    }
  }

  #response = (response: Response) => {
    const hint = this.#pending.get(response.request())
    if (hint) hint.status = response.status()
  }
  #closed = () => this.detach()

  begin(page: Page, stepId: string): void {
    if (page !== this.#page) {
      this.detach()
      this.#page = page
      page.on('request', this.#request)
      page.on('response', this.#response)
      page.once('close', this.#closed)
    }
    this.#active = stepId
    this.#hints.set(stepId, [])
  }

  end(): void {
    this.#active = undefined
  }

  hints(stepId: string): NetworkHint[] {
    return this.#hints.get(stepId) ?? []
  }

  clear(): void {
    this.detach()
    this.#hints.clear()
    this.#pending = new WeakMap()
  }

  detach(): void {
    this.#page?.off('request', this.#request)
    this.#page?.off('response', this.#response)
    this.#page?.off('close', this.#closed)
    this.#page = undefined
    this.#active = undefined
  }
}
