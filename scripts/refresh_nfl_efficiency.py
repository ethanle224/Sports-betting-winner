"""Build a compact, auditable NFL play-by-play feature snapshot. Run: python scripts/refresh_nfl_efficiency.py"""

import csv
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.request
from datetime import datetime, timezone

YEARS = (2023, 2024, 2025, 2026)
SOURCE = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{}.csv.gz'
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'api' / 'data' / 'nfl-efficiency.json'
CACHE = Path(os.getenv('LOCALAPPDATA', '/tmp')) / 'Temp' / 'edgeboard-nfl-pbp'


def aggregate(rows):
    groups = {}
    for row in rows:
        day = row.get('game_date', '')
        team = row.get('posteam', '')
        home, away = row.get('home_team', ''), row.get('away_team', '')
        if (row.get('season_type') != 'REG' or row.get('play_type') not in ('run', 'pass')
                or row.get('qb_spike') == '1' or row.get('qb_kneel') == '1'
                or not day or team not in (home, away) or not team
                or row.get('defteam') != (away if team == home else home)
                or not row.get('game_id') or not row.get('drive')):
            continue
        try:
            epa = float(row.get('epa', ''))
            success = int(row.get('success', ''))
            first = int(row.get('first_down', ''))
        except (ValueError, TypeError):
            continue
        if not math.isfinite(epa) or success not in (0, 1) or first not in (0, 1):
            continue
        key = (row['game_id'], team)
        if key not in groups:
            groups[key] = dict(gameId=row['game_id'], date=day, team=team,
                               opponent=row['defteam'], plays=0, epaSum=0.0,
                               successes=0, firstDowns=0, drives=0, _drive_ids=set())
        game = groups[key]
        if game['date'] != day or game['opponent'] != row['defteam']:
            raise ValueError('Conflicting game identity in play-by-play data')
        game['plays'] += 1
        game['epaSum'] += epa
        game['successes'] += success
        game['firstDowns'] += first
        game['_drive_ids'].add(row['drive'])
    result = []
    for game in groups.values():
        game['drives'] = len(game.pop('_drive_ids'))
        game['epaSum'] = round(game['epaSum'], 6)
        if game['plays'] >= 20:
            result.append(game)
    return sorted(result, key=lambda x: (x['date'], x['gameId'], x['team']))


def load_year(year):
    CACHE.mkdir(parents=True, exist_ok=True)
    file = CACHE / f'play_by_play_{year}.csv.gz'
    if not file.exists():
        with urllib.request.urlopen(SOURCE.format(year), timeout=90) as response:
            body = response.read()
        if len(body) < 100_000:
            raise ValueError(f'Unexpectedly small {year} play-by-play download')
        file.write_bytes(body)
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    with gzip.open(file, 'rt', encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        required = {'game_id', 'game_date', 'season_type', 'play_type', 'posteam', 'defteam',
                    'home_team', 'away_team', 'drive', 'epa', 'success', 'first_down', 'qb_spike', 'qb_kneel'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f'Missing play-by-play columns for {year}')
        result = aggregate(reader)
    if not result:
        raise ValueError(f'No usable play-by-play data for {year}')
    return result, {'url': SOURCE.format(year), 'sha256': digest, 'rows': len(result)}


def main():
    games = []
    sources = []
    for year in YEARS:
        entries, source = load_year(year)
        games.extend(entries)
        sources.append(source)
        print(f'{year}: {len(entries)} team-game rows')
    if len({(g['gameId'], g['team']) for g in games}) != len(games):
        raise ValueError('Duplicate team-game identities across seasons')
    snapshot = {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(),
                'lastGameDate': max(g['date'] for g in games), 'sources': sources, 'games': games}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Wrote {len(games)} team-game rows; latest {snapshot["lastGameDate"]}')


if __name__ == '__main__':
    main()
