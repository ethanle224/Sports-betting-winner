import { NBA_KALSHI_BASE, isNbaBook, type NbaBook } from './nba-kalshi.js'

// One process-wide scheduler, including callers collecting different slates.
type Queued = { signal: AbortSignal; run: () => Promise<void>; reject: (error: unknown) => void }
const queue: Queued[] = []
let active = 0; let lastStart = -Infinity
let pacingTimer: ReturnType<typeof setTimeout> | undefined
function pump() {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].signal.aborted) {
      const [canceled] = queue.splice(i, 1)
      canceled.reject(canceled.signal.reason)
    }
  }
  if (!queue.length && pacingTimer !== undefined) { clearTimeout(pacingTimer); pacingTimer = undefined }
  if (pacingTimer !== undefined || active >= 2 || !queue.length) return
  const now = performance.now()
  // Monotonic clocks cannot rewind in production, but test/runtime clock swaps
  // can change their origin. Old-origin pacing debt must not stall new slates.
  if (now < lastStart) lastStart = now - 120
  const wait = lastStart + 120 - now
  if (wait > 0) {
    pacingTimer = setTimeout(() => { pacingTimer = undefined; pump() }, wait)
    return
  }
  const job = queue.shift()!
  active++; lastStart = performance.now()
  void job.run().finally(() => { active--; pump() })
  pump()
}
function schedule<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ signal, reject, run: async () => { try { resolve(await run()) } catch (error) { reject(error) } } })
    pump()
  })
}

function backoff(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Collect every requested book or reject: incomplete slates are never evidence. */
export async function collectNbaMarketBooks(tickers: readonly string[], fetcher: typeof fetch = fetch,
  options?: { signal?: AbortSignal; deadlineMs?: number }): Promise<{ books: Record<string, NbaBook>; observedAt: Record<string, string> }> {
  if (tickers.some((ticker) => typeof ticker !== 'string' || !ticker.trim()) || new Set(tickers).size !== tickers.length) {
    throw new Error('Duplicate or empty Kalshi ticker')
  }
  const deadlineMs = options?.deadlineMs ?? 180_000
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 2 ** 31 - 1) {
    throw new Error('Invalid Kalshi slate deadline')
  }
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(deadlineTimer)
      options?.signal?.removeEventListener('abort', callerAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
      controller.abort(error)
      pump()
    }
    const callerAbort = () => fail(options?.signal?.reason ?? new Error('Kalshi slate aborted'))
    const deadlineTimer = setTimeout(() => fail(new Error('Kalshi slate deadline exceeded')), deadlineMs)
    options?.signal?.addEventListener('abort', callerAbort, { once: true })
    if (options?.signal?.aborted) { callerAbort(); return }
    const entries = tickers.map(async (ticker) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const item = await schedule(controller.signal, async () => {
          let response: Response | undefined; let consumed = false; let cancellation: Promise<void> | undefined
          const requestTimer = setTimeout(() => fail(new Error(`Kalshi ${ticker} orderbook HTTP lifecycle timeout`)), 10_000)
          const cancelBody = () => {
            if (response && !consumed) {
              cancellation ??= Promise.resolve().then(() => response!.body?.cancel()).then(() => {})
              void cancellation.catch(() => {})
            }
          }
          const onAbort = () => { clearTimeout(requestTimer); cancelBody() }
          controller.signal.addEventListener('abort', onAbort, { once: true })
          try {
            response = await fetcher(`${NBA_KALSHI_BASE}/markets/${encodeURIComponent(ticker)}/orderbook`, { method: 'GET', signal: controller.signal })
            if (controller.signal.aborted) throw controller.signal.reason
            if (response.status === 429 && attempt < 3) {
              cancelBody()
              await cancellation
              if (controller.signal.aborted) throw controller.signal.reason
              return undefined
            }
            if (!response.ok) throw new Error(`Kalshi ${ticker} orderbook HTTP ${response.status}`)
            const value: unknown = await response.json()
            consumed = true
            if (controller.signal.aborted) throw controller.signal.reason
            if (!isNbaBook(value)) throw new Error(`Malformed Kalshi ${ticker} orderbook`)
            return { ticker, book: value, observedAt: new Date().toISOString() }
          } catch (error) {
            fail(error)
            cancelBody()
            throw error
          } finally {
            if (cancellation) await cancellation.catch(() => {})
            clearTimeout(requestTimer)
            controller.signal.removeEventListener('abort', onAbort)
          }
        })
        if (item) return item
        await backoff(Math.min(500 * 2 ** attempt, 1500), controller.signal)
      }
      throw new Error(`Kalshi ${ticker} orderbook retry budget exhausted`)
    })
    void Promise.all(entries).then((items) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        books: Object.fromEntries(items.map((item) => [item.ticker, item.book])),
        observedAt: Object.fromEntries(items.map((item) => [item.ticker, item.observedAt])),
      })
    }, fail)
  })
}
