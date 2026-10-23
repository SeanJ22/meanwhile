"""Replay source-backed whole-place ballot memberships; never widen a split place.

The Delaware spatial replay needs Shapely (an acquisition tool, not app runtime).
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
from lxml import html

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/bl02-east"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()


def normalized(value):
    value = re.sub(r"\b(town|city|village|township|plantation|cdp|ut)\b", "", value.replace("_", " "), flags=re.I)
    return re.sub(r"[^a-z0-9]", "", value.lower())


def read_capture(path, metadata):
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    meta = json.loads(metadata.read_text())
    assert meta["httpStatus"] == 200
    assert hashlib.sha256(raw).hexdigest() == meta["rawHash"], str(path)
    return raw, meta


def all_divisions():
    ids = set()
    for path in (ROOT / "data/derived/zip-divisions").glob("[0-9][0-9].json"):
        ids.update(json.loads(path.read_text())["divisions"])
    return ids


def update(state, ids):
    path = ROOT / f"data/ballot/2026-general/{state}.json"
    document = json.loads(path.read_text())
    ballot = next(iter(document["ballots"].values()))
    base = "ocd-division/country:us/state:" + state
    aliases = collections.defaultdict(list)
    for division in ids:
        if division.startswith(base + "/") and "/place:" in division:
            aliases[normalized(division.split("/place:")[-1])].append(division)
    added, flags, sources = [], [], []
    before = {(row["memberOcdId"], row["districtOcdId"]) for row in ballot.get("districtMemberships", [])}

    def add(name, district, meta, publisher, quote=None):
        for member in sorted(aliases[normalized(name)]):
            county = re.search(r"/county:([^/]+)", district)
            member_county = re.search(r"/county:([^/]+)", member)
            if county and member_county and county[1] != member_county[1]:
                continue
            pair = member, district
            if pair in before:
                continue
            before.add(pair)
            row = {"id": "bl02:" + hashlib.sha256((member + "->" + district).encode()).hexdigest()[:24],
                   "memberOcdId": member, "districtOcdId": district,
                   "provenance": {"sourceUrl": meta["finalUrl"], "sourceOrg": publisher,
                                  "collectedAt": meta["retrievedAt"], "verifiedAt": NOW}}
            if quote:
                row["provenance"]["quote"] = quote
            ballot.setdefault("districtMemberships", []).append(row)
            added.append(row)

    def source(meta, publisher, reviewed):
        receipt = {"requestedUrl": meta.get("requestedUrl", meta.get("url")), "finalUrl": meta["finalUrl"],
                   "publisher": publisher, "sourceClass": "OFFICIAL_PUBLISHER", "retrievedAt": meta["retrievedAt"],
                   "httpStatus": 200, "rawHash": meta["rawHash"], "reviewedEvidence": reviewed}
        if not any(row["rawHash"] == receipt["rawHash"] and row["finalUrl"] == receipt["finalUrl"] for row in document["sourceReceipt"]["sources"]):
            document["sourceReceipt"]["sources"].append(receipt)
        sources.append(receipt)

    if state == "oh":
        raw, meta = read_capture(EVIDENCE / "oh-council.html", EVIDENCE / "oh-council.meta.json")
        text = " ".join(html.fromstring(raw).text_content().split())
        rules = {1: ["Bay Village", "Fairview Park", "North Olmsted", "Rocky River", "Westlake"],
                 3: ["Brooklyn"], 5: ["Berea", "North Royalton", "Olmsted Falls", "Strongsville", "Olmsted Township"],
                 9: ["Bedford", "Bedford Heights", "Pepper Pike", "Shaker Heights", "Warrensville Heights", "Highland Hills", "North Randall", "Orange", "Woodmere"],
                 11: ["Beachwood", "Euclid", "Highland Heights", "Lyndhurst", "Richmond Heights", "South Euclid"]}
        for number, names in rules.items():
            match = re.search(rf"Cuyahoga County Council District {number}Serving (.*?)Office:", text)
            assert match, number
            quote = match[0].removesuffix("Office:")
            for name in names:
                assert name in quote, (number, name)
                add(name, base + f"/county:cuyahoga/council_district:{number}", meta, "Cuyahoga County Council", quote)
        for number in [1, 3, 5, 7, 9, 11]:
            flags.append({"districtOcdId": base + f"/county:cuyahoga/council_district:{number}", "splitCounty": "cuyahoga",
                          "splitCity": "cleveland" if number in [3, 7, 9] else None,
                          "remaining": "District 7 contains only Cleveland precincts; needs precise ward/precinct or polygon geography." if number == 7 else "Whole municipalities added; split Cleveland precincts remain address-geography work." if number in [3, 9] else None})
        source(meta, "Cuyahoga County Council", "Saved current official council directory at data/ballot/evidence/bl02-east/oh-council.html. Replay reads each district's Serving paragraph and adds only explicitly named whole municipalities. Cleveland ward/precinct portions never become whole-city memberships.")
    elif state == "me":
        spec = importlib.util.spec_from_file_location("me_local", ROOT / "scripts/ba01-northeast-me-local.py")
        common = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(common)
        folder = ROOT / "data/ballot/sources/ba01-northeast"
        raw, meta = read_capture(folder / "me-county-districts.html", folder / "me-county-districts.html.capture.json")
        meta["finalUrl"] = meta.get("finalUrl", meta.get("url"))
        text = common.html_text(folder / "me-county-districts.html")
        current = text.split("Beginning November 5, 2024,", 1)[1].split("Creation of Hancock", 1)[0]
        for number in [4, 5]:
            quote = re.search(rf"Commissioner District Number {number} consists of (.*?)\. The term", current, re.S)[0]
            quote = " ".join(quote.split())
            names = re.search(r"divisions(?: and unorganized territories)? of (.*?)\. The term", quote)[1]
            for name in re.split(r", | and ", names):
                add(name, base + f"/county:franklin/council_district:{number}", meta, "Maine Legislature", quote.removesuffix(" The term"))
        for county, number, city in [("androscoggin", 2, "Lewiston"), ("androscoggin", 5, "Auburn"), ("cumberland", 5, "Portland")]:
            flags.append({"districtOcdId": base + f"/county:{county}/council_district:{number}", "splitCounty": county, "splitCity": city,
                          "remaining": "Statute lists only census units within this city, with no whole municipality; needs census-block or polygon geography."})
        for number in [4, 5]:
            flags.append({"districtOcdId": base + f"/county:franklin/council_district:{number}", "splitCounty": "franklin", "remaining": None})
        for registry in ["northern", "southern"]:
            flags.append({"districtOcdId": base + "/county:aroostook/registry_district:" + registry, "splitCounty": "aroostook",
                          "remaining": "Statutory township boundary held; county town-by-registry list or exact polygon-to-municipality containment still needed."})
        source(meta, "Maine Legislature", "Saved official30-A§67 source at data/ballot/sources/ba01-northeast/me-county-districts.html. Replay selects the Franklin5-district scheme effective November5,2024 and reads whole municipalities in districts4/5. Previous parser missed clauses sharing a single PL citation. Partial-city districts remain precise and unexpanded.")
    elif state == "de":
        from shapely.geometry import shape
        folder = ROOT / "data/ballot/ba01-southeast-sources"
        places = []
        for stem in ["de-places", "de-cdps"]:
            raw, meta = read_capture(EVIDENCE / (stem + ".json.gz"), EVIDENCE / (stem + ".meta.json"))
            places.extend(json.loads(raw)["features"])
            source(meta, "U.S. Census Bureau", "Current official Census place polygons saved in data/ballot/evidence/bl02-east/" + stem + ".json.gz. Strict geometric covers confirms the entire municipality/CDP lies inside the separately held county's official council district polygon. No tolerance, centroid, ZIP approximation or area-overlap threshold is accepted.")
        held = {row["ocdId"] for row in ballot["contests"]}
        for county, stem, field in [("new_castle", "newcastle", "DISTRICT_"), ("kent", "kent", "DISTRICT"), ("sussex", "sussex", "DISTRICTID")]:
            raw, meta = read_capture(folder / f"de-{stem}-council-geography.gz", folder / f"de-{stem}-council-geography.meta.json")
            for district in json.loads(raw)["features"]:
                target = base + f"/county:{county}/council_district:" + str(district["properties"][field])
                if target not in held:
                    continue
                boundary = shape(district["geometry"])
                for place in places:
                    if boundary.covers(shape(place["geometry"])):
                        add(place["properties"]["NAME"], target, meta, county.replace("_", " ").title() + " County Government")
                flags.append({"districtOcdId": target, "splitCounty": county,
                              "remaining": "County is split; only strictly contained whole municipality/CDP geometries added. Split places and unincorporated remnants need precise point geography."})
            source(meta, county.replace("_", " ").title() + " County Government", "Held official council district polygons replayed with exact whole-place containment against current official Census polygons. Original evidence remains data/ballot/ba01-southeast-sources/de-" + stem + "-council-geography.gz. Strict covers rejects boundary slivers and all split places.")
    elif state == "al":
        raw, meta = read_capture(EVIDENCE / "al-sbe-2021.raw.gz", EVIDENCE / "al-sbe-2021.meta.json")
        text = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=raw).decode()
        text = re.sub(r"06/30/2022 15:57\s+Page \d+ of 17", "", text).replace("\f", "")
        for number in [2, 4, 6, 8]:
            section = re.split(rf"\bDistrict {number}\b", text)[1].split(f"District {number + 1}")[0]
            opening = " ".join(section.split(":", 1)[0].split())
            counties = opening.split(", ")
            partial = counties.pop() if re.search(r"Tract\s+\d", section.split(":", 1)[1]) else None
            target = base + "/sbe:" + str(number)
            for county in counties:
                name = county.removesuffix(" County")
                member = base + "/county:" + name.lower().replace(" ", "_").replace(".", "")
                assert member in ids, member
                aliases[normalized(name)] = [member]
                add(name, target, meta, "Alabama Legislature", "District " + str(number) + ": " + opening)
            flags.append({"districtOcdId": target, "splitCounties": ["Jefferson", "Tuscaloosa"] if number == 4 else ["Talladega"] if number == 6 else [],
                          "remaining": "Partial-county census units excluded; whole counties published." if partial else None})
        source(meta, "Alabama Legislature", "Saved2021 enacted State Board of Education legal-description PDF, generatedJune30,2022. Source replay reads only the initial whole-county list for each held district. A county followed by numbered census tracts is partial and excluded; blank Tract/BlockGroup entries mean no narrower units. District4's subsequent Tuscaloosa block clauses are also excluded.")
    elif state == "ks":
        path_text = EVIDENCE / "ks-sbe-statutes.rendered.txt"
        text = path_text.read_text()
        meta = json.loads((EVIDENCE / "ks-sbe-statutes.meta.json").read_text())
        assert hashlib.sha256(path_text.read_bytes()).hexdigest() == meta["rawHash"]
        for number, senators, word in [(1, [1, 5, 18, 22], "one"), (3, [11, 23, 35, 37], "three"), (5, [36, 38, 39, 40], "five"), (7, [24, 31, 33, 34], "seven"), (9, [12, 13, 14, 15], "nine")]:
            quote = re.search(rf"State board of education member district {word} shall consist of senatorial districts (.*?)\.", text)[0]
            assert [int(x) for x in re.findall(r"\d+", quote)] == senators
            section = 529 + number
            meta["finalUrl"] = f"https://kslegislature.gov/b2025_26/laws/004_000_0000_chapter/004_005_00{section - 500}_section/004_005_00{section - 500}_k/"
            meta["requestedUrl"] = meta["finalUrl"]
            for senator in senators:
                name = "senator-" + str(senator)
                aliases[normalized(name)] = [base + "/sldu:" + str(senator)]
                add(name, base + "/sbe:" + str(number), meta, "Kansas Legislature", quote)
            source(meta, "Kansas Legislature", "Saved rendered current2026 statute excerpt in data/ballot/evidence/bl02-east/ks-sbe-statutes.rendered.txt; hash identifies that rendered evidence, not publisher HTTP bytes. Four complete current Senate districts compose each State Board district, expressly in2022law. This narrower exact legislative membership avoids widening split counties. County-by-district list remains to be derived from the state's plan.")
            county_report = ROOT / "data/ballot/reports/bl02-ks-state-board-geometry.json"
            if county_report.exists():
                plan = json.loads(county_report.read_text())
                flags.append({"districtOcdId": base + "/sbe:" + str(number), "splitCounties": plan["splitCounties"][base + "/sbe:" + str(number)],
                              "exactCountyPlanSource": plan["sourceUrl"], "remaining": None})
            else:
                flags.append({"districtOcdId": base + "/sbe:" + str(number), "countySplitStatus": "Exact county list not yet established; complete Senate-district statutory membership used.", "remaining": "Whole-county crosswalk and split-county enumeration remain open; exact current Senate memberships reach this district."})
    elif state == "mn":
        raw, meta = read_capture(EVIDENCE / "mn-district3.raw.gz", EVIDENCE / "mn-district3.meta.json")
        text = " ".join(html.fromstring(raw).text_content().split())
        quote = re.search(r"District 3 includes .*?entirety of the city of St\. Louis Park\.", text)[0]
        add("St. Louis Park", base + "/county:hennepin/council_district:3", meta, "Hennepin County", quote)
        flags.append({"districtOcdId": base + "/county:hennepin/council_district:3", "splitCounty": "hennepin", "splitCity": "minneapolis", "remaining": "Minneapolis portions remain precise address-geography work; entire St.Louis Park published."})
        source(meta, "Hennepin County", "Current official District3 page explicitly includes the entirety of St.Louis Park, while describing Minneapolis portions. Whole city membership is supported; Minneapolis is not widened.")
    elif state == "ar":
        raw, meta = read_capture(EVIDENCE / "ar-sulphur-springs.json", EVIDENCE / "ar-sulphur-springs.meta.json")
        record = json.loads(raw)["features"][0]["attributes"]
        assert record["GEOID"] == "0567760" and record["NAME"] == "Sulphur Springs city"
        aliases[normalized("sulphur-springs-city")] = [base + "/place:sulphur_springs_0567760"]
        assert aliases[normalized("sulphur-springs-city")][0] in ids
        add("sulphur-springs-city", base + "/place:sulphur_springs", meta, "U.S. Census Bureau", "GEOID0567760: Sulphur Springs city")
        source(meta, "U.S. Census Bureau", "Current official Census incorporated-place query establishes Sulphur Springs city GEOID0567760, distinct from the same-named CDP0567790. The committed ZIP index uses the collision-suffixed city alias; same-division membership connects it to the held BentonCounty mayor contest's unsuffixed city ID.")
    elif state == "md":
        from shapely.geometry import shape
        folder = ROOT / "data/ballot/ba01-southeast-sources"
        raw, meta = read_capture(folder / "md-montgomery-council7.gz", folder / "md-montgomery-council7.meta.json")
        district = json.loads(raw)["features"][0]
        assert district["properties"]["COUNCIL"] == "7"
        boundary = shape(district["geometry"])
        target = base + "/county:montgomery/council_district:7"
        for stem in ["md-places", "md-cdps"]:
            place_raw, place_meta = read_capture(EVIDENCE / (stem + ".json.gz"), EVIDENCE / (stem + ".meta.json"))
            for place in json.loads(place_raw)["features"]:
                if boundary.covers(shape(place["geometry"])):
                    add(place["properties"]["NAME"], target, meta, "Montgomery County Government")
            source(place_meta, "U.S. Census Bureau", "Official current Census place polygons in data/ballot/evidence/bl02-east/" + stem + ".json.gz. Exact whole-place covers test against the separately held official MontgomeryCouncil7 polygon; all partial-city/CDP geometries excluded, with no threshold or tolerance.")
        source(meta, "Montgomery County Government", "Held exact CouncilDistrict7 polygon in data/ballot/ba01-southeast-sources/md-montgomery-council7.gz. Strict containment validates whole Brookeville, Laytonsville and Derwood; all split places remain precise address-geography work.")
        flags.append({"districtOcdId": target, "splitCounty": "montgomery", "remaining": "Strict whole places added; other partial municipality/CDP areas need point geography."})
    elif state == "fl":
        from shapely.geometry import shape
        raw, meta = read_capture(EVIDENCE / "fl-dade-current-commission.json.gz", EVIDENCE / "fl-dade-current-commission.meta.json")
        district = next(row for row in json.loads(raw)["features"] if row["properties"]["ID"] == 5)
        boundary = shape(district["geometry"])
        places_raw, place_meta = read_capture(EVIDENCE / "fl-regional-cdps.json.gz", EVIDENCE / "fl-regional-cdps.meta.json")
        for place in json.loads(places_raw)["features"]:
            if boundary.covers(shape(place["geometry"])):
                add(place["properties"]["NAME"], base + "/county:miami-dade/council_district:5", meta, "Miami-Dade County GIS")
        source(meta, "Miami-Dade County GIS", "Current official EnerGov county commission polygons; exact whole-place covers test supports FisherIslandCDP. Miami and MiamiBeach are split and are never mapped whole. The older BusinessSiteSelection service's obsolete shapes were rejected.")
        source(place_meta, "U.S. Census Bureau", "Current official Census regionalCDP polygons in data/ballot/evidence/bl02-east/fl-regional-cdps.json.gz; entire FisherIsland polygon is strictly contained in current MiamiDadeCommission5 geometry.")
        for row in ballot["contests"]:
            if any(kind in row["ocdId"] for kind in ["/council_district:", "/school_board_district:"]):
                flags.append({"districtOcdId": row["ocdId"], "splitCounty": "miami_dade" if "miami" in row["ocdId"] else "hillsborough",
                              "remaining": "Exact district polygon supplied in bl02-east-boundaries; whole-city or county membership would be overbroad."})
    else:
        raise ValueError(state)

    document["sourceReceipt"]["reviewedAt"] = NOW
    document["sourceReceipt"]["reviewedBy"] = "BL-02 source-bound whole-place district memberships"
    bl02_rows = [row for row in ballot.get("districtMemberships", []) if row["id"].startswith("bl02:")]
    return path, document, {"state": state.upper(), "membershipsAdded": len(bl02_rows), "districtsNewlyLinked": sorted({row["districtOcdId"] for row in bl02_rows}),
                            "added": [{"memberOcdId": row["memberOcdId"], "districtOcdId": row["districtOcdId"]} for row in bl02_rows],
                            "splitDistricts": flags, "sourceHashes": [{"url": row["finalUrl"], "sha256": row["rawHash"]} for row in sources]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    ids = all_divisions()
    reports = []
    for state in ["oh", "me", "de", "al", "ks", "mn", "ar", "md", "fl"]:
        path, document, report = update(state, ids)
        if args.write:
            path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
        reports.append(report)
    report = {"checkedAt": NOW, "method": "Only whole jurisdictions supported by saved official evidence. No county or city widened into a partial district.", "states": reports}
    if args.write:
        (ROOT / "data/ballot/reports/bl02-east-memberships.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({r["state"]: {key: r[key] for key in ["membershipsAdded", "districtsNewlyLinked"]} for r in reports}, indent=2))
