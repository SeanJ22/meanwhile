import type { RoutineSourceTask } from "./runner.ts";

/** Keep presence reads on the record-class/scope indexes and below one database response page. */
export const ROUTINE_CLOCK_PRESENCE_PAGE = 500;

type ClockTask = Pick<RoutineSourceTask, "id" | "recordClass" | "scope">;

/**
 * A newly discovered board has neither a candidate nor a pointer, hence no clock to prove. Find those empty
 * scopes in pages before asking for the individual clock proofs. Existing data, even an old parser's refused
 * candidate or an orphaned pointer, still takes the full clock read. Nothing is inferred from a door's status.
 */
export async function routineClockPresence(
  tasks: readonly ClockTask[],
  query: (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
): Promise<{ readonly absent: ReadonlySet<string>; readonly pending: ReadonlySet<string> }> {
  const byClass = new Map<string, Map<string, string[]>>();
  for (const task of tasks) {
    let scopes = byClass.get(task.recordClass);
    if (!scopes) byClass.set(task.recordClass, scopes = new Map());
    scopes.set(task.scope, [...scopes.get(task.scope) ?? [], task.id]);
  }
  const absent = new Set<string>(), pending = new Set<string>();
  for (const [recordClass, scopes] of byClass) {
    const names = [...scopes.keys()];
    for (let at = 0; at < names.length; at += ROUTINE_CLOCK_PRESENCE_PAGE) {
      const page = names.slice(at, at + ROUTINE_CLOCK_PRESENCE_PAGE);
      const rows = await query(`WITH present AS (SELECT DISTINCT scope FROM civic_data_candidates
        WHERE record_class = $1 AND scope = ANY($2::text[])
        UNION SELECT scope FROM civic_data_promotions WHERE record_class = $1 AND scope = ANY($2::text[]))
        SELECT scope, $1 = 'MEETING' AND EXISTS(SELECT 1 FROM civic_data_promotions p JOIN pass_cursor c
          ON c.name = 'meeting-facts:' || p.current_version_id
          WHERE p.key = 'MEETING:' || present.scope AND c.position::jsonb->>'complete' = 'false') AS publication_pending
        FROM present`, [recordClass, page]);
      const present = new Set<string>();
      for (const row of rows) {
        if (typeof row.scope !== "string" || !scopes.has(row.scope) || !page.includes(row.scope)) {
          throw new Error("ROUTINE_CLOCK_PRESENCE_RESPONSE_INVALID");
        }
        present.add(row.scope);
        if (row.publication_pending === true) pending.add(row.scope);
      }
      for (const scope of page) if (!present.has(scope)) for (const id of scopes.get(scope)!) absent.add(id);
    }
  }
  return { absent, pending };
}
