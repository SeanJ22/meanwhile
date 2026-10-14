import json
import re
from pathlib import Path

from ballot_bl13_common import ballot, candidate, capture, contest, document, pdf_text, provenance, slug, write_package, ROOT

STATE = 'MO'
PUBLISHER = 'Missouri Secretary of State'
CANDIDATES = 'https://www.sos.mo.gov/CMSImages/ElectionCandidates/2026GeneralElectionCertifiedCandidates.pdf'
MEASURES = 'https://www.sos.mo.gov/petitions/2026BallotMeasures'
DIRECTORY = ROOT / '.scratch/ballot-bl-13/mo'


def source(url, label):
    path = DIRECTORY / label
    if path.exists() and path.with_name(path.name + '.receipt.json').exists():
        receipt = json.loads(path.with_name(path.name + '.receipt.json').read_text())
        assert receipt['requestedUrl'] == url
        return path.read_bytes(), receipt
    return capture(STATE, url, label)


def content(element):
    return element.text_content().replace('\xa0', ' ').strip()


def block_text(element):
    return '\n'.join(content(child) for child in element.xpath('./p | ./ul/li') if content(child))


def main():
    held = ballot(STATE)
    raw, receipt = source(CANDIDATES, 'certified-candidates.pdf')
    proof = provenance(receipt, PUBLISHER)
    receipts = [receipt]
    text = pdf_text(raw)
    assert 'General Election on Tuesday, November 3, 2026' in text
    assert 'August 25, 2026' in text
    assert 'true and correct list' in text
    races = {}
    party = None
    office = None
    reading = False
    supreme = False
    for original in text.replace('\f', '\n').splitlines():
        line = original.strip()
        if not line or line.isdigit():
            continue
        match = re.fullmatch(r'(REPUBLICAN|DEMOCRATIC|LIBERTARIAN|INDEPENDENT) CANDIDATES', line)
        if match:
            party = match[1]
            reading = True
            continue
        if line == 'CERTIFICATION':
            reading = False
        if line == 'For the Missouri Supreme Court':
            supreme = True
            continue
        if supreme:
            if line.startswith('For '):
                supreme = False
            else:
                race = contest(held, 'supreme-court-retention-' + slug(line),
                               f'Missouri Supreme Court — Retention of {line}', '', proof,
                               kind='RETENTION', voteFor=1, candidateListComplete=True)
                candidate(held, race, line, None, proof, incumbent=True)
                supreme = False
                continue
        if not reading:
            continue
        if line.startswith('For '):
            office = line[4:]
            continue
        if office == 'State Auditor':
            key, title, suffix, name = 'auditor', office, '', line
        elif office in ['U.S. Representative', 'State Senator', 'State Representative']:
            match = re.fullmatch(r'District (\d+), (.+)', line)
            if not match:
                continue
            district, name = match.groups()
            segment = {'U.S. Representative': 'cd', 'State Senator': 'sldu', 'State Representative': 'sldl'}[office]
            key, title, suffix = f'{segment}-{district}', f'{office} District {district}', f'/{segment}:{district}'
        else:
            continue
        if key not in races:
            races[key] = contest(held, key, title, suffix, proof, complete=True)
        candidate(held, races[key], name, party, proof)
    assert sum(key.startswith('cd-') for key in races) == 8
    assert sum(key.startswith('sldu-') for key in races) == 17
    assert {int(key[5:]) for key in races if key.startswith('sldl-')} == set(range(1, 164))
    assert len([row for row in held['contests'] if row['type'] == 'RETENTION']) == 1

    raw, receipt = source(MEASURES, 'measures.html')
    receipts.append(receipt)
    proof = provenance(receipt, PUBLISHER)
    doc = document(raw)
    main = doc.get_element_by_id('main')
    general = False
    for element in main:
        if element.tag == 'h2' and 'The following ballot measures' in content(element):
            general = 'November 3, 2026' in content(element)
            continue
        if not general or element.tag != 'div':
            continue
        full_links = element.xpath('.//a[normalize-space(text())="full text"]')
        if not full_links:
            continue
        number_match = re.fullmatch(r'(Amendment \d+|Proposition [A-Z]) full text',
                                   full_links[0].get('aria-label', ''))
        assert number_match, full_links[0].attrib
        number = number_match[1]
        titles = element.xpath('./blockquote')
        assert len(titles) == 2, number
        text_url = full_links[0].get('href')
        full_raw, full_receipt = source(text_url, slug(number) + '-full-text.pdf')
        provenance(full_receipt, PUBLISHER)
        receipts.append(full_receipt)
        assert full_raw.startswith(b'%PDF'), text_url
        race = contest(held, slug(number), number, '', proof, kind='MEASURE', measureTextUrl=text_url)
        held['measures'].append({'id': race['id'] + ':measure', 'contestId': race['id'],
                                 'officialNumber': number, 'questionText': block_text(titles[0]),
                                 'officialStatement': block_text(titles[1]), 'provenance': proof})
    assert {row['officialNumber'] for row in held['measures']} == {
        'Amendment 3', 'Amendment 6', 'Amendment 7', 'Amendment 8', 'Proposition A'}
    held['coverageNotes'].append(
        'The Secretary of State certified the November 3, 2026 candidate list on August 25, 2026. '
        'It lists State Auditor, U.S. Representative, State Senator and State Representative contests, '
        'plus judicial candidates; it lists no U.S. Senate contest. '
        'This statewide and legislative projection includes Missouri Supreme Court retention. '
        'Court of Appeals, Circuit Judge and Associate Circuit Judge contests require their judicial divisions and remain outside this projection. '
        + CANDIDATES)
    write_package(held, receipts, str(ROOT / 'data/ballot/2026-general/mo.json'))
    (ROOT / '.scratch/ballot-bl-13/mo/door-update.json').write_text(json.dumps({
        'id': 'fec-mo-chief', 'covers': ['CANDIDATE_LIST', 'BALLOT_MEASURES'],
        'candidateListUrl': CANDIDATES, 'ballotMeasuresUrl': MEASURES,
        'electionAssociationVerified': True,
        'access': {'status': 'open', 'checkedAt': max(row['retrievedAt'] for row in receipts)[:10],
                   'detail': 'Official election root links the certified November 3, 2026 candidate list. '
                             'The official 2026 Ballot Measures page lists the measures certified for that general election.'}},
        indent=2) + '\n')
    print(json.dumps({'contests': len(held['contests']), 'candidates': len(held['candidacies']),
                      'measures': len(held['measures']), 'candidate_contests': len(races),
                      'retention': 1, 'sources': len(receipts)}))


if __name__ == '__main__':
    main()
