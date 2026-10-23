"""Replay BL-02's saved official geography lists into state ballot data only."""
import argparse
import hashlib
import json
import re
import runpy
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from lxml import html

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "data/ballot/sources/bl02-west"
AT = datetime.now(timezone.utc).isoformat()
capture_sha256 = runpy.run_path(str(ROOT / "scripts/ba01_evidence.py"))["capture_sha256"]


def slug(value):
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def saved(name, extension):
    raw = (SOURCES / f"{name}.{extension}").read_bytes()
    meta = json.loads((SOURCES / f"{name}.source.json").read_text())
    assert meta["httpStatus"] == 200 and hashlib.sha256(raw).hexdigest() == meta["rawHash"]
    return raw, meta


def provenance(meta, publisher, quote):
    return dict(sourceUrl=meta["finalUrl"], sourceOrg=publisher,
                collectedAt=meta["retrievedAt"], verifiedAt=AT, quote=quote)


def receipt(data, meta, publisher, explanation):
    row = dict(meta, publisher=publisher, sourceClass="OFFICIAL_PUBLISHER",
               reviewOutcome="SUPPORTED", reviewedEvidence=explanation)
    if not any(s["rawHash"] == row["rawHash"] and s["finalUrl"] == row["finalUrl"]
               for s in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append(row)


def member(ballot, state, division, district, proof):
    base = f"ocd-division/country:us/state:{state}/"
    row = dict(id=f"bl02-{state}-{slug(division)}-to-{slug(district)}",
               memberOcdId=base + division, districtOcdId=base + district, provenance=proof)
    held = ballot.setdefault("districtMemberships", [])
    if not any(m["memberOcdId"] == row["memberOcdId"] and m["districtOcdId"] == row["districtOcdId"] for m in held):
        held.append(row)
        return 1
    return 0


def alaska(data, ballot, zip_divisions):
    raw, meta = saved("ak-communities-gis", "json")
    source = json.loads(raw)
    assert source["displayFieldName"] == "CommunityName" and len(source["features"]) == 466
    communities = {}
    for feature in source["features"]:
        row = feature["attributes"]
        name, district = row["CommunityName"], row["JudicialDistrict"]
        assert district in [1, 2, 3, 4]
        communities.setdefault(slug(name), []).append((name, district))
        if name.startswith("Saint "):
            communities.setdefault("st_" + slug(name[6:]), []).append((name, district))
        # The government's own row explicitly supplies this current-name alias.
        if name == "Barrow (Utqiagvik)":
            communities.setdefault("utqiagvik", []).append((name, district))
    added = Counter()
    unmatched = []
    for division in sorted(d for d in zip_divisions if d.startswith("ocd-division/country:us/state:ak/place:")):
        code = division.rsplit(":", 1)[1]
        matches = communities.get(code, [])
        # A supplied list of communities is not evidence for an alias/merged CDP.
        # Preserve those blanks rather than infer from a nearby place or point.
        if not matches or len({district for _, district in matches}) != 1:
            unmatched.append(division)
            continue
        name, district = matches[0]
        added[district] += member(ballot, "ak", "place:" + code, f"judicial_district:{district}",
                                  provenance(meta, "Alaska Department of Commerce, Community, and Economic Development",
                                             f"CommunityName: {name}; JudicialDistrict: {district}"))
    receipt(data, meta, "Alaska Department of Commerce, Community, and Economic Development",
            "Saved official Judicial Districts service query. Code checks all466 community rows and maps only exact normalized community names already held in the ZIP index. No borough or census-area membership is inferred from a community point.")
    all_rows = [row for row in ballot["districtMemberships"] if row["id"].startswith("bl02-ak-")]
    return dict(addedMemberships=len(all_rows), byDistrict=dict(Counter(int(row["districtOcdId"].rsplit(":",1)[1]) for row in all_rows)), unmatchedCommunityAliases=unmatched,
                wholeCountyMembershipsAdded=0,
                countyBoundaryNote="Alaska judicial districts are community electorates; borough/census-area boundaries are not asserted by this point service. Only listed community memberships are added.")


def california(data, ballot):
    raw, meta = saved("ca-boe", "html")
    doc = html.fromstring(raw)
    groups = {}
    for heading in doc.xpath("//h3"):
        match = re.fullmatch(r"District ([1-4])", heading.text_content().strip())
        if match:
            paragraph = heading.getnext()
            names = [n.strip() for n in paragraph.text_content().split(",")]
            assert names and all(re.fullmatch(r"[A-Za-z ]+", n) for n in names)
            groups[int(match[1])] = names
    assert set(groups) == {1, 2, 3, 4}
    counts = Counter(name for names in groups.values() for name in names)
    assert len(counts) == 58 and {name for name, count in counts.items() if count > 1} == {"San Bernardino"}
    added = 0
    for district, names in groups.items():
        for name in names:
            if counts[name] == 1:
                added += member(ballot, "ca", "county:" + slug(name), f"board_of_equalization:{district}",
                                provenance(meta, "California Secretary of State", f"District {district}: " + ", ".join(names)))
    receipt(data, meta, "California Secretary of State",
            "Official2026General voter guide lists counties by Board of Equalization district. Code maps57 whole counties. SanBernardino appears in1and4 and is explicitly excluded from whole-county membership.")

    census_raw, census_meta = saved("ca-burbank-census", "json")
    census = json.loads(census_raw)
    city = next(r for r in census[1:] if r[0] == "Burbank city, California")
    assert city[1:] == ["06", "08954"]
    added += member(ballot, "ca", "place:burbank_0608954", "place:burbank",
                    provenance(census_meta, "U.S. Census Bureau", "Burbank city, California; state06; place08954"))
    receipt(data, census_meta, "U.S. Census Bureau", "Census NAME response distinguishes Burbank city0608954 from Burbank CDP0608968. Only the city's disambiguated ZIP division aliases the city ballot electorate.")

    old_sources = data["sourceReceipt"]["sources"]
    candidate_source = next(s for s in old_sources if s["finalUrl"] == "https://www.sf.gov/candidates-november-3-2026-general-election")
    vip_source = next(s for s in old_sources if s["finalUrl"] == "https://media.api.sf.gov/documents/N26_EN_VIP.pdf")
    candidate_bytes = (ROOT / "data/ballot/sources/ba-01/ca/sf-candidates.html").read_bytes()
    assert capture_sha256(candidate_bytes) == candidate_source["rawHash"]
    candidates = html.fromstring(candidate_bytes)
    candidate_text = " ".join(candidates.text_content().split())
    quote = "BART Board, District 81 person has qualified for this contest on the November 3, 2026 ballot.Sara Barz"
    assert quote in candidate_text
    vip = (ROOT / "data/ballot/sources/ba-01/ca/sf-vip.txt").read_text()
    vip_manifest = next(s for s in json.loads((ROOT / "data/ballot/sources/ba-01/ca/sources.json").read_text()) if s["file"] == "sf-vip.txt")
    assert capture_sha256(vip.encode()) == vip_manifest["textHash"] and vip_manifest["rawHash"] == vip_source["rawHash"]
    assert "November 3, 2026 Election Ballot" in vip and "Candidate for BART Director, District 8\n SARA BARZ" in vip
    identifier = "ca-sf-2026-general-bart-director-district-8"
    district = "ocd-division/country:us/state:ca/special_district:bay_area_rapid_transit_district/district:8"
    proof = provenance(candidate_source, "San Francisco Department of Elections", quote)
    proof["collectedAt"] = candidate_source["retrievedAt"]
    if not any(c["id"] == identifier for c in ballot["contests"]):
        ballot["contests"].append(dict(id=identifier, electionId=ballot["election"]["id"], ocdId=district,
            divisionVintage="2026", title="BART Director, District 8", type="CANDIDACY", voteFor=1,
            termYears=None, scopeNote=None, candidateListComplete=True,
            provenance=provenance(vip_source, "San Francisco Department of Elections", "November 3, 2026 Election Ballot: BART Director, District 8; Candidate for BART Director, District 8: SARA BARZ")))
        ballot["candidacies"].append(dict(id=identifier + "-sara-barz", contestId=identifier,
            givenName="Sara", familyName="Barz", partyLabel=None, slogan=None, incumbent=None,
            websiteUrl="https://www.SaraBarz.com", provenance=proof))
    assert [c["givenName"] + " " + c["familyName"] for c in ballot["candidacies"] if c["contestId"] == identifier] == ["Sara Barz"]
    return dict(addedMemberships=len([row for row in ballot["districtMemberships"] if row["id"].startswith("bl02-ca-")]), splitCounties=[dict(county="San Bernardino", districts=[1,4],
                reason="Listed in both official BOE districts; no whole-county membership added.")],
                specialDistrictContest=identifier, specialDistrictOcdId=district,
                specialDistrictCandidates=["Sara Barz"],
                splitSpecialDistrict=dict(county="San Francisco", district="BART8", reason="VIP states BART7/9 voters do not receive the BART8 contest. No whole-SanFrancisco membership added; reader must use official boundary data."))


def oregon(data, ballot):
    raw, meta = saved("or-fairview-census", "json")
    source = json.loads(raw)
    city = next(r for r in source[1:] if r[0] == "Fairview city, Oregon")
    assert city[1:] == ["41", "24250"]
    added = member(ballot, "or", "place:fairview_4124250", "place:fairview",
                   provenance(meta, "U.S. Census Bureau", "Fairview city, Oregon; state41; place24250"))
    receipt(data, meta, "U.S. Census Bureau", "Census NAME response distinguishes Fairview city4124250 from Fairview CDP4124300. Only the city aliases the city ballot electorate.")
    splits = []
    for name, publisher, token in [("or-portland-current", "City of Portland", "four geographic voting districts"),
                                    ("or-multnomah-current", "Multnomah County", "District 2")]:
        raw, meta = saved(name, "html")
        text = " ".join(html.fromstring(raw).text_content().split())
        assert token in text
        receipt(data, meta, publisher, "Official boundary description retained to document a split electorate. No whole county or whole Portland membership is asserted for a district occupying only part of it.")
        splits.append(dict(sourceUrl=meta["finalUrl"], county="Multnomah", city="Portland",
                           districtType="Portland council" if "portland" in name else "Multnomah county commission",
                           reason="Official boundary descriptions divide Portland/Multnomah; whole-city/county membership would show races outside the electorate."))
    districts = ["county:multnomah/council_district:2", "place:portland/council_district:3", "place:portland/council_district:4"]
    mapped = {m["districtOcdId"] for m in ballot["districtMemberships"]}
    return dict(addedMemberships=len([row for row in ballot["districtMemberships"] if row["id"].startswith("bl02-or-")]), splitCounties=splits,
                districtsWithoutWholePlaceMemberships=[d for d in districts if "ocd-division/country:us/state:or/" + d not in mapped],
                boundaryStatus="Exact official resolver polygons and the whole MaywoodPark membership are prepared by scripts/bl02-pacific-councils.py; see its report for publication status.")


def main(write):
    zip_divisions = set()
    for path in (ROOT / "data/derived/zip-divisions").glob("[0-9]*.json"):
        zip_divisions.update(json.loads(path.read_text())["divisions"])
    results = {}
    for state, build in [("ak", alaska), ("ca", california), ("or", oregon)]:
        path = ROOT / f"data/ballot/2026-general/{state}.json"
        data = json.loads(path.read_text())
        ballot = next(iter(data["ballots"].values()))
        before = {field: {r["id"]: r.copy() for r in ballot.get(field, [])} for field in ["contests", "candidacies", "measures"]}
        results[state.upper()] = build(data, ballot, zip_divisions) if state == "ak" else build(data, ballot)
        for field, rows in before.items():
            held = {r["id"]: r for r in ballot.get(field, [])}
            assert all(held.get(key) == row for key, row in rows.items()), (state, field)
        data["sourceReceipt"]["reviewedAt"] = AT
        data["sourceReceipt"]["reviewedBy"] = "bl02-official-district-memberships"
        if write:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    report = dict(checkedAt=AT, states=results,
                  method="Saved official district lists; only whole named places/counties. Exact Census city codes repair ambiguous place names. Existing contest/candidate/measure IDs retained.",
                  acquisitionFailures=[dict(url="https://courts.alaska.gov/shc/probate/docs/shs-pr-communities.pdf", result="HTTP200 RequestRejected HTML; not used as evidence", replacement="Official Alaska Commerce Judicial Districts GIS community table")])
    if write:
        (ROOT / "data/ballot/reports/bl02-west-memberships.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    main(parser.parse_args().write)
