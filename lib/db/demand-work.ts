import { controlPlaneQuery, workList, type WorkList } from "../core/work.ts";
import { neon } from "./client.ts";
import { moveBlanksUp, type Query } from "../facts/publish.ts";
import type { DemandSubjectType } from "./demand-signal.ts";
import type { RunMarker } from "./run-marker.ts";
import { assertWriteAllowed } from "./write-guard.ts";

interface DemandWorkRequest {
  readonly subjectType: DemandSubjectType;
  readonly subjectId: string;
  /** The divisions the reader's point resolved to; where the subject names none, the first of them places the work. */
  readonly ocdIds: readonly string[];
  readonly marker: RunMarker;
}
interface DemandWorkStores {
  readonly work: () => WorkList;
  /** The reader database, where the subject's blanks are held. */
  readonly blanks: () => Query;
}

const production: DemandWorkStores = {
  work: () => workList(controlPlaneQuery(), { owner: "reader-demand" }),
  blanks: () => {
    assertWriteAllowed("a demand request");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    const sql = neon(url);
    return async (text, params = []) => await sql.query(text, [...params]) as Record<string, unknown>[];
  },
};

/**
 * "Want us to get this sooner?": the subject's hunt goes to the reader tier of the one work list at once, where each
 * further press moves it up, and its blanks stop waiting out their back-off. Only readers count; test traffic does not.
 * Returns false when nothing was written because this is not the production runtime.
 */
export async function requestWorkSooner(request: DemandWorkRequest, stores: DemandWorkStores = production): Promise<boolean> {
  if (request.marker.runClass !== "ORGANIC") return false;
  if (stores === production && process.env.NODE_ENV !== "production") return false;
  const own = request.subjectId.split("#")[0]!;
  const placeId = own.startsWith("ocd-division/") ? own : request.ocdIds[0] ?? "ocd-division/country:us";
  await stores.work().sooner({ placeId, subjectId: request.subjectId, subjectType: request.subjectType });
  await moveBlanksUp(stores.blanks(), request.subjectId);
  return true;
}
