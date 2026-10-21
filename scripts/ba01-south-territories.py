"""Replay certified AS/MP/VI lists and official specimens into ballot packages."""
from pathlib import Path
import csv
import hashlib
import json
import re
import runpy
import subprocess
import unicodedata

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-south/territories'
for script in ['ba01-south-territory-sources.py','ba01-south-mp-samples.py','ba01-south-vi-samples.py']:
    runpy.run_path(str(ROOT/'scripts'/script))
rosters=json.loads((EVIDENCE/'verified-rosters.json').read_text())
mp=json.loads((EVIDENCE/'mp-sample-comparison.json').read_text())
vi=json.loads((EVIDENCE/'vi-sample-comparison.json').read_text())
registry_raw=(EVIDENCE/'ocd-territories.csv').read_bytes()
registry_meta=json.loads((EVIDENCE/'ocd-territories.source.json').read_text())
assert hashlib.sha256(registry_raw).hexdigest()==registry_meta['sourceTextSha256']
registry={row['id']:row for row in csv.DictReader(registry_raw.decode().splitlines())}


def capture(name):
    raw=(EVIDENCE/name).read_bytes();meta=json.loads((EVIDENCE/(name+'.source.json')).read_text())
    assert meta['httpStatus']==200 and hashlib.sha256(raw).hexdigest()==meta['sha256'],name
    return raw,meta


def slug(value):
    return re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()).strip('-')


def provenance(meta,org,quote):
    return {'sourceUrl':meta['finalUrl'],'sourceOrg':org,'collectedAt':meta['retrievedAt'],'verifiedAt':meta['retrievedAt'],'quote':quote}


class Package:
    def __init__(self,st,org):
        self.st=st;self.org=org;self.base='ocd-division/country:us/territory:'+st.lower()
        self.eid=st.lower()+'-2026-11-03-general'
        self.ballot={'election':{'id':self.eid,'date':'2026-11-03','name':'2026 General Election','state':st},'contests':[],'candidacies':[],'measures':[],'absences':[],'coverageNotes':[],'districtMemberships':[],'candidateTickets':[]}
        self.sources={}
    def source(self,name,org=None,kind='ELECTION_AUTHORITY',evidence=None):
        raw,meta=capture(name)
        row={'requestedUrl':meta['url'],'finalUrl':meta['finalUrl'],'retrievedAt':meta['retrievedAt'],'httpStatus':meta['httpStatus'],'rawHash':meta['sha256'],'publisher':org or self.org,'sourceClass':kind,'reviewOutcome':'SUPPORTED','reviewedEvidence':evidence or 'scripts/ba01-south-territories.py replays every candidate and exact electorate from the saved current official source; source-specific parsers compare every certified person and party against the dated specimen.'}
        self.sources[(row['finalUrl'],row['rawHash'],row['retrievedAt'])]=row
        return meta
    def candidate(self,cid,name,party,prov):
        return {'id':cid+'-'+slug(name),'contestId':cid,'familyName':name,'givenName':'','partyLabel':party,'slogan':None,'incumbent':None,'websiteUrl':None,'provenance':prov}
    def race(self,suffix,title,ocd,names,meta,vote=None,retention=False,quote=None,candidate_meta=None):
        assert ocd in registry and not registry[ocd]['sameAs'],ocd
        cid=self.st.lower()+'-ba01-2026-'+suffix
        statement=quote or title+'\n'+'\n'.join(c['name']+(' / '+c['runningMate'] if c.get('runningMate') else '')+(' — '+c['partyLabel'] if c['partyLabel'] else '') for c in names)
        prov=provenance(meta,self.org,statement)
        self.ballot['contests'].append({'id':cid,'electionId':self.eid,'ocdId':ocd,'divisionVintage':'2026','title':title,'type':'RETENTION' if retention else 'CANDIDACY','voteFor':vote,'termYears':None,'scopeNote':None,'candidateListComplete':True,'provenance':prov})
        for c in names:
            cprov=provenance(candidate_meta or meta,self.org,c['name']+(' / '+c['runningMate'] if c.get('runningMate') else '')+(' — '+c['partyLabel'] if c['partyLabel'] else ''))
            lead=self.candidate(cid,c['name'],c['partyLabel'],cprov);self.ballot['candidacies'].append(lead)
            if c.get('runningMate'):
                mate={**self.candidate(cid,c['runningMate'],c['partyLabel'],cprov),'office':'Lieutenant Governor'}
                self.ballot['candidateTickets'].append({'id':lead['id']+'-ticket','leadCandidacyId':lead['id'],'runningMate':mate,'provenance':cprov})
        return cid
    def member(self,member,district,meta,quote):
        assert member in registry and district in registry,(member,district)
        ident=self.st.lower()+'-ba01-'+slug(member.removeprefix(self.base))+'-to-'+slug(district.removeprefix(self.base))
        self.ballot['districtMemberships'].append({'id':ident,'memberOcdId':member,'districtOcdId':district,'provenance':provenance(meta,self.org,quote)})
    def save(self):
        dest=ROOT/'data/ballot/2026-general'/f'{self.st.lower()}.json'
        if dest.exists():
            previous=json.loads(dest.read_text());old=previous['ballots'][self.st+':'+self.eid]
            # A replay preserves any facts added by other authorized work.
            for field in ['contests','candidacies','measures','absences','districtMemberships','candidateTickets']:
                have={row.get('id',row.get('ocdId')) for row in self.ballot[field]}
                self.ballot[field].extend(row for row in old.get(field,[]) if row.get('id',row.get('ocdId')) not in have)
            self.ballot['coverageNotes'].extend(n for n in old.get('coverageNotes',[]) if n not in self.ballot['coverageNotes'])
            for row in previous['sourceReceipt']['sources']:self.sources.setdefault((row['finalUrl'],row['rawHash'],row['retrievedAt']),row)
        data={'kind':'ballot-contests','ballots':{self.st+':'+self.eid:self.ballot},'sourceReceipt':{'contractVersion':1,'reviewedAt':max(row['retrievedAt'] for row in self.sources.values()),'reviewedBy':'Codex BA-01 official territorial lists and specimens','sources':list(self.sources.values())}}
        dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
        return {'state':self.st,'contests':len(self.ballot['contests']),'candidateChoices':len(self.ballot['candidacies']),'runningMates':len(self.ballot['candidateTickets']),'people':len(self.ballot['candidacies'])+len(self.ballot['candidateTickets']),'memberships':len(self.ballot['districtMemberships'])}


