import { randomUUID } from "node:crypto";
import { neon } from "../db/client.ts";
import { lockKey, unlockKey, KEYS_MASTER_ENV } from "./keys-crypto.ts";
import { KEY_SERVICES, keyName, type KeyService, type KeyView } from "./keys-model.ts";

/** A control-plane table owned by the core; no credential is sent through the Admin host to a worker. */
export const KEYS_DDL = `CREATE TABLE IF NOT EXISTS cp_keys (
  name text PRIMARY KEY, purpose text NOT NULL, service text NOT NULL,
  locked text NOT NULL, version text NOT NULL, changed_at timestamptz NOT NULL,
  tested_at timestamptz, working boolean NOT NULL DEFAULT false,
  says text NOT NULL DEFAULT 'Waiting for its first test.', next_test_at timestamptz NOT NULL,
  runner_read_at timestamptz
)`;
export type KeysQuery = (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
const PUBLIC_COLUMNS = "name, purpose, service, changed_at, tested_at, working, says, runner_read_at";
const iso = (value: unknown): string => new Date(value as string).toISOString();
function view(row: Record<string, unknown>): KeyView {
  return { name: String(row.name), purpose: String(row.purpose), service: row.service as KeyService,
    changedAt: iso(row.changed_at), testedAt: row.tested_at ? iso(row.tested_at) : null,
    working: row.working === true, says: String(row.says), runnerReadAt: row.runner_read_at ? iso(row.runner_read_at) : null };
}

export function keysStore(query: KeysQuery, encryptionKey: string | undefined) {
  return {
    async list(): Promise<readonly KeyView[]> {
      return (await query(`SELECT ${PUBLIC_COLUMNS} FROM cp_keys ORDER BY name`)).map(view);
    },
    async save(nameInput: string, value: string, service: KeyService, at: string): Promise<string> {
      const name = keyName(nameInput);
      if (!Object.hasOwn(KEY_SERVICES, service)) throw new Error("Choose what the key is for.");
      const locked = lockKey(name, value, encryptionKey), version = randomUUID();
      await query(`INSERT INTO cp_keys(name,purpose,service,locked,version,changed_at,next_test_at)
        VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(name) DO UPDATE SET
        purpose=EXCLUDED.purpose, service=EXCLUDED.service, locked=EXCLUDED.locked, version=EXCLUDED.version,
        changed_at=EXCLUDED.changed_at, tested_at=NULL, working=false, says='Waiting for its first test.',
        next_test_at=EXCLUDED.next_test_at, runner_read_at=NULL`, [name, KEY_SERVICES[service], service, locked, version, at]);
      return version;
    },
    async read(nameInput: string, runner = false, at = new Date().toISOString()): Promise<string | undefined> {
      const name = keyName(nameInput);
      const rows = await query("SELECT locked, version FROM cp_keys WHERE name=$1", [name]);
      if (!rows[0]) return undefined;
      const value = unlockKey(name, String(rows[0].locked), encryptionKey);
      // A receipt means the runner actually opened this version, not just that it saw the name.
      if (runner) await query("UPDATE cp_keys SET runner_read_at=$3 WHERE name=$1 AND version=$2", [name, rows[0].version, at]);
      return value;
    },
    async remove(nameInput: string): Promise<void> {
      await query("DELETE FROM cp_keys WHERE name=$1", [keyName(nameInput)]);
    },
    async claimTests(at: string, name?: string): Promise<readonly { name: string; version: string; service: KeyService; locked: string }[]> {
      // The short lease recovers after a killed test. Two runners cannot test the same version at once.
      const rows = await query(`UPDATE cp_keys SET next_test_at=$1::timestamptz + interval '2 minutes'
        WHERE next_test_at <= $1::timestamptz ${name ? "AND name=$2" : ""}
        RETURNING name,version,service,locked`, name ? [at, keyName(name)] : [at]);
      return rows.map(row => ({ name: String(row.name), version: String(row.version), service: row.service as KeyService, locked: String(row.locked) }));
    },
    open(name: string, locked: string): string { return unlockKey(name, locked, encryptionKey); },
    async tested(name: string, version: string, result: { working: boolean; says: string }, at: string): Promise<void> {
      // An old result must never overwrite a replacement key, or recreate a deleted key.
      await query(`UPDATE cp_keys SET tested_at=$3, working=$4, says=$5,
        next_test_at=$3::timestamptz + interval '1 day' WHERE name=$1 AND version=$2`,
      [name, version, at, result.working, result.says]);
    },
  };
}
export type KeysStore = ReturnType<typeof keysStore>;

export function productionKeysStore(env: NodeJS.ProcessEnv = process.env): KeysStore {
  const url = env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!url) throw new Error("The Keys box cannot reach its saved keys.");
  const sql = neon(url);
  return keysStore(async (text, params) => await sql.query(text, params ? [...params] : []) as Record<string, unknown>[], env[KEYS_MASTER_ENV]);
}

/** Server and session entry point. Missing keys stay missing; no environment or Admin-HTTP fallback. */
export async function readSavedKey(name: string, runner = false): Promise<string | undefined> {
  return productionKeysStore().read(name, runner);
}
