"""Replay Mississippi judicial races whose adopted electorate is an exact county union.

Requires pyshp, shapely and pyproj. GIS packages are acquisition/replay tools, not
application dependencies. No precinct subdistrict is expanded into a county.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
import shapefile
from shapely.geometry import shape
from shapely import transform
from shapely.ops import unary_union
from pyproj import CRS, Transformer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--evidence', type=Path)
parser.add_argument('--registry', type=Path)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
ROOT = args.root
EVIDENCE = args.evidence or ROOT / 'data/ballot/evidence/ba01-south/ms-judicial'
STATE = ROOT / 'data/ballot/2026-general/ms.json'
OUTPUT = args.output or STATE
# This is solely a floating-point round-trip tolerance. The observed differences
# are about 1e-12, not an approximate coverage allowance for split precincts.
NUMERIC_EPSILON = 1e-10


def capture(filename):
    path = EVIDENCE / filename
    meta_path = path.with_name(filename + '.source.json')
    if not meta_path.exists():
        meta_path = path.with_suffix('.source.json')
    meta = json.loads(meta_path.read_text())
    raw = path.read_bytes()
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['sha256'], filename
    return raw, meta


def shapes(filename):
    raw, meta = capture(filename)
    z = zipfile.ZipFile(io.BytesIO(raw))
    stems = [n[:-4] for n in z.namelist() if n.endswith('.shp')]
    assert len(stems) == 1
    name = stems[0]
    r = shapefile.Reader(shp=io.BytesIO(z.read(name+'.shp')), shx=io.BytesIO(z.read(name+'.shx')), dbf=io.BytesIO(z.read(name+'.dbf')))
    crs = CRS.from_wkt(z.read(name+'.prj').decode())
    result = []
    for record in r.iterShapeRecords():
        geometry = shape(record.shape.__geo_interface__)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        assert geometry.is_valid
        result.append((record.record.as_dict(), geometry))
    return result, crs, meta


agency, agency_meta = capture('maris-official-link.html')
assert b'https://maris.mississippi.edu' in agency
landing, landing_meta = capture('maris-current-page.html')
assert b'2027-2031 Chancery and Circuit Court Shapefiles' in landing
assert b'2027_Chancery.zip' in landing and b'2027_Circuit.zip' in landing
county_rows, county_crs, county_meta = shapes('counties-2020.zip')
assert len(county_rows) == 82
conversion = Transformer.from_crs(county_crs, 4269, always_xy=True)
counties = {}
for row, geometry in county_rows:
    assert row['STATEFP20'] == '28'
    county = row['NAME20']
    assert county not in counties
    counties[county] = transform(geometry, conversion.transform, interleaved=False)

registry_path = args.registry or EVIDENCE / 'ocd-ms-courts.csv'
registry = registry_path.read_bytes()
registry_ids = {row['id'] for row in csv.DictReader(io.StringIO(registry.decode()))}
if not args.registry:
    registry_meta = json.loads(registry_path.with_suffix('.source.json').read_text())
    assert hashlib.sha256(registry).hexdigest() == registry_meta['sourceTextSha256']

# Only a district polygon exactly equal to the union of its full counties is
# eligible. Whole counties inside a district that also has partial counties are
# insufficient here. No broad district ID is used for a narrower subdistrict.
scopes = {}
geometry_proof = []
shape_sources = []
for kind, filename in [('chancery', 'chancery-2027.zip'), ('circuit', 'circuit-2027.zip')]:
    district_rows, district_crs, district_meta = shapes(filename)
    assert district_crs.equals(CRS.from_epsg(4269), ignore_axis_order=True)
    shape_sources.append(district_meta)
    for row, geometry in district_rows:
        district = row['DISTRICT']
        assert district
        members = []
        split = []
        for county, county_geometry in counties.items():
            if not geometry.intersects(county_geometry):
                continue
            covered = geometry.intersection(county_geometry).area / county_geometry.area
            if abs(covered - 1) <= NUMERIC_EPSILON:
                members.append(county)
            elif covered > NUMERIC_EPSILON:
                split.append(county)
        if not members or split:
            continue
        union = unary_union([counties[county] for county in members])
        difference = geometry.symmetric_difference(union).area / geometry.area
        assert difference <= NUMERIC_EPSILON, (kind, district, difference)
        # Canonical full district identifiers for plain districts; an exact
        # one-county subdistrict may instead use that county's canonical ID.
        if '-' in district:
            if len(members) != 1:
                continue
            ocd = 'ocd-division/country:us/state:ms/county:' + members[0].lower().replace(' ', '_')
        else:
            ocd = 'ocd-division/country:us/state:ms/' + kind + '_court:' + district
        assert ocd in registry_ids, ocd
        assert (kind, district) not in scopes
        scopes[kind, district] = (sorted(members), ocd, district_meta)
        geometry_proof.append({'kind': kind, 'district': district, 'counties': sorted(members), 'ocdId': ocd,
            'symmetricDifferenceFraction': difference, 'sourceUrl': district_meta['finalUrl'],
            'countySourceUrl': county_meta['finalUrl']})

# The current official MARIS page explicitly identifies its historical 1990
# congressional polygons as today's Court of Appeals districts. Only counties
# entirely inside a polygon are related; old coastline/generalization mismatches
# and actual split counties are excluded without a relaxed coverage threshold.
appeals_landing, appeals_landing_meta = capture('maris-appeals.html')
assert b'This data is also used as the Court of Appeals Districts for Mississippi' in appeals_landing
appeals_rows, appeals_crs, appeals_meta = shapes('court-appeals.zip')
assert appeals_crs.equals(county_crs, ignore_axis_order=True)
appeals_geometries = {}
for row, geometry in appeals_rows:
    appeals_geometries.setdefault(str(row['ANNONUM']), []).append(geometry)
assert set(appeals_geometries) == {'1','2','3','4','5'}
for district, geometries in appeals_geometries.items():
    geometry = unary_union(geometries)
    members = []
    uncovered = {}
    for row, county_geometry in county_rows:
        county = row['NAME20']
        if not geometry.intersects(county_geometry):
            continue
        difference = county_geometry.difference(geometry).area / county_geometry.area
        if difference <= NUMERIC_EPSILON:
            members.append(county)
            uncovered[county] = difference
    assert members
    ocd = 'ocd-division/country:us/state:ms/court_of_appeals:' + district
    assert ocd in registry_ids
    scopes['appeals', district] = (sorted(members), ocd, appeals_meta)
    geometry_proof.append({'kind':'appeals','district':district,'counties':sorted(members),'ocdId':ocd,
        'countyUncoveredFractions':uncovered,'sourceUrl':appeals_meta['finalUrl'],
        'countySourceUrl':county_meta['finalUrl'],
        'limitation':'Only counties fully covered by the official district polygon are included; all other counties are excluded.'})

sample = ROOT / 'data/ballot/evidence/ba01-south/ms-2026.pdf'
sample_meta = json.loads(sample.with_suffix('.source.json').read_text())
assert hashlib.sha256(sample.read_bytes()).hexdigest() == sample_meta['sha256']
text = sample.with_suffix('.txt').read_text()
assert 'November 3, 2026' in text
source = []
for match in re.finditer(r'(?m)^For (.*?)\nVote for ONE\n(.*?)\nWrite-in', text, re.S):
    title = ' '.join(match[1].splitlines())
    names = re.findall(r'(?m)^(.+) (Democrat|Republican|Independent|Libertarian|Nonpartisan)$', match[2])
    source.append((title, names))
assert len(source) == 133 and sum(len(names) for _, names in source) == 188


def provenance(meta, org, quote):
    return {'sourceUrl': meta['finalUrl'], 'sourceOrg': org, 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt'], 'quote': quote}


data = json.loads(STATE.read_text())
ballot = data['ballots']['MS:ms-2026-11-03']
memberships = ballot.setdefault('districtMemberships', [])
added_contests = added_candidates = added_memberships = 0
selected = []
for title, names in source:
    kind = 'chancery' if title.startswith('Chancery') else 'circuit' if title.startswith('Circuit') else 'appeals' if title.startswith('Court of Appeals') else None
    if not kind:
        continue
    match = re.search(r'(?:Chancery District|Chancery Court, District|Circuit District|Circuit Court|Court of Appeals Judge District)\s*(\d+(?:-\d+)?)', title)
    assert match, title
    district = match[1]
    if '-' not in district:
        district = str(int(district))
    scope = scopes.get((kind, district))
    if not scope:
        continue
    member_counties, ocd, district_meta = scope
    place = re.search(r'(?:Place|Position) (\d+)', title)
    ident = 'ms-ba01-2026-' + kind + '-' + district + ('-place-' + place[1] if place else '')
    assert names and all(party == 'Nonpartisan' for _, party in names)
    selected.append((ident, title, names))
    if not any(row['id'] == ident for row in ballot['contests']):
        quote = title + '\n' + '\n'.join(name + ' ' + party for name, party in names)
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': ocd,
            'divisionVintage': '2027_TERM', 'title': title, 'type': 'CANDIDACY', 'voteFor': 1,
            'termYears': None, 'scopeNote': None, 'candidateListComplete': True,
            'provenance': provenance(sample_meta, 'Mississippi Secretary of State', quote)})
        added_contests += 1
        for name, party in names:
            slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
            ballot['candidacies'].append({'id': ident + '-' + slug, 'contestId': ident,
                'familyName': name, 'givenName': '', 'partyLabel': party, 'slogan': None, 'incumbent': None,
                'websiteUrl': None, 'provenance': provenance(sample_meta, 'Mississippi Secretary of State', name + ' ' + party)})
            added_candidates += 1
    published = [row for row in ballot['contests'] if row['id'] == ident]
    assert len(published) == 1 and published[0]['ocdId'] == ocd
    actual = [row for row in ballot['candidacies'] if row['contestId'] == ident]
    assert len(actual) == len(names) and {(row['familyName'], row['partyLabel']) for row in actual} == set(names)
    if ocd.find('/county:') == -1:
        for county in member_counties:
            member = 'ocd-division/country:us/state:ms/county:' + county.lower().replace(' ', '_')
            assert member in registry_ids
            mid = 'ms-ba01-county-' + county.lower().replace(' ', '_') + '-' + kind + '-' + district
            if not any(row['id'] == mid for row in memberships):
                memberships.append({'id': mid, 'memberOcdId': member, 'districtOcdId': ocd,
                    'provenance': provenance(district_meta, 'Mississippi Automated Resource Information System (MARIS)',
                        'DISTRICT=' + district + '; exact whole-county members: ' + ', '.join(member_counties) + '. Replayed against the published 2020 county geometries; only complete county coverage within numerical round-trip error is accepted.')})
                added_memberships += 1
assert len(selected) == 87 and sum(len(names) for _, _, names in selected) == 112

used = [(sample_meta, 'Mississippi Secretary of State'), (agency_meta, 'Mississippi state government'), (landing_meta, 'Mississippi Automated Resource Information System (MARIS)'),
        (county_meta, 'Mississippi Automated Resource Information System (MARIS)')]
used += [(meta, 'Mississippi Automated Resource Information System (MARIS)') for meta in shape_sources + [appeals_landing_meta, appeals_meta]]
for meta, org in used:
    receipt = {'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'], 'retrievedAt': meta['retrievedAt'],
        'httpStatus': meta['httpStatus'], 'rawHash': meta['sha256'], 'publisher': org, 'sourceClass': 'ELECTION_AUTHORITY' if meta is sample_meta else 'OFFICIAL_PUBLISHER',
        'reviewOutcome': 'SUPPORTED', 'reviewedEvidence': 'scripts/ba01-south-ms-courts.py verifies exact adopted 2027-term judicial polygon unions against all 82 official county polygons, using a 1e-10 relative tolerance solely for coordinate floating-point round trips. All partial-county electorates are excluded, and the statewide official November 3 sample supplies all names and parties uniformly. MARIS is linked by the saved ms.gov agency directory.'}
    if not any(row.get('finalUrl') == receipt['finalUrl'] and row.get('rawHash') == receipt['rawHash'] and row.get('retrievedAt') == receipt['retrievedAt'] for row in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append(receipt)
    data['sourceReceipt']['reviewedAt'] = max(data['sourceReceipt']['reviewedAt'], meta['retrievedAt'])
note = 'The dated statewide sample supplies all candidates in 87 additional judicial contests. Official MARIS GIS proves exact whole-county unions for 82 trial-court races (Circuit subdistrict 6-3 is exactly Pike County), plus 13 whole-county memberships in the four appellate electorates on this ballot. Other appellate county relations and precinct/subdistrict judicial electorates still need precise mapping. County/city/school contests and local measures remain incomplete.'
if note not in ballot['coverageNotes']:
    ballot['coverageNotes'].append(note)
OUTPUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(EVIDENCE/'verified-electorates.json').write_text(json.dumps(geometry_proof,indent=2)+'\n')
normalize_title = lambda value: re.sub(r'[^a-z0-9]', '', value.removeprefix('For ').lower())
source_titles = {normalize_title(title) for title, _names in source}
held_source_ids = {row['id'] for row in ballot['contests'] if normalize_title(row['title']) in source_titles}
print(json.dumps({'added_contests':added_contests,'added_candidates':added_candidates,'added_memberships':added_memberships,
    'contests':len(ballot['contests']),'candidacies':len(ballot['candidacies']), 'regional_remaining_contests':len(source) - len(held_source_ids),
    'regional_remaining_candidates':sum(len(names) for _, names in source) - sum(row['contestId'] in held_source_ids for row in ballot['candidacies']),'max_symmetric_difference':max(r.get('symmetricDifferenceFraction',0) for r in geometry_proof)},indent=2))
