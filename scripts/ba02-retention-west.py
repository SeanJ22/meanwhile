#!/usr/bin/env python3
"""Fill retention questions from saved official forms, without changing candidates.

Statutory forms expressly contain slots for each certified judge and court. The
Colorado questions are also matched verbatim to the held 2026 Denver specimen.
Run with --check to verify the input files without writing them.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/ba02-retention-west'
EXPECTED = {'ak': 1, 'az': 13, 'co': 7, 'id': 33, 'mt': 10, 'wy': 3}


def clean(text):
    return ' '.join(text.split())


def source(stem):
    meta = json.loads((EVIDENCE / (stem + '.source.json')).read_text())
    raw = (EVIDENCE / meta['file']).read_bytes()
    if meta.get('compression') == 'gzip':
        raw = gzip.decompress(raw)
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'], stem
    text = (EVIDENCE / meta['textSnapshot']).read_bytes()
    assert hashlib.sha256(text).hexdigest() == meta['textHash'], stem
    assert meta['httpStatus'] == 200
    return clean(text.decode()), meta


def provenance(meta, publisher, quote):
    return {'sourceUrl': meta['sourceUrl'], 'sourceOrg': publisher,
            'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt'], 'quote': quote}


def receipt(package, meta, publisher, evidence):
    row = {'requestedUrl': meta['sourceUrl'], 'finalUrl': meta.get('finalUrl', meta['sourceUrl']),
           'rawHash': meta['rawHash'], 'retrievedAt': meta['retrievedAt'],
           'httpStatus': meta['httpStatus'], 'publisher': publisher,
           'sourceClass': 'OFFICIAL_PUBLISHER', 'reviewedEvidence': evidence, 'reviewOutcome': 'SUPPORTED'}
    package['sourceReceipt']['sources'] = [x for x in package['sourceReceipt']['sources']
                                          if x['requestedUrl'] != row['requestedUrl']] + [row]


def name_for(ballot, contest):
    candidates = [row for row in ballot['candidacies'] if row['contestId'] == contest['id']]
    assert len(candidates) == 1, contest['id']
    candidate = candidates[0]
    name = clean(candidate['givenName'] + ' ' + candidate['familyName'])
    # A few official lists store LAST, FIRST as a single filed-name field.
    if not candidate['givenName'] and ',' in name:
        family, given = name.split(',', 1)
        name = clean(given + ' ' + family)
    return name


def fill(check=False):
    ak_text, ak_meta = source('ak-judicial-law')
    ak_form = 'Shall ... be retained as justice of the supreme court for 10 years?'
    assert ak_form in ak_text
    az_text, az_meta = source('az-law')
    az_form = 'Shall __________, (Name of justice or judge) of the _________ court be retained in office?'
    assert az_form in az_text
    co_text, co_meta = source('co-constitution')
    co_form = 'Shall Justice (Judge) .... of the Supreme (or other) Court be retained in office?'
    assert co_form in co_text
    co_links, co_link_meta = source('co-downloads')
    assert co_meta['sourceUrl'] in (EVIDENCE / co_link_meta['file']).read_text()
    denver = clean((ROOT / 'data/ballot/ba01-west-evidence/denver-sample-ballot.txt').read_text())
    id_text, id_meta = source('id-law')
    id_form = 'Shall Magistrate…. (Here insert the name of the magistrate) of…. (Here insert the name of the county) County of the…. (Here insert the judicial district number) Judicial District be retained in office?'
    assert id_form in id_text
    district_text, district_meta = source('id-districts')
    districts = {}
    for number, ordinal in enumerate(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'], 1):
        match = re.search(r'The ' + ordinal + r' judicial district shall consist of the counties of (.*?)\.', district_text)
        assert match, ordinal
        counties = match[1].replace('Clear- water', 'Clearwater').replace(', and ', ', ').replace(' and ', ', ')
        for county in counties.split(', '):
            districts[clean(county).lower().replace(' ', '_')] = number
    mt_text, mt_meta = source('mt-ballot-guide')
    mt_form = 'Shall Judge HG WELLS of DISTRICT 1, DEPT 1 of the state of Montana be retained in office for another term?'
    assert mt_form in mt_text
    wy_text, wy_meta = source('wy-law')
    assert 'Shall Justice John Roe be retained in office?' in wy_text
    assert 'Shall Judge Jane Roe be retained in office?' in wy_text
    count = {}
    for state, expected in EXPECTED.items():
        file = ROOT / ('data/ballot/2026-general/' + state + '.json')
        package = json.loads(file.read_text())
        questions = []
        for ballot in package['ballots'].values():
            for contest in ballot['contests']:
                if contest['type'] != 'RETENTION':
                    continue
                name = name_for(ballot, contest)
                if state == 'ak':
                    text = ak_form.replace('...', name)
                    meta, publisher, form = ak_meta, 'Alaska Judicial Council — AS 15.15.030(10)', ak_form
                elif state == 'az':
                    court = contest['title'].split(' — ')[0]
                    text = az_form.replace('__________, (Name of justice or judge)', name).replace('_________ court', court)
                    meta, publisher, form = az_meta, 'Arizona Legislature — Constitution Article VI, Section 38(B)', az_form
                elif state == 'co':
                    court = contest['title'].split(' — ')[0]
                    title = 'Justice' if court == 'Colorado Supreme Court' else 'Judge'
                    text = f'Shall {title} {name} of the {court} be retained in office?'
                    assert text in denver, text
                    meta, publisher, form = co_meta, 'Colorado General Assembly — Constitution Article VI, Section 25', co_form
                elif state == 'id':
                    county_id = contest['ocdId'].split('/county:')[1]
                    county = county_id.replace('_', ' ').title()
                    number = districts[county_id]
                    text = f'Shall Magistrate {name} of {county} County of the {number} Judicial District be retained in office?'
                    meta, publisher, form = id_meta, 'Idaho Legislature — Idaho Code 1-2220', id_form
                elif state == 'mt':
                    district, department = re.search(r'DISTRICT (\d+), DEPT (\d+)', contest['title']).groups()
                    text = mt_form.replace('HG WELLS', name).replace('DISTRICT 1, DEPT 1', f'DISTRICT {district}, DEPT {department}')
                    meta, publisher, form = mt_meta, 'Montana Secretary of State — Montana Ballot Layout Guide', mt_form
                else:
                    title = 'Justice' if 'SUPREME COURT' in contest['title'] else 'Judge'
                    form = 'Shall Justice John Roe be retained in office?' if title == 'Justice' else 'Shall Judge Jane Roe be retained in office?'
                    text = f'Shall {title} {name} be retained in office?'
                    meta, publisher = wy_meta, 'Wyoming Legislature — W.S. 22-6-126'
                value = {'questionText': text, 'provenance': provenance(meta, publisher,
                    form + '\nStatutory/sample form completed with the certified judge and court: ' + text)}
                if check:
                    assert contest.get('retentionQuestion') == value, contest['id']
                    assert contest['voteFor'] == 1, contest['id']
                else:
                    contest['retentionQuestion'] = value
                    contest['voteFor'] = 1
                questions.append({'contestId': contest['id'], 'questionText': text, 'sourceUrl': meta['sourceUrl']})
        assert len(questions) == expected, (state, len(questions), expected)
        count[state.upper()] = len(questions)
        if not check:
            if state == 'co':
                package['sourceReceipt']['sources'] = [row for row in package['sourceReceipt']['sources']
                    if row['requestedUrl'] != 'https://olls.info/crs/crs2026-title-00.pdf']
            receipt(package, meta, publisher, f'BA-02: all {expected} retained judge/court identities inserted into the saved official retention question form; each question is a single Yes/No decision.')
            if state == 'id':
                receipt(package, district_meta, 'Idaho Legislature', 'Idaho Code 1-802 through 1-808 assigns every magistrate county to its judicial district; these explicit county lists supply the district slot required by 1-2220.')
            if state == 'co':
                receipt(package, co_link_meta, 'Colorado General Assembly', 'Official current 2026 revised-statutes download page links directly to olls.info/crs/crs2026-title-00.htm. Article VI Section25 supplies the form; each of the seven completed questions also occurs verbatim in the held 2026 Denver sample.')
            package['sourceReceipt']['reviewedAt'] = max(row['retrievedAt'] for row in package['sourceReceipt']['sources'])
            package['sourceReceipt']['reviewedBy'] = 'BA-02 official retention question replay'
            file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
            (EVIDENCE / (state + '-questions.json')).write_text(json.dumps(questions, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'officialQuestions': count, 'total': sum(count.values()), 'mode': 'check' if check else 'fill'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    fill(parser.parse_args().check)
