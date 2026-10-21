#!/usr/bin/env python3
"""Replay Idaho's final state-run general filing API, never its withdrawn rows."""
from pathlib import Path
from collections import defaultdict
from datetime import datetime,timezone
import copy,json,re,runpy,os,hashlib,gzip
ROOT=Path(os.environ.get('BA01_WEST_ROOT',Path(__file__).resolve().parents[1]))
COMMON=runpy.run_path(str(ROOT/'scripts/ba01-west-court-county.py'))
CAPTURES=Path(os.environ.get('BA01_WEST_ID_LOCAL_CAPTURES',ROOT / 'data/ballot/ba01-west-evidence/id-local-captures'))

def snapshot(name):
 row=next(r for r in json.loads((CAPTURES/'manifest.json').read_text())if r['name']==name)
 raw=gzip.decompress((CAPTURES/row['file']).read_bytes());text=(CAPTURES/row['textSnapshot']).read_bytes()
 assert hashlib.sha256(raw).hexdigest()==row['rawHash']
 assert hashlib.sha256(text).hexdigest()==row['textHash']
 return text.decode(),row

def source_quote(rows):
 return '\n'.join(json.dumps({k:r[k]for k in ['electionName','districtType','officeName','district','seat','countyName','candidateName','partyName','filingStatus','isWriteIn']},ensure_ascii=False,separators=(',',':'))for r in rows)

