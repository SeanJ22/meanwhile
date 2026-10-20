import { fieldManualEntryId, type FieldManualRepos } from "../control-plane/field-manual.ts";
import { rolePlaybook, readRolePlaybookRow } from "../control-plane/playbooks.ts";
import { getStore } from "@netlify/blobs";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { readerSettings, type SettingValue } from "../control-plane/settings.ts";
import { purgeReaderCacheTags } from "../reader/cache.ts";
import { READER_ARTIFACT_STORE_NAME } from "../meetings/edge-store.ts";

export const READER_SETTINGS_TAG = "reader-settings";
const KEY = "reader/settings.json";
export const ASK_PLAYBOOK_ROLES = ["ASK_READER", "ASK_WRITER", "ASK_FALLBACK"] as const;
export type AskPlaybookRole = typeof ASK_PLAYBOOK_ROLES[number];
export interface PublishedPlaybook { readonly text: string; readonly version: string; readonly revision: number }
export interface ReaderSettingsSnapshot {
  readonly formatVersion: 1;
  readonly revision: number;
  readonly updatedAt: string;
  readonly playbooks?: Readonly<Partial<Record<AskPlaybookRole, PublishedPlaybook>>>;
  readonly values: Readonly<Record<string, SettingValue>>;
}
export interface SettingsEdgeStore {
  read(): Promise<{ snapshot: ReaderSettingsSnapshot; etag: string } | null>;
  write(snapshot: ReaderSettingsSnapshot, etag: string | null): Promise<boolean>;
}
export function settingsEdgeStore(): SettingsEdgeStore {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  const store = getStore({ name: READER_ARTIFACT_STORE_NAME, consistency: "strong", ...(siteID && token ? { siteID, token } : {}) });
  return {
    async read() {
      const result = await store.getWithMetadata(KEY, { type: "json" });
      if (!result?.data) return null;
      if (!result.etag) throw new Error("Reader settings read has no revision token");
      return { snapshot: result.data as ReaderSettingsSnapshot, etag: result.etag };
    },
    async write(snapshot, etag) {
      return (await store.setJSON(KEY, snapshot, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag })).modified;
    },
  };
}
/** A separate CAS pointer prevents meeting publications and setting updates overwriting one another. */
export async function publishReaderSettings(config: AdminConfig, revision: number,
  options: { store?: SettingsEdgeStore; purge?: (tags: readonly string[]) => Promise<unknown> } = {},
): Promise<boolean> {
  const store = options.store ?? settingsEdgeStore();
  const values = readerSettings(config);
  for (let attempt = 0; attempt < 3; attempt++) {
    const held = await store.read();
    if (held && held.snapshot.revision > revision) return false;
    if (held && held.snapshot.revision === revision) {
      if (JSON.stringify(held.snapshot.values) !== JSON.stringify(values)) throw new Error("Conflicting reader settings revision");
      await (options.purge ?? purgeReaderCacheTags)([READER_SETTINGS_TAG]);
      return true;
    }
    const snapshot: ReaderSettingsSnapshot = { formatVersion: 1, revision, updatedAt: config.updatedAt, values, ...(held?.snapshot.playbooks ? { playbooks: held.snapshot.playbooks } : {}) };
    if (await store.write(snapshot, held?.etag ?? null)) {
      await (options.purge ?? purgeReaderCacheTags)([READER_SETTINGS_TAG]);
      return true;
    }
  }
  return false;
}
export async function ensureReaderSettingsPublished(config: AdminConfig | null, revision: number,
  options: { store?: SettingsEdgeStore; purge?: (tags: readonly string[]) => Promise<unknown> } = {},
): Promise<"current" | "published" | "behind"> {
  if (config === null) return "current";
  const store = options.store ?? settingsEdgeStore();
  const held = await store.read();
  const wanted = readerSettings(config);
  if (held && JSON.stringify(held.snapshot.values) === JSON.stringify(wanted)) return "current";
  if (held === null && Object.keys(wanted).length === 0) return "current";
  // A snapshot from a newer config row is left alone: this caller read an older row.
  if (held && held.snapshot.revision >= revision) return "behind";
  return await publishReaderSettings(config, revision, options) ? "published" : "behind";
}
export async function readReaderSetting<T extends SettingValue>(key: string, fallback: T, store?: SettingsEdgeStore): Promise<T> {
  try {
    const values = (await (store ?? settingsEdgeStore()).read())?.snapshot.values;
    return values && Object.hasOwn(values, key) ? values[key] as T : fallback;
  }
  catch { return fallback; }
}

/** Ask text has independent row revisions; settings and instructions merge under the same CAS pointer. */
export async function publishAskPlaybooks(repos: FieldManualRepos,
  options: { store?: SettingsEdgeStore; purge?: (tags: readonly string[]) => Promise<unknown> } = {},
): Promise<boolean> {
  const rows = (await Promise.all(ASK_PLAYBOOK_ROLES.map(role => readRolePlaybookRow(repos, role)))).flatMap(row => row ? [row] : []);
  const books = Object.fromEntries(ASK_PLAYBOOK_ROLES.flatMap(role => {
    const row = rows.find(row => row.id === fieldManualEntryId("role-playbook", role));
    const book = rolePlaybook(row ? [row.value] : [], role);
    return row ? [[role, { text: book.text, version: book.version, revision: row.revision }]] : [];
  })) as Partial<Record<AskPlaybookRole, PublishedPlaybook>>;
  const store = options.store ?? settingsEdgeStore();
  for (let attempt = 0; attempt < 4; attempt++) {
    const held = await store.read();
    const playbooks = { ...held?.snapshot.playbooks };
    for (const role of ASK_PLAYBOOK_ROLES) {
      const next = books[role], prior = playbooks[role];
      if (next && (!prior || next.revision >= prior.revision)) playbooks[role] = next;
    }
    if (held && JSON.stringify(held.snapshot.playbooks) === JSON.stringify(playbooks)) {
      await (options.purge ?? purgeReaderCacheTags)([READER_SETTINGS_TAG]);
      return true;
    }
    const snapshot: ReaderSettingsSnapshot = { formatVersion: 1, revision: held?.snapshot.revision ?? 0,
      updatedAt: new Date(Math.max(0, ...[held?.snapshot.updatedAt, ...rows.map(row => row.updatedAt)]
        .filter((at): at is string => typeof at === "string" && Number.isFinite(Date.parse(at))).map(at => Date.parse(at)))).toISOString(), values: held?.snapshot.values ?? {}, playbooks };
    if (await store.write(snapshot, held?.etag ?? null)) {
      await (options.purge ?? purgeReaderCacheTags)([READER_SETTINGS_TAG]);
      return true;
    }
  }
  return false;
}
