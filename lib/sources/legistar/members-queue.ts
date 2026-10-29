import { workId, workList, type WorkInput } from "../../core/work.ts";
import { LEGISTAR_TENANT_SQL } from "../../doors/legistar-tenant.ts";
import type { Query } from "../../facts/publish.ts";

export const LEGISTAR_MEMBER_SUBJECT = "legistar-members:";
export const LEGISTAR_MEMBER_CADENCE_MS = 12 * 60 * 60_000;
// Expected SQL request and response bytes for one 55-minute worker turn, including record publication.
export const LEGISTAR_MEMBER_DATABASE_BYTES = 450_000_000;
export const legistarMemberWork = (query:Query,owner:string,now?:()=>Date)=>workList(query,{owner,leaseMs:300_000,now});

/** Seed identities only; each claimant opens just its own tenant's bindings. A tenant's next check is made when it is due. */
export async function seedLegistarMemberWork(list:ReturnType<typeof legistarMemberWork>,doors:Query):Promise<number> {
  const clients=await doors(`SELECT (${LEGISTAR_TENANT_SQL}) AS slug,min(value->>'ocdId') AS place
    FROM cp_doors WHERE (${LEGISTAR_TENANT_SQL}) IS NOT NULL GROUP BY 1`);
  await list.spawnDue();
  return list.ensure(clients.map((client):WorkInput=>{
    const slug=String(client.slug);
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
    const subjectId=LEGISTAR_MEMBER_SUBJECT+slug,url=`https://webapi.legistar.com/v1/${slug}/officerecords`;
    return {kind:"load",tier:"clock",subjectId,url,placeId:String(client.place??"ocd-division/country:us"),
      series:workId({kind:"load",subjectId,url}),origin:{from:"loader"},source:{source:"Legistar members"}};
  }));
}
