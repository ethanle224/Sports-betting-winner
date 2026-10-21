import { describe, expect, it, vi } from 'vitest'
import { loadNbaCloudLedger, saveNbaCloudRecord } from './nba-cloud-ledger'
import { NBA_FREEZE_KEY, type NbaFreeze } from './nba-paper'

const freeze = { id: '2026-10-20T00:00:00Z:game1', frozenAt: '2026-10-20T00:00:01Z', scan: { date: '2026-10-20', games: [{ gameId: 'game1' }] }, decisions: [{ gameId: 'game1', selected: { ticker: 'KXNBAGAME-26OCT20BOSDET-BOS' }, evidence: { requestedPaper: true } }] } as NbaFreeze
const ok = (value: unknown) => ({ ok: true, json: async () => value }) as Response

describe('cloud NBA ledger and legacy migration', () => {
  it('does not touch quota-exhausted localStorage when appending daily picks', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    const fetcher = vi.fn().mockResolvedValue(ok({ record: freeze }))
    await expect(saveNbaCloudRecord('freeze', freeze, fetcher)).resolves.toEqual(freeze)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
    expect(fetcher).toHaveBeenCalledWith('/api/nba-ledger', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
  })
  it('imports each legacy freeze and confirms the cloud readback without deleting or rewriting the original', async () => {
    const old = JSON.stringify([freeze]); const data = new Map([[NBA_FREEZE_KEY, old]])
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') } }
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ freezes: [], reviews: [], audits: [] }))
      .mockResolvedValueOnce(ok({ record: freeze })).mockResolvedValueOnce(ok({ freezes: [freeze], reviews: [], audits: [] }))
    const ledger = await loadNbaCloudLedger(fetcher, storage)
    expect(ledger.freezes).toEqual([freeze])
    expect(storage.getItem(NBA_FREEZE_KEY)).toBe(old)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('keeps legacy records untouched and fails visibly when cloud storage rejects a write', async () => {
    const old = JSON.stringify([freeze]); const storage = { getItem: (key: string) => key === NBA_FREEZE_KEY ? old : null, setItem: () => { throw Error('must not write') } }
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ freezes: [], reviews: [], audits: [] })).mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(loadNbaCloudLedger(fetcher, storage)).rejects.toThrow(/legacy.*export|migration/i)
    expect(storage.getItem(NBA_FREEZE_KEY)).toBe(old)
  })
  it('detects an ID conflict rather than overwriting the historical decision', async () => {
    const storage = { getItem: (key: string) => key === NBA_FREEZE_KEY ? JSON.stringify([freeze]) : null, setItem: () => {} }
    const fetcher = vi.fn().mockResolvedValue(ok({ freezes: [{ ...freeze, frozenAt: 'altered' }], reviews: [], audits: [] }))
    await expect(loadNbaCloudLedger(fetcher, storage)).rejects.toThrow(/conflict/i)
  })
})
