"""Compile the remaining Maine/Ohio held ballot geography from official evidence.

Data compiler only: registry towns become whole-place memberships; partial-city
electorates retain the original official polygon coordinates for point lookup.
Run with Shapely on PYTHONPATH for the geometric validation below.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from lxml import html
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-me-oh'
NOW = datetime.now(timezone.utc).isoformat()


def read(stem):
    raw = gzip.decompress((EVIDENCE / (stem + '.raw.gz')).read_bytes())
    meta = json.loads((EVIDENCE / (stem + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash'], stem
    return raw, meta


def normal(value):
    value = value.lower().replace('saint ', 'st ').replace('st.', 'st')
    value = re.sub(r'\b(city|town|township|ut|cdp)\b', '', value.replace('_', ' '))
    return re.sub(r'[^a-z0-9]', '', value)


def main(write=False):
    documents = {st: json.loads((ROOT / f'data/ballot/2026-general/{st}.json').read_text()) for st in ['me', 'oh']}
    ballots = {st: next(iter(d['ballots'].values())) for st, d in documents.items()}
    prior = copy.deepcopy(ballots)
    ids = set()
    for file in (ROOT / 'data/derived/zip-divisions').glob('[0-9][0-9].json'):
        ids.update(json.loads(file.read_text())['divisions'])
    memberships = []
    boundaries = {'me': [], 'oh': []}
    flags = []
    changed = {st: False for st in documents}

    def receipt(st, stem, publisher, detail):
        _, meta = read(stem)
        row = {**{k: meta[k] for k in ['requestedUrl', 'finalUrl', 'retrievedAt', 'httpStatus', 'rawHash']},
               'publisher': publisher, 'sourceClass': 'OFFICIAL_PUBLISHER', 'reviewedEvidence': detail}
        sources = documents[st]['sourceReceipt']['sources']
        if not any(s['rawHash'] == row['rawHash'] and s['finalUrl'] == row['finalUrl'] for s in sources):
            sources.append(row)
            changed[st] = True
        return meta

    # State revenue's .gov directory establishes the county's .me.us publisher;
    # the county Deeds page directly links both lists used below.
    raw, _ = read('me-revenue-gov-www11')
    assert html.fromstring(raw).xpath('//a[@href="https://aroostook.me.us/departments/deeds/"]')
    raw, _ = read('me-aroostook-government')
    for suffix in ['rodn-areas', 'rods-areas']:
        assert html.fromstring(raw).xpath(f'//a[@href="https://aroostook.me.us/pdfs/{suffix}/"]')
    receipt('me', 'me-revenue-gov-www11', 'Maine Revenue Services', 'Government directory directly links the Aroostook County Deeds page, establishing the county publisher for its two whole-community registry lists.')
    receipt('me', 'me-aroostook-government', 'Aroostook County Government', 'County Deeds page directly links the Northern and Southern Registry of Deeds community-list PDFs; the lists are captured and replayed separately.')

    lists = {
        'northern': ['Allagash', 'Caswell', 'Cyr Plantation', 'Eagle Lake', 'Fort Kent', 'Frenchville', 'Grand Isle', 'Hamlin', 'Madawaska', 'New Canada', 'St. Agatha', 'St. Francis', 'St. John Plantation', 'Stockholm', 'Van Buren', 'Wallagrass', 'Westmanland', 'Winterville Plantation'],
        'southern': ['Amity', 'Ashland', 'Blaine', 'Bridgewater', 'Caribou', 'Castle Hill', 'Chapman', 'Crystal', 'Dyer Brook', 'Easton', 'Fort Fairfield', 'Garfield Plantation', 'Glenwood Plantation', 'Hammond', 'Haynesville', 'Hersey', 'Hodgdon', 'Houlton', 'Island Falls', 'Limestone', 'Linneus', 'Littleton', 'Ludlow', 'Macwahoc Plantation', 'Mapleton', 'Mars Hill', 'Masardis', 'Merrill', 'Monticello', 'Moro Plantation', 'Nashville Plantation', 'New Limerick', 'New Sweden', 'Oakfield', 'Orient', 'Perham', 'Portage Lake', 'Presque Isle', 'Reed Plantation', 'Sherman', 'Smyrna', 'Wade', 'Washburn', 'Westfield', 'Weston', 'Woodland'],
    }
    ballot = ballots['me']
    existing = {(m['memberOcdId'], m['districtOcdId']) for m in ballot.get('districtMemberships', [])}
    for registry, names in lists.items():
        stem = 'me-registry-' + ('north' if registry == 'northern' else 'south')
        raw, meta = read(stem)
        text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode()
        # The table wraps this one name across two physical lines.
        text = re.sub(r'St\.\s+T16 R5/Square Lake\s+Agatha', 'St. Agatha', text)
        text_key = normal(text)
        assert ('Northern' if registry == 'northern' else 'Southern') + ' Registry of Deeds' in text
        assert 'Serves the following communities:' in text
        district = 'ocd-division/country:us/state:me/county:aroostook/registry_district:' + registry
        for name in names:
            assert normal(name) in text_key, (registry, name)
            members = {member for member in ids if member.startswith('ocd-division/country:us/state:me/') and '/place:' in member
                       and normal(member.split('/place:')[1]) == normal(name)
                       and ('/county:' not in member or '/county:aroostook/' in member)}
            assert members, (registry, name)
            for member in sorted(members):
                pair = member, district
                if pair in existing:
                    continue
                existing.add(pair)
                row = {'id': 'bl02-final:' + hashlib.sha256((member + '->' + district).encode()).hexdigest()[:24],
                       'memberOcdId': member, 'districtOcdId': district,
                       'provenance': {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Aroostook County Government',
                                      'collectedAt': meta['retrievedAt'], 'verifiedAt': NOW,
                                      'quote': f'{registry.title()} Registry of Deeds — Serves the following communities: {name}'}}
                ballot.setdefault('districtMemberships', []).append(row)
                memberships.append(row)
                changed['me'] = True
        receipt('me', stem, 'Aroostook County Government', 'Saved original county PDF at data/ballot/evidence/bl02-me-oh/' + stem + '.raw.gz. Code confirms each named whole town/city/plantation occurs in the table and binds only matching existing ZIP-index aliases. Aggregated unorganized territories and retired Cary/Oxbow names are not widened from individual township rows.')
        flags.append({'state': 'ME', 'districtOcdId': district, 'splitCounty': 'aroostook', 'wholeMunicipalities': len(names),
                      'wholeCountyMembershipAdded': False, 'remaining': 'Aggregated unorganized territories need exact township-to-aggregate containment; individual township rows never widen an aggregate.'})

    # The GIS publisher identity is the State of Maine; the service's field
    # keys and names must exactly agree with the three held electorate IDs.
    raw, _ = read('me-commission-item')
    item = json.loads(raw)
    assert item['orgId'] == 'RbMX0mRVOFNTdLzd' and item['owner'].endswith('@maine.gov_maine')
    raw, _ = read('me-arcgis-org')
    assert json.loads(raw)['name'] == 'State of Maine'
    raw, _ = read('me-2024-service')
    service = json.loads(raw)
    assert 'Town of Farmington' in service['description'] and [l['id'] for l in service['layers']] == [19]
    assert all(county not in service['description'] for county in ['Androscoggin', 'Cumberland'])

    def feature(st, original, district, label, county, meta):
        geometry = original['geometry']
        polygon = shape(geometry)
        assert polygon.is_valid and not polygon.is_empty and polygon.area > 0, district
        point = polygon.representative_point()
        assert polygon.contains(point)
        boundaries[st].append({'type': 'Feature', 'properties': {'ocdId': district, 'label': label,
            'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'], 'collectedAt': meta['retrievedAt'],
            'splitCountyOcdId': county}, 'geometry': geometry})
        flags.append({'state': st.upper(), 'districtOcdId': district, 'splitCounty': county,
                      'wholeCountyMembershipAdded': False, 'exactAddressGeometry': True,
                      'point': {'lat': point.y, 'lng': point.x}})

    raw, meta = read('me-commission-polygons')
    collection = json.loads(raw)
    assert len(collection['features']) == 3
    for original in collection['features']:
        props = original['properties']
        county, number = props['county'].lower(), props['district']
        assert (county, number) in [('androscoggin', 2), ('androscoggin', 5), ('cumberland', 5)]
        assert props['district_n'] == props['county'] + '-' + str(number)
        district = f'ocd-division/country:us/state:me/county:{county}/council_district:{number}'
        assert any(c['ocdId'] == district for c in ballots['me']['contests'])
        feature('me', original, district, props['county'] + f' County Commissioner District {number}',
                f'ocd-division/country:us/state:me/county:{county}', meta)
    for stem in ['me-commission-polygons', 'me-commission-meta', 'me-commission-service', 'me-commission-item', 'me-arcgis-org', 'me-2024-service']:
        receipt('me', stem, 'Maine Legislature / Secretary of State / Office of GIS', 'Original State of Maine GIS response, SHA256 checked before use. Authoritative2021 commission polygons supply exact unchanged Androscoggin2/5 and Cumberland5 boundaries. The2024 update applies only to Farmington in Franklin County and is not substituted for these unrelated counties. Original polygon coordinate arrays are copied without simplification or buffering into data/states/me/geo/bl02-final-districts-23.geojson.')

    raw, _ = read('oh-government-link')
    assert b'County_Council_Districts_2021_effective_2022-2032/FeatureServer/0' in raw
    raw, meta = read('oh-council-polygons')
    collection = json.loads(raw)
    assert len(collection['features']) == 11 and {f['properties']['CCD21'] for f in collection['features']} == set(range(1, 12))
    original = next(f for f in collection['features'] if f['properties']['CCD21'] == 7)
    assert original['properties']['Council_Dist_text'] == '7'
    district = 'ocd-division/country:us/state:oh/county:cuyahoga/council_district:7'
    assert any(c['ocdId'] == district for c in ballots['oh']['contests'])
    feature('oh', original, district, 'Cuyahoga County Council District 7', 'ocd-division/country:us/state:oh/county:cuyahoga', meta)
    for stem in ['oh-government-link', 'oh-council-meta', 'oh-council-polygons']:
        receipt('oh', stem, 'Cuyahoga County GIS', 'County government GIS directory explicitly links the2022–2032 adopted council district layer. All11 district records are held; the exact district7 polygon is copied unchanged into data/states/oh/geo/bl02-final-districts-39.geojson. District7 splits Cleveland; no Cleveland or Cuyahoga whole-place membership is created.')

    outputs = []
    for st, fips in [('me', '23'), ('oh', '39')]:
        relative = f'data/states/{st}/geo/bl02-final-districts-{fips}.geojson'
        path = ROOT / relative
        content = json.dumps({'type': 'FeatureCollection', 'features': boundaries[st]}, separators=(',', ':')) + '\n'
        outputs.append({'path': relative, 'features': len(boundaries[st]), 'sha256': hashlib.sha256(content.encode()).hexdigest()})
        if write and (not path.exists() or path.read_text() != content):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        for field in ['contests', 'candidacies', 'measures', 'absences']:
            assert ballots[st][field] == prior[st][field], (st, field)
        if write and changed[st]:
            documents[st]['sourceReceipt']['reviewedAt'] = NOW
            documents[st]['sourceReceipt']['reviewedBy'] = 'BL-02 final Maine/Ohio district-source replay'
            (ROOT / f'data/ballot/2026-general/{st}.json').write_text(json.dumps(documents[st], ensure_ascii=False, indent=2) + '\n')
    report = {'checkedAt': NOW, 'membershipsAdded': len(memberships), 'registryMunicipalities': {k: len(v) for k, v in lists.items()},
              'geometryFiles': outputs, 'splitDistricts': flags,
              'verification': 'All source hashes match saved original bytes; exact government keys match held contest IDs; original geometry coordinates copied unchanged; each geometry is valid and has a strict interior point; existing contest/candidate/measure/absence records preserved.',
              'sourceRouteNotes': ['The main Maine.gov directory returned403 and www2 revenue returned401; the public www11 revenue mirror succeeded and directly links the county publisher. County community PDF lists succeeded directly.',
                                   'The2024 Maine update uses layer19 and changes only Farmington. Target Androscoggin and Cumberland districts use the separate authoritative2021 service; no Franklin geography is changed.',
                                   'Only Cuyahoga7 is projected here. Other current Cuyahoga source polygons have self-intersections and are not silently repaired or substituted. Their verified whole-municipality memberships remain available.'],
              'upstream': 'Held certified state ballots and official county/state district sources',
              'downstream': 'Ordinary state ballot publisher and existing state-geometry point resolver → ballot page',
              'release': 'Data only; no runtime code, manifest edits, production writes or release.'}
    if write and any(changed.values()):
        (ROOT / 'data/ballot/reports/bl02-me-oh-final-gaps.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'membershipsAdded': len(memberships), 'geometryFiles': outputs, 'changedStates': [st for st in changed if changed[st]]}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    main(parser.parse_args().write)