reports=[]
as_package=Package('AS','American Samoa Election Office')
as_meta=as_package.source('as-candidates.html',evidence='The Commissioner of Elections expressly certifies every listed candidate for the Midterm Election scheduled November 3, 2026. The saved HTML parser checks six congressional delegate names, all 17 numbered House districts and all 38 House names. No party labels or vote limits are printed; those fields remain null uniformly.')
for n,r in enumerate(rosters['AS']):
    district=None if n==0 else re.search(r'/sldl:(\d+)$',r['ocdId'])[1]
    as_package.race('delegate' if district is None else 'house-'+district,r['office'],r['ocdId'],r['candidates'],as_meta)
as_package.ballot['coverageNotes'].append('The Election Office certified list verifies the delegate and all 17 numbered House contests. We are working on official sample ballots, ballot questions and voting instructions.')
reports.append(as_package.save())

mp_package=Package('MP','Commonwealth Election Commission of the Northern Mariana Islands')
mp_cert=mp_package.source('mp-candidates.html')
mp_meta=mp_package.source('mp-sample.pdf',evidence='Every certified candidate is compared to an exact row in all 13 official November 3, 2026 specimen fronts by scripts/ba01-south-mp-samples.py. All 77 people, every printed party label, 22 unique rosters and every printed vote limit agree. Governor tickets are paired explicitly by both certification and printed specimen. Precinct 4D has Northern Islands mayor and shares the third-district council and education races; no widening of its separate mayor electorate.')
# FEC is a saved federal government source identifying this exact .gov.mp publisher.
fec_text=subprocess.run(['pdftotext','-layout',str(EVIDENCE/'mp-fec-directory.pdf'),'-'],check=True,capture_output=True).stdout.decode()
assert fec_text==(EVIDENCE/'mp-fec-directory.txt').read_text()
assert re.search(r'COMMONWEALTH ELECTION COMMISSION.*?Commonwealth of the Northern Mariana Islands.*?https://www.votecnmi.gov.mp',fec_text,re.S)
if (EVIDENCE/'mp-fec-directory.pdf').exists():
    mp_package.source('mp-fec-directory.pdf',org='Federal Election Commission',kind='OFFICIAL_PUBLISHER',evidence='Current FEC Combined Federal/State Disclosure and Election Directory expressly identifies the Commonwealth Election Commission and its URL https://www.votecnmi.gov.mp. This source establishes the .gov.mp publisher; candidate facts come from its current captured certified list and specimen.')
