#!/usr/bin/env python3
"""Attach Kansas statutory and New Mexico sample/notice retention questions.

Kansas questions use legislated name/court placeholders. New Mexico questions
use saved samples and certified notices, paired with the official 2026 registry
and candidate records. Strict checking rejects any registry-only question.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/ba02-retention-ks-nm'


def clean(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value)).split())


def name_key(value):
    return re.sub(r'[^A-Z0-9]', '', value.upper())


def sample_questions(stem, publisher):
    """Verify the election office's saved sample/certified election notice."""
    meta = json.loads((EVIDENCE / (stem + '.source.json')).read_text())
    meta = {**meta, 'url': meta.get('url', meta.get('sourceUrl', meta.get('requestedUrl'))),
            'sha256': meta.get('sha256', meta.get('rawHash'))}
    path = EVIDENCE / meta.get('file', stem + '.pdf')
    raw = path.read_bytes()
    if path.suffix == '.gz':
        raw = gzip.decompress(raw)
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['sha256'], stem
    text_bytes = (EVIDENCE / meta.get('textFile', meta.get('textSnapshot', stem + '.txt'))).read_bytes()
    text_hash = meta.get('textSha256', meta.get('textHash'))
    if text_hash:
        assert hashlib.sha256(text_bytes).hexdigest() == text_hash, stem
    lines = text_bytes.decode().splitlines()
    text = ' '.join(text_bytes.decode().split())
    rows = []
    # A printed notice can omit punctuation. Its separate question lines retain
    # that exact text rather than borrowing a question mark from a later row.
    matches = [re.fullmatch(r'(Shall (.+?) be retained .+)', line.strip(), re.I)
               for line in lines] if stem == 'nm-mckinley-notice' else list(re.finditer(r'(Shall (.+?) be retained .+?\?)', text, re.I))
    for match in filter(None, matches):
        rows.append({'questionText': match[1], 'name': match[2], 'scope': '',
                     'heading': match[1], 'meta': meta, 'publisher': publisher})
    assert rows, stem
    return rows, meta


def document(stem, directory=EVIDENCE):
    path = directory / (stem + '.html')
    raw = path.read_bytes()
    meta = json.loads(path.with_suffix('.source.json').read_text())
    assert meta['httpStatus'] == 200
    assert hashlib.sha256(raw).hexdigest() == meta['sha256'], stem
    return raw.decode(), meta


def provenance(meta, publisher, quote):
    return {'sourceUrl': meta['finalUrl'], 'sourceOrg': publisher,
            'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt'],
            'quote': quote, **({'secondHand': True} if meta.get('secondHand') else {})}


def receipt(package, meta, publisher, evidence, source_class):
    row = {'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'],
           'retrievedAt': meta['retrievedAt'], 'httpStatus': meta['httpStatus'],
           'rawHash': meta['sha256'], 'publisher': publisher,
           'sourceClass': source_class, 'reviewOutcome': 'SUPPORTED',
           'reviewedEvidence': evidence}
    rows = package['sourceReceipt']['sources']
    rows[:] = [r for r in rows if r['finalUrl'] != row['finalUrl'] or r['rawHash'] != row['rawHash']]
    rows.append(row)
    package['sourceReceipt']['reviewedAt'] = max(package['sourceReceipt']['reviewedAt'], meta['retrievedAt'])


def candidates_for(ballot, contest):
    rows = [c for c in ballot['candidacies'] if c['contestId'] == contest['id']]
    assert len(rows) == 1, contest['id']
    row = rows[0]
    return row, ' '.join(filter(None, (row['givenName'], row['familyName'])))


