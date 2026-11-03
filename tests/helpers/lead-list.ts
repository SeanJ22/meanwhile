import { leadsOn } from "../../lib/core/leads.ts";
import { LEAD_DDL, LEAD_GOVERNMENT_DDL, WORK_DDL, workList } from "../../lib/core/work.ts";
import { factDb } from "./fact-db.ts";

/** A test database that holds the work list, which hunters file links on and a government's walk takes them from. */
export async function installLeadList() {
  const facts = await factDb();
  for (const ddl of [...WORK_DDL, ...LEAD_DDL, ...LEAD_GOVERNMENT_DDL]) await facts.pg.exec(ddl);
  const list = workList(facts.query, { owner: "links", leaseMs: 300_000 });
  leadsOn(() => list);
  return { facts, list };
}
