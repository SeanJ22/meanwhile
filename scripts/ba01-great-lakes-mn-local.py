"""Replay official Minnesota general roster, public sample ballots, and district law.

The SOS public portal supplies official ballot JSON and original sample PDFs. The
same-field replay includes every named candidate, excluding blank WRITE-IN lines.
New judicial-district memberships follow Minnesota Statutes 2.722 county lists.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
STATE_BASE='ocd-division/country:us/state:mn'
COUNTYWIDE={'County Sheriff','County Attorney','County Auditor','County Treasurer','County Auditor/Treasurer','County Recorder'}

def raw(name):return gzip.decompress((EVIDENCE/name).read_bytes())
def clean(value):return re.sub(r'\s+',' ',value).strip()
def slug(value):return re.sub('[^a-z0-9]+','_',value.lower()).strip('_')
def capture_time(name):return datetime.fromtimestamp((EVIDENCE/name).stat().st_mtime,timezone.utc).isoformat().replace('+00:00','Z')

def receipt(data,name,url,publisher='Minnesota Secretary of State',source_class='ELECTION_AUTHORITY'):
    digest=hashlib.sha256(raw(name)).hexdigest()
    if not any(s['finalUrl']==url and s['rawHash']==digest for s in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append({'requestedUrl':url,'finalUrl':url,'httpStatus':200,'retrievedAt':capture_time(name),'rawHash':digest,'publisher':publisher,'sourceClass':source_class,
            'reviewedEvidence':f'Original public source bytes saved compressed at data/ballot/evidence/ba01-great-lakes/{name}. Raw hash identifies decompressed original bytes. Source-bound replay validates jurisdiction, office and all named candidates; PDF text or its documented embedded-font mapping confirms names.'})
    return {'sourceUrl':url,'sourceOrg':publisher,'collectedAt':capture_time(name),'verifiedAt':NOW}


def add_contest(data,ballot,title,division,source_rows,meta,stem,pdf_text,vote_for=None):
    # Candidate data remain uniform for winners, challengers and unopposed candidates.
    assert source_rows and all(r['CandidateScreenName']!='WRITE-IN' for r in source_rows)
    for row in source_rows:
        name=row['CandidateScreenName']
        # One county PDF embeds characters offset by -29 in its font mapping.
        encoded=''.join(chr(ord(c)-29) for c in name) if all(ord(c)>=29 for c in name) else ''
        assert name.casefold() in clean(pdf_text).casefold() or encoded and encoded.casefold() in pdf_text.casefold(),(stem,name)
        assert row['PartyName']=='NONPARTISAN',(stem,name,row['PartyName'])
    contest_prov=receipt(data,stem+'.pdf.gz',meta['sampleUrl'])
    candidate_prov=receipt(data,stem+'.ballot.json.gz',meta['ballotUrl'])
    matches=[c for c in ballot['contests'] if c['title']==title and c['ocdId']==division]
    contest_id=matches[0]['id'] if matches else f'mn-ba01-{slug(title)}-{slug(division.split("/")[-1])}'
    if not matches:
        ballot['contests'].append({'id':contest_id,'electionId':ballot['election']['id'],'ocdId':division,'divisionVintage':'2026','title':title,'type':'CANDIDACY','candidateListComplete':True,'voteFor':vote_for,'termYears':None,'scopeNote':None,
            'provenance':{**contest_prov,'quote':source_rows[0]['OfficeTitle']}})
    for row in source_rows:
        name=row['CandidateScreenName']
        if any(c['contestId']==contest_id and clean(c['givenName']+' '+c['familyName'])==name for c in ballot['candidacies']):continue
        ballot['candidacies'].append({'id':contest_id+'-candidate-'+slug(name),'contestId':contest_id,'familyName':name,'givenName':'','partyLabel':'NP','slogan':None,'incumbent':None,'websiteUrl':row['CampaignWebsite'] or None,
            'provenance':{**candidate_prov,'quote':f'{row["OfficeTitle"]} | {name} | {row["PartyName"]}'}})


def add_minneapolis(data,ballot,roster):
    stem='mn-district-4-55415';meta=json.loads((EVIDENCE/(stem+'.retrieval.json')).read_text())
    sample=json.loads(raw(stem+'.ballot.json.gz'));text=raw(stem+'.pdf.txt.gz').decode()
    assert sample['PollingResult']['CountyName']=='Hennepin' and sample['PollingResult']['SchoolDistrict']=='1'
    groups=defaultdict(list)
    for row in sample['Ballots']:
        if row['CandidateScreenName']!='WRITE-IN':groups[row['OfficeTitle']].append(row)
    title='County Commissioner District 3';rows=groups[title]
    assert {(r['CandidateScreenName'],'NP') for r in rows}==roster[(27,title)]
    # This district contest is never attached countywide. Reader boundary resolution
    # remains explicit unfinished work until commissioner district geometry is used.
    add_contest(data,ballot,'Hennepin County — '+title,STATE_BASE+'/county:hennepin/council_district:3',rows,meta,stem,text)
    school='School Board Member At Large (SSD #1) (Elect 2)';rows=groups[school]
    assert {r['CandidateScreenName'] for r in rows}=={'Christin Crabtree','Stephanie Johnson','Collin Beachy','Michael Baskins'}
    from lxml import html
    scope=clean(html.fromstring(raw('mn-minneapolis-school-scope.html.gz')).text_content())
    assert 'governs Special School District No. 1 (Minneapolis Public Schools)' in scope
    assert 'three are elected at-large, representing the entire city' in scope
    census=json.loads(raw('mn-55415-school-census.json.gz'))
    district=census['features'][0]['attributes']
    assert district['NAME']=='Minneapolis Public School District' and district['GEOID']=='2721240'
    census_meta=json.loads((EVIDENCE/'mn-55415-school-census.retrieval.json').read_text())
    assert census_meta['httpStatus']==200 and census_meta['rawHash']==hashlib.sha256(raw('mn-55415-school-census.json.gz')).hexdigest()
    receipt(data,'mn-55415-school-census.json.gz',census_meta['finalUrl'],'U.S. Census Bureau','OFFICIAL_PUBLISHER')
    division=STATE_BASE+'/school_district:'+slug(district['NAME'])
    add_contest(data,ballot,'Minneapolis Public Schools — '+school,division,rows,meta,stem,text,vote_for=2)
    prov=receipt(data,'mn-minneapolis-school-scope.html.gz','https://vote.minneapolismn.gov/candidates/filing-for-office/offices-on-the-ballot/','Minneapolis Elections and Voter Services')
    member={'id':'mn-ba01-minneapolis-school-district-at-large','memberOcdId':STATE_BASE+'/place:minneapolis','districtOcdId':division,
        'provenance':{**prov,'quote':'Six represent geographic districts (aligned with Minneapolis Park and Recreation Board districts) and three are elected at-large, representing the entire city.'}}
    if not any(x['id']==member['id'] for x in ballot['districtMemberships']):ballot['districtMemberships'].append(member)
    return {'sampleUrl':meta['sampleUrl'],'precinct':meta['precinct'],'sourceContests':len(groups),'schoolAtLargeContests':1,'schoolAtLargeCandidates':4,'commissionerDistrictContests':1,'commissionerDistrictCandidates':2,
        'remainingReaderMapping':'County commissioner District 3 is correctly district-scoped. ZIP/address projection does not yet resolve its district, so this replay does not claim reader/live sample completeness.'}


def main(write):
    path=ROOT/'data/ballot/2026-general/mn.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=(len(ballot['contests']),len(ballot['candidacies']))
    roster=defaultdict(set)
    for row in csv.reader(io.StringIO(raw('mn-general-export.txt.gz').decode('utf-8-sig')),delimiter=';'):
        if len(row)>6:roster[(int(row[4]),row[3])].add((row[1],row[6]))
    counties={int(row[0]):row[1] for row in csv.reader(io.StringIO(raw('mn-county-codes.txt.gz').decode('utf-8-sig')),delimiter=';') if len(row)>1}
    county_codes={slug(name):code for code,name in counties.items()}
    seen_judges={};county_results=[]
    for meta_path in sorted(EVIDENCE.glob('mn-*-*.retrieval.json')):
        meta=json.loads(meta_path.read_text())
        if not all(k in meta for k in ['ballotUrl','sampleUrl','county','judicialDistrict']):continue
        stem=meta_path.name.removesuffix('.retrieval.json');sample=json.loads(raw(stem+'.ballot.json.gz'))
        place=sample['PollingResult'];assert place['ElectionDate'].startswith('11/03/2026') and place['CountyName']==meta['county']
        county_code=county_codes[slug(meta['county'])];assert int(place['JudicialDistrict'])==int(meta['judicialDistrict'])
        groups=defaultdict(list)
        for row in sample['Ballots']:
            if row['CandidateScreenName']!='WRITE-IN':groups[row['OfficeTitle']].append(row)
        text=raw(stem+'.pdf.txt.gz').decode()
        count=0;candidate_count=0
        for title,rows in groups.items():
            judicial=re.match(r'Judge - (\d+)(?:st|nd|rd|th) District Court \d+$',title)
            if judicial and title not in seen_judges:
                assert int(judicial.group(1))==int(meta['judicialDistrict'])
                assert {(r['CandidateScreenName'],'NP') for r in rows}==roster[(88,title)],title
                add_contest(data,ballot,title,STATE_BASE+'/judicial_district:'+judicial.group(1),rows,meta,stem,text)
                seen_judges[title]=len(rows)
            elif title in COUNTYWIDE:
                assert {(r['CandidateScreenName'],'NP') for r in rows}==roster[(county_code,title)],(meta['county'],title)
                add_contest(data,ballot,meta['county']+' County — '+title,STATE_BASE+'/county:'+slug(meta['county']),rows,meta,stem,text)
                count+=1;candidate_count+=len(rows)
        county_results.append({'county':meta['county'],'zipSample':meta['zip'],'precinct':meta['precinct'],'sampleContests':len(groups),'verifiedCountywideContests':count,'verifiedCountywideCandidates':candidate_count,'sampleUrl':meta['sampleUrl']})
    judicial_source={title for (county,title) in roster if county==88 and re.match(r'Judge - \d+(?:st|nd|rd|th) District Court \d+$',title)}
    assert set(seen_judges)==judicial_source and len(seen_judges)==114 and sum(seen_judges.values())==117
    statute=clean(raw('mn-judicial-districts-statute.html.gz').decode())
    from lxml import html
    statute=clean(html.fromstring(raw('mn-judicial-districts-statute.html.gz')).text_content())
    body=statute[statute.index('Subdivision 1.Description.'):statute.index('Subd. 2.Altering boundaries.')]
    districts=re.findall(r'(\d{1,2})\. ([A-Z].*?); \d+ judges;',body)
    assert len(districts)==10,districts
    memberships=ballot.setdefault('districtMemberships',[]);all_counties=[]
    prov=receipt(data,'mn-judicial-districts-statute.html.gz','https://www.revisor.mn.gov/statutes/cite/2.722','Minnesota Revisor of Statutes','OFFICIAL_PUBLISHER')
    for number,names in districts:
        county_names=[n.strip() for n in names.replace(', and ', ', ').replace(' and ', ', ').split(',')]
        for county in county_names:
            county_id=slug(county);assert county_id in county_codes,county;all_counties.append(county_id)
            row={'id':f'mn-ba01-county-{county_id}-judicial-district-{number}','memberOcdId':STATE_BASE+'/county:'+county_id,'districtOcdId':STATE_BASE+'/judicial_district:'+number,
                'provenance':{**prov,'quote':f'{number}. {names}'}}
            if not any(x['id']==row['id'] for x in memberships):memberships.append(row)
    assert len(all_counties)==87 and len(set(all_counties))==87
    minneapolis=add_minneapolis(data,ballot,roster)
    note='BA-01: All 221 federal, statewide and legislative candidate contests match the official general-election export. Official sample ballots add all 114 district-court contests with 117 candidates, countywide offices in 15 counties, Hennepin Commissioner District 3, and Minneapolis school at-large. Whole-county judicial memberships follow Minnesota Statutes 2.722. Minneapolis at-large school coverage follows the city election office. Other county, city, school and special-district contests and local measures remain open; commissioner District 3 reader boundary resolution is not yet implemented.'
    if note not in ballot.setdefault('coverageNotes',[]):ballot['coverageNotes'].append(note)
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'MN','before':before,'after':[len(ballot['contests']),len(ballot['candidacies'])],'judicialContests':len(seen_judges),'judicialCandidates':sum(seen_judges.values()),'countyToJudicialDistrictMemberships':87,'countywideSources':county_results,'minneapolisAdditional':minneapolis,
        'remaining':'County commissioner, park, soil/water and school district elections and local measures remain open. These samples establish the added countywide/judicial contests, not whole-county or every-ZIP completeness.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--write',action='store_true');args=parser.parse_args();print(json.dumps(main(args.write),indent=2))
