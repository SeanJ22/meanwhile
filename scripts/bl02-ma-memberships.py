"""Normalize official Massachusetts Council members to held Census/ZIP IDs; data only."""
import copy,hashlib,importlib.util,json,pathlib,re,datetime,collections
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ma_memberships',root/'scripts/ba01-northeast-ma-memberships.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
municipalities,wards=mod.official_members()
path=root/'data/ballot/2026-general/ma.json';before=path.read_bytes();data=json.loads(before);ballot=next(iter(data['ballots'].values()));old=copy.deepcopy(ballot)
index=set();shards=[]
for name in ('01','02'):
 p=root/f'data/derived/zip-divisions/{name}.json';q=json.loads(p.read_bytes());index.update(q['divisions']);shards.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
# The state fits shards 01/02, except coastal island points in 00? Count all other state-index entries independently below.
ma_index={x for x in index if '/state:ma/' in x};all_ma=set()
for p in (root/'data/derived/zip-divisions').glob('[0-9][0-9].json'):
 q=json.loads(p.read_bytes());all_ma.update(x for x in q['divisions'] if '/state:ma/' in x)
assert ma_index==all_ma,(len(ma_index),len(all_ma))
missing=[r for r in old['districtMemberships'] if r['memberOcdId'] not in index];assert len(missing) in (28,236)
at=datetime.datetime.now(datetime.timezone.utc).isoformat()
changed=[];remaining=[]
def normalized_member(value):
 county,place=value.rsplit('/place:',1)
 return county,re.sub(r'_(?:town_city|city|town)$','',place).replace('-','_')
for row in ballot['districtMemberships']:
 source=row['memberOcdId']
 if source in index:continue
 if '/ward:' in source:
  city,ward=source.rsplit('/ward:',1);city=city.rsplit('/place:',1)[1]
  city={'braintree':'Braintree','boston':'Boston','cambridge':'Cambridge'}[city]
  assert wards[(city,int(ward))]==int(row['districtOcdId'].split(':')[-1])
  remaining.append({'memberOcdId':source,'districtOcdId':row['districtOcdId']});continue
 quote=row['provenance']['quote'];district=int(row['districtOcdId'].split(':')[-1]);assert municipalities[quote]==district
 if '/county:' in source:
  candidates=sorted(x for x in ma_index if '/county:' in x and '/place:' in x and normalized_member(x)==normalized_member(source))
 else:
  candidates=sorted({x['memberOcdId'] for x in old['districtMemberships'] if x['provenance']['quote']==quote and x['districtOcdId']==row['districtOcdId'] and x['memberOcdId'] in index},key=lambda x:('/county:' in x,x))
 if not candidates:
  related=[x['memberOcdId'] for x in old['districtMemberships'] if x['provenance']['quote']==quote and '/county:' in x['memberOcdId']]
  assert len(related)==1,(source,related)
  candidates=sorted(x for x in ma_index if '/county:' in x and '/place:' in x and normalized_member(x)==normalized_member(related[0]))
 assert candidates,(source,quote)
 target=candidates[0];row['memberOcdId']=target;row['provenance']['verifiedAt']=at
 changed.append({'id':row['id'],'from':source,'to':target,'district':district})
assert len(changed) in (0,208) and len(remaining)==28
if not changed:
 print(json.dumps({'wholeMunicipalityAliasesCorrected':0,'remainingWardIndexGaps':28,'unchanged':True}))
 raise SystemExit(0)
for field in old:
 if field!='districtMemberships':assert old[field]==ballot[field],field
assert len(ballot['districtMemberships'])==len(old['districtMemberships'])
assert len({r['provenance']['quote'] for r in ballot['districtMemberships'] if '/ward:' not in r['memberOcdId']})==348
for quote,district in municipalities.items():
 assert any(r['provenance']['quote']==quote and r['memberOcdId'] in index and r['districtOcdId'].endswith(':'+str(district)) for r in ballot['districtMemberships']),quote
# All whole-municipality aliases now resolve; legitimate wards remain narrow.
assert [r['memberOcdId'] for r in ballot['districtMemberships'] if r['memberOcdId'] not in index]==[r['memberOcdId'] for r in remaining]
data['sourceReceipt']['reviewedAt']=at;data['sourceReceipt']['reviewedBy']='bl02-ma-membership-normalization'
source_paths=['data/ballot/sources/ba01-northeast/ma-2022-councillor-districts.rendered.txt','data/ballot/sources/ba01-northeast/ma-2025-census-cousub-gazetteer.txt','data/ballot/sources/ba01-northeast/ma-2020-census-county-fips.txt']
sources=[]
for relative in source_paths:
 p=root/relative;sha=hashlib.sha256(p.read_bytes()).hexdigest();receipts=[r for r in data['sourceReceipt']['sources'] if r['rawHash']==sha];assert receipts,relative
 sources.append({'path':relative,'sha256':sha,'sourceUrl':receipts[-1]['finalUrl'],'capturedAt':receipts[-1]['retrievedAt']})
for receipt in data['sourceReceipt']['sources']:
 if receipt['finalUrl']==mod.URL and receipt['rawHash']==sources[0]['sha256']:
  receipt['reviewedEvidence']='Official list replayed for 348 whole municipalities and 28 whole wards. BL-02 normalizes 208 whole-municipality aliases against the held ZIP geography index; stable membership IDs retained. Whole-city mappings for split Boston, Cambridge and Braintree are excluded. The ZIP index has no ward IDs; the 28 verified narrow ward memberships remain for exact ward selections.'
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
report={'step':'BL-02','state':'MA','checkedAt':at,'inputSha256':hashlib.sha256(before).hexdigest(),'outputSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'membershipsBefore':len(old['districtMemberships']),'membershipsAfter':len(ballot['districtMemberships']),'notInZipIndexBefore':len(missing),'wholeMunicipalityAliasesCorrected':len(changed),'notInZipIndexAfter':len(remaining),'wholeMunicipalitiesWithReachableMembership':348,'officialWardMembershipsRetained':28,'meaning':'The reported 236 unmatched memberships comprised 208 incorrect municipal aliases and 28 legitimate ward IDs absent from the ZIP index. Canonical local IDs replace the 208 municipal member values. Stable membership IDs stay unchanged. Metadata-only publication uses the existing explicit data update API; the ordinary record-change detector does not include memberships. All 348 whole municipalities reach their official Council district. Ward memberships are preserved without widening split cities.','sources':sources,'zipIndexShards':shards,'changes':changed,'splitCities':['Boston','Cambridge','Braintree'],'remainingWardIndexGaps':remaining}
(root/'data/ballot/reports/bl02-ma-memberships.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['wholeMunicipalityAliasesCorrected','membershipsBefore','membershipsAfter','notInZipIndexBefore','notInZipIndexAfter','wholeMunicipalitiesWithReachableMembership']}))
