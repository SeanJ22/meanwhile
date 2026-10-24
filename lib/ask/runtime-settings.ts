import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { settingsEdgeStore, type ReaderSettingsSnapshot, type SettingsEdgeStore, type AskPlaybookRole } from "../civic-data/reader-settings-publication.ts";
import { workerSystemPrompt } from "../control-plane/playbooks.ts";
import type { SettingValue } from "../control-plane/settings.ts";

const current = new AsyncLocalStorage<{ snapshot: ReaderSettingsSnapshot; jobId: string }>();

/** One edge snapshot per request, shared by every Ask model call. No database connection. */
export async function withPublishedAskSettings<T>(run: () => Promise<T>, store?: SettingsEdgeStore): Promise<T> {
  if (current.getStore()) return run();
  let snapshot: Awaited<ReturnType<SettingsEdgeStore["read"]>> = null;
  try { snapshot = await (store ?? settingsEdgeStore()).read(); } catch { /* Missing publication is missing instructions, never a text fallback. */ }
  return withAskSettings(snapshot?.snapshot ?? { formatVersion: 1, revision: 0, updatedAt: "", values: {} }, run);
}
export function withAskSettings<T>(snapshot: ReaderSettingsSnapshot, run: () => T): T {
  return current.run({ snapshot, jobId: `ask:${randomUUID()}` }, run);
}
export function askJobId(): string | undefined { return current.getStore()?.jobId; }
export function askSettings(): Readonly<Record<string, SettingValue>> { return current.getStore()?.snapshot.values ?? {}; }
export function askPlaybook(role: AskPlaybookRole): string {
  return workerSystemPrompt(role, current.getStore()?.snapshot.playbooks?.[role]?.text ?? "");
}
export function askPlaybookVersion(role: AskPlaybookRole): string { return current.getStore()?.snapshot.playbooks?.[role]?.version ?? "missing"; }
