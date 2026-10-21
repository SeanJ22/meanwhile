"""Replay Miami Gardens' exact Residential Area Seat 4 general-election runoff."""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re
import subprocess

import runpy

capture_sha256 = runpy.run_path(str(pathlib.Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = pathlib.Path(__file__).resolve().parents[1]


def capture(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200 and capture_sha256(raw) == meta['rawHash']
    return raw, meta


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    raw, meta = capture(folder, 'fl-miami-master')
    text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode()
    section = text.split('Miami Gardens - Residential Area\nCouncil Member - Seat 4\n', 1)[1].split('North Miami - Mayor', 1)[0]
    assert '(Vote for 1 / Vote por 1 / Vote pou 1)' in section
    rows = re.findall(r'^(.+?)\s{2,}(\d{3})\s*$', section, re.M)
    assert [(name, number) for name, number in rows] == [('Mykita Cherry-Prime', '155'), ('Rod Mack', '156')]
    election_raw, election_meta = capture(folder, 'fl-gardens-election')
    election = ' '.join(html.unescape(re.sub('<[^>]+>', ' ', election_raw.decode())).split())
    assert 'four Council Members are elected by Residential Area' in election
    assert 'a Run-Off will be held on Tuesday, November 3, 2026, for the purpose of electing a Council Member for Residential Area Seat 4 for a four-year term' in election
    assert 'Run-Off Election Candidates Residential Area Seat 4 Mykita Cherry-Prime Rod Mack' in election
    legal_raw, legal_meta = capture(folder, 'fl-gardens-qualifying')
    legal = ' '.join(subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=legal_raw).decode().split())
    assert 'Council member for Residential Area Seat 4, which encompasses: Beginning at the most northerly point of Seat 4' in legal
    assert 'NW 27th Ave.' in legal and 'NW 151st St.' in legal and 'NW 183rd St.' in legal
    division = 'ocd-division/country:us/state:fl/place:miami_gardens/council_district:4'
    canonical, _ = capture(folder, 'ocd-fl-county')
    assert division + ',Miami Gardens FL city council district 4' in canonical.decode()
    index, index_meta = capture(folder, 'fl-gardens-map-index')
    assert b'/DocumentCenter/View/7365/City-Council-Seat-4-PDF' in index
    title = 'Miami Gardens - Residential Area Council Member - Seat 4'
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies']}
    if not any(row['title'] == title and row['ocdId'] == division for row in ballot['contests']):
        ident = 'fl-miami-gardens-2026-residential-seat-4'
        provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Miami-Dade County Supervisor of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'CANDIDACY', 'voteFor': 1, 'termYears': 4, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title + ' | Vote for 1 | Official city election page confirms the November 3 runoff and four-year term; exact residential-area electorate, not all city voters.'}})
        for name, number in rows:
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': None, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': title + ' | ' + name + ' | ballot selection ' + number}})
        for source_meta, publisher, source_class, reviewed in [(meta, 'Miami-Dade County Supervisor of Elections', 'ELECTION_AUTHORITY', 'Both exact printed runoff candidate names and the vote-for-one instruction replayed.'), (election_meta, 'City of Miami Gardens', 'ELECTION_AUTHORITY', 'Current municipal election authority confirms November 3, 2026 runoff for Residential Area Seat 4, four-year term, both candidates, and that residential council seats are elected by their area.'), (legal_meta, 'City of Miami Gardens', 'ELECTION_AUTHORITY', 'Official 2026 election notice supplies the complete metes-and-bounds description of Residential Area Seat 4. Current exact canonical council_district:4 ID checked without widening to the city.'), (index_meta, 'City of Miami Gardens', 'OFFICIAL_PUBLISHER', 'Current official city district-map index independently identifies the Seat 4 map URL; current 2026 election notice supplies the full scope description.')]:
            receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max(package['sourceReceipt']['reviewedAt'], election_meta['retrievedAt'], legal_meta['retrievedAt'], index_meta['retrievedAt'])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 exact Miami Gardens residential-area runoff replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'FL', 'added': {key: len(ballot[key]) - count for key, count in old.items()}, 'ocdId': division, 'officialCandidates': 2, 'scope': 'Only Residential Area 4, not city-wide', 'voteFor': 1, 'termYears': 4}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
