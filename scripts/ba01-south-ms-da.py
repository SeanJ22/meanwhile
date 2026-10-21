"""Replay the November 3 Hinds County district-attorney special election."""
from pathlib import Path
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/ba01-south'
raw = (EVIDENCE/'ms-judicial/hinds-da-special.html').read_bytes()
meta = json.loads((EVIDENCE/'ms-judicial/hinds-da-special.source.json').read_text())
assert hashlib.sha256(raw).hexdigest() == meta['sha256'] and meta['httpStatus'] == 200
text = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', raw.decode())).split())
quote = 'District Attorney for the Seventh Circuit Court District, which covers Hinds County.'
assert quote in text
assert 'July 10, 2026' in text and 'special election to be held on November 3, 2026' in text
sample = (EVIDENCE/'ms-2026.pdf').read_bytes()
sample_meta = json.loads((EVIDENCE/'ms-2026.source.json').read_text())
assert hashlib.sha256(sample).hexdigest() == sample_meta['sha256']
ballot_text = (EVIDENCE/'ms-2026.txt').read_text()
match = re.search(r'(?m)^For (District Attorney 07\nDistrict 07)\nVote for ONE\n(.*?)\nWrite-in', ballot_text, re.S)
assert match
names = re.findall(r'(?m)^(.+) (Democrat|Republican|Independent|Libertarian|Nonpartisan)$',match[2])
assert len(names) == 5 and all(party == 'Independent' for _,party in names)
path = ROOT/'data/ballot/2026-general/ms.json'
data = json.loads(path.read_text());ballot = data['ballots']['MS:ms-2026-11-03']
cid = 'ms-ba01-2026-district-attorney-7-special'
provenance = {'sourceUrl':sample_meta['finalUrl'],'sourceOrg':'Mississippi Secretary of State',
    'collectedAt':sample_meta['retrievedAt'],'verifiedAt':sample_meta['retrievedAt'],
    'quote': ' '.join(match[1].split())+'\n'+'\n'.join(name+' '+party for name,party in names)}
added = 0
if not any(row['id'] == cid for row in ballot['contests']):
    ballot['contests'].append({'id':cid,'electionId':ballot['election']['id'],
        'ocdId':'ocd-division/country:us/state:ms/county:hinds','divisionVintage':'2026',
        'title':' '.join(match[1].split()),'type':'CANDIDACY','voteFor':1,'termYears':None,
        'scopeNote':None,'candidateListComplete':True,'provenance':provenance})
    for name,party in names:
        slug = re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
        ballot['candidacies'].append({'id':cid+'-'+slug,'contestId':cid,'familyName':name,'givenName':'',
            'partyLabel':party,'slogan':None,'incumbent':None,'websiteUrl':None,
            'provenance':{**provenance,'quote':name+' '+party}})
    added = 1
actual = [row for row in ballot['candidacies'] if row['contestId'] == cid]
assert len(actual) == 5 and {(row['familyName'],row['partyLabel']) for row in actual} == set(names)
receipt = {'requestedUrl':meta['url'],'finalUrl':meta['finalUrl'],'retrievedAt':meta['retrievedAt'],
    'httpStatus':meta['httpStatus'],'rawHash':meta['sha256'],'publisher':'Office of Governor Tate Reeves',
    'sourceClass':'OFFICIAL_PUBLISHER','reviewOutcome':'SUPPORTED',
    'reviewedEvidence':"The July 10, 2026 official Governor announcement expressly states that District Attorney for the Seventh Circuit Court District covers Hinds County and sets its special election for November 3, 2026. scripts/ba01-south-ms-da.py checks those exact statements and all five certified names/parties on the saved dated statewide sample. The county scope is unrelated to the precinct subdistrict electorates for circuit-judge races."}
if not any(row.get('finalUrl') == receipt['finalUrl'] and row.get('rawHash') == receipt['rawHash'] and row.get('retrievedAt') == receipt['retrievedAt'] for row in data['sourceReceipt']['sources']):data['sourceReceipt']['sources'].append(receipt)
data['sourceReceipt']['reviewedAt'] = max(data['sourceReceipt']['reviewedAt'],meta['retrievedAt'])
note = 'The November 3 District Attorney 7 special election is held with all five printed candidates and the Hinds County electorate expressly stated in the Governor\'s July 10, 2026 announcement. Circuit-judge precinct subdistricts remain separate and are not widened to Hinds County.'
if note not in ballot['coverageNotes']:ballot['coverageNotes'].append(note)
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'added_contests':added,'added_candidates':added*5,'contests':len(ballot['contests']),'candidacies':len(ballot['candidacies'])}))
