import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv } from "../control-plane/repository/pg-store.ts";
import { isAttemptFamily, type AttemptFamily } from "./attempt-families.ts";

export interface PublicBodyAttempt {
  readonly bodyId:string; readonly at:string;
  /** The kind of fact the attempt was for; null on a snapshot published before families were kept. */
  readonly family:AttemptFamily|null;
  readonly status:"PUBLISHED"|"PARTIALLY_PUBLISHED"|"HELD";
  readonly code:string; readonly sourceUrl:string|null;
  readonly acceptedCount:number|null; readonly versionId:string|null;
}
export type PublicBodyAttemptRead = {kind:"HELD";asOf:string;rows:readonly PublicBodyAttempt[]} | {kind:"UNREAD"};
let cached:{at:number;value:PublicBodyAttemptRead}|null=null;
let pending:Promise<PublicBodyAttemptRead>|null=null;

/** Public operational facts only. The SQL selects no instructions, reader
 * activity, spending or worker prose. Never downloads the owner snapshot. */
export function readPublicBodyAttempts():Promise<PublicBodyAttemptRead> {
  if (typeof window !== "undefined") throw new Error("PUBLIC_BODY_ATTEMPTS_SERVER_ONLY");
  if (cached && Date.now()-cached.at<60_000) return Promise.resolve(cached.value);
  if (pending) return pending;
  pending=(async()=>{
    const url=controlPlaneUrlFromEnv();
    if (!url) return {kind:"UNREAD"} as const;
    try {
      const sql=neon(url);
      const rows=await sql.query(`SELECT value->>'publishedAt' AS published_at,
        CASE WHEN EXISTS (SELECT 1 FROM cp_owner_snapshots WHERE id LIKE 'current:%')
        THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'bodyId',item->'bodyId','family',item->'family','at',item->'at','status',item->'status',
          'code',item->'code','sourceUrl',item->'sourceUrl',
          'acceptedCount',item->'acceptedCount','versionId',item->'versionId') ORDER BY item->>'at' DESC, item->>'workItemId'), '[]'::jsonb)
          FROM cp_owner_snapshots s, jsonb_array_elements(s.value->'bodyAttempts') item WHERE s.id LIKE 'current:%')
        ELSE NULL END AS attempts FROM cp_owner_snapshots WHERE id='current'`,[],
        {fetchOptions:{signal:AbortSignal.timeout(750)}});
      const row=rows[0];
      if (!row || typeof row.published_at!=="string" || !Array.isArray(row.attempts)) return {kind:"UNREAD"} as const;
      const valid=row.attempts.every((item:PublicBodyAttempt)=>item && typeof item.bodyId==="string" &&
        Number.isFinite(Date.parse(item.at)) && ["PUBLISHED","PARTIALLY_PUBLISHED","HELD"].includes(item.status) &&
        (item.family===null || item.family===undefined || isAttemptFamily(item.family)) && typeof item.code==="string" && (item.sourceUrl===null || typeof item.sourceUrl==="string" && /^https?:\/\//.test(item.sourceUrl)) &&
        (item.acceptedCount===null || Number.isSafeInteger(item.acceptedCount)&&item.acceptedCount>=0) &&
        (item.versionId===null || typeof item.versionId==="string"));
      return valid?{kind:"HELD" as const,asOf:row.published_at,rows:(row.attempts as PublicBodyAttempt[]).map(item=>({...item,family:item.family??null}))}:{kind:"UNREAD" as const};
    } catch { return {kind:"UNREAD"} as const; }
  })().then(value=>{cached={at:Date.now(),value};return value;}).finally(()=>{pending=null;});
  return pending;
}
