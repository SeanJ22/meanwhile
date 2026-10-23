"""Replay the official BART district polygon into existing reader geography data.

Run with PYTHONPATH pointing to an installed Shapely package. No application code,
database, or release is changed. ZIP intersections remain partial/unknown-resident
memberships; they never establish an address's district.
"""
import gzip
import hashlib
import json
import re
from pathlib import Path
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-bart'
DISTRICT = 'ocd-division/country:us/state:ca/special_district:bay_area_rapid_transit_district/district:8'


def source(name):
    raw = gzip.decompress((EVIDENCE / (name + '.gz')).read_bytes())
    meta = json.loads((EVIDENCE / (name + '.source.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash']
    return raw, meta


def main():
    raw, meta = source('bart8.geojson')
    layer = json.loads(raw)
    assert len(layer['features']) == 1 and layer['features'][0]['properties']['District'] == 8
    app, _ = source('app.json')
    page, _ = source('districts.html')
    assert b'9527685698cc481eb9f0733184bad759' in page
    assert b'Board_of_Directors_District_Boundary_Viewer_Base_Data_WFL1/FeatureServer/2' in app
    feature = layer['features'][0]
    geometry = shape(feature['geometry'])
    assert geometry.is_valid
    target = ROOT / 'data/states/ca/geo/bart-director-06.geojson'
    output = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
        'properties': {'ocdId': DISTRICT, 'label': 'BART District 8', 'sourceUrl': meta['finalUrl'],
                       'sourceHash': meta['rawHash'], 'collectedAt': meta['retrievedAt']}, 'geometry': feature['geometry']}]}
    target.write_text(json.dumps(output, separators=(',', ':')) + '\n')
    zctas, _ = source('sf-zctas.geojson')
    shard_path = ROOT / 'data/derived/zip-divisions/94.json'
    shard = json.loads(shard_path.read_text())
    index = shard['divisions'].index(DISTRICT) if DISTRICT in shard['divisions'] else len(shard['divisions'])
    if index == len(shard['divisions']):
        shard['divisions'].append(DISTRICT)
    included = []
    for row in json.loads(zctas)['features']:
        zip_code = row['properties']['ZCTA5']
        area = shape(row['geometry'])
        overlap = area.intersection(geometry).area
        if overlap <= 1e-12 or zip_code not in shard['zips']:
            continue
        included.append(zip_code)
        if index not in shard['zips'][zip_code]:
            shard['zips'][zip_code].append(index)
            if zip_code in shard.get('residents', {}):
                shard['residents'][zip_code].append(-1)
        if index not in shard.setdefault('partial', {}).setdefault(zip_code, []):
            shard['partial'][zip_code].append(index)
    assert '94118' in included
    shard_path.write_text(json.dumps(shard, separators=(',', ':')) + '\n')
    ccds, _ = source('sf-ccd.geojson')
    _, ccd_meta = source('sf-ccd.geojson')
    ccd_features = []
    for row in json.loads(ccds)['features']:
        assert row['properties']['GEOID'].startswith('06075')
        name = re.sub('[^a-z0-9]+', '_', row['properties']['NAME'].lower()).strip('_')
        ccd_features.append({'type': 'Feature', 'properties': {
            'ocdId': 'ocd-division/country:us/state:ca/county:san_francisco/place:' + name,
            'label': row['properties']['NAME'], 'sourceUrl': ccd_meta['finalUrl'],
            'sourceHash': ccd_meta['rawHash'], 'collectedAt': ccd_meta['retrievedAt']}, 'geometry': row['geometry']})
    # Exact point browsing needs the county ancestors too: the prior CA resolver
    # held special districts but no San Francisco county/subdivision polygons.
    (ROOT / 'data/states/ca/geo/bl02-sf-census-geography-06.geojson').write_text(json.dumps(
        {'type': 'FeatureCollection', 'features': ccd_features}, separators=(',', ':')) + '\n')
    split = [{'name': row['properties']['NAME'], 'outsideShareOfArea': shape(row['geometry']).difference(geometry).area / shape(row['geometry']).area}
             for row in json.loads(ccds)['features']]
    assert all(row['outsideShareOfArea'] > 0 for row in split)
    report = {'district': DISTRICT, 'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'],
        'zipIntersections': sorted(included), 'countySplit': 'San Francisco', 'wholeCountyMembershipAdded': False,
        'wholeCityMembershipAdded': False, 'countySubdivisions': split,
        'upstream': 'BART official district viewer and Census current ZCTA polygons',
        'downstream': 'Existing resolver geometry and ZIP area ballot selector',
        'publication': 'Prepared data only; deployed geometry manifests remain pinned until a supported data publisher updates their serving copy.'}
    (ROOT / 'data/ballot/reports/bl02-bart-geography.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'district': DISTRICT, 'zips': len(included), 'wholeCountyMembershipAdded': False}))


if __name__ == '__main__':
    main()
