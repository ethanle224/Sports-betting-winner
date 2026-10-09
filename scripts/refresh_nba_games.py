"""Refresh a compact, sourced NBA regular-season final-score snapshot.

Read-only ESPN-derived SportsDataverse releases; no live market/order APIs.
"""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2026&seasontype=2'
SCHEDULE_URL = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules/nba_schedule_{season}.csv'
OUTPUT = Path(__file__).resolve().parents[1] / 'server' / 'data' / 'nba-games.json'


def parse_time(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('NBA tip time lacks timezone')
    return dt.astimezone(timezone.utc)


def normalize_games(rows, valid_teams, season, cutoff):
    cutoff_dt = parse_time(cutoff)
    games = []
    ids = set()
    for row in rows:
        if row['season'] != str(season) or row['season_type'] != '2' or row['status_type_completed'].lower() != 'true':
            continue
        if row['notes_headline'] in ('NBA Cup Championship', 'NBA In-Season Tournament Championship'):
            continue  # The cup final does not count toward the 82-game regular-season record.
        if row['home_id'] not in valid_teams or row['away_id'] not in valid_teams:
            continue  # The ESPN feed mislabels All-Star exhibitions as regular season.
        tip = parse_time(row['date'])
        if tip >= cutoff_dt:
            continue
        identifier = row['game_id']
        if identifier in ids:
            raise ValueError('duplicate NBA game ID')
        ids.add(identifier)
        if not identifier or row['home_id'] == row['away_id']:
            raise ValueError('invalid NBA game identity')
        try:
            home_score = int(row['home_score'])
            away_score = int(row['away_score'])
        except (ValueError, TypeError) as error:
            raise ValueError('invalid NBA score') from error
        if home_score < 0 or away_score < 0:
            raise ValueError('negative NBA score')
        games.append({'id': identifier, 'season': season, 'tip': tip.isoformat(timespec='seconds').replace('+00:00', 'Z'),
                      'home': row['home_id'], 'away': row['away_id'], 'homeScore': home_score,
                      'awayScore': away_score, 'neutral': row['neutral_site'].lower() == 'true'})
    return sorted(games, key=lambda game: (game['tip'], game['id']))


def download(url):
    request = Request(url, headers={'User-Agent': 'Edgeboard-NBA-paper-research/1.0'})
    with urlopen(request, timeout=40) as response:
        return response.read()


def main():
    observed_at = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    standings_raw = download(STANDINGS_URL)
    standings = json.loads(standings_raw)
    if standings.get('season', {}).get('displayName') != '2025-26':
        raise ValueError('Unexpected standings season')
    valid_teams = {entry['team']['id'] for child in standings['children'] for entry in child['standings']['entries']}
    if len(valid_teams) != 30:
        raise ValueError('Incomplete NBA team identifiers')
    all_games = []
    sources = [{'url': STANDINGS_URL, 'sha256': hashlib.sha256(standings_raw).hexdigest()}]
    for season in (2024, 2025, 2026):
        url = SCHEDULE_URL.format(season=season)
        raw = download(url)
        rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
        games = normalize_games(rows, valid_teams, season, observed_at)
        if len(games) != 1230 or len({game['id'] for game in games}) != 1230:
            raise ValueError(f'{season}: expected 1230 distinct completed regular-season games, got {len(games)}')
        all_games.extend(games)
        sources.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
        print(f'{season}: {len(games)} regular-season games')
    output = {'version': 'nba-score-history-v1', 'observedAt': observed_at,
              'sources': sources, 'games': all_games}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Wrote {len(all_games)} unique verified scores to {OUTPUT}')


if __name__ == '__main__':
    main()
