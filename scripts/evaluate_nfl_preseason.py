"""Read-only diagnostic: preseason score margin vs later spread-adjusted team margin.

Uses full-season outcomes, so this is NOT a decision-time predictive backtest.
The 2026 value changes as more games finish. No input to live probabilities.
"""

import collections
import csv
import io
import json
import math
import statistics
from urllib.parse import urlencode
from urllib.request import urlopen

SCORES = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
ALIASES = {'WSH': 'WAS', 'LAR': 'LA', 'JAC': 'JAX'}


def fetch(url):
    with urlopen(url, timeout=20) as response:
        return response.read().decode('utf-8')


def evaluate(rows, events, season):
    preseason = collections.defaultdict(list)
    seen = set()
    for event in events:
        if event['id'] in seen or not event['status']['type']['completed'] or event['season']['type'] != 1 or event['season']['year'] != season:
            continue
        seen.add(event['id'])
        teams = {team['homeAway']: team for team in event['competitions'][0]['competitors']}
        for side, opposite in (('home', 'away'), ('away', 'home')):
            team = teams[side]['team']['abbreviation']
            preseason[ALIASES.get(team, team)].append(int(teams[side]['score']) - int(teams[opposite]['score']))
    residuals = collections.defaultdict(list)
    for row in rows:
        if row['season'] != str(season) or row['game_type'] != 'REG' or not row['home_score'] or not row['away_score'] or not row['spread_line']:
            continue
        home_expected = float(row['spread_line'])  # nflverse uses positive home expected margin.
        actual = int(row['home_score']) - int(row['away_score'])
        residuals[row['home_team']].append(actual - home_expected)
        residuals[row['away_team']].append(home_expected - actual)
    shared = sorted(set(preseason) & set(residuals))
    x = [statistics.mean(preseason[team]) for team in shared]
    y = [statistics.mean(residuals[team]) for team in shared]
    if len(shared) < 3:
        raise ValueError('Too few teams for a meaningful diagnostic')
    mx, my = statistics.mean(x), statistics.mean(y)
    covariance = sum((a - mx) * (b - my) for a, b in zip(x, y))
    varx = sum((a - mx) ** 2 for a in x)
    vary = sum((b - my) ** 2 for b in y)
    return len(seen), len(shared), covariance / math.sqrt(varx * vary)


if __name__ == '__main__':
    rows = list(csv.DictReader(io.StringIO(fetch(SCORES))))
    for season in (2024, 2025, 2026):
        events = []
        for week in (1, 2, 3, 4):
            params = urlencode({'dates': season, 'seasontype': 1, 'week': week, 'limit': 100})
            events.extend(json.loads(fetch(f'{SCOREBOARD}?{params}'))['events'])
        games, teams, correlation = evaluate(rows, events, season)
        print(f'{season}: preseason_games={games} teams={teams} correlation_to_regular_market_residual={correlation:.3f}')
