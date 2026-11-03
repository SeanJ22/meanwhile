import { slotFor } from "../facts/finding-slots.ts";
import type { Query } from "../facts/publish.ts";
import { platformOf } from "../sources/platform-of.ts";
import { controlPlaneQuery, newestFirst, workList, type WorkInput, type WorkList } from "./work.ts";

/** What a hunter reported: a value found on a page, said by an exact quote, about a government or one of its boards. */
export interface Reported {
  readonly subjectId: string;
  readonly field: string;
  readonly value: unknown;
  readonly recordClass: string | null;
  readonly exactQuote: string | null;
  readonly sourceUrl: string | null;
  readonly recordedAt: string;
  readonly workItemId?: string;
  /** The saved copies of the page it was found on. */
  readonly artifactIds?: readonly string[];
  /** The other pages that said the same thing. */
  readonly alsoOn?: readonly string[];
}

/**
 * The link to read that a report stands for, or null when it is not one. A page a government links to is a page to go read: it is one row for
 * its address however many times and under however many governments it is found, and every report keeps the page it was found on and its
 * exact quote. Links start with the places that are least complete, newest first; a link on a vendor's site is read by that vendor's parser.
 */
export function leadOf(report: Reported): WorkInput | null {
  const slot = slotFor(report.field, report.value, report.recordClass, report.exactQuote ?? "", report.sourceUrl ?? "", report.subjectId);
  if (!("handoff" in slot) || slot.handoff !== "site-walk") return null;
  const url = String(report.value).trim();
  try { new URL(url); } catch { return null; }
  const platform = platformOf(url);
  return { kind: "lead", placeId: report.subjectId.split("#")[0]!, subjectId: report.subjectId, url, value: platform === null ? null : { platform },
    priority: newestFirst(report.recordedAt), origin: { from: "loader" }, sources: [...new Set([report.sourceUrl, ...report.alsoOn ?? []].filter((page): page is string => !!page))],
    source: { source: "Found by a hunter", foundOn: report.sourceUrl, quote: report.exactQuote, field: report.field, recordedAt: report.recordedAt, workItemId: report.workItemId, artifactIds: report.artifactIds } };
}

let shared: WorkList | undefined;
let list = (): WorkList => shared ??= workList(controlPlaneQuery(), { owner: "links", leaseMs: 300_000 });
/** The work list that holds links: the one hunters file them on and a government's walk takes them from. A test's own list stands in for the control-plane database. */
export const leadList = (): WorkList => list();
export function leadsOn(next: () => WorkList): void { list = next; }

/** The links go on the work list. A failure throws, so the hunter that found them keeps them. */
export async function fileLeads(leads: readonly WorkInput[]): Promise<void> {
  for (let at = 0; at < leads.length; at += 500) await leadList().addMany(leads.slice(at, at + 500));
}

/**
 * One page of the old Box's links goes onto the work list, in id order after `after`, through the same writer new links use. Rows are only read:
 * every page reads at most `limit` rows, and the same page filed again changes nothing. `next` is the last id read, or null when the Box is read to its end.
 */
export async function moveBoxLeads(box: Query, after: string, limit: number): Promise<{ readonly read: number; readonly filed: number; readonly next: string | null }> {
  const rows = await box("SELECT id, value FROM cp_box_findings WHERE id > $1 ORDER BY id LIMIT $2", [after, limit]);
  const leads = rows.flatMap(({ value }) => {
    const row = value as { state: string; subjectId: string; fact?: { field: string; value: unknown; recordClass: string | null }; exactQuote: string | null; sourceUrl: string | null;
      lastRecordedAt?: string; origins: readonly { recordedAt: string; workItemId: string; artifactIds: string[]; source?: { sourceUrl: string } }[] };
    const first = row.origins[0];
    if (!["waiting", "taken"].includes(row.state) || !row.fact || !first) return [];
    const lead = leadOf({ subjectId: row.subjectId, field: row.fact.field, value: row.fact.value, recordClass: row.fact.recordClass, exactQuote: row.exactQuote,
      sourceUrl: row.sourceUrl, recordedAt: row.lastRecordedAt ?? first.recordedAt, workItemId: first.workItemId, artifactIds: first.artifactIds, alsoOn: row.origins.flatMap(origin => origin.source?.sourceUrl ?? []) });
    return lead ? [lead] : [];
  });
  await fileLeads(leads);
  return { read: rows.length, filed: leads.length, next: rows.length < limit ? null : String(rows.at(-1)!.id) };
}
