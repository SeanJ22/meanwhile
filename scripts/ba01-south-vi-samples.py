"""Compare every sample candidate against both official certified tables."""
from pathlib import Path
import subprocess
import re,json,unicodedata,hashlib
P=Path(__file__).resolve().parents[1]/'data/ballot/evidence/ba01-south/territories'
cert=json.loads((P/'verified-rosters.json').read_text())['VI']
def key(s):return ''.join(re.findall(r'[a-z0-9]+',unicodedata.normalize('NFKD',s.lower())))
source_candidates={key(c['name']):c for c in cert}
assert len(source_candidates)==70
sources={};combined={}
for stem,region in [('vi-stx-sample','St. Croix'),('vi-stt-stj-sample','St. Thomas/St. John')]:
 raw=(P/(stem+'.pdf')).read_bytes();meta=json.loads((P/(stem+'.pdf.source.json')).read_text());assert hashlib.sha256(raw).hexdigest()==meta['sha256']
 s=subprocess.run(['pdftotext','-raw',str(P/(stem+'.pdf')),'-'],check=True,capture_output=True).stdout.decode();assert s==(P/(stem+'-raw.txt')).read_text()
 headings=list(re.finditer(r'^(DELEGATE TO THE HOUSE OF\nREPRESENTATIVES|GOVERNOR & LIEUTENANT\nGOVERNOR|LEGISLATURE OF THE VIRGIN\nISLANDS AT LARGE|LEGISLATURE OF THE VIRGIN\nISLANDS|BOARD OF EDUCATION|BOARD OF ELECTIONS(?: - ST[J|T])?)\n',s,re.M))
 assert len(headings)==(6 if region=='St. Croix' else 7),(region,len(headings))
 races=[]
 for i,h in enumerate(headings):
  label=' '.join(h[1].split());body=s[h.end():headings[i+1].start() if i+1<len(headings) else len(s)]
  vote=int(re.search(r'^Select no more than (\d+)',body,re.M)[1])
  body=body.split('Seleccione no más de '+str(vote)+'\n',1)[1].split('Write-in',1)[0]
  candidates=[]
  for row in re.finditer(r'(.*?)^(Democrat|Independent|Republican|ICM) /[^\n]+\n',body,re.S|re.M):
   name=re.sub(r'\s+\d+\s*$','',' '.join(row[1].split())).strip()
   candidates.append({'name':name,'partyLabel':row[2]})
  assert candidates,(region,label,body)
  statewide=label in ['DELEGATE TO THE HOUSE OF REPRESENTATIVES','GOVERNOR & LIEUTENANT GOVERNOR','LEGISLATURE OF THE VIRGIN ISLANDS AT LARGE']
  race_key=label+'|'+('Virgin Islands' if statewide else region)
  races.append({'office':label,'scope':'Virgin Islands' if statewide else region,'voteFor':vote,'candidates':candidates})
  if race_key in combined:assert combined[race_key]==races[-1]
  combined[race_key]=races[-1]
 sources[region]={'contests':len(races),'choices':sum(len(r['candidates']) for r in races),'people':sum(2 if r['office']=='GOVERNOR & LIEUTENANT GOVERNOR' else 1 for r in races for c in r['candidates']),'races':races}
# These five differences are visible in the two saved official documents.
# Keep both strings; the newer ballot printing supplies the display value.
variants={
 'Julian S. Viera':'Julian S. Veira',
 'Mustasem Moe Mustafa':'Mutasem Moe Mustafa',
 'Kurt Vialet':'Kurt A. Vialet',
 'Franklin D. Johnson':'Franklin Johnson',
 'Eugene D. Farrell':'Eugene D.J. Farrell',
}
matched={};unmatched=[];variant_rows=[]
for r in combined.values():
 for c in r['candidates']:
  k=key(c['name'])
  if c['name'] in variants:
   k=key(variants[c['name']]);variant_rows.append({'sampleName':c['name'],'certifiedName':variants[c['name']],'office':r['office'],'scope':r['scope']})
  if k in source_candidates:
   assert source_candidates[k]['partyLabel']==c['partyLabel'],c
   matched[k]=c
  else:unmatched.append((r,c))
print('certified',len(cert),'sample',sum(len(r['candidates']) for r in combined.values()),'matched with explicit source variants',len(matched))
assert not unmatched and set(matched)==set(source_candidates),(unmatched,[c for k,c in source_candidates.items() if k not in matched])
assert len(variant_rows)==5
print('All 70 candidate units matched; all printed party labels agree; 5 official name variants retained.')
out={'officialNameVariants':variant_rows,'sampleDistricts':sources,'uniqueContests':len(combined),'choices':sum(len(r['candidates']) for r in combined.values()),'people':sum(2 if r['office']=='GOVERNOR & LIEUTENANT GOVERNOR' else 1 for r in combined.values() for c in r['candidates']),'races':list(combined.values())}
(P/'vi-sample-comparison.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
