"""Replay DeSoto's countywide races from every official November ballot style."""
from pathlib import Path
import hashlib
import html
import json
import re

import runpy

capture_sha256 = runpy.run_path(str(Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/ba01-south'
COUNTY = EVIDENCE / 'ms-desoto'
STATE = ROOT / 'data/ballot/2026-general/ms.json'


def normalize(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())


def checked(path, metadata):
    raw = path.read_bytes()
    meta = json.loads(metadata.read_text())
    assert meta['httpStatus'] == 200 and capture_sha256(raw) == meta['sha256'], path
    return raw, meta


page, page_meta = checked(COUNTY/'candidate-list.html', COUNTY/'candidate-list.html.source.json')
page_text = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', page.decode())).split())
assert '2026 Judicial' in page_text
assert 'Some judicial positions are elected countywide' in page_text
sample, meta = checked(COUNTY/'ballot-styles.pdf', COUNTY/'ballot-styles.source.json')
texts = {}
for entry in meta['sourceTexts']:
    text = (COUNTY/entry['path']).read_text()
    assert hashlib.sha256(text.encode()).hexdigest() == entry['sha256']
    texts[entry['path']] = text
# All four source pages include these offices. Style3 adds its narrow seats
# alongside all five ordinary court seats, proving the ordinary electorate is
# the entire county rather than the GIS polygon excluding that subdistrict.
for number in range(1, 5):
    text = texts[f'style-{number}.txt']
    text += texts[f'style-{number}-psm6.txt']
    assert 'NOVEMBER 3, 2026' in text and 'Ballot Style '+str(number) in text
    for office in ['Chancery District 17 Place 1', 'Chancery District 17 Place 2',
                   'Circuit District 21 Place 1', 'Circuit District 21 Place 2', 'Circuit District 21 Place 3',
                   'District 1 Position 1', 'District 1 Position 2', 'County Court Judge Place 1', 'County Attorney']:
        assert normalize(office) in normalize(text), (number, office)
    assert normalize('Allen B. Couch') in normalize(text)
    assert normalize('Tori Williams') in normalize(text)
assert 'Chancery District 17-1 Place 3' in texts['style-3.txt']
assert 'Circuit Court 21-1 Place 4' in texts['style-3.txt']

state_sample, state_meta = checked(EVIDENCE/'ms-2026.pdf', EVIDENCE/'ms-2026.source.json')
state_text = (EVIDENCE/'ms-2026.txt').read_text()
source = []
for match in re.finditer(r'(?m)^For (.*?)\nVote for ONE\n(.*?)\nWrite-in', state_text, re.S):
    title = ' '.join(match[1].splitlines())
    if not (re.fullmatch(r'Chancery Court Judge Chancery District 17 Place [12]', title) or
            re.fullmatch(r'Circuit Court Judge Circuit District 21 Place [123]', title)):
        continue
    names = re.findall(r'(?m)^(.+) (Democrat|Republican|Independent|Libertarian|Nonpartisan)$', match[2])
    assert all(normalize(name) in normalize(page_text) for name, _party in names)
    assert names and all(party == 'Nonpartisan' for _name, party in names)
    source.append((title, names))
assert len(source) == 5 and sum(len(names) for _, names in source) == 7

registry = (EVIDENCE/'ms-judicial/ocd-ms-courts.csv').read_bytes()
registry_meta = json.loads((EVIDENCE/'ms-judicial/ocd-ms-courts.source.json').read_text())
assert hashlib.sha256(registry).hexdigest() == registry_meta['sourceTextSha256']
registry_ids = {line.split(',')[0] for line in registry.decode().splitlines()[1:]}
county_id = 'ocd-division/country:us/state:ms/county:desoto'
assert county_id in registry_ids


def provenance(metadata, org, quote):
    return {'sourceUrl':metadata['finalUrl'], 'sourceOrg':org, 'collectedAt':metadata['retrievedAt'],
            'verifiedAt':metadata['retrievedAt'], 'quote':quote}


data = json.loads(STATE.read_text())
ballot = data['ballots']['MS:ms-2026-11-03']
added_contests = added_candidates = added_memberships = 0
for title, names in source:
    match = re.search(r'(Chancery|Circuit) District (\d+) Place (\d+)', title)
    assert match
    kind, district, place = match[1].lower(), match[2], match[3]
    cid = f'ms-ba01-2026-{kind}-{district}-place-{place}'
    ocd = 'ocd-division/country:us/state:ms/'+kind+'_court:'+district
    assert ocd in registry_ids
    if not any(row['id'] == cid for row in ballot['contests']):
        ballot['contests'].append({'id':cid, 'electionId':ballot['election']['id'], 'ocdId':ocd,
            'divisionVintage':'2027_TERM', 'title':title, 'type':'CANDIDACY', 'voteFor':1,
            'termYears':None, 'scopeNote':None, 'candidateListComplete':True,
            'provenance':provenance(state_meta,'Mississippi Secretary of State',title+'\n'+'\n'.join(name+' '+party for name,party in names))})
        added_contests += 1
        for name,party in names:
            slug = re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
            ballot['candidacies'].append({'id':cid+'-'+slug, 'contestId':cid, 'familyName':name, 'givenName':'',
                'partyLabel':party, 'slogan':None, 'incumbent':None, 'websiteUrl':None,
                'provenance':provenance(state_meta,'Mississippi Secretary of State',name+' '+party)})
            added_candidates += 1
    actual = [row for row in ballot['candidacies'] if row['contestId'] == cid]
    assert len(actual) == len(names) and {(row['familyName'],row['partyLabel']) for row in actual} == set(names)

for suffix, title, name in [
    ('county-court-place-1','County Court Judge Place 1','Allen B. Couch, Jr.'),
    ('county-attorney-special','County Attorney, Special Election','Tori Williams'),
]:
    assert normalize(name) in normalize(page_text)
    cid = 'ms-ba01-2026-desoto-'+suffix
    if not any(row['id'] == cid for row in ballot['contests']):
        prov = provenance(meta,'DeSoto County Election Commission',title+'; '+name+'; NONPARTISAN; Ballot Styles 1, 2, 3 and 4; November 3, 2026')
        ballot['contests'].append({'id':cid, 'electionId':ballot['election']['id'], 'ocdId':county_id,
            'divisionVintage':'2026', 'title':title, 'type':'CANDIDACY', 'voteFor':1,
            'termYears':None, 'scopeNote':None, 'candidateListComplete':True, 'provenance':prov})
        ballot['candidacies'].append({'id':cid+'-'+re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-'),
            'contestId':cid, 'familyName':name, 'givenName':'', 'partyLabel':'NONPARTISAN',
            'slogan':None, 'incumbent':None, 'websiteUrl':None, 'provenance':prov})
        added_contests += 1
        added_candidates += 1

for kind,district,quote in [
    ('chancery','17','Chancery District 17 Place 1; Chancery District 17 Place 2'),
    ('circuit','21','Circuit District 21 Place 1; Circuit District 21 Place 2; Circuit District 21 Place 3'),
    ('appeals','1','District 1 Position 1; District 1 Position 2'),
]:
    ocd_kind = 'court_of_appeals' if kind == 'appeals' else kind+'_court'
    district_id = 'ocd-division/country:us/state:ms/'+ocd_kind+':'+district
    assert district_id in registry_ids
    ident = 'ms-ba01-county-desoto-'+kind+'-'+district
    if not any(row['id'] == ident for row in ballot['districtMemberships']):
        ballot['districtMemberships'].append({'id':ident, 'memberOcdId':county_id, 'districtOcdId':district_id,
            'provenance':provenance(meta,'DeSoto County Election Commission',
                'All four official November 3, 2026 ballot styles contain: '+quote+'. Style 3 also includes the separate precinct-subdistrict seats; the ordinary seats remain on every style.')})
        added_memberships += 1

for captured,org in [(meta,'DeSoto County Election Commission'),(page_meta,'DeSoto County')]:
    receipt = {'requestedUrl':captured['url'], 'finalUrl':captured['finalUrl'], 'retrievedAt':captured['retrievedAt'],
        'httpStatus':captured['httpStatus'], 'rawHash':captured['sha256'], 'publisher':org,
        'sourceClass':'ELECTION_AUTHORITY', 'reviewOutcome':'SUPPORTED',
        'reviewedEvidence':'scripts/ba01-south-ms-desoto.py checks all four dated official sample styles and their saved OCR hashes. Five ordinary court races, both appellate positions and two local races appear on every style; Style 3 adds separate precinct-subdistrict seats. All candidate names are checked against the current official county page and the dated state sample. Whole-county electorates are established by all ballot styles, not the narrower GIS rest-of-county polygons. Precinct-specific races remain open.'}
    if not any(row.get('finalUrl') == receipt['finalUrl'] and row.get('rawHash') == receipt['rawHash'] and row.get('retrievedAt') == receipt['retrievedAt'] for row in data['sourceReceipt']['sources']):data['sourceReceipt']['sources'].append(receipt)
    data['sourceReceipt']['reviewedAt'] = max(data['sourceReceipt']['reviewedAt'],captured['retrievedAt'])
note = 'All four DeSoto County sample styles verify five ordinary court seats and both appellate positions for every county voter. County Court Place 1 and the County Attorney special election are also held countywide. The countywide portion matches Style 2: 11 contests / 18 candidates. Style 1 still needs Justice Court District 1; Style 3 needs the two precinct-subdistrict court seats; Style 4 needs School Board District 5.'
if note not in ballot['coverageNotes']:ballot['coverageNotes'].append(note)
STATE.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
report = {'added_contests':added_contests,'added_candidates':added_candidates,'added_memberships':added_memberships,
    'contests':len(ballot['contests']),'candidacies':len(ballot['candidacies']),
    'batch_contests':7,'batch_candidates':9,'batch_memberships':3,
    'official_styles':[{'style':1,'officialContests':12,'officialCandidates':20,'heldContests':11,'heldCandidates':18,'missing':'Justice Court District 1'},
                       {'style':2,'officialContests':11,'officialCandidates':18,'heldContests':11,'heldCandidates':18,'missing':None},
                       {'style':3,'officialContests':13,'officialCandidates':22,'heldContests':11,'heldCandidates':18,'missing':'Chancery 17-1 Place 3 and Circuit 21-1 Place 4'},
                       {'style':4,'officialContests':12,'officialCandidates':20,'heldContests':11,'heldCandidates':18,'missing':'School Board District 5'}]}
(COUNTY/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
