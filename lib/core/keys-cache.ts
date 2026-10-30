import { unlockKey } from "./keys-crypto.ts";
import type { KeysQuery } from "./keys-store.ts";
import type { SavedValues } from "./keys-values.ts";

type Head = { readonly name: string; readonly version: string; readonly deleted: boolean };
type Opened = Head & { readonly value?: string; readonly openedAt?: string };
const head = (row: Record<string, unknown>): Head => ({ name: String(row.name), version: String(row.version), deleted: row.deleted === true });
const HEADS = "name,version,deleted";

/** One batch on first use. Later passes fetch encrypted bytes only for changed keys. */
export function savedKeysCache(query: KeysQuery, master: string | undefined, source: "runner" | "website", allow: (name: string) => boolean = () => true) {
  let opened: ReadonlyMap<string, Opened> | undefined;
  let pending: Promise<SavedValues> | undefined;
  async function read(): Promise<SavedValues> {
    const first = opened === undefined;
    const rows = await query(`SELECT ${HEADS}${first ? ",locked" : ""} FROM cp_keys ORDER BY name`);
    const heads = rows.map(head);
    const changed = heads.filter(row => opened?.get(row.name)?.version !== row.version || opened?.get(row.name)?.deleted !== row.deleted);
    const updates = first ? rows : changed.length ? await query(`SELECT ${HEADS},locked FROM cp_keys WHERE name=ANY($1::text[])`, [changed.map(row => row.name)]) : [];
    const next = new Map(opened);
    for (const name of next.keys()) if (!heads.some(row => row.name === name)) next.delete(name);
    const at = new Date().toISOString();
    for (const row of updates) {
      const info = head(row);
      const permitted = allow(info.name.replace(/\.(runner|website)$/, ""));
      next.set(info.name, { ...info, openedAt: info.deleted || !permitted ? undefined : at, value: info.deleted || !permitted ? undefined : unlockKey(info.name, String(row.locked), master) });
    }
    const values = new Map<string, string>();
    for (const row of next.values()) {
      if (row.value !== undefined) values.set(row.name, row.value);
    }
    for (const row of next.values()) if (row.name.endsWith(`.${source}`)) {
      const name = row.name.slice(0, -(source.length + 1));
      if (row.value === undefined) values.delete(name); else values.set(name, row.value);
    }
    opened = next;
    return { values, openings: [...next.values()].flatMap(row => row.openedAt ? [{ name: row.name, version: row.version, at: row.openedAt }] : []) };
  }
  return { refresh(): Promise<SavedValues> {
    if (!pending) pending = read().finally(() => { pending = undefined; });
    return pending;
  } };
}
