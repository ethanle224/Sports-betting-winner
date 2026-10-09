import unittest

from refresh_nba_games import normalize_games


class NormalizeGamesTests(unittest.TestCase):
    def row(self, **updates):
        item = {
            'game_id': '4011', 'date': '2025-10-21T23:30Z', 'season': '2026',
            'season_type': '2', 'status_type_completed': 'true', 'notes_headline': '',
            'home_id': '1', 'away_id': '2', 'home_score': '110', 'away_score': '105',
            'neutral_site': 'false',
        }
        item.update(updates)
        return item

    def test_keeps_only_completed_regular_games_before_snapshot_time(self):
        rows = [self.row(), self.row(game_id='4012', notes_headline='NBA Cup Championship'),
                self.row(game_id='4017', notes_headline='NBA In-Season Tournament Championship'),
                self.row(game_id='4013', home_id='31'), self.row(game_id='4014', season_type='3'),
                self.row(game_id='4015', status_type_completed='false'),
                self.row(game_id='4016', date='2027-01-01T00:00Z')]
        games = normalize_games(rows, {'1', '2'}, 2026, '2026-10-06T00:00:00Z')
        self.assertEqual(games, [{'id': '4011', 'season': 2026, 'tip': '2025-10-21T23:30:00Z',
                                  'home': '1', 'away': '2', 'homeScore': 110, 'awayScore': 105, 'neutral': False}])

    def test_duplicate_or_corrupt_score_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            normalize_games([self.row(), self.row()], {'1', '2'}, 2026, '2026-10-06T00:00:00Z')
        with self.assertRaisesRegex(ValueError, 'score'):
            normalize_games([self.row(home_score='')], {'1', '2'}, 2026, '2026-10-06T00:00:00Z')


if __name__ == '__main__':
    unittest.main()
