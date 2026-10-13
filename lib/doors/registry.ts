/**
 * The door registry: one editable list of every way Meanwhile reads government
 * information (a meeting calendar, a roll-call feed, a money filing feed). A
 * door is a record, edited through one gateway action (`./actions.ts`), that
 * takes effect without a release. A door carries its division and body ids as
 * data. Pure: callers hand in the repository and the time.
 */

import { canonicalJson, type AggregateRepository } from "../control-plane/repository/types.ts";

/** Whether a door is read, shut because it stopped working, or deliberately set aside. */
export const DOOR_STATUSES = ["OPEN", "SHUT", "SUSPENDED"] as const;

/** The kinds of door a routine source task reads on its clock, one door per task. */
export const FEED_DOOR_KINDS: readonly string[] = ["source-feed", "derived-feed"];
export const feedDoorId = (taskId: string): string => `feed:${taskId}`;

/**
 * Whether a routine task reads this door on a clock: a meeting door or a feed. Other doors (found pages, route
 * hints, link sweeps) are read when work needs them, so they owe no scheduled read.
 */
export function readOnSchedule(door: Pick<DoorRecord, "kind" | "meeting">): boolean {
  return door.meeting != null || FEED_DOOR_KINDS.includes(door.kind);
}
export type DoorStatus = (typeof DOOR_STATUSES)[number];

/** Who last wrote the record: a person through the gateway, or a derive step. */
export type DoorOrigin = "MANUAL" | "DERIVED";

/** A config value: plain data only. Secrets are referenced by name, never held. */
export type DoorConfigValue = string | number | boolean | readonly string[];

/**
 * What a meeting door needs beyond the common fields so an adapter can read
 * it as it reads a wiring row. Absent on non-meeting doors.
 */
export interface DoorMeeting {
  /** The adapter's agenda source type, as wiring names it (e.g. `ICAL`). */
  readonly agendaSourceType: string;
  /** Display only. */
  readonly jurisdiction: string;
  /** Who published the records: the public body, never the vendor. */
  readonly publishingOrg: string;
  /** IANA zone the body meets in. */
  readonly timeZone: string;
  readonly noticeUrl?: string;
  /** False only when the route carries no past sitting; then `historyGapReason` says why. */
  readonly publishesHistory?: false;
  readonly historyGapReason?: string;
  /** When the settings were last confirmed working. */
  readonly verifiedAt: string;
  /** The family partition a derived member belongs to; null for a hand-wired door. */
  readonly family: string | null;
}

/** What the last first look saw. Stored on the door so the next look can be conditional. */
export interface DoorValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** SHA-256 of the listing page or feed bytes, when the last look read them. */
  readonly contentHash: string | null;
  readonly checkedAt: string;
  /** When a look last found a change. */
  readonly changedAt: string | null;
}

export interface DoorRecord {
  readonly formatVersion: 1;
  /** Stable and readable, e.g. `meetings:<source>:<bodyId>`. Never reused. */
  readonly doorId: string;
  /** The adapter kind that reads this door. */
  readonly kind: string;
  /** The division this door serves, when it serves one. */
  readonly ocdId: string | null;
  /** Bodies behind this door. One door can feed several. */
  readonly bodyIds: readonly string[];
  /** Every host this door reads. One door can span several. */
  readonly hosts: readonly string[];
  /** Adapter settings. References to keys, never secret values. */
  readonly config: Readonly<Record<string, DoorConfigValue>>;
  /** Record classes this door holds, e.g. `meetings`, `votes`. */
  readonly holds: readonly string[];
  /** How often the door is checked, in minutes. Null means the standing cadence for its kind. */
  readonly checkEveryMinutes: number | null;
  readonly notes: string;
  /** Meeting doors only: what an adapter needs to read this door like a wiring row. */
  readonly meeting: DoorMeeting | null;
  readonly status: DoorStatus;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  /** The source's actual outage reason, preserved on its existing operational record. */
  readonly lastFailureReason?: string | null;
  /** When the door last went SHUT. Null unless it is. */
  readonly shutSince: string | null;
  /** System-kept: consecutive reads that could not reach the door. Absent means none. */
  readonly transportFailures?: number;
  /** System-kept: in a sentence, why the door went SHUT. Null unless it is. */
  readonly shutReason?: string | null;
  /** System-kept: when the door last reopened after being shut. */
  readonly reopenedAt?: string | null;
  /** System-kept: when a read of this door last promoted something different from before. Absent means never seen. */
  readonly lastChangedAt?: string | null;
  /** System-kept: minutes between its changed promotions, as a running average (lib/doors/observed-rate.ts). Absent until two have been seen. */
  readonly observedChangeMinutes?: number | null;
  /** System-kept: how many changed promotions the average rests on. */
  readonly observedChanges?: number;
  /** Read at the next opportunity instead of waiting for the schedule. */
  readonly readNow: boolean;
  /** System-kept: what the last first look saw. Never edited by hand, never a derive input. */
  readonly validators?: DoorValidators | null;
  readonly origin: DoorOrigin;
  /** When the editable fields last changed by hand, or null if never. */
  readonly editedAt: string | null;
  /** When the record last changed for any reason. */
  readonly updatedAt: string;
}

