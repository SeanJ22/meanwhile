/**
 * The one-time copy of the single-document field manual (`cp_field_manual`,
 * id "live") into one row per entry. Each entry is re-tagged with the place
 * its own record names, or the place another entry with the same address
 * names; class-wide knowledge (playbooks, field names, team lessons) applies
 * everywhere; whatever is left names no place and is listed in the report.
 * Methods' recorded results go into the fix map. The document is then kept
 * under a new id, so nothing is lost and no reader sees it as live. Re-runs
 * merge into the rows and change nothing; a document the old code writes
 * again later is copied by the next run.
 */

import {
  fieldManualEntryId,
  isTransferableMethod,
  newFieldManualEntry,
  normalizeEntry,
  reachOf,
  recordMethodResults,
  saveFieldManualEntries,
  type FieldManualEntry,
  type FieldManualRepos,
} from "./field-manual.ts";
import { addBankWriteErrors } from "./bank-write-health.ts";
import { addUpdate } from "./updates.ts";
import type { Persisted } from "./repository/types.ts";

/** The old document table, as the copy needs it. */
export interface SingleDocumentManual {
  read(id: string): Promise<Persisted<{ readonly entries?: readonly FieldManualEntry[] }> | null>;
  /** Move the row to `as` if it is still at `revision`; false when someone wrote it since. */
  retire(id: string, revision: number, as: string): Promise<boolean>;
}

/** Old entries that name no place, platform or state and hold knowledge about a role or record class rather than a place. */
export const CLASS_WIDE_KINDS: ReadonlySet<string> = new Set([
  "PLAYBOOK", "SOURCE_REGISTER", "METHOD_VERSION", "PARSE_FIELDS", "PUBLIC_RECORD_KIND", "CLAIM_LESSON", "LESSON", "WRITE_HEALTH", "MEETINGS_RECIPE",
]);

export type CopiedReach = "PLACE" | "METHOD" | "PLATFORM" | "STATE" | "EVERYWHERE" | "NOWHERE";

export interface FieldManualCopyReport {
  readonly copiedAt: string;
  readonly sourceRevision: number;
  readonly entries: number;
  readonly saved: number;
  readonly failed: number;
  /** How many entries now apply where, by kind of reach. */
  readonly reach: Readonly<Record<CopiedReach, number>>;
  /** Entries given a place: from their own record, or from another entry with the same address. */
  readonly retagged: { readonly fromRecord: number; readonly fromSameAddress: number };
  /** Class-wide entries that name no place and now apply everywhere. */
  readonly everywhereByKind: Readonly<Record<string, number>>;
  /** Entries that name no place, platform or state: kept, shown to no job until a place is known. */
  readonly nowhere: readonly {
    readonly id: string; readonly kind: string; readonly role: string; readonly title: string; readonly source: string; readonly url: string | null;
    readonly observedAt: string | null;
  }[];
  readonly nowhereByKind: Readonly<Record<string, number>>;
  readonly fixMapResults: number;
  readonly writeErrorsCarried: number;
}

/** Where a saved entry applies, in one word. */
export function copiedReach(entry: FieldManualEntry): CopiedReach {
  if (isTransferableMethod(entry)) return "METHOD";
  const reach = entry.reach ?? reachOf(entry);
  if (reach.places.length > 0) return "PLACE";
  if (reach.platforms.length > 0) return "PLATFORM";
  if (reach.states.length > 0) return "STATE";
  return reach.everywhere ? "EVERYWHERE" : "NOWHERE";
}

const named = (e: FieldManualEntry): boolean => (e.ocdIds?.length ?? 0) > 0 || (e.bodyIds?.length ?? 0) > 0;

/** Pure: the old document's entries re-tagged for rows, with the report's tallies. */
export function retagForRows(entries: readonly FieldManualEntry[]): {
  readonly entries: FieldManualEntry[]; readonly fromRecord: number; readonly fromSameAddress: number; readonly everywhereByKind: Record<string, number>;
} {
  let fromRecord = 0, fromSameAddress = 0;
  const everywhereByKind: Record<string, number> = {};
  const read = entries.map((raw) => {
    const entry = normalizeEntry(raw);
    if (!named(raw) && named(entry)) fromRecord += 1;
    return entry;
  });
  const placesByUrl = new Map<string, { ocdIds: Set<string>; bodyIds: Set<string> }>();
  for (const e of read) {
    if (e.url === null || !named(e)) continue;
    const held = placesByUrl.get(e.url) ?? { ocdIds: new Set<string>(), bodyIds: new Set<string>() };
    for (const id of e.ocdIds ?? []) held.ocdIds.add(id);
    for (const id of e.bodyIds ?? []) held.bodyIds.add(id);
    placesByUrl.set(e.url, held);
  }
  const out = read.map((e) => {
    if (copiedReach(e) !== "NOWHERE") return e;
    const same = e.url === null ? undefined : placesByUrl.get(e.url);
    if (same !== undefined) {
      fromSameAddress += 1;
      return normalizeEntry({ ...e, reach: undefined, ...(same.ocdIds.size ? { ocdIds: [...same.ocdIds] } : {}), ...(same.bodyIds.size ? { bodyIds: [...same.bodyIds] } : {}) });
    }
    if (CLASS_WIDE_KINDS.has(e.kind)) {
      everywhereByKind[e.kind] = (everywhereByKind[e.kind] ?? 0) + 1;
      return normalizeEntry({ ...e, reach: undefined, portable: true });
    }
    return e;
  });
  return { entries: out, fromRecord, fromSameAddress, everywhereByKind };
}

