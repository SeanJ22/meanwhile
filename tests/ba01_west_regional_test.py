import copy
import hashlib
import json
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPLAYS = {state: runpy.run_path(str(ROOT / f"scripts/ba01-west-{state}-counties.py")) for state in ["id", "nd", "nm"]}
AZ = runpy.run_path(str(ROOT / "scripts/ba01-west-az-locals.py"))
UT = runpy.run_path(str(ROOT / "scripts/ba01-west-ut-courts.py"))


def package(state):
    return json.loads((ROOT / f"data/ballot/2026-general/{state}.json").read_text())


def ballot(state):
    return next(iter(package(state)["ballots"].values()))


class RegionalOfficialBallots(unittest.TestCase):
    def test_utah_amended_certification_has_all_regional_retentions_and_counties(self):
        original = package("ut")
        replayed = copy.deepcopy(original)
        result = UT["import_courts"](replayed)
        self.assertEqual(original["ballots"], replayed["ballots"])
        self.assertEqual([row["contests"] for row in result["districts"]], [1, 6, 7, 5, 3, 2, 1])
        current = ballot("ut")
        races = [row for row in current["contests"] if row["id"].startswith("ut-general-2026-")]
        self.assertEqual(len(races), 25)
        self.assertTrue(all(row["type"] == "RETENTION" and row["candidateListComplete"] for row in races))
        third = next(row for row in result["districts"] if row["district"] == 3)
        self.assertEqual(set(third["counties"]), {"Salt Lake", "Summit", "Tooele"})

    def test_utah_third_district_names_independently_match_the_official_county_sample(self):
        _, source = UT["COMMON"]["captured"]("ut-saltlake-bt1")
        raw_text = (ROOT / "data/ballot/ba01-west-evidence/county-captures" / source["rawTextSnapshot"]).read_bytes()
        self.assertEqual(hashlib.sha256(raw_text).hexdigest(), source["rawTextHash"])
        text = raw_text.decode()
        data = ballot("ut")
        third = {row["id"] for row in data["contests"] if row["id"].startswith("ut-general-2026-third-district-")}
        names = [row["familyName"] for row in data["candidacies"] if row["contestId"] in third]
        self.assertEqual(len(names), 7)
        normalized = " ".join(text.split())
        for name in names:
            self.assertIn("Shall " + name + " be", normalized)

    def test_replaying_every_official_source_preserves_all_reader_records(self):
        for state, replay in REPLAYS.items():
            original = package(state)
            replayed = copy.deepcopy(original)
            replay["import_counties"](replayed)
            self.assertEqual(original["ballots"], replayed["ballots"], state)
        original = package("az")
        replayed = copy.deepcopy(original)
        for parser in ["add_pima", "add_scottsdale", "add_peoria", "add_tempe"]:
            AZ[parser](replayed)
        self.assertEqual(original["ballots"], replayed["ballots"])

    def test_idaho_final_approved_county_candidates_match_every_county_and_office(self):
        replay = REPLAYS["id"]
        raw, _ = replay["COMMON"]["state_capture"]("id-all")
        source = json.loads(raw)["data"]
        self.assertTrue(source["isFinalList"])
        expected = [row for row in source["candidates"] if row["districtType"] == "County" and row["filingStatus"] == "Approved"]
        self.assertEqual((len(expected), len({row["countyName"] for row in expected})), (334, 44))
        data = ballot("id")
        for row in expected:
            county = row["countyName"].lower().replace(" ", "_")
            eligible = {race["id"] for race in data["contests"] if race["ocdId"].endswith("/county:" + county) and race["title"].startswith(row["officeName"])}
            self.assertTrue(any(person["contestId"] in eligible and person["familyName"] == row["candidateName"].strip()
                and person["partyLabel"] == (row["partyName"] or None) for person in data["candidacies"]), row["officeName"])
        magistrates = [race for race in data["contests"] if race["title"].startswith("Magistrate Judge")]
        self.assertEqual(len(magistrates), 33)
        self.assertTrue(all(race["type"] == "RETENTION" for race in magistrates))

    def test_ada_highway_scope_is_explicitly_countywide_and_keeps_all_seven_names(self):
        legal, _ = REPLAYS["id"]["snapshot"]("id-highway-codified")
        self.assertIn("A qualified voter of the countywide highway district shall be eligible to vote for each", legal)
        data = ballot("id")
        races = [race for race in data["contests"] if race["id"].startswith("id-ada-general-2026-highway-commissioner-")]
        self.assertEqual(len(races), 2)
        self.assertEqual({race["ocdId"] for race in races}, {"ocd-division/country:us/state:id/county:ada"})
        self.assertEqual(sum(person["contestId"] in {race["id"] for race in races} for person in data["candidacies"]), 7)

    def test_nd_empty_offices_remain_explicit_without_invented_candidates(self):
        data = ballot("nd")
        self.assertEqual(len(data["heldContests"]), 6)
        for race in data["heldContests"]:
            self.assertEqual(race["reason"], "No candidate appears on the official general election candidate list")
            self.assertFalse(any(person["contestId"] == race["id"] for person in data["candidacies"]))
        self.assertFalse(any("County Commissioner By District" in race["title"] for race in data["contests"]))
        # At-large classification belongs to the same exact source row as the candidate.
        replay = REPLAYS["nd"]
        raw, _ = replay["COMMON"]["state_capture"]("nd-all-rows.json")
        rows = json.loads(raw)
        for name in ["Tony Grindberg", "Jim Prochniak"]:
            source = next(row for row in rows if len(row) == 19 and row[5] == name)
            self.assertEqual((source[2], source[4]), ("County Commissioner At Large By District", "Cass"))

    def test_nm_full_qualified_county_choices_keep_parties_and_unknown_council_vote_limit(self):
        replay = REPLAYS["nm"]
        raw, _ = replay["COMMON"]["state_capture"]("nm-rows.json")
        expected = [row for row in json.loads(raw) if len(row) > 22 and row[21] == "Qualified" and row[1] in {
            "County Sheriff", "County Assessor", "Probate Judge", "County Clerk", "County Treasurer", "County Commissioner At Large"}]
        self.assertEqual((len(expected), len({row[3] for row in expected})), (140, 33))
        data = ballot("nm")
        for row in expected:
            identifier = "nm-" + replay["county_id"](row[3]) + "-general-2026-" + replay["COMMON"]["slug"](row[0])
            self.assertTrue(any(person["contestId"] == identifier and person["familyName"] == row[4]
                and person["partyLabel"] == (row[8] or None) for person in data["candidacies"]))
        council = next(race for race in data["contests"] if race["id"] == "nm-los_alamos-general-2026-county-councilor")
        self.assertIsNone(council["voteFor"])
        self.assertFalse(any(race["title"].startswith("Magistrate Judge") for race in data["contests"]))

    def test_az_pima_retention_and_local_measures_keep_official_scope_and_question(self):
        data = ballot("az")
        pima = [race for race in data["contests"] if race["id"].startswith("az-pima-general-2026-")]
        self.assertEqual(len(pima), 14)
        self.assertEqual(sum(race["type"] == "RETENTION" for race in pima), 13)
        self.assertTrue(all(race["ocdId"].endswith("/county:pima") for race in pima))
        tempe = next(row for row in data["measures"] if row["id"] == "az-tempe-general-2026-proposition-424#question")
        for fact in ["January 1, 2027", "0.5%", "0.3%", "0.1%", "1.8 percent"]:
            self.assertIn(fact, tempe["questionText"])
        scottsdale = next(row for row in data["contests"] if row["id"] == "az-scottsdale-general-2026-councilmember")
        self.assertEqual(scottsdale["voteFor"], 2)

    def test_new_facts_have_equal_candidate_fields_and_exact_source_receipt_versions(self):
        fields = {"id", "contestId", "familyName", "givenName", "partyLabel", "slogan", "incumbent", "websiteUrl", "provenance"}
        prefixes = {"id": ("id-",), "nd": ("nd-cass-", "nd-east-", "nd-north", "nd-south", "nd-"),
            "nm": ("nm-",), "az": ("az-pima-general-", "az-peoria-", "az-scottsdale-general-", "az-tempe-")}
        for state in prefixes:
            data = package(state)
            sources = {(url, row["retrievedAt"]) for row in data["sourceReceipt"]["sources"] for url in [row["requestedUrl"], row["finalUrl"]]}
            current = next(iter(data["ballots"].values()))
            for row in current["candidacies"]:
                if row["id"].startswith(prefixes[state]):
                    self.assertEqual(set(row), fields)
            for key in ["contests", "candidacies", "measures", "heldContests", "districtMemberships"]:
                for row in current.get(key, []):
                    if row["id"].startswith(prefixes[state] + ("ba01-",)):
                        proof = row["provenance"]
                        self.assertIn((proof["sourceUrl"], proof["collectedAt"]), sources)


if __name__ == "__main__":
    unittest.main()
