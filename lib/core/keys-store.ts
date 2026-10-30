import { randomUUID } from "node:crypto";
import { neon } from "../db/client.ts";
import { capabilityLog } from "./capability.ts";
import { lockKey, unlockKey, KEYS_MASTER_ENV } from "./keys-crypto.ts";
import { KEY_SERVICES, keyLabel, keyName, type KeyService, type KeyView } from "./keys-model.ts";

/** A control-plane table owned by the core; no credential is sent through the Admin host to a worker. */
export const KEYS_DDL = `CREATE TABLE IF NOT EXISTS cp_keys (
  name text PRIMARY KEY, purpose text NOT NULL, service text NOT NULL,
  locked text NOT NULL, version text NOT NULL, changed_at timestamptz NOT NULL,
  tested_at timestamptz, working boolean NOT NULL DEFAULT false,
  says text NOT NULL DEFAULT 'Waiting for its first test.', next_test_at timestamptz NOT NULL,
  runner_read_at timestamptz, imported_from text[] NOT NULL DEFAULT '{}',
  deleted boolean NOT NULL DEFAULT false, previous jsonb, history jsonb NOT NULL DEFAULT '[]'
)`;
export type KeysQuery = (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
const PUBLIC_COLUMNS = "name, version, purpose, service, changed_at, tested_at, working, says, runner_read_at, imported_from, deleted, previous IS NOT NULL AS can_undo, history";
const BEFORE = "jsonb_build_object('locked',cp_keys.locked,'service',cp_keys.service,'purpose',cp_keys.purpose,'deleted',cp_keys.deleted)";
const iso = (value: unknown): string => new Date(value as string).toISOString();
function view(row: Record<string, unknown>): KeyView {
  return { name: String(row.name), version: String(row.version), purpose: String(row.purpose), service: row.service as KeyService,
    changedAt: iso(row.changed_at), testedAt: row.tested_at ? iso(row.tested_at) : null,
    working: row.working === true, says: String(row.says), runnerReadAt: row.runner_read_at ? iso(row.runner_read_at) : null,
    importedFrom: Array.isArray(row.imported_from) ? row.imported_from as string[] : [], label: keyLabel(String(row.name), row.service as KeyService),
    deleted: row.deleted === true, canUndo: row.can_undo === true, history: row.history as KeyView["history"] };
}

export function keysStore(query: KeysQuery, encryptionKey: string | undefined) {
  return {
    async list(includeDeleted = false): Promise<readonly KeyView[]> {
      return (await query(`SELECT ${PUBLIC_COLUMNS} FROM cp_keys ${includeDeleted ? "" : "WHERE NOT deleted"} ORDER BY name`)).map(view);
    },
    async save(nameInput: string, value: string, service: KeyService, at: string, onlyIfAbsent = false, source?: string,
      expected?: { readonly name: string; readonly version: string }): Promise<string> {
      const name = keyName(nameInput);
      if (!Object.hasOwn(KEY_SERVICES, service)) throw new Error("Choose what the key is for.");
      const locked = lockKey(name, value, encryptionKey), version = randomUUID();
      const values = "$1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz,$7,jsonb_build_array(jsonb_build_object('at',$6::text,'before','No key','after','Saved key'))";
      const written = await query(`INSERT INTO cp_keys(name,purpose,service,locked,version,changed_at,next_test_at,imported_from,history)
        ${expected ? `SELECT ${values} FROM cp_keys donor WHERE donor.name=$8 AND donor.version=$9 AND NOT donor.deleted` : `VALUES(${values})`}
        ON CONFLICT(name) ${onlyIfAbsent ? "DO NOTHING" : `DO UPDATE SET
        purpose=EXCLUDED.purpose, service=EXCLUDED.service, locked=EXCLUDED.locked, version=EXCLUDED.version,
        changed_at=EXCLUDED.changed_at, tested_at=NULL, working=false, says='Waiting for its first test.',
        next_test_at=EXCLUDED.next_test_at, runner_read_at=NULL, deleted=false, previous=${BEFORE},imported_from=EXCLUDED.imported_from,
        history=jsonb_path_query_array(jsonb_build_array(jsonb_build_object('at',$6::text,'before',
          CASE WHEN cp_keys.deleted THEN 'No key' ELSE 'Saved key' END,'after','Saved key')) || cp_keys.history,'$[0 to 19]')`} RETURNING version`,
      [name, KEY_SERVICES[service], service, locked, version, at, [source ?? "owner"], ...(expected ? [expected.name, expected.version] : [])]);
      return written[0] ? String(written[0].version) : "";
    },
    async markImported(name: string, source: string): Promise<void> {
      await query("UPDATE cp_keys SET imported_from=array_append(imported_from,$2) WHERE name=$1 AND NOT ($2=ANY(imported_from))", [name, source]);
    },
    async read(nameInput: string, runner = false, at = new Date().toISOString(), source?: "runner" | "website"): Promise<string | undefined> {
      const name = keyName(nameInput);
      const rows = source ? await query("SELECT name,locked,version,deleted FROM cp_keys WHERE name=ANY($1::text[]) ORDER BY (name=$2) DESC LIMIT 1", [[name, `${name}.${source}`], `${name}.${source}`])
        : await query("SELECT name,locked,version,deleted FROM cp_keys WHERE name=$1", [name]);
      if (!rows[0] || rows[0].deleted) return undefined;
      const actualName = String(rows[0].name);
      const value = unlockKey(actualName, String(rows[0].locked), encryptionKey);
      // A receipt means the runner actually opened this version, not just that it saw the name.
      if (runner) await query("UPDATE cp_keys SET runner_read_at=$3 WHERE name=$1 AND version=$2", [actualName, rows[0].version, at]);
      return value;
    },
    async remove(nameInput: string, at = new Date().toISOString()): Promise<void> {
      await query(`UPDATE cp_keys SET previous=${BEFORE}, locked='', deleted=true, version=$2, changed_at=$3::timestamptz,
        working=false,tested_at=NULL,runner_read_at=NULL,history=jsonb_path_query_array(
          jsonb_build_array(jsonb_build_object('at',$3::text,'before','Saved key','after','No key')) || history,'$[0 to 19]')
        WHERE name=$1 AND NOT deleted`, [keyName(nameInput), randomUUID(), at]);
    },
    async undo(nameInput: string, at: string): Promise<void> {
      await query(`UPDATE cp_keys SET locked=previous->>'locked',service=previous->>'service',purpose=previous->>'purpose',
        deleted=(previous->>'deleted')::boolean,previous=${BEFORE},version=$2,changed_at=$3::timestamptz,tested_at=NULL,
        working=false,next_test_at=$3::timestamptz,runner_read_at=NULL,history=jsonb_path_query_array(
          jsonb_build_array(jsonb_build_object('at',$3::text,'before',CASE WHEN deleted THEN 'No key' ELSE 'Saved key' END,
            'after',CASE WHEN (previous->>'deleted')::boolean THEN 'No key' ELSE 'Saved key' END)) || history,'$[0 to 19]')
        WHERE name=$1 AND previous IS NOT NULL`, [keyName(nameInput), randomUUID(), at]);
    },
    async claimTests(at: string, name?: string, source?: "runner" | "website"): Promise<readonly { name: string; version: string; service: KeyService; locked: string }[]> {
      // The short lease recovers after a killed test. Two runners cannot test the same version at once.
      const params: unknown[] = [at];
      let selection = "";
      if (name) { params.push(keyName(name)); selection += ` AND name=$${params.length}`; }
      if (source) { params.push(source); selection += ` AND (cardinality(imported_from)=0 OR 'owner'=ANY(imported_from) OR $${params.length}=ANY(imported_from))`; }
      const rows = await query(`UPDATE cp_keys SET next_test_at=$1::timestamptz + interval '2 minutes'
        WHERE NOT deleted AND next_test_at <= $1::timestamptz ${selection}
        RETURNING name,version,service,locked`, params);
      return rows.map(row => ({ name: String(row.name), version: String(row.version), service: row.service as KeyService, locked: String(row.locked) }));
    },
    open(name: string, locked: string): string { return unlockKey(name, locked, encryptionKey); },
    async tested(name: string, version: string, result: { working: boolean; says: string }, at: string): Promise<void> {
      // An old result must never overwrite a replacement key, or recreate a deleted key.
      const [was] = await query("SELECT working FROM cp_keys WHERE name=$1 AND version=$2", [name, version]);
      const changed = await query(`UPDATE cp_keys SET tested_at=$3, working=$4, says=$5,
        next_test_at=$3::timestamptz + interval '1 day' WHERE name=$1 AND version=$2 AND (tested_at IS NULL OR tested_at <= $3::timestamptz) RETURNING name`,
      [name, version, at, result.working, result.says]);
      // A key that starts to work is something new the system can do.
      if (result.working && was?.working === false && changed.length) await capabilityLog(query).record([{ kind: "key", name, because: `the key ${name} was saved and tests Working` }], at);
    },
  };
}
export type KeysStore = ReturnType<typeof keysStore>;

export function productionKeysStore(env: Readonly<Record<string, string | undefined>> = process.env): KeysStore {
  const url = env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!url) throw new Error("The Keys box cannot reach its saved keys.");
  const sql = neon(url);
  return keysStore(async (text, params) => await sql.query(text, params ? [...params] : []) as Record<string, unknown>[], env[KEYS_MASTER_ENV]);
}

/** Server and session entry point. Missing keys stay missing; no environment or Admin-HTTP fallback. */
export async function readSavedKey(name: string, runner = false): Promise<string | undefined> {
  return productionKeysStore().read(name, runner, new Date().toISOString(), runner ? "runner" : "website");
}
