"""Source replay for BL-02's Nebraska, Utah and Texas district reach.

Requires shapely and pyshp for the two state GIS sources. No runtime dependency
is added: this is a data extraction tool, not a reader or publisher.
"""
import argparse
from collections import defaultdict, Counter
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile
import unicodedata

import shapefile
from shapely.geometry import shape
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/bl02-interior"
NOW = datetime.now(timezone.utc).isoformat()


def slug(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def raw(name):
    content = (EVIDENCE / name).read_bytes()
    return gzip.decompress(content) if name.endswith(".gz") else content


def shapes(name):
    archive = zipfile.ZipFile(io.BytesIO(raw(name)))
    stem = next(n[:-4] for n in archive.namelist() if n.endswith(".shp"))
    reader = shapefile.Reader(**{k: io.BytesIO(archive.read(stem + "." + k)) for k in ("shp", "shx", "dbf")})
    return [(r.record.as_dict(), shape(r.shape.__geo_interface__)) for r in reader.iterShapeRecords()]


def geojson(name):
    return [(r["properties"], shape(r["geometry"])) for r in json.loads(raw(name))["features"]]


SOURCES = {
    "ne-education.zip": ("https://sos.nebraska.gov/sites/default/files/doc/ED21-39003.zip", "Nebraska Secretary of State"),
    "ne-regents.zip": ("https://sos.nebraska.gov/sites/default/files/doc/REG21-39003%20Updated%2011-24-21_1.zip", "Nebraska Secretary of State"),
    "ne-psc.zip": ("https://sos.nebraska.gov/sites/default/files/doc/PSC21-39001.zip", "Nebraska Secretary of State"),
    "ne-house.zip": ("https://sos.nebraska.gov/sites/default/files/doc/LEG21-39006.zip", "Nebraska Secretary of State"),
    "ne-cities.zip": ("https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_31_place.zip", "U.S. Census Bureau"),
    "ne-counties.extract.geojson.gz": ("https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip", "U.S. Census Bureau"),
    "ut-boards.geojson.gz": ("https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahSchoolBoardDistricts2022to2032/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson", "Utah Geospatial Resource Center"),
    "ut-cities.geojson.gz": ("https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson", "Utah Geospatial Resource Center"),
    "ut-county-names.json": ("https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahCountyBoundaries/FeatureServer/0/query?where=1%3D1&outFields=NAME%2CFIPS_STR&returnGeometry=false&f=json", "Utah Geospatial Resource Center"),
    "ut-SB2005S07_BEF.txt.gz": ("https://le.utah.gov/~2021S2/redistrict/SB2005S07_BEF.txt", "Utah Legislature"),
    "ut-HB2005_BEF.txt.gz": ("https://le.utah.gov/~2021S2/redistrict/HB2005_BEF.txt", "Utah Legislature"),
    "tx-counties.pdf": ("https://data.capitol.texas.gov/dataset/ad1ae979-6df9-4322-98cf-6771cc67f02d/resource/0d9a33e0-0c70-4e1e-9eec-ae967522107e/download/plane2106_r150.pdf?download=1", "Texas Legislative Council"),
    "tx-cities.pdf": ("https://data.capitol.texas.gov/dataset/ad1ae979-6df9-4322-98cf-6771cc67f02d/resource/926c4320-0a5d-4575-964b-44e2c22e5cd9/download/plane2106r125.pdf?download=1", "Texas Legislative Council"),
    "tx-split-cities.pdf": ("https://data.capitol.texas.gov/dataset/ad1ae979-6df9-4322-98cf-6771cc67f02d/resource/d74ac116-4e8a-441d-bc1b-c65048f52060/download/plane2106r130.pdf?download=1", "Texas Legislative Council"),
    "tx-census-places.txt": ("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_48.txt", "U.S. Census Bureau"),
}


def add_source(document, name):
    url, publisher = SOURCES[name]
    manifest = json.loads((EVIDENCE / "captures.json").read_text())
    captured = manifest[name]
    assert hashlib.sha256(raw(name)).hexdigest() == captured["sha256"], name
    if not any(s["finalUrl"] == url and s["rawHash"] == captured["sha256"] for s in document["sourceReceipt"]["sources"]):
        document["sourceReceipt"]["sources"].append({
            "requestedUrl": url, "finalUrl": url, "httpStatus": 200,
            "rawHash": captured["sha256"], "retrievedAt": captured["retrievedAt"],
            "publisher": publisher, "sourceClass": "OFFICIAL_PUBLISHER",
            "reviewedEvidence": f"Saved source at data/ballot/evidence/bl02-interior/{name}. " + captured["meaning"],
        })
    return {"sourceUrl": url, "sourceOrg": publisher, "collectedAt": captured["retrievedAt"], "verifiedAt": NOW}


def add(ballot, state, member, district, provenance, quote):
    prefix = f"ocd-division/country:us/state:{state}/"
    row = {"id": f"bl02-{state}-{member}-in-{district}", "memberOcdId": prefix + member,
           "districtOcdId": prefix + district, "provenance": {**provenance, "quote": quote}}
    rows = ballot.setdefault("districtMemberships", [])
    if not any(r["memberOcdId"] == row["memberOcdId"] and r["districtOcdId"] == row["districtOcdId"] for r in rows):
        rows.append(row)


def nebraska(document, ballot):
    cities, counties, legislative = shapes("ne-cities.zip"), geojson("ne-counties.extract.geojson.gz"), shapes("ne-house.zip")
    for name in ["ne-cities.zip", "ne-counties.extract.geojson.gz", "ne-house.zip"]:
        add_source(document, name)
    splits = []
    for filename, family, wanted in [("ne-education.zip", "board_of_education", [5, 6, 7, 8]),
                                    ("ne-regents.zip", "board_of_regents", [1, 2, 4]),
                                    ("ne-psc.zip", "public_service_commission", [2])]:
        provenance = add_source(document, filename)
        districts = {int(r["DISTRICT"]): g for r, g in shapes(filename)}
        for number in wanted:
            district, geometry = f"{family}:{number}", districts[number]
            # Strict polygon containment: no centroid, percentage threshold or buffer.
            for record, member in counties:
                if geometry.covers(member):
                    add(ballot, "ne", "county:" + slug(record["NAME"]), district, provenance,
                        f"{filename} DISTRICT={number} polygon covers the entire saved Census county polygon for {record['NAME']}.")
            for record, member in cities:
                if geometry.covers(member):
                    add(ballot, "ne", "place:" + slug(record["NAME"]), district, provenance,
                        f"{filename} DISTRICT={number} polygon covers the entire 2025 Census place polygon for {record['NAME']}.")
            # Urban regent4 has no whole city. Whole legislative districts supply
            # narrower, exact electorates already resolved by the reader.
            for record, member in legislative:
                if geometry.covers(member):
                    add(ballot, "ne", "sldu:" + str(int(record["DISTRICT"])), district, provenance,
                        f"{filename} DISTRICT={number} polygon covers the entire LEG21-39006 legislative district {record['DISTRICT']} polygon.")
        for record, member in counties:
            fractions = {n: member.intersection(g).area / member.area for n, g in districts.items() if member.intersects(g)}
            # Report significant intersections as splits; smaller mismatches with
            # the generalized county source are also saved, never mapped wholesale.
            substantial = {n: round(f, 7) for n, f in fractions.items() if f > .001}
            if len(substantial) > 1 and set(substantial).intersection(wanted):
                splits.append({"family": family, "county": record["NAME"], "districtFractions": substantial,
                               "wholeCountyMembershipAdded": False})
    return {"splitCounties": splits, "method": "Strict coverage by state-adopted district polygons. Generalized county boundaries that protrude outside a district are omitted; whole Census places and whole state legislative districts supply safe narrower memberships."}


def utah(document, ballot):
    board, house, county_blocks = defaultdict(set), defaultdict(set), defaultdict(set)
    for line in raw("ut-SB2005S07_BEF.txt.gz").decode().splitlines():
        block, district = line.split(",")
        board[block.strip()].add(int(district)); county_blocks[block[:5]].add(int(district))
    for line in raw("ut-HB2005_BEF.txt.gz").decode().splitlines():
        block, district = line.split(","); house[int(district)].add(block.strip())
    assert len(board) == 71207 and set.union(*house.values()) == set(board)
    provenance = add_source(document, "ut-SB2005S07_BEF.txt.gz")
    add_source(document, "ut-HB2005_BEF.txt.gz")
    add_source(document, "ut-county-names.json")
    wanted = {1, 2, 4, 5, 7, 8, 11, 14}
    counties = {row["attributes"]["FIPS_STR"]: row["attributes"]["NAME"].title()
                for row in json.loads(raw("ut-county-names.json"))["features"]}
    for county, districts in county_blocks.items():
        if len(districts) == 1 and districts.intersection(wanted):
            number = next(iter(districts))
            add(ballot, "ut", "county:" + slug(counties[county]), f"sbe:{number}", provenance,
                f"SB2005S07_BEF.txt assigns every Census block in county {county} ({counties[county]}) to State Board district {number}.")
    for number, blocks in house.items():
        districts = set.union(*(board[b] for b in blocks))
        if len(districts) == 1 and districts.intersection(wanted):
            district = next(iter(districts))
            add(ballot, "ut", f"sldl:{number}", f"sbe:{district}", provenance,
                f"All {len(blocks)} blocks assigned to House district {number} in HB2005_BEF.txt are assigned to State Board district {district} in SB2005S07_BEF.txt.")
    polygons = {r["DIST"]: g for r, g in geojson("ut-boards.geojson.gz")}
    geo_provenance = add_source(document, "ut-boards.geojson.gz")
    add_source(document, "ut-cities.geojson.gz")
    for record, member in geojson("ut-cities.geojson.gz"):
        for number in wanted:
            if polygons[number].covers(member):
                add(ballot, "ut", "place:" + slug(record["NAME"]), f"sbe:{number}", geo_provenance,
                    f"UGRC district DIST={number} polygon covers the entire UGRC municipality polygon NAME={record['NAME']}.")
    return {"blockCount": len(board), "splitCounties": [{"county": counties[c], "districts": sorted(ds), "wholeCountyMembershipAdded": False}
                for c, ds in county_blocks.items() if len(ds) > 1 and ds.intersection(wanted)],
            "method": "Exact join of enacted Census-block equivalency files for counties and whole House districts; strict whole-polygon coverage for municipalities. No rounding of near-complete city coverage."}


def texas(document, ballot):
    def pdf_text(name):
        return subprocess.run(["pdftotext", "-layout", str(EVIDENCE / name), "-"], check=True, capture_output=True, text=True).stdout
    county_text, cities_text, split_text = map(pdf_text, ["tx-counties.pdf", "tx-cities.pdf", "tx-split-cities.pdf"])
    assert "SBOE DISTRICTS - PLANE2106" in county_text and "Split Cities" in split_text
    counties = {}
    for page in county_text.split("\f"):
        lines = page.splitlines()
        for i, line in enumerate(lines):
            match = re.match(r"^\s{10,}([A-Za-z][A-Za-z ]+?)(?:\s{2,}County Total.*)?\s*$", line)
            if match and i + 1 < len(lines) and re.match(r"^\s+\d+\s+", lines[i + 1]):
                numbers, j = [], i + 1
                while j < len(lines) and re.match(r"^\s+(\d+)\s+", lines[j]):
                    numbers.append(int(re.match(r"^\s+(\d+)\s+", lines[j])[1])); j += 1
                counties[match[1].strip()] = numbers
    assert len(counties) == 254
    wanted = {2, 4, 5, 6, 7, 8, 9, 13, 14}
    provenance = add_source(document, "tx-counties.pdf")
    for county, numbers in counties.items():
        if len(numbers) == 1 and numbers[0] in wanted:
            add(ballot, "tx", "county:" + slug(county), f"sbe:{numbers[0]}", provenance,
                f"PLANE2106 Red-150: {county} — District {numbers[0]}; no County Total split rows.")
    city_provenance = add_source(document, "tx-cities.pdf")
    add_source(document, "tx-split-cities.pdf")
    add_source(document, "tx-census-places.txt")
    gazetteer = defaultdict(list)
    for line in raw("tx-census-places.txt").decode().splitlines()[1:]:
        cells = line.split("|"); name = re.sub(r" (?:CDP|city|town|village)$", "", cells[4])
        gazetteer[slug(name)].append((cells[1], cells[4].endswith(" CDP")))
    split_names = {m.strip() for m in re.findall(r"^ ([A-Z][A-Za-z' .-]+?)(?:\s*\(CDP\))?\s*\(", split_text, re.M)}
    assert "Palmview" in split_names and "Timberwood Park" in split_names
    district, county = None, None
    for line in cities_text.splitlines():
        match = re.match(r"^ DISTRICT (\d+)\s*$", line)
        if match: district, county = int(match[1]), None
        match = re.match(r"^ ([A-Za-z][^()]+?) \([\d ]+%\)\s*$", line)
        if match and match[1].strip() in counties: county = match[1].strip()
        match = re.match(r"^   ([A-Za-z][^\n]*?) \(100 %\)\s+Total:", line)
        if not match or district not in wanted or not county or len(counties[county]) == 1: continue
        name = re.sub(r"\s*\(CDP\)\s*", "", match[1]).strip()
        # Red125 rounds percentages. The separate Red130 split-city list is
        # essential: a rounded100% is insufficient for whole-city membership.
        if "*" in name or name in split_names: continue
        # The ZIP index appends GEOID to homonymous places. Census's legal
        # municipality/CDP type disambiguates both Pinehursts and both San Juans.
        code = slug(name)
        if code not in gazetteer: continue  # Former Census place not in the current index.
        if len(gazetteer[code]) > 1:
            match_type = [geoid for geoid, cdp in gazetteer[code] if cdp == ("(CDP)" in match[1])]
            assert len(match_type) == 1, name
            code += "_" + match_type[0]
        add(ballot, "tx", "place:" + code, f"sbe:{district}", city_provenance,
            f"PLANE2106 Red-125: {name} (100 %) in District {district}; absent from Red-130 split-city list; no multi-county asterisk.")
    return {"countiesRead": len(counties), "splitCounties": [{"county": c, "districts": ds, "wholeCountyMembershipAdded": False}
                 for c, ds in counties.items() if len(ds) > 1 and set(ds).intersection(wanted)],
            "method": "Explicit county report, with split-county rows excluded. Whole city rows in split counties require 100% and absence from the separate split-city report; all multi-county asterisk rows are omitted."}


def main(write):
    report = {"checkedAt": NOW, "dataOnly": True, "states": {}}
    for state, function in [("ne", nebraska), ("ut", utah), ("tx", texas)]:
        path = ROOT / f"data/ballot/2026-general/{state}.json"
        document = json.loads(path.read_text()); ballot = next(iter(document["ballots"].values()))
        ballot["districtMemberships"] = [r for r in ballot.get("districtMemberships", []) if not r["id"].startswith("bl02-" + state + "-")]
        details = function(document, ballot)
        counts = Counter(r["districtOcdId"] for r in ballot["districtMemberships"] if r["id"].startswith("bl02-"))
        report["states"][state.upper()] = {"membershipRows": sum(counts.values()),
            "districtMembershipCounts": dict(sorted(counts.items())), **details}
        document["sourceReceipt"]["reviewedAt"] = NOW
        if write: path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    if write: (ROOT / "data/ballot/reports/bl02-interior-memberships.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def write_gap_boundaries():
    """Preserve exact official polygons for the three districts lacking ZIP edges."""
    captures = json.loads((EVIDENCE / "captures.json").read_text())
    for state, fips, name, selected in [("ne", "31", "ne-regents.zip", {4}),
                                       ("ut", "49", "ut-boards.geojson.gz", {5, 8})]:
        capture = captures[name]
        assert hashlib.sha256(raw(name)).hexdigest() == capture["sha256"]
        records = shapes(name) if state == "ne" else geojson(name)
        features = []
        for record, geometry in records:
            number = int(record["DISTRICT"] if state == "ne" else record["DIST"])
            if number not in selected: continue
            assert geometry.is_valid and not geometry.is_empty
            family = "board_of_regents" if state == "ne" else "sbe"
            title = "Board of Regents" if state == "ne" else "State Board of Education"
            features.append({"type": "Feature", "properties": {
                "ocdId": f"ocd-division/country:us/state:{state}/{family}:{number}",
                "label": f"{title} District {number}", "sourceUrl": capture["url"],
                "sourceHash": capture["sha256"], "collectedAt": capture["retrievedAt"],
            }, "geometry": mapping(geometry)})
        assert len(features) == len(selected)
        path = ROOT / f"data/states/{state}/geo/bl02-board-districts-{fips}.geojson"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
        print(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--write", action="store_true")
    parser.add_argument("--write-boundaries", action="store_true")
    args = parser.parse_args()
    if args.write_boundaries: write_gap_boundaries()
    else: main(args.write)
