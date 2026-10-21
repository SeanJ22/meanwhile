"""Replay official Ohio local candidate lists against current sample ballots.

The preserved original PDF responses include each publisher's bytes (including
Cuyahoga zero padding and the TGSI website's appended HTML). Named printed choices
are checked against actual November 3 samples; certified write-in choices come
from explicit eligible filings. Board-removed filings never become candidates.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
BASE='ocd-division/country:us/state:oh'
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
COUNTIES=['cuyahoga','hamilton','summit','montgomery']

def clean(s):return re.sub(r'\s+',' ',s).strip()
def slug(s):return re.sub('[^a-z0-9]+','-',s.lower()).strip('-')
def raw(stem):return gzip.decompress((EVIDENCE/(stem+'.raw.gz')).read_bytes())
def meta(stem):return json.loads((EVIDENCE/(stem+'.retrieval.json')).read_text())

def receipt(data,stem,publisher,source_class='ELECTION_AUTHORITY'):
    info=meta(stem);assert info['httpStatus']==200 and info['rawHash']==hashlib.sha256(raw(stem)).hexdigest(),stem
    if not any(x['finalUrl']==info['finalUrl'] and x['rawHash']==info['rawHash'] for x in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append({'requestedUrl':info['requestedUrl'],'finalUrl':info['finalUrl'],'httpStatus':200,'retrievedAt':info['retrievedAt'],'rawHash':info['rawHash'],'publisher':publisher,'sourceClass':source_class,
            'reviewedEvidence':f'Original public response bytes retained at data/ballot/evidence/ba01-great-lakes/{stem}.raw.gz. Hash identifies decompressed bytes. Replay parses each distinct office/term and all eligible candidates; sample PDFs confirm printed names, and explicit certified write-in rows supply unprinted eligible choices. County-to-appeals-district membership follows current ORC2501.01.'})
    return {'sourceUrl':info['finalUrl'],'sourceOrg':publisher,'collectedAt':info['retrievedAt'],'verifiedAt':NOW}


def parse_sources(p):
    r=[];excluded=[]

    def add(county,office,term,names,scope=None,vote=1):
     assert names and len(set(n for n,party,wi in names))==len(names),(county,office,term,names)
     paper_stems=['oh-county-sample-'+county]+[stem for stem in ['oh-county-sample-cuyahoga-part2' if county=='cuyahoga' else 'oh-county-sample-montgomery-new-lebanon' if county=='montgomery' else ''] if stem and (p/(stem+'.txt')).exists()]
     sample_stem=next((stem for stem in paper_stems if all(wi or clean(n).casefold() in clean((p/(stem+'.txt')).read_text()).casefold() for n,party,wi in names)),paper_stems[0])
     paper=clean((p/(sample_stem+'.txt')).read_text()).casefold()
     missing=[n for n,party,wi in names if not wi and clean(n).casefold() not in paper]
     r.append({'county':county,'office':office,'term':term,'candidates':[{'name':n,'party':party,'writeIn':wi} for n,party,wi in names],'scope':scope or 'county:'+county,'voteFor':vote,'sampleStem':sample_stem,'unconfirmedPrintedNames':missing})
    # Current Cuyahoga filing list contains explicit eligibility, not merely omissions.
    s=(p/'oh-county-next-cuyahoga.txt').read_text();matches=list(re.finditer(r'^For ',s,re.M))
    for i,m in enumerate(matches):
     b=s[m.start():matches[i+1].start() if i+1<len(matches) else len(s)];office=b.splitlines()[0].split('  ')[0].strip()
     if office not in ['For County Executive','For Member of County Council','For Judge of the Court of Appeals','For Judge of the Court of Common Pleas']:continue
     header=b[:b.index('Candidate Name')];rows=[]
     for row in re.finditer(r'^\s+(.+?)\s{2,}(Democratic|Republican|Nonpartisan|Libertarian)\s*\|([^\n]*)',b,re.M):
      name,party,details=row.groups()
      if 'Removed by Board action' in details:excluded.append({'county':'cuyahoga','name':name,'reason':'Removed by Board action','sourceRow':row.group().strip()});continue
      assert 'Yes | Sí' in details or 'Yes - Write-In' in details,(name,details)
      rows.append((name,party,'Write-In' in details))
     term=re.search(r'^\((Full Term Commencing [\d/]+|Unexpired Term Ending [\d/]+)\)',header,re.M);term=term.group(1) if term else ''
     scope=None
     if office.endswith('County Council'):
      district=re.search(r'^\(District (\d+)\)',header,re.M).group(1);office+=' (District '+district+')';scope='county:cuyahoga/council_district:'+district
     elif office.endswith('Court of Appeals'):office+=' (8th District)';scope='court_of_appeals:8'
     elif office.endswith('Common Pleas'):office+=' '+re.search(r'^\((General Division|Domestic Relations Division|Probate Division)\)',header,re.M).group()
     add('cuyahoga',office,term,rows,scope)
    # Hamilton numbered capture preserves PDF row/cell reading order; original fresh PDF
    # independently confirms each candidate name and same-row term/party.
    lines=re.findall(r'^L\d+(?:@P\d+(?:-\d+)?)?: (.*)$',(EVIDENCE/'oh-hamilton.web.txt').read_text(),re.M)
    g=defaultdict(list);raw=clean((p/'oh-county-next-hamilton.txt').read_text())
    for i,line in enumerate(lines):
     match=re.fullmatch(r'(.+?) Judge, Court of (Common|Appeals)',line)
     if match:
      name,kind=match.groups();tail=lines[i+1];m=re.match(r'(Pleas, (?:General Division|Drug Court Divison|Probate Division|Juvenile Division|Domestic Relations)|1st District) (UTE \d+/\d+/\d+|\d+/\d+/\d+) (Democratic|Republican)',tail);assert m,(name,tail)
      office,term,party=m.groups();office='Judge, Court of '+('Common '+office if kind=='Common' else 'Appeals '+office);scope='court_of_appeals:1' if kind=='Appeals' else 'county:hamilton';assert re.search(re.escape(name)+r'\s+'+re.escape(term)+r'\s+'+party,raw),(name,term,party)
      g[(office,term,scope)].append((name,party,False))
     else:
      m=re.match(r'(.+?) (County Commissioner|County Auditor) (\d+/\d+/\d+) (Democratic|Republican|Write-in)',line)
      if m:
       name,office,term,party=m.groups();wi=party=='Write-in';name=name.removesuffix(' (WI)');assert name in raw
       g[(office,term,'county:hamilton')].append((name,None if wi else party,wi))
    for (office,term,scope),rows in g.items():add('hamilton',office,term,rows,scope)
    # Summit candidate report uses explicit vote/term headers and party abbreviations.
    s=(p/'oh-county-next-summit.txt').read_text();lines=s.splitlines();g={};current=None
    for i,line in enumerate(lines):
     office=line.strip()
     if office not in ['SUMMIT COUNTY COUNCIL-AT-LARGE','COMMON PLEAS COURT JUDGE','JUVENILE COURT JUDGE','DOMESTIC RELATIONS JUDGE','PROBATE COURT JUDGE','9TH DISTRICT COURT OF APPEALS JUDGE']:continue
     j=i+1
     while not lines[j].strip():j+=1
     m=re.match(r'VOTE FOR NO MORE THAN (\d+) (?:- TERM COMM (\d+/\d+/\d+)|UNEXPIRED TERM TO END (\d+/\d+/\d+))',clean(lines[j]));assert m,(office,lines[j]);vote,date,ute=m.groups();term=('Unexpired term ending '+ute) if ute else 'Term commencing '+date;j+=1;rows=[]
     while j<len(lines):
      l=lines[j].strip()
      if l and any(x in l for x in ['SUMMIT COUNTY','SUBJECT TO','VOTE FOR','COURT JUDGE','JUDGE','COUNTY COUNCIL','CONGRESSIONAL','DOMESTIC RELATIONS']):break
      if l and not re.match(r'^[\d:/ ]+$',l):
       m=re.match(r'(.+?)\s+\(([DR])\)\s',l)
       if m:rows.append((m.group(1),{'D':'Democratic','R':'Republican'}[m.group(2)],False))
       elif 'ADDRESS ON FILE' in l:rows.append((l.split('ADDRESS ON FILE')[0].strip(),None,False))
       elif re.search(r'\s\d+ ',l):rows.append((re.split(r'\s\d+ ',l,maxsplit=1)[0].strip(),None,False))
       else:break
      j+=1
     scope='court_of_appeals:9' if office.startswith('9TH') else None
     add('summit',office,term,rows,scope,int(vote))
    # Montgomery row headers enumerate distinct term-specific contests.
    s=(p/'oh-county-next-montgomery.txt').read_text();matches=list(re.finditer(r'^(Judge of the Court of Appeals-.*|Judge of the Court of Common Pleas.*|County Commissioner.*|County Auditor.*|New Lebanon Council.*)$',s,re.M))
    for i,m in enumerate(matches):
     header=m.group(1);end=matches[i+1].start() if i+1<len(matches) else len(s);block=s[m.end():end];rows=[]
     for line in block.splitlines():
      if re.search(r'\d+/\d+/2026\s+11/3/2026\s*$',line):
       columns=re.split(r'\s{2,}',line.strip());party=columns[0] if columns[0] in ['DEM','REP','LIB'] else None;name=columns[1] if party else columns[0];assert name and not name.startswith('The information'),columns
       rows.append((name,{'DEM':'Democratic','REP':'Republican','LIB':'Libertarian'}.get(party),False))
     if not rows:continue
     scope='court_of_appeals:2' if header.startswith('Judge of the Court of Appeals') else 'place:new_lebanon' if header.startswith('New Lebanon') else None
     add('montgomery',header,'',rows,scope)
    return r,excluded

def main(write=False):
    path=ROOT/'data/ballot/2026-general/oh.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=copy.deepcopy(ballot)
    with tempfile.TemporaryDirectory(prefix='ba01-oh-locals-') as directory:
        p=Path(directory)
        for county in COUNTIES:
            for stem in ['oh-county-next-'+county,'oh-county-sample-'+county]:
                pdf=p/(stem+'.raw');pdf.write_bytes(raw(stem));subprocess.run(['pdftotext','-layout',str(pdf),str(p/(stem+'.txt'))],check=True,capture_output=True)
                if stem.startswith('oh-county-sample-'):
                    sample=clean((p/(stem+'.txt')).read_text());assert '2026' in sample and ('November 3' in sample or 'NOVEMBER 3' in sample),(county,stem)
        for stem in ['oh-county-sample-cuyahoga-part2','oh-county-sample-montgomery-new-lebanon']:
            if (EVIDENCE/(stem+'.raw.gz')).exists():
                pdf=p/(stem+'.raw');pdf.write_bytes(raw(stem));subprocess.run(['pdftotext','-layout',str(pdf),str(p/(stem+'.txt'))],check=True,capture_output=True)
        # A line wrap in the middle paper column interleaves another column under
        # ordinary layout extraction; the column-specific extraction is exact.
        extra=subprocess.run(['pdftotext','-f','1','-l','4','-x','210','-y','0','-W','195','-H','1008','-layout',str(p/'oh-county-sample-hamilton.raw'),'-'],check=True,capture_output=True,text=True).stdout
        with (p/'oh-county-sample-hamilton.txt').open('a') as stream:stream.write('\n'+extra)
        rows,excluded=parse_sources(p)
    expected={'cuyahoga':(25,35),'hamilton':(17,28),'summit':(12,27),'montgomery':(11,19)}
    for county,(races,candidates) in expected.items():
        selected=[x for x in rows if x['county']==county];assert len(selected)==races and sum(len(x['candidates']) for x in selected)==candidates,(county,selected)
    added=[];remaining=[]
    for row in rows:
        if row['unconfirmedPrintedNames']:
            remaining.append(row);continue
        county=row['county'];publisher=county.title()+' County Board of Elections';cp=receipt(data,'oh-county-next-'+county,publisher);sp=receipt(data,row['sampleStem'],publisher)
        title=('Ohio Court of Appeals — ' if row['scope'].startswith('court_of_appeals:') else county.title()+' County — ')+row['office']+(' ('+row['term']+')' if row['term'] else '');division=BASE+'/'+row['scope']
        found=[x for x in ballot['contests'] if x['title']==title and x['ocdId']==division];assert len(found)<=1
        cid=found[0]['id'] if found else 'oh-ba01-'+slug(title)
        if not found:ballot['contests'].append({'id':cid,'electionId':ballot['election']['id'],'ocdId':division,'divisionVintage':'2026','title':title,'type':'CANDIDACY','candidateListComplete':True,'voteFor':row['voteFor'],'termYears':None,'scopeNote':None,
            'provenance':{**sp,'quote':row['office']+(' | '+row['term'] if row['term'] else '')}})
        for candidate in row['candidates']:
            name=candidate['name'];found=[c for c in ballot['candidacies'] if c['contestId']==cid and clean(c['givenName']+' '+c['familyName'])==name]
            if found:assert len(found)==1 and found[0]['partyLabel']==candidate['party'];continue
            ballot['candidacies'].append({'id':cid+'-candidate-'+slug(name),'contestId':cid,'givenName':'','familyName':name,'partyLabel':candidate['party'],'slogan':None,'incumbent':None,'websiteUrl':None,
                'provenance':{**cp,'quote':row['office']+' | '+name+' | '+(candidate['party'] or ('Write-in candidate' if candidate['writeIn'] else 'party not printed'))}})
        added.append({'county':county,'office':row['office'],'term':row['term'],'candidates':len(row['candidates']),'contestId':cid})
    from lxml import html
    statute=clean(html.fromstring(raw('oh-appellate-current-law')).text_content());assert 'The state shall be divided into twelve judicial court of appeals districts.' in statute
    groups=re.findall(r'\([A-L]\) (\w+) district: ([^;.]+)[;.]',statute);assert len(groups)==12,groups
    prov=receipt(data,'oh-appellate-current-law','Ohio General Assembly','OFFICIAL_PUBLISHER');memberships=ballot.setdefault('districtMemberships',[]);counties=[]
    for number,(word,names) in enumerate(groups,1):
        for county in names.replace(', and ',', ').replace(' and ',', ').split(', '):
            counties.append(county);item={'id':f'oh-ba01-{slug(county)}-appeals-district-{number}','memberOcdId':BASE+'/county:'+county.lower().replace(' ','_'),'districtOcdId':BASE+'/court_of_appeals:'+str(number),'provenance':{**prov,'quote':word+' district: '+names}}
            if not any(x['id']==item['id'] for x in memberships):memberships.append(item)
    assert len(counties)==88 and len(set(counties))==88
    for kind in ['contests','candidacies','measures','absences']:
        for old in before[kind]:assert next(x for x in ballot[kind] if x['id']==old['id'])==old,(kind,old['id'])
    note='BA-01: Official sample ballots and certified lists add local Cuyahoga, Hamilton, Summit and Montgomery contests. Current Ohio Revised Code2501.01 establishes county membership in appellate districts. Remaining county, city, school, special-district and precinct-local measure coverage and full43215 paper/live verification remain open.'
    if note not in ballot.setdefault('coverageNotes',[]):ballot['coverageNotes'].append(note)
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'OH','before':[len(before['contests']),len(before['candidacies'])],'after':[len(ballot['contests']),len(ballot['candidacies'])],'verifiedLocalContests':len(added),'verifiedLocalCandidates':sum(x['candidates'] for x in added),'countyToAppealsMemberships':88,'contests':added,'explicitExcludedFilings':excluded,'remainingSampleNameChecks':remaining,'liveVerified':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--write',action='store_true');args=parser.parse_args();print(json.dumps(main(args.write),indent=2))