for r in rosters['MP']:
    office,area=r['office'],r['area'];scope=next(x for x in mp['officeScopes'] if x['office']==office and x['area']==area)
    if office=='Governor & Lieutenant Governor':suffix='governor';ocd=mp_package.base
    elif office=='Delegate to the U.S. House of Representatives':suffix='delegate';ocd=mp_package.base
    elif office=='Justice':suffix='justice-alexandro-cruz-castro-retention';ocd=mp_package.base
    elif office=='Attorney General':suffix='attorney-general';ocd=mp_package.base
    elif re.match(r'^\d[a-z]+ Senatorial District$',office):
        district=re.match(r'^(\d)',office)[1];suffix='senate-'+district;ocd=mp_package.base+'/sldu:'+district
    elif re.fullmatch(r'District [1-7]',office):
        district=office.rsplit(' ',1)[1];suffix='house-'+district;ocd=mp_package.base+'/sldl:'+district
    elif office.startswith('Mayor'):
        if area=='Northern Islands':continue # Exact official electorate has no canonical registry division.
        suffix='mayor-'+slug(area)
        ocd=mp_package.base+('/county:saipan' if area=='Saipan' else '/municipality:rota' if area=='Rota' else '/municipality:tinian')
    elif office.startswith('Municipal Council'):
        district=re.search(r'(\d)[a-z]+ Senatorial',office)[1];suffix='municipal-council-'+district;ocd=mp_package.base+'/sldu:'+district
    elif office.startswith('Board of Education'):suffix='board-of-education-3';ocd=mp_package.base+'/sldu:3'
    else:raise AssertionError(r)
    title=office+(' — '+area if area and not office.startswith(('Governor','Mayor')) else ' — '+area if office.startswith('Mayor') else '')
    if office.startswith('District '):title='House of Representatives, '+office
    if r['retention']:title='Justice Alexandro Cruz Castro, Retention'
    mp_package.race(suffix,title,ocd,r['candidates'],mp_meta,vote=1 if r['retention'] else scope['voteFor'],retention=r['retention'],candidate_meta=mp_cert)
for house,senate in [(1,3),(2,3),(3,3),(4,3),(5,3),(6,2),(7,1)]:
    precincts=[x for x in mp['samplePrecincts'] if x['precinct'][0]==str(house)]
    assert precincts and all(any(r['office'].startswith(str(senate)) and 'Senatorial' in r['office'] for r in x['races']) for x in precincts)
    mp_package.member(mp_package.base+'/sldl:'+str(house),mp_package.base+'/sldu:'+str(senate),mp_meta,'Every official specimen front for House District '+str(house)+' (precincts '+', '.join(x['precinct'] for x in precincts)+') prints the '+str(senate)+' Senatorial District roster. All 13 current specimen fronts were checked.')
for house,local in [(1,'county:saipan'),(2,'county:saipan'),(3,'county:saipan'),(5,'county:saipan'),(6,'municipality:tinian'),(7,'municipality:rota')]:
    precincts=[x for x in mp['samplePrecincts'] if x['precinct'][0]==str(house)]
    expected='Saipan' if house in [1,2,3,5] else 'Tinian & Aguiguan' if house==6 else 'Rota'
    assert all(any(r['office'].startswith('Mayor') and r['area']==expected for r in x['races']) for x in precincts)
    mp_package.member(mp_package.base+'/sldl:'+str(house),mp_package.base+'/'+local,mp_meta,'Every official specimen front for House District '+str(house)+' (precincts '+', '.join(x['precinct'] for x in precincts)+') prints the mayor of '+expected+'. House District 4 is split and is not mapped as a whole to either mayor electorate.')
