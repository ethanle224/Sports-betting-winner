// Selected, source-backed 2026 offseason examples checked on 2026-10-05.
// Not a complete transaction log, an injury feed, or a current-roster guarantee.
export const offseasonExamples = [
  { date: '2026-07-06', teams: ['MIA', 'MIL'], move: 'Giannis Antetokounmpo and Bobby Portis to Miami; Tyler Herro, Jaime Jaquez Jr., Kel’el Ware and Kasparas Jakučionis to Milwaukee',
    sourceLabel: 'Heat–Bucks trade source', source: 'https://www.nba.com/news/reports-heat-acquire-giannis-antetokounmpo-in-blockbuster-deal' },
  { date: '2026-07-06', teams: ['PHI', 'BOS'], move: 'Jaylen Brown to Philadelphia; Paul George to Boston',
    sourceLabel: 'Brown ↔ George trade source', source: 'https://www.nba.com/news/reports-sixers-to-acquire-jaylen-brown-from-celtics' },
  { date: '2026-07-10', teams: ['MIN', 'CHA', 'BKN', 'CHI'], move: 'LaMelo Ball to Minnesota; Naz Reid to Charlotte, Julius Randle to Brooklyn and Nic Claxton to Chicago (four-team deal)',
    sourceLabel: 'Four-team trade source', source: 'https://www.nba.com/news/lamelo-ball-trade-timberwolves-2026' },
  { date: '2026-07-08', teams: ['LAL', 'UTA'], move: 'Walker Kessler to the Lakers from Utah',
    sourceLabel: 'Kessler trade source', source: 'https://www.nba.com/news/walker-kessler-trade-los-angeles-lakers' },
  { date: '2026-07-06', teams: ['BOS', 'MIN'], move: 'Mike Conley signs with Boston after Minnesota',
    sourceLabel: 'Conley signing source', source: 'https://www.nba.com/news/mike-conley-free-agency-2026' },
  { date: '2026-07-01', teams: ['ORL', 'BOS'], move: 'Nikola Vučević signs with Orlando after Boston',
    sourceLabel: 'Vučević signing source', source: 'https://www.nba.com/news/nikola-vucevic-returning-to-magic-on-1-year-deal' },
] as const