def import_counties(package):
 raw,source=COMMON['state_capture']('id-all');response=json.loads(raw);data=response['data']
 assert response['succeeded']and data['isFinalList']is True
 assert data['totalCandidates']==data['candidatesFound']==len(data['candidates'])==592
 rows=[r for r in data['candidates']if r['filingStatus']=='Approved']
 assert all(r['electionName']=='11/03/2026 - 2026 GENERAL'for r in rows)
 county=[r for r in rows if r['districtType']=='County']
 assert len(county)==334
 groups=defaultdict(list)
 allowed={'County Commissioner','County Clerk','County Coroner','County Treasurer','County Assessor','Magistrate Judge','County Sheriff','County Prosecuting Attorney'}
 for r in county:
  assert r['officeName']in allowed and r['countyName']and r['district']==r['countyName']
  key=(r['countyName'],r['officeName'],r['candidateName']if r['officeName']=='Magistrate Judge'else r['seat'])
  groups[key].append(r)
 assert len(groups)==301 and len({k[0]for k in groups})==44
 publisher='Idaho Secretary of State'
 population_order=['Ada','Canyon','Kootenai','Bonneville','Twin Falls','Bannock']
 ordered=sorted(groups.items(),key=lambda kv:(population_order.index(kv[0][0])if kv[0][0]in population_order else 99,kv[0][0],kv[0][1],str(kv[0][2])))
 for (county_name,office,seat),candidates in ordered:
  county_id=county_name.lower().replace(' ','_')
  title=office
  if office=='Magistrate Judge':
   assert len(candidates)==1
   title+=' — '+candidates[0]['candidateName'].strip()+' — Retention'
  elif seat is not None:title+=' — Seat '+str(seat)
  identifier='id-'+county_id+'-general-2026-'+COMMON['slug'](title)
  COMMON['race'](package,identifier,title,'ocd-division/country:us/state:id/county:'+county_id,
   [(r['candidateName'].strip(),r['partyName']or None)for r in candidates],source,publisher,source_quote(candidates),retention=office=='Magistrate Judge')
 legal,law=snapshot('id-magistrate-retention')
 assert 'to the voters eligible to vote within the county for which he is appointed' in legal
 COMMON['receipt'](package,law,'Idaho Legislature','IC1-2220 explicitly assigns each magistrate retention question to voters of the county for which appointed.','OFFICIAL_PUBLISHER')
 legal,law=snapshot('id-county-election-law')
 assert 'A board of county commissioners shall be elected in each county at the general elections' in legal
 COMMON['receipt'](package,law,'Idaho Legislature','IC34-617 provides county general commissioner elections and separate candidate residency districts. State final filing API explicitly labels district and county identically for every county office; commissioner seat is retained separately.','OFFICIAL_PUBLISHER')
 highway=[r for r in rows if r['officeName'].strip()=='Highway District Commissioner (County Wide)'and r['countyName']=='Ada']
 assert len(highway)==7 and {r['seat']for r in highway}=={'3','4'}
 for seat in ['3','4']:
  candidates=[r for r in highway if r['seat']==seat]
  title='Ada County Highway District — Commissioner, Subdistrict '+seat
  COMMON['race'](package,'id-ada-general-2026-highway-commissioner-'+seat,title,'ocd-division/country:us/state:id/county:ada',
   [(r['candidateName'].strip(),r['partyName'])for r in candidates],source,publisher,source_quote(candidates))
 legal,law=snapshot('id-highway-codified')
 assert 'A qualified voter of the countywide highway district shall be eligible to vote for each of the countywide highway district commissioner offices' in legal
 assert 'Beginning with the elections of 2028'in legal
 COMMON['receipt'](package,law,'Idaho Legislature','Current IC40-1404A(2) explicitly makes every countywide highway voter eligible for each seat; primaries provision is separately2028. State final API explicitly identifies both Ada races as CountyWide.','OFFICIAL_PUBLISHER')
 judicial=[r for r in rows if r['districtType']=='Judicial']
 assert len(judicial)==2 and all(r['district']=='4'and r['seat']=='Ada A'for r in judicial)
 court='ocd-division/country:us/state:id/judicial_district:4'
 COMMON['race'](package,'id-general-2026-district-judge-4-ada-a','District Judge — Fourth Judicial District, Seat Ada A',court,
  [(r['candidateName'].strip(),r['partyName'])for r in judicial],source,publisher,source_quote(judicial))
 legal,law=snapshot('id-fourth-district-scope')
 quote='The fourth judicial district shall consist of the counties of Valley, Boise, Ada and Elmore.'
 assert quote in legal
 for county_name in ['valley','boise','ada','elmore']:COMMON['member'](package,'id',county_name,court,law,'Idaho Legislature',quote)
 COMMON['receipt'](package,law,'Idaho Legislature','IC1-805 explicitly lists all four whole counties in JudicialDistrict4.','OFFICIAL_PUBLISHER')
 legal,law=snapshot('id-judicial-elections-constitution')
 assert 'for each of which a judge shall be chosen by the qualified electors thereof' in legal
 COMMON['receipt'](package,law,'Idaho Legislature','IdahoConstitutionV11 assigns district judge election to qualified electors of the respective judicial district, rather than only resident chambers county.','OFFICIAL_PUBLISHER')
 COMMON['receipt'](package,source,publisher,'Final state-run November3 general API:301county contests/334Approved candidates across44counties,2countywide AdaHighway races/7Approved names,1DistrictJudge runoff/2Approved names. Withdrawn and all other statuses excluded. Local measures and noncounty electorates remain separate coverage work.')
 return {'countyContests':301,'countyCandidates':334,'counties':44,'highwayContests':2,'highwayCandidates':7,'districtJudgeContests':1,'districtJudgeCandidates':2}

if __name__=='__main__':
 file=ROOT/'data/ballot/2026-general/id.json';package=json.loads(file.read_text());before=copy.deepcopy(package);result=import_counties(package)
 ballot=next(iter(package['ballots'].values()));prior=next(iter(before['ballots'].values()))
 for key in ['contests','candidacies','measures']:
  current={r['id']:r for r in ballot[key]};assert all(current.get(r['id'])==r for r in prior[key])
 package['sourceReceipt']['reviewedAt']=max([datetime.now(timezone.utc)]+[datetime.fromisoformat(r['retrievedAt'].replace('Z','+00:00'))for r in package['sourceReceipt']['sources']]).isoformat()
 # Replay writes only the owned state ballot file unless an explicit output override is set.
 output=Path(os.environ.get('BA01_WEST_ID_OUTPUT',str(file)))
 output.write_text(json.dumps(package,indent=2,ensure_ascii=False)+'\n');print(result)
