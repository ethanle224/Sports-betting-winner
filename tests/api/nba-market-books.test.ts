// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NbaBook } from '../../server/nba-kalshi'

const book: NbaBook = { orderbook_fp: { yes_dollars: [['0.4000', '2.00']], no_dollars: [['0.5500', '0.50']] } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const response = (value: unknown = book) => ({ ok: true, json: async () => value }) as Response

beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('all-market NBA orderbook collection', () => {
  it.each([['A', 'A'], [''], ['   '], ['A', '']])('rejects duplicate/empty tickers before any HTTP request: %j', async (...tickers) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => response())
    await expect(collectNbaMarketBooks(tickers, upstream)).rejects.toThrow(/ticker/i)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('accepts an empty slate and preserves literal keys without prototype collisions', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => response())
    expect(await collectNbaMarketBooks([], upstream)).toEqual({ books: {}, observedAt: {} })
    expect(upstream).not.toHaveBeenCalled()
    const result = collectNbaMarketBooks(['__proto__', 'constructor', ' A '], upstream)
    await vi.runAllTimersAsync()
    const collected = await result
    expect(Object.keys(collected.books)).toEqual(['__proto__', 'constructor', ' A '])
    expect(Object.keys(collected.observedAt)).toEqual(['__proto__', 'constructor', ' A '])
  })

  it.each([null, {}, { orderbook_fp: null }, { orderbook_fp: {} },
    { orderbook_fp: { yes_dollars: Array(1), no_dollars: [] } },
    { orderbook_fp: { yes_dollars: [], no_dollars: null } },
    ...[null, ['0.5'], ['0.5', '2', 'extra'], [0.5, '2'], ['', '2'], ['1.1', '2'], ['-0.1', '2'],
      ['NaN', '2'], ['0.5', '0'], ['0.5', '-1'], ['0.5', 'Infinity'], ['0.5', '1000000001']]
      .map((row) => ({ orderbook_fp: { yes_dollars: [row], no_dollars: [] } })),
  ])('rejects incomplete/malformed orderbooks rather than returning partial evidence: %j', async (payload) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => response(payload))
    const settled = Promise.allSettled([collectNbaMarketBooks(['A'], upstream)])
    await vi.runAllTimersAsync()
    expect(await settled).toEqual([{ status: 'rejected', reason: expect.any(Error) }])
  })

  it('retains empty and fractional illiquid books even when neither side has executable depth', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const illiquid = { orderbook_fp: { yes_dollars: [], no_dollars: [['0.0000', '0.01']] } }
    const empty = { orderbook_fp: { yes_dollars: [], no_dollars: [] } }
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(response(illiquid)).mockResolvedValueOnce(response(empty))
    const result = collectNbaMarketBooks(['ILLIQUID', 'EMPTY'], upstream)
    await vi.runAllTimersAsync()
    expect((await result).books).toEqual({ ILLIQUID: illiquid, EMPTY: empty })
  })
  it('paces starts globally at least 120ms apart across simultaneous slates', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const starts: number[] = []
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => { starts.push(Date.now()); return response() })
    const collected = Promise.all([
      collectNbaMarketBooks(['A', 'B', 'C', 'D', 'E'], upstream),
      collectNbaMarketBooks(['F', 'G', 'H', 'I', 'J'], upstream),
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(upstream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(119)
    expect(upstream).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect((await collected).flatMap((slate) => Object.keys(slate.books))).toHaveLength(10)
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 120)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares two physical slots across slates through delayed JSON, not merely headers', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const bodies = Array.from({ length: 6 }, () => deferred<unknown>())
    let active = 0; let maximum = 0
    const starts: number[] = []; const observations: Record<string, number> = {}
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const index = starts.length; const ticker = String(input).split('/').at(-2)!
      starts.push(Date.now()); active++; maximum = Math.max(active, maximum)
      return { ok: true, json: async () => {
        try { return await bodies[index].promise } finally { observations[ticker] = Date.now(); active-- }
      } } as Response
    })
    const results = Promise.all([
      collectNbaMarketBooks(['A', 'B', 'C'], upstream), collectNbaMarketBooks(['D', 'E', 'F'], upstream),
    ])
    try {
      await vi.advanceTimersByTimeAsync(1000)
      expect(starts).toHaveLength(2)
      expect(active).toBe(2)
      bodies[1].resolve(book)
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toHaveLength(3)
      bodies[0].resolve(book)
      await vi.advanceTimersByTimeAsync(119)
      expect(starts).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toHaveLength(4)
    } finally {
      bodies.forEach((body) => body.resolve(book))
      await vi.runAllTimersAsync()
      const slates = await results
      const observed = Object.assign({}, ...slates.map((slate) => slate.observedAt)) as Record<string, string>
      const tickers = ['A', 'B', 'C', 'D', 'E', 'F']
      tickers.forEach((ticker) => expect(Date.parse(observed[ticker])).toBe(observations[ticker]))
    }
    expect(maximum).toBe(2)
    expect(active).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails the whole slate on HTTP error, aborts peers, and holds error-body slots through cancellation', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const headers = deferred<Response>(); const json = deferred<unknown>(); const canceled = deferred<void>()
    const errorCancel = vi.fn(() => canceled.promise)
    const peerCancel = vi.fn(async () => {})
    const signals: AbortSignal[] = []
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      signals.push(init!.signal as AbortSignal)
      if (String(input).includes('/BAD/')) return headers.promise
      if (String(input).includes('/PEER/')) return { ok: true, json: () => json.promise, body: { cancel: peerCancel } } as unknown as Response
      return response()
    })
    const slate = Promise.allSettled([collectNbaMarketBooks(['BAD', 'PEER', 'NEVER'], upstream)])
    await vi.advanceTimersByTimeAsync(240)
    expect(upstream).toHaveBeenCalledTimes(2)
    headers.resolve({ ok: false, status: 503, body: { cancel: errorCancel } } as unknown as Response)
    await vi.advanceTimersByTimeAsync(0)
    expect(await slate).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/503/) }) }])
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(errorCancel).toHaveBeenCalledTimes(1)
    expect(peerCancel).toHaveBeenCalledTimes(1)
    const healthy = collectNbaMarketBooks(['HEALTHY', 'NEXT'], upstream)
    await vi.advanceTimersByTimeAsync(1000)
    expect(upstream).toHaveBeenCalledTimes(2)
    // The peer's canceled-but-abort-ignoring JSON still owns its physical slot.
    canceled.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(upstream).toHaveBeenCalledTimes(3)
    json.resolve(book)
    await vi.runAllTimersAsync()
    expect(Object.keys((await healthy).books)).toEqual(['HEALTHY', 'NEXT'])
    expect(upstream.mock.calls.some(([url]) => String(url).includes('/NEVER/'))).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses elapsed time rather than wall clock across independent scans', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => response())
    const first = collectNbaMarketBooks(['A', 'B'], upstream)
    await vi.runAllTimersAsync(); await first
    vi.setSystemTime(Date.now() - 86_400_000)
    const started = performance.now()
    const second = collectNbaMarketBooks(['C'], upstream)
    await vi.runAllTimersAsync(); await second
    expect(performance.now() - started).toBeLessThanOrEqual(120)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not inherit pacing debt when a runtime resets the monotonic clock origin', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(response())
    const first = collectNbaMarketBooks(['A', 'B', 'C'], upstream)
    await vi.runAllTimersAsync(); await first
    vi.useRealTimers(); vi.useFakeTimers()
    const started = performance.now()
    const second = collectNbaMarketBooks(['D'], upstream)
    await vi.runAllTimersAsync(); await second
    expect(performance.now() - started).toBeLessThanOrEqual(120)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([true, false])('honors caller cancellation before dispatch=%s without starting canceled queued work', async (beforeDispatch) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const controller = new AbortController(); const reason = new Error('caller canceled slate')
    const headers = deferred<Response>(); const canceled = deferred<void>()
    const cancel = vi.fn(() => canceled.promise)
    const signals: AbortSignal[] = []
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init!.signal as AbortSignal)
      return headers.promise
    })
    if (beforeDispatch) controller.abort(reason)
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A', 'B', 'NEVER'], upstream, { signal: controller.signal })])
    await vi.advanceTimersByTimeAsync(240)
    if (!beforeDispatch) controller.abort(reason)
    await vi.advanceTimersByTimeAsync(0)
    expect(await outcome).toEqual([{ status: 'rejected', reason }])
    expect(upstream).toHaveBeenCalledTimes(beforeDispatch ? 0 : 2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    if (!beforeDispatch) {
      headers.resolve({ ok: true, body: { cancel }, json: vi.fn() } as unknown as Response)
      await vi.advanceTimersByTimeAsync(1000)
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(upstream).toHaveBeenCalledTimes(2)
      canceled.resolve()
      await vi.runAllTimersAsync()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['headers', 'json'])('rejects at the slate deadline even when %s ignores abort', async (phase) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const headers = deferred<Response>(); const json = deferred<unknown>(); const cancellation = deferred<void>()
    const cancel = vi.fn(() => cancellation.promise); const parse = vi.fn(() => json.promise)
    const signals: AbortSignal[] = []
    const lateResponse = { ok: true, json: parse, body: { cancel } } as unknown as Response
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init!.signal as AbortSignal)
      return phase === 'headers' ? headers.promise : lateResponse
    })
    let result: PromiseSettledResult<unknown>[] | undefined
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A', 'B', 'NEVER'], upstream, { deadlineMs: 500 })])
      .then((value) => { result = value; return value })
    await vi.advanceTimersByTimeAsync(499)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/deadline/i) }) }])
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    headers.resolve(lateResponse)
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledTimes(2)
    if (phase === 'headers') expect(parse).not.toHaveBeenCalled()
    cancellation.resolve(); json.resolve(book)
    await vi.runAllTimersAsync(); await outcome
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it.each(['headers', 'json'])('bounds the whole HTTP lifecycle at 10 seconds during %s', async (phase) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const headers = deferred<Response>(); const json = deferred<unknown>()
    const cancel = vi.fn(async () => {})
    const lateResponse = { ok: true, json: () => json.promise, body: { cancel } } as unknown as Response
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => phase === 'headers' ? headers.promise : lateResponse)
    let result: PromiseSettledResult<unknown>[] | undefined
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A', 'B', 'NEVER'], upstream)])
      .then((value) => { result = value })
    await vi.advanceTimersByTimeAsync(9999)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/timeout/i) }) }])
    expect(vi.getTimerCount()).toBe(0)
    headers.resolve(lateResponse); json.resolve(book)
    await vi.runAllTimersAsync(); await outcome
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('retries 429 at most four attempts after awaited cancellation, eventual success=%s', async (succeeds) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const cancellation = deferred<void>(); const starts: number[] = []
    const cancel = vi.fn(() => cancel.mock.calls.length === 1 ? cancellation.promise : Promise.resolve())
    const parseError = vi.fn()
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => {
      starts.push(performance.now())
      if (succeeds && starts.length === 4) return response()
      return { ok: false, status: 429, body: { cancel }, json: parseError } as unknown as Response
    })
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A'], upstream)])
    await vi.advanceTimersByTimeAsync(200)
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    cancellation.resolve()
    await vi.advanceTimersByTimeAsync(499)
    expect(upstream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(upstream).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    const result = await outcome
    expect(starts).toEqual([0, 700, 1700, 3200])
    expect(cancel).toHaveBeenCalledTimes(succeeds ? 3 : 4)
    expect(parseError).not.toHaveBeenCalled()
    if (succeeds) expect(result).toEqual([{ status: 'fulfilled', value: { books: { A: book }, observedAt: { A: expect.any(String) } } }])
    else expect(result).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/429/) }) }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans retry backoff immediately on slate deadline without dispatching another attempt', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 429, body: { cancel: async () => {} } } as unknown as Response)
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A'], upstream, { deadlineMs: 300 })])
    await vi.advanceTimersByTimeAsync(300)
    expect(await outcome).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/deadline/i) }) }])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it.each([0, -1, NaN, Infinity, 2 ** 31])('rejects invalid deadline %s before HTTP work', async (deadlineMs) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(response())
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A'], upstream, { deadlineMs })])
    await vi.runAllTimersAsync()
    expect(await outcome).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/deadline/i) }) }])
    expect(upstream).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the 180-second default even when all physical slots are held by ignored aborts', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const headers = deferred<Response>(); const caller = new AbortController()
    const blocked = vi.fn<typeof fetch>().mockImplementation(() => headers.promise)
    const original = Promise.allSettled([collectNbaMarketBooks(['A', 'B'], blocked, { signal: caller.signal })])
    await vi.advanceTimersByTimeAsync(120)
    caller.abort(); await original
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(response())
    let result: PromiseSettledResult<unknown>[] | undefined
    const waiting = Promise.allSettled([collectNbaMarketBooks(['WAITING'], upstream)]).then((value) => { result = value })
    await vi.advanceTimersByTimeAsync(179_999)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/deadline/i) }) }])
    expect(upstream).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    headers.resolve({ ok: true, body: { cancel: async () => {} }, json: vi.fn() } as unknown as Response)
    await vi.runAllTimersAsync(); await waiting
    expect(upstream).not.toHaveBeenCalled()
  })

  it('times out a stalled 429 body cancellation without freeing physical capacity or retrying', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const cancellation = deferred<void>()
    const cancel = vi.fn(() => cancellation.promise)
    const upstream = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 429, body: { cancel } } as unknown as Response)
    const outcome = Promise.allSettled([collectNbaMarketBooks(['A', 'B', 'NEVER'], upstream)])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await outcome).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/timeout/i) }) }])
    const healthyFetch = vi.fn<typeof fetch>().mockResolvedValue(response())
    const healthy = collectNbaMarketBooks(['NEXT'], healthyFetch)
    await vi.advanceTimersByTimeAsync(1000)
    expect(healthyFetch).not.toHaveBeenCalled()
    cancellation.resolve()
    await vi.runAllTimersAsync()
    expect((await healthy).books).toEqual({ NEXT: book })
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['network', 'json', 'shape'])('rejects the whole slate after %s failure despite a previously collected valid book', async (failure) => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const cancel = vi.fn(async () => {})
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockImplementationOnce(async () => {
      if (failure === 'network') throw new Error('network unavailable')
      return { ok: true, body: { cancel }, json: async () => {
        if (failure === 'json') throw new SyntaxError('bad JSON')
        return { orderbook_fp: {} }
      } } as unknown as Response
    })
    const outcome = Promise.allSettled([collectNbaMarketBooks(['GOOD', 'BAD', 'NEVER'], upstream)])
    await vi.runAllTimersAsync()
    expect(await outcome).toEqual([{ status: 'rejected', reason: expect.any(Error) }])
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledTimes(failure === 'json' ? 1 : 0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('collects every ML/spread/total ticker beyond the old four-line slice with per-book observation times', async () => {
    const { collectNbaMarketBooks } = await import('../../server/nba-market-books')
    const tickers = ['ML-HOME', 'ML-AWAY', ...Array.from({ length: 12 }, (_, i) => `SPREAD-${i}`),
      ...Array.from({ length: 12 }, (_, i) => `TOTAL-${i}`), 'ENCODE/THIS?']
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => response())
    const result = collectNbaMarketBooks(tickers, upstream)
    await vi.runAllTimersAsync()
    const collected = await result
    expect(Object.keys(collected.books)).toEqual(tickers)
    expect(Object.keys(collected.observedAt)).toEqual(tickers)
    expect(Object.values(collected.books)).toEqual(tickers.map(() => book))
    Object.values(collected.observedAt).forEach((at) => expect(new Date(at).toISOString()).toBe(at))
    expect(upstream.mock.calls.map(([url]) => url)).toEqual(tickers.map((ticker) =>
      `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook`))
    upstream.mock.calls.forEach(([, init]) => expect(init).toMatchObject({ method: 'GET' }))
  })
})
