import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {authorityRecordSource,readAuthorityRecords,publishStateAuthorityRecords,type StateRecordIndex,type StateRecordPublication} from '../lib/meetings/authority-records.ts';
import {LocalFileArtifactStore} from '../lib/meetings/edge-store.ts';
const states='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.toLowerCase().split(' ');
const count=Number(process.argv[3]??92201),mode=process.argv[2];
const root=process.argv[4]??'.scratch/ne01-national-'+count;
mkdirSync(root,{recursive:true});
const store=new LocalFileArtifactStore(root);
const began=performance.now();
const weights=states.map(state=>{const held=JSON.parse(readFileSync(`data/derived/registration/${state}.json`,'utf8'));return {state,bodies:held.governments.length,places:held.divisions.length}});
const allocate=(total:number,field:'bodies'|'places')=>{
 const sum=weights.reduce((n,row)=>n+row[field],0),values=weights.map(row=>Math.max(1,Math.floor(total*row[field]/sum)));
 let left=total-values.reduce((n,value)=>n+value,0);
 for(const index of weights.map((_,index)=>index).sort((a,b)=>(total*weights[b][field]/sum)%1-(total*weights[a][field]/sum)%1))if(left>0){values[index]++;left--}
 return values;
};
const bodies=allocate(count,'bodies'),places=allocate(85000,'places');let bodyOffset=0,placeOffset=0;
const areas=states.map((state,index)=>{const row={state,bodies:bodies[index],places:places[index],bodyOffset,placeOffset};bodyOffset+=row.bodies;placeOffset+=row.places;return row});
const areaForBody=(index:number)=>areas.find(row=>index>=row.bodyOffset&&index<row.bodyOffset+row.bodies)!;
const areaForPlace=(index:number)=>areas.find(row=>index>=row.placeOffset&&index<row.placeOffset+row.places)!;
const division=(i:number)=>{const area=areaForPlace(i);return `ocd-division/country:us/state:${area.state}/place:bench_${i-area.placeOffset}`};
const bodyDivision=(i:number)=>{const area=areaForBody(i);return division(area.placeOffset+(i-area.bodyOffset)%area.places)};
const body=(i:number)=>`${bodyDivision(i)}#board_${i}`;
if(mode==='build'){
 const held=JSON.parse(readFileSync('tests/fixtures/reader-member.json','utf8'));
 const base={registry:{divisions:[],bodies:[]},bodyRosters:[],rosterReaderDispositions:[]};
 let largestPlaceBytes=0,largestPlaceRecords=0,sourceBytes=0;
 async function* inputs():AsyncGenerator<StateRecordPublication>{
  for(const area of areas){
   async function* publications(){
    for(let offset=0;offset<area.places;offset++){
     const placeIndex=area.placeOffset+offset,id=division(placeIndex);
     yield {owner:id,version:'generated:1',load:async()=>{
      const ids:number[]=[];
      for(let n=offset;n<area.bodies;n+=area.places)ids.push(area.bodyOffset+n);
      const value={
       registry:{divisions:[{ocdId:id,name:`Generated place ${placeIndex}`}],
        bodies:ids.map(i=>({id:body(i),ocdId:id,name:`Generated government ${i}`,kind:'GENERAL_PURPOSE'}))},
       bodyRosters:ids.map(i=>({bodyId:body(i),members:Array.from({length:15},(_,j)=>({...held,id:`roster:bench_${i}_${j}`,personId:`ocd-person/bench_${i}_${j}`,officeholderId:`roster:bench_${i}_${j}`,name:held.name}))})),
       rosterReaderDispositions:ids.flatMap(i=>Array.from({length:15},(_,j)=>({sourceId:`roster:bench_${i}_${j}`,canonicalId:`roster:bench_${i}_${j}`,state:'READER_ELIGIBLE',reason:'Each fact checked against its saved source page.'})))
      };
      const source=authorityRecordSource(value);
      const records=source.records.map(row=>{
       const path=[...row.path];
       if(path[0]==='registry')path[2]=path[1]==='divisions'?placeIndex:ids[Number(path[2])];
       else if(path[0]==='bodyRosters')path[1]=ids[Number(path[1])];
       else if(path[0]==='rosterReaderDispositions')path[1]=ids[Math.floor(Number(path[1])/15)]*15+Number(path[1])%15;
       return {...row,path};
      });
      const bytes=Buffer.byteLength(JSON.stringify({base,records}));
      sourceBytes+=bytes;largestPlaceBytes=Math.max(largestPlaceBytes,bytes);largestPlaceRecords=Math.max(largestPlaceRecords,records.length);
      return {base,records};
     }};
    }
   }
   yield {state:area.state,version:'generated:'+area.state,base,replace:true,places:publications};
  }
 }
 const index=await publishStateAuthorityRecords(inputs(),store);
 writeFileSync(root+'/index.json',JSON.stringify(index));
 console.log(JSON.stringify({mode,count,places:85000,people:count*15,states:states.length,largestState:areas.reduce((a,b)=>a.bodies>b.bodies?a:b),ms:performance.now()-began,peakRssBytes:process.resourceUsage().maxRSS*1024,indexBytes:Buffer.byteLength(JSON.stringify(index)),largestPlaceBytes,largestPlaceRecords,sourceBytes,dbReadBytes:0,dbWriteBytes:0}));
}else{
 const index=JSON.parse(readFileSync(root+'/index.json','utf8')) as StateRecordIndex;
 let bytes=0,fetches=0,maxConcurrent=0,active=0;
 const counted=new Proxy(store,{get(target,key){if(key==='readBytes')return async(path:string)=>{fetches++;active++;maxConcurrent=Math.max(maxConcurrent,active);try{const value=await target.readBytes(path);bytes+=value?.length??0;return value}finally{active--}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 let slowestMs=0,firstMs=0,requests=0;
 const runs=mode==='all'?count+85000:states.length;
 for(let i=0;i<runs;i++){
  const start=performance.now();
  const id=mode==='all'?(i<85000?division(i):bodyDivision(i-85000)):division(areas[i].placeOffset);
  const selected=await readAuthorityRecords(index,counted,{keys:new Set([id])}) as { registry: { bodies: {ocdId: string}[] }; bodyRosters: {members: unknown[]}[]; rosterReaderDispositions: unknown[] };
  assert.ok(selected.registry.bodies.every((row)=>row.ocdId===id));

  assert.equal(selected.bodyRosters.reduce((n,row)=>n+row.members.length,0),selected.registry.bodies.length*15);
  assert.equal(selected.rosterReaderDispositions.length,selected.registry.bodies.length*15);
  const ms=performance.now()-start;slowestMs=Math.max(slowestMs,ms);if(!i)firstMs=ms;requests++;
 }
 console.log(JSON.stringify({mode,count,requests,ms:performance.now()-began,firstMs,slowestMs,bytes,fetches,maxConcurrent,peakRssBytes:process.resourceUsage().maxRSS*1024,dbReadBytes:0,dbWriteBytes:0}));
}
