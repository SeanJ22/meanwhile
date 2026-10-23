"""Replay all three official Lebanon November3 general-election ballot styles."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re

SPEC = importlib.util.spec_from_file_location('ba01_northeast_pa', pathlib.Path(__file__).with_name('ba01-northeast-pa.py'))
PA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PA)
COMMON = PA.COMMON
SPEC = importlib.util.spec_from_file_location('ba01_northeast_nh', pathlib.Path(__file__).with_name('ba01-northeast-nh.py'))
NH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NH)
PREFIX = 'ocd-division/country:us/state:nh/'
PUBLISHER = 'Lebanon City Clerk'


def source(ward):
    return f'nh-lebanon-ward-{ward}.pdf'


def candidate_cells(ward, page, low, high):
    lines = PA.pdf_lines(COMMON.SOURCES/source(ward))[page]
    names = {}
    for party, left, right in [('Republican',240,350),('Democratic',350,480)]:
        name = ' '.join(text for x,y,text in lines if left<=x<right and low<y<high)
        if name:
            names.setdefault(name,[]).append(party)
    return [(name,' / '.join(parties)) for name,parties in names.items()]


def groups(ward):
    base=12+ward
    return [{'division':division,'title':title,'voteFor':1,'candidates':candidate_cells(ward,page,low,high),'source':source(ward)}
            for division,title,page,low,high in [
                ('sldu:5','State Senator, District 5',0,430,465),
                (f'sldl:{400+base}',f'State Representative, Grafton County District {base}',0,500,540),
                ('sldl:grafton_17','State Representative, Grafton County District 17',0,590,630),
                ('county:grafton','Grafton County Sheriff',0,665,695),
                ('county:grafton','Grafton County Attorney',0,715,745),
                ('county:grafton','Grafton County Treasurer',0,772,800),
                ('county:grafton','Grafton County Register of Deeds',0,824,855),
                ('county:grafton','Grafton County Register of Probate',0,880,920),
                ('county:grafton/council_district:1','Grafton County Commissioner, District 1',1,110,135)]]


def contest_id(group):
    return 'nh-2026-general:'+re.sub(r'[^a-z0-9]+','-',group['title'].lower()).strip('-')


def question(ward):
    text=COMMON.pdf_text(COMMON.SOURCES/source(ward))
    return ' '.join(re.search(r'2\. (Shall the City of LEBANON.*?)(?=^\s*YES\b)',text,re.S|re.M)[1].split())


def sample_comparison(ballot,ward):
    comparisons=[(contest_id(group),group['candidates']) for group in groups(ward)]
    # The first four rows are already held; compare every existing party cell too.
    for held_id,low,high,minor_party in [
        ('ballot-nh-merrimack:governor',225,235,'Libertarian'),
        ('ballot-nh-merrimack:us-senate',279,290,'Constitution'),
        ('ballot-nh-merrimack:us-house-2',333,345,'Independent'),
        ('ballot-nh-merrimack:executive-council-2',387,398,None)]:
        names=candidate_cells(ward,0,low,high)
        if minor_party:
            lines=PA.pdf_lines(COMMON.SOURCES/source(ward))[0]
            name=' '.join(text for x,y,text in lines if 120<=x<240 and low<y<high)
            names.append((name,minor_party))
        comparisons.append((held_id,names))
    differences=[]
    for held_id,names in comparisons:
        expected={(COMMON.words(name),party) for name,party in names}
        held={(COMMON.words(c['givenName']+' '+c['familyName']),c['partyLabel']) for c in ballot['candidacies'] if c['contestId']==held_id}
        if expected!=held:
            differences.append({'contestId':held_id,'missing':sorted(expected-held),'extra':sorted(held-expected)})
    measure=next((m for m in ballot['measures'] if m['contestId']==f'nh-2026-lebanon-ward-{ward}-hb1300-property-tax-growth'),None)
    if not measure or measure['questionText']!=question(ward):
        differences.append({'ward':ward,'questionTextMismatch':True})
    return {'place':f'Lebanon Ward{ward}','sourceUrl':metadata(ward)['finalUrl'],
            'officialCandidateContests':len(comparisons),'officialCandidacies':sum(len(names) for _,names in comparisons),
            'officialMeasures':2,'differences':differences,'races':[{'contestId':key,'officialCandidacies':len(names)} for key,names in comparisons],
            'liveVerified':False}


def metadata(ward):
    meta=json.loads((COMMON.SOURCES/(source(ward)+'.capture.json')).read_text())
    assert meta['httpStatus']==200 and meta['rawHash']==hashlib.sha256((COMMON.SOURCES/source(ward)).read_bytes()).hexdigest()
    return meta


def memberships(at,data):
    statute=NH.statute_text();rsa_at=COMMON.capture_time(data,NH.STATUTE,COMMON.SOURCES/'nh-rsa662-elective-districts.html')
    council=re.search(r'II\. Councilor district number 2 .*?(?= III\.)',statute)[0]
    commissioner=re.search(r'V\. Grafton: District 1, .*?(?=; District 2)',statute)[0]
    overlay=re.search(r'District No\. 17 Lebanon Ward 1 Lebanon Ward 2 Lebanon Ward 3 1',statute)[0]
    result={}
    def add(member,target,quote):
        key=(PREFIX+member,PREFIX+target)
        result[key]={'id':'nh-2026-lebanon-membership:'+member+'->'+target,'memberOcdId':key[0],'districtOcdId':key[1],
                     'provenance':{'sourceUrl':NH.STATUTE,'sourceOrg':'New Hampshire General Court','collectedAt':rsa_at,'verifiedAt':at,'quote':quote}}
    for ward in [1,2,3]:
        base=f'sldl:{412+ward}'
        quote=f'District No. {12+ward} Lebanon Ward {ward} 1';assert quote in statute
        add(base,f'place:lebanon/ward:{ward}',quote)
        add(base,'sldl:grafton_17',overlay)
        add(base,'executive_district:2',council)
        add(base,'county:grafton/council_district:1',commissioner)
        add(f'place:lebanon/ward:{ward}','sldl:grafton_17',overlay)
    for member in ['county:grafton/place:lebanon_city','place:lebanon']:
        add(member,'executive_district:2',council);add(member,'county:grafton/council_district:1',commissioner)
    return list(result.values())


def update(at):
    path=COMMON.ROOT/'data/ballot/2026-general/nh.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()))
    before=len(ballot['contests']),len(ballot['candidacies'])
    for ward in [1,2,3]:
        meta=metadata(ward);receipt=COMMON.receipt(COMMON.SOURCES/source(ward),meta['requestedUrl'],PUBLISHER,meta['retrievedAt'],
            'Actual official Lebanon Ward'+str(ward)+' general-election sample: all13 candidate races/24 distinct names, both printed party columns and both ballot questions compared. Names in blank write-in spaces are not invented.')
        receipt['finalUrl']=meta['finalUrl'];COMMON.add_receipt(data,receipt,at,captured=True)
        provenance={'sourceUrl':meta['finalUrl'],'sourceOrg':PUBLISHER,'collectedAt':meta['retrievedAt'],'verifiedAt':at}
        for group in groups(ward):
            key=contest_id(group);contest=next((c for c in ballot['contests'] if c['id']==key),None)
            if contest is None:
                contest={'id':key,'electionId':ballot['election']['id'],'ocdId':PREFIX+group['division'],'divisionVintage':'2022',
                         'title':group['title'],'type':'CANDIDACY','voteFor':1,'termYears':None,'scopeNote':None,'candidateListComplete':True}
                ballot['contests'].append(contest)
            contest['provenance']={**provenance,'quote':group['title']}
            for name,party in group['candidates']:
                candidate_id=key+':'+re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
                candidate=next((c for c in ballot['candidacies'] if c['id']==candidate_id),None)
                if candidate is None:
                    candidate={'id':candidate_id,'contestId':key,'givenName':'','familyName':name,'partyLabel':party,
                               'slogan':None,'incumbent':None,'websiteUrl':None};ballot['candidacies'].append(candidate)
                candidate['provenance']={**provenance,'quote':name+' | '+party}
        key=f'nh-2026-lebanon-ward-{ward}-hb1300-property-tax-growth';text=question(ward)
        contest=next((c for c in ballot['contests'] if c['id']==key),None)
        proof={**provenance,'quote':text}
        if contest is None:
            contest={'id':key,'electionId':ballot['election']['id'],'ocdId':PREFIX+f'place:lebanon/ward:{ward}','divisionVintage':'2022',
                     'title':'Lebanon School District Property Tax Growth Limit','type':'MEASURE','measureTextUrl':meta['finalUrl'],'voteFor':1,'termYears':None,'scopeNote':None}
            ballot['contests'].append(contest)
        contest.update(type='MEASURE',measureTextUrl=meta['finalUrl'],provenance=proof)
        measure=next((m for m in ballot['measures'] if m['contestId']==key),None)
        if measure is None:
            measure={'id':key,'contestId':key,'officialNumber':'2','name':contest['title'],'questionText':text,
                     'yesLabel':'Yes','noLabel':'No','officialStatement':None};ballot['measures'].append(measure)
        measure.update(questionText=text,provenance=proof)
    prefix='nh-2026-lebanon-membership:'
    ballot['districtMemberships']=[m for m in ballot.get('districtMemberships',[]) if not m['id'].startswith(prefix)]+memberships(at,data)
    reports=[sample_comparison(ballot,ward) for ward in [1,2,3]]
    if any(r['differences'] for r in reports):raise ValueError(reports)
    return path,data,{'state':'NH','before':before,'after':(len(ballot['contests']),len(ballot['candidacies'])),'samples':reports}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    path,data,report=update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report))
