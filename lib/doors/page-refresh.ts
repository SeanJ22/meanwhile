/**
 * **A FACT PAST ITS REFRESH DATE IS RE-READ, WITH NO SEND NEEDED** (DB-29).
 *
 * A page door (roster, contact, comment rule, directory) is due when its last good read is older than its refresh
 * date: its own `checkEvery`, which is its fact class's freshness window. `pageDoorsDue` lists them, most late first.
 * Feed doors are not here: a feed door is a partition read and the ordinary pass already schedules it.
 *
 * `refreshDuePageDoors` takes the due pages that live facts still cite, at most `PAGE_REFRESH_PER_PASS` a pass, and
 * re-fetches each through the paced fetch. The read is saved as a source copy like any other, and `recheckPage` runs
 * the existing value-on-page check (`valueOnPage`, section 3) on every value published from the page, with no AI.
 *
 * - CONFIRMED: every published value is still on the page. Each fact's checked date and receipt move to the new copy.
 * - CHANGED: at least one value is no longer on the page. Nothing is restamped; the page goes back to its worker as
 *   ordinary work, named with the fields that moved.
 * - UNREADABLE: the page gave no text or no answer. Nothing is confirmed and nothing is called changed; the door's
 *   failure path records it.
 */
import { valueOnPage, pageWords } from "../control-plane/promotion/section3.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { fetchCapture } from "../facts/capture.ts";
import { restampFacts, type FactDb, type Query } from "../facts/publish.ts";
import { saveCaptureCopy } from "../facts/source-copy.ts";
import type { ReaderCachePurger } from "../reader/cache.ts";
import { recordDoorOutcome } from "./outcome.ts";
import { checkEveryFor } from "./overdue.ts";
import { queuePageRead } from "./page-check.ts";
import { PAGE_DOOR_KIND, pageAddress } from "./page-doors.ts";
import type { ProbeFetch } from "./probe.ts";
import { WebsiteWait } from "./probe-fetch.ts";
import type { DoorRecord } from "./registry.ts";
import { recordDoorEvidence, type DoorEvidence } from "./shut.ts";

/** One pass reads at most this many due pages, so a backlog drains over passes instead of in one burst. */
export const PAGE_REFRESH_PER_PASS = 25;

/** Open page doors past their refresh date, most late first, at most `limit`. */
export function pageDoorsDue(doors: readonly DoorRecord[], now: string, limit: number = PAGE_REFRESH_PER_PASS): DoorRecord[] {
  const nowMs = Date.parse(now);
  return doors.filter((door) => door.kind === PAGE_DOOR_KIND && door.status === "OPEN")
    .map((door) => ({ door, late: nowMs - Date.parse(door.lastSuccessAt ?? door.updatedAt) - checkEveryFor(door, undefined).minutes * 60_000 }))
    .filter((row) => row.late > 0)
    .sort((a, b) => b.late - a.late || (a.door.doorId < b.door.doorId ? -1 : 1))
    .slice(0, Math.max(0, limit)).map((row) => row.door);
}

