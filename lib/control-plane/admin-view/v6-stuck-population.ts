/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { databaseReadOnlySql } from "../../reader/database.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, type StuckPopulation } from "./v6-stuck-read.ts";

/** Each use confirms current rows for the selected scope, including due-time boundaries. */
export async function population(scope = "us"): Promise<StuckPopulation | null> {
  const url = controlPlaneUrlFromEnv();
  return url ? readStuckPopulation(databaseReadOnlySql(url), scope) : null;
}
