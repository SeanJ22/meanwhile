"""Replay municipal at-large races already captured in official Minnesota samples."""
import argparse
import copy
import gzip
import importlib.util
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'

def load_helper():
    spec=importlib.util.spec_from_file_location('ba01_mn_local',ROOT/'scripts/ba01-great-lakes-mn-local.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.ROOT=ROOT;m.EVIDENCE=EVIDENCE;return m

def main(write=False):
    m=load_helper();path=ROOT/'data/ballot/2026-general/mn.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=copy.deepcopy(ballot);results=[]
    for source in sorted(EVIDENCE.glob('mn-*-*.retrieval.json')):
        meta=json.loads(source.read_text())
        if not all(k in meta for k in ['ballotUrl','sampleUrl','county','judicialDistrict']):continue
        stem=source.name.removesuffix('.retrieval.json');sample=json.loads(m.raw(stem+'.ballot.json.gz'));assert sample['PollingResult']['ElectionDate'].startswith('11/03/2026');groups=defaultdict(list)
        for row in sample['Ballots']:
            if row['CandidateScreenName']!='WRITE-IN':groups[row['OfficeTitle']].append(row)
        for office,rows in groups.items():
            match=re.fullmatch(r'(Mayor|Council Member At Large|Council Member) \(([^)]+)\)(?: \(Elect (\d+)\))?',office)
            if not match:continue
            role,city,vote=match.groups();assert city.upper()==sample['PollingResult']['CityName']
            # A district or ward council title cannot match this expression.
            division=m.STATE_BASE+'/place:'+m.slug(city);text=m.raw(stem+'.pdf.txt.gz').decode();m.add_contest(data,ballot,office,division,rows,meta,stem,text,vote_for=int(vote) if vote else None)
            results.append({'county':meta['county'],'city':city,'office':office,'candidates':len(rows),'sampleUrl':meta['sampleUrl']})
    assert len(results)==8 and sum(x['candidates'] for x in results)==17,(len(results),results)
    for kind in ['contests','candidacies','measures','absences']:
        for old in before[kind]:assert next(x for x in ballot[kind] if x['id']==old['id'])==old,(kind,old['id'])
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'MN','before':[len(before['contests']),len(before['candidacies'])],'after':[len(ballot['contests']),len(ballot['candidacies'])],'verifiedCityContests':len(results),'verifiedCityCandidates':sum(x['candidates'] for x in results),'contests':results,'remaining':'City ward/district, soil-water and school/local measure work remains open. No live or complete-ZIP claim.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args();print(json.dumps(main(a.write),indent=2))
