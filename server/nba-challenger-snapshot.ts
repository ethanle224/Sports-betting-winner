import { NBA_CHALLENGER_CONFIG, type NbaChallengerCalibration } from './nba-challenger.js'

type Uncertainty = Omit<NbaChallengerCalibration, 'residuals'>
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

// Calibration is built offline by evaluate:nba, never re-fitted during a public scan.
// A different model recipe or bundled score archive disables this research control.
export function loadNbaChallengerSnapshot(value: unknown, snapshotSha256: string): Uncertainty | null {
  if (!object(value) || value.schema !== 'nba-challenger-calibration-v3' ||
    !/^[a-f0-9]{64}$/.test(snapshotSha256) || value.snapshotSha256 !== snapshotSha256 ||
    !object(value.config) || !object(value.calibration)) return null
  const config = value.config
  if (Object.entries(NBA_CHALLENGER_CONFIG).some(([key, expected]) =>
    JSON.stringify(config[key]) !== JSON.stringify(expected))) return null
  const cal = value.calibration
  if (cal.trainingSeason !== 2025 || cal.baselineTrainingSeason !== 2024 || cal.sampleSize !== 1230 ||
    typeof cal.marginSd !== 'number' || !Number.isFinite(cal.marginSd) || cal.marginSd <= 0 ||
    typeof cal.asOf !== 'string' || !Number.isFinite(Date.parse(cal.asOf)) ||
    Date.parse(cal.asOf) < Date.UTC(2024, 7, 1) || Date.parse(cal.asOf) >= Date.UTC(2025, 7, 1)) return null
  return { trainingSeason: cal.trainingSeason, baselineTrainingSeason: cal.baselineTrainingSeason,
    sampleSize: cal.sampleSize, marginSd: cal.marginSd, asOf: cal.asOf }
}