export type DoorRepository = AggregateRepository<DoorRecord>;

/** The fields a person or a derive step supplies; the rest the system keeps. */
export interface DoorDraft {
  readonly doorId: string;
  readonly kind: string;
  readonly ocdId?: string | null;
  readonly bodyIds?: readonly string[];
  readonly hosts?: readonly string[];
  readonly config?: Readonly<Record<string, DoorConfigValue>>;
  readonly holds?: readonly string[];
  readonly checkEveryMinutes?: number | null;
  readonly notes?: string;
  readonly meeting?: DoorMeeting | null;
  readonly status?: DoorStatus;
  readonly readNow?: boolean;
}

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

const DOOR_ID = /^[a-z0-9][a-z0-9:._~#@+%/-]{0,299}$/i;
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const OCD = /^ocd-division\/[a-z0-9_.~:\/-]{1,300}$/;
const HOLD = /^[a-z][a-z0-9-]{0,63}$/;
const CONFIG_KEY = /^[^\s\x00-\x1f]([^\x00-\x1f]{0,118}[^\s\x00-\x1f])?$/;
/** A config key that names a secret must say it is a reference. */
const SECRET_KEY = /(secret|token|password|passwd|apikey|api_key|credential|bearer|auth)/i;
const REFERENCE_KEY = /(ref|env|name)$/i;

export const MAX_BODIES = 500;
export const MAX_HOSTS = 50;
export const MAX_HOLDS = 30;
export const MAX_CONFIG_KEYS = 40;
export const MAX_NOTES = 2000;
export const MIN_CHECK_MINUTES = 5;
export const MAX_CHECK_MINUTES = 60 * 24 * 400;

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function list(value: unknown, max: number, what: string): Checked<readonly string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, why: `${what} must be a list` };
  const seen = new Set<string>();
  for (const item of value) {
    const text = clean(item);
    if (text === "" || text.length > 400) return { ok: false, why: `${what} has an empty or overlong entry` };
    seen.add(text);
  }
  if (seen.size > max) return { ok: false, why: `${what} has more than ${max} entries` };
  return { ok: true, value: [...seen].sort() };
}

/** A hostname as the registry stores it: lower case, no scheme, no path, no port. */
export function normalizeHost(raw: string): string | null {
  let text = raw.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try {
      text = new URL(text).hostname;
    } catch {
      return null;
    }
  }
  text = text.replace(/\.$/, "");
  return HOST.test(text) ? text : null;
}

