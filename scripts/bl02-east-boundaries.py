"""Project exact official district polygons into the existing ballot point reader.

No application or resolver-manifest edits. Run the shared manifest compiler after
all BL-02 geometry writers finish.
"""
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("memberships", ROOT / "scripts/bl02-east-memberships.py")
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
EVIDENCE = ROOT / "data/ballot/evidence/bl02-east"
BA01 = ROOT / "data/ballot/ba01-southeast-sources"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
FILES = {"dc": "11", "de": "10", "fl": "12", "nc": "37", "md": "24"}
rows = {state: [] for state in FILES}
sources = {state: {} for state in FILES}
flags = []


def capture(folder, stem, extension):
    return COMMON.read_capture(folder / (stem + extension), folder / (stem + ".meta.json"))


def feature(state, source_feature, ocd_id, label, meta, publisher, county):
    geometry = source_feature["geometry"]
    boundary = shape(geometry)
    assert not boundary.is_empty and boundary.is_valid and boundary.area > 0, ocd_id
    point = boundary.representative_point()
    assert boundary.contains(point)
    rows[state].append({"type": "Feature", "properties": {"ocdId": ocd_id, "label": label,
        "sourceUrl": meta["finalUrl"], "sourceHash": meta["rawHash"], "collectedAt": meta["retrievedAt"],
        "splitCountyOcdId": county}, "geometry": geometry})
    sources[state][meta["rawHash"]] = (meta, publisher)
    flags.append({"state": state.upper(), "districtOcdId": ocd_id, "splitsCounty": county,
                  "geometryProvidesExactAddressMatch": True, "point": {"lat": point.y, "lng": point.x}})


raw, meta = capture(EVIDENCE, "dc-2022-wards", ".raw.gz")
for district in json.loads(raw)["features"]:
    number = int(district["properties"]["WARD"])
    feature("dc", district, f"ocd-division/country:us/district:dc/ward:{number}", f"DC Ward {number}", meta,
            "District of Columbia Office of Planning / DC GIS", "ocd-division/country:us/district:dc/county:district_of_columbia")

for county, stem, field in [("new_castle", "newcastle", "DISTRICT_"), ("kent", "kent", "DISTRICT"), ("sussex", "sussex", "DISTRICTID")]:
    raw, meta = capture(BA01, f"de-{stem}-council-geography", ".gz")
    ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/de.json").read_text())["ballots"].values()))
    held = {row["ocdId"] for row in ballot["contests"]}
    for district in json.loads(raw)["features"]:
        number = int(district["properties"][field])
        ocd_id = f"ocd-division/country:us/state:de/county:{county}/council_district:{number}"
        if ocd_id in held:
            feature("de", district, ocd_id, county.replace("_", " ").title() + f" County Council District {number}", meta,
                    county.replace("_", " ").title() + " County Government", f"ocd-division/country:us/state:de/county:{county}")

for stem, extension, field, wanted, county, suffix, publisher in [
    ("fl-dade-current-commission", ".json.gz", "ID", [5], "miami-dade", "council_district", "Miami-Dade County GIS"),
    ("fl-dade-current-school", ".json.gz", "ID", [1], "miami-dade", "school_board_district", "Miami-Dade County GIS / Miami-Dade County Public Schools"),
    ("fl-hillsborough-commission", ".raw.gz", "COMMDIST", [1, 3], "hillsborough", "council_district", "Hillsborough County GIS"),
    ("fl-hillsborough-school", ".raw.gz", "District", [2], "hillsborough", "school_board_district", "Hillsborough County GIS / Hillsborough County Public Schools"),
]:
    raw, meta = capture(EVIDENCE, stem, extension)
    for district in json.loads(raw)["features"]:
        number = int(district["properties"][field])
        if number in wanted:
            ocd_id = f"ocd-division/country:us/state:fl/county:{county}/{suffix}:{number}"
            feature("fl", district, ocd_id, county.title() + f" {suffix.replace('_', ' ')} {number}", meta, publisher,
                    f"ocd-division/country:us/state:fl/county:{county}")

