import json
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPLAY = runpy.run_path(str(ROOT / "scripts/ba01-west-county-offices.py"))
REPLAY["el_paso_rows"] = runpy.run_path(str(ROOT / "scripts/ba01-west-elpaso.py"))["el_paso_rows"]


class OfficialCountyBallots(unittest.TestCase):
    def assert_official_county(self, state, county, parser, offices, candidates):
        rows, source = REPLAY[parser]()
        self.assertEqual(len(rows), candidates)
        self.assertEqual(len({row["office"] for row in rows}), offices)
        ballot = next(iter(json.loads((ROOT / f"data/ballot/2026-general/{state}.json").read_text())["ballots"].values()))
        imported = [contest for contest in ballot["contests"] if contest["id"].startswith(f"{state}-{county}-general-2026-") and contest["type"] == "CANDIDACY"]
        self.assertEqual(len(imported), offices)
        for row in rows:
            contest = next(contest for contest in imported if contest["title"] == row["office"])
            self.assertEqual(contest["ocdId"], f"ocd-division/country:us/state:{state}/county:{county}")
            candidate = next(candidate for candidate in ballot["candidacies"] if candidate["contestId"] == contest["id"] and candidate["familyName"] == row["name"] and candidate["givenName"] == "")
            self.assertEqual(candidate["partyLabel"], row["party"])
            self.assertEqual(candidate["provenance"]["sourceUrl"], source["sourceUrl"])
            self.assertEqual(candidate["provenance"]["quote"], row["quote"])
            self.assertIsNone(candidate["websiteUrl"])
            self.assertIsNone(candidate["incumbent"])
            self.assertIsNone(candidate["slogan"])
        # County metadata never assigns district-specific source choices to all readers.
        self.assertTrue(all(not any(label in contest["title"] for label in ["District E", "District F", "District G", "Conservation", "Municipal"]) for contest in imported))

    def test_clark_all_fifteen_nominees_in_six_countywide_offices(self):
        self.assert_official_county("nv", "clark", "clark_rows", 6, 15)

    def test_laramie_all_thirteen_final_county_nominees(self):
        self.assert_official_county("wy", "laramie", "laramie_rows", 8, 13)

    def test_salt_lake_all_ten_county_nominees(self):
        self.assert_official_county("ut", "salt_lake", "salt_lake_rows", 5, 10)

    def test_minnehaha_all_nine_county_nominees(self):
        self.assert_official_county("sd", "minnehaha", "minnehaha_rows", 4, 9)

    def test_el_paso_all_eighteen_county_and_local_judicial_names(self):
        self.assert_official_county("co", "el_paso", "el_paso_rows", 15, 18)
        rows, _ = REPLAY["el_paso_rows"]()
        self.assertEqual([row["name"] for row in rows[8:]], ["William B. Bain", "Hilary Gurney", "Dennis L. McGuire", "Amanda J. Philipps",
            "Erin Lynn Sokol", "Gregory Robert Werner", "Sam Burney", "Marika Frady", "Meredith Patrick Cord", "Ann M. Rotolo"])
        self.assertIn("David 'Muka' Traenkle", [row["name"] for row in rows])
        self.assertTrue(all(len(row["name"]) < 60 and "?" not in row["name"] for row in rows))

    def test_el_paso_empty_surveyor_race_has_no_invented_candidate(self):
        ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/co.json").read_text())["ballots"].values()))
        held = next(contest for contest in ballot["heldContests"] if contest["title"] == "County Surveyor")
        self.assertEqual(held["reason"], "No candidate appears on the official sample ballot")
        self.assertEqual(held["ocdId"], "ocd-division/country:us/state:co/county:el_paso")
        self.assertFalse(any(candidate["contestId"] == held["id"] for candidate in ballot["candidacies"]))
        self.assertFalse(any(contest["id"] == held["id"] for contest in ballot["contests"]))

    def test_el_paso_one_a_keeps_official_rate_expiration_and_uses(self):
        ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/co.json").read_text())["ballots"].values()))
        measure = next(measure for measure in ballot["measures"] if measure["contestId"] == "co-el_paso-general-2026-ballot-issue-1a")
        self.assertIn("0.23% (TWENTY-THREE HUNDREDTHS OF ONE CENT)", measure["questionText"])
        self.assertIn("JANUARY 1, 2037", measure["questionText"])
        self.assertIn("CRIMINAL JUSTICE NEEDS", measure["questionText"])
        self.assertIn("EMERGENCY RESPONSE NEEDS", measure["questionText"])
        self.assertTrue(measure["questionText"].endswith("249?"))

    def test_salt_lake_bond_keeps_the_full_official_question(self):
        ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/ut.json").read_text())["ballots"].values()))
        contest = next(contest for contest in ballot["contests"] if contest["id"] == "ut-salt_lake-general-2026-special-bond-election")
        self.assertEqual(contest["ocdId"], "ocd-division/country:us/state:ut/county:salt_lake")
        measure = next(measure for measure in ballot["measures"] if measure["contestId"] == contest["id"])
        self.assertIn("$128,000,000", measure["questionText"])
        self.assertIn("no more than eleven (11) years", measure["questionText"])
        self.assertTrue(measure["questionText"].endswith("now outstanding?"))
        self.assertIn("FOR THE ISSUANCE OF BONDS", measure["provenance"]["quote"])
        self.assertIn("AGAINST THE ISSUANCE OF BONDS", measure["provenance"]["quote"])


if __name__ == "__main__":
    unittest.main()
