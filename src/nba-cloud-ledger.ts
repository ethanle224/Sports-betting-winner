import { NBA_FREEZE_KEY, NBA_REVIEW_KEY, readNbaFreezes, readNbaReviews, type NbaFreeze, type NbaReview } from './nba-paper'
import { NBA_AUDIT_KEY, readNbaAudits, type NbaAuditReport } from './nba-audit'

export type NbaCloudLedger = { freezes: NbaFreeze[]; reviews: NbaReview[]; audits: NbaAuditReport[] }
export type NbaCloudKind = 'freeze' | 'review' | 'audit'
type LegacyStorage = Pick<Storage, 'getItem' | 'setItem'>
type Fetcher = typeof fetch
const keys: { kind: NbaCloudKind; key: string; field: keyof NbaCloudLedger }[] = [
  { kind: 'freeze', key: NBA_FREEZE_KEY, field: 'freezes' },
  { kind: 'review', key: NBA_REVIEW_KEY, field: 'reviews' },
  { kind: 'audit', key: NBA_AUDIT_KEY, field: 'audits' },
]
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((item, index) => same(item, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>; const right = b as Record<string, unknown>
  return Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
}

async function fetchCloud(fetcher: Fetcher): Promise<NbaCloudLedger> {
  const response = await fetcher('/api/nba-ledger', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(`NBA cloud ledger unavailable (HTTP ${response.status}); no paper records were changed`)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' ||
    !['freezes', 'reviews', 'audits'].every((name) => Array.isArray((value as Record<string, unknown>)[name]))) {
    throw new Error('NBA cloud ledger returned incomplete data; no paper records were changed')
  }
  return value as NbaCloudLedger
}

export async function saveNbaCloudRecord<T extends NbaFreeze | NbaReview | NbaAuditReport>(kind: NbaCloudKind, record: T,
  fetcher: Fetcher = fetch): Promise<T> {
  const response = await fetcher('/api/nba-ledger', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, record }) })
  if (!response.ok) throw new Error(`NBA cloud ${kind} not saved (HTTP ${response.status}); do not assume this pick is tracked`)
  const result: { record?: T } = await response.json()
  if (!result.record || !same(result.record, record)) throw new Error(`NBA cloud ${kind} readback differed; inspect before retrying`)
  return result.record
}

export async function loadNbaCloudLedger(fetcher: Fetcher = fetch, storage: LegacyStorage = localStorage): Promise<NbaCloudLedger> {
  let cloud = await fetchCloud(fetcher)
  const legacy = { freezes: readNbaFreezes(storage), reviews: readNbaReviews(storage), audits: readNbaAudits(storage) }
  let migrated = false
  for (const { kind, field } of keys) {
    for (const item of legacy[field]) {
      const existing = cloud[field].find((saved) => saved.id === item.id)
      if (existing && !same(existing, item)) throw new Error(`NBA legacy ${kind} ID conflict; export both ledgers and resolve manually`)
      if (existing) continue
      try { await saveNbaCloudRecord(kind, item, fetcher); migrated = true }
      catch { throw new Error(`NBA legacy ${kind} migration failed; original browser records are intact. Export the NBA audit JSON before clearing site data`) }
    }
  }
  if (migrated) cloud = await fetchCloud(fetcher)
  for (const { kind, field } of keys) {
    for (const item of legacy[field]) {
      if (!cloud[field].some((saved) => saved.id === item.id && same(saved, item))) {
        throw new Error(`NBA legacy ${kind} cloud readback incomplete; keep the original browser data and export a backup`)
      }
    }
  }
  return cloud
}

// Reuse the existing synchronous decision/settlement validators against a disposable,
// in-memory view of authenticated cloud state. No localStorage writes occur.
export function cloudValidationStorage(ledger: NbaCloudLedger): LegacyStorage {
  const values = new Map<string, string>([[NBA_FREEZE_KEY, JSON.stringify(ledger.freezes)],
    [NBA_REVIEW_KEY, JSON.stringify(ledger.reviews)], [NBA_AUDIT_KEY, JSON.stringify(ledger.audits)]])
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}
