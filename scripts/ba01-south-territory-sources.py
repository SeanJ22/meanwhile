"""Recount captured official territorial lists; acquisition only, no repo imports."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import html
import json
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
HERE=Path(__file__).resolve().parents[1]/'data/ballot/evidence/ba01-south/territories'


def capture(name):
    raw=(HERE/name).read_bytes();meta=json.loads((HERE/(name+'.source.json')).read_text())
    assert meta['httpStatus']==200 and hashlib.sha256(raw).hexdigest()==meta['sha256'],name
    return raw,meta


class Text(HTMLParser):
    def __init__(self):super().__init__();self.skip=0;self.parts=[]
    def handle_starttag(self,t,a):
        if t in ['script','style']:self.skip+=1
    def handle_endtag(self,t):
        if t in ['script','style']:self.skip-=1
        if t in ['div','p','h1','h2','h3','h4','li','tr']:self.parts.append('\n')
    def handle_data(self,d):
        if not self.skip:self.parts.append(d)
    def output(self):return '\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip())


def clean(value):return ' '.join(html.unescape(re.sub('<[^>]+>',' ',value)).split())

def plain(raw):
    p=Text();p.feed(raw.decode());return p.output()


def held(st):
    p=ROOT/f'data/ballot/2026-general/{st.lower()}.json'
    if not p.exists():return {'fileExists':False,'contests':0,'candidacies':0}
    data=json.loads(p.read_text());ballot=next(iter(data['ballots'].values()))
    return {'fileExists':True,'contests':len(ballot['contests']),'candidacies':len(ballot['candidacies'])}


# Recreate each text extraction from the exact captured PDF bytes, never trust
# a detached text file as proof for candidate facts.
for pdf,output,mode in [('mp-sample.pdf','mp-sample.txt','-layout'),('gu-sample-download','gu-sample-raw.txt','-raw'),('vi-stx-certified.pdf','vi-stx-certified.txt','-layout'),('vi-stt-stj-certified.pdf','vi-stt-stj-certified.txt','-layout'),('vi-stx-sample.pdf','vi-stx-sample.txt','-layout'),('vi-stt-stj-sample.pdf','vi-stt-stj-sample.txt','-layout'),('pr-rfp-2028.pdf','pr-rfp-2028.txt','-layout')]:
    raw,metadata=capture(pdf)
    derived=subprocess.run(['pdftotext',mode,str(HERE/pdf),'-'],check=True,capture_output=True).stdout.decode()
    assert derived==(HERE/output).read_text(),output

reports=[];rosters={}
# AS: no party labels are printed; do not infer from endorsements or the FEC.
raw,meta=capture('as-candidates.html');text=plain(raw)
statement='The Commissioner of Elections has certified the following candidates for the Midterm Election scheduled for November 3, 2026.'
assert statement in text
text=text.split(statement,1)[1].split('American Samoa Election Office',1)[0]
delegate,house=text.split('HOUSE OF REPRESENTATIVES',1)
delegate=[line for line in delegate.splitlines() if line.strip() and line!='DELEGATE TO THE UNITED STATES CONGRESS']
assert len(delegate)==6
races=[{'office':'Delegate to the United States Congress','ocdId':'ocd-division/country:us/territory:as','candidates':[{'name':name,'partyLabel':None} for name in delegate]}]
for match in re.finditer(r'Representative District #\s*(\d+)\s*–\s*([^\n]+)\n(.*?)(?=Representative District #|\Z)',house,re.S):
    number,area,body=match.groups();names=[line for line in body.splitlines() if line.strip()]
    races.append({'office':f'House of Representatives, District {number} – {area}','ocdId':f'ocd-division/country:us/territory:as/sldl:{number}','candidates':[{'name':name,'partyLabel':None} for name in names]})
assert len(races)==18 and sum(len(row['candidates']) for row in races)==44
assert {int(row['ocdId'].rsplit(':',1)[1]) for row in races[1:]}==set(range(1,18))
rosters['AS']=races
reports.append({'territory':'AS','electionDate':'2026-11-03','officialCandidateContests':18,'candidateUnits':44,'people':44,'federalCandidates':races[0]['candidates'],'held':held('AS'),'sources':[meta],'limits':['Certified list captured; official sample ballot not yet acquired.','Party labels and vote limits are not stated in the captured certified list; do not infer them.','Swains Island selection and Senate selection are not added as invented popular contests.']})

# MP: the certified list explicitly counts each governor ticket as one unit.
raw,meta=capture('mp-candidates.html');sample,sample_meta=capture('mp-sample.pdf');text=raw.decode();sample_text=(HERE/'mp-sample.txt').read_text()
assert 'Election Day: <strong>November 3, 2026</strong>' in text
assert '<strong>74</strong> candidates' in text
races=[]
for block in re.split(r'<div class="office"[^>]*data-office="',text)[1:]:
    office,block=block.split('"',1)
    head=re.search(r'<h3>(.*?)</h3>',block,re.S);sub=re.search(r'<p class="office-sub">(.*?)</p>',block,re.S)
    label=clean(head[1]);area=clean(sub[1]) if sub else None
    candidates=[]
    if office=='Governor / Lt. Gov':
        for ticket in re.split(r'<div class="ticket" ',block)[1:]:
            party=html.unescape(re.search(r'data-party="([^"]+)"',ticket)[1])
            names=[clean(name) for name in re.findall(r'<span class="ticket-name">(.*?)</span>',ticket,re.S)]
            assert len(names)==2
            candidates.append({'name':names[0],'runningMate':names[1],'partyLabel':party})
    else:
        for match in re.finditer(r'<li class="roster-row"[^>]*data-party="([^"]+)"[^>]*>(.*?)</li>',block,re.S):
            name=clean(re.search(r'<span class="roster-name">(.*?)</span>',match[2],re.S)[1])
            candidates.append({'name':name,'partyLabel':html.unescape(match[1])})
    assert candidates,(office,area)
    races.append({'office':label,'area':area,'candidates':candidates,'retention':office=='Justice'})
assert len(races)==22 and sum(len(r['candidates']) for r in races)==74
assert sum(1+bool(c.get('runningMate')) for r in races for c in r['candidates'])==77
federal=next(r for r in races if r['office']=='Delegate to the U.S. House of Representatives')
assert len(federal['candidates'])==2
assert 'KING-HINDS, Kimberlyn Kay' in sample_text and 'DELEON GUERRERO, Galvin' in sample_text
assert len(re.findall(r'Precinct No\.',sample_text))==13
rosters['MP']=races
reports.append({'territory':'MP','electionDate':'2026-11-03','officialCandidateContests':22,'candidateUnits':74,'people':77,'federalCandidates':federal['candidates'],'held':held('MP'),'sources':[meta,sample_meta],'limits':['Governor has three joint tickets: 74 candidate units are 77 people including running mates.','Thirteen specimen precinct fronts plus blank specimen back captured; measure questions do not appear in this pack.','Every one of the 77 certified people and every printed party label matches the 13 sample fronts in mp-sample-comparison.json. Northern Islands has no canonical municipality ID in the captured registry. Precinct 4D uses its mayor while sharing the third-senatorial-district council and education contests.']})

# GU: acquire the actual sample bytes, recording the precise publisher-proof limit.
raw,download_meta=capture('gu-sample-download');view,view_meta=capture('gu-sample-drive.html')
assert raw.startswith(b'%PDF-')
assert b'"docs-doddn":"Guam Election Commission"' in view and b'roy.park@gec.guam.gov' in view
text=(HERE/'gu-sample-raw.txt').read_text();assert 'Guam November 3, 2026' in text
pages=text.split('\f');first=pages[0];second=pages[1]
republicans=['DUENAS, Christopher M.','SAVARES, Jonathan James','TAITAGUE, Telo Teresa','BORJA, Louisa Jean','CALVO, Gregorio Salas','GUMATAOTAO, Eulogio S.','BORJA, Vincent Anthony Velasco','CALVO, Shelly Vargas','NGUYEN, Hoa Van','CASTRO, William Mendiola','LUJAN, Jesse Michael A.','MATANANE, Sabrina Salas','MORTERA, Matteo Thomas','SGAMBELLURI, Raffaele M.','ARRIOLA, Joseph B.D.']
democrats=['QUINATA, Donna Rita Muna','BORDALLO, Fred E. Jr.','NELSON, Telena Monique Cruz','TAITAGUE, Joaquin Manuel Paulino','PARKINSON, William Mark Alkonga','CRUZ, Joaquin Alan','PEREZ, Kallen Marie E.','TAIJERON, Anthony W.','QUINATA, Roy Anthony Benavente','SABLAN, Angel Anthony R.','SHELTON, Amanda L.','SANTOS, Angela Therese A.M.','BARNETT, Darrel Christopher','NEDEDOG, Sarah Mattie T.','RIDGELL, Clynton E.']
assert all(name in first for name in republicans+democrats)
attorney=['TYDINGCO, Phillip James','PAULUHN, Jordan Lawrence Evangelista','FISHER, Thomas Joseph','SANTOS, Peter John','MOYLAN, Douglas B.']
utilities=['LIMTIACO, Michael Troy','SANCHEZ, Simon A.','PEREZ, Kenneth Robert','SANTOS, Francis Edward Borja','ADONAY, Roy Salvador Agudon']
education=['TAITANO II, John R.','AYUYU, Ronald Anthony','AGUON, Isaiah John','MC NINCH, Ronald Lewis Jr.']
assert all(name in second for name in attorney+utilities+education)
races=[{'office':'Governor & Lieutenant Governor of Guam','voteFor':1,'candidates':[{'name':'ADA, Vicente A.','runningMate':'CALVO, Edward John','partyLabel':'REPUBLICAN'},{'name':'TERLAJE, Therese Maria','runningMate':'PEREZ, Sabina Eileen','partyLabel':'DEMOCRAT'}]},
{'office':'Non-Voting Delegate to the U.S. House of Representatives','voteFor':1,'candidates':[{'name':'MOYLAN, James Craig','partyLabel':'REPUBLICAN'},{'name':'LIMTIACO, Alicia Anne Garrido','partyLabel':'DEMOCRAT'}]},
{'office':'Guam Legislature','voteFor':15,'candidates':[{'name':name,'partyLabel':party} for party,names in [('REPUBLICAN',republicans),('DEMOCRAT',democrats)] for name in names]},
{'office':'Attorney General of Guam','voteFor':1,'candidates':[{'name':name,'partyLabel':None} for name in attorney]},
{'office':'Consolidated Commission on Utilities','voteFor':3,'candidates':[{'name':name,'partyLabel':None} for name in utilities]},
{'office':'Guam Education Board','voteFor':None,'candidates':[{'name':name,'partyLabel':None} for name in education]}]
assert len(races)==6 and sum(len(r['candidates']) for r in races)==48
rosters['GU']=races
reports.append({'territory':'GU','electionDate':'2026-11-03','officialCandidateContests':6,'candidateUnits':48,'people':50,'federalCandidates':races[1]['candidates'],'held':held('GU'),'sources':[download_meta,view_meta],'limits':['Actual public sample PDF captured; Google Drive metadata states organization Guam Election Commission and owner roy.park@gec.guam.gov. Direct GEC government pages currently return503; their backlink to this exact file is not yet captured. A third-party page was used solely to discover the file URL, never for candidate facts.','Three nonparty offices have no printed party labels. Education board vote limit is not printed; leave unknown pending official law/manual.','No measure or retention question appears on either captured sample page.']})

# VI official table rows include governor tickets, counted once in the publisher's list.
all_rows=[];metas=[]
for stem in ['vi-stx-certified','vi-stt-stj-certified']:
    raw,meta=capture(stem+'.pdf');metas.append(meta);text=(HERE/(stem+'.txt')).read_text();rows=[]
    for line in text.splitlines():
        match=re.match(r'^\s*(\d+)\s+(.+)',line)
        if not match or int(match[1])>38:continue
        rest=match[2]
        stop=re.search(r'\s+(?:P\.?\s?O\.?\s?(?:Box|\d)|\d)',rest,re.I)
        assert stop,(stem,line)
        name=rest[:stop.start()].strip()
        party_office=re.search(r'\s+(Independent|Democrat|Republican|ICM)\s+(.+?)\s+\d+-[A-Za-z]+-\d+',rest)
        assert party_office,(stem,line)
        party,office=party_office.groups();office=' '.join(office.split())
        rows.append({'number':int(match[1]),'name':name,'partyLabel':party,'office':office,'filingDistrict':'St. Croix' if stem=='vi-stx-certified' else 'St. Thomas/St. John'})
    assert len(rows)==(38 if stem=='vi-stx-certified' else 32)
    assert {r['number'] for r in rows}==set(range(1,len(rows)+1))
    all_rows.extend(rows)
assert len(all_rows)==70
federal=[r for r in all_rows if r['office']=='Delegate to Congress'];assert len(federal)==2
for stem in ['vi-stx-sample','vi-stt-stj-sample']:
    raw,meta=capture(stem+'.pdf');metas.append(meta);text=(HERE/(stem+'.txt')).read_text();assert 'NOVEMBER 3, 2026' in text
    assert all(name in text for name in ['Janelle K. Sarauw','Shelley A. H. Moorhead'])
rosters['VI']=all_rows
reports.append({'territory':'VI','electionDate':'2026-11-03','officialCandidateContests':10,'candidateUnits':70,'people':75,'federalCandidates':federal,'held':held('VI'),'sources':metas+[capture('vi-board.html')[1]],'sampleCounts':[{'district':'St. Croix','contests':6,'candidateUnits':42,'people':47},{'district':'St. Thomas/St. John','contests':7,'candidateUnits':37,'people':42}],'limits':['Both separately labelled St. John and St. Thomas Board of Elections seat groups appear together on the one official combined-district sample. Do not restrict their electorates using candidates’ home islands; the current official Board page confirms that seven members from each district are elected by that district’s electors. That exact whole-district statement and its receipt are held in vi-board.html.','Every one of the 70 candidate units and all printed parties compare with both certified tables in vi-sample-comparison.json. Five name variants are preserved explicitly; prefer the newer official sample value uniformly.','No measure question appears on either two-page district sample.']})

# PR: verify the explicit next regular election; do not manufacture a 2026 election.
raw,meta=capture('pr-rfp-2028.pdf');authority,authority_meta=capture('pr-authority.html')
assert b'https://www.ceepur.org/' in authority
text=(HERE/'pr-rfp-2028.txt').read_text();quote='Las próximas elecciones generales serán el 7 de noviembre de 2028.'
assert quote in ' '.join(text.split())
special,special_meta=capture('pr-special-catano.html');events,events_meta=capture('pr-events.html')
assert 'domingo, 27 de septiembre de 2026' in plain(special)
reports.append({'territory':'PR','regularGeneralElectionDate':'2028-11-07','verifiedStatement':quote,'held':held('PR'),'sources':[meta,authority_meta,special_meta,events_meta],'specialElection':{'municipality':'Cataño','date':'2026-09-27','officialStatement':'domingo, 27 de septiembre de 2026'},'limits':['Explicit next regular general date is verified from current official CEE2026RFP; do not create a Nov3,2026 general contest.','Official Cataño special-election page explicitly dates that event September 27, 2026. The current official events index lists it under 2026. No universal no-special-election statement for November 3 has been captured; keep that distinct from the verified regular-cycle date.','The linked CEEcalendar page is an unconfigured Telerik demo calendar and is not evidence of election absence.']})
(HERE/'verified-rosters.json').write_text(json.dumps(rosters,ensure_ascii=False,indent=2)+'\n')
(HERE/'comparison.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
for row in reports:print(json.dumps({key:value for key,value in row.items() if key!='sources'},ensure_ascii=False))
