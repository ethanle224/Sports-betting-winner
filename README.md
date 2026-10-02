# Edgeboard — Kalshi Sports Research

A paper-only dashboard for Kalshi sports-market research across basketball, football, and tennis.

> **Prototype data notice:** The deployed UI currently contains clearly labeled fixture data. It does not connect to Kalshi, place orders, access a brokerage account, or make profitability claims.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Planned integration

The research collector and paper-trading ledger live in a separate local Python workstream. Before live data is displayed, it will be filtered through timestamping, contract-rule checks, execution-cost estimates, risk controls, and a documented paper-trading gate.
