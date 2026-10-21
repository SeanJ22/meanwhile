"""Replay five local Ohio measure questions from official sample PDF columns."""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'data/ballot/evidence/ba01-great-lakes'
BASE='ocd-division/country:us/state:oh'
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def clean(s):return re.sub(r'\s+',' ',s).strip()
def raw(stem):return gzip.decompress((EVIDENCE/(stem+'.raw.gz')).read_bytes())
def provenance(data,stem,org):
    meta=json.loads((EVIDENCE/(stem+'.retrieval.json')).read_text());assert meta['httpStatus']==200 and meta['rawHash']==hashlib.sha256(raw(stem)).hexdigest()
    # Reuse the original sample receipt when already present.
    assert any(x['finalUrl']==meta['finalUrl'] and x['rawHash']==meta['rawHash'] for x in data['sourceReceipt']['sources']),stem
    return {'sourceUrl':meta['finalUrl'],'sourceOrg':org,'collectedAt':meta['retrievedAt'],'verifiedAt':NOW}

def extract(pdf,page,x,width,height):
    return subprocess.run(['pdftotext','-f',str(page),'-l',str(page),'-x',str(x),'-y','0','-W',str(width),'-H',str(height),'-layout',str(pdf),'-'],capture_output=True,text=True,check=True).stdout

def questions():
    with tempfile.TemporaryDirectory(prefix='ba01-oh-measures-') as directory:
        p=Path(directory);h=p/'hamilton.pdf';h.write_bytes(raw('oh-county-sample-hamilton'));s=p/'summit.pdf';s.write_bytes(raw('oh-county-sample-summit'))
        ht=clean(extract(h,3,218,196,1008));assert '4 PROPOSED TAX LEVY (ADDITIONAL) CINCINNATI CITY SCHOOL DISTRICT' in ht and '10 PROPOSED TAX LEVY (RENEWAL AND INCREASE) HAMILTON COUNTY' in ht
        tax=ht[ht.index('An additional tax'):ht.index('FOR THE TAX LEVY')].strip();renewal=ht[ht.index('A renewal of 4.51 mills'):];renewal=renewal[:renewal.index('FOR THE TAX LEVY')].strip()
        assert tax.endswith('which is 6% of those expenditures.') and renewal.endswith('due in calendar year 2027.')
        st=clean(extract(s,2,395,217,1296));third=clean(extract(s,3,0,210,1296));rows=[]
        for number,text in [(11,st[st.index('Issue 11'):st.index('Issue 12')]),(12,st[st.index('Issue 12'):]),(13,third[third.index('Issue 13'):])]:
            assert 'Proposed Charter Amendment City of Akron' in text
            question=text[text.index('Shall'):text.index('?')+1]
            assert len(question)>400 and 'City of Akron' in question
            rows.append((f'oh-ba01-akron-issue-{number}',f'Akron Issue {number} — Proposed Charter Amendment','place:akron',str(number),question,'oh-county-sample-summit','Summit County Board of Elections'))
        return [
            ('oh-ba01-cincinnati-csd-issue-4','Cincinnati City School District Issue 4 — Proposed Tax Levy (Additional)','school_district:cincinnati_city_school_district','4',tax,'oh-county-sample-hamilton','Hamilton County Board of Elections'),
            ('oh-ba01-hamilton-issue-10','Hamilton County Issue 10 — Proposed Tax Levy (Renewal and Increase)','county:hamilton','10',renewal,'oh-county-sample-hamilton','Hamilton County Board of Elections'),*rows]

def main(write=False):
    path=ROOT/'data/ballot/2026-general/oh.json';data=json.loads(path.read_text());ballot=next(iter(data['ballots'].values()));before=(len(ballot['contests']),len(ballot['measures']));results=[]
    for cid,title,division,number,question,stem,org in questions():
        prov=provenance(data,stem,org);prov['quote']=question
        if not any(x['id']==cid for x in ballot['contests']):ballot['contests'].append({'id':cid,'electionId':ballot['election']['id'],'ocdId':BASE+'/'+division,'divisionVintage':'2026','title':title,'type':'MEASURE','voteFor':None,'termYears':None,'scopeNote':None,'measureTextUrl':prov['sourceUrl'],'provenance':prov})
        prior=[x for x in ballot['measures'] if x['contestId']==cid]
        if prior:assert prior[0]['questionText']==question
        else:ballot['measures'].append({'id':cid+'-question','contestId':cid,'officialNumber':number,'questionText':question,'officialStatement':None,'provenance':prov})
        results.append({'contestId':cid,'title':title,'scope':division,'sourceUrl':prov['sourceUrl'],'question':question})
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'OH','before':before,'after':[len(ballot['contests']),len(ballot['measures'])],'verifiedLocalMeasures':5,'measures':results,'remaining':'Saved official source/catalog replay only. Other precinct/local measures and full43215 paper/live reconciliation remain open.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args();print(json.dumps(main(a.write),indent=2))
