"""Derive exact whole-county appellate memberships from Florida Statutes 26/35."""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth']


def source(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    text = ' '.join(html.unescape(re.sub('<[^>]+>', ' ', raw.decode())).split())
    return text, meta


def normalized(text):
    return re.sub('[^a-z0-9]', '', text.lower())


def replay(folder, write=False):
    circuits_text, circuits_meta = source(folder, 'fl-circuit-statute')
    appeals_text, appeals_meta = source(folder, 'fl-appellate-statute')
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    registry = json.loads((ROOT / 'data/derived/registration/fl.json').read_text())['divisions']
    counties = {normalized(row[3].removesuffix(' County')): row[0] for row in registry if row[1] == 'county'}
    circuits, circuit_quotes = {}, {}
    for m in re.finditer(r'\((\d+)\) The ([a-z]+) circuit is composed of (.+?) Count(?:y|ies)\.', circuits_text):
        number = int(m[1])
        assert ORDINALS[number - 1] == m[2]
        names = re.split(r',\s*(?:and\s+)?|\s+and\s+', m[3])
        members = [counties[normalized(name)] for name in names]
        assert len(members) == len(set(members))
        circuits[number], circuit_quotes[number] = members, m[0]
    assert len(circuits) == 20
    all_members = [county for members in circuits.values() for county in members]
    assert len(all_members) == len(set(all_members)) == len(counties) == 67
    appellate = {}
    for m in re.finditer(r'The ([A-Z][a-z]+) Appellate District is composed of the (.+?) Judicial Circuits\.', appeals_text):
        district = ORDINALS.index(m[1].lower()) + 1
        members = [ORDINALS.index(word.lower()) + 1 for word in re.findall(r'\b(?:' + '|'.join(ORDINALS) + r')\b', m[2], re.I)]
        assert members and district <= 6
        appellate[district] = (members, m[0])
    assert len(appellate) == 6 and sorted(c for members, _ in appellate.values() for c in members) == list(range(1, 21))
    existing = {(row['memberOcdId'], row['districtOcdId']) for row in ballot.get('districtMemberships', [])}
    held = ballot.setdefault('districtMemberships', [])
    before = len(held)
    counts = {}
    for district, (members, appellate_quote) in sorted(appellate.items()):
        district_id = f'ocd-division/country:us/state:fl/district_court:{district}'
        counts[str(district)] = sum(len(circuits[circuit]) for circuit in members)
        for circuit in members:
            for county in circuits[circuit]:
                if (county, district_id) in existing:
                    continue
                ident = 'fl-appellate-county-2026-' + hashlib.sha256(json.dumps([county, district_id]).encode()).hexdigest()[:20]
                held.append({'id': ident, 'memberOcdId': county, 'districtOcdId': district_id, 'provenance': {'sourceUrl': appeals_meta['finalUrl'], 'sourceOrg': 'Florida Legislature', 'collectedAt': appeals_meta['retrievedAt'], 'verifiedAt': max(circuits_meta['retrievedAt'], appeals_meta['retrievedAt']), 'quote': circuit_quotes[circuit] + ' | ' + appellate_quote + ' | Circuit county list: ' + circuits_meta['finalUrl']}})
    if len(held) > before:
        for meta, reviewed in [(circuits_meta, 'All 20 circuit definitions parsed from Florida Statutes 26.021 and matched to all 67 unique existing county divisions. Each entire county belongs to exactly one circuit.'), (appeals_meta, 'All six appellate districts parsed from Florida Statutes 35.02–35.044, collectively covering all 20 circuits. Combined with section 26.021, this establishes 67 exact whole-county appellate memberships. No partial county is inferred.')]:
            receipt = {'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'], 'publisher': 'Florida Legislature', 'sourceClass': 'OFFICIAL_PUBLISHER', 'retrievedAt': meta['retrievedAt'], 'httpStatus': 200, 'rawHash': meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max(circuits_meta['retrievedAt'], appeals_meta['retrievedAt'])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Florida statutory whole-county appellate membership replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'FL', 'addedDistrictMemberships': len(held) - before, 'officialCounties': 67, 'countiesByAppellateDistrict': counts, 'heldRegionalRetentionContests': sum('/district_court:' in c['ocdId'] for c in ballot['contests'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
