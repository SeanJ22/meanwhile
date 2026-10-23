"""Join BL-02 official district polygons to current Census ZCTA area polygons.

Requires Shapely. Acquires one state's bounding box at a time, verifies complete
object-ID batches, and appends partial/unknown-resident ZIP edges without moving
any existing reference. No ballot, resolver manifest, runtime code or database is
changed. Existing source captures are reused unless --refresh is supplied.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

from shapely.geometry import shape, mapping
from shapely.validation import make_valid, explain_validity

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/bl02-zip-overlaps"
DIRECTORY = ROOT / "data/derived/zip-divisions"
LAYER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query"
STATE = re.compile(r"^ocd-division/country:us/(?:state|territory|district):([a-z]{2})(?:/|$)")
STATEWIDE = re.compile(r"^ocd-division/country:us(?:/(?:state|territory|district):[a-z]{2})?$")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def capture(path, params, refresh):
    url = LAYER + "?" + urlencode(params)
    metadata_path = path.with_suffix(path.suffix + ".source.json")
    if not refresh and path.exists() and metadata_path.exists():
        meta = json.loads(metadata_path.read_text())
        raw = gzip.decompress(path.read_bytes())
        assert digest(raw) == meta["rawHash"], str(path)
        if meta["requestedUrl"] == url:
            return json.loads(raw), meta
    for attempt in range(4):
        try:
            with urlopen(url, timeout=90) as response:
                raw = response.read()
                parsed = json.loads(raw)
                if parsed.get("error"):
                    raise RuntimeError(str(parsed["error"]))
                metadata = dict(requestedUrl=url, finalUrl=response.url,
                    httpStatus=response.status, rawHash=digest(raw), savedBytes=len(raw),
                    retrievedAt=datetime.now(timezone.utc).isoformat(), publisher="U.S. Census Bureau")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(gzip.compress(raw, mtime=0))
                metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
                return parsed, metadata
        except HTTPError as error:
            if attempt == 3 or error.code not in [429, 500, 502, 503, 504]:
                raise
            delay = error.headers.get("Retry-After")
            time.sleep(min(float(delay) if delay and delay.isdigit() else 2 ** attempt, 30))


def boundaries(state):
    result = []
    for path in sorted((ROOT / f"data/states/{state}/geo").glob("bl02*.geojson")):
        raw = path.read_bytes()
        for feature in json.loads(raw)["features"]:
            division = feature["properties"]["ocdId"]
            assert STATE.match(division).group(1) == state
            geometry = shape(feature["geometry"])
            assert geometry.is_valid and not geometry.is_empty, division
            result.append(dict(division=division, geometry=geometry,
                inputPath=str(path.relative_to(ROOT)), inputSha256=digest(raw),
                sourceUrl=feature["properties"].get("sourceUrl"),
                sourceHash=feature["properties"].get("sourceHash")))
    assert result and len(result) == len({row["division"] for row in result})
    return result


def acquire_state(state, refresh):
    districts = boundaries(state)
    bounds = [row["geometry"].bounds for row in districts]
    envelope = [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)]
    query, ids_meta = capture(EVIDENCE / state / "zcta-ids.json.gz", dict(
        where="1=1", geometry=",".join(map(str, envelope)), geometryType="esriGeometryEnvelope",
        inSR=4326, spatialRel="esriSpatialRelIntersects", returnIdsOnly="true", f="json"), refresh)
    assert query["objectIdFieldName"] == "OBJECTID" and isinstance(query["objectIds"], list)
    identifiers = sorted(query["objectIds"])
    assert identifiers and len(identifiers) == len(set(identifiers))
    received, geometries, batches, normalizations = set(), [], [], []
    for page, start in enumerate(range(0, len(identifiers), 75), 1):
        expected = identifiers[start:start + 75]
        document, metadata = capture(EVIDENCE / state / f"zcta-{page:03}.geojson.gz", dict(
            objectIds=",".join(map(str, expected)), outFields="OBJECTID,GEOID,NAME,ZCTA5",
            returnGeometry="true", outSR=4326, f="geojson"), refresh)
        assert not document.get("exceededTransferLimit")
        actual = [feature["properties"]["OBJECTID"] for feature in document["features"]]
        assert len(actual) == len(set(actual)) and set(actual) == set(expected), (state, page)
        assert not received.intersection(actual)
        received.update(actual)
        for feature in document["features"]:
            geometry = shape(feature["geometry"])
            if not geometry.is_valid:
                corrected = make_valid(geometry)
                def vertices(value):
                    if len(value) >= 2 and isinstance(value[0], (int, float)):
                        return {tuple(value)}
                    return set().union(*(vertices(child) for child in value))
                assert vertices(feature["geometry"]["coordinates"]) == vertices(mapping(corrected)["coordinates"])
                assert math.isclose(geometry.area, corrected.area, rel_tol=1e-10, abs_tol=1e-16)
                normalizations.append(dict(zcta=feature["properties"]["ZCTA5"],
                    originalIssue=explain_validity(geometry), originalArea=geometry.area,
                    correctedArea=corrected.area, identicalCoordinateSet=True,
                    action="Normalized self-touching source ring topology; no new vertices, snapping or buffering."))
                geometry = corrected
            assert geometry.is_valid, (state, feature["properties"]["ZCTA5"])
            geometries.append((feature["properties"]["ZCTA5"], geometry))
        batches.append(dict(path=str((EVIDENCE / state / f"zcta-{page:03}.geojson.gz").relative_to(ROOT)), **metadata))
    assert received == set(identifiers)
    print(f"{state.upper()}: complete Census ZCTA response, {len(received)} areas in {len(batches)} verified object-ID batches", flush=True)
    return state, districts, geometries, dict(envelope=envelope, expectedObjectIds=len(identifiers),
        returnedObjectIds=len(received), complete=True, idQuery=ids_meta, batches=batches,
        geometryNormalizations=normalizations)


def index_counts(shard):
    partial = 0
    no_county = 0
    for zip_code, refs in shard["zips"].items():
        total = shard.get("zipResidents", {}).get(zip_code, 0)
        counts = shard.get("residents", {}).get(zip_code)
        some_partial, some_county = False, False
        for position, ref in enumerate(refs):
            division = shard["divisions"][ref]
            some_county |= "/county:" in division
            if STATEWIDE.fullmatch(division):
                continue
            residents = counts[position] if counts is not None and total > 0 else -1
            if residents >= 0 and residents / total < 0.05:
                continue
            if residents < 0 or residents / total < 0.995:
                some_partial = True
        partial += some_partial
        no_county += not some_county
    return dict(zips=len(shard["zips"]), divisionReferences=len(shard["divisions"]),
        edges=sum(map(len, shard["zips"].values())), zipsWithAPartialDivision=partial,
        zipsWithNoCountyEdge=no_county)


def main(refresh):
    states = sorted({path.parents[1].name for path in (ROOT / "data/states").glob("*/geo/bl02*.geojson")})
    assert states
    with ThreadPoolExecutor(max_workers=4) as pool:
        acquired = list(pool.map(lambda state: acquire_state(state, refresh), states))
    held_zips = {}
    for path in DIRECTORY.glob("[0-9][0-9].json"):
        document = json.loads(path.read_text())
        for zip_code in document["zips"]:
            held_zips[zip_code] = path.stem
    shards, before, changed = {}, {}, set()
    def held_shard(prefix):
        if prefix not in shards:
            path = DIRECTORY / (prefix + ".json")
            raw = path.read_bytes()
            shards[prefix] = json.loads(raw)
            before[prefix] = dict(sha256=digest(raw), document=json.loads(raw))
        return shards[prefix]
    state_reports = []
    for state, districts, zctas, source in acquired:
        district_reports = []
        for district in districts:
            division, area = district["division"], district["geometry"]
            intersections, absent, introduced_state = [], [], []
            added = existing = 0
            for zip_code, zip_area in zctas:
                if not area.intersects(zip_area) or area.intersection(zip_area).area <= 0:
                    continue
                if zip_code not in held_zips:
                    absent.append(zip_code)
                    continue
                prefix = held_zips[zip_code]
                shard = held_shard(prefix)
                refs = shard["zips"][zip_code]
                if not any(STATE.match(shard["divisions"][ref]) and STATE.match(shard["divisions"][ref]).group(1) == state for ref in refs):
                    introduced_state.append(zip_code)
                if division not in shard["divisions"]:
                    shard["divisions"].append(division)
                index = shard["divisions"].index(division)
                if index in refs:
                    existing += 1
                else:
                    residents = shard.setdefault("residents", {}).setdefault(zip_code, [-1] * len(refs))
                    assert len(residents) == len(refs)
                    refs.append(index)
                    residents.append(-1)
                    added += 1
                    changed.add(prefix)
                partial = shard.setdefault("partial", {}).setdefault(zip_code, [])
                if index not in partial:
                    partial.append(index)
                    changed.add(prefix)
                intersections.append(zip_code)
            assert intersections, division
            district_reports.append(dict(districtOcdId=division, inputPath=district["inputPath"],
                inputSha256=district["inputSha256"], officialDistrictSource=district["sourceUrl"],
                intersectingHeldZips=sorted(intersections), addedEdges=added, existingEdgesPreserved=existing,
                unheldCensusZctas=sorted(absent), zipsPreviouslyWithoutState=sorted(introduced_state)))
        state_reports.append(dict(state=state.upper(), censusSource=source, districts=district_reports))
    shard_reports = []
    for prefix in sorted(changed):
        shard, old = shards[prefix], before[prefix]["document"]
        assert shard["divisions"][:len(old["divisions"])] == old["divisions"]
        for zip_code, refs in old["zips"].items():
            assert shard["zips"][zip_code][:len(refs)] == refs
            assert len(shard["zips"][zip_code]) == len(set(shard["zips"][zip_code]))
            if zip_code in old.get("residents", {}):
                assert shard["residents"][zip_code][:len(refs)] == old["residents"][zip_code]
            if zip_code in shard.get("residents", {}):
                assert len(shard["residents"][zip_code]) == len(shard["zips"][zip_code])
            assert set(old.get("partial", {}).get(zip_code, [])).issubset(shard.get("partial", {}).get(zip_code, []))
        raw = (json.dumps(shard, separators=(",", ":")) + "\n").encode()
        (DIRECTORY / (prefix + ".json")).write_bytes(raw)
        shard_reports.append(dict(shard=prefix, beforeSha256=before[prefix]["sha256"], afterSha256=digest(raw),
            priorReferencesPreserved=True, priorResidentCountsPreserved=True, aligned=True))
    index_path = DIRECTORY / "index.json"
    index = json.loads(index_path.read_text())
    old_counts = dict(index["counts"])
    totals, states_to_shards = {}, {}
    for path in sorted(DIRECTORY.glob("[0-9][0-9].json")):
        raw = path.read_bytes()
        shard = json.loads(raw)
        for key, value in index_counts(shard).items():
            totals[key] = totals.get(key, 0) + value
        states = sorted({STATE.match(shard["divisions"][ref]).group(1).upper()
            for refs in shard["zips"].values() for ref in refs if STATE.match(shard["divisions"][ref])})
        index["shards"][path.stem] = dict(sha256=digest(raw), zips=len(shard["zips"]), states=states)
        for state in states:
            states_to_shards.setdefault(state, []).append(path.stem)
    index["counts"].update(totals)
    index["counts"]["shards"] = len(index["shards"])
    index["statesToShards"] = states_to_shards
    index["generatedAt"] = datetime.now(timezone.utc).date().isoformat()
    index["bl02AreaIntersectionSource"] = "Exact official district polygons in data/states/*/geo/bl02*.geojson joined to current Census2020 ZCTA boundaries; appended edges are partial with unknown resident counts."
    index_path.write_text(json.dumps(index, indent=2) + "\n")
    report = dict(checkedAt=datetime.now(timezone.utc).isoformat(), states=state_reports,
        changedShards=shard_reports, addedEdges=sum(d["addedEdges"] for s in state_reports for d in s["districts"]),
        currentHeldZipEdges=sum(len(d["intersectingHeldZips"]) for s in state_reports for d in s["districts"]),
        districtsWithHeldZipCoverage=sum(len(s["districts"]) for s in state_reports),
        priorIndexCounts=old_counts, currentIndexCounts=index["counts"],
        meaning="Positive-area ZCTA intersections are ZIP-area ballot coverage, never proof that an individual address is in a district. New edges retain unknown resident counts and remain partial. Complete object-ID response sets were verified before file edits.",
        upstream="Official saved BL02 district polygons plus the Census Bureau's current TIGERweb2020 ZCTA layer",
        downstream="Existing ZIP area division selector and its partial-membership reader labels; resolver and reader manifests are managed separately.",
        releaseEvents=0, databaseWrites=0)
    (ROOT / "data/ballot/reports/bl02-boundary-zip-overlaps.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(addedEdges=report["addedEdges"], districts=report["districtsWithHeldZipCoverage"], shards=sorted(changed))))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    main(parser.parse_args().refresh)
