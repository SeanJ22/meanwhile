#!/usr/bin/env python3
"""Authenticate the archived Bernalillo sample against saved official records.

No original government URL is inferred. The archive is second hand; its ballot
imprint, all 20 judicial questions, and all 20 certified identities are checked.
"""
from pathlib import Path
import gzip
import hashlib
import html
import json
import re
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/ba02-retention-ks-nm'
STEM = 'nm-bernalillo-third-party-sample'


def clean(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value)).split())


def check():
    meta = json.loads((EVIDENCE / (STEM + '.source.json')).read_text())
    raw = (EVIDENCE / meta['file']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash']
    archive = json.loads((EVIDENCE / 'nm-bernalillo-archive-index.source.json').read_text())
    archive_raw = gzip.decompress((EVIDENCE / archive['file']).read_bytes())
    assert hashlib.sha256(archive_raw).hexdigest() == archive['rawHash']
    assert meta['sourceUrl'] in archive_raw.decode()
    assert archive['officialPortalLink'] in archive_raw.decode()
    encoded = subprocess.run(['pdftotext', '-raw', '-', '-'], input=raw,
                             stdout=subprocess.PIPE, check=True).stdout.decode()
    text = ''.join(chr(ord(char) + 29) if ord(char) < 95 and char not in '\r\n\t '
                   else (' ' if char == '¬' else char) for char in encoded)
    text_path = EVIDENCE / (STEM + '.txt')
    assert text_path.read_text() == text
    flat = ' '.join(text.split())
    for imprint in ['SAMPLE BALLOT', 'November 3, 2026', 'Bernalillo County',
                    'Ballot Style 0101', 'BERN_PCT184']:
        assert imprint in flat, imprint
    questions = [' '.join(row.split()) for row in re.findall(r'Shall [^?]+\?', text)
                 if 'retained' in row]
    assert len(questions) == len(set(questions)) == 20
    registry = []
    registry_sources = []
    for stem in ['nm-sos-santa-fe', 'nm-sos-judicial', 'nm-sos-metro']:
        source = json.loads((EVIDENCE / (stem + '.source.json')).read_text())
        body = (EVIDENCE / (stem + '.html')).read_bytes()
        assert hashlib.sha256(body).hexdigest() == source['sha256']
        assert 'GENERAL 2026' in body.decode() and 'November 3, 2026' in body.decode()
        for heading in re.findall(r'<h1>(.*?)</h1>', body.decode(), re.S):
            match = re.match(r'JUDICIAL RETENTION:\s*(Shall (.+?) be retained .+?\?)(.*)', clean(heading))
            if match:
                registry.append({'questionText': match[1], 'name': match[2],
                                 'scope': match[3], 'sourceUrl': source['finalUrl']})
        registry_sources.append({'sourceUrl': source['finalUrl'], 'sha256': source['sha256']})
    held = runpy.run_path(str(ROOT / 'scripts/ba01-west-court-county.py'))
    roster_raw, roster_meta = held['state_capture']('nm')
    roster_text = clean(roster_raw.decode())
    assert '2026 General' in roster_text
    ballot = next(iter(json.loads((ROOT / 'data/ballot/2026-general/nm.json').read_text())['ballots'].values()))
    matched = []
    for question in questions:
        official = next(row for row in registry if row['questionText'] == question)
        assert official['name'] in roster_text, official['name']
        contests = [contest for contest in ballot['contests'] if contest['type'] == 'RETENTION' and
                    any(candidate['contestId'] == contest['id'] and
                        ' '.join((candidate['givenName'] + ' ' + candidate['familyName']).split()) == official['name']
                        for candidate in ballot['candidacies'])]
        assert len(contests) == 1, official['name']
        contest = contests[0]
        if 'District Court Judge' in contest['title']:
            assert 'SECOND JUDICIAL DISTRICT' in official['scope']
        if 'Metropolitan' in contest['title']:
            assert 'Judge of the Metropolitan Court' in question
        matched.append({'contestId': contest['id'], 'questionText': question,
                        'certifiedName': official['name'], 'officialRegistryUrl': official['sourceUrl']})
    report = {'status': 'ARCHIVED_OFFICIAL_SAMPLE_AUTHENTICATED', 'secondHand': True,
              'archiveUrl': meta['sourceUrl'], 'rawHash': meta['rawHash'],
              'originalGovernmentUrl': None,
              'archiveContext': archive,
              'publisher': 'Bernalillo County election sample; public archive at Republican Party of Bernalillo County',
              'imprint': 'SAMPLE BALLOT; November 3, 2026; Bernalillo County; Ballot Style 0101; BERN_PCT184',
              'visualInspection': 'All four saved PDF pages inspected. Questions and choices are unmarked. All 20 retention questions occupy pages 1 and 2. No added recommendations or annotations are visible.',
              'pdfMetadata': {'title': 'Dominion Voting Systems Ballot', 'producer': 'Acrobat Distiller 25.0 (Windows)',
                              'created': '2026-09-14T07:40:35-06:00', 'modified': '2026-09-15T23:19:57-06:00',
                              'originalUrlOrAuthorEmbedded': False},
              'authentication': 'Every question matches the current saved official 2026 state contest registry verbatim; every named judge also occurs in the saved official 2026 certified candidate list. The ballot imprint establishes jurisdiction, election date and style. The archive URL is preserved and no original government URL is claimed.',
              'candidateList': roster_meta, 'registrySources': registry_sources,
              'questionCount': len(matched), 'questions': matched}
    (EVIDENCE / 'nm-bernalillo-sample-authentication.json').write_text(json.dumps(report, indent=2) + '\n')
    meta.update(secondHand=True, sourceClass='REFERENCE_PUBLISHER',
                authoredBy='Bernalillo County election office sample, authenticated against New Mexico Secretary of State records',
                textSnapshot=text_path.name, textHash=hashlib.sha256(text_path.read_bytes()).hexdigest(),
                extraction='pdftotext -raw; embedded custom ASCII font recovered by codepoint+29; text visually checked on saved PDF pages',
                authentication='nm-bernalillo-sample-authentication.json')
    meta.pop('sourceLimit', None)
    (EVIDENCE / (STEM + '.source.json')).write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps({'questionCount': len(matched), 'status': report['status'], 'secondHand': True}))


if __name__ == '__main__':
    check()
