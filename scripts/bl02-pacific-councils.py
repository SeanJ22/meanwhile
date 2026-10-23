"""Prepare council data and exact whole-place memberships from official boundaries.

Run with Shapely and pyshp installed. This writes data only; it never modifies
geometry manifests, runtime code, deployment state, or production databases.
"""
import gzip
import hashlib
import io
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import shapefile
from shapely.geometry import shape, mapping
from shapely.validation import make_valid, explain_validity

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/sources/bl02-west"
AT = datetime.now(timezone.utc).isoformat()


def source(stem, extension):
    raw = (EVIDENCE / (stem + "." + extension)).read_bytes()
    if extension.endswith(".gz"):
        raw = gzip.decompress(raw)
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    assert meta["httpStatus"] == 200 and hashlib.sha256(raw).hexdigest() == meta["rawHash"]
    return raw, meta


def slug(value):
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def receipt(data, meta, publisher, explanation):
    if not any(row["rawHash"] == meta["rawHash"] and row["finalUrl"] == meta["finalUrl"] for row in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append(dict(meta, publisher=publisher,
            sourceClass="OFFICIAL_PUBLISHER", reviewOutcome="SUPPORTED", reviewedEvidence=explanation))


def main():
    zip_ids = set()
    for path in (ROOT / "data/derived/zip-divisions").glob("[0-9]*.json"):
        zip_ids.update(json.loads(path.read_text())["divisions"])
    reports = {}
    for state, fips, layers in [
        ("hi", "15", [("hi-hawaii-councils", "Hawaii Statewide GIS Program", "county:hawaii", "shortname"),
                       ("hi-honolulu-councils", "Hawaii Statewide GIS Program", "county:honolulu", "distnumber")]),
        ("wa", "53", [("wa-king-councils", "King County GIS", "county:king", "kccdst"),
                       ("wa-seattle-council5", "City of Seattle GIS", "place:seattle", "C_DISTRICT")]),
        ("or", "41", [("or-portland-councils", "City of Portland GIS", "place:portland", "DISTRICT"),
                       ("or-multco-councils", "Multnomah County GIS", "county:multnomah", "DISTRICT")])]:
        path = ROOT / f"data/ballot/2026-general/{state}.json"
        data = json.loads(path.read_text())
        ballot = next(iter(data["ballots"].values()))
        base = f"ocd-division/country:us/state:{state}/"
        census_raw, census_meta = source("census-places-" + fips, "zip")
        archive = zipfile.ZipFile(io.BytesIO(census_raw))
        name = next(n[:-4] for n in archive.namelist() if n.endswith(".shp"))
        reader = shapefile.Reader(shp=io.BytesIO(archive.read(name + ".shp")),
                                 shx=io.BytesIO(archive.read(name + ".shx")),
                                 dbf=io.BytesIO(archive.read(name + ".dbf")))
        places = [(row.record.as_dict(), shape(row.shape.__geo_interface__)) for row in reader.iterShapeRecords()]
        features, district_report, topology_corrections = [], [], []
        for stem, publisher, parent, field in layers:
            raw, meta = source(stem, "json.gz")
            source_features = json.loads(raw)["features"]
            assert source_features
            for feature in source_features:
                number = int(str(feature["properties"][field]).removeprefix("C"))
                district_id = base + parent + f"/council_district:{number}"
                assert any(c["ocdId"] == district_id for c in ballot["contests"]), district_id
                district_geometry = shape(feature["geometry"])
                if not district_geometry.is_valid:
                    corrected = make_valid(district_geometry)
                    # Portland4's response misclassifies eight inner rings as
                    # outer parts and the main outer ring as a hole. Restore
                    # ring nesting without a buffer, snapping, or new vertices.
                    def vertices(value):
                        if len(value) >= 2 and isinstance(value[0], (int, float)):
                            return {tuple(value)}
                        return set().union(*(vertices(child) for child in value))
                    assert vertices(feature["geometry"]["coordinates"]) == vertices(mapping(corrected)["coordinates"])
                    assert abs(corrected.area - abs(district_geometry.area)) < 1e-14
                    topology_corrections.append(dict(districtOcdId=district_id,
                        sourceIssue=explain_validity(district_geometry),
                        action="Restored ring nesting using the identical source coordinate set; no new vertices, buffering or snapping.",
                        originalSignedArea=district_geometry.area, correctedArea=corrected.area))
                    district_geometry = corrected
                assert district_geometry.is_valid
                features.append(dict(type="Feature", properties=dict(ocdId=district_id,
                    label=f"{parent.split(':')[1].replace('_',' ').title()} Council District {number}",
                    sourceUrl=meta["finalUrl"], sourceHash=meta["rawHash"], collectedAt=meta["retrievedAt"]),
                    geometry=mapping(district_geometry)))
                contained = []
                for record, place_geometry in places:
                    if not district_geometry.covers(place_geometry):
                        continue
                    name_code = slug(record["NAME"])
                    member_id = base + "place:" + name_code
                    disambiguated = member_id + "_" + record["GEOID"]
                    if disambiguated in zip_ids:
                        member_id = disambiguated
                    if member_id not in zip_ids:
                        continue
                    quote = f"{record['NAMELSAD']}, GEOID {record['GEOID']}: complete Census2025 place polygon is covered by official {parent} council district {number} polygon."
                    membership = dict(id=f"bl02-{state}-{name_code}-to-{slug(parent)}-council-{number}",
                        memberOcdId=member_id, districtOcdId=district_id,
                        provenance=dict(sourceUrl=meta["finalUrl"], sourceOrg=publisher,
                            collectedAt=meta["retrievedAt"], verifiedAt=AT, quote=quote),
                        memberGeometryProvenance=dict(sourceUrl=census_meta["finalUrl"], sourceOrg="U.S. Census Bureau",
                            collectedAt=census_meta["retrievedAt"], verifiedAt=AT, quote=f"{record['NAMELSAD']}; GEOID{record['GEOID']}"))
                    if not any(row["memberOcdId"] == member_id and row["districtOcdId"] == district_id for row in ballot.setdefault("districtMemberships", [])):
                        ballot["districtMemberships"].append(membership)
                    contained.append(dict(place=record["NAME"], geoid=record["GEOID"], memberOcdId=member_id))
                district_report.append(dict(districtOcdId=district_id, wholePlaces=contained,
                    needsExactBoundaryForOtherPlaces=True, sourceUrl=meta["finalUrl"]))
            receipt(data, meta, publisher,
                "Exact current official council boundary response. BL02 uses strict full-polygon containment of Census2025 places; no centroid, area-percentage threshold, geometry buffer, or whole-county assignment. Remaining split places use the exact saved boundary.")
        receipt(data, census_meta, "U.S. Census Bureau", "Official2025 TIGER/Line state place shapefile supplies exact names/GEOIDs and complete place polygons for strict whole-place containment. Water/coastline differences are not rounded away.")
        if state == "wa":
            raw, meta = source("wa-seattle-catalog", "html")
            assert b"adopted by the Seattle Redistricting Commission in November 2022" in raw
            assert b"Seattle_City_Council_Districts_including_Water/FeatureServer/1" in raw
            receipt(data, meta, "City of Seattle via Data.gov", "Government catalog links the Seattle ArcGIS service and states it reflects the November2022 adopted districts. The legacy KingCounty service described2013 boundaries and was rejected.")
        output = ROOT / f"data/states/{state}/geo/bl02-councils-{fips}.geojson"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(dict(type="FeatureCollection", features=features), separators=(",", ":")) + "\n")
        data["sourceReceipt"]["reviewedAt"] = AT
        data["sourceReceipt"]["reviewedBy"] = "bl02-official-pacific-council-memberships"
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        reports[state.upper()] = dict(districts=district_report, preparedBoundaryFile=str(output.relative_to(ROOT)),
            wholePlaceMemberships=sum(len(row["wholePlaces"]) for row in district_report),
            splitCounties=["Hawaii", "Honolulu"] if state == "hi" else ["King"] if state == "wa" else ["Multnomah"],
            wholeCountyMembershipsAdded=0,
            topologyCorrections=topology_corrections,
            boundaryOnlyDistricts=[row["districtOcdId"] for row in district_report if not row["wholePlaces"]])
    report = dict(checkedAt=AT, states=reports,
                  method="Official current council polygons and Census2025 full place polygons. Only exact complete containment becomes a ballot districtMembership. All partial electorates remain explicitly split and retain their exact boundaries for the existing reader geometry path.",
                  lesson="Legacy GIS endpoints may remain live with old boundaries. The Seattle2013 layer was rejected; the government catalog's November2022 adopted layer is used.",
                  publication="Prepared data only; serving geometry manifests are managed by the parent task. No release or production write performed here.")
    (ROOT / "data/ballot/reports/bl02-pacific-councils.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({state: dict(wholePlaceMemberships=row["wholePlaceMemberships"], boundaryOnlyDistricts=row["boundaryOnlyDistricts"]) for state, row in reports.items()}))


if __name__ == "__main__":
    main()
