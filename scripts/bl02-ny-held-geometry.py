"""Read current NYC DCP court and council polygons into the held ballot's exact districts."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-ny'
BASE = 'ocd-division/country:us/state:ny/'


def read(name):
    raw = (EVIDENCE / name).read_bytes()
    meta = json.loads((EVIDENCE / (name + '.capture.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
    return json.loads(raw), meta


def main(write):
    municipal, municipal_meta = read('nyc-municipal.geojson')
    council, council_meta = read('nyc-council3.geojson')
    court_description, _ = read('nyc-municipal-metadata.json')
    council_description, _ = read('nyc-council-metadata.json')
    for meta in [court_description, council_description]:
        assert meta['attribution'] == 'Department of City Planning (DCP)' and '26b' in meta['description']
    assert len(municipal['features']) == 28 and len(council['features']) == 1
    mapping = [('1', 'Manhattan', '03', 'new_york', 3), ('4', 'Queens', '04', 'queens', 4), ('2', 'Bronx', '02', 'bronx', 2)]
    features = []
    points = []
    splits = []

    def add(feature, district, label, meta, source_fields):
        geometry = shape(feature['geometry'])
        assert geometry.is_valid and not geometry.is_empty
        point = geometry.representative_point()
        features.append({'type': 'Feature', 'properties': {'ocdId': district, 'label': label,
            'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'], 'collectedAt': meta['retrievedAt']},
            'geometry': feature['geometry']})
        points.append({'districtOcdId': district, 'lat': point.y, 'lng': point.x, 'sourceFields': source_fields})

    for code, borough, number, county, district in mapping:
        selected = [f for f in municipal['features'] if f['properties']['boro_code'] == code and f['properties']['muni_court'] == number]
        assert len(selected) == 1 and selected[0]['properties']['boro_name'] == borough
        division = BASE + f'county:{county}/municipal_court_district:{district}'
        add(selected[0], division, f'{borough} Municipal Court District {district}', municipal_meta,
            {'boro_code': code, 'boro_name': borough, 'muni_court': number})
        splits.append({'districtOcdId': division, 'county': county.replace('_', ' ').title(), 'wholeCountyMembershipAdded': False})
    c = council['features'][0]
    assert c['properties']['coundist'] == '3'
    add(c, BASE + 'place:new_york/council_district:3', 'New York City Council District 3', council_meta, {'coundist': '3'})
    splits.append({'districtOcdId': BASE + 'place:new_york/council_district:3', 'county': 'New York', 'wholeCountyMembershipAdded': False})
    path = ROOT / 'data/states/ny/geo/bl02-held-districts-36.geojson'
    ny_path = ROOT / 'data/ballot/2026-general/ny.json'
    data = json.loads(ny_path.read_text())
    ballot = next(iter(data['ballots'].values()))
    before = copy.deepcopy(ballot)
    for feature in features:
        district = feature['properties']['ocdId']
        matches = [row for row in ballot['contests'] if row['ocdId'] == district]
        assert len(matches) == 1
        county = next(r['county'] for r in splits if r['districtOcdId'] == district)
        matches[0]['scopeNote'] = f'This district covers part of {county} County.'
    for meta in [municipal_meta, council_meta]:
        receipt = {**meta, 'publisher': 'New York City Department of City Planning', 'sourceClass': 'OFFICIAL_PUBLISHER',
                   'reviewedEvidence': 'Current 26b official district polygons replayed by exact borough and district fields. Municipal Court districts are the political election districts for NYC Civil Court judges, not the county judicial administration districts. No whole-county or whole-city membership is added.'}
        if not any(s['rawHash'] == receipt['rawHash'] and s['finalUrl'] == receipt['finalUrl'] for s in data['sourceReceipt']['sources']):
            data['sourceReceipt']['sources'].append(receipt)
    data['sourceReceipt']['reviewedAt'] = council_meta['retrievedAt']
    data['sourceReceipt']['reviewedBy'] = 'bl02-ny-exact-district-geography'
    assert before['candidacies'] == ballot['candidacies']
    assert [c['id'] for c in before['contests']] == [c['id'] for c in ballot['contests']]
    report = {'step': 'BL-02', 'state': 'NY', 'geometryPath': str(path.relative_to(ROOT)), 'districts': 4,
        'sourceVersion': '26b', 'sources': [municipal_meta, council_meta], 'countySplits': splits, 'representativePoints': points,
        'allPolygonsValid': True, 'wholeCountyMembershipsAdded': 0, 'wholeCityMembershipsAdded': 0,
        'upstream': 'Official NYC DCP current district lists and polygons, matched to already-held NYC Board of Elections contests',
        'downstream': 'Existing resolver geometry and ballot point selector; parent regenerates the combined manifest',
        'meaning': 'Exact election district geometry for all four unreachable held New York races. All districts split a county. Geographic scopes stay narrow; publication and production reader replay belong to the parent BL-02 task.'}
    if write:
        path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')) + '\n')
        ny_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        (ROOT / 'data/ballot/reports/bl02-ny-held-districts.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'districts': 4, 'sourceVersion': '26b', 'wholeCountyMembershipsAdded': 0, 'allPolygonsValid': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    main(parser.parse_args().write)
