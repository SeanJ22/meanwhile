import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workList } from "../../lib/core/work.ts";

/** A work list in memory for tests that follow an order's stored steps; the caller closes `pg`. */
export async function openOrderBook() {
  const pg = new PGlite();
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const book = workList(async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, { owner: "orders-test" });
  return { pg, book };
}
