/**
 * **THE UPDATES FEED (BR-24) — what changed, with an honest label.**
 *
 * An update is `{what, when, label, evidence, shownAt}`. It appears on Now once,
 * then drops off. Sources add updates through `addUpdate` (fix-list completions,
 * merged-and-live changes today; fix-map transitions, door reopenings, new kinds
 * found and new owed items from later steps).
 *
 * ```
 *   PROVEN    worked at the proof bar
 *   TESTING   live or done, not yet proven
 *   EXPECTED  something we expect; never shown as a win
 * ```
 * Updates live on the Admin config row, so they survive a reload and a restart.
 */
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "./gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";

export const UPDATE_LABELS = ["PROVEN", "TESTING", "EXPECTED"] as const;
export type UpdateLabel = (typeof UPDATE_LABELS)[number];

export interface UpdateRecord {
  /** Stable per source event, so a retried write adds it once. */
  readonly id: string;
  readonly what: string;
  readonly at: string;
  readonly label: UpdateLabel;
  /** Where the before and after can be seen. */
  readonly evidenceHref: string | null;
  readonly before: string | null;
  readonly after: string | null;
  /** When Now first showed it. Null until then. */
  readonly shownAt: string | null;
  /** For an update about items added to a place's owed list: what Decline would remove (BR-33). */
  readonly decline?: OwedDeclinePayload;
}

export interface OwedDeclinePayload {
  readonly placeKey: string;
  readonly rows: readonly { readonly rowId: string; readonly subjectLabel: string; readonly requirement: string }[];
}

export const UPDATES_CAP = 200;

export function updateRecords(config: AdminConfig): readonly UpdateRecord[] {
  return config.updates ?? [];
}

export interface NewUpdate {
  readonly id: string;
  readonly what: string;
  readonly at: string;
  readonly label: UpdateLabel;
  readonly evidenceHref?: string | null;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly decline?: OwedDeclinePayload;
}

export function withUpdateAdded(config: AdminConfig, add: NewUpdate): AdminConfig {
  const items = updateRecords(config);
  if (items.some((u) => u.id === add.id) || !add.what.trim() || !(UPDATE_LABELS as readonly string[]).includes(add.label)) return config;
  const next = [...items, { id: add.id, what: add.what.trim(), at: add.at, label: add.label, evidenceHref: add.evidenceHref ?? null,
    before: add.before ?? null, after: add.after ?? null, shownAt: null, ...(add.decline ? { decline: add.decline } : {}) }];
  // Shown updates are the first to go when the list is full.
  const kept = next.length <= UPDATES_CAP ? next : [...next.filter((u) => u.shownAt === null), ...next.filter((u) => u.shownAt !== null)].slice(-UPDATES_CAP);
  return { ...config, updates: kept, updatedAt: add.at };
}

export function withUpdatesShown(config: AdminConfig, ids: readonly string[], at: string): AdminConfig {
  const set = new Set(ids);
  if (!updateRecords(config).some((u) => set.has(u.id) && u.shownAt === null)) return config;
  return { ...config, updates: updateRecords(config).map((u) => (set.has(u.id) && u.shownAt === null ? { ...u, shownAt: at } : u)), updatedAt: at };
}

type Repos = Pick<ControlPlaneRepositories, "adminConfig">;

async function mutate(repos: Repos, at: string, change: (c: AdminConfig) => AdminConfig): Promise<AdminConfig> {
  for (let attempt = 0; ; attempt++) {
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(at);
    const next = change(current);
    if (next === current) return current;
    try {
      if (held) await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, held.revision, next, at);
      else await repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
      return next;
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

/** The one way code adds an update to the feed. Idempotent by `id`. */
export async function addUpdate(repos: Repos, add: NewUpdate): Promise<void> {
  await mutate(repos, add.at, (c) => withUpdateAdded(c, add));
}

/** Add several (one write); used for the Changes feed. */
export async function addUpdates(repos: Repos, adds: readonly NewUpdate[], at: string): Promise<void> {
  if (adds.length === 0) return;
  await mutate(repos, at, (c) => adds.reduce((acc, a) => withUpdateAdded(acc, a), c));
}

/** Read what Now has not shown yet, and mark it shown in the same pass, so each update appears once. */
export async function takeUnshownUpdates(repos: Repos, at: string): Promise<readonly UpdateRecord[]> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  if (!config) return [];
  const fresh = updateRecords(config).filter((u) => u.shownAt === null);
  if (fresh.length === 0) return [];
  await mutate(repos, at, (c) => withUpdatesShown(c, fresh.map((u) => u.id), at));
  return fresh;
}
