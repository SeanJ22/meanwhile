"""Replay exact Hillsborough candidate blocks and full county questions."""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def capture(folder, key):
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    path = folder / (key + '.gz')
    if path.exists():
        raw = gzip.decompress(path.read_bytes())
        assert hashlib.sha256(raw).hexdigest() == meta['rawHash']
    else:
        raw = gzip.decompress((folder / (key + '.layout.txt.gz')).read_bytes())
        assert hashlib.sha256(raw).hexdigest() == meta['convertedTextHash']
    assert meta['httpStatus'] == 200
    return raw, meta


def clean_html(raw):
    return ' '.join(html.unescape(re.sub('<[^>]+>', ' ', raw.decode())).split())


def replay(folder, write=False):
    raw, meta = capture(folder, 'fl-hillsborough-all-races')
    text = subprocess.check_output(['pdftotext', '-raw', '-', '-'], input=raw).decode()
    assert 'November 3, 2026' in text and 'ALL RACES SAMPLE BALLOT' in text
    county = 'ocd-division/country:us/state:fl/county:hillsborough'
    city = 'ocd-division/country:us/state:fl/place:temple_terrace'
    commission_raw, commission_meta = capture(folder, 'fl-hillsborough-commission-scope')
    commission = clean_html(commission_raw)
    assert 'District 5, Countywide' in commission and 'District 7, Countywide' in commission
    school_raw, school_meta = capture(folder, 'fl-hillsborough-school-map')
    school = ' '.join(subprocess.check_output(['pdftotext', '-raw', '-', '-'], input=school_raw).decode().split())
    assert 'SCHOOL BOARD (2026)' in school
    assert 'SINGLE-MEMBER DISTRICTS COUNTYWIDE DISTRICT 2 & 4 6' in school
    assert 'SINGLE-MEMBER DISTRICTS' in school and '2 & 4' in school
    election_raw, election_meta = capture(folder, 'fl-temple-election')
    election = clean_html(election_raw)
    assert 'November 3, 2026' in election and 'FOR THREE (3) CITY COUNCIL Member Positions' in election
    city_report, city_meta = capture(folder, 'fl-temple-terrace-scope')
    assert 'Each Council Member serves a four-year term based on elections\n            held “at large” for the City of Temple Terrace.' in city_report.decode()
    canonical, _ = capture(folder, 'ocd-us')
    offices = [
        ('commission-1', 'Board of County Commissioners District 1', county + '/council_district:1', 1, ['Jackie Toledo REP', 'Harry Cohen DEM']),
        ('commission-3', 'Board of County Commissioners District 3', county + '/council_district:3', 1, ['Luiz F. F. Garcia REP', 'Gwen Myers DEM']),
        ('commission-5', 'Board of County Commissioners District 5', county, 1, ['Stacy Hahn REP', 'Neil Manimala DEM']),
        ('commission-7', 'Board of County Commissioners District 7', county, 1, ['Joshua Wostal REP', 'Aileen Rodriguez DEM']),
        ('school-2', 'School Board Member District 2', county + '/school_board_district:2', 1, ['Brittany Lyssy', 'Daniela Simic']),
        ('school-6', 'School Board Member District 6', county, 1, ['Kenneth "Ken" Gay', 'Karen Perez']),
        ('temple-council', 'Temple Terrace City Council', city, 3, ['Alison McGillivray Fernandez', 'Ryan Gessman', 'Karen Michalski', 'Eugene Papantoniou', 'Amber Treat']),
    ]
    for _, title, division, limit, candidates in offices:
        assert division + ',' in canonical.decode()
        section = text.split(title + '\n', 1)[1]
        instruction = '(Vote for no more than Three)' if limit == 3 else '(Vote for One)'
        assert section.startswith(instruction)
        assert '\n'.join(candidates) in section[:450]
        if division == city:
            assert all(name in election for name in candidates)
    questions = []
    for number, end_title in [(1, 'Disposición para'), (2, 'Enmienda de la Carta'), (3, 'Sobreimpuesto de Medio')]:
        section = text.split('No. ' + str(number) + ' Hillsborough County Referendum\n', 1)[1]
        english = section.split(end_title, 1)[0]
        title, question = english.split('\nShall ', 1)
        # The first line is the Spanish numbered heading. The remaining title
        # lines and complete English question are preserved verbatim.
        title = ' '.join(title.splitlines()[1:]).strip()
        question = 'Shall ' + ' '.join(question.split())
        assert question.endswith('?')
        questions.append((str(number), title, question))
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies', 'measures']}
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Hillsborough County Supervisor of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': max(meta['retrievedAt'], commission_meta['retrievedAt'], school_meta['retrievedAt'], election_meta['retrievedAt'])}
    for slug, title, division, limit, names in offices:
        ident = 'fl-hillsborough-2026-' + slug
        if any(row['id'] == ident for row in ballot['contests']):
            continue
        scope = 'Official county government identifies Commission Districts 5 and 7 as countywide; the 2026 election-authority school table identifies School District 6 as countywide and District 2 as single-member. Commission Districts 1/3 and School District 2 use their exact current canonical divisions. Temple Terrace uses the officially documented at-large city electorate.'
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'CANDIDACY', 'voteFor': limit, 'termYears': 4 if division == city or 'school-' in slug else None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title + ' | ' + ('Vote for no more than Three' if limit == 3 else 'Vote for One') + ' | ' + scope}})
        for printed in names:
            match = re.fullmatch(r'(.+) (REP|DEM)', printed)
            name, party = (match[1], match[2]) if match else (printed, None)
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': party, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': title + ' | ' + printed}})
    for number, title, question in questions:
        ident = 'fl-hillsborough-2026-referendum-' + number
        if any(row['id'] == ident for row in ballot['contests']):
            continue
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': county, 'divisionVintage': 'OCD_CURRENT', 'title': 'Hillsborough County Referendum ' + number + ' — ' + title, 'type': 'MEASURE', 'voteFor': 1, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': 'No. ' + number + ' Hillsborough County Referendum | ' + title}})
        ballot['measures'].append({'id': ident + '-measure', 'contestId': ident, 'officialNumber': number, 'questionText': question, 'officialStatement': None, 'provenance': {**provenance, 'quote': question}})
    sources = [
        (meta, 'Hillsborough County Supervisor of Elections', 'ELECTION_AUTHORITY', 'All seven imported candidate contests replayed with all 17 exact printed names and vote limits; full English text of all three countywide referendum questions. CDD races and the Country Run special-tax-district question are excluded pending exact scope proof.'),
        (commission_meta, 'Hillsborough County', 'OFFICIAL_PUBLISHER', 'Current official board directory explicitly labels Districts 5 and 7 countywide, while identifying the separate District 1 and District 3 offices. Current canonical partial districts 1/3 are preserved precisely.'),
        (school_meta, 'Hillsborough County Supervisor of Elections', 'ELECTION_AUTHORITY', 'Official 2026 School Board qualifying/electorate table explicitly labels District 6 countywide and Districts 2/4 single-member; four-year term is stated. This is county-specific and is not inferred for other Florida school boards.'),
        (election_meta, 'City of Temple Terrace', 'ELECTION_AUTHORITY', 'Current November 3 municipal election page lists the complete five qualified candidates for three council positions.'),
        (city_meta, 'City of Temple Terrace', 'OFFICIAL_PUBLISHER', 'Official annual city report explicitly establishes four-year at-large council elections. Current 2026 city election notice confirms the same undivided council contest and five qualified names; county sample provides vote-for-three instruction.'),
    ]
    for source_meta, publisher, source_class, reviewed in sources:
        receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
        if receipt not in package['sourceReceipt']['sources']:
            package['sourceReceipt']['sources'].append(receipt)
    package['sourceReceipt']['reviewedAt'] = max(package['sourceReceipt']['reviewedAt'], provenance['verifiedAt'])
    package['sourceReceipt']['reviewedBy'] = 'BA-01 Hillsborough exact numbered/at-large scopes and full county questions'
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'FL', 'added': {key: len(ballot[key]) - count for key, count in old.items()}, 'verifiedLocalCandidateContests': 7, 'verifiedLocalPrintedCandidacies': 17, 'verifiedCountywideQuestions': 3, 'deferredScopes': ['23 CDD seat contests', 'Country Run Special Tax District question']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
