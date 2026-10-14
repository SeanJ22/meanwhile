import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader
from ballot_bl13_common import ROOT, ballot, candidate, contest, document, pdf_text, provenance, write_package

DIRECTORY = ROOT / '.scratch/ballot-bl-13/la'
PUBLISHER = 'Louisiana Secretary of State'


def evidence(label, publisher=PUBLISHER):
    raw = (DIRECTORY / label).read_bytes()
    receipt = json.loads((DIRECTORY / (label + '.receipt.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == receipt['rawHash']
    assert receipt['httpStatus'] == 200
    proof = provenance(receipt, publisher)
    return raw, receipt, proof


def main():
    held = ballot('LA')
    raw, receipt, proof = evidence('candidates.html')
    receipts = [receipt]
    doc = document(raw.decode())
    assert '11/03/2026' in doc.text_content()
    races = {}
    for section in doc.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," candidate-section ")]'):
        title = section.xpath('preceding::span[@class="office-title"][1]')[0].text_content().strip()
        if title == 'U. S. Senator':
            key, suffix = 'us-senate', ''
        elif title.startswith('U. S. Representative'):
            number = re.search(r'(\d+)(?:st|nd|rd|th) Congressional District', title)[1]
            key, suffix = 'us-house-' + number, '/cd:' + number
        elif title.startswith('State Representative'):
            number = re.search(r'(\d+)(?:st|nd|rd|th) Representative District', title)[1]
            key, suffix = 'state-house-' + number, '/sldl:' + number
        else:
            raise ValueError(title)
        if key not in races:
            scope = 'Open primary on November 3; general election, if necessary, December 12, 2026.' if key.startswith('us-house-') else None
            races[key] = contest(held, key, title, suffix, proof, complete=False, voteFor=1, scopeNote=scope)
        row = section.xpath('.//div[contains(@class,"candidate-top-row")]')[0]
        name_cell = row.xpath('./div[contains(@class,"col-sm-5")]')[0]
        name = ''.join(name_cell.xpath('./text()')).strip()
        party = row.xpath('./div[contains(@class,"col-sm-4")]')[0].text_content().strip()
        status = ' '.join(section.xpath('.//div[contains(@class,"text-danger")]//text()')).strip()
        assert not status, (name, status)
        candidate(held, races[key], name, party, proof)
    assert len(races) == 8
    assert {c['ocdId'].rsplit('/',1)[-1] for c in held['contests']} == {'state:la','cd:1','cd:2','cd:3','cd:4','cd:5','cd:6','sldl:92'}
    raw, receipt, proof = evidence('amendments.pdf')
    receipts.append(receipt)
    text = pdf_text(raw).replace('\f', '\n')
    blocks = re.split(r'Proposed Amendment No\. (\d+)\s*', text)
    links = [a.get_object()['/A']['/URI'] for page in PdfReader(DIRECTORY / 'amendments.pdf').pages for a in page.get('/Annots',[]) if '/A' in a.get_object()]
    assert len(links) == 10 and len(blocks) == 21
    for index in range(1,len(blocks),2):
        number, block = blocks[index:index+2]
        statement, question = block.split('Do you support an amendment',1)
        question = re.sub(r'\s+', ' ', 'Do you support an amendment' + question).strip()
        title = 'Proposed Amendment No. ' + number
        race = contest(held, 'amendment-'+number, title, '', proof, kind='MEASURE', measureTextUrl=links[int(number)-1])
        held['measures'].append({'id': race['id']+':measure', 'contestId':race['id'], 'officialNumber':number,
                                'questionText':question, 'officialStatement':re.sub(r'\s+',' ',statement).strip(), 'provenance':proof})
        _, act_receipt, _ = evidence('act-'+number+'.pdf', 'Louisiana Legislature')
        receipts.append(act_receipt)
    for label in ['current-door.html','types.html','offices.html','election-dates.html']:
        _, source_receipt, _ = evidence(label)
        receipts.append(source_receipt)
    held['election']['name'] = '2026 U.S. Senate General / Open U.S. Representative Primary / Open Primary Election'
    held['coverageNotes'] = [
        'The Secretary of State labels November 3 as U.S. Senate General/Open U.S. Representative Primary/Open Primary Election. U.S. House races are open primaries, with a December 12 general election if necessary. ' + receipts[-1]['finalUrl'],
        'The public November 3 candidate inquiry lists U.S. Senate, all six U.S. House districts and State Representative District 92. The captured inquiry does not state that this is a certified candidate list; certification status remains unconfirmed. ' + receipts[0]['finalUrl'],
        'Regional Supreme Court, Public Service Commission, BESE and local judicial offices listed by the office selector are outside this statewide/federal/legislative projection. ' + receipts[-2]['finalUrl']]
    write_package(held, receipts, str(ROOT / 'data/ballot/2026-general/la.json'))
    (ROOT / '.scratch/ballot-bl-13/la/door-update.json').write_text(json.dumps({'id':'fec-la-chief','url':'https://www.sos.la.gov/elections-voting',
        'electionPageUrl':receipts[-1]['finalUrl'], 'candidateListUrl':receipts[0]['finalUrl'],
        'ballotMeasuresUrl':receipts[1]['finalUrl'], 'covers':['CANDIDATE_LIST','BALLOT_MEASURES'],
        'access':{'status':'open','checkedAt':max(r['retrievedAt'] for r in receipts)[:10],
                  'detail':'Current official election root and public statewide candidate inquiry reached; the legacy root returns 404.'}},indent=2)+'\n')
    print(len(held['contests']),len(held['candidacies']),len(held['measures']))


if __name__ == '__main__':
    main()