def kansas(package):
    supreme, supreme_meta = document('ks-supreme')
    appeals, appeals_meta = document('ks-appeals')
    district, district_meta = document('retention-statute', ROOT / 'data/ballot/evidence/ba01-south/ks-judicial')
    roster, _ = document('ks-all-2026', ROOT / 'data/ballot/evidence/ba01-south')
    roster_text = clean(roster)
    assert '2026 General' in roster_text
    for raw in (supreme, district):
        text = clean(raw)
        assert re.search(r'Shall _+ \(Here insert name of (?:justice|judge)\.\)', text)
        assert '(Here insert the title of the court.)' in text
        assert 'be retained in office?' in text
    assert 'Shall (Here insert name of judge.) , Judge of the Court of Appeals, be retained in office?' in clean(appeals)
    updated = []
    for ballot in package['ballots'].values():
        for contest in ballot['contests']:
            if contest['type'] != 'RETENTION':
                continue
            candidate, name = candidates_for(ballot, contest)
            assert name in roster_text, name
            if contest['title'].startswith('Supreme Court Justice'):
                court = 'Justice of the Supreme Court'
                source, meta = supreme, supreme_meta
            elif contest['title'].startswith('Court of Appeals Judge'):
                court = 'Judge of the Court of Appeals'
                source, meta = appeals, appeals_meta
            else:
                assert contest['title'].startswith(('District Court Judge', 'District Magistrate Judge'))
                court = contest['title']
                source, meta = district, district_meta
            text = clean(source)
            start = text.index('Shall ')
            template = text[start:text.index('be retained in office?', start) + len('be retained in office?')]
            question = f'Shall {name}, {court}, be retained in office?'
            contest['retentionQuestion'] = {'questionText': question,
                'provenance': provenance(meta, 'Kansas Legislature', template)}
            contest['voteFor'] = 1
            updated.append({'contestId': contest['id'], 'questionText': question,
                'sourceUrl': meta['finalUrl'], 'candidateSourceUrl': candidate['provenance']['sourceUrl'],
                'template': template})
    assert len(updated) == 63
    for meta, label in ((supreme_meta, 'Kansas Constitution Article 3 Section 5'),
                        (appeals_meta, 'K.S.A. 20-3006'), (district_meta, 'K.S.A. 20-2908')):
        receipt(package, meta, 'Kansas Legislature',
                label + ': official retention question template; name and court placeholders populated only from the held official 2026 candidate list. Each retention is one affirmative/negative decision.',
                'OFFICIAL_PUBLISHER')
    return updated


