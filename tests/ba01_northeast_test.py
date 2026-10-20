"""Source replay checks for the actual official BA-01 ballot documents."""
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ba01_northeast", ROOT / "scripts/ba01-northeast.py")
BA01 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BA01)
PA_SPEC = importlib.util.spec_from_file_location("ba01_northeast_pa", ROOT / "scripts/ba01-northeast-pa.py")
PA = importlib.util.module_from_spec(PA_SPEC)
PA_SPEC.loader.exec_module(PA)
COVERAGE_SPEC = importlib.util.spec_from_file_location("ba01_northeast_coverage", ROOT / "scripts/ba01-northeast-coverage.py")
COVERAGE = importlib.util.module_from_spec(COVERAGE_SPEC)
COVERAGE_SPEC.loader.exec_module(COVERAGE)


class NortheastBallotSources(unittest.TestCase):
    def test_new_jersey_pdf_columns_and_declared_totals(self):
        rows = BA01.nj_rows(BA01.SOURCES / BA01.HOUSE)
        self.assertEqual(len(rows), 35)  # Printed official PDF total.
        self.assertEqual(set(row["district"] for row in rows), set(range(1, 13)))
        self.assertEqual(next(row["party"] for row in rows if row["name"] == "GREGG MELE"), "Republican")
        self.assertEqual(next(row["party"] for row in rows if row["name"] == "RYAN MICHAEL KELLY"),
                         "AFFORDABILITY, ACCOUNTABILITY, PEOPLE")
        senate = BA01.nj_rows(BA01.SOURCES / BA01.SENATE, True)
        self.assertEqual(len(senate), 4)  # Printed official PDF total.

    def test_every_federal_race_matches_its_entire_official_candidate_set(self):
        _, data, _ = BA01.update_nj("2026-10-20T00:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        for filename, senate in [(BA01.HOUSE, False), (BA01.SENATE, True)]:
            rows = BA01.nj_rows(BA01.SOURCES / filename, senate)
            for district in set(row["district"] for row in rows):
                division = "ocd-division/country:us/state:nj" + ("" if senate else f"/cd:{district}")
                contest = next(c for c in ballot["contests"] if c["ocdId"] == division and c["type"] == "CANDIDACY")
                held = {(BA01.words(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                        for c in ballot["candidacies"] if c["contestId"] == contest["id"]}
                official = {(BA01.words(row["name"]), row["party"]) for row in rows if row["district"] == district}
                self.assertEqual(held, official, division)

    def test_philadelphia_question_text_and_scope(self):
        _, data, _ = BA01.update_philadelphia("2026-10-20T00:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        local = [c for c in ballot["contests"] if c["id"].startswith("pa-philadelphia-2026-charter-question-")]
        self.assertEqual(len(local), 2)
        self.assertEqual({c["ocdId"] for c in local}, {"ocd-division/country:us/state:pa/county:philadelphia"})
        text = BA01.pdf_text(BA01.SOURCES / "2026G_Ballot_Questions.pdf")
        normalized = " ".join(text.split())
        for question in ballot["measures"]:
            if question["contestId"] in {c["id"] for c in local}:
                self.assertIn(question["questionText"], normalized)
                self.assertIn(question["officialStatement"], normalized)

    def test_massachusetts_includes_all_eight_official_councillor_districts(self):
        _, data, _ = BA01.update_ma("2026-10-20T00:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        self.assertEqual(sum(c["type"] == "CANDIDACY" for c in ballot["contests"]), 223)
        self.assertEqual(len(ballot["candidacies"]), 304)
        for office, rows in list(BA01.ma_sections().items())[:10]:
            for district, line in rows:
                title = office + (" – " + district if district != "Statewide" else "")
                contest = next(c for c in ballot["contests"] if c["title"] == title)
                name = BA01.re.split(r",\s+\d", line)[0] if BA01.re.search(r",\s+\d", line) else line.split(",")[0]
                self.assertTrue(any(c["contestId"] == contest["id"] and BA01.words(c["givenName"] + " " + c["familyName"]) == BA01.words(name)
                                    for c in ballot["candidacies"]), title + ": " + name)

    def test_vermont_chittenden_county_does_not_include_chittenden_town(self):
        _, data, _ = BA01.update_vt("2026-10-20T00:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        county = [c for c in ballot["contests"] if c["ocdId"] == "ocd-division/country:us/state:vt/county:chittenden"]
        self.assertEqual(len(county), 5)
        local_ids = {c["id"] for c in county}
        local_ids.add("vt-2026-burlington-justice-of-the-peace")
        printed = BA01.words(BA01.pdf_text(BA01.SOURCES / "burlington-chittenden-13-sample.pdf"))
        candidates = [c for c in ballot["candidacies"] if c["contestId"] in local_ids]
        self.assertEqual(len(candidates), 50)
        for candidate in candidates:
            self.assertIn(BA01.words(candidate["givenName"] + " " + candidate["familyName"]), printed)
        self.assertFalse(any("justice-of-the-peace" in c["id"] for c in county))

    def test_new_york_every_contest_name_and_fusion_party_set_matches_certification(self):
        _, _, report = BA01.update_ny("2026-10-20T00:00:00Z")
        self.assertEqual(report["officialContests"], 242)
        self.assertEqual(report["officialCandidates"], 442)
        self.assertEqual(report["mismatches"], [])

    def test_pennsylvania_source_parsers_include_independents_and_exclude_withdrawals(self):
        bucks = PA.bucks_rows()
        self.assertEqual(len(bucks), 28)
        self.assertEqual(len({r["division"] for r in bucks}), 14)
        self.assertEqual(next(r["party"] for r in bucks if r["name"] == "Chris Gambino"), "Forward Independent")
        self.assertEqual(next(r["party"] for r in bucks if r["name"] == "Rebecca Prendergast"), "Independent Party")
        chester = PA.chester_rows()
        self.assertEqual(len(chester), 20)
        self.assertEqual(len({r["division"] for r in chester}), 11)
        delaware = PA.delaware_rows()
        self.assertEqual(len(delaware), 23)
        self.assertEqual(len({r["division"] for r in delaware}), 14)
        self.assertFalse(any("Goodwin" in r["name"] or "Dastra" in r["name"] for r in delaware))
        self.assertEqual({r["name"] for r in delaware if r["division"] == "sldu:26"}, {"Tim Kearney", "Gail Scott"})
        self.assertEqual(len(PA.cumberland_rows()), 16)
        self.assertEqual(len(PA.dauphin_rows()), 12)
        erie = PA.erie_rows()
        self.assertEqual(len(erie), 10)
        self.assertEqual(next(r["party"] for r in erie if r["name"] == "BOB MERSKI"), "DEMOCRATIC/REPUBLICAN")
        montgomery = PA.montgomery_rows()
        self.assertEqual((len({r["division"] for r in montgomery}), len(montgomery)), (21, 39))
        self.assertEqual(next(r["party"] for r in montgomery if r["name"] == "STEPHANIE BERARDI"), "Progress for Pennsylvania")
        self.assertEqual(next(r["party"] for r in montgomery if r["name"] == "MIKE SCHONEWOLF"), "Green")
        juniata = PA.juniata_rows()
        self.assertEqual((len({r["division"] for r in juniata}), len(juniata)), (4, 7))

    def test_pennsylvania_luzerne_lackawanna_sample_choices_and_complete_county_questions(self):
        luzerne, lackawanna = PA.luzerne_rows(), PA.lackawanna_rows()
        self.assertEqual((len({r["division"] for r in luzerne}), len(luzerne)), (10, 19))
        self.assertEqual((len({r["division"] for r in lackawanna}), len(lackawanna)), (7, 14))
        self.assertEqual({r["name"] for r in luzerne if r["division"] == "sldu:20"}, {"Jackie Baker", "Lisa Baker"})
        self.assertEqual({r["name"] for r in lackawanna if r["division"] == "sldl:114"}, {"BRIDGET MALLOY KOSIEROWSKI", "LOGAN LOMBARDO"})
        questions = PA.local_questions()
        self.assertTrue(all(q.endswith("county?") or q.endswith("County?") for _, _, q, _ in questions))
        self.assertTrue(all("individual stock trades or prediction market bets" in q for _, _, q, _ in questions))

    def test_rhode_island_entire_official_election_ballot_candidate_sets_match(self):
        comparison = COVERAGE.rhode_island()
        self.assertEqual(comparison["officialCandidateContests"], 121)
        self.assertEqual(comparison["officialCandidacies"], 161)
        self.assertEqual(comparison["differences"], [])

    def test_connecticut_current_version_preserves_names_and_reports_unresolved_party_ids(self):
        comparison = COVERAGE.connecticut()
        self.assertEqual(comparison["officialCandidateContests"], 197)
        self.assertEqual(comparison["officialCandidacies"], 544)
        self.assertEqual(comparison["differences"], [])
        self.assertEqual(len(comparison["currentPartyMetadataMissing"]), 5)

    def test_maine_entire_official_candidate_set_and_all_ten_state_writeins_match(self):
        comparison = COVERAGE.maine()
        self.assertEqual(comparison["officialCandidateContests"], 190)
        self.assertEqual(comparison["officialNonWriteInCandidacies"], 352)
        self.assertEqual(comparison["officialStateWriteInCandidacies"], 10)
        self.assertEqual(comparison["officialCandidacies"], 362)
        self.assertEqual(comparison["differences"], [])


if __name__ == "__main__":
    unittest.main()
