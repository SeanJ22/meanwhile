"""Project Kansas's official enacted Apple7 education plan to held ballot IDs."""
import datetime
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
import gzip

from lxml import html
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/bl02-east"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
zip_path = EVIDENCE / "ks-apple7-adopted-kml.zip"
meta = json.loads((EVIDENCE / "ks-apple7-adopted-kml.meta.json").read_text())
assert meta["httpStatus"] == 200 and hashlib.sha256(zip_path.read_bytes()).hexdigest() == meta["rawHash"]
index_meta = json.loads((EVIDENCE / "ks-2022-enacted-plans-index.meta.json").read_text())
index_raw = gzip.decompress((EVIDENCE / "ks-2022-enacted-plans-index.html.gz").read_bytes())
assert index_meta["httpStatus"] == 200 and hashlib.sha256(index_raw).hexdigest() == index_meta["rawHash"]
index = html.fromstring(index_raw)
assert "Enacted Plans 2022" in index.text_content()
assert "State Board of Education" in index.text_content()
assert meta["requestedUrl"] in index.xpath("//a/@href")

path = ROOT / "data/ballot/2026-general/ks.json"
document = json.loads(path.read_text())
ballot = next(iter(document["ballots"].values()))
held = {row["ocdId"] for row in ballot["contests"] if "/sbe:" in row["ocdId"]}
assert held == {"ocd-division/country:us/state:ks/sbe:" + str(i) for i in [1, 3, 5, 7, 9]}
features, points, all_numbers = [], [], set()


def ring(boundary):
    text = boundary.findtext("./LinearRing/coordinates")
    assert text
    coordinates = [[float(part) for part in point.split(",")[:2]] for point in text.split()]
    assert len(coordinates) >= 4 and coordinates[0] == coordinates[-1]
    return coordinates


with zipfile.ZipFile(zip_path) as archive:
    root = ET.fromstring(archive.read("Apple7.kml"))
for placemark in root.iter("Placemark"):
    polygons = placemark.findall(".//Polygon")
    if not polygons:
        continue
    data = {row.get("name"): row.findtext("value") for row in placemark.findall("./ExtendedData/Data")}
    number = int(data["District"])
    assert number not in all_numbers
    all_numbers.add(number)
    ocd_id = "ocd-division/country:us/state:ks/sbe:" + str(number)
    if ocd_id not in held:
        continue
    coordinates = []
    for polygon in polygons:
        outer = polygon.find("outerBoundaryIs")
        assert outer is not None
        coordinates.append([ring(outer)] + [ring(inner) for inner in polygon.findall("innerBoundaryIs")])
    geometry = {"type": "Polygon", "coordinates": coordinates[0]} if len(coordinates) == 1 else {"type": "MultiPolygon", "coordinates": coordinates}
    boundary = shape(geometry)
    assert boundary.is_valid and not boundary.is_empty and boundary.area > 0
    point = boundary.representative_point()
    features.append({"type": "Feature", "properties": {"ocdId": ocd_id, "label": f"Kansas State Board of Education District {number}",
        "sourceUrl": meta["finalUrl"], "sourceHash": meta["rawHash"], "collectedAt": meta["retrievedAt"],
        "adoptedPlan": "Apple7", "adoptedPlanIndex": index_meta["finalUrl"], "adoptedPlanIndexHash": index_meta["rawHash"],
        "countySplitHandling": "Exact adopted district polygon; no county is widened."}, "geometry": geometry})
    points.append({"ocdId": ocd_id, "lat": point.y, "lng": point.x})
assert all_numbers == set(range(1, 11))
assert {row["properties"]["ocdId"] for row in features} == held
features.sort(key=lambda row: row["properties"]["ocdId"])

# The same official enacted-plan index publishes county polygons made from the
# same2020 census base. Exact containment yields whole counties and unambiguous
# split-county flags without a tolerance or a centroid guess.
county_zip = EVIDENCE / "ks-klrd-counties.zip"
county_meta = json.loads((EVIDENCE / "ks-klrd-counties.meta.json").read_text())
assert county_meta["httpStatus"] == 200 and hashlib.sha256(county_zip.read_bytes()).hexdigest() == county_meta["rawHash"]
assert county_meta["requestedUrl"] in index.xpath("//a/@href")
import io
with zipfile.ZipFile(county_zip) as archive:
    with zipfile.ZipFile(io.BytesIO(archive.read("2020-Final-Counties-(Kansas).kmz"))) as kmz:
        county_root = ET.fromstring(kmz.read("doc.kml"))
