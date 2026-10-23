"""Replay all eligible Michigan judicial rows with exact election districts.

The held SOS general-election report identifies every distinct office/term and
explicit DISQ/WITHD status. Current legislative sources establish whole-county
appeals/circuit memberships. District divisions remain separate electorates;
only unambiguous whole counties/cities are mapped to them.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from lxml import html

import runpy

capture_sha256 = runpy.run_path(str(Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
BASE='ocd-division/country:us/state:mi'
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def raw(stem):return gzip.decompress((EVIDENCE/(stem+'.raw.gz')).read_bytes())
def clean(value):return re.sub(r'\s+',' ',value).strip()
def slug(value):return re.sub('[^a-z0-9]+','_',value.lower()).strip('_')
def receipt(data,stem,publisher,source_class='OFFICIAL_PUBLISHER'):
    meta=json.loads((EVIDENCE/(stem+'.retrieval.json')).read_text())
    assert meta['httpStatus']==200 and meta['rawHash']==capture_sha256(raw(stem)),stem
    if not any(s['finalUrl']==meta['finalUrl'] and s['rawHash']==meta['rawHash'] for s in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append({**{k:meta[k] for k in ['requestedUrl','finalUrl','httpStatus','rawHash','retrievedAt']},'publisher':publisher,'sourceClass':source_class,
            'reviewedEvidence':f'Original public response bytes retained at data/ballot/evidence/ba01-great-lakes/{stem}.raw.gz. Source-bound replay identifies whole jurisdictions and preserves distinct election divisions; hash identifies decompressed bytes.'})
    return {'sourceUrl':meta['finalUrl'],'sourceOrg':publisher,'collectedAt':meta['retrievedAt'],'verifiedAt':NOW}

def roster():
    table=html.fromstring(gzip.decompress((EVIDENCE/'mi-1.html.gz').read_bytes())).xpath('//table[@class="jrPage"]')[0]
    groups=[];current=None;excluded=[]
    for tr in table.xpath('./tr'):
        cells=[clean(td.text_content()) for td in tr.xpath('./td')];cells=[c for c in cells if c]
        if len(cells)==1 and ' Position' in cells[0]:
            current={'title':cells[0],'rows':[]};groups.append(current)
        elif current and any(re.fullmatch(r'\d{2}/\d{2}/\d{4}',c) for c in cells):
            if cells[0] in ['DISQ','WITHD']:
                excluded.append({'office':current['title'],'name':cells[-3],'status':cells[0]});continue
            current['rows'].append({'name':cells[-3],'incumbent':True if cells[0]=='INCUMBENT' else None,'sourceCells':cells})
    judicial=[g for g in groups if 'Judge of ' in g['title']]
    assert len(groups)==338 and sum(len(g['rows']) for g in groups)==707
    assert len(judicial)==168 and sum(len(g['rows']) for g in judicial)==252
    assert all(g['rows'] for g in judicial)
    return judicial,excluded

def jurisdiction(title):
    if 'Judge of Probate Court' in title:
        county=title.split(' Judge of Probate Court')[0];assert county==county.upper()
        return BASE+'/county:'+slug(county)
    number=re.match(r'(\d+)(?:st|nd|rd|th)?([AB])? (?:District|Circuit)',title)
    assert number,title
    n,suffix=number.groups();code=n+(suffix.lower() if suffix else '')
    if 'Judge of Court of Appeals' in title:return BASE+'/court_of_appeals:'+code
    if 'Judge of Circuit Court' in title:return BASE+'/circuit_court:'+code
    assert 'Judge of District Court' in title,title
    division=re.search(r' - (\d+)(?:st|nd|rd|th) Division ',title)
    return BASE+'/district_court:'+code+('/division:'+division[1] if division else '')

def pdf_text(stem):
    with tempfile.TemporaryDirectory(prefix='ba01-mi-law-') as directory:
        p=Path(directory)/'source.pdf';p.write_bytes(raw(stem));return subprocess.run(['pdftotext','-layout',str(p),'-'],capture_output=True,text=True,check=True).stdout

def sections(text):
    # Parse source headings before collapsing layout, so compiler notes are never
    # mistaken for current operative statutory text.
    rows={}
    for chunk in re.split(r'(?m)^\s*(?=600\.\d+[a-z]? )',text):
        match=re.match(r'(600\.\d+[a-z]?) (.*?)\n\s*Sec\.\s*\d+[a-z]?\.\s*(.*)',chunk,re.S)
        if match:
            code,heading,body=match.groups();body=body.split('History:')[0]
            body=re.sub(r'Michigan Compiled Laws Complete Through[^\n]*\nRendered[^\n]*\n','',body)
            rows[code]=(clean(heading),clean(body))
    return rows

def county_names(text):
    return [slug(n) for n in re.split(r',\s*(?:and )?|\s+and\s+',text) if n.strip()]

def memberships(data,ballot):
    results=[];unresolved=[]
    def add(member,district,prov,quote):
        mid='mi-ba01-'+slug(member)+'-to-'+slug(district)
        row={'id':mid,'memberOcdId':BASE+'/'+member,'districtOcdId':BASE+'/'+district,'provenance':{**prov,'quote':quote}}
        if not any(m['id']==mid for m in ballot.setdefault('districtMemberships',[])):ballot['districtMemberships'].append(row)
        results.append({'member':member,'district':district})
    prov=receipt(data,'mi-appeals-district-law','Michigan Legislature')
    text=clean(html.fromstring(raw('mi-appeals-district-law')).text_content())
    groups=re.findall(r'District ([1-4]) consists of the counties of (.*?)\.(?=\s*(?:\([a-d]\)|History:))',text)
    assert len(groups)==4
    count=0
    for district,names in groups:
        for county in county_names(names.replace('St. Joseph','St Joseph').replace('St. Clair','St Clair')):
            add('county:'+county,'court_of_appeals:'+district,prov,f'District {district} consists of the counties of {names}.');count+=1
    assert count==83
    prov=receipt(data,'mi-circuit-law-pdf','Michigan Legislature')
    circuit=sections(pdf_text('mi-circuit-law-pdf'))
    # These statutory paragraphs depend on a county resolution. Their district
    # records publish, but memberships await separate proof of the current split.
    conditional={5,33,40,54,56,57}
    ordinals={i:w for i,w in enumerate(['','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth'],0)}
    for tens,prefix in [(20,'twenty'),(30,'thirty'),(40,'forty'),(50,'fifty')]:
        for units in range(1,10):
            if tens+units<=57:ordinals[tens+units]=prefix+'-'+ordinals[units]
    ordinals.update({20:'twentieth',30:'thirtieth',40:'fortieth',50:'fiftieth'})
    for district in range(1,58):
        pattern=r'(?:The |the )'+ordinals[district]+r' judicial circuit(?: court)? consists of the count(?:y|ies) of (.*?)(?= and has| and,|\. This circuit)'
        matches=[(code,body,m) for code,(h,body) in circuit.items() for m in re.finditer(pattern,body)]
        if district in conditional:
            unresolved.append({'district':'circuit_court:'+str(district),'reason':'Statutory composition is conditional on local creation/reformation resolutions; current jurisdiction confirmation still owed.'});continue
        assert matches,(district,pattern)
        code,body,match=matches[-1]  # Explicit later effective-date paragraph controls.
        names=match[1];assert not any(x in names for x in ['except','Michigan','History:']), (district,names)
        for county in county_names(names):add('county:'+county,'circuit_court:'+str(district),prov,code+' '+match[0])
    prov=receipt(data,'mi-district-law-pdf','Michigan Legislature')
    district=sections(pdf_text('mi-district-law-pdf'))
    # Unconditional whole-city definitions. Others retain their explicit source
    # court/division ID pending complete electoral boundary verification.
    city_rules={16:('600.8121','Livonia'),19:('600.8121','Dearborn'),20:('600.8121','Dearborn Heights'),21:('600.8121','Garden City'),23:('600.8121','Taylor'),28:('600.8121','Southgate'),31:('600.8121','Hamtramck'),32:None,36:('600.8121a','Detroit')}
    for number,rule in city_rules.items():
        if rule is None:continue
        code,city=rule;body=district[code][1]
        match=re.search(r'The '+ordinals[number]+r' district consists of the city of '+re.escape(city)+r',',body,re.I)
        assert match,(number,city)
        add('place:'+slug(city),'district_court:'+str(number),prov,code+' '+match[0].rstrip(','))
    body=district['600.8121'][1];match=re.search(r'The thirty-second-a district consists of the city of Harper Woods,',body,re.I);assert match
    add('place:harper_woods','district_court:32a',prov,'600.8121 '+match[0].rstrip(','))
    return results,unresolved

def main(write=False):
    path=ROOT/'data/ballot/2026-general/mi.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=copy.deepcopy(ballot)
    source=next(s for s in data['sourceReceipt']['sources'] if 'entellitrak' in s['finalUrl'])
    assert source['rawHash']==hashlib.sha256(gzip.decompress((EVIDENCE/'mi-1.html.gz').read_bytes())).hexdigest()
    prov={'sourceUrl':source['finalUrl'],'sourceOrg':source['publisher'],'collectedAt':source['retrievedAt'],'verifiedAt':NOW}
    groups,excluded=roster();verified=[]
    for group in groups:
        title=group['title'];division=jurisdiction(title);cid='mi-ba01-'+slug(title)
        prior=[c for c in ballot['contests'] if c['id']==cid]
        if not prior:
            vote=int(re.search(r'\((\d+)\) Position',title)[1]);years=re.search(r'(\d+) Year',title)
            ballot['contests'].append({'id':cid,'electionId':ballot['election']['id'],'ocdId':division,'divisionVintage':'2026','title':title,'type':'CANDIDACY','candidateListComplete':True,'voteFor':vote,'termYears':int(years[1]) if years else None,'scopeNote':None,'provenance':{**prov,'quote':title}})
            for row in group['rows']:
                ballot['candidacies'].append({'id':cid+'-candidate-'+slug(row['name']),'contestId':cid,'familyName':row['name'],'givenName':'','partyLabel':None,'slogan':None,'incumbent':row['incumbent'],'websiteUrl':None,'provenance':{**prov,'quote':title+' | '+' | '.join(row['sourceCells'])}})
        held=[c for c in ballot['candidacies'] if c['contestId']==cid]
        assert {c['familyName'] for c in held}=={r['name'] for r in group['rows']} and len(held)==len(group['rows']),title
        assert all(c['partyLabel'] is None for c in held)
        verified.append({'office':title,'ocdId':division,'candidates':len(held)})
    members,unresolved=memberships(data,ballot)
    for kind in ['contests','candidacies','measures','absences']:
        for old in before[kind]:assert next(x for x in ballot[kind] if x['id']==old['id'])==old,(kind,old['id'])
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'MI','before':[len(before['contests']),len(before['candidacies'])],'after':[len(ballot['contests']),len(ballot['candidacies'])],'officialJudicialContests':168,'officialJudicialCandidates':252,'verifiedContests':verified,'excludedFilingRows':excluded,'verifiedMemberships':len(members),'unresolvedCircuitMemberships':unresolved,'remaining':'Other district-court electoral boundaries, city/county/school races and local measures remain open. This official-roster/catalog replay is not live or ZIP sample completeness.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args();print(json.dumps(main(a.write),indent=2))