def new_mexico(package, require_primary=False):
    law_meta = json.loads((EVIDENCE / 'nm-retention-statutes.source.json').read_text())
    law_raw = gzip.decompress((EVIDENCE / law_meta['file']).read_bytes())
    law_text = (EVIDENCE / law_meta['textFile']).read_bytes()
    assert hashlib.sha256(law_raw).hexdigest() == law_meta['sha256']
    assert hashlib.sha256(law_text).hexdigest() == law_meta['textSha256']
    statutes = ' '.join(law_text.decode().replace('\u00ad', '').split())
    for office in ('justice of the supreme court', 'judge of the court of appeals',
                   'district court judge', 'metropolitan court judge'):
        assert 'Each eligible ' + office + ' shall be subject to retention or rejection' in statutes
    index, _ = document('nm-handbook-index')
    assert law_meta['url'] in html.unescape(index)
    questions = []
    sources = []
    for stem in ['nm-sos-santa-fe', 'nm-sos-judicial', 'nm-sos-metro']:
        raw, meta = document(stem)
        assert 'GENERAL 2026' in raw and 'November 3, 2026' in raw
        headings = re.findall(r'<h1>(.*?)</h1>', raw, re.S)
        for heading in headings:
            match = re.fullmatch(r'JUDICIAL RETENTION:\s*(Shall (.+?) be retained .+?\?)(.*)', clean(heading))
            if match:
                questions.append({'questionText': match[1], 'name': match[2],
                                  'scope': match[3], 'heading': clean(heading), 'meta': meta})
        sources.append(meta)
    updated = []
    primary_questions = []
    primary_sources = []
    for stem, publisher in [
            ('nm-santa-fe-sample', 'Santa Fe County Clerk'),
            ('nm-dona-ana-sample', 'Doña Ana County Clerk'),
            ('nm-san-miguel-notice', 'San Miguel County Clerk'),
            ('nm-lea-sample', 'Lea County Clerk'),
            ('nm-grant-notice', 'Grant County Clerk'),
            ('nm-sierra-notice', 'Sierra County Clerk'),
            ('nm-colfax-sample', 'Colfax County Clerk'),
            ('nm-mckinley-notice', 'McKinley County Clerk, Bureau of Elections'),
            ('nm-otero-sample', 'Otero County Clerk'),
            ('nm-sandoval-notice', 'Sandoval County Clerk')]:
        primary, meta = sample_questions(stem, publisher)
        primary_questions.extend(primary)
        primary_sources.append((meta, publisher))
    primary, meta = sample_questions('nm-bernalillo-third-party-sample',
        'Bernalillo County election sample; public archive at Republican Party of Bernalillo County')
    authentication = json.loads((EVIDENCE / meta['authentication']).read_text())
    assert authentication['status'] == 'ARCHIVED_OFFICIAL_SAMPLE_AUTHENTICATED'
    assert authentication['rawHash'] == meta['sha256'] and authentication['questionCount'] == 20
    assert authentication['archiveUrl'] == meta['finalUrl'] and meta['secondHand'] is True
    primary_questions.extend(primary)
    primary_sources.append((meta, 'Bernalillo County election sample; public archive at Republican Party of Bernalillo County'))
    missing_primary = []
    for ballot in package['ballots'].values():
        for contest in ballot['contests']:
            if contest['type'] != 'RETENTION':
                continue
            candidate, name = candidates_for(ballot, contest)
            matches = [r for r in questions if r['name'] == name]
            assert matches, (contest['id'], name)
            assert len({r['questionText'] for r in matches}) == 1, name
            row = matches[0]
            if 'District Court Judge' in contest['title']:
                division = int(re.search(r'DIVISION (\d+)', contest['title'])[1])
                assert re.search(r'Division 0*' + str(division) + r'\?', row['questionText']), row
                district = re.search(r'([A-Z]+ JUDICIAL DISTRICT)', contest['title'])[1]
                assert district in row['scope'], (contest['title'], row['heading'])
            elif 'Metropolitan' in contest['title']:
                division = int(re.search(r'DIVISION (\d+)', contest['title'])[1])
                assert 'Judge of the Metropolitan Court' in row['questionText']
                assert re.search(r'Division ' + str(division) + r'\?', row['questionText'])
            else:
                assert ('Supreme Court' in contest['title']) == ('Justice of the Supreme Court' in row['questionText'])
                assert ('Court of Appeals' in contest['title']) == ('Judge of the Court of Appeals' in row['questionText'])
            primary = next((r for r in primary_questions if name_key(r['name']) == name_key(name)), None)
            if not primary:
                missing_primary.append(name)
                contest['retentionQuestion'] = {'questionText': row['questionText'],
                    'provenance': provenance(row['meta'], 'New Mexico Secretary of State', row['heading'])}
                contest['voteFor'] = 1
                updated.append({'contestId': contest['id'], 'questionText': row['questionText'],
                    'sourceUrl': row['meta']['finalUrl'], 'candidateSourceUrl': candidate['provenance']['sourceUrl'],
                    'sourceFormPending': 'Exact state registry question retained; obtain sample or certified election notice.'})
                continue
            prior_official = row['questionText']
            row = primary
            contest['retentionQuestion'] = {'questionText': row['questionText'],
                'provenance': provenance(row['meta'], row['publisher'], row['heading'])}
            contest['voteFor'] = 1
            updated.append({'contestId': contest['id'], 'questionText': row['questionText'],
                'sourceUrl': row['meta']['finalUrl'], 'candidateSourceUrl': candidate['provenance']['sourceUrl'],
                **({'replacedOfficialRegistryQuestion': prior_official} if prior_official != row['questionText'] else {})})
    if require_primary:
        assert not missing_primary, 'Official sample/certified notice still needed: ' + ', '.join(missing_primary)
    assert len(updated) == 43
    for meta in sources:
        receipt(package, meta, 'New Mexico Secretary of State',
                '2026 General Election official contest/question registry. Exact question text, named judge, district/division and Yes/No alternatives read from the state election office; paired with its certified 2026 candidate list. No result, recommendation or evaluation is imported.',
                'ELECTION_AUTHORITY')
    for meta, publisher in primary_sources:
        receipt(package, meta, publisher,
                'Official November 3, 2026 sample ballot or clerk-issued certified election notice. Exact named retention question copied from the saved document, with the certified candidate record checked separately. This primary ballot wording replaces differing prepared election-results headings.',
                meta.get('sourceClass', 'ELECTION_AUTHORITY'))
    receipt(package, law_meta, 'New Mexico Secretary of State',
            'Official 2025 Election Handbook, NMSA 1978 sections 1-26-2 through 1-26-6, verifies that the four held judicial office classes are nonpartisan retention/rejection elections. These sections do not prescribe literal question wording; separate sample/notice evidence establishes that wording, with any registry-only questions explicitly pending.',
            'OFFICIAL_PUBLISHER')
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the committed questions without writing state files')
    args = parser.parse_args()
    summary = {}
    for state, builder in [('ks', kansas), ('nm', new_mexico)]:
        path = ROOT / 'data/ballot/2026-general' / (state + '.json')
        original = path.read_text()
        package = json.loads(original)
        rows = builder(package, require_primary=args.check) if state == 'nm' else builder(package)
        encoded = json.dumps(package, ensure_ascii=False, indent=2) + '\n'
        if args.check:
            assert encoded == original, state + ': regeneration changes the committed data'
        else:
            path.write_text(encoded)
            (EVIDENCE / (state + '-questions.json')).write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
        summary[state.upper()] = {'questions': len(rows), 'sourceFormPending': sum('sourceFormPending' in r for r in rows)}
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
