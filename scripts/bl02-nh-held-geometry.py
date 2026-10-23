"""Connect held NH ward ballots and Concord school zones with exact source data."""
import datetime
import hashlib
import importlib.util
import json
import re
from pathlib import Path

from lxml import html
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("memberships", ROOT / "scripts/bl02-east-memberships.py")
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
SPEC = importlib.util.spec_from_file_location("nh", ROOT / "scripts/ba01-northeast-nh.py")
NH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NH)
EVIDENCE = ROOT / "data/ballot/evidence/bl02-east"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
path = ROOT / "data/ballot/2026-general/nh.json"
document = json.loads(path.read_text())
ballot = next(iter(document["ballots"].values()))
base = "ocd-division/country:us/state:nh"
school_id = base + "/county:merrimack/school_district:concord_school_district"
statute_file = ROOT / "data/ballot/sources/ba01-northeast/nh-rsa662-elective-districts.html"
statute_hash = hashlib.sha256(statute_file.read_bytes()).hexdigest()
assert statute_hash == "418308547028763dc4c321fcb7251ea6e9498c633fcd6ec52f35a4383d1e5e26"
statute = NH.statute_text()
links = [row for row in ballot["districtMemberships"] if "/ward:" in row["districtOcdId"] and any(
    "/place:" + city + "/" in row["districtOcdId"] for city in ["manchester", "concord", "lebanon"])]
assert len(links) == 25
for row in links:
    assert row["provenance"]["quote"] in statute


def capture(stem):
    raw, meta = COMMON.read_capture(EVIDENCE / (stem + ".raw.gz"), EVIDENCE / (stem + ".meta.json"))
    return raw, meta


raw, house_meta = capture("nh-2026-house-wards")
houses = {row["properties"]["SLDL"]: row for row in json.loads(raw)["features"]}
assert len(houses) == 25 and all(row["properties"]["LSY"] == "2026" for row in houses.values())
features, points, ward_shapes = [], [], {}


def add_feature(ocd_id, label, boundary, source, extra=None):
    if boundary.geom_type == "GeometryCollection":
        boundary = unary_union([part for part in boundary.geoms if part.geom_type in ["Polygon", "MultiPolygon"]])
    assert boundary.geom_type in ["Polygon", "MultiPolygon"], ocd_id
    assert boundary.is_valid and not boundary.is_empty and boundary.area > 0, ocd_id
    point = boundary.representative_point()
    features.append({"type": "Feature", "properties": {"ocdId": ocd_id, "label": label,
        "sourceUrl": source["finalUrl"], "sourceHash": source["rawHash"], "collectedAt": source["retrievedAt"],
        **(extra or {})}, "geometry": mapping(boundary)})
    points.append({"ocdId": ocd_id, "lat": point.y, "lng": point.x})


for link in links:
    district = link["memberOcdId"].split(":")[-1]
    row = houses[district]
    ward = link["districtOcdId"]
    boundary = shape(row["geometry"])
    ward_shapes[ward] = boundary
    add_feature(ward, ward.split("/place:")[1].replace("/ward:", " Ward ").title(), boundary, house_meta,
                {"statutoryEquivalenceSource": link["provenance"]["sourceUrl"], "statutoryEquivalenceHash": statute_hash,
                 "sourceHouseOcdId": link["memberOcdId"], "splitsCity": ward.rsplit("/ward:", 1)[0]})

raw, school_meta = capture("nh-concord-school-polygon")
school_source = json.loads(raw)["features"]
assert len(school_source) == 1 and school_source[0]["properties"]["GEOID"] == "3302460"
school = shape(school_source[0]["geometry"])
add_feature(school_id, "Concord School District", school, school_meta,
            {"canonicalCensusOcdId": base + "/school_district:concord_school_district"})

zone_raw, zone_meta = capture("nh-concord-school-zone-list")
zone_text = " ".join(html.fromstring(zone_raw).text_content().split())
zone_report = []
for zone, wards in [("a", [1, 2, 3, 4]), ("b", [5, 6, 7]), ("c", [8, 9, 10])]:
    expected = "School Voting Zone " + zone.upper() + " – Wards " + ", ".join(str(i) for i in wards)
    assert expected in zone_text, expected
    whole_ward_union = unary_union([ward_shapes[base + f"/place:concord/ward:{i}"] for i in wards])
    electorate = whole_ward_union.intersection(school)
    ocd_id = school_id + "/school_board_district:" + zone
    add_feature(ocd_id, "Concord School Board Voting Zone " + zone.upper(), electorate, house_meta,
                {"schoolBoundarySource": school_meta["finalUrl"], "schoolBoundaryHash": school_meta["rawHash"],
                 "schoolZoneListSource": zone_meta["finalUrl"], "schoolZoneListHash": zone_meta["rawHash"],
                 "construction": "Union of the official zone's complete city wards, intersected with the official Concord School District boundary."})
    zone_report.append({"districtOcdId": ocd_id, "wards": wards, "schoolBoundaryIntersectionApplied": True})

