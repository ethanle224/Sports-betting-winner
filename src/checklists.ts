export type PaperCandidate = {
  matchup: string
  contract: string
  side: string
  observedAt: string
  allInCost: number
  modelProbability: number
  consensusProbability: number | null
  consensusSource: string
  crowdMoneyPercent: number | null
  crowdSource: string
  rulesChecked: boolean
  newsChecked: boolean
  depthChecked: boolean
  units?: number
  highConfidence?: boolean
  confidenceRationale?: string
  modelSource?: string
  modelObservedAt?: string
}

export const PAPER_BANKROLL = 1000
export const UNIT_DOLLARS = 25

export function paperSize(units: number, allInCost: number) {
  const target = Math.round(units * UNIT_DOLLARS * 100) / 100
  const contracts = Number.isFinite(target) && target > 0 && Number.isFinite(allInCost) && allInCost > 0
    ? Math.floor((target + 1e-9) / allInCost) : 0
  return { contracts, exposure: Math.round(contracts * allInCost * 10000) / 10000, target }
}

export type StrategyId = 'value' | 'consensus' | 'crowd'
export type Assessment = {
  id: StrategyId
  name: string
  status: 'PAPER' | 'REJECT'
  reasons: string[]
  payoutMultiple: number | null
}

export const STRATEGIES: { id: StrategyId; name: string; rule: string }[] = [
  { id: 'value', name: 'A · Value baseline', rule: 'Model probability ≥ all-in cost + 5 percentage points.' },
  { id: 'consensus', name: 'B · Independent consensus', rule: 'Model ≥ cost + 4pp AND independently sourced consensus ≥ cost + 6pp.' },
  { id: 'crowd', name: 'C · Crowd caution', rule: 'Value baseline AND sourced dollar share on our exact side ≤ 65%. Never auto-fade.' },
]

const validProbability = (value: number) => Number.isFinite(value) && value > 0 && value < 1

export function evaluate(candidate: PaperCandidate, now = Date.now()): Assessment[] {
  const common: string[] = []
  const { allInCost: cost, modelProbability: model } = candidate
  const units = candidate.units ?? 1
  const time = Date.parse(candidate.observedAt)
  if (!candidate.matchup.trim() || !candidate.contract.trim() || !candidate.side.trim()) common.push('Matchup, exact contract and side are required')
  if (!Number.isFinite(time) || time > now || now - time > 30 * 60_000) common.push('Snapshot is stale or in the future')
  if (!candidate.rulesChecked) common.push('Contract and settlement rules not checked')
  if (!candidate.newsChecked) common.push('Lineups, injuries and news not checked')
  if (!candidate.depthChecked) common.push('Executable depth and fees not checked')
  if (!validProbability(cost)) common.push('All-in cost must be between $0 and $1')
  if (!validProbability(model)) common.push('Model probability must be between 0% and 100%')
  if (candidate.units !== undefined) {
    const source = candidate.modelSource?.trim()
    const modelTime = Date.parse(candidate.modelObservedAt ?? '')
    if (!source || !Number.isFinite(modelTime)) common.push('Independent model source and calculation time required')
    else {
      if (/kalshi/i.test(source)) common.push('Kalshi market price is not independent model evidence')
      if (modelTime > now || now - modelTime > 24 * 60 * 60_000) common.push('Model evidence is stale or in the future')
    }
  }
  if (!Number.isFinite(units) || units < 0 || units > 2 || Math.abs(units * 100 - Math.round(units * 100)) > 1e-8) common.push('Units must be 0.00–2.00 in 0.01 increments')
  else if (units === 0) common.push('Zero units means no paper bet')
  else if (validProbability(cost) && paperSize(units, cost).contracts === 0) common.push('Unit allocation cannot buy one whole contract')
  if (units === 2 && (!candidate.highConfidence || !candidate.confidenceRationale?.trim())) common.push('2-unit play needs a documented high-confidence case')
  const minimumPayout = units === 2 && candidate.highConfidence && candidate.confidenceRationale?.trim() ? 1.65 : 1.7
  if (validProbability(cost) && 1 / cost + 1e-9 < minimumPayout) common.push(`Winning payout is below ${minimumPayout.toFixed(2).replace(/0$/, '')}× all-in cost`)

  return STRATEGIES.map(({ id, name }) => {
    const reasons = [...common]
    if (validProbability(cost) && validProbability(model)) {
      if (id !== 'consensus' && model - cost < 0.05 - 1e-9) reasons.push('Model edge is below 5 percentage points')
      if (id === 'consensus' && model - cost < 0.04 - 1e-9) reasons.push('Model edge is below 4 percentage points')
    }
    if (id === 'consensus') {
      if (candidate.consensusProbability === null || !validProbability(candidate.consensusProbability) || !candidate.consensusSource.trim()) {
        reasons.push('Independent probability and source required')
      } else if (validProbability(cost) && candidate.consensusProbability - cost < 0.06 - 1e-9) {
        reasons.push('Independent consensus edge is below 6 percentage points')
      }
    }
    if (id === 'crowd') {
      if (candidate.crowdMoneyPercent === null || !Number.isFinite(candidate.crowdMoneyPercent) || candidate.crowdMoneyPercent < 0 || candidate.crowdMoneyPercent > 100 || !candidate.crowdSource.trim()) {
        reasons.push('Sourced dollar split for the exact side required')
      } else if (candidate.crowdMoneyPercent > 65) {
        reasons.push('Our side exceeds 65% of sourced dollar share')
      }
    }
    return { id, name, status: reasons.length === 0 ? 'PAPER' : 'REJECT', reasons, payoutMultiple: validProbability(cost) ? 1 / cost : null }
  })
}
