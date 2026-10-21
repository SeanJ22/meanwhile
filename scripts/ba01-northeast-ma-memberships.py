"""Attach whole-municipality and whole-ward Council memberships from the official map list."""
import argparse
import csv
import datetime
import importlib.util
import json
import pathlib
import re

SPEC = importlib.util.spec_from_file_location("ba01_northeast", pathlib.Path(__file__).with_name("ba01-northeast.py"))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
URL = "https://www.sec.state.ma.us/divisions/elections/voting-information/district/2022-councillor.htm"
PUBLISHER = "Massachusetts Secretary of the Commonwealth, Elections Division"


def official_members():
    source = (COMMON.SOURCES / "ma-2022-councillor-districts.rendered.txt").read_text()
    lines = [re.sub(r"^L\d+: ?", "", line) for line in source.splitlines()]
    ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"]
    district, partial = None, None
    municipalities, wards = {}, {}
    for line in lines:
        match = re.match(r"## (\w+) Councillor District", line)
        if match:
            district = ordinals.index(match[1])+1
        elif district and line.startswith("  * "):
            name = line.removeprefix("  * ").strip()
            if name.endswith(":"):
                partial = name[:-1]
            else:
                municipalities[name] = district
                partial = None
        elif district and partial and re.fullmatch(r"Ward \d+;", line):
            wards[(partial, int(re.search(r"\d+", line)[0]))] = district
    assert len(municipalities) == 348 and len(wards) == 28
    return municipalities, wards


def memberships(at):
    municipalities, wards = official_members()
    with (COMMON.SOURCES / "ma-2020-census-county-fips.txt").open() as source:
        counties = {r["COUNTYFP"]: r["COUNTYNAME"].removesuffix(" County") for r in csv.DictReader(source, delimiter="|") if r["STATEFP"] == "25"}
    prefix = "ocd-division/country:us/state:ma/"
    rows = {}

    def slug(value):
        return value.lower().replace(" ", "_")

    def add(member, district, quote):
        district_id = prefix + f"governors_council:{district}"
        rows[member] = {"id": "ma-2026-membership:" + member.removeprefix(prefix) + "->" + f"governors_council:{district}",
                        "memberOcdId": member, "districtOcdId": district_id,
                        "provenance": {"sourceUrl": URL, "sourceOrg": PUBLISHER, "collectedAt": at, "verifiedAt": at, "quote": quote}}

    # The state list names every whole town/city. Census names supply its county
    # and the municipality suffix used by the existing county-subdivision IDs.
    found = set()
    with (COMMON.SOURCES / "ma-2025-census-cousub-gazetteer.txt").open() as source:
        for record in csv.DictReader(source, delimiter="|"):
            full_name = record["NAME"]
            short_name = re.sub(r" (town|city)$", "", full_name)
            name = short_name if short_name in municipalities else short_name.removesuffix(" Town")
            if name not in municipalities:
                continue  # Boston, Cambridge and Braintree are split; no whole-city membership.
            found.add(name)
            district = municipalities[name]
            add(prefix + "place:" + slug(name), district, name)
            add(prefix + "place:" + slug(short_name), district, name)
            county = counties[record["GEOID"][2:5]]
            add(prefix + "county:" + slug(county) + "/place:" + slug(full_name), district, name)
    assert found == set(municipalities), sorted(set(municipalities)-found)
    for (municipality, ward), district in wards.items():
        add(prefix + f"place:{slug(municipality)}/ward:{ward}", district, f"Ward {ward};")
    return list(rows.values())


def update(at):
    path = COMMON.ROOT / "data/ballot/2026-general/ma.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    captured_at = COMMON.capture_time(data, URL, COMMON.SOURCES / "ma-2022-councillor-districts.rendered.txt")
    ballot["districtMemberships"] = memberships(captured_at)
    for membership in ballot["districtMemberships"]:
        membership["provenance"]["verifiedAt"] = at
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / "ma-2022-councillor-districts.rendered.txt", URL, PUBLISHER, at,
        "Saved rendered official page; hash describes the saved rendered text. Code reads all 348 whole municipalities and 28 whole wards into their Council districts. "
        "Boston, Cambridge and Braintree whole-city memberships, and all partial wards/precincts, are excluded. Census2025 municipal names provide the county-subdivision aliases."), at)
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / "ma-2025-census-cousub-gazetteer.txt",
        "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_cousubs_25.txt", "U.S. Census Bureau", at,
        "Official Massachusetts county-subdivision Gazetteer supplies county FIPS and full municipal names for Council membership aliases. "
        "County names are replayed from the Massachusetts rows of the official2020 national county-code list retained beside the Gazetteer."), at)
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / "ma-2020-census-county-fips.txt",
        "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt", "U.S. Census Bureau", at,
        "Code selects only STATEFP25 rows to map the Massachusetts county FIPS in the official Gazetteer to county names. Raw national response bytes are retained."), at)
    return path, data, {"state": "MA", "districtMemberships": len(ballot["districtMemberships"]), "wholeMunicipalities": 348, "wholeWards": 28}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    path, data, report = update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