function configOf(value: unknown): Checked<Readonly<Record<string, DoorConfigValue>>> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, why: "settings must be a set of named values" };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CONFIG_KEYS) return { ok: false, why: `settings has more than ${MAX_CONFIG_KEYS} entries` };
  const out: Record<string, DoorConfigValue> = {};
  for (const [key, raw] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!CONFIG_KEY.test(key)) return { ok: false, why: `"${key}" is not a usable setting name` };
    if (SECRET_KEY.test(key) && !REFERENCE_KEY.test(key)) {
      return { ok: false, why: `"${key}" looks like it would hold a secret; store the name of the key instead, under a name ending in Ref` };
    }
    if (typeof raw === "string") {
      if (raw.length > 2000) return { ok: false, why: `"${key}" is too long` };
      out[key] = raw;
    } else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) return { ok: false, why: `"${key}" is not a number` };
      out[key] = raw;
    } else if (typeof raw === "boolean") out[key] = raw;
    else if (Array.isArray(raw) && raw.every((x) => typeof x === "string" && x.length <= 2000) && raw.length <= 200) {
      out[key] = [...(raw as string[])];
    } else return { ok: false, why: `"${key}" must be text, a number, true/false or a list of text` };
  }
  return { ok: true, value: out };
}

function meetingOf(value: unknown): Checked<DoorMeeting | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, why: "meeting details must be a set of fields" };
  const m = value as Record<string, unknown>;
  const need = (key: string): string | null => (typeof m[key] === "string" && (m[key] as string).trim() !== "" && (m[key] as string).length <= 600 ? (m[key] as string).trim() : null);
  const agendaSourceType = need("agendaSourceType");
  const jurisdiction = need("jurisdiction");
  const publishingOrg = need("publishingOrg");
  const timeZone = need("timeZone");
  const verifiedAt = need("verifiedAt");
  if (agendaSourceType === null || jurisdiction === null || publishingOrg === null || timeZone === null || verifiedAt === null) {
    return { ok: false, why: "meeting details need the source type, jurisdiction, publisher, time zone and the day the settings were confirmed" };
  }
  const noticeUrl = m.noticeUrl === undefined ? undefined : need("noticeUrl");
  if (noticeUrl === null) return { ok: false, why: "the notice page must be text" };
  if (m.publishesHistory !== undefined && m.publishesHistory !== false) return { ok: false, why: "publishesHistory is only ever false" };
  const reason = m.historyGapReason === undefined ? undefined : need("historyGapReason");
  if (reason === null) return { ok: false, why: "the history gap reason must be text" };
  if (m.publishesHistory === false && reason === undefined) return { ok: false, why: "a route with no past meetings must say why" };
  const family = m.family === undefined || m.family === null ? null : need("family");
  if (m.family !== undefined && m.family !== null && family === null) return { ok: false, why: "the family must be text" };
  return {
    ok: true,
    value: {
      agendaSourceType,
      jurisdiction,
      publishingOrg,
      timeZone,
      ...(noticeUrl === undefined ? {} : { noticeUrl }),
      ...(m.publishesHistory === false ? { publishesHistory: false as const } : {}),
      ...(reason === undefined ? {} : { historyGapReason: reason }),
      verifiedAt,
      family,
    },
  };
}

