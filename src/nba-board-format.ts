export const signedUnits = (units: number) => `${units > 0 ? '+' : units < 0 ? '−' : ''}${Math.abs(units).toFixed(2)}u`
