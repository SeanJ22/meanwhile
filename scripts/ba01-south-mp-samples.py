"""Recount every captured MP specimen row and compare its people to certified list."""
from pathlib import Path
import subprocess
import re,json,unicodedata,collections,hashlib
P=Path(__file__).resolve().parents[1]/'data/ballot/evidence/ba01-south/territories'
raw=(P/'mp-sample.pdf').read_bytes();meta=json.loads((P/'mp-sample.pdf.source.json').read_text());assert hashlib.sha256(raw).hexdigest()==meta['sha256']
derived=subprocess.run(['pdftotext','-raw',str(P/'mp-sample.pdf'),'-'],check=True,capture_output=True).stdout.decode();assert derived==(P/'mp-sample-raw.txt').read_text()
roster=json.loads((P/'verified-rosters.json').read_text())['MP']
def key(s):return tuple(sorted(re.findall(r'[a-z0-9]+',unicodedata.normalize('NFKD',s.lower()))))
expected={key(c[field]):(r['office'],r['area'],c['partyLabel']) for r in roster for c in r['candidates'] for field in ['name','runningMate'] if field in c}
assert len(expected)==77
pages=[];all_names=set();scope_races={}
for page_no,page in enumerate((P/'mp-sample-raw.txt').read_text().split('\f'),1):
 if 'Precinct No.' not in page:continue
 precinct=re.search(r'Precinct No\. ([^\n]+)',page)[1]
 pattern=r'^(GOVERNOR/ LT\. GOVERNOR|ATTORNEY GENERAL|DELEGATE TO THE U\.S\. HOUSE OF\nREPRESENTATIVES|SENATE|MAYOR OF [A-Z ]+(?:\nISLANDS)?|MUNICIPAL COUNCIL|BOARD OF EDUCATION|JUSTICE/JUDGE RETENTION|HOUSE OF REPRESENTATIVE)\n'
 starts=list(re.finditer(pattern,page,re.M));assert len(starts) in [8,9],(precinct,len(starts))
 races=[]
 for n,match in enumerate(starts):
  office=' '.join(match[1].split());body=page[match.end():starts[n+1].start() if n+1<len(starts) else len(page)]
  if office=='JUSTICE/JUDGE RETENTION':
   name=re.search(r'Shall Justice (.*?)\nof the CNMI',body,re.S)[1].replace('\n',' ')
   names=[name];party=['Non-Partisan'];vote=None
  else:
   vote_match=re.search(r'Vote for [Nn]o [Mm]ore [Tt]han ([^\n]+)',body)
   assert vote_match,(precinct,office)
   vote=int(re.search(r'\((\d+)\)',vote_match[1])[1])
   candidates=re.findall(r'^\d+ [A-Z].*?(?=^\d+ [A-Z]|\Z)',body,re.S|re.M)
   assert candidates,(precinct,office,body)
   names=[];party=[]
   for candidate in candidates:
    label=re.search(r'^\((Independent|Republican|Democrat)\)',candidate,re.M)
    label=label[1] if label else None
    candidate=re.split(r'^\(',candidate,flags=re.M)[0]
    candidate=re.sub(r'^\d+ ','',candidate)
    candidate=re.split(r'^\d+$|^SPECIMEN$',candidate,flags=re.M)[0]
    people=re.split(r'\n(?=[A-Z][A-Z -]+,)',candidate)
    for person in people:
     name=' '.join(person.split());assert key(name) in expected,(precinct,office,name)
     names.append(name);party.append(label)
  for name,label in zip(names,party):
   k=key(name);assert k in expected,(precinct,office,name)
   if label: assert expected[k][2]==label,(precinct,office,name,label,expected[k])
   all_names.add(k)
  office_keys={(expected[key(name)][0],expected[key(name)][1]) for name in names}
  if office=='GOVERNOR/ LT. GOVERNOR':assert len(names)==6
  assert len(office_keys)==1,(precinct,office,office_keys)
  k=next(iter(office_keys));scope_races.setdefault(k,{'office':k[0],'area':k[1],'samplePrecincts':[],'voteFor':vote,'samplePeople':names,'certifiedPeople':len(names)})
  scope_races[k]['samplePrecincts'].append(precinct)
  assert {key(x) for x in scope_races[k]['samplePeople']}=={key(x) for x in names},k
  assert scope_races[k]['voteFor']==vote,k
  races.append({'office':k[0],'area':k[1],'people':len(names),'choices':len(names)//2 if office=='GOVERNOR/ LT. GOVERNOR' else len(names),'voteFor':vote})
 pages.append({'precinct':precinct,'pdfPage':page_no,'contests':len(races),'choices':sum(r['choices'] for r in races),'people':sum(r['people'] for r in races),'races':races})
assert all_names==set(expected),(len(all_names),len(expected))
assert len(scope_races)==22
out={'certifiedCandidateUnits':74,'certifiedPeople':77,'uniqueContests':22,'sampleNamesMatched':len(all_names),'samplePrecincts':pages,'officeScopes':list(scope_races.values())}
(P/'mp-sample-comparison.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{k:v for k,v in page.items() if k!='races'} for page in pages]))
print('All 77 certified people matched sample rows; all printed party labels agree; 22 unique contests.')
