import json,re,pathlib,subprocess,hashlib,sys
D=pathlib.Path(sys.argv[1])
def metadata(name):
 m=json.loads((D/(name+'.meta.json')).read_text());assert hashlib.sha256((D/name).read_bytes()).hexdigest()==m['rawHash'];return m
def text(name):return subprocess.check_output(['pdftotext','-layout',str(D/name),'-'],text=True)
eid='tx-2026-11-03-general';base='ocd-division/country:us/state:tx'
def prov(name,quote=None):
 m=metadata(name);p={'sourceUrl':m['finalUrl'],'sourceOrg':'Texas Secretary of State','collectedAt':m['retrievedAt'],'verifiedAt':m['retrievedAt'],'doorId':'fec-tx-chief'}
 if quote:p['quote']=quote
 return p
def scope(title):
 for pattern,kind in [(r'U\. S\. REPRESENTATIVE DISTRICT (\d+)','cd'),(r'STATE SENATOR, DISTRICT (\d+)','sldu'),(r'STATE REPRESENTATIVE DISTRICT (\d+)','sldl'),(r'MEMBER, STATE BOARD OF EDUCATION, DISTRICT (\d+)','sbe')]:
  m=re.match(pattern,title)
  if m:return base+'/'+kind+':'+m[1]
 if title in ['U. S. SENATOR','GOVERNOR','LIEUTENANT GOVERNOR','ATTORNEY GENERAL','COMPTROLLER OF PUBLIC ACCOUNTS','COMMISSIONER OF THE GENERAL LAND OFFICE','COMMISSIONER OF AGRICULTURE','RAILROAD COMMISSIONER'] or 'SUPREME COURT' in title or 'COURT OF CRIMINAL APPEALS' in title or '15TH COURT OF APPEALS' in title:return base
 return None
rosters={};title=None
for line in text('certified.pdf').splitlines():
 if re.match(r'^\s{3,9}[A-Z][A-Z .0-9,()/-]+$',line) and not re.search(r'\s+(REP|DEM|LIB|GRE|IND)\s*$',line):title=line.strip()
 m=re.match(r'^\s{8,}(.+?)\s{2,}(REP|DEM|LIB|GRE|IND)\s*$',line)
 if m and title and scope(title):rosters.setdefault(title,{}).setdefault((m[1].strip(),m[2]),('certified.pdf',line.strip()))
contests=[];candidates=[]
for title,rows in rosters.items():
 cid='tx-sos-2026-'+re.sub('[^a-z0-9]+','-',title.lower()).strip('-')
 contests.append({'id':cid,'electionId':eid,'ocdId':scope(title),'divisionVintage':'2026','title':title,'type':'CANDIDACY','voteFor':1,'termYears':None,'scopeNote':None,'candidateListComplete':True,'provenance':prov('certified.pdf',title)})
 for name,party in rows:
  given,_,family=name.rpartition(' ')
  candidates.append({'id':cid+'-'+hashlib.sha256((name+'|'+party).encode()).hexdigest()[:16],'contestId':cid,'familyName':family or name,'givenName':given,'partyLabel':party,'slogan':None,'incumbent':None,'websiteUrl':None,'provenance':prov('certified.pdf',name+' '+party)})
for line in text('writeins.pdf').splitlines():
 m=re.match(r'^(U\.S\. Senator|U\.S\. Representative, District \d+|Governor|Lieutenant Governor|Member, State Board of Education, District \d+|State Representative, District \d+)\s{2,}(.+?)\s*$',line)
 if not m:continue
 office,name=m.groups();title=office.upper().replace('U.S.','U. S.').replace('U. S. REPRESENTATIVE,','U. S. REPRESENTATIVE').replace('STATE REPRESENTATIVE,','STATE REPRESENTATIVE')
 contest=next(c for c in contests if c['title']==title)
 given,_,family=name.rpartition(' ')
 candidates.append({'id':contest['id']+'-'+hashlib.sha256(name.encode()).hexdigest()[:16],'contestId':contest['id'],'familyName':family or name,'givenName':given,'partyLabel':None,'slogan':None,'incumbent':None,'websiteUrl':None,'provenance':prov('writeins.pdf',line.strip())})
assert len([c for c in contests if '/cd:' in c['ocdId']])==38
assert len([c for c in contests if '/sldl:' in c['ocdId']])==150
ballot={'election':{'id':eid,'date':'2026-11-03','name':'2026 November General Election','state':'TX'},'contests':contests,'candidacies':candidates,'measures':[],'absences':[],'coverageNotes':['The certified report is organized by all 254 counties; identical statewide and district entries are combined. Certified write-in candidates are included. The official general-election page links a sample ballot and candidate certifications but no statewide measure list; statewide measures remain unverified. Separate November 3 special-election candidate certifications for Senate District 22 and House District 93 are not held.']}
sources=[]
for name in ['root.html','election.html','certified.pdf','writeins.pdf','sample.pdf']:
 if name=='root.html':m=json.loads((D/(name+'.json')).read_text());assert hashlib.sha256((D/name).read_bytes()).hexdigest()==m['rawHash']
 else:m=metadata(name)
 sources.append({k:m[k] for k in ['requestedUrl','finalUrl','httpStatus','rawHash','retrievedAt']}|{'sourceClass':'ELECTION_AUTHORITY','publisher':'Texas Secretary of State','reviewedEvidence':'Official election-office source downloaded and converted by scripts/ballot-bl-16-tx.py.'})
result={'kind':'ballot-contests','ballots':{'TX:'+eid:ballot},'sourceReceipt':{'contractVersion':1,'reviewedAt':max(s['retrievedAt'] for s in sources),'reviewedBy':'BL-16 source conversion','sources':sources}}
(D/'tx.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(len(contests),len(candidates),'contests/candidates; senate districts',len([c for c in contests if '/sldu:' in c['ocdId']]))
