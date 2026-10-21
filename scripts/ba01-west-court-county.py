#!/usr/bin/env python3
"""Replay official Fargo sample and NM/MT judicial rosters with explicit electorates."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import csv
import gzip
import hashlib
import io
import json
import re

import runpy

capture_sha256 = runpy.run_path(str(Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/ba01-west-evidence"


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def captured(name):
    directory = EVIDENCE / "county-captures"
    source = next(row for row in json.loads((directory / "manifest.json").read_text()) if row["name"] == name)
    raw = gzip.decompress((directory / source["file"]).read_bytes())
    text = (directory / source["textSnapshot"]).read_bytes()
    assert capture_sha256(raw) == source["rawHash"], name
    assert hashlib.sha256(text).hexdigest() == source["textHash"], name
    return text.decode(), source


def state_capture(filename):
    directory = EVIDENCE / "captures"
    source = next(row for row in json.loads((directory / "manifest.json").read_text()) if row["file"] == filename + ".gz")
    raw = gzip.decompress((directory / source["file"]).read_bytes())
    assert capture_sha256(raw) == source["uncompressedHash"]
    return raw, {"sourceUrl": source["sourceUrl"], "finalUrl": source["sourceUrl"],
        "rawHash": source["uncompressedHash"], "retrievedAt": source["retrievedOrExtractedAt"], "httpStatus": 200}


def provenance(source, publisher, quote):
    return {"sourceUrl": source["sourceUrl"], "sourceOrg": publisher, "collectedAt": source["retrievedAt"],
        "verifiedAt": source["retrievedAt"], "quote": quote}


def receipt(package, source, publisher, reviewed, source_class="ELECTION_AUTHORITY"):
    row = {"requestedUrl": source["sourceUrl"], "finalUrl": source.get("finalUrl", source["sourceUrl"]),
        "rawHash": source["rawHash"], "retrievedAt": source["retrievedAt"], "httpStatus": source["httpStatus"],
        "publisher": publisher, "sourceClass": source_class, "reviewedEvidence": reviewed, "reviewOutcome": "SUPPORTED"}
    # A new capture with identical bytes must never replace an older cited version.
    held = next((s for s in package["sourceReceipt"]["sources"] if s["rawHash"] == row["rawHash"] and
        s["retrievedAt"] == row["retrievedAt"] and row["requestedUrl"] in {s["requestedUrl"], s["finalUrl"]}), None)
    # Reusing a capture must preserve its original publisher/class and review record.
    # A friendly alias is not a new observation and must not revise published authority.
    if held is None:
        package["sourceReceipt"]["sources"].append(row)


def add(package, key, row):
    ballot = next(iter(package["ballots"].values()))
    if not any(held["id"] == row["id"] for held in ballot.setdefault(key, [])):
        ballot[key].append(row)


def race(package, identifier, office, ocd_id, names, source, publisher, quote, retention=False, years=None):
    ballot = next(iter(package["ballots"].values()))
    proof = provenance(source, publisher, quote)
    add(package, "contests", {"id": identifier, "electionId": ballot["election"]["id"], "ocdId": ocd_id,
        "divisionVintage": "2026", "title": office, "type": "RETENTION" if retention else "CANDIDACY",
        "candidateListComplete": True, "voteFor": 1, "termYears": years, "scopeNote": None, "provenance": proof})
    for name, party in names:
        add(package, "candidacies", {"id": identifier + "-" + slug(name), "contestId": identifier,
            "familyName": name, "givenName": "", "partyLabel": party, "slogan": None, "incumbent": None,
            "websiteUrl": None, "provenance": proof})


def member(package, state, county, district, source, publisher, quote):
    add(package, "districtMemberships", {"id": f"ba01-{state}-{county}-in-{slug(district)}",
        "memberOcdId": f"ocd-division/country:us/state:{state}/county:{county}", "districtOcdId": district,
        "provenance": provenance(source, publisher, quote)})


def north_dakota(package):
    text, source = captured("nd-fargo-cityhall-sample")
    publisher = "North Dakota Secretary of State"
    assert "SAMPLE GENERAL ELECTION BALLOT" in text and "09440101" in text and "#44-01 Fargo" in text
    raw, _ = state_capture("nd-all-rows.json")
    certified_rows = json.loads(raw)
    judges = [(1, "Susan L Bailey"), (5, "Reid Brady"), (7, "Wade Webb"), (9, "Stephannie Stiel"),
        (10, "Stephanie R Hayden"), (11, "Cherie L Clark")]
    court = "ocd-division/country:us/state:nd/judicial_district:east_central"
    for number, name in judges:
        office = f"Judge of the District Court No. {number} — East Central Judicial District"
        if number in {10, 11}:
            office += " — Unexpired 4-Year Term"
        assert name in text
        assert any(name in row and any("East Central" in cell for cell in row) for row in certified_rows)
        quote = office + "\nVote for no more than ONE name\n" + name
        race(package, f"nd-east-central-general-2026-judge-{number}", office, court, [(name, None)], source, publisher, quote)
    scope_text, scope = captured("nd-east-central-rule")
    scope_quote = "East Central Judicial District consists of the counties of Cass, Steele and Traill."
    assert scope_quote in re.sub(r"\s+", " ", scope_text)
    for county in ["cass", "steele", "traill"]:
        member(package, "nd", county, court, scope, "North Dakota Supreme Court", scope_quote)
    receipt(package, scope, "North Dakota Supreme Court", "Rule6(e) explicitly names all three counties comprising EastCentral.", "OFFICIAL_PUBLISHER")
    county = "ocd-division/country:us/state:nd/county:cass"
    offices = [("County State's Attorney", ["Kim Hegvik"]), ("County Sheriff", ["Jesse Jahner"]),
        ("Director, Garrison Diversion Conservancy", ["Jeff LeDoux"]),
        ("County Official Newspaper", ["The Cass County Reporter", "The Forum of Fargo-Moorhead"])]
    for office, names in offices:
        for name in names:
            assert name in text and any(name in row for row in certified_rows)
        race(package, "nd-cass-general-2026-" + slug(office), office, county, [(name, None) for name in names], source,
            publisher, office + "\nVote for no more than ONE name\n" + "\n".join(names))
    garrison_text, garrison = captured("nd-garrison-code")
    quote = "A director of the Garrison Diversion Conservancy District must be nominated and elected in each county in the district."
    assert quote in re.sub(r"\s+", " ", garrison_text)
    receipt(package, garrison, "North Dakota Legislative Assembly", "NDCC61-24-03 verifies each county elects its own Garrison director.", "OFFICIAL_PUBLISHER")
    # The official candidate table explicitly distinguishes at-large residency seats from district-elected seats.
    official_raw, official_source = state_capture("nd-all")
    for number, name in [(2, "Tony Grindberg"), (4, "Jim Prochniak")]:
        candidate_row = next(row for row in certified_rows if name in row)
        assert candidate_row[2] == "County Commissioner At Large By District" and candidate_row[4] == "Cass"
        assert name in text
        # Confirm classification and name appear together in the original official table row.
        original_rows = re.findall(r"<tr\b[^>]*>.*?</tr>", official_raw.decode(), re.S | re.I)
        assert any(name in row and "County Commissioner At Large By District" in row and "Cass" in row for row in original_rows)
        race(package, f"nd-cass-general-2026-commissioner-{number}", f"County Commissioner Cass District {number}", county,
            [(name, None)], source, publisher, f"County Commissioner Cass District {number}\nVote for no more than ONE name\n{name}")
    receipt(package, official_source, publisher, "Both Cass commissioner2/4 candidate rows explicitly classify the office as CountyCommissionerAtLargeByDistrict, not CountyCommissionerByDistrict; full original HTML row and exact current precinct sample are replayed together.")
    soil_text, soil = captured("nd-soil-district-map")
    assert "North Dakota Soil Conservation District Areas" in soil_text and "Cass" in soil_text
    assert "Tyler Zimmerman" in text and any("Tyler Zimmerman" in row for row in certified_rows)
    race(package, "nd-cass-general-2026-soil-conservation-supervisor", "Supervisor, Cass County Soil Conservation District", county,
        [("Tyler Zimmerman", None)], source, publisher, "Supervisor, Soil Conservation District\nVote for no more than ONE name\nTyler Zimmerman")
    receipt(package, soil, "USDA Natural Resources Conservation Service", "Official SoilConservationDistrictAreas map labels Cass as one county-shaped district, with no internal district boundary; visually reviewed against its legend. Current Cass sample includes its supervisor.", "OFFICIAL_PUBLISHER")
    # School district name follows the existing Census-based school identity resolver.
    census_text, census = captured("nd-fargo-cityhall-census")
    geography = json.loads(census_text)["result"]["addressMatches"][0]["geographies"]["Unified School Districts"][0]
    assert geography["NAME"] == "Fargo Public School District 1" and geography["GEOID"] == "3806780"
    question = re.search(r"The current Fargo Public School\s+District’s general fund levy.*?December 31, 2027\?", text, re.S)[0]
    question = re.sub(r"\s+", " ", question).strip()
    # Extract the measure's right-hand column without the neighboring statewide measure.
    assert question == ("The current Fargo Public School District’s general fund levy is 127.00 mills. The current statutory general "
        "fund limitation is seventy mills on the dollar of the taxable valuation of the school district. Shall Fargo Public School District No. 1 "
        "have a general fund mill levy of 110.00 mills effective December 31, 2027?")
    ballot = next(iter(package["ballots"].values()))
    identifier = "nd-fargo-school-district-1-general-2026-measure-1"
    proof = provenance(source, publisher, question + "\nYes — Means you approve the measure as summarized above.\nNo — Means you reject the measure as summarized above.")
    add(package, "contests", {"id": identifier, "electionId": ballot["election"]["id"],
        "ocdId": "ocd-division/country:us/state:nd/school_district:fargo_public_school_district_1", "divisionVintage": "2026",
        "title": "Fargo School District #1 — School District Measure No. 1", "type": "MEASURE", "voteFor": None,
        "termYears": None, "measureTextUrl": source["sourceUrl"], "scopeNote": None, "provenance": proof})
    add(package, "measures", {"id": identifier + "#question", "contestId": identifier, "officialNumber": "1",
        "questionText": question, "officialStatement": None, "provenance": proof})
    if not any(row["contestId"] == identifier for row in ballot.setdefault("measureRecords", [])):
        ballot["measureRecords"].append({"contestId": identifier, "whatItDoes": question,
            "yesMeans": "Means you approve the measure as summarized above.", "noMeans": "Means you reject the measure as summarized above.",
            "parts": [], "sourceUrl": source["sourceUrl"], "sourceHash": source["rawHash"], "sourceHashKind": "CAPTURE_BYTES", "writtenAt": source["retrievedAt"]})
    receipt(package, census, "U.S. Census Bureau", "Public FargoCityHall address resolves to FargoPublicSchoolDistrict1, GEOID3806780; matches school district name on sample.", "OFFICIAL_PUBLISHER")
    receipt(package, source, publisher, "Official2026General public-address sample for precinct09440101:26contests/35printed choices. Every local named choice is also present in the complete general certified candidate table. Blank write-in lines are not invented candidates.")


def new_mexico(package):
    raw, source = state_capture("nm")
    rows, _ = state_capture("nm-rows.json")
    rows = json.loads(rows)
    assert b"2026 General Election Contest/Candidate List" in raw
    selected = [row for row in rows if len(row) > 22 and row[3] == "Bernalillo" and row[21] == "Qualified" and
        (row[1] in {"County Sheriff", "County Assessor", "Probate Judge", "District Court Judge", "Judge of the Metropolitan Court"} or row[1].startswith("Judicial Retention"))]
    assert len(selected) == 28 and len({row[0] for row in selected}) == 26
    district_text, district_source = captured("nm-courts-districts")
    quote = "Second Judicial District For Bernalillo County"
    assert quote in re.sub(r"\s+", " ", district_text)
    district = "ocd-division/country:us/state:nm/judicial_district:2"
    member(package, "nm", "bernalillo", district, district_source, "New Mexico Courts", quote)
    metro_text, metro_source = captured("nm-metro-scope")
    metro_quote = "Bernalillo County Metropolitan Court For Bernalillo County"
    assert metro_quote in re.sub(r"\s+", " ", metro_text)
    grouped = defaultdict(list)
    for row in selected:
        grouped[row[0]].append(row)
    for office, candidates in grouped.items():
        is_district = "District Court Judge" in office
        ocd = district if is_district else "ocd-division/country:us/state:nm/county:bernalillo"
        quote = "2026 General Election Contest/Candidate List\n" + "\n".join(" | ".join([row[0], row[3], row[4], row[8], row[21]]) for row in candidates)
        race(package, "nm-bernalillo-general-2026-" + slug(office), office, ocd,
            [(row[4], row[8] or None) for row in candidates], source, "New Mexico Secretary of State", quote,
            retention=office.startswith("Judicial Retention"))
    receipt(package, source, "New Mexico Secretary of State", "CompleteGENERAL2026 roster: all qualified Bernalillo countywide offices, SecondDistrict judicial elections/retentions and metropolitan elections/retentions,26contests/28candidates; commissioner districts excluded.")
    receipt(package, district_source, "New Mexico Courts", "Official court directory explicitly assigns SecondJudicialDistrict to BernalilloCounty.", "OFFICIAL_PUBLISHER")
    receipt(package, metro_source, "New Mexico Courts", "Official court directory explicitly assigns MetropolitanCourt to BernalilloCounty.", "OFFICIAL_PUBLISHER")


def montana(package):
    raw, source = state_capture("mt-browser-trusted-export")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    selected = [row for row in rows if row["Status"] == "FILED" and row["District Type"] == "Judicial"]
    assert len(selected) == 13 and len({row["Race"] for row in selected}) == 12
    scope_text, scope = captured("mt-judicial-districts-code")
    scope_text = re.sub(r"\s+", " ", scope_text)
    rule_text, rule = captured("mt-judicial-retention-constitution")
    assert "If an incumbent files for election and there is no election contest for the office" in rule_text
    legend_text, legend = captured("mt-roster-page")
    assert "* = Incumbent" in legend_text
    groups = defaultdict(list)
    for row in selected:
        groups[row["Race"]].append(row)
    for office, candidates in groups.items():
        district_number = int(re.search(r"DISTRICT (\d+)", office)[1])
        district = f"ocd-division/country:us/state:mt/judicial_district:{district_number}"
        counties = re.search(rf"\({district_number}\) {district_number}(?:st|nd|rd|th) district: (.*?);", scope_text)[1]
        assert counties.endswith((" County", " Counties"))
        counties = re.sub(r" Count(?:y|ies)$", "", counties).replace("Lewis and Clark", "Lewis_and_Clark")
        for county in re.split(r",\s*(?:and\s+)?|\s+and\s+", counties):
            county_id = county.strip().lower().replace(" ", "_")
            member(package, "mt", county_id, district, scope, "Montana Legislative Services Division",
                re.search(rf"\({district_number}\) {district_number}(?:st|nd|rd|th) district: .*?;", scope_text)[0])
        retained = len(candidates) == 1 and candidates[0]["Name"].startswith("*")
        title = office + (" — Retention" if retained else "")
        quote = "\n".join(" | ".join(row[key] for key in ["Status", "District", "Race", "Term Type", "Term Length", "Name", "Party Preference"]) for row in candidates)
        race(package, "mt-general-2026-" + slug(office), title, district,
            [(row["Name"].lstrip("*"), row["Party Preference"] or None) for row in candidates], source,
            "Montana Secretary of State", quote, retention=retained, years=int(candidates[0]["Term Length"]))
    receipt(package, source, "Montana Secretary of State", "Complete current general public CSV: every FILED judicial candidate,12races/13names. Retention applies only to unopposed marked incumbents per official legend and ConstitutionVII8(3).")
    receipt(package, legend, "Montana Secretary of State", "Candidate portal explicitly defines '* = Incumbent'.")
    receipt(package, scope, "Montana Legislative Services Division", "MCA3-5-101 explicitly lists every county within each judicial district; county memberships are directional.", "OFFICIAL_PUBLISHER")
    receipt(package, rule, "Montana Legislative Services Division", "ConstitutionVII8(3) explicitly places unopposed incumbents on approval/rejection ballot.", "OFFICIAL_PUBLISHER")


def replay(state, parser):
    file = ROOT / f"data/ballot/2026-general/{state}.json"
    package = json.loads(file.read_text())
    ballot = next(iter(package["ballots"].values()))
    keys = ["contests", "candidacies", "measures"]
    before = {key: len(ballot[key]) for key in keys}
    prior = {key: {row["id"]: row for row in ballot[key]} for key in keys}
    parser(package)
    for key in keys:
        current = {row["id"]: row for row in ballot[key]}
        assert all(current.get(identifier) == row for identifier, row in prior[key].items()), (state, key, "Changed held record")
    package["sourceReceipt"]["reviewedAt"] = max([datetime.now(timezone.utc)] + [datetime.fromisoformat(row["retrievedAt"].replace("Z", "+00:00")) for row in package["sourceReceipt"]["sources"]]).isoformat()
    package["sourceReceipt"]["reviewedBy"] = "Codex BA-01 official court/county source replay"
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    return {"state": state, **{key + "Added": len(ballot[key]) - before[key] for key in keys}}


if __name__ == "__main__":
    for state, parser in [("nd", north_dakota), ("nm", new_mexico), ("mt", montana)]:
        print(replay(state, parser))
