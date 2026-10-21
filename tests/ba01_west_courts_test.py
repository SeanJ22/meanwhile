import copy
import json
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPLAY = runpy.run_path(str(ROOT / "scripts/ba01-west-court-county.py"))


def package(state):
    return json.loads((ROOT / f"data/ballot/2026-general/{state}.json").read_text())


def ballot(state):
    return next(iter(package(state)["ballots"].values()))


class OfficialCourtsAndCounties(unittest.TestCase):
    def test_bernalillo_all_qualified_countywide_and_judicial_choices(self):
        before = package("nm")
        replayed = copy.deepcopy(before)
        REPLAY["new_mexico"](replayed)
        self.assertEqual(before["ballots"], replayed["ballots"])
        data = ballot("nm")
        races = [r for r in data["contests"] if r["id"].startswith("nm-bernalillo-general-2026-")]
        ids = {r["id"] for r in races}
        candidates = [r for r in data["candidacies"] if r["contestId"] in ids]
        self.assertEqual((len(races), len(candidates)), (26, 28))
        self.assertEqual(sum(r["type"] == "RETENTION" for r in races), 17)
        self.assertFalse(any("Commissioner" in r["title"] for r in races))
        self.assertEqual({r["partyLabel"] for r in candidates}, {"DEM", "REP", None})
        self.assertTrue(all(r["incumbent"] is None and r["websiteUrl"] is None and r["slogan"] is None for r in candidates))

    def test_montana_contested_and_unopposed_nonincumbent_elections_remain_elections(self):
        data = ballot("mt")
        races = [r for r in data["contests"] if r["id"].startswith("mt-general-2026-district-court-judge-")]
        candidates = [r for r in data["candidacies"] if r["contestId"] in {c["id"] for c in races}]
        self.assertEqual((len(races), len(candidates)), (12, 13))
        self.assertEqual(sum(r["type"] == "RETENTION" for r in races), 10)
        first = next(r for r in races if r["title"] == "DISTRICT COURT JUDGE DISTRICT 1, DEPT 3")
        contested = next(r for r in races if r["title"] == "DISTRICT COURT JUDGE DISTRICT 7, DEPT 2")
        self.assertEqual(first["type"], "CANDIDACY")
        self.assertEqual(contested["type"], "CANDIDACY")
        self.assertEqual({r["familyName"] for r in candidates if r["contestId"] == contested["id"]}, {"SCOTT W HERRING", "BRETT IRIGOIN"})

    def test_lewis_and_clark_is_one_whole_county_membership(self):
        rows = [r for r in ballot("mt")["districtMemberships"] if r["districtOcdId"].endswith("judicial_district:1")]
        self.assertEqual({r["memberOcdId"] for r in rows}, {
            "ocd-division/country:us/state:mt/county:lewis_and_clark",
            "ocd-division/country:us/state:mt/county:broadwater"})

    def test_east_central_has_exactly_its_three_official_counties(self):
        data = ballot("nd")
        rows = [r for r in data["districtMemberships"] if r["districtOcdId"].endswith("judicial_district:east_central")]
        self.assertEqual({r["memberOcdId"].split(":")[-1] for r in rows}, {"cass", "steele", "traill"})
        races = [r for r in data["contests"] if r["id"].startswith("nd-east-central-general-2026-")]
        self.assertEqual(len(races), 6)
        self.assertTrue(all(r["voteFor"] == 1 for r in races))

    def test_fargo_school_levy_keeps_exact_rates_and_school_electorate(self):
        data = ballot("nd")
        contest = next(r for r in data["contests"] if r["id"] == "nd-fargo-school-district-1-general-2026-measure-1")
        self.assertEqual(contest["ocdId"], "ocd-division/country:us/state:nd/school_district:fargo_public_school_district_1")
        measure = next(r for r in data["measures"] if r["contestId"] == contest["id"])
        self.assertIn("127.00 mills", measure["questionText"])
        self.assertIn("seventy mills", measure["questionText"])
        self.assertTrue(measure["questionText"].endswith("110.00 mills effective December 31, 2027?"))
        self.assertEqual(measure["officialNumber"], "1")

    def test_new_capture_with_identical_bytes_preserves_old_cited_receipt_version(self):
        old = {"requestedUrl": "https://official.gov/list", "finalUrl": "https://official.gov/list", "httpStatus": 200,
            "rawHash": "a" * 64, "retrievedAt": "2026-10-14T00:00:00Z", "publisher": "Official", "sourceClass": "ELECTION_AUTHORITY", "reviewedEvidence": "old capture"}
        data = {"sourceReceipt": {"sources": [copy.deepcopy(old)]}}
        new = {"sourceUrl": old["requestedUrl"], "rawHash": old["rawHash"], "retrievedAt": "2026-10-21T00:00:00Z", "httpStatus": 200}
        REPLAY["receipt"](data, new, "Official", "new capture")
        self.assertEqual(len(data["sourceReceipt"]["sources"]), 2)
        self.assertEqual(data["sourceReceipt"]["sources"][0], old)

    def test_same_capture_publisher_alias_cannot_rewrite_published_authority(self):
        old = {"requestedUrl": "https://official.gov/sample", "finalUrl": "https://official.gov/sample", "httpStatus": 200,
            "rawHash": "b" * 64, "retrievedAt": "2026-10-20T23:19:36Z", "publisher": "County / City", "sourceClass": "ELECTION_AUTHORITY",
            "reviewedEvidence": "original review", "reviewOutcome": "SUPPORTED"}
        data = {"sourceReceipt": {"sources": [copy.deepcopy(old)]}}
        source = {"sourceUrl": old["requestedUrl"], "rawHash": old["rawHash"], "retrievedAt": old["retrievedAt"], "httpStatus": 200}
        REPLAY["receipt"](data, source, "City", "new wording for the same capture", "OFFICIAL_PUBLISHER")
        self.assertEqual(data["sourceReceipt"]["sources"], [old])

    def test_all_new_source_provenance_versions_have_the_exact_saved_receipt(self):
        for state in ["nd", "nm", "mt"]:
            data = package(state)
            current = next(iter(data["ballots"].values()))
            sources = {(u, r["retrievedAt"]) for r in data["sourceReceipt"]["sources"] for u in [r["requestedUrl"], r["finalUrl"]]}
            for field in ["contests", "candidacies", "measures", "districtMemberships"]:
                for row in current.get(field, []):
                    if row["id"].startswith(("nd-cass-", "nd-east-central-", "nd-fargo-school-", "nm-bernalillo-", "mt-general-2026-", "ba01-")):
                        proof = row["provenance"]
                        self.assertIn((proof["sourceUrl"], proof["collectedAt"]), sources)


if __name__ == "__main__":
    unittest.main()
