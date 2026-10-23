/** Enumerate production Legistar tasks and counts using read-only handles. */
import {neon} from '@neondatabase/serverless';
import {mkdir,writeFile} from 'node:fs/promises';
import {heldLegistarMemberTasks} from '../lib/sources/legistar/members-tasks.ts';
import {legistarTenantDoors} from '../lib/doors/legistar-tenant.ts';
const out='.scratch/pb01/national';await mkdir(out+'/tenants',{recursive:true});
const readonly=(url:string)=>{const sql=neon(url);return async(t:string,p:readonly unknown[]=[]) => (await sql.transaction([sql.query(t,[...p])],{readOnly:true}))[0];};
const reader=readonly(process.env.WTP_PRODUCTION_DATABASE_URL_READONLY!),doors=readonly(process.env.WTP_CONTROL_PLANE_DATABASE_URL_READONLY!);
const tasks=await heldLegistarMemberTasks(doors),tenants=[];
for(const task of tasks){const slug=task.id.slice('legistar-members:'.length),bindings=await legistarTenantDoors(doors,slug);await writeFile(`${out}/tenants/${slug}.json`,JSON.stringify(bindings));tenants.push({slug,bindingCount:bindings.length,states:[...new Set(bindings.flatMap(b=>/\/state:([a-z]{2})/.exec(b.ocdId??'')?.[1]?.toUpperCase()??[]))]});}
const counts=await reader(`SELECT e.state,f.produced_by,count(DISTINCT f.entity_id) FILTER(WHERE f.field='name' AND e.kind='body')::int AS names,count(*) FILTER(WHERE f.field LIKE 'member:%')::int AS seats,count(DISTINCT f.entity_id) FILTER(WHERE f.field LIKE 'member:%')::int AS boards FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.status='live' AND f.produced_by LIKE 'legistar-members:%' GROUP BY e.state,f.produced_by ORDER BY e.state,f.produced_by`);
await writeFile(out+'/census.json',JSON.stringify({at:new Date().toISOString(),tenants,counts},null,2));console.log(JSON.stringify({tenants:tenants.length,states:[...new Set(tenants.flatMap(t=>t.states))].sort(),unplaced:tenants.filter(t=>t.states.length!==1).map(t=>t.slug),seats:counts.reduce((n,r)=>n+Number(r.seats),0)}));
