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
NH_SPEC = importlib.util.spec_from_file_location("ba01_northeast_nh", ROOT / "scripts/ba01-northeast-nh.py")
NH = importlib.util.module_from_spec(NH_SPEC)
NH_SPEC.loader.exec_module(NH)
MA_SPEC = importlib.util.spec_from_file_location("ba01_northeast_ma_memberships", ROOT / "scripts/ba01-northeast-ma-memberships.py")
MA = importlib.util.module_from_spec(MA_SPEC)
MA_SPEC.loader.exec_module(MA)
CONCORD_SPEC = importlib.util.spec_from_file_location("ba01_northeast_nh_concord", ROOT / "scripts/ba01-northeast-nh-concord.py")
CONCORD = importlib.util.module_from_spec(CONCORD_SPEC)
CONCORD_SPEC.loader.exec_module(CONCORD)
NY_SPEC = importlib.util.spec_from_file_location("ba01_northeast_ny", ROOT / "scripts/ba01-northeast-ny.py")
NY = importlib.util.module_from_spec(NY_SPEC)
NY_SPEC.loader.exec_module(NY)
NYC_SPEC = importlib.util.spec_from_file_location("ba01_northeast_nyc", ROOT / "scripts/ba01-northeast-nyc.py")
NYC = importlib.util.module_from_spec(NYC_SPEC)
NYC_SPEC.loader.exec_module(NYC)
LEBANON = COVERAGE.LEBANON
ME = COVERAGE.ME


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

    def test_new_jersey_current_office_certifications_exclude_april_special_from_november(self):
        report=json.loads((ROOT/"data/ballot/reports/ba01-northeast-nj-offices.json").read_text())
        active=BA01.re.sub(r"<!--[\s\S]*?-->","",(BA01.SOURCES/"nj-2026-election-information-current.html").read_text())
        self.assertIn("2026-certification-of-general-election-nominees_us-senate_us-house.pdf",active)
        self.assertNotIn("2026-0808-amended-certification-35th-legislative-district.pdf",active)
        special=BA01.pdf_text(BA01.SOURCES/"2026-certification-of-special-general-election-nominees.pdf")
        self.assertIn("SPECIAL GENERAL ELECTION 04/16/2026",special)
        self.assertFalse(report["separate2026SpecialElection"]["onNovemberBallot"])
        self.assertEqual(report["officialRegularLegislativeContests"],0)
        self.assertIn("All 21 county sample ballots have not been exhaustively compared",report["absenceLimit"])
        declaration=(BA01.SOURCES/"nj-general-certification-front.ocr.txt").read_text()
        self.assertIn("Office of United States Senator",declaration)
        self.assertIn("November 3, 2026",declaration)

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

    def test_massachusetts_council_memberships_include_only_whole_municipalities_and_wards(self):
        whole, wards = MA.official_members()
        self.assertEqual((len(whole), len(wards)), (348, 28))
        rows = MA.memberships("2026-10-20T00:00:00Z")
        self.assertEqual(len(rows), 736)
        pairs = {r["memberOcdId"]: r["districtOcdId"] for r in rows}
        prefix = "ocd-division/country:us/state:ma/"
        self.assertEqual(pairs[prefix + "place:brookline"], prefix + "governors_council:3")
        self.assertEqual(pairs[prefix + "county:berkshire/place:pittsfield_city"], prefix + "governors_council:8")
        self.assertEqual(pairs[prefix + "place:boston/ward:9"], prefix + "governors_council:4")
        self.assertEqual(pairs[prefix + "place:cambridge/ward:9"], prefix + "governors_council:3")
        for partial in ["place:boston", "place:cambridge", "place:braintree", "place:boston/ward:4", "place:cambridge/ward:8"]:
            self.assertNotIn(prefix + partial, pairs)

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

    def test_new_york_court_continuation_pages_keep_every_name_and_fusion_line(self):
        groups = NY.court_groups()
        self.assertEqual((len(groups), sum(len(g["names"]) for g in groups.values())), (11, 60))
        self.assertEqual(sum(len(parties) for g in groups.values() for parties in g["names"].values()), 95)
        self.assertEqual(groups["1"]["names"]["Jeffrey W. Rizzo"], ["Working Families"])
        self.assertEqual(groups["10"]["names"]["Mary Kate Mullen"], ["Republican", "Conservative"])
        self.assertEqual(groups["10"]["names"]["Anthony R. Portesy"], ["Conservative"])
        self.assertIn("Schenectady, Warren & Washington", groups["4"]["counties"])
        _, data, _ = NY.update("2026-10-21T01:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        for district, group in groups.items():
            contest_id = f"ny-2026-general:supreme-court-{district}"
            held = {(c["familyName"], c["partyLabel"]) for c in ballot["candidacies"] if c["contestId"] == contest_id}
            self.assertEqual(held, {(n, " / ".join(p)) for n, p in group["names"].items()})
        memberships = {(r["memberOcdId"], r["districtOcdId"]) for r in ballot["districtMemberships"]}
        self.assertEqual(len(memberships), 44)
        self.assertIn((NY.PREFIX + "county:kings", NY.PREFIX + "supreme_court:2"), memberships)

    def test_new_york_city_five_questions_use_exact_current_official_ballot_sections(self):
        questions = NY.city_questions()
        self.assertEqual([q["number"] for q in questions], ["1", "2", "3", "4", "5"])
        linking_page = (BA01.SOURCES / "nyc-2026-311.html").read_text()
        self.assertIn("https://www.nycvotes.org/", linking_page)
        self.assertIn("six ballot questions", linking_page)
        for q in questions:
            self.assertTrue(q["questionText"])
            self.assertIn("yes", q["officialStatement"].lower())
            self.assertIn("no", q["officialStatement"].lower())
        _, data, report = NY.update("2026-10-21T01:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        self.assertEqual(len(ballot["measures"]), 5)
        self.assertEqual(report["newYorkCityQuestions"], 5)
        self.assertTrue(all(c["ocdId"] == NY.PREFIX + "place:new_york" for c in ballot["contests"] if c["type"] == "MEASURE"))

    def test_new_york_city_official_10001_sample_matches_all_sixteen_races(self):
        _, data, report = NYC.update("2026-10-21T01:00:00Z")
        comparison = report["sampleComparison"]
        self.assertEqual((comparison["officialCandidateContests"], comparison["officialCandidacies"], comparison["officialMeasures"]), (11, 32, 5))
        self.assertEqual(len(comparison["races"]), 16)
        self.assertEqual(comparison["differences"], [])
        ballot = next(iter(data["ballots"].values()))
        court = next(c for c in ballot["contests"] if c["id"] == "ny-2026-new-york-county-civil-court")
        self.assertEqual(court["voteFor"], 3)
        ids = {NYC.LOCAL[r["contest_description"]][0] for r in NYC.source_rows() if r["contest_description"] in NYC.LOCAL}
        self.assertEqual(len([c for c in ballot["candidacies"] if c["contestId"] in ids]), 7)
        # A later current ballot source is not undone by replaying the earlier guide.
        _, earlier, _ = NY.update("2026-10-21T01:00:00Z")
        self.assertEqual(NYC.sample_comparison(next(iter(earlier["ballots"].values())))["differences"], [])

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

    def test_berks_official_samples_replay_all_fourteen_district_candidate_sets(self):
        urls = json.loads((BA01.SOURCES / "pa-berks-selected-sample-urls.json").read_text())
        rows = [row for filename in urls for row in PA.berks_sample_rows(filename)]
        choices = {(r["division"], r["name"], r["party"]) for r in rows}
        self.assertEqual((len({r[0] for r in choices}), len(choices)), (14, 27))
        self.assertIn(("sldu:24", "Mike Schonewolf", "Green"), choices)
        self.assertIn(("sldl:5", "Andres R. F. Santiago", "Democratic"), choices)

    def test_westmoreland_butler_fayette_samples_replay_all_sixteen_candidate_sets(self):
        sources = json.loads((BA01.SOURCES / "pa-additional-selected-sources.json").read_text())
        rows = [row for filename in sources if filename.startswith(("pa-westmoreland-", "pa-butler-", "pa-fayette-")) for row in PA.other_sample_rows(filename)]
        choices = {(r["division"], BA01.words(r["name"]), r["party"].lower()) for r in rows}
        self.assertEqual((len({r[0] for r in choices}), len(choices)), (16, 27))
        self.assertIn(("sldl:12", "brandon dukes", "democratic"), choices)
        self.assertEqual({r[1] for r in choices if r[0] == "sldl:56"}, {"brian rasel"})

    def test_washington_centre_complete_columns_keep_the_independent_party_candidate(self):
        sources = json.loads((BA01.SOURCES / "pa-additional-selected-sources.json").read_text())
        rows = [r for name in sources if name.startswith(("pa-washington-", "pa-centre-")) for r in PA.other_sample_rows(name)]
        choices = {(r["division"],r["name"],r["party"]) for r in rows}
        self.assertEqual((len({r[0] for r in choices}),len(choices)),(9,18))
        self.assertIn(("sldu:46","JODI BORELLO","INDEPENDENT PARTY"),choices)
        self.assertIn(("sldl:82","PAUL TAKAC","DEMOCRATIC"),choices)

    def test_each_nyc_borough_sample_matches_every_race_and_fusion_party_line(self):
        _,data,report=NYC.update("2026-10-21T02:00:00Z")
        self.assertEqual([(r["zip"],r["officialContests"],r["officialCandidacies"]) for r in report["boroughComparisons"]],
                         [("11201",13,22),("11435",14,22),("10457",14,17),("10305",13,16)])
        self.assertTrue(all(r["differences"]==[] for r in report["boroughComparisons"]))
        brooklyn=next(rows for sample,rows in NYC.borough_samples() if sample["county"]=="kings")
        court=next(r for r in brooklyn if r["contest_description"].startswith("Justice"))
        self.assertIn(("betsey jean jacques",frozenset(["Democratic","Republican","Conservative"])),NYC.normalized_choices(court))

    def test_lebanon_all_thirteen_races_and_full_questions_match_each_ward(self):
        _,data,_=LEBANON.update("2026-10-21T02:00:00Z");ballot=next(iter(data["ballots"].values()))
        groups={LEBANON.contest_id(r):r for ward in [1,2,3] for r in LEBANON.groups(ward)}
        self.assertEqual((len(groups),sum(len(r["candidates"]) for r in groups.values())),(11,15))
        for ward in [1,2,3]:
            comparison=LEBANON.sample_comparison(ballot,ward)
            self.assertEqual((comparison["officialCandidateContests"],comparison["officialCandidacies"],comparison["differences"]),(13,24,[]))
            question=LEBANON.question(ward)
            self.assertIn("LEBANON SCHOOL DISTRICT (SAU #88)",question)
            self.assertIn("three-fifths (3/5) majority vote",question)
            self.assertGreater(len(question),700)
        memberships={(r["memberOcdId"],r["districtOcdId"]) for r in ballot["districtMemberships"]}
        for base in [413,414,415]:
            self.assertIn((LEBANON.PREFIX+f"sldl:{base}",LEBANON.PREFIX+"sldl:grafton_17"),memberships)
        self.assertNotIn((LEBANON.PREFIX+"county:grafton",LEBANON.PREFIX+"county:grafton/council_district:1"),memberships)

    def test_maine_all_regular_special_and_current_local_writein_names_match(self):
        _,data,report=ME.update("2026-10-21T02:00:00Z");ballot=next(iter(data["ballots"].values()))
        expected={}
        for row in ME.local_rows():
            key=ME.group_key(row)
            expected.setdefault(key,set()).add((BA01.words(row["Name"]),row.get("Party")))
        self.assertEqual((len(expected),sum(map(len,expected.values()))),(88,108))
        for key,names in expected.items():
            code,district,county=key
            contest_id="me-sos-2026-local-"+"-".join(str(x).lower() for x in [code,county,district] if x)
            held={(BA01.words(c["givenName"]+" "+c["familyName"]),c["partyLabel"]) for c in ballot["candidacies"] if c["contestId"]==contest_id}
            self.assertEqual(held,names,contest_id)
        self.assertEqual(next(c["partyLabel"] for c in ballot["candidacies"] if c["id"]=="me-sos-2026-us:4"),"Democratic")
        self.assertEqual(report["supersedingOfficialValues"][0]["previousValue"],"Democrat")
        self.assertFalse(any("Diane Langworthy" in c["familyName"] for c in ballot["candidacies"]))
        self.assertFalse(any(c["title"]=="Washington County Treasurer" for c in ballot["contests"]))
        pairs={(m["memberOcdId"],m["districtOcdId"]) for m in ballot["districtMemberships"]}
        self.assertIn((ME.BASE+"/county:cumberland",ME.BASE+"/prosecutorial_district:2"),pairs)
        self.assertIn((ME.BASE+"/county:cumberland/place:south_portland_city",ME.BASE+"/county:cumberland/council_district:4"),pairs)
        self.assertFalse(any(m.endswith("/place:portland_city") for m,d in pairs))

    def test_new_hampshire_district_inventory_and_scanned_full_candidate_groups(self):
        counts = NH.official_house_district_counts()
        self.assertEqual(sum(counts.values()), 203)
        self.assertEqual(counts["Hillsborough"], 45)
        self.assertEqual(counts["Merrimack"], 30)
        house = NH.house_groups()
        self.assertEqual((len(house), sum(len(g["candidates"]) for g in house)), (15, 60))
        self.assertEqual(sum(len(g["candidates"]) for g in NH.new_groups()), 95)
        goffstown = NH.goffstown_groups()
        self.assertEqual(next(g["candidates"] for g in goffstown if g["title"] == "Hillsborough County Sheriff"), [("Brian Newcomb", "Republican / Democratic")])
        self.assertIn(("Christopher Calhoun", "Democratic"), next(g["candidates"] for g in goffstown if g["division"] == "sldl:529"))
        with self.assertRaises(ValueError):
            NH.check_scanned_name("Invented Candidate", (BA01.SOURCES / "nh-manchester-ward-1.ocr.txt").read_text())

    def test_new_hampshire_memberships_exclude_partial_divisions_and_preserve_exact_statute_quotes(self):
        rows = NH.district_memberships("2026-10-20T00:00:00Z")
        prefix = "ocd-division/country:us/state:nh/"
        pairs = {(r["memberOcdId"], r["districtOcdId"]) for r in rows}
        self.assertIn((prefix + "sldl:521", prefix + "sldl:hillsborough_40"), pairs)
        self.assertIn((prefix + "sldl:529", prefix + "sldl:hillsborough_44"), pairs)
        self.assertIn((prefix + "place:manchester", prefix + "executive_district:4"), pairs)
        self.assertNotIn((prefix + "county:hillsborough", prefix + "county:hillsborough/council_district:3"), pairs)
        self.assertFalse(any(member == prefix + "sldl:542" and "/council_district:" in district for member, district in pairs))
        text = NH.statute_text()
        self.assertTrue(all(r["provenance"]["quote"] in text for r in rows))

    def test_new_hampshire_each_sample_matches_one_ward_question_and_both_house_contests(self):
        ballot = COVERAGE.state_ballot("NH")
        prefix = "ocd-division/country:us/state:nh"

        def select(base, senate):
            divisions = {prefix, prefix + "/county:hillsborough", prefix + "/cd:1", prefix + f"/sldu:{senate}", prefix + f"/sldl:{base}"}
            for _ in range(4):
                divisions.update(r["districtOcdId"] for r in ballot["districtMemberships"] if r["memberOcdId"] in divisions)
            contests = [c for c in ballot["contests"] if c["ocdId"] in divisions]
            ids = {c["id"] for c in contests}
            return contests, [c for c in ballot["candidacies"] if c["contestId"] in ids], [m for m in ballot["measures"] if m["contestId"] in ids]

        contests, candidates, measures = select(529, 16)
        self.assertEqual((len(contests), len(candidates), len(measures)), (15, 35, 2))
        contests, candidates, measures = select(521, 16)
        self.assertEqual((len(contests), len(candidates), len(measures)), (15, 34, 2))
        self.assertEqual(sum("Manchester School" in c["title"] for c in contests), 1)
        self.assertIn("MANCHESTER - Ward 1", next(m["questionText"] for m in measures if m.get("officialNumber") == "2"))

    def test_new_hampshire_replay_preserves_actual_capture_timestamps_for_assembler_authority(self):
        path = ROOT / "data/ballot/2026-general/nh.json"
        original = json.loads(path.read_text())
        _, replay, _ = NH.update_nh("2026-10-21T01:00:00Z")
        versions = {(r["requestedUrl"], r["rawHash"], r["retrievedAt"]) for r in original["sourceReceipt"]["sources"]}
        self.assertEqual(versions, {(r["requestedUrl"], r["rawHash"], r["retrievedAt"]) for r in replay["sourceReceipt"]["sources"]})
        keys = {(url, r["retrievedAt"]) for r in replay["sourceReceipt"]["sources"] for url in [r["requestedUrl"], r["finalUrl"]]}
        ballot = next(iter(replay["ballots"].values()))
        for field in ["contests", "candidacies", "measures", "districtMemberships"]:
            for row in ballot.get(field, []):
                if not row["id"].startswith("nh-2026"):
                    continue
                source = row["provenance"]
                self.assertIn((source["sourceUrl"], source["collectedAt"]), keys, row["id"])

    def test_concord_complete_party_columns_and_source_bound_council_scope_correction(self):
        groups = CONCORD.groups()
        self.assertEqual((len(groups), sum(len(g["candidates"]) for g in groups)), (18, 28))
        self.assertEqual(sum(len(g["candidates"]) for g in groups[:13]), 20)
        _, data, _ = CONCORD.update("2026-10-21T01:00:00Z")
        ballot = next(iter(data["ballots"].values()))
        council = next(c for c in ballot["contests"] if c["id"] == "ballot-nh-merrimack:executive-council-2")
        self.assertEqual(council["ocdId"], CONCORD.PREFIX + "executive_district:2")
        self.assertEqual(council["scopeCorrection"]["previousOcdId"], CONCORD.PREFIX + "county:merrimack/place:newbury_town")
        self.assertIn(council["scopeCorrection"]["provenance"]["quote"], NH.statute_text())
        members = {(r["memberOcdId"], r["districtOcdId"]) for r in ballot["districtMemberships"]}
        self.assertIn((CONCORD.PREFIX + "county:merrimack/place:newbury_town", council["ocdId"]), members)
        self.assertIn((CONCORD.PREFIX + "sldl:615", CONCORD.PREFIX + "place:concord/ward:1"), members)
        self.assertFalse(any(member.endswith("place:concord/ward:1") and "school_district:" in district for member, district in members))
        self.assertEqual(len([m for m in ballot["measures"] if m["contestId"].startswith("nh-2026-concord")]), 11)
        self.assertIn("MERRIMACK VALLEY SCHOOL DISTRICT", next(m["questionText"] for m in ballot["measures"] if m["contestId"] == "nh-2026-concord-ward-1-hb1300-property-tax-growth"))

    def test_every_concord_general_race_including_retained_cd2_has_its_full_source_candidate_set(self):
        ballot = COVERAGE.state_ballot("NH")
        for ward in range(1, 11):
            comparison = CONCORD.general_sample_comparison(ballot, ward)
            self.assertEqual(comparison["officialCandidateContests"], 13)
            self.assertEqual(comparison["differences"], [], f"Ward{ward}")
        self.assertEqual(CONCORD.general_sample_comparison(ballot, 1)["officialCandidacies"], 25)
        district_two = [c for c in ballot["candidacies"] if c["contestId"] == "ballot-nh-merrimack:us-house-2"]
        self.assertEqual(len(district_two), 3)
        self.assertTrue(any(c["id"] == "nh-2026-general-us-house-2:mahrou-robbie" and c["partyLabel"] == "Independent" for c in district_two))

    def test_all_northeast_replays_retain_cited_capture_versions(self):
        for update in [BA01.update_nj, BA01.update_philadelphia, BA01.update_ma,
                       BA01.update_vt, BA01.update_ny, PA.update_pa, MA.update, CONCORD.update, NY.update, NYC.update, LEBANON.update, ME.update]:
            path, replay, _ = update("2026-10-21T01:00:00Z")
            original = json.loads(path.read_text())
            identity = lambda r: (r["requestedUrl"], r["finalUrl"], r["rawHash"], r["retrievedAt"])
            self.assertEqual({identity(r) for r in original["sourceReceipt"]["sources"]},
                             {identity(r) for r in replay["sourceReceipt"]["sources"]}, path.name)
            keys = {(url, r["retrievedAt"]) for r in replay["sourceReceipt"]["sources"] if r["httpStatus"] == 200
                    for url in [r["requestedUrl"], r["finalUrl"]]}
            for ballot in replay["ballots"].values():
                for field in ["contests", "candidacies", "measures", "districtMemberships"]:
                    for row in ballot.get(field, []):
                        source = row.get("provenance", {})
                        # Legacy date-only records are preserved from the prior publication.
                        # Every timestamped verified input must retain its exact capture receipt.
                        if "T" in source.get("collectedAt", ""):
                            self.assertIn((source["sourceUrl"], source["collectedAt"]), keys, row["id"])

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
