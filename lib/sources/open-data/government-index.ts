import { openDataDiskIndex } from "./disk-index.ts";
import type { GovernmentJoin, PortalBinding } from "./normalize.ts";
import type { OpenDataFact } from "./model.ts";

/** Country inventory and linking evidence stay on disk. A catalog row opens
 * only its exact native matches and publishing-domain bindings, one state at a time. */
export async function createSocrataGovernmentIndex() {
  const disk = await openDataDiskIndex(`
    CREATE TABLE governments(id INTEGER PRIMARY KEY,state TEXT NOT NULL,value TEXT NOT NULL);
    CREATE TABLE native(key TEXT NOT NULL,government_id INTEGER NOT NULL);
    CREATE INDEX native_key ON native(key);
    CREATE TABLE bindings(state TEXT NOT NULL,domain TEXT NOT NULL,value TEXT NOT NULL);
    CREATE INDEX binding_domain ON bindings(domain,state);
    CREATE TABLE catalog_ids(id TEXT PRIMARY KEY); CREATE TABLE domains(domain TEXT PRIMARY KEY)`);
  const db = disk.db;
  const insertGovernment = db.prepare("INSERT INTO governments VALUES(?,?,?)");
  const insertNative = db.prepare("INSERT INTO native VALUES(?,?)");
  const insertBinding = db.prepare("INSERT INTO bindings VALUES(?,?,?)");
  const insertId = db.prepare("INSERT INTO catalog_ids VALUES(?)");
  const insertDomain = db.prepare("INSERT OR IGNORE INTO domains VALUES(?)");
  const hasDomain = db.prepare("SELECT 1 FROM domains WHERE domain=?");
  const withinHost = db.prepare("SELECT domain FROM domains WHERE domain=? OR domain LIKE ? ORDER BY domain");
  const statesFor = db.prepare(`SELECT DISTINCT g.state FROM governments g JOIN native n ON n.government_id=g.id
    WHERE n.key IN (SELECT value FROM json_each(?)) UNION SELECT state FROM bindings WHERE domain=? ORDER BY state`);
  const governmentFor = db.prepare(`SELECT DISTINCT g.value FROM governments g JOIN native n ON n.government_id=g.id
    WHERE g.state=? AND n.key IN (SELECT value FROM json_each(?))`);
  const bindingFor = db.prepare("SELECT DISTINCT value FROM bindings WHERE state=? AND domain=?");
  let next = 0;
  return {
    addDomain(domain: string) { insertDomain.run(domain); },
    domains: {
      has(domain: string) { return hasDomain.get(domain) !== undefined; },
      *withinHost(host: string) { for (const row of withinHost.iterate(host, `%.${host}`)) yield String(row.domain); },
    },
    append(state: string, governments: readonly GovernmentJoin[], bindings: readonly PortalBinding[]) {
      const belongs = (division: string) => new RegExp(`/(?:state|district|territory):${state.toLowerCase()}(?:/|$)`).test(division);
      if (governments.some(row => !belongs(row.divisionId)) || bindings.some(row => !belongs(row.divisionId))) throw new Error("SOCRATA_GOVERNMENT_STATE_MISMATCH");
      db.exec("BEGIN");
      try {
        for (const row of governments) {
          const id = next++; insertGovernment.run(id, state, JSON.stringify(row));
          for (const [namespace, value] of Object.entries(row.nativeIds)) if (value) insertNative.run(`${namespace}:${value}`, id);
        }
        for (const row of bindings) insertBinding.run(state, row.domain, JSON.stringify(row));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    track(id: string) {
      try { insertId.run(id); } catch { throw new Error(`Repeated native Socrata source ID: ${id}`); }
    },
    async *matches(row: Pick<OpenDataFact, "nativeIds">): AsyncGenerator<{ readonly state: string; readonly governments: readonly GovernmentJoin[]; readonly bindings: readonly PortalBinding[] }> {
      const keys = JSON.stringify(Object.entries(row.nativeIds).filter(([, value]) => value).map(([namespace, value]) => `${namespace}:${value}`));
      const domain = row.nativeIds.domain;
      for (const found of statesFor.all(keys, domain)) {
        const state = String(found.state);
        yield { state, governments: governmentFor.all(state, keys).map(row => JSON.parse(String(row.value)) as GovernmentJoin),
          bindings: bindingFor.all(state, domain).map(row => JSON.parse(String(row.value)) as PortalBinding) };
      }
    },
    dispose: disk.dispose,
  };
}
