"""Replay all 24 pages of Nebraska's official general candidate table."""
from pathlib import Path
import collections
import hashlib
import json
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-south'
raw=(EVIDENCE/'ne-2026.pdf').read_bytes();meta=json.loads((EVIDENCE/'ne-2026.source.json').read_text())
assert hashlib.sha256(raw).hexdigest()==meta['sha256'] and meta['httpStatus']==200
text=subprocess.run(['pdftotext','-layout',str(EVIDENCE/'ne-2026.pdf'),'-'],check=True,capture_output=True).stdout.decode()
assert text==(EVIDENCE/'ne-2026.txt').read_text()
rows=[];page_counts=[]
for number,page in enumerate(text.split('\f'),1):
    lines=page.splitlines();header=next((line for line in lines if line.startswith('Office') and 'Candidate Name' in line),'')
    if not header:continue
    district_at,term_at,vote_at,party_at,name_at,city_at,incumbency_at,address_at=[header.index(label) for label in ['District Name','Term','Vote','Party','Candidate Name','City of Residence','Incumbency','Mailing Address']]
    name_at-=2
    page_rows=[]
    for index,line in enumerate(lines):
        if not (re.fullmatch(r'\s*\d+\s*',line[term_at:vote_at]) and re.fullmatch(r'\s*\d+\s*',line[vote_at:party_at]) and line[name_at:city_at].strip()):continue
        left=line[:term_at].rstrip()
        # Some long college office names move the district label two columns
        # left of its header. Recognize the publisher's full suffix before using
        # column boundaries for geographical subdivision names.
        suffix=re.search(r'\b(?:District\s+\d+|Subdistrict\s+\d+|Subdivision\s+\d+|At Large)$',left)
        office=left[:suffix.start()].strip() if suffix else line[:district_at].strip()
        district=suffix[0] if suffix else line[district_at:term_at].strip()
        party_label=line[party_at:name_at].strip()
        nextline=lines[index+1] if index+1<len(lines) else ''
        if not nextline[name_at:city_at].strip() and not re.fullmatch(r'\s*\d+\s*',nextline[term_at:vote_at]):
            continuation=nextline[:district_at].strip()
            if continuation:office+=' '+continuation
            continuation=nextline[district_at:term_at].strip()
            if continuation:district+=' '+continuation
            continuation=nextline[party_at:name_at].strip()
            if continuation:party_label+=' '+continuation
        office=' '.join(office.split());district=' '.join(district.split())
        category='CORE' if office.startswith('For ') else 'NATURAL_RESOURCES' if 'Natural Resources' in office else 'OTHER_REGIONAL_LOCAL'
        incumbent_match=re.search(r'\b(Nonincumbent|Incumbent)\b',line[city_at:]);assert incumbent_match,(number,line[name_at:city_at].strip())
        incumbent=incumbent_match[1]
        page_rows.append({'page':number,'office':office,'district':district,'termYears':int(line[term_at:vote_at]),'voteFor':int(line[vote_at:party_at]),'partyLabel':party_label or None,'name':line[name_at:city_at].strip(),'incumbent':incumbent=='Incumbent','category':category})
    assert len(page_rows)==(15 if number==24 else 22),(number,len(page_rows))
    rows.extend(page_rows);page_counts.append({'page':number,'candidates':len(page_rows),'categories':dict(collections.Counter(row['category'] for row in page_rows))})
assert len(rows)==521 and len(page_counts)==24
counts=dict(collections.Counter(row['category'] for row in rows));assert counts=={'CORE':92,'OTHER_REGIONAL_LOCAL':230,'NATURAL_RESOURCES':199}
# Distinguish short and full terms printed for the same numbered subdivision.
race_key=lambda row:(row['office'],row['district'],row['termYears'],row['voteFor'])
counts_by_category={category:{'candidateRows':len(part),'officeDistrictTermTuples':len({race_key(row) for row in part})} for category in counts for part in [[row for row in rows if row['category']==category]]}
assert counts_by_category['CORE']['officeDistrictTermTuples']==42
assert len({row['office'] for row in rows if row['category']=='NATURAL_RESOURCES'})==23
held=next(iter(json.loads((ROOT/'data/ballot/2026-general/ne.json').read_text())['ballots'].values()))
held_names={' '.join([row.get('givenName',''),row['familyName']]).strip() for row in held['candidacies']}
assert {row['name'] for row in rows if row['category']=='CORE'}<=held_names
result={'source':meta,'pages':page_counts,'candidateRows':len(rows),'categories':counts_by_category,'heldCoreCandidateRows':92,'regionalLocalCandidateRowsNotYetImported':429,'rows':rows}
(EVIDENCE/'ne-source-inventory.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('NE_SOURCE_INVENTORY='+json.dumps({key:value for key,value in result.items() if key not in ['source','rows','pages']}))
