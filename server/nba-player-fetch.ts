export function createNbaPlayerFetcher(upstream: typeof fetch = fetch): typeof fetch {
  const queues = [Promise.resolve(), Promise.resolve()]
  let nextSlot = 0
  return (input, init) => {
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason)
    const slot = nextSlot++ % queues.length
    const task = queues[slot].then(async () => {
      init?.signal?.throwIfAborted()
      const controller = new AbortController()
      const abort = () => controller.abort(init?.signal?.reason)
      init?.signal?.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(new DOMException('Player fetch timed out', 'TimeoutError')), 10000)
      try {
        const response = await upstream(input, { ...init, signal: controller.signal })
        if (controller.signal.aborted || !response.ok) {
          // Keep the physical slot until even error/late bodies finish cancellation.
          // Never parse or buffer arbitrary upstream error content.
          try { await response.body?.cancel(controller.signal.reason) }
          finally { controller.signal.throwIfAborted() }
          return response
        }
        const body: unknown = await response.json()
        controller.signal.throwIfAborted()
        return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: response.headers })
      } finally {
        clearTimeout(timeout)
        init?.signal?.removeEventListener('abort', abort)
      }
    })
    queues[slot] = task.then(() => {}, () => {})
    return task
  }
}