canonical_school = base + "/school_district:concord_school_district"
membership_id = "bl02-nh:concord-school-canonical-alias"
membership = {"id": membership_id, "memberOcdId": canonical_school, "districtOcdId": school_id,
              "provenance": {"sourceUrl": school_meta["finalUrl"], "sourceOrg": "U.S. Census Bureau",
                             "collectedAt": school_meta["retrievedAt"], "verifiedAt": NOW,
                             "quote": "Concord School District; GEOID3302460"}}
existing = next((i for i, row in enumerate(ballot["districtMemberships"]) if row["id"] == membership_id), None)
if existing is None:
    ballot["districtMemberships"].append(membership)
else:
    ballot["districtMemberships"][existing] = membership

relative = "data/states/nh/geo/bl02-held-districts-33.geojson"
geometry_path = ROOT / relative
geometry_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")

for meta, publisher, explanation in [
    (house_meta, "U.S. Census Bureau", "Full-resolution2026 lower-chamber polygons, retrieved from current TIGERweb Legislative layer2. NH's saved current RSA662 explicitly establishes each of these25House districts as one complete city ward. Same geometry is copied under the wardID, with statute source/hash attached. Held generalized1:500000 orientation geometry is not used."),
    (school_meta, "U.S. Census Bureau", "Exact current Concord School District GEOID3302460 polygon. Adds only the canonicalCensus-school alias to the same held schooldistrict and provides exact school-boundary clipping for voting zones."),
    (zone_meta, "Concord School District", "Current official school election page explicitly lists ZoneA Wards1,2,3,4; ZoneB Wards5,6,7; ZoneC Wards8,9,10 and requires voters to belong to the schooldistrict. Zone polygons are ward unions intersected with the schooldistrict, preserving partial school coverage of citywards1/2."),
]:
    receipt = {"requestedUrl": meta["requestedUrl"], "finalUrl": meta["finalUrl"], "publisher": publisher,
               "sourceClass": "OFFICIAL_PUBLISHER", "retrievedAt": meta["retrievedAt"], "httpStatus": 200,
               "rawHash": meta["rawHash"], "reviewedEvidence": "BL-02 source-bound replay to " + relative + ". " + explanation}
    if not any(row["rawHash"] == receipt["rawHash"] and row["finalUrl"] == receipt["finalUrl"] for row in document["sourceReceipt"]["sources"]):
        document["sourceReceipt"]["sources"].append(receipt)
document["sourceReceipt"]["reviewedAt"] = NOW
document["sourceReceipt"]["reviewedBy"] = "BL-02 NH exact ward and school-zone replay"
path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")

covered = unary_union([shape(row["geometry"]) for row in features if "/school_board_district:" in row["properties"]["ocdId"]])
report = {"checkedAt": NOW, "geometryPath": relative, "geometrySha256": hashlib.sha256(geometry_path.read_bytes()).hexdigest(),
          "wardFeatures": 25, "schoolZoneFeatures": 3, "schoolDistrictFeatures": 1, "addedMembership": membership,
          "sourceStatuteSha256": statute_hash, "schoolZones": zone_report, "points": points,
          "schoolAreaOutsideCityWardUnionFraction": school.difference(covered).area / school.area,
          "scopeNotes": ["All25 HB1300 ward variants retain their original contest IDs, questions and exact wards. No ward measure is widened citywide.",
                         "Concord's schooldistrict contains part of the city; zone polygons intersect the schooldistrict rather than include all ward1/2 land.",
                         "All29 earlier static-index-unreachable NH contests now have exact point geometry or a canonical schooldistrict membership."]}
(ROOT / "data/ballot/reports/bl02-nh-held-districts.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ["geometryPath", "wardFeatures", "schoolZoneFeatures", "schoolDistrictFeatures", "schoolAreaOutsideCityWardUnionFraction"]}))
