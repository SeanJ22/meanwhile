"""Replay Delaware's eleven remaining county district races with exact boundaries."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import pandas

ROOT = pathlib.Path(__file__).resolve().parents[1]


def capture(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
    return raw, meta


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/de.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    candidate_raw, meta = capture(folder, 'de-3')
    write_raw, write_meta = capture(folder, 'de-4')
    registry, _ = capture(folder, 'ocd-de-county')
    canonical = {line.split(',')[0] for line in registry.decode().splitlines()}
    pattern = r'^(New Castle County Council|Kent County Levy Court|Sussex County Council) District (\d+)$'
    rows = [r for r in pandas.read_html(io.StringIO(candidate_raw.decode()))[0].to_dict('records') if re.fullmatch(pattern, r['Office']) and r['Status'] == 'Qualified']
    offices = {row['Office'] for row in rows}
    assert len(rows) == 16 and len(offices) == 11
    write_rows = [row for table in pandas.read_html(io.StringIO(write_raw.decode())) for row in table.to_dict('records') if re.fullmatch(pattern, row['Office']) and row['Status'] == 'Qualified']
    assert not write_rows, 'Every district would require equal inclusion of qualified write-ins.'
    geography, sources = {}, []
    for county, key, field, expected in [('New Castle', 'de-newcastle-council-geography', 'DISTRICT_', 12), ('Kent', 'de-kent-council-geography', 'DISTRICT', 6), ('Sussex', 'de-sussex-council-geography', 'DISTRICTID', 5)]:
        raw, source_meta = capture(folder, key)
        features = json.loads(raw)['features']
        assert len(features) == expected
        assert all(row['geometry']['type'] in ('Polygon', 'MultiPolygon') for row in features)
        districts = {int(row['properties'][field]) for row in features}
        assert districts == set(range(1, expected + 1))
        geography[county] = districts
        sources.append((source_meta, county + ' County Government'))
    index, index_meta = capture(folder, 'de-newcastle-council')
    app, app_meta = capture(folder, 'de-newcastle-app')
    webmap, webmap_meta = capture(folder, 'de-newcastle-webmap')
    assert b'0bc1d3c56c854e369dbe84f60eb74814' in index
    assert json.loads(app)['values']['webmap'] in webmap_meta['url']
    service_url = next(row['url'] for row in json.loads(webmap)['operationalLayers'] if row['id'] == 'County_Council_5323')
    assert json.loads((folder / 'de-newcastle-council-geography.meta.json').read_text())['url'].startswith(service_url + '/0/query?')
    sources += [(index_meta, 'New Castle County Government'), (app_meta, 'New Castle County Government'), (webmap_meta, 'New Castle County Government')]
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies']}
    existing = {(row['ocdId'], row['title']) for row in ballot['contests']}
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Delaware Department of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    groups = {}
    for office in sorted(offices):
        candidates = [row for row in rows if row['Office'] == office]
        counties = {row['County'] for row in candidates}
        assert len(counties) == 1
        county = next(iter(counties))
        district = int(re.fullmatch(pattern, office)[2])
        assert district in geography[county]
        division = 'ocd-division/country:us/state:de/county:' + county.lower().replace(' ', '_') + '/council_district:' + str(district)
        assert division in canonical
        groups[office] = {'ocdId': division, 'qualifiedCandidates': len(candidates)}
        if (division, office) in existing:
            continue
        ident = 'de-county-districts-2026-' + hashlib.sha256(division.encode()).hexdigest()[:20]
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT', 'title': office, 'type': 'CANDIDACY', 'voteFor': None, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': office}})
        for row in candidates:
            name = row['Candidate']
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(json.dumps([name, row['Party']]).encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': row['Party'] or None, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': ' | '.join([office, name, row['Party'], row['Status']])}})
    added = {key: len(ballot[key]) - count for key, count in old.items()}
    if any(added.values()):
        for source_meta, publisher, source_class, reviewed in [(meta, 'Delaware Department of Elections', 'ELECTION_AUTHORITY', 'All eleven qualified county council or levy-court district races and sixteen candidates replayed from the official general-election list; withdrawn rows excluded. Equal fields for every candidate. Vote limit not stated in this list and remains null.'), (write_meta, 'Delaware Department of Elections', 'ELECTION_AUTHORITY', 'Complete official qualified write-in list checked for all eleven county district offices; none listed.')] + [(m, publisher, 'OFFICIAL_PUBLISHER', 'Official current county council or levy-court district polygons and the linked New Castle public lookup establish exact district identities. Canonical OCD IDs separately checked. No district is widened to the county.') for m, publisher in sources]:
            receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max([package['sourceReceipt']['reviewedAt'], meta['retrievedAt'], write_meta['retrievedAt']] + [m['retrievedAt'] for m, _ in sources])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 all Delaware county electoral district roster replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'DE', 'added': added, 'officialCountyDistrictContests': 11, 'officialQualifiedCountyDistrictCandidates': 16, 'countyDistrictQualifiedWriteIns': 0, 'districts': groups}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
