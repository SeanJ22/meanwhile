"""Replay school at-large races from SOS samples, with official district identities.

The government school-number table binds ISD numbers to district names; the
current Census district list supplies the exact canonical geography name. Ward
or school-subdistrict races remain outside this whole-district replay.
"""
import argparse
import copy
import gzip
import importlib.util
import json
import re
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
HELPER_PATH=ROOT/'scripts/ba01-great-lakes-mn-local.py'

def normalize(name):
    value=re.sub('[^a-z0-9]','',name.lower().replace('saint','st'))
    for suffix in ['publicschooldistrict','publicschools','schooldistrict','schools']:
        if value.endswith(suffix):return value[:-len(suffix)]
    return value

def main(write=False):
    spec=importlib.util.spec_from_file_location('ba01_mn_local',HELPER_PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.ROOT=ROOT;m.EVIDENCE=EVIDENCE
    path=ROOT/'data/ballot/2026-general/mn.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=copy.deepcopy(ballot)
    with tempfile.TemporaryDirectory(prefix='ba01-mn-schools-') as directory:
        pdf=Path(directory)/'school-numbers.pdf';pdf.write_bytes(m.raw('mn-commerce-school-numbers.raw.gz'));text=subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,text=True,check=True).stdout
    organizations=[(int(number),int(kind),name) for number,kind,name in re.findall(r'^\s*(\d+)\s+([123])\s+(.+?)\s*$',text,re.M)]
    census=json.loads(m.raw('mn-census-unified-schools.raw.gz'));census_rows=[row['attributes'] for row in census['features']];assert len(census_rows)==322
    for stem,publisher in [('mn-commerce-school-numbers','Minnesota Department of Commerce'),('mn-census-unified-schools','U.S. Census Bureau')]:
        meta=json.loads((EVIDENCE/(stem+'.retrieval.json')).read_text());assert meta['httpStatus']==200
        m.receipt(data,stem+'.raw.gz',meta['finalUrl'],publisher,'OFFICIAL_PUBLISHER')
    results=[]
    for source in sorted(EVIDENCE.glob('mn-*-*.retrieval.json')):
        meta=json.loads(source.read_text())
        if not all(k in meta for k in ['ballotUrl','sampleUrl','county','judicialDistrict']):continue
        stem=source.name.removesuffix('.retrieval.json');sample=json.loads(m.raw(stem+'.ballot.json.gz'));assert sample['PollingResult']['ElectionDate'].startswith('11/03/2026');groups=defaultdict(list)
        for row in sample['Ballots']:
            if row['CandidateScreenName']!='WRITE-IN':groups[row['OfficeTitle']].append(row)
        for office,rows in groups.items():
            match=re.fullmatch(r'School Board Member(?: At Large)? \((?:ISD|SSD) #(\d+)\) \(Elect (\d+)\)',office)
            if not match:continue
            number,vote=map(int,match.groups());assert number==int(sample['PollingResult']['SchoolDistrict'])
            names={normalize(name) for code,kind,name in organizations if code==number}
            candidates=[row for row in census_rows if normalize(row['NAME']) in names]
            if len(candidates)>1:
                # District numbers repeat across district types: ISD1 Aitkin and
                # SSD1 Minneapolis must never be conflated. SOS supplies the name.
                candidates=[row for row in candidates if normalize(row['NAME'])==normalize(sample['PollingResult']['SchoolName'])]
            assert len(candidates)==1,(number,sample['PollingResult']['SchoolName'],candidates)
            canonical=candidates[0]['NAME'];division=m.STATE_BASE+'/school_district:'+m.slug(canonical)
            existing=[c for c in ballot['contests'] if c['ocdId']==division and c['title'].endswith(' — '+office)]
            if existing:
                assert len(existing)==1
                assert {c['familyName'] for c in ballot['candidacies'] if c['contestId']==existing[0]['id']}=={r['CandidateScreenName'] for r in rows}
                if number==1:continue  # Existing Minneapolis replay owns SSD1.
            else:
                m.add_contest(data,ballot,canonical+' — '+office,division,rows,meta,stem,m.raw(stem+'.pdf.txt.gz').decode(),vote_for=vote)
            results.append({'schoolDistrictNumber':number,'schoolDistrictName':canonical,'ocdId':division,'office':office,'candidates':len(rows),'sampleUrl':meta['sampleUrl']})
    assert len(results)==11,results
    for kind in ['contests','candidacies','measures','absences']:
        for old in before[kind]:assert next(x for x in ballot[kind] if x['id']==old['id'])==old,(kind,old['id'])
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'MN','before':[len(before['contests']),len(before['candidacies'])],'after':[len(ballot['contests']),len(ballot['candidacies'])],'verifiedSchoolContests':len(results),'verifiedSchoolCandidates':sum(x['candidates'] for x in results),'contests':results,'remaining':'School-subdistrict seats, soil/water districts and remaining local measures remain open. Source/catalog verification is not live acceptance.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args();print(json.dumps(main(a.write),indent=2))