const LIVE = "live";
const WRITE_ERRORS = "write-errors";
const NOWHERE_LISTED = 2000;

/** Copy the document, if there is one, into rows and the fix map; null when there is nothing to copy. */
export async function copyFieldManualDocument(old: SingleDocumentManual, repos: FieldManualRepos, now: string): Promise<FieldManualCopyReport | null> {
  let writeErrorsCarried = 0;
  const errors = await old.read(WRITE_ERRORS);
  if (errors !== null && await old.retire(WRITE_ERRORS, errors.revision, `copied:${now}:${WRITE_ERRORS}`)) {
    writeErrorsCarried = Number((errors.value.entries?.[0]?.payload as { count?: unknown } | undefined)?.count ?? 0) || 0;
    if (writeErrorsCarried > 0) await addBankWriteErrors(repos, writeErrorsCarried, now);
  }
  const held = await old.read(LIVE);
  if (held === null) return null;
  const retagged = retagForRows(held.value.entries ?? []);
  const inserted = await repos.fieldManual.insertNew(retagged.entries, now);
  const saved = await saveFieldManualEntries(repos, retagged.entries.filter((e) => !inserted.has(e.id)), now);
  if (saved.error !== undefined) throw new Error(`FIELD_MANUAL_COPY_FAILED: ${saved.error}`);
  const fixMap = await recordMethodResults(repos, retagged.entries, now, false);
  if (!await old.retire(LIVE, held.revision, `copied:${now}`)) return null;
  const reach: Record<CopiedReach, number> = { PLACE: 0, METHOD: 0, PLATFORM: 0, STATE: 0, EVERYWHERE: 0, NOWHERE: 0 };
  const nowhereByKind: Record<string, number> = {};
  const nowhere: FieldManualCopyReport["nowhere"][number][] = [];
  for (const e of retagged.entries) {
    const where = copiedReach(e);
    reach[where] += 1;
    if (where !== "NOWHERE") continue;
    nowhereByKind[e.kind] = (nowhereByKind[e.kind] ?? 0) + 1;
    if (nowhere.length < NOWHERE_LISTED) {
      nowhere.push({ id: e.id, kind: e.kind, role: e.role, title: e.title.slice(0, 160), source: e.source, url: e.url, observedAt: e.observedAt });
    }
  }
  const report: FieldManualCopyReport = {
    copiedAt: now, sourceRevision: held.revision, entries: retagged.entries.length, saved: inserted.size + saved.written, failed: 0, reach,
    retagged: { fromRecord: retagged.fromRecord, fromSameAddress: retagged.fromSameAddress }, everywhereByKind: retagged.everywhereByKind,
    nowhere, nowhereByKind, fixMapResults: fixMap.written, writeErrorsCarried,
  };
  await saveFieldManualEntries(repos, [newFieldManualEntry("field-manual-copy", now, { role: "SHARED", kind: "COPY_REPORT",
    title: "Lessons copied into one row each", summary: `${report.entries} lessons copied; ${reach.NOWHERE} name no place yet`,
    outcome: "REFERENCE", observedAt: now, portable: true, payload: report })], now);
  // The copy stands whether or not its brief line could be written.
  if (repos.adminConfig) await addUpdate({ adminConfig: repos.adminConfig }, { id: `field-manual-copy:${now}`, at: now, label: "TESTING", what: copyBriefLine(report) }).catch(() => undefined);
  return report;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The one line the daily brief shows for a copy. */
export function copyBriefLine(report: FieldManualCopyReport): string {
  const { reach } = report;
  const retagged = report.retagged.fromRecord + report.retagged.fromSameAddress;
  return `The field manual now keeps each lesson on its own: ${count(report.entries, "lesson")} copied — ${reach.PLACE.toLocaleString("en-US")} for one place, ` +
    `${reach.STATE.toLocaleString("en-US")} for a state, ${reach.PLATFORM.toLocaleString("en-US")} for a website platform, ${reach.METHOD.toLocaleString("en-US")} methods offered anywhere they fit, ` +
    `${reach.EVERYWHERE.toLocaleString("en-US")} for everywhere; ${count(retagged, "lesson")} got ${retagged === 1 ? "its" : "their"} place back from the record, ` +
    `and ${count(reach.NOWHERE, "lesson")} ${reach.NOWHERE === 1 ? "names" : "name"} no place yet and ${reach.NOWHERE === 1 ? "is" : "are"} listed for review.`;
}

/** The id the report of the copy made at `copiedAt` is saved under. */
export function copyReportId(copiedAt: string): string {
  return fieldManualEntryId("field-manual-copy", copiedAt);
}
