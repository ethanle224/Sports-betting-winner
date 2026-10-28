import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNbaPlayerFetcher } from '../../server/nba-player-fetch'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('slate-wide player boxscore fetch lifecycle', () => {
  it.each(['normal', 'timeout', 'caller'] as const)('holds failed-response slots until body cancellation settles (%s)', async (mode) => {
    vi.useFakeTimers()
    const cancellations = Array.from({ length: 6 }, () => deferred<void>())
    const controller = new AbortController(); const reason = new Error('Caller expired during error cleanup')
    const added = vi.spyOn(controller.signal, 'addEventListener')
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const signals: AbortSignal[] = []; const json = vi.fn()
    let active = 0; let maximum = 0; let cancelStarted = 0
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const index = signals.length
      signals.push(init!.signal!)
      active++; maximum = Math.max(maximum, active)
      const response = new Response(new ReadableStream({
        cancel() { cancelStarted++; return cancellations[index].promise.then(() => { active-- }) },
      }), { status: 503, headers: { 'Content-Type': 'text/html' } })
      response.json = json
      return response
    })
    const fetcher = createNbaPlayerFetcher(upstream)
    const settled = Promise.allSettled(cancellations.map((_, i) =>
      fetcher(`https://example.test/error/${i}`, { signal: controller.signal })))
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(upstream).toHaveBeenCalledTimes(2)
      expect(cancelStarted).toBe(2)
      expect(active).toBe(2)
      if (mode === 'caller') controller.abort(reason)
      if (mode !== 'normal') {
        await vi.advanceTimersByTimeAsync(10000)
        expect(signals.every((signal) => signal.aborted)).toBe(true)
        expect(upstream).toHaveBeenCalledTimes(2)
        expect(active).toBe(2)
      }
      cancellations[0].resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(upstream).toHaveBeenCalledTimes(mode === 'caller' ? 2 : 3)
      expect(active).toBe(mode === 'caller' ? 1 : 2)
      cancellations.forEach((gate) => gate.resolve())
      const results = await settled
      if (mode === 'caller') expect(results).toEqual(cancellations.map(() => ({ status: 'rejected', reason })))
      else results.forEach((result, i) => {
        if (mode === 'timeout' && i < 2) {
          expect(result.status).toBe('rejected')
          if (result.status === 'rejected') expect(result.reason.name).toBe('TimeoutError')
        } else {
          expect(result.status).toBe('fulfilled')
          if (result.status === 'fulfilled') expect(result.value.status).toBe(503)
        }
      })
      expect(maximum).toBe(2)
      expect(active).toBe(0)
      expect(json).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(removed.mock.calls).toEqual(added.mock.calls.map(([type, listener]) => [type, listener]))
    } finally {
      cancellations.forEach((gate) => gate.resolve())
      await settled
    }
  })
  it.each([200, 503])('cancels late %i response bodies before releasing aborted slots without reading JSON', async (status) => {
    vi.useFakeTimers()
    const headers = deferred<Response>(); const canceled = deferred<void>()
    const cancel = vi.fn(() => canceled.promise); const json = vi.fn()
    const upstream = vi.fn<typeof fetch>().mockImplementation(() => headers.promise)
    const controller = new AbortController(); const reason = new Error('Caller expired before late headers')
    const added = vi.spyOn(controller.signal, 'addEventListener')
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    let finished = false
    const settled = Promise.allSettled([
      createNbaPlayerFetcher(upstream)('https://example.test/late-body', { signal: controller.signal }),
    ]).then((results) => { finished = true; return results })
    try {
      await vi.advanceTimersByTimeAsync(0)
      controller.abort(reason)
      const response = new Response(new ReadableStream({ cancel }), { status })
      response.json = json
      headers.resolve(response)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(finished).toBe(false)
      expect(json).not.toHaveBeenCalled()
      canceled.resolve()
      expect(await settled).toEqual([{ status: 'rejected', reason }])
      expect(vi.getTimerCount()).toBe(0)
      expect(removed.mock.calls).toEqual(added.mock.calls.map(([type, listener]) => [type, listener]))
    } finally {
      canceled.resolve()
      await settled
    }
  })

  it('never dispatches any of six requests with an already-aborted caller signal', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ source: 'original' }))
    const fetcher = createNbaPlayerFetcher(upstream)
    const controller = new AbortController()
    const reason = new Error('Caller expired')
    controller.abort(reason)
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      fetcher(`https://example.test/box/${i}`, { signal: controller.signal })))
    expect(upstream).not.toHaveBeenCalled()
    expect(results).toEqual(Array.from({ length: 6 }, () => ({ status: 'rejected', reason })))
  })
  it('does not dispatch the third queued request canceled before a slot is free', async () => {
    const firstHeaders = deferred<Response>(); const secondHeaders = deferred<Response>()
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ unexpected: true }))
      .mockImplementationOnce(() => firstHeaders.promise).mockImplementationOnce(() => secondHeaders.promise)
    const fetcher = createNbaPlayerFetcher(upstream)
    const controller = new AbortController(); const reason = new Error('Queued caller expired')
    const results = Promise.allSettled([
      fetcher('https://example.test/first'), fetcher('https://example.test/second'),
      fetcher('https://example.test/canceled', { signal: controller.signal }),
    ])
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2))
    controller.abort(reason)
    firstHeaders.resolve(Response.json({ source: 1 })); secondHeaders.resolve(Response.json({ source: 2 }))
    const settled = await results
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(settled[2]).toEqual({ status: 'rejected', reason })
  })
  it('holds the two shared slots until delayed JSON settles, not just response headers', async () => {
    const bodies = Array.from({ length: 6 }, () => deferred<unknown>())
    let active = 0; let maximum = 0; let next = 0
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => {
      const index = next++
      return { ok: true, status: 206, json: async () => {
        active++; maximum = Math.max(maximum, active)
        try { return await bodies[index].promise } finally { active-- }
      } } as Response
    })
    const fetcher = createNbaPlayerFetcher(upstream)
    const reads = Promise.all(bodies.map((_, i) => fetcher(`https://example.test/box/${i}`).then((r) => r.json())))
    try {
      await vi.waitFor(() => expect(upstream).toHaveBeenCalled())
      expect(upstream).toHaveBeenCalledTimes(2)
      expect(active).toBe(2)
      bodies[0].resolve({ source: 0 })
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(3))
      expect(active).toBe(2)
      expect(maximum).toBe(2)
    } finally {
      bodies.forEach((body, i) => body.resolve({ source: i }))
      expect(await reads).toEqual(bodies.map((_, i) => ({ source: i })))
    }
    expect(maximum).toBe(2)
  })
  it('propagates caller cancellation to both active upstream calls', async () => {
    const headers = deferred<Response>()
    const signals: AbortSignal[] = []; const observed = vi.fn()
    const upstream = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((resolve, reject) => {
      const signal = init!.signal!
      signals.push(signal)
      signal.addEventListener('abort', () => { observed(); reject(signal.reason) }, { once: true })
      void headers.promise.then(resolve)
    }))
    const fetcher = createNbaPlayerFetcher(upstream)
    const controller = new AbortController(); const reason = new Error('Active caller expired')
    const settled = Promise.allSettled([1, 2].map((i) => fetcher(`https://example.test/${i}`, { signal: controller.signal })))
    try {
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2))
      controller.abort(reason)
      expect(signals.every((signal) => signal.aborted && signal.reason === reason)).toBe(true)
      expect(observed).toHaveBeenCalledTimes(2)
      expect(await settled).toEqual([1, 2].map(() => ({ status: 'rejected', reason })))
    } finally {
      headers.resolve(Response.json({ source: 'cleanup' }))
      await settled
    }
  })
  it('keeps ignored-abort JSON in its physical slots and never launches canceled queued work', async () => {
    vi.useFakeTimers()
    const body = deferred<unknown>(); const signals: AbortSignal[] = []
    let readers = 0
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init!.signal!)
      return { ok: true, json: async () => { readers++; return body.promise } } as Response
    })
    const fetcher = createNbaPlayerFetcher(upstream)
    const controller = new AbortController(); const reason = new Error('Eight-second caller deadline')
    const settled = Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      fetcher(`https://example.test/${i}`, { signal: controller.signal })))
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(readers).toBe(2)
      setTimeout(() => controller.abort(reason), 8000)
      await vi.advanceTimersByTimeAsync(10000)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(upstream).toHaveBeenCalledTimes(2)
      expect(readers).toBe(2) // abort must not free a slot before the body physically settles
      body.resolve({ original: 'late source data' })
      expect(await settled).toEqual(Array.from({ length: 6 }, () => ({ status: 'rejected', reason })))
      expect(upstream).toHaveBeenCalledTimes(2)
    } finally {
      body.resolve({ original: 'cleanup' })
      await settled
    }
  })
  it('does not start a JSON read when an abort-ignoring fetch returns after caller cancellation', async () => {
    const headers = deferred<Response>(); const json = vi.fn(async () => ({ late: true }))
    const upstream = vi.fn<typeof fetch>().mockImplementation(() => headers.promise)
    const controller = new AbortController(); const reason = new Error('Caller expired before headers')
    const settled = Promise.allSettled([createNbaPlayerFetcher(upstream)('https://example.test/late', { signal: controller.signal })])
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1))
    controller.abort(reason)
    headers.resolve({ ok: true, json } as unknown as Response)
    const result = await settled
    expect(json).not.toHaveBeenCalled()
    expect(result).toEqual([{ status: 'rejected', reason }])
  })
})