/** Shape and bounds for one door's editable fields. Same checks for a person and for a derive step. */
export function checkDoorDraft(input: unknown): Checked<Required<DoorDraft>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, why: "a door must be a set of fields" };
  const draft = input as Record<string, unknown>;
  const doorId = clean(draft.doorId);
  if (!DOOR_ID.test(doorId)) return { ok: false, why: "a door needs a readable id of letters, digits and : . _ - / characters" };
  const kind = clean(draft.kind);
  if (!KIND.test(kind)) return { ok: false, why: "a door needs a kind (the reader that opens it), in lower case" };
  const ocdRaw = draft.ocdId === undefined || draft.ocdId === null ? "" : clean(draft.ocdId);
  if (ocdRaw !== "" && !OCD.test(ocdRaw)) return { ok: false, why: "the division id must look like ocd-division/country:us/..." };
  const bodies = list(draft.bodyIds, MAX_BODIES, "bodies");
  if (!bodies.ok) return bodies;
  const hostsRaw = list(draft.hosts, MAX_HOSTS, "hosts");
  if (!hostsRaw.ok) return hostsRaw;
  const hosts: string[] = [];
  for (const raw of hostsRaw.value) {
    const host = normalizeHost(raw);
    if (host === null) return { ok: false, why: `"${raw}" is not a website host name` };
    if (!hosts.includes(host)) hosts.push(host);
  }
  hosts.sort();
  const holds = list(draft.holds, MAX_HOLDS, "record classes");
  if (!holds.ok) return holds;
  for (const hold of holds.value) if (!HOLD.test(hold)) return { ok: false, why: `"${hold}" is not a record class name` };
  const config = configOf(draft.config);
  if (!config.ok) return config;
  let checkEveryMinutes: number | null = null;
  if (draft.checkEveryMinutes !== undefined && draft.checkEveryMinutes !== null) {
    const n = draft.checkEveryMinutes;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_CHECK_MINUTES || n > MAX_CHECK_MINUTES) {
      return { ok: false, why: `how often to check must be a whole number of minutes from ${MIN_CHECK_MINUTES} to ${MAX_CHECK_MINUTES}` };
    }
    checkEveryMinutes = n;
  }
  const notes = typeof draft.notes === "string" ? draft.notes.trim() : "";
  if (notes.length > MAX_NOTES) return { ok: false, why: `notes are longer than ${MAX_NOTES} characters` };
  const meeting = meetingOf(draft.meeting);
  if (!meeting.ok) return meeting;
  const status = draft.status === undefined ? "OPEN" : draft.status;
  if (!(DOOR_STATUSES as readonly unknown[]).includes(status)) return { ok: false, why: "status must be open, shut or suspended" };
  if (draft.readNow !== undefined && typeof draft.readNow !== "boolean") return { ok: false, why: "read-now must be true or false" };
  return {
    ok: true,
    value: {
      doorId,
      kind,
      ocdId: ocdRaw === "" ? null : ocdRaw,
      bodyIds: bodies.value,
      hosts,
      config: config.value,
      holds: holds.value,
      checkEveryMinutes,
      notes,
      meeting: meeting.value,
      status: status as DoorStatus,
      readNow: draft.readNow === true,
    },
  };
}

export function isDoorRecord(value: unknown): value is DoorRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.formatVersion === 1 && typeof v.doorId === "string" && typeof v.kind === "string" && Array.isArray(v.bodyIds) && Array.isArray(v.hosts)
    && typeof v.status === "string" && (DOOR_STATUSES as readonly string[]).includes(v.status) && typeof v.updatedAt === "string";
}

/** `shutSince` follows `status`: set on the way into SHUT, kept while it stays, cleared on the way out. */
function shutSinceFor(status: DoorStatus, previous: DoorRecord | null, at: string): string | null {
  if (status !== "SHUT") return null;
  return previous !== null && previous.status === "SHUT" && previous.shutSince !== null ? previous.shutSince : at;
}

/** The system-kept shut fields carried over from what was there; the shut reason follows the status. */
function healthKept(previous: DoorRecord | null, status: DoorStatus): Partial<DoorRecord> {
  if (previous === null) return {};
  return {
    ...(previous.lastFailureReason !== undefined ? { lastFailureReason: previous.lastFailureReason } : {}),
    ...(previous.transportFailures !== undefined ? { transportFailures: previous.transportFailures } : {}),
    ...(status === "SHUT" && previous.shutReason !== undefined ? { shutReason: previous.shutReason } : {}),
    ...(previous.reopenedAt !== undefined ? { reopenedAt: previous.reopenedAt } : {}),
    ...(previous.lastChangedAt !== undefined ? { lastChangedAt: previous.lastChangedAt } : {}),
    ...(previous.observedChangeMinutes !== undefined ? { observedChangeMinutes: previous.observedChangeMinutes } : {}),
    ...(previous.observedChanges !== undefined ? { observedChanges: previous.observedChanges } : {}),
  };
}

/** A new door, or a hand edit of one, with the system's own fields carried over from what was there. */
export function applyManualEdit(previous: DoorRecord | null, draft: Required<DoorDraft>, at: string): DoorRecord {
  return {
    formatVersion: 1,
    ...draft,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastFailureAt: previous?.lastFailureAt ?? null,
    validators: previous?.validators ?? null,
    shutSince: shutSinceFor(draft.status, previous, at),
    ...healthKept(previous, draft.status),
    origin: "MANUAL",
    editedAt: at,
    updatedAt: at,
  };
}

