from pathlib import Path
import fitz,re,json
p=Path(__file__).parent
d=fitz.open(p/'wayne-current-roster.pdf')
rows=[];all_rows=[];placeholder=[];excerpt=['OFFICE OF THE WAYNE COUNTY CLERK','NOVEMBER 3, 2026 GENERAL ELECTION','Official candidate list: native PDF geometry extraction of office, party/incumbency and candidate columns only; filed addresses and filing metadata are omitted from this reader evidence.']
for i,page in enumerate(d):
 spans=[s for b in page.get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']]
 offset=next(s['bbox'][0] for s in spans if s['text']=='CANDIDATE')-175.1905975341797
 headers=sorted([s for s in spans if re.search(r'\(\d+\) POSITION',s['text']) and 90<s['bbox'][1]<555],key=lambda s:s['bbox'][1])
 names=sorted([s for s in spans if 120+offset<s['bbox'][0]<126+offset and 90<s['bbox'][1]<555 and 12<s['size']<14 and s['text'].strip()],key=lambda s:s['bbox'][1])
 for hidx,h in enumerate(headers):
  title=h['text'].strip();top=h['bbox'][1];end=headers[hidx+1]['bbox'][1] if hidx+1<len(headers) else 555
  candidates=[];no_names=[]
  for n in names:
   if not top+8<n['bbox'][1]<end:continue
   party=[s for s in spans if 30+offset<s['bbox'][0]<40+offset and abs(s['bbox'][1]-n['bbox'][1])<9 and 12<s['size']<14]
   assert len(party)<=1,(i,title,n['text'],party)
   label=party[0]['text'].strip() if party else '';name=n['text'].strip();status=None
   if re.search(r'no candidate filed',name,re.I):no_names.append({'name':name,'party':label});continue
   candidates.append({'name':name,'partyLabel':'Nonpartisan' if label in ['Incum.','Incumbent',''] else label,'incumbent':True if label in ['Incum.','Incumbent'] else None,'sourcePartyColumn':label,'page':i+1})
  r={'title':title,'pages':[i+1],'voteFor':int(re.search(r'\((\d+)\) POSITION',title).group(1)),'termYears':int(re.search(r'(\d+) YEAR TERM',title).group(1)) if re.search(r'(\d+) YEAR TERM',title) else None,'candidates':candidates,'noCandidateFiledRows':no_names}
  old=next((x for x in all_rows if x['title']==title),None)
  if old:
   old['pages']+=r['pages'];old['candidates']+=candidates;old['noCandidateFiledRows']+=no_names
  else:all_rows.append(r)
  excerpt.append(f'Page {i+1}\n'+title+'\n'+'\n'.join(a['sourcePartyColumn']+'\n'+a['name'] for a in candidates)+'\n'+'\n'.join(x['party']+'\n'+x['name'] for x in no_names))
for r in all_rows:
 r['exactText']=r['title']+'\n'+'\n'.join(a['sourcePartyColumn']+'\n'+a['name'] for a in r['candidates'])
 if min(r['pages'])>=10 and not re.sub(r'\s+',' ',r['title']).startswith(('GOVERNOR OF WAYNE STATE UNIVERSITY','JUSTICE OF SUPREME COURT')):rows.append(r)
(p/'roster-safe-excerpt.txt').write_text('\n\n'.join(excerpt)+'\n')
(p/'parsed-roster-all.json').write_text(json.dumps(all_rows,indent=2)+'\n')
(p/'parsed-roster-local.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'allContests':len(all_rows),'allNames':sum(len(r['candidates']) for r in all_rows),'localContests':len(rows),'localNames':sum(len(r['candidates']) for r in rows),'placeholderRows':sum(len(r['noCandidateFiledRows']) for r in rows),'localSummary':[{'title':r['title'],'names':len(r['candidates']),'pages':r['pages']} for r in rows]},indent=2))
