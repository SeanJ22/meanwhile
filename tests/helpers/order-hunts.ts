import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workList, type OrderMark } from "../../lib/core/work.ts";

/** A work list in memory for tests that follow the hunts Sean's money points at; the caller closes `pg`. */
export async function openOrderHunts() {
  const pg = new PGlite();
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  return { pg, list: workList(async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, { owner: "order-hunts-test" }) };
}

/** Money pointed at a government by one Send. */
export const pointed = (placeId: string, state: string, mark: OrderMark) => ({ placeId, state, priority: 0, marks: [mark] });

/** For tests that stop hunts but do not follow the work list. */
export const noHunts = { orderHunts: async () => [], demote: async () => 0 };