raw, meta = capture(EVIDENCE, "nc-charlotte-commission", ".raw.gz")
for district in json.loads(raw)["features"]:
    if int(district["properties"]["cc"]) == 4:
        assert district["properties"]["name"] == "Mark Jerrell"
        feature("nc", district, "ocd-division/country:us/state:nc/county:mecklenburg/council_district:4", "Mecklenburg County Commissioner District 4",
                meta, "City of Charlotte GIS (Mecklenburg County commissioner districts)", "ocd-division/country:us/state:nc/county:mecklenburg")

raw, meta = capture(BA01, "md-montgomery-council7", ".gz")
district = json.loads(raw)["features"][0]
assert district["properties"]["COUNCIL"] == "7"
feature("md", district, "ocd-division/country:us/state:md/county:montgomery/council_district:7", "Montgomery County Council District 7",
        meta, "Montgomery County Government", "ocd-division/country:us/state:md/county:montgomery")

# Miami Gardens' municipal district is saved separately by the city-source worker.
gardens = EVIDENCE / "fl-gardens-council4.geojson"
if gardens.exists():
    raw, meta = COMMON.read_capture(gardens, EVIDENCE / "fl-gardens-council4.geojson.capture.json")
    collection = json.loads(raw)
    for district in collection["features"]:
        feature("fl", district, "ocd-division/country:us/state:fl/place:miami_gardens/council_district:4", "Miami Gardens Residential Area 4", meta,
                "City of Miami Gardens", "ocd-division/country:us/state:fl/county:miami_dade")

outputs = []
for state, fips in FILES.items():
    relative = f"data/states/{state}/geo/bl02-held-districts-{fips}.geojson"
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": rows[state]}, separators=(",", ":")) + "\n")
    outputs.append({"path": relative, "features": len(rows[state]), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    ballot_path = ROOT / f"data/ballot/2026-general/{state}.json"
    document = json.loads(ballot_path.read_text())
    for meta, publisher in sources[state].values():
        receipt = {"requestedUrl": meta.get("requestedUrl", meta.get("url")), "finalUrl": meta["finalUrl"], "publisher": publisher,
                   "sourceClass": "OFFICIAL_PUBLISHER", "httpStatus": 200, "retrievedAt": meta["retrievedAt"], "rawHash": meta["rawHash"],
                   "reviewedEvidence": "BL-02 exact government district polygon replay; source response hash verified and geometry copied without widening or simplification into " + relative + ". Each feature is keyed by the held contest's exact OCD district ID; whole county/city aliases remain separate."}
        existing = next((row for row in document["sourceReceipt"]["sources"] if row["rawHash"] == receipt["rawHash"] and row["finalUrl"] == receipt["finalUrl"]), None)
        if existing is None:
            document["sourceReceipt"]["sources"].append(receipt)
    document["sourceReceipt"]["reviewedAt"] = NOW
    document["sourceReceipt"]["reviewedBy"] = "BL-02 exact district memberships and point-geography replay"
    ballot_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")

report = {"checkedAt": NOW, "files": outputs, "splitDistricts": flags,
          "sourceRouteNotes": [
              "Miami-Dade BusinessSiteSelection service has obsolete incumbent labels and older shapes; it is retained as failed-source evidence and never used. Current EnerGov MD_LandMgtViewer commission/school layers use current district identities and were selected instead.",
              "Hillsborough official board directory links its ArcGIS lookup; lookup metadata links the saved webmap and current FMEO county commissioner layer. County GIS's2022 school electoral polygons match the held official2026 qualifying map's single-member district2.",
              "Mecklenburg's own current GIS endpoint returns403. City of Charlotte government-owned Commission layer, updatedMarch10,2025, independently serves those county districts; saved ArcGIS item metadata identifies the CharlotteNC publisher. Its District4 identifies MarkJerrell, matching the official current county directory and2023 county map already held.",
              "The source city/county boundaries that split whole municipalities remain exact polygons; no false whole-city memberships are introduced."
          ]}
(ROOT / "data/ballot/reports/bl02-east-boundaries.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(outputs, indent=2))
