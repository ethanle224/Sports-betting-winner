import { describe, expect, it } from 'vitest'
import { NBA_CHALLENGER_CONFIG } from '../../server/nba-challenger'
import { loadNbaChallengerSnapshot } from '../../server/nba-challenger-snapshot'

const hash = '8f7de95263d27fe457517887f8d9bbc1f3f6aae4b013349494007af61ba1a95c'
const calibration = { trainingSeason: 2025, baselineTrainingSeason: 2024, sampleSize: 1230,
  marginSd: 14.35181327481345, asOf: '2025-04-13T19:30:00Z' }
const artifact = () => ({ schema: 'nba-challenger-calibration-v3', snapshotSha256: hash,
  config: NBA_CHALLENGER_CONFIG, calibration: { ...calibration } })

describe('offline challenger uncertainty artifact', () => {
  it('loads the verified fixed calibration without recomputing a historical season during a request', () => {
    expect(loadNbaChallengerSnapshot(artifact(), hash)).toEqual(calibration)
  })
  it('fails closed on stale score or model configuration identity', () => {
    expect(loadNbaChallengerSnapshot(artifact(), '0'.repeat(64))).toBeNull()
    expect(loadNbaChallengerSnapshot({ ...artifact(), config: { ...NBA_CHALLENGER_CONFIG, ridge: 1 } }, hash)).toBeNull()
    expect(loadNbaChallengerSnapshot({ ...artifact(), schema: 'other' }, hash)).toBeNull()
  })
  it('rejects unknown, malformed or incomplete calibration data', () => {
    for (const value of [null, {}, [], { ...artifact(), calibration: null }]) expect(loadNbaChallengerSnapshot(value, hash)).toBeNull()
    for (const changed of [{ sampleSize: 99 }, { sampleSize: NaN }, { marginSd: 0 }, { marginSd: Infinity },
      { trainingSeason: 2026 }, { baselineTrainingSeason: 2025 }, { asOf: '2026-04-01T00:00:00Z' }, { asOf: 'bad' }]) {
      expect(loadNbaChallengerSnapshot({ ...artifact(), calibration: { ...calibration, ...changed } }, hash)).toBeNull()
    }
  })
})
