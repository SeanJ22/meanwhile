/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { openControlPlane } from "../admin-data.ts";
import { recordUndescribedCauses } from "./undescribed-causes.ts";
import { causeOf } from "./blocker-causes.ts";
import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, type StuckPopulation } from "./v6-stuck-read.ts";
const MEMO_MS = 60_000;
let memo: { at: number; population: StuckPopulation } | null = null;

/** One unpack of the published index serves both sections, and the national read, for a minute. */
export async function population(): Promise<StuckPopulation | null> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.population;
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  const read = await readStuckPopulation(neon(url));
  const unknown = new Map(read.rows.filter(row => causeOf(row).undescribed).map(row => [causeOf(row).key, row]));
  if (unknown.size) {
    const opened = await openControlPlane();
    if (opened.ok) await recordUndescribedCauses(opened.repos, read.rows, new Date().toISOString()).catch(() => undefined);
  }
  memo = { at: Date.now(), population: read };
  return read;
}