/** The address a page door re-fetches: the one it was keyed on, or null when the record lost it. */
export function pageDoorUrl(door: Pick<DoorRecord, "config">): string | null {
  const url = door.config.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

/** A value a live fact published from this page. */
export interface PublishedValue {
  readonly field: string;
  readonly value: unknown;
}

export type PageRecheck =
  | { readonly kind: "CONFIRMED"; readonly confirmedAt: string }
  | { readonly kind: "CHANGED"; readonly changedFields: readonly string[] }
  | { readonly kind: "UNREADABLE" };

/** Re-run the value-on-page check against a fresh read. Nothing published means nothing to confirm, which is UNREADABLE. */
export function recheckPage(text: string, published: readonly PublishedValue[], readAt: string): PageRecheck {
  if (text.trim() === "" || published.length === 0) return { kind: "UNREADABLE" };
  const words = pageWords(text);
  const changedFields = [...new Set(published.filter((fact) => !valueOnPage(fact.value, text, words)).map((fact) => fact.field))];
  return changedFields.length === 0 ? { kind: "CONFIRMED", confirmedAt: readAt } : { kind: "CHANGED", changedFields };
}

/** A live fact whose receipt is a saved copy of a page door's address. Sean's own values change only through him and are not here. */
interface PageFact {
  readonly id: number;
  readonly entityId: string;
  readonly field: string;
  readonly valueText: string;
  readonly quote: string;
}

/** Live facts per page address, for the given addresses. */
async function liveFactsOn(query: Query, urls: readonly string[]): Promise<ReadonlyMap<string, readonly PageFact[]>> {
  const out = new Map<string, PageFact[]>();
  if (!urls.length) return out;
  const rows = await query(`SELECT f.id, f.entity_id, f.field, f.value_text, f.quote, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
    WHERE f.status = 'live' AND f.provenance_kind <> 'OWNER' AND s.url = ANY($1::text[]) ORDER BY f.id`, [urls.flatMap((url) => [url, `${url}/`])]);
  for (const row of rows) {
    const url = pageAddress(String(row.url))?.url;
    if (!url) continue;
    out.set(url, [...out.get(url) ?? [], { id: Number(row.id), entityId: String(row.entity_id), field: String(row.field), valueText: String(row.value_text), quote: String(row.quote ?? "") }]);
  }
  return out;
}

export interface PageRefreshReport {
  readonly looked: number;
  readonly confirmed: number;
  readonly restamped: number;
  readonly changed: number;
  readonly unreadable: number;
  /** Not asked: the website asked every reader to wait, or a small publisher's hour is used. Due again next pass. */
  readonly waiting: number;
  readonly failures: readonly string[];
}

const failureEvidence = (error: string): DoorEvidence => {
  const status = /^HTTP_(\d+)$/.exec(error)?.[1];
  if (status) return { kind: "HTTP", httpStatus: Number(status) };
  return error.startsWith("FETCH_FAILED:") ? { kind: "TRANSPORT_FAILURE" } : { kind: "PARSE_FAILURE", detail: error };
};

/** One pass over due page doors: re-read, re-check, and restamp or hand back each page. One door's failure never stops the rest. */
export async function refreshDuePageDoors(input: {
  readonly repos: ControlPlaneRepositories;
  readonly facts: FactDb & { readonly query: Query };
  readonly vault: EvidenceStore;
  readonly fetch: ProbeFetch;
  readonly doors: readonly DoorRecord[];
  readonly now: string;
  readonly clock?: () => string;
  readonly limit?: number;
  readonly purge?: ReaderCachePurger;
  readonly deadlineMs?: number;
}): Promise<PageRefreshReport> {
  const clock = input.clock ?? (() => new Date().toISOString());
  const report = { looked: 0, confirmed: 0, restamped: 0, changed: 0, unreadable: 0, waiting: 0, failures: [] as string[] };
  const due = pageDoorsDue(input.doors, input.now, Number.POSITIVE_INFINITY).flatMap((door) => {
    const url = pageDoorUrl(door);
    return url ? [{ door, url }] : [];
  });
  const cited = await liveFactsOn(input.facts.query, [...new Set(due.map((row) => row.url))]);
  for (const { door, url } of due.filter((row) => cited.has(row.url)).slice(0, input.limit ?? PAGE_REFRESH_PER_PASS)) {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) break;
    const facts = cited.get(url)!;
    try {
      let waited = false;
      const fetch: ProbeFetch = async (target, headers) => {
        try { return await input.fetch(target, headers); } catch (error) { waited = error instanceof WebsiteWait; throw error; }
      };
      const readAt = clock();
      const read = await fetchCapture({ url, repos: input.repos, vault: input.vault, fetch, now: readAt });
      if (waited) { report.waiting++; continue; }
      report.looked++;
      if ("error" in read || read.capture.evidence.text.trim() === "") {
        report.unreadable++;
        await recordDoorEvidence(input.repos.doors, door.doorId, "error" in read ? failureEvidence(read.error) : { kind: "EMPTY", lastGoodRows: facts.length }, readAt, input.repos);
        continue;
      }
      const copy = await input.facts.transaction((query) => saveCaptureCopy(query, read.capture));
      const verdict = recheckPage(copy.text, facts.map((fact) => ({ field: fact.field, value: fact.valueText })), readAt);
      if (verdict.kind === "UNREADABLE") {
        report.unreadable++;
        await recordDoorEvidence(input.repos.doors, door.doorId, { kind: "EMPTY", lastGoodRows: facts.length }, readAt, input.repos);
        continue;
      }
      await recordDoorEvidence(input.repos.doors, door.doorId, { kind: "GOOD", rows: facts.length }, readAt, input.repos);
      await recordDoorOutcome(input.repos.doors, door.doorId, "SUCCESS", readAt, verdict.kind === "CHANGED");
      if (verdict.kind === "CONFIRMED") {
        report.confirmed++;
        report.restamped += await restampFacts(input.facts, facts, copy, { purge: input.purge });
        continue;
      }
      report.changed++;
      await queuePageRead(input.repos, door, readAt, readAt, verdict.changedFields);
    } catch (error) {
      report.failures.push(`${door.doorId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
