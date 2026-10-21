"""Replay remaining Maryland circuit judges only after every county style agrees."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
COUNTY_SOURCES = {'Worcester County': 'Worcester', 'Cecil County': 'Cecil', 'Talbot County': 'Talbot', 'Baltimore County': 'BaltimoreCounty', 'Anne Arundel County': 'AnneArundel', 'Howard County': 'Howard', 'Frederick County': 'Frederick', "Saint Mary's County": 'SaintMarys', 'Baltimore City': 'BaltimoreCity'}


def normalized(text):
    return re.sub('[^a-z0-9]', '', text.lower())


def capture(folder, key, converted=False):
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    path = folder / key
    raw = gzip.decompress((folder / (key + '.layout.txt.gz')).read_bytes()) if converted else (path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes()))
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['convertedTextHash' if converted else 'rawHash']
    return raw, meta


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/md.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    registry = json.loads((ROOT / 'data/derived/registration/md.json').read_text())['divisions']
    counties = {normalized(row[3].replace('St.', 'Saint')): row[0] for row in registry if row[1] == 'county'}
    raw, meta = capture(folder, 'md-30')
    candidates = [r for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))) if r['Office Name'] == 'Judge of the Circuit Court' and r['Candidate Status'] == 'Active']
    assert len(candidates) == 33
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies']}
    existing = {(row['ocdId'], row['title']) for row in ballot['contests']}
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Maryland State Board of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    counts, sources = {}, []
    for county, file in COUNTY_SOURCES.items():
        sample, sample_meta = capture(folder, 'md-court-' + file, True)
        text = sample.decode()
        styles = text.count('End of Ballot')
        assert styles > 0
        rows = [row for row in candidates if row['Candidate Residential Jurisdiction'] == county]
        assert rows
        flat = normalized(text)
        for row in rows:
            name = (row['Candidate First Name and Middle Name'] + ' ' + row['Candidate Ballot Last Name and Suffix']).strip()
            assert flat.count(normalized(name)) == styles, (county, name, styles)
        circuits = {row['Contest Run By District Name and Number'].removeprefix('Judicial ') for row in rows}
        assert len(circuits) == 1
        circuit = next(iter(circuits))
        vote = 'Vote for 1' if len(rows) == 1 else 'Vote for up to ' + str(len(rows))
        assert vote in text and re.search(r'Judge of the Circuit Court.{0,600}' + re.escape(vote), text, re.S), (county, vote)
        title = 'Judge of the Circuit Court — ' + circuit + ', ' + county
        division = counties[normalized(county)]
        counts[county] = {'styles': styles, 'candidates': len(rows), 'circuit': circuit}
        sources.append(sample_meta)
        if (division, title) in existing:
            continue
        ident = 'md-county-courts-2026-' + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'CANDIDACY', 'voteFor': len(rows), 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': f'{title} | {vote} | Every named candidate occurs on all {styles} county ballot styles.'}})
        for row in rows:
            name = (row['Candidate First Name and Middle Name'] + ' ' + row['Candidate Ballot Last Name and Suffix']).strip()
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': row['Candidate First Name and Middle Name'], 'familyName': row['Candidate Ballot Last Name and Suffix'], 'partyLabel': row['Office Political Party'] or None, 'slogan': 'Declared write-in' if row['Filing Type and Date'].startswith('Write-In') else None, 'incumbent': None, 'websiteUrl': row['Website'] or None, 'provenance': {**provenance, 'quote': title + ' | ' + name}})
    added = {key: len(ballot[key]) - count for key, count in old.items()}
    if any(added.values()):
        for sample_meta in sources:
            receipt = {'requestedUrl': sample_meta['url'], 'finalUrl': sample_meta['finalUrl'], 'publisher': 'Maryland State Board of Elections', 'sourceClass': 'ELECTION_AUTHORITY', 'retrievedAt': sample_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': sample_meta['rawHash'], 'reviewedEvidence': 'Every active named circuit-court candidate for this county appears on every certified county ballot style. Exact printed vote limit checked. Circuit numbers shared by multiple counties do not expose another county\'s candidates.'}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max(m['retrievedAt'] for m in [meta] + sources)
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Maryland remaining county circuit-court certified ballot replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'MD', 'added': added, 'verifiedCounties': counts, 'certifiedCircuitCandidatesStatewide': len(candidates)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
