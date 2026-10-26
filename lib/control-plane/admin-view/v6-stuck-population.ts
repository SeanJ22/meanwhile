/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { neon } from "../../db/client.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, type StuckPopulation } from "./v6-stuck-read.ts";
const memo = new Map<string,{stamp:string;population:StuckPopulation}>();
const pending = new Map<string,Promise<StuckPopulation>>();

/** One unpack of the published index serves both sections, and the national read, for a minute. */
export async function population(scope="us"): Promise<StuckPopulation | null> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  const sql=neon(url);
  const revisions=await sql.query("SELECT id,revision FROM cp_owner_snapshots WHERE id='current' OR id LIKE 'current:%' ORDER BY id");
  const stamp=JSON.stringify(revisions)+Math.floor(Date.now()/15_000);
  if(memo.get(scope)?.stamp===stamp)return memo.get(scope)!.population;
  const existing=pending.get(scope);if(existing)return existing;
  const read=readStuckPopulation(sql,scope).then(population=>{if(memo.size>=32)memo.delete(memo.keys().next().value!);memo.set(scope,{stamp,population});return population;});
  pending.set(scope,read);
  try{return await read;}finally{if(pending.get(scope)===read)pending.delete(scope);}
}
