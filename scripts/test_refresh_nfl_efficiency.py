import importlib.util
import pathlib
import unittest

module_path = pathlib.Path(__file__).with_name('refresh_nfl_efficiency.py')
spec = importlib.util.spec_from_file_location('refresh_nfl_efficiency', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AggregateTests(unittest.TestCase):
    def test_aggregates_only_real_regular_season_scrimmage_plays(self):
        def play(**overrides):
            return dict(dict(game_id='2025_01_AAA_BBB', game_date='2025-09-07', season_type='REG',
                        posteam='AAA', defteam='BBB', home_team='BBB', away_team='AAA',
                        play_type='pass', epa='0.5', success='1', first_down='1',
                        drive='2', qb_spike='0', qb_kneel='0'), **overrides)
        rows = [play() for _ in range(19)] + [play(play_type='run', epa='-0.1', success='0', first_down='0', drive='3'),
                play(play_type='kickoff'), play(season_type='PRE'), play(epa=''),
                play(qb_spike='1'), play(posteam='CCC')]
        entries = module.aggregate(rows)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['plays'], 20)
        self.assertEqual(entries[0]['epaSum'], 9.4)
        self.assertEqual(entries[0]['successes'], 19)
        self.assertEqual(entries[0]['firstDowns'], 19)
        self.assertEqual(entries[0]['drives'], 2)
        self.assertEqual(entries[0]['opponent'], 'BBB')


if __name__ == '__main__':
    unittest.main()
