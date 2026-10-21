"""Replay Fulton's certified soil/water candidates in the exact county district."""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def captured(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    return raw, meta


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/ga.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    scope, scope_meta = captured(folder, 'ga-soil-region1')
    section = re.search(r'Fulton County(?:&nbsp;|\s)+SWCD</a></h2><p>([^<]+)</p>', scope.decode())
    assert section and html.unescape(section[1]).strip() == 'Fulton County'
    raw, meta = captured(folder, 'ga-fulton-soil-candidates')
    text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode()
    assert 'NOVEMBER 3, 2026' in text
    candidates = [(name.strip(), incumbent == 'Yes') for name, incumbent in re.findall(r'(?m)^\s*([A-Za-z .]+?)\s{2,}Nonpartisan\s{2,}.*?\s{2,}(Yes|No)\s{2,}Fulton County', text)]
    assert candidates == [('Zane Placie', False), ('Walter S. Rekuc Jr.', True), ('Jason Ulseth', True)]
    sample, sample_meta = captured(folder, 'ga-fulton-sample')
    sample_text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=sample).decode()
    block = sample_text.split('For Fulton Soil & Water Conservation District Supervisor', 1)[1].split('Transportation Special Purpose', 1)[0]
    for name, incumbent in candidates:
        assert name + (' (Incumbent)' if incumbent else '') in block
    division = 'ocd-division/country:us/state:ga/county:fulton'
    title = 'Fulton Soil & Water Conservation District Supervisor'
    if any(row['ocdId'] == division and row['title'] == title for row in ballot['contests']):
        return {'state': 'GA', 'addedContests': 0, 'addedCandidacies': 0}
    ident = 'ga-fulton-2026-soil-water-supervisor'
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Fulton County Department of Registration and Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'CANDIDACY', 'voteFor': None, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title + ' | State commission lists Fulton County as the district county. Qualified roster and current sample agree on all three names.'}})
    for name, incumbent in candidates:
        ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': 'Nonpartisan', 'slogan': None, 'incumbent': incumbent, 'websiteUrl': None, 'provenance': {**provenance, 'quote': ' | '.join([title, name, 'Nonpartisan', 'Incumbent ' + ('Yes' if incumbent else 'No')])}})
    for source_meta, publisher, source_class, reviewed in [(meta, provenance['sourceOrg'], 'ELECTION_AUTHORITY', 'All three qualified November3 soil/water candidates replayed with identical fields, exact Nonpartisan designation and explicit incumbent flags. No vote limit is stated in the held consolidated source, so no voting instruction is invented.'), (sample_meta, provenance['sourceOrg'], 'ELECTION_AUTHORITY', 'The current consolidated general sample confirms the same three names and both incumbency markers.'), (scope_meta, 'Georgia Soil and Water Conservation Commission', 'OFFICIAL_PUBLISHER', 'RegionI district directory explicitly lists Fulton County SWCD with Fulton County as its complete county list. No larger regional jurisdiction is substituted.')]:
        receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
        if receipt not in package['sourceReceipt']['sources']:
            package['sourceReceipt']['sources'].append(receipt)
    package['sourceReceipt']['reviewedAt'] = max(m['retrievedAt'] for m in [meta, sample_meta, scope_meta])
    package['sourceReceipt']['reviewedBy'] = 'BA-01 Fulton county-wide soil/water qualified roster replay'
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'GA', 'addedContests': 1, 'addedCandidacies': 3, 'votingInstructions': 'Not stated by held consolidated ballot or qualified roster; remains open.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
