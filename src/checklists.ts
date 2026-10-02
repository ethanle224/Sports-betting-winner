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
  const time = Date.parse(candidate.observedAt)
  if (!candidate.matchup.trim() || !candidate.contract.trim() || !candidate.side.trim()) common.push('Matchup, exact contract and side are required')
  if (!Number.isFinite(time) || time > now || now - time > 30 * 60_000) common.push('Snapshot is stale or in the future')
  if (!candidate.rulesChecked) common.push('Contract and settlement rules not checked')
  if (!candidate.newsChecked) common.push('Lineups, injuries and news not checked')
  if (!candidate.depthChecked) common.push('Executable depth and fees not checked')
  if (!validProbability(cost)) common.push('All-in cost must be between $0 and $1')
  if (!validProbability(model)) common.push('Model probability must be between 0% and 100%')
  if (validProbability(cost) && 1 / cost < 1.7) common.push('Winning payout is below 1.7× all-in cost')

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
