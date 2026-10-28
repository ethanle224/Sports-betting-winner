import pg from 'pg'
// Keep this NodeNext server module independent of the browser-only paper modules.
export type LedgerKind = 'freeze' | 'review' | 'audit'
export type LedgerRecord = Record<string, unknown>
// Existing browser snapshots can be substantially larger than a compact new pick.
// Stay below the serverless request cap while allowing lossless legacy migration.
const MAX_RECORD_BYTES = 4 * 1024 * 1024
let pool: pg.Pool | undefined

function database(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('Ledger database unavailable')
  return pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true }, max: 3 })
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS nba_paper_ledger (
  owner text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('freeze', 'review', 'audit')),
  id text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, kind, id)
)`
let initialized = false
let initializing: Promise<void> | undefined
async function ready(): Promise<pg.Pool> {
  const client = database()
  if (!initialized) {
    initializing ??= client.query(CREATE_TABLE).then(() => { initialized = true }).finally(() => { initializing = undefined })
    await initializing
  }
  return client
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateRecord(kind: unknown, record: unknown): { kind: LedgerKind; id: string; json: string } | null {
  if (kind !== 'freeze' && kind !== 'review' && kind !== 'audit') return null
  if (!object(record) || typeof record.id !== 'string' || !record.id.trim() || record.id.length > 256 ||
    record.id.split('').some((character) => character.charCodeAt(0) < 32)) return null
  if (kind === 'freeze' && (typeof record.frozenAt !== 'string' || !object(record.scan) ||
    !Array.isArray(record.scan.games) || !Array.isArray(record.decisions) ||
    record.decisions.length < 1 || record.decisions.length > 15 || record.decisions.length !== record.scan.games.length)) return null
  if (kind === 'review' && (record.label !== 'SIMULATED_NO_FILL' || typeof record.scanId !== 'string' ||
    typeof record.gameId !== 'string' || typeof record.payout !== 'number' || !Number.isFinite(record.payout) ||
    record.payout < 0 || record.payout > 1)) return null
  if (kind === 'audit' && (record.classification !== 'CAUSE_UNDETERMINED' ||
    typeof record.scanId !== 'string' || typeof record.gameId !== 'string' ||
    !Array.isArray(record.recommendations))) return null
  try {
    const json = JSON.stringify(record)
    if (!json || Buffer.byteLength(json, 'utf8') > MAX_RECORD_BYTES) return null
    return { kind, id: record.id, json }
  } catch { return null }
}

export async function listNbaLedger(owner: string): Promise<{ freezes: LedgerRecord[]; reviews: LedgerRecord[]; audits: LedgerRecord[] }> {
  const client = await ready()
  const { rows } = await client.query<{ kind: LedgerKind; record: LedgerRecord }>(
    'SELECT kind, record FROM nba_paper_ledger WHERE owner = $1 ORDER BY created_at ASC, kind ASC, id ASC', [owner])
  const result = { freezes: [] as LedgerRecord[], reviews: [] as LedgerRecord[], audits: [] as LedgerRecord[] }
  for (const row of rows) {
    if (row.kind === 'freeze') result.freezes.push(row.record)
    if (row.kind === 'review') result.reviews.push(row.record)
    if (row.kind === 'audit') result.audits.push(row.record)
  }
  return result
}

// The UNIQUE primary key arbitrates concurrent writers; never UPDATE an existing decision.
export async function appendNbaLedger(owner: string, input: { kind: LedgerKind; id: string; json: string }):
  Promise<{ status: 'created' | 'identical' | 'conflict'; record?: LedgerRecord }> {
  const client = await ready()
  const inserted = await client.query<{ record: LedgerRecord }>(
    'INSERT INTO nba_paper_ledger (owner, kind, id, record) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (owner, kind, id) DO NOTHING RETURNING record',
    [owner, input.kind, input.id, input.json])
  if (inserted.rowCount) return { status: 'created', record: inserted.rows[0].record }
  const existing = await client.query<{ record: LedgerRecord }>(
    'SELECT record FROM nba_paper_ledger WHERE owner = $1 AND kind = $2 AND id = $3',
    [owner, input.kind, input.id])
  if (!existing.rows[0]) throw new Error('Ledger conflict unavailable')
  return equalJson(existing.rows[0].record, JSON.parse(input.json))
    ? { status: 'identical', record: existing.rows[0].record }
    : { status: 'conflict' }
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => equalJson(value, right[index]))
  if (!object(left) || !object(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && equalJson(left[key], right[key]))
}