district_shapes = {row["properties"]["ocdId"]: shape(row["geometry"]) for row in features}
whole_county_memberships = []
split_counties = {key: [] for key in district_shapes}
county_count = 0
for placemark in county_root.iter("Placemark"):
    polygons = placemark.findall(".//Polygon")
    if not polygons:
        continue
    county_count += 1
    county_name = placemark.findtext("./ExtendedData/Data[@name='Name']/value").removesuffix(" KS")
    county_coordinates = [[ring(polygon.find("outerBoundaryIs"))] + [ring(inner) for inner in polygon.findall("innerBoundaryIs")] for polygon in polygons]
    county_geometry = {"type": "Polygon", "coordinates": county_coordinates[0]} if len(county_coordinates) == 1 else {"type": "MultiPolygon", "coordinates": county_coordinates}
    county = shape(county_geometry)
    assert county.is_valid
    member = "ocd-division/country:us/state:ks/county:" + county_name.lower().replace(" ", "_")
    for district_id, district in district_shapes.items():
        if district.covers(county):
            membership = {"id": "bl02-ks-apple7:" + member + "->" + district_id, "memberOcdId": member, "districtOcdId": district_id,
                          "provenance": {"sourceUrl": meta["finalUrl"], "sourceOrg": "Kansas Legislative Research Department",
                                         "collectedAt": meta["retrievedAt"], "verifiedAt": NOW}}
            if not any(row["id"] == membership["id"] for row in ballot["districtMemberships"]):
                ballot["districtMemberships"].append(membership)
            whole_county_memberships.append(membership)
        elif district.intersection(county).area > 0:
            split_counties[district_id].append(county_name)
assert county_count == 105

relative = "data/states/ks/geo/bl02-state-board-20.geojson"
geometry_path = ROOT / relative
geometry_path.parent.mkdir(parents=True, exist_ok=True)
geometry_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
for source, explanation in [
    (meta, "Official enacted Apple7 State Board of Education KML. Parse explicit District fields, preserve every polygon coordinate and hole, and key the five held races with their existing sbe IDs. The archive contains all ten districts. Existing exact Senate memberships remain valid; point polygons and ZIP intersections also reach the education districts directly."),
    (index_meta, "Official Kansas Legislative Research Department Enacted Plans2022 index explicitly lists State Board of Education Apple7 and links this exact KML ZIP as the enacted plan, establishing plan identity and official source ownership."),
    (county_meta, "Official KLRD2020 Kansas county KML, linked beside the enacted plans, contains all105 county polygons from the same census base. Exact covers establishes whole-county memberships; positive-area partial intersections enumerate split counties. No threshold, buffer, centroid or county widening is used.")
]:
    receipt = {"requestedUrl": source["requestedUrl"], "finalUrl": source["finalUrl"], "publisher": "Kansas Legislative Research Department",
               "sourceClass": "OFFICIAL_PUBLISHER", "retrievedAt": source["retrievedAt"], "httpStatus": 200, "rawHash": source["rawHash"],
               "reviewedEvidence": "BL-02 source-bound replay into " + relative + ". " + explanation}
    if not any(row["rawHash"] == receipt["rawHash"] and row["finalUrl"] == receipt["finalUrl"] for row in document["sourceReceipt"]["sources"]):
        document["sourceReceipt"]["sources"].append(receipt)
document["sourceReceipt"]["reviewedAt"] = NOW
document["sourceReceipt"]["reviewedBy"] = "BL-02 Kansas enacted education-district geometry replay"
path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
report = {"checkedAt": NOW, "geometryPath": relative, "geometrySha256": hashlib.sha256(geometry_path.read_bytes()).hexdigest(),
          "sourceArchiveDistrictCount": len(all_numbers), "heldDistrictsProjected": len(features), "points": points,
          "sourceUrl": meta["finalUrl"], "sourceArchiveSha256": meta["rawHash"], "adoptedPlanIndex": index_meta["finalUrl"],
          "countySplitHandling": "Exact official adopted district shapes are used for every split county. No county-to-district assumption.",
          "countySourceSha256": county_meta["rawHash"], "wholeCountyMemberships": whole_county_memberships,
          "splitCounties": split_counties}
(ROOT / "data/ballot/reports/bl02-ks-state-board-geometry.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ["geometryPath", "sourceArchiveDistrictCount", "heldDistrictsProjected"]}))
