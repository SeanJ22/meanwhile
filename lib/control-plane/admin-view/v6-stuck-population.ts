/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { databaseReadOnlySql } from "../../reader/database.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, type StuckPopulation } from "./v6-stuck-read.ts";

/** Every use confirms the published index's current rows; unchanged rows do not cross the connection again. */
export async function population(scope="us"): Promise<StuckPopulation | null> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  return readStuckPopulation(databaseReadOnlySql(url),scope);
}
