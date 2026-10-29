import { neon } from "../../db/client.ts";
import { workId, workList } from "../../core/work.ts";
import { LEGISTAR_TENANT_SQL } from "../../doors/legistar-tenant.ts";
import type { Query } from "../../facts/publish.ts";

export const LEGISTAR_MEMBER_SUBJECT = "legistar-members:";
export const LEGISTAR_MEMBER_CADENCE_MS = 12 * 60 * 60_000;
// Expected SQL request and response bytes for one 55-minute worker turn, including record publication.
export const LEGISTAR_MEMBER_DATABASE_BYTES = 450_000_000;
export function legistarDoorQuery(): Query {
  const url=process.env.WTP_CONTROL_PLANE_DATABASE_URL?.trim();
  if (!url) throw new Error("LEGISTAR_MEMBERS_DOORS_UNAVAILABLE");
  const sql=neon(url);
  return async (text,params=[])=>await sql.query(text,[...params]) as Record<string,unknown>[];
}
export const legistarMemberWork = (query:Query,owner:string,now?:()=>Date)=>workList(query,{owner,leaseMs:300_000,now});

/** Seed identities only; each claimant opens just its own tenant's bindings. */
export async function seedLegistarMemberWork(query:Query):Promise<number> {
  const clients=await query(`SELECT (${LEGISTAR_TENANT_SQL}) AS slug,min(value->>'ocdId') AS place
    FROM cp_doors WHERE (${LEGISTAR_TENANT_SQL}) IS NOT NULL GROUP BY 1`);
  const rows=clients.map(client=>{
    const slug=String(client.slug);
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
    const subject=LEGISTAR_MEMBER_SUBJECT+slug,url=`https://webapi.legistar.com/v1/${slug}/officerecords`;
    return {id:workId({kind:"load",subjectId:subject,url}),subject,url,place:client.place??"ocd-division/country:us",
      state:/\/state:([a-z]{2})/.exec(String(client.place))?.[1]?.toUpperCase()??"US"};
  });
  return (await query(`INSERT INTO work_row(id,kind,state,place_id,subject_id,url,reports)
    SELECT id,'load',state,place,subject,url,'[{"source":"Legistar members"}]'::jsonb
    FROM jsonb_to_recordset($1::jsonb) AS c(id text,state text,place text,subject text,url text)
    ON CONFLICT(id) DO NOTHING RETURNING id`,[JSON.stringify(rows)])).length;
}
