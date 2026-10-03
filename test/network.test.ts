import { EventEmitter } from 'node:events'
import type { Page, Request, Response } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { bodyKeys, NetworkCapture, route } from '../src/engine/network.ts'

describe('network hints', () => {
  test('keeps parameter names but removes URL credentials, query values, fragments and opaque path values', () => {
    const hint = route(
      'https://user:password@example.test/v1/orders/123/token/secretvalue?key=private&q=alice#cookie',
    )
    expect(hint).toEqual({
      origin: 'https://example.test',
      path: '/:value/orders/:value/token/:value',
      queryKeys: ['key', 'q'],
    })
    expect(JSON.stringify(hint)).not.toMatch(/password|private|alice|secretvalue|cookie/)
    expect(route('https://example.test/api/access-token/abcdefgh').path).toBe('/api/access-token/:value')
    expect(bodyKeys('{"password":"private","order":{"name":"alice"}}', 'application/json')).toEqual([
      'password',
      'order',
    ])
    expect(bodyKeys('token=private&name=alice', 'application/x-www-form-urlencoded')).toEqual([
      'token',
      'name',
    ])
    expect(bodyKeys('private', 'text/plain')).toEqual([])
  })

  test('associates late responses with their original step and detaches after clear', () => {
    const page = new EventEmitter() as unknown as Page
    const capture = new NetworkCapture()
    const request = {
      resourceType: () => 'fetch',
      method: () => 'POST',
      url: () => 'https://example.test/orders',
      postData: () => '{"email":"private"}',
      headers: () => ({ authorization: 'Bearer private', 'content-type': 'application/json' }),
    } as unknown as Request
    capture.begin(page, 'submit')
    ;(page as unknown as EventEmitter).emit('request', request)
    capture.begin(page, 'verify')
    ;(page as unknown as EventEmitter).emit('response', {
      request: () => request,
      status: () => 201,
    } as unknown as Response)
    expect(capture.hints('submit')).toEqual([
      {
        method: 'POST',
        origin: 'https://example.test',
        path: '/orders',
        queryKeys: [],
        bodyKeys: ['email'],
        status: 201,
      },
    ])
    expect(capture.hints('verify')).toEqual([])
    capture.clear()
    expect((page as unknown as EventEmitter).listenerCount('request')).toBe(0)
    expect(capture.hints('submit')).toEqual([])
  })
})
