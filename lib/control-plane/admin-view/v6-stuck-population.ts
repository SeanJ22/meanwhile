/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { databaseHttpReadOnlySql } from "../../reader/database.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, stuckRowsOf, STUCK_ITEM_LIMIT, type StuckPopulation } from "./v6-stuck-read.ts";
import { readOwnerStuckRows } from "../repository/owner-stuck-counts.ts";

/** Each use confirms current rows for the selected scope, including due-time boundaries. */
export async function population(scope = "us"): Promise<StuckPopulation | null> {
  const url = controlPlaneUrlFromEnv();
  return url ? readStuckPopulation(databaseHttpReadOnlySql(url), scope) : null;
}

export async function populationRows(scope="us",at=new Date().toISOString()) {
  const url=controlPlaneUrlFromEnv();
  return url ? stuckRowsOf(await readOwnerStuckRows(databaseHttpReadOnlySql(url),STUCK_ITEM_LIMIT,scope,at)) : null;
}
