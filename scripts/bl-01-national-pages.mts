/** Read-only page replay for all states, DC and territories, today and tomorrow. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
type PageReport={zip:string;day:string;contests:string[];cards:{id:string}[];retention:number;house:unknown[];senate:unknown[];stateHouse:unknown[]};
type PageRow=Partial<PageReport>&{state:string;zip:string;day:string;status:'PASS'|'FAILED';reason?:string};
const variable=process.argv.find(arg=>arg.startsWith('--connection-env='))?.slice(17);
assert.ok(variable && /^BL01_[A-Z_]+$/.test(variable),'Name an isolated-copy connection variable');
assert.ok(process.env[variable]);
const places={AL:'35801',AK:'99501',AZ:'85003',AR:'72201',CA:'94118',CO:'80202',CT:'06103',DE:'19901',DC:'20001',FL:'33139',GA:'30303',HI:'96813',ID:'83702',IL:'62701',IN:'46204',IA:'50309',KS:'66603',KY:'40601',LA:'70112',ME:'04330',MD:'21401',MA:'02108',MI:'48226',MN:'55101',MS:'39201',MO:'63103',MT:'59601',NE:'68508',NV:'89701',NH:'03301',NJ:'08608',NM:'87501',NY:'10025',NC:'28202',ND:'58501',OH:'44111',OK:'73102',OR:'97301',PA:'19107',RI:'02903',SC:'29201',SD:'57501',TN:'37203',TX:'77005',UT:'84111',VT:'05602',VA:'23219',WA:'98501',WV:'25301',WI:'53703',WY:'82001',PR:'00901',VI:'00802',AS:'96799',GU:'96910',MP:'96950'};
const selected=process.argv.find(arg=>arg.startsWith('--state='))?.slice(8);
assert.ok(!selected || selected in places);
const pending=Object.entries(places).filter(([state])=>!selected || state===selected),jurisdictions=pending.length;
const root=selected?`.scratch/bl-01/state-${selected}`:'.scratch/bl-01/all-states';
const rows:PageRow[]=[];await mkdir(root,{recursive:true});
await Promise.all(Array.from({length:3},async()=>{for(;;){const next=pending.shift();if(!next)return;const [state,zip]=next;
 const pair:PageRow[]=[];
 for(const day of ['2026-10-23','2026-10-24']){
  const dir=`${root}/${state}-${day}`;
  const result=await new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{const child=spawn(process.execPath,['--use-env-proxy','--experimental-strip-types','--import','./scripts/register-test-loader.mjs','scripts/bl-01-reader-replay.mts',`--connection-env=${variable}`,`--zip=${zip}`,`--day=${day}`,`--out=${dir}`],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));});
  await writeFile(dir+'.log',result.out+result.err);
  if(result.code!==0){pair.push({state,zip,day,status:'FAILED',reason:result.err.slice(-2200)});continue;}
  const report=JSON.parse(await readFile(dir+'/result.json','utf8')) as PageReport;pair.push({...report,state,status:'PASS'});
 }
 if(pair.every(r=>r.status==='PASS')){try{assert.deepEqual(pair[0].contests,pair[1].contests);}catch{pair[1].status='FAILED';pair[1].reason='Tomorrow contest IDs differ';}}
 rows.push(...pair);console.log(JSON.stringify({state,zip,days:pair.map(r=>({day:r.day,status:r.status,drawn:r.cards?.length,retention:r.retention,house:r.house?.length,senate:r.senate?.length,stateHouse:r.stateHouse?.length,reason:r.reason}))}));
 await writeFile(root+'/results.json',JSON.stringify(rows,null,2));
}}));
console.log(JSON.stringify({jurisdictions,runs:rows.length,failures:rows.filter(r=>r.status!=='PASS').map(({state,day,reason})=>({state,day,reason}))}));
process.exitCode=rows.some(row=>row.status!=='PASS')?1:0;
