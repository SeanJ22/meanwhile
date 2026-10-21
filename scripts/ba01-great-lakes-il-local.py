"""Replay Brown and Sangamon official 2026 general sample ballots.

Brown's county election publisher is linked by CDC.gov; Sangamon.gov directly
links its public Platinum ballot service. Original bytes and retrieval metadata
are retained. Crops follow original PDF columns and remove only isolated SAMPLE
watermark letters. Each parsed candidate/party block must match in full.
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

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def clean(value):return re.sub(r'\s+',' ',value).strip()
def slug(value):return re.sub('[^a-z0-9]+','-',value.lower()).strip('-')
def raw(name):return gzip.decompress((EVIDENCE/(name+'.raw.gz')).read_bytes())
def meta(name):return json.loads((EVIDENCE/(name+'.meta.json')).read_text())

def receipt(data,name,publisher,source_class='ELECTION_AUTHORITY'):
    details=meta(name);digest=hashlib.sha256(raw(name)).hexdigest()
    assert details['status']==200 and details['sha256']==digest,(name,details)
    url=details['finalUrl']
    if not any(x['finalUrl']==url and x['rawHash']==digest for x in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append({'requestedUrl':details['url'],'finalUrl':url,'httpStatus':200,'rawHash':digest,'retrievedAt':details['retrievedAt'],'publisher':publisher,'sourceClass':source_class,
            'reviewedEvidence':f'Original public bytes retained in data/ballot/evidence/ba01-great-lakes/{name}.raw.gz; hash identifies original decompressed bytes. Brown county election host is linked from CDC.gov; Sangamon.gov links the public sample-ballot service. Replay validates election/jurisdiction and complete printed candidate-party blocks.'})
    return {'sourceUrl':url,'sourceOrg':publisher,'collectedAt':details['retrievedAt'],'verifiedAt':NOW}

def column(name,page,x,width):
    with tempfile.TemporaryDirectory(prefix='ba01-il-pdf-') as directory:
        pdf=Path(directory)/'source.pdf';pdf.write_bytes(raw(name))
        result=subprocess.run(['pdftotext','-f',str(page),'-l',str(page),'-x',str(x),'-y','0','-W',str(width),'-H','1044','-layout',str(pdf),'-'],capture_output=True,text=True,check=True)
    return '\n'.join(line.strip() for line in result.stdout.splitlines() if line.strip() not in {'S','A','M','P','L','E'})

def race(text,start,end,expected):
    block=text[text.index(start):]
    block=block[:block.index(end)]
    block=block[block.index('(Vote for one)')+len('(Vote for one)'):]
    lines=[line.strip() for line in block.splitlines() if line.strip()]
    assert lines==[value for pair in expected for value in pair],(start,lines,expected)
    return [(name,party) for name,party in expected if name!='No Candidate']

def add(data,ballot,title,division,rows,prov):
    found=[c for c in ballot['contests'] if c['ocdId']==division and c['title'].casefold()==title.casefold()]
    if not found and division.endswith('/sldl:99'):
        found=[c for c in ballot['contests'] if c['ocdId']==division and c['type']=='CANDIDACY']
    assert len(found)<=1,(title,found)
    cid=found[0]['id'] if found else 'il-ba01-'+slug(title)+'-'+slug(division.split('/')[-1])
    if not found:
        ballot['contests'].append({'id':cid,'electionId':ballot['election']['id'],'ocdId':division,'divisionVintage':'2026','title':title,'type':'CANDIDACY','voteFor':1,'termYears':None,'scopeNote':None,'candidateListComplete':True,
            'provenance':{**prov,'quote':title}})
    for name,party in rows:
        match=[c for c in ballot['candidacies'] if c['contestId']==cid and clean(c['givenName']+' '+c['familyName']).casefold()==name.casefold()]
        if match:
            assert len(match)==1 and match[0]['partyLabel']==party
            continue
        ballot['candidacies'].append({'id':cid+'-candidate-'+slug(name),'contestId':cid,'givenName':'','familyName':name,'partyLabel':party,'slogan':None,'incumbent':None,'websiteUrl':None,
            'provenance':{**prov,'quote':f'{title} | {name} | {party}'}})
    return cid

def main(write=False):
    path=ROOT/'data/ballot/2026-general/il.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=copy.deepcopy(ballot)
    from lxml import html
    cdc=html.fromstring(raw('il-brown-cdc'));assert 'https://www.browncoil.org/departments/health-department/' in cdc.xpath('//a/@href')
    county=html.fromstring(raw('il-brown-parent'));assert meta('il-brown-sample')['url'] in county.xpath('//a/@href')
    parent=html.fromstring(raw('il-sangamon-parent'));assert 'https://vr.platinumvrms.com/county/RSLRequest/38?t=1' in parent.xpath('//a/@href')
    receipt(data,'il-brown-cdc','U.S. Centers for Disease Control and Prevention','OFFICIAL_PUBLISHER')
    receipt(data,'il-brown-parent','Brown County Clerk and Recorder')
    receipt(data,'il-sangamon-parent','Sangamon County Clerk')
    brown=receipt(data,'il-brown-sample','Brown County Clerk and Recorder');sangamon=receipt(data,'il-sangamon-sample','Sangamon County Clerk')
    b=column('il-brown-sample',1,416,232);bs=column('il-brown-sample',2,0,220);sm=column('il-sangamon-sample',1,219,185);sr=column('il-sangamon-sample',1,430,218)
    with tempfile.TemporaryDirectory(prefix='ba01-il-full-') as directory:
        for stem,jurisdiction in [('il-brown-sample','BROWN COUNTY, ILLINOIS'),('il-sangamon-sample','SANGAMON COUNTY, ILLINOIS')]:
            pdf=Path(directory)/(stem+'.pdf');pdf.write_bytes(raw(stem));text=subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,text=True,check=True).stdout
            assert 'NOVEMBER 3, 2026' in text and jurisdiction in text,(stem,jurisdiction)
    state='ocd-division/country:us/state:il'
    cases=[
        ('FOR REPRESENTATIVE IN THE GENERAL ASSEMBLY NINETY-NINTH REPRESENTATIVE DISTRICT',state+'/sldl:99',race(b,'NINETY-NINTH REPRESENTATIVE','FOR REPRESENTATIVE IN THE', [('No Candidate','DEMOCRATIC'),('Kyle A. Moore','REPUBLICAN')]),brown),
        ('Brown County — FOR COUNTY CLERK AND RECORDER',state+'/county:brown',race(b,'FOR COUNTY CLERK AND RECORDER','FOR COUNTY TREASURER',[('Jenny Welty','DEMOCRATIC'),('No Candidate','REPUBLICAN')]),brown),
        ('Brown County — FOR COUNTY TREASURER',state+'/county:brown',race(b,'FOR COUNTY TREASURER','VOTE BOTH FRONT',[('No Candidate','DEMOCRATIC'),('Heather McClelland','REPUBLICAN')]),brown),
        ('Brown County — FOR COUNTY SHERIFF',state+'/county:brown',race(bs,'FOR COUNTY SHERIFF','REGIONAL OFFICE',[('No Candidate','DEMOCRATIC'),('Justin D. Oliver','REPUBLICAN')]),brown),
        ('Sangamon County — FOR COUNTY CLERK',state+'/county:sangamon',race(sr,'FOR COUNTY CLERK','FOR COUNTY SHERIFF',[('Don Gray','REPUBLICAN'),('No Candidate','DEMOCRATIC')]),sangamon),
        ('Sangamon County — FOR COUNTY TREASURER',state+'/county:sangamon',race(sm,'FOR COUNTY TREASURER','OTE BOTH SIDES',[('Joe Aiello','REPUBLICAN'),('No Candidate','DEMOCRATIC')]),sangamon),
        ('Sangamon County — FOR COUNTY SHERIFF',state+'/county:sangamon',race(sr,'FOR COUNTY SHERIFF','OR REGIONAL SUPERINTENDENT',[('Paula Crouch','REPUBLICAN'),('Marc Bell','DEMOCRATIC')]),sangamon),
    ]
    ids=[add(data,ballot,*case) for case in cases]
    for kind in ['contests','candidacies','measures','absences']:
        for old in before[kind]:assert next(x for x in ballot[kind] if x['id']==old['id'])==old,(kind,old['id'])
    note='BA-01: Brown and Sangamon official November 3 sample ballots add House District 99 and three countywide offices in each county. Every named candidate and printed party in those races is preserved; No Candidate and blank write-in lines are not people. County board, regional education, judicial and other local contests remain standing acquisition work.'
    if note not in ballot['coverageNotes']:ballot['coverageNotes'].append(note)
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'IL','before':[len(before['contests']),len(before['candidacies'])],'after':[len(ballot['contests']),len(ballot['candidacies'])],'verifiedContests':7,'verifiedCandidates':8,'contestIds':ids,'sources':[meta('il-brown-sample')['finalUrl'],meta('il-sangamon-sample')['finalUrl']],'remaining':'Source/catalog verification only. These countywide races and House99 do not establish complete county, ZIP or live reader ballots.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--write',action='store_true');args=parser.parse_args();print(json.dumps(main(args.write),indent=2))