mp_package.ballot['coverageNotes'].append('The certified list and all 13 specimen fronts were compared for every candidate. Northern Islands mayor has two verified candidates on Precinct 4D; we are working on its exact electoral division. All other 21 contests are held, including explicit governor tickets and justice retention.')
reports.append(mp_package.save())

vi_package=Package('VI','Election System of the Virgin Islands')
for name in ['vi-stx-certified.pdf','vi-stt-stj-certified.pdf']:vi_package.source(name)
vi_metas={region:vi_package.source(name) for region,name in [('St. Croix','vi-stx-sample.pdf'),('St. Thomas/St. John','vi-stt-stj-sample.pdf')]}
board_raw,board_meta=capture('vi-board.html')
board_text=' '.join(re.sub('<[^>]+>',' ',board_raw.decode()).split())
quote='The Board consists of fourteen members; seven from each district, who are elected by the electors of each election district beginning with the 2018 general election.'
assert quote in board_text
vi_package.source('vi-board.html',evidence=quote+' Both St. John and St. Thomas seat groups are also printed on the one current official combined-district sample. They are not island-only electorates.')
for r in vi['races']:
    office,region=r['office'],r['scope'];meta=vi_metas['St. Croix' if region=='Virgin Islands' else region]
    district='st_croix' if region=='St. Croix' else 'st_thomas-st_john'
    if office=='DELEGATE TO THE HOUSE OF REPRESENTATIVES':suffix='delegate';ocd=vi_package.base;title='Delegate to the U.S. House of Representatives'
    elif office=='GOVERNOR & LIEUTENANT GOVERNOR':suffix='governor';ocd=vi_package.base;title='Governor & Lieutenant Governor'
    elif office=='LEGISLATURE OF THE VIRGIN ISLANDS AT LARGE':suffix='senate-at-large';ocd=vi_package.base;title='Legislature of the Virgin Islands, At Large'
    elif office=='LEGISLATURE OF THE VIRGIN ISLANDS':suffix='senate-'+district;ocd=vi_package.base+'/sldu:'+district;title='Legislature of the Virgin Islands — '+region
    elif office=='BOARD OF EDUCATION':suffix='board-of-education-'+district;ocd=vi_package.base+'/board_of_education:'+district;title='Board of Education — '+region
    elif office.startswith('BOARD OF ELECTIONS'):
        group='st_john' if office.endswith('STJ') else 'st_thomas' if office.endswith('STT') else 'st_croix'
        suffix='board-of-elections-'+group;ocd=vi_package.base+'/board_of_elections:'+district;title='Board of Elections — '+group.replace('_',' ').title()
    else:raise AssertionError(r)
    names=[]
    for c in r['candidates']:
        candidate=dict(c)
        if office=='GOVERNOR & LIEUTENANT GOVERNOR':candidate['name'],candidate['runningMate']=candidate['name'].split(' / ',1)
        names.append(candidate)
    vi_package.race(suffix,title,ocd,names,meta,vote=r['voteFor'])
for region,district in [('St. Croix','st_croix'),('St. Thomas/St. John','st_thomas-st_john')]:
    meta=vi_metas[region]
    for board in ['board_of_education','board_of_elections']:
        vi_package.member(vi_package.base+'/sldu:'+district,vi_package.base+'/'+board+':'+district,board_meta if board=='board_of_elections' else meta,(quote+' ' if board=='board_of_elections' else '')+'The official '+region+' district sample prints the district Legislature and '+board.replace('_',' ')+' races on the same ballot. '+('Both STJ and STT seat groups are printed together on the combined district ballot.' if region=='St. Thomas/St. John' and board=='board_of_elections' else ''))
vi_package.ballot['coverageNotes'].append('Both official district sample ballots and all 70 certified candidate choices were compared. The St. Croix sample has 6 contests and 42 choices; St. Thomas/St. John has 7 contests and 37 choices. Every governor running mate is preserved as an explicit joint ticket. No ballot question appears on either captured two-page sample.')
reports.append(vi_package.save())
(EVIDENCE/'import-comparison.json').write_text(json.dumps(reports,indent=2)+'\n')
# Refresh the source comparison with the imported package counts.
runpy.run_path(str(ROOT/'scripts/ba01-south-territory-sources.py'))
print('TERRITORY_IMPORT='+json.dumps(reports))
