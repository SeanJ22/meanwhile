import type { Query } from "../facts/publish.ts";

/** A reader pressed "Want us to get this sooner?": the subject's blanks stop waiting out their back-off and the press is counted. */
export async function moveBlanksUp(query: Query, entityId: string): Promise<void> {
  await query(`UPDATE blank SET reader_requests = reader_requests + 1, next_try_at = least(next_try_at, now()), updated_at = now()
    WHERE entity_id = $1`, [entityId]);
}