/**
 * A derived row (from wiring or a crosswalk) offered to the registry. Upserts
 * by door id and never overwrites a manual edit newer than `deriveInputAt`.
 * Returns the record to store, or null when the stored record stands.
 */
export function applyDerivedRow(
  previous: DoorRecord | null,
  draft: Required<DoorDraft>,
  deriveInputAt: string,
  at: string,
): DoorRecord | null {
  if (previous !== null && previous.editedAt !== null && Date.parse(previous.editedAt) > Date.parse(deriveInputAt)) return null;
  const next: DoorRecord = {
    formatVersion: 1,
    ...draft,
    // A derive step never reopens a door someone shut, or shuts one that is open: status stays with the record once it exists.
    status: previous?.status ?? draft.status,
    readNow: previous?.readNow ?? draft.readNow,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastFailureAt: previous?.lastFailureAt ?? null,
    validators: previous?.validators ?? null,
    shutSince: previous?.shutSince ?? shutSinceFor(draft.status, null, at),
    ...healthKept(previous, previous?.status ?? draft.status),
    origin: "DERIVED",
    editedAt: previous?.editedAt ?? null,
    updatedAt: at,
  };
  if (previous !== null && sameFields(previous, next)) return null;
  return next;
}

const FIELDS = ["kind", "ocdId", "bodyIds", "hosts", "config", "holds", "checkEveryMinutes", "notes", "meeting", "status", "readNow"] as const;
/** Key order is not compared: the store hands settings back in its own order. */
function sameFields(a: DoorRecord, b: DoorRecord): boolean {
  return FIELDS.every((f) => canonicalJson(a[f]) === canonicalJson(b[f]));
}

/** The editable fields only, for showing what an edit changed. */
export function editableFieldsOf(record: DoorRecord): Required<DoorDraft> {
  return {
    doorId: record.doorId,
    kind: record.kind,
    ocdId: record.ocdId,
    bodyIds: record.bodyIds,
    hosts: record.hosts,
    config: record.config,
    holds: record.holds,
    checkEveryMinutes: record.checkEveryMinutes,
    notes: record.notes,
    meeting: record.meeting,
    status: record.status,
    readNow: record.readNow,
  };
}

/** Every door, shut ones first, then by id. Rows that are not doors are skipped and counted in `unreadable`. */
export async function listDoors(repo: DoorRepository): Promise<{ readonly doors: readonly DoorRecord[]; readonly unreadable: number }> {
  const rows = await repo.list();
  const doors: DoorRecord[] = [];
  let unreadable = 0;
  for (const row of rows) {
    if (isDoorRecord(row.value)) doors.push(row.value);
    else unreadable += 1;
  }
  const rank: Record<DoorStatus, number> = { SHUT: 0, SUSPENDED: 1, OPEN: 2 };
  doors.sort((a, b) => rank[a.status] - rank[b.status] || (a.doorId < b.doorId ? -1 : a.doorId > b.doorId ? 1 : 0));
  return { doors, unreadable };
}

/**
 * Upsert one derived row by door id. Returns what happened, for import scripts and
 * derive steps to count. A concurrent writer losing the race is retried once from the fresh read.
 */
export async function upsertDerivedDoor(
  repo: DoorRepository,
  draft: DoorDraft,
  deriveInputAt: string,
  at: string,
): Promise<"created" | "updated" | "unchanged" | "kept-manual-edit"> {
  const checked = checkDoorDraft(draft);
  if (!checked.ok) throw new Error(`DOOR_DRAFT_INVALID: ${checked.why}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await repo.read(checked.value.doorId);
    const previous = existing !== null && isDoorRecord(existing.value) ? existing.value : null;
    const next = applyDerivedRow(previous, checked.value, deriveInputAt, at);
    if (next === null) {
      return previous !== null && previous.editedAt !== null && Date.parse(previous.editedAt) > Date.parse(deriveInputAt)
        ? "kept-manual-edit"
        : "unchanged";
    }
    try {
      if (existing === null) await repo.put(checked.value.doorId, next, at);
      else await repo.compareAndSet(checked.value.doorId, existing.revision, next, at);
      return existing === null ? "created" : "updated";
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return "unchanged";
}
