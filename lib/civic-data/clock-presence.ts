import type { RoutineSourceTask } from "./runner.ts";

/** Keep presence reads on the record-class/scope indexes and below one database response page. */
export const ROUTINE_CLOCK_PRESENCE_PAGE = 500;

type ClockTask = Pick<RoutineSourceTask, "id" | "recordClass" | "scope">;

/**
 * A newly discovered board has neither a candidate nor a pointer, hence no clock to prove. Find those empty
 * scopes in pages before asking for the individual clock proofs. Existing data, even an old parser's refused
 * candidate or an orphaned pointer, still takes the full clock read. Nothing is inferred from a door's status.
 */
export async function routineTasksWithoutClocks(
  tasks: readonly ClockTask[],
  query: (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
): Promise<ReadonlySet<string>> {
  const byClass = new Map<string, Map<string, string[]>>();
  for (const task of tasks) {
    let scopes = byClass.get(task.recordClass);
    if (!scopes) byClass.set(task.recordClass, scopes = new Map());
    scopes.set(task.scope, [...scopes.get(task.scope) ?? [], task.id]);
  }
  const absent = new Set<string>();
  for (const [recordClass, scopes] of byClass) {
    const names = [...scopes.keys()];
    for (let at = 0; at < names.length; at += ROUTINE_CLOCK_PRESENCE_PAGE) {
      const page = names.slice(at, at + ROUTINE_CLOCK_PRESENCE_PAGE);
      const rows = await query(`SELECT DISTINCT scope FROM civic_data_candidates
        WHERE record_class = $1 AND scope = ANY($2::text[])
        UNION SELECT scope FROM civic_data_promotions WHERE record_class = $1 AND scope = ANY($2::text[])`, [recordClass, page]);
      const present = new Set<string>();
      for (const row of rows) {
        if (typeof row.scope !== "string" || !scopes.has(row.scope) || !page.includes(row.scope)) {
          throw new Error("ROUTINE_CLOCK_PRESENCE_RESPONSE_INVALID");
        }
        present.add(row.scope);
      }
      for (const scope of page) if (!present.has(scope)) for (const id of scopes.get(scope)!) absent.add(id);
    }
  }
  return absent;
}
