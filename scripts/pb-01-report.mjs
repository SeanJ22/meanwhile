/** Summarize one state at a time; the country report reads only compact state summaries. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='.scratch/pb01/national',arg=process.argv.find(a=>a.startsWith('--state='))?.slice(8);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const counts=s=>({boardsNamed:s.boardsNamed,boardsShown:s.boardsShown,emptyShown:s.emptyShown,seatsShown:s.seatsShown,heldSeatsShown:s.heldSeatsShown});
const largest=(rows,key)=>{const out=new Map();for(const row of [...rows].sort((a,b)=>b[key]-a[key]))if(!out.has(row.zip))out.set(row.zip,row);return [...out.values()].slice(0,5);};
if(arg){
 assert.match(arg,/^[A-Z]{2}$/);const path=`${base}/${arg}`,r=await json(path+'/results.json');assert.ok(r.first&&r.tomorrow,'State replay incomplete');
 const projection=await json(path+'/projection-first.json'),byBody=new Map(projection.entities.map(e=>[e.id,e]));
 const missing=new Map();for(const m of r.first.missing){const group=missing.get(m.body)??{bodyId:m.body,source:m.source,heldSeats:0};group.heldSeats++;missing.set(m.body,group);}
 const unplaced=[...missing.values()].map(m=>{const e=byBody.get(m.bodyId),name=projection.fields.find(f=>f.entity_id===m.bodyId&&f.field==='name');return {...m,name:name?.value??e?.name??null,hasVerifiedName:!!name,parentId:e?.parent_id??null};});
 const answers=r.answers.map(a=>({state:arg,phase:a.phase,zip:a.zip,bytes:a.bytes,gzipBytes:a.gzipBytes,ms:a.ms,serverTiming:a.serverTiming,status:a.status,legistarBoards:a.legistar.length,empty:a.empty.length}));
 let page=[];try{page=await json(path+'/browser.json');}catch{}
 const sourceFailures=r.failures.filter(f=>f.stage!=='answer');
 const summary={state:arg,at:r.at,identities:r.identities,heldSeats:r.heldSeats,first:{...counts(r.first),boardsNamed:new Set(projection.fields.filter(f=>f.field==='name'&&byBody.has(f.entity_id)).map(f=>f.entity_id)).size},tomorrow:counts(r.tomorrow),placeFootprints:r.placeFootprints,
  productionReadBytes:r.productionReadBytes,retiredNames:r.retired.length,retiredRetained:r.retiredRetained,
  runs:r.runs.map(run=>({phase:run.phase,slug:run.slug,at:run.at,checkedAt:run.checkedAt,dueBoundary:run.dueBoundary,records:run.records,held:run.held,unchanged:run.unchanged,members:run.members,bodies:run.bodies,gaps:run.gaps.length,signature:run.signature})),
  sourceFailures,unplaced,answers,largest:largest(answers,'bytes'),slowest:largest(answers,'ms'),page,
  snapshotSha256:createHash('sha256').update(await readFile(path+'/snapshot.json')).digest('hex')};
 await writeFile(path+'/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({state:arg,first:summary.first,unplaced:unplaced.reduce((n,b)=>n+b.heldSeats,0),sourceFailures:sourceFailures.length,overTime:answers.filter(a=>a.ms>=3000).length}));
}else{
 const census=await json(base+'/census.json'),states=[...new Set(census.tenants.flatMap(t=>t.states))].sort(),rows=[];
 for(const state of states){const r=await json(`${base}/${state}/summary.json`);rows.push(r);}
 const sum=key=>rows.reduce((n,r)=>n+r[key],0),phaseSum=(phase,key)=>rows.reduce((n,r)=>n+r[phase][key],0),all=rows.flatMap(r=>r.answers);
 const report={checkedAt:new Date().toISOString(),censusAt:census.at,tenants:census.tenants.length,states:states.length,
  heldSeats:sum('heldSeats'),providedBaseline:10332,first:{boardsNamed:phaseSum('first','boardsNamed'),boardsShown:phaseSum('first','boardsShown'),emptyShown:phaseSum('first','emptyShown'),heldSeatsShown:phaseSum('first','heldSeatsShown'),seatsShown:phaseSum('first','seatsShown')},
  tomorrow:{boardsNamed:phaseSum('tomorrow','boardsNamed'),boardsShown:phaseSum('tomorrow','boardsShown'),emptyShown:phaseSum('tomorrow','emptyShown'),heldSeatsShown:phaseSum('tomorrow','heldSeatsShown'),seatsShown:phaseSum('tomorrow','seatsShown')},
  scheduledTenants:new Set(rows.flatMap(r=>r.runs.filter(run=>run.phase==='tomorrow').map(run=>run.slug))).size,footprintCount:sum('placeFootprints'),answerCount:all.length,retiredNames:sum('retiredNames'),productionReadBytes:sum('productionReadBytes'),
  budget:{uncompressedBytes:1_000_000,gzipBytes:100_000,completeAnswerMs:3000},
  failures:{overTime:all.filter(a=>a.ms>=3000),overBytes:all.filter(a=>a.bytes>=1_000_000||a.gzipBytes>=100_000),empty:all.filter(a=>a.empty>0),sources:rows.flatMap(r=>r.sourceFailures.map(f=>({state:r.state,...f})))},
  largest:largest(all,'bytes'),slowest:largest(all,'ms'),
  byState:rows.map(({answers:_,...row})=>row)};
 report.ready=!report.failures.overTime.length&&!report.failures.overBytes.length&&!report.failures.empty.length&&!report.failures.sources.length&&report.first.heldSeatsShown===report.heldSeats&&report.tomorrow.heldSeatsShown===report.heldSeats;
 const out='docs/measurements/pb-01';await mkdir(out,{recursive:true});await writeFile(out+'/national.json',JSON.stringify(report,null,2)+'\n');
 let table='| State | Boards named | Boards shown | Empty shown | Held seats shown / held |\n| --- | ---: | ---: | ---: | ---: |\n';
 for(const r of rows)table+=`| ${r.state} | ${r.first.boardsNamed.toLocaleString('en-US')} | ${r.first.boardsShown.toLocaleString('en-US')} | ${r.first.emptyShown} | ${r.first.heldSeatsShown.toLocaleString('en-US')} / ${r.heldSeats.toLocaleString('en-US')} |\n`;
 table+=`| **Total** | **${report.first.boardsNamed.toLocaleString('en-US')}** | **${report.first.boardsShown.toLocaleString('en-US')}** | **${report.first.emptyShown}** | **${report.first.heldSeatsShown.toLocaleString('en-US')} / ${report.heldSeats.toLocaleString('en-US')}** |\n`;
 const answerTable=rs=>'| ZIP | State | Bytes | Gzip bytes | Server total | Complete answer | Phase |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n'+rs.map(a=>`| ${a.zip} | ${a.state} | ${a.bytes.toLocaleString('en-US')} | ${a.gzipBytes.toLocaleString('en-US')} | ${/total;dur=(\d+)/.exec(a.serverTiming)?.[1]??'—'} ms | ${Math.round(a.ms).toLocaleString('en-US')} ms | ${a.phase} |`).join('\n')+'\n';
 await writeFile(base+'/tables.md',table+'\nLargest measured ZIP answers:\n\n'+answerTable(report.largest)+'\nSlowest measured ZIP answers:\n\n'+answerTable(report.slowest));
 console.log(JSON.stringify({ready:report.ready,held:report.heldSeats,shown:report.first.heldSeatsShown,unplaced:report.heldSeats-report.first.heldSeatsShown,empty:report.first.emptyShown,places:report.footprintCount,answers:report.answerCount,overTime:report.failures.overTime.length,sourceFailures:report.failures.sources.length}));
}
