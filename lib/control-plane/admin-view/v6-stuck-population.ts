/** Shared Queue population reader for the HTTP route and the plain-Node daily timer. */
import { openControlPlane } from "../admin-data.ts";
import { recordUndescribedCauses } from "./undescribed-causes.ts";
import { causeOf } from "./blocker-causes.ts";
import { databaseReadOnlySql } from "../../reader/database.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readStuckPopulation, type StuckPopulation } from "./v6-stuck-read.ts";

/** Every use confirms the index's current projected rows, including due-time boundaries. */
export async function population(): Promise<StuckPopulation | null> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  const read = await readStuckPopulation(databaseReadOnlySql(url));
  const unknown = new Map(read.rows.filter(row => causeOf(row).undescribed).map(row => [causeOf(row).key, row]));
  if (unknown.size) {
    const opened = await openControlPlane();
    if (opened.ok) await recordUndescribedCauses(opened.repos, read.rows, new Date().toISOString()).catch(() => undefined);
  }
  return read;
}
