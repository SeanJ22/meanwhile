"""Replay Georgia's certified DA circuits with statutory whole-county scope."""
import argparse
import gzip
import hashlib
import html
import io
import json
import pathlib
import re
import subprocess
import zipfile

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[1]


def captured(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    return raw, meta


def normalized(value):
    return re.sub('[^a-z0-9]', '', value.lower())


def slug(value):
    return re.sub('[^a-z0-9]+', '-', value.lower()).strip('-')


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/ga.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    raw, meta = captured(folder, 'ga-1')
    archive = zipfile.ZipFile(io.BytesIO(raw))
    workbook = openpyxl.load_workbook(io.BytesIO(archive.read('November 2026 Federal and State Candidates.xlsx')), data_only=True)
    groups = {}
    for row in workbook.active.values:
        office = str(row[0] or '').strip()
        if office.startswith('District Attorney, ') and office.endswith(' Judicial Circuit'):
            circuit = office.removeprefix('District Attorney, ').removesuffix(' Judicial Circuit')
            groups.setdefault(circuit, []).append((str(row[1]).strip(), str(row[3]).strip(), str(row[2]).strip() == 'Yes'))
    assert len(groups) == 10 and sum(len(rows) for rows in groups.values()) == 11
    writeins, writeins_meta = captured(folder, 'ga-writeins')
    writeins_text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=writeins).decode()
    assert 'DISTRICT ATTORNEY' not in writeins_text.upper()
    statute, statute_meta = captured(folder, 'ga-circuit-statute')
    statute_text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=statute).decode()
    statute_text = re.sub(r'(?<=\w)-\s*\n\s*(?=\w)', '', statute_text)
    statute_text = ' '.join(statute_text.split())
    authority, authority_meta = captured(folder, 'ga-prosecutor-authority')
    assert b'pacga.org' in authority
    registry = json.loads((ROOT / 'data/derived/registration/ga.json').read_text())['divisions']
    counties = {normalized(row[3].removesuffix(' County')): row[0] for row in registry if row[1] == 'county'}
    existing = {(row['ocdId'], row['title']) for row in ballot['contests']}
    memberships = ballot.setdefault('districtMemberships', [])
    existing_memberships = {(row['memberOcdId'], row['districtOcdId']) for row in memberships}
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies']}
    old_memberships = len(memberships)
    sources, circuit_report, differences = [], {}, []
    current_incumbents = {'Atlantic': 'Richard Eugene Braun, Jr.', 'Columbia': 'Natalie Paine', 'Cordele': 'Lyndsey Walters'}
    for circuit, candidates in sorted(groups.items()):
        match = re.search(re.escape(circuit) + r' Judicial Circuit, composed of (?:the )?(?:Counties|County) of (.*?)[;\.]', statute_text)
        assert match, circuit
        names = re.split(r',\s*(?:and\s+)?|\s+and\s+', match[1])
        members = [counties[normalized(name)] for name in names]
        assert len(members) == len(set(members))
        if circuit == 'West Georgia':
            assert set(names) == {'Carroll', 'Heard'}
        division = 'ocd-division/country:us/state:ga/judicial_circuit:' + slug(circuit)
        directory, directory_meta = captured(folder, 'ga-prosecutor-' + slug(circuit))
        directory_text = ' '.join(html.unescape(re.sub('<[^>]+>', ' ', directory.decode())).split())
        sources.append(directory_meta)
        title = 'District Attorney, ' + circuit + ' Judicial Circuit'
        for member in members:
            if (member, division) in existing_memberships:
                continue
            memberships.append({'id': 'ga-circuit-membership-2026-' + hashlib.sha256(json.dumps([member, division]).encode()).hexdigest()[:20], 'memberOcdId': member, 'districtOcdId': division, 'provenance': {'sourceUrl': statute_meta['finalUrl'], 'sourceOrg': 'Georgia General Assembly', 'collectedAt': statute_meta['retrievedAt'], 'verifiedAt': statute_meta['retrievedAt'], 'quote': match[0]}})
        circuit_report[circuit] = {'counties': names, 'certifiedCandidates': len(candidates)}
        if (division, title) in existing:
            continue
        ident = 'ga-district-attorney-2026-' + slug(circuit)
        provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Georgia Secretary of State', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'GA_CODE_15_6_1', 'title': title, 'type': 'CANDIDACY', 'voteFor': 1, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title}})
        for name, party, incumbent in candidates:
            candidate_provenance = {**provenance, 'quote': ' | '.join([title, name, party])}
            if current_incumbents.get(circuit) == name:
                role = re.search(r'<div class="section-title">(.*?)</div>\s*<div class="section-position">(.*?)</div>', directory.decode(), re.S)
                assert role and 'District Attorney' in role[2]
                name_on_directory = html.unescape(re.sub('<[^>]+>', '', role[1])).strip()
                assert name.split()[0].lower() == name_on_directory.split()[0].lower()
                assert ('Braun' in name_on_directory if circuit == 'Atlantic' else normalized(name_on_directory) == normalized(name))
                if not incumbent:
                    differences.append({'candidate': name, 'field': 'incumbent', 'certifiedWorkbookValue': False, 'currentAgencyDirectoryValue': True, 'source': directory_meta['finalUrl']})
                incumbent = True
                candidate_provenance = {'sourceUrl': directory_meta['finalUrl'], 'sourceOrg': "Prosecuting Attorneys' Council of Georgia; Georgia Secretary of State", 'collectedAt': directory_meta['retrievedAt'], 'verifiedAt': directory_meta['retrievedAt'], 'quote': f'{name_on_directory} | {role[2]} | Current office role establishes incumbency; ballot name and party from {meta["finalUrl"]}'}
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': {'R': 'Republican', 'D': 'Democratic'}[party], 'slogan': None, 'incumbent': incumbent, 'websiteUrl': None, 'provenance': candidate_provenance})
    added = {key: len(ballot[key]) - count for key, count in old.items()}
    if any(added.values()) or len(memberships) > old_memberships:
        for source_meta, publisher, source_class, reviewed in [(writeins_meta, 'Georgia Secretary of State', 'ELECTION_AUTHORITY', 'The complete certified named write-in list contains no district-attorney registration; no generic write-in choice was invented as a candidate.'), (meta, 'Georgia Secretary of State', 'ELECTION_AUTHORITY', 'All ten certified general-election district attorney circuits and all eleven names, printed party abbreviations and incumbent fields replayed equally. Both certified Atlantic candidates retain their printed Republican affiliation.'), (statute_meta, 'Georgia General Assembly', 'OFFICIAL_PUBLISHER', 'O.C.G.A.15-6-1 supplies each entire county in all ten circuit electorates. West Georgia is Carroll and Heard; no old Coweta footprint or partial county is inferred.'), (authority_meta, 'State of Georgia', 'OFFICIAL_PUBLISHER', 'Georgia.gov identifies the Prosecuting Attorneys Council as a state agency and links its official directory.')] + [(m, "Prosecuting Attorneys' Council of Georgia", 'OFFICIAL_PUBLISHER', 'The official circuit-specific directory was checked for each candidate contest. Current named district attorney roles update stale nonincumbent flags for Richard Braun, Natalie Paine, and Lyndsey Walters; losing source values are retained in the comparison notes.') for m in sources]:
            receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max(m['retrievedAt'] for m in [meta, statute_meta, authority_meta] + sources)
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Georgia certified circuit roster and statutory county membership replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'GA', 'added': added, 'addedDistrictMemberships': len(memberships) - old_memberships, 'circuits': circuit_report, 'incumbencySourceDifferences': differences}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
