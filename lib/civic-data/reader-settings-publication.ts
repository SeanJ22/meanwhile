import { getStore } from "@netlify/blobs";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { readerSettings, type SettingValue } from "../control-plane/settings.ts";
import { purgeReaderCacheTags } from "../meetings/edge-serving.ts";
import { READER_ARTIFACT_STORE_NAME } from "../meetings/edge-store.ts";

export const READER_SETTINGS_TAG = "reader-settings";
const KEY = "reader/settings.json";
export interface ReaderSettingsSnapshot {
  readonly formatVersion: 1;
  readonly revision: number;
  readonly updatedAt: string;
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
  const snapshot: ReaderSettingsSnapshot = { formatVersion: 1, revision, updatedAt: config.updatedAt, values: readerSettings(config) };
  for (let attempt = 0; attempt < 3; attempt++) {
    const held = await store.read();
    if (held && held.snapshot.revision > revision) return false;
    if (held && held.snapshot.revision === revision) {
      if (JSON.stringify(held.snapshot) !== JSON.stringify(snapshot)) throw new Error("Conflicting reader settings revision");
      await (options.purge ?? purgeReaderCacheTags)([READER_SETTINGS_TAG]);
      return true;
    }
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
