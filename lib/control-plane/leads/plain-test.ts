/**
 * The runner's pass over open research-leads orders: each queued link is read
 * once by plain code (`researchFetch`: robots.txt read and recorded first,
 * never a block), through the runner's guarded fetch, so its requests count
 * in the same per-website pacing as every other reader: a known small
 * publisher's hourly allowance, and the hold after a 429, a 5xx or a
 * Retry-After. A link held back by pacing waits for its turn.
 *
 * A link that reads is saved as a lesson with the owner as its source, tied to
 * its place and platform, so the spread pass carries it to places with the
 * same kind of website. A link plain code is turned away from goes to paid
 * workers only when its place is inside a Send or a funded area; anywhere else
 * it fails with the reason.
 */

import { newFieldManualEntry, writeFieldManual, type FieldManualEntry } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { ConcurrentModification } from "../repository/types.ts";
import type { FleetSafetyController } from "../fleet-safety.ts";
import { formatEasternTime } from "../eastern-time.ts";
import { memoryInProcess, researchFetch, type ResearchFetchResult, type ResearchGet } from "../../hunt/robots-first-fetch.ts";
import { detectTenancy } from "../../hunt/platform-tenancy.ts";
import { retryAfterMs } from "../../doors/link-sweep.ts";
import { RATE_LIMIT_BACKOFF_MS } from "../../hunt/access-control.ts";
import { isLeadOrder, OWNER_LEAD_SOURCE, rowOpen, type LeadFound, type LeadOrder, type LeadRow } from "./order.ts";

/** How long one round spends starting new tests. */
export const LEADS_PASS_BUDGET_MS = 60_000;
/** The most links one pass tests. */
export const LEADS_PASS_MAX_TESTS = 300;
/** A server error is tried again after this long. */
export const LEAD_BACKOFF_MS = 15 * 60_000;
/** Tries before an unreachable link or a server error is called failed. */
export const LEAD_MAX_TRIES = 3;

export interface LeadsPassInput {
  readonly repos: Pick<ControlPlaneRepositories, "leadOrders" | "fieldManual"> & Partial<Pick<ControlPlaneRepositories, "fixMap" | "adminConfig">>;
  readonly get: ResearchGet;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Places inside a Send or a funded area: the only places paid work may go. */
  readonly sendPlaceIds: ReadonlySet<string>;
  readonly maxTests?: number;
  /** Nothing new is started at or after this instant. */
  readonly deadlineMs?: number;
  /** How many websites are read at once. */
  readonly concurrency?: number;
  readonly spacingMs?: number;
}

export interface LeadsPassResult {
  readonly orders: number;
  readonly tested: number;
  readonly works: number;
  readonly paid: number;
  readonly failed: number;
  readonly waiting: number;
  readonly lessons: number;
  readonly lessonError: string | null;
}

/** Whether a place is inside one the owner sent money to: the place itself, or within one. */
export function insideSentPlace(place: string | null, sent: ReadonlySet<string>): boolean {
  if (place === null) return false;
  const p = place.split("#")[0]!;
  for (const s of sent) if (p === s || p.startsWith(`${s}/`)) return true;
  return false;
}

const hostOf = (url: string): string => new URL(url).host.toLowerCase();

/** The runner's guarded fetch as the research reader takes it: every request, robots.txt included, is paced with every other reader's. */
export function guardedLeadGet(safety: Pick<FleetSafetyController, "guardedOpenBytes">, fetchImpl: typeof fetch = fetch): ResearchGet {
  const opened = safety.guardedOpenBytes("public-web", "research-leads", fetchImpl, { followRedirects: false });
  return async ({ url, headers, timeoutMs }) => {
    const got = await opened({ url, headers, timeoutMs });
    return { status: got.status, body: got.bytes, contentType: got.contentType, location: got.location ?? null, transportError: got.transportError };
  };
}

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/;

/** A request the shared pacing held back, with when it may go: null when the refusal is not about pacing. */
function heldBack(transportError: string, nowMs: number): { readonly why: string; readonly until: number | null } | null {
  const code = /^([A-Z][A-Z0-9_]+): /.exec(transportError)?.[1];
  if (code === undefined) return null;
  const at = ISO.exec(transportError)?.[0];
  const until = at === undefined ? null : Date.parse(at);
  const after = until !== null && until > nowMs ? ` trying again after ${formatEasternTime(new Date(until).toISOString())}` : " trying again next round";
  if (code === "WEBSITE_REQUEST_CAP") return { why: "A small local website is read at most 10 times an hour; this link is next in line.", until };
  if (code === "WEBSITE_ASKED_TO_WAIT" || code === "PROVIDER_CIRCUIT_BROKEN") return { why: `The website asked us to wait;${after}.`, until };
  return { why: "Our pacing held it back this round; trying again next round.", until };
}const READABLE = /html|xml|json|pdf|text\/|calendar|rss|atom|csv|spreadsheet|msword|officedocument/i;

/** The platform a page is on: its own host first, then a vendor's markup on the page. */
function platformOf(finalUrl: string, html: string): { id: string; label: string } | null {
  const byHost = detectTenancy(finalUrl, finalUrl)[0];
  if (byHost) return { id: byHost.platform, label: byHost.label };
  const served = detectTenancy(html, finalUrl).find((hit) => hit.strength === "SERVED_BY");
  return served ? { id: served.platform, label: served.label } : null;
}

type Verdict =
  | { readonly kind: "works"; readonly found: LeadFound }
  | { readonly kind: "turned-away"; readonly why: string; readonly found: LeadFound | null }
  | { readonly kind: "failed"; readonly why: string; readonly found: LeadFound | null }
  | { readonly kind: "later"; readonly why: string; readonly until: number | null; readonly countsTry: boolean };

function verdictOf(fetched: ResearchFetchResult, row: LeadRow, nowMs: number): Verdict {
  if (fetched.outcome === "REFUSED") {
    return { kind: "failed", found: null, why: /redirects/.test(fetched.reason) ? "The page redirects too many times." :
      /public http/.test(fetched.reason) ? "It redirects to an address that isn't a public web page." : "This website is on our list of sites that wall off automated readers." };
  }
  const robots = fetched.permissions.at(-1);
  const text = new TextDecoder().decode(fetched.body.subarray(0, 512_000));
  const platform = fetched.transportError === null ? platformOf(fetched.finalUrl, text) : null;
  const found: LeadFound = { finalUrl: fetched.finalUrl, httpStatus: fetched.status, contentType: fetched.contentType,
    platform: platform?.id ?? null, platformLabel: platform?.label ?? null,
    robots: robots ? { verdict: robots.verdict, detail: robots.detail } : null };
  if (fetched.transportError !== null || fetched.status === null) {
    if (/ENOTFOUND|getaddrinfo/i.test(fetched.transportError ?? "")) return { kind: "failed", found: null, why: "The website's address doesn't exist." };
    const held = heldBack(fetched.transportError ?? "", nowMs);
    if (held !== null) return { kind: "later", why: held.why, until: held.until, countsTry: false };
    return row.tries + 1 >= LEAD_MAX_TRIES
      ? { kind: "failed", found: null, why: `The website didn't answer in ${LEAD_MAX_TRIES} tries.` }
      : { kind: "later", why: "The website didn't answer; trying again next round.", until: null, countsTry: true };
  }
  const status = fetched.status;
  const wait = retryAfterMs(fetched.retryAfter, nowMs);
  if (status === 429 || status === 503 || (status >= 500 && wait !== null)) {
    const until = nowMs + Math.max(RATE_LIMIT_BACKOFF_MS, wait ?? 0);
    return { kind: "later", why: `The website asked us to wait; trying again after ${formatEasternTime(new Date(until).toISOString())}.`, until, countsTry: false };
  }
  if (status >= 500) {
    return row.tries + 1 >= LEAD_MAX_TRIES
      ? { kind: "failed", found, why: `The website kept answering with a server error (${status}) across ${LEAD_MAX_TRIES} tries.` }
      : { kind: "later", why: `The website had a server error (${status}); trying again later.`, until: nowMs + LEAD_BACKOFF_MS, countsTry: true };
  }
  if (status === 404) return { kind: "failed", found, why: "The page wasn't found (404)." };
  if (status === 410) return { kind: "failed", found, why: "The page is gone (410)." };
  if (fetched.accessControl !== null || status === 401 || status === 403) {
    const how = fetched.accessControl?.kind === "AUTHENTICATION" || status === 401 ? "it asks for a sign-in"
      : fetched.accessControl?.kind === "CHALLENGE" ? "it shows a bot check" : `it turned plain code away (${status})`;
    return { kind: "turned-away", found, why: how };
  }
  if (status >= 300) return { kind: "failed", found, why: `The page redirects without saying where (${status}).` };
  if (status >= 400) return { kind: "failed", found, why: `The website answered ${status}.` };
  if (fetched.body.byteLength === 0) return { kind: "turned-away", found, why: "the page came back empty" };
  if (fetched.contentType !== "" && !READABLE.test(fetched.contentType)) return { kind: "failed", found, why: `It isn't a page or document we can read (${fetched.contentType.split(";")[0]}).` };
  return { kind: "works", found };
}

function lessonFor(row: LeadRow, order: LeadOrder, nowIso: string): FieldManualEntry {
  const found = row.found!;
  const works = row.state === "WORKS";
  const notes = Object.entries(row.notes).map(([k, v]) => `${k}: ${v}`).join("; ");
  const host = new URL(found.finalUrl).hostname;
  const robots = found.robots?.verdict === "DISALLOWED" ? ` ${ROBOTS_WORDS}` : "";
  return newFieldManualEntry(OWNER_LEAD_SOURCE, row.url!, {
    role: "SHARED",
    kind: works ? "ROUTE" : "LEAD",
    title: `${row.notes.Name ?? row.notes.name ?? row.notes.Title ?? row.notes.title ?? host}${found.platformLabel ? ` (${found.platformLabel})` : ""}`,
    summary: works
      ? `The owner's lead: plain code read it (HTTP ${found.httpStatus}, ${found.contentType.split(";")[0] || "no type"}).${robots}${notes ? ` Notes: ${notes}` : ""}`
      : `The owner's lead: plain code was turned away (${row.why}); try it here with a browser or a model.${notes ? ` Notes: ${notes}` : ""}`,
    outcome: works ? "YIELDED" : "REFERENCE",
    url: row.url,
    platforms: found.platform ? [found.platform] : [],
    states: row.stateAbbr ? [row.stateAbbr] : [],
    ...(row.place ? { ocdIds: [row.place] } : {}),
    observedAt: row.testedAt ?? nowIso,
    payload: { lead: { link: row.link, finalUrl: found.finalUrl, notes: row.notes, orderId: order.orderId, row: row.n,
      httpStatus: found.httpStatus, contentType: found.contentType, robots: found.robots }, places: row.place ? [row.place] : [] },
  });
}

const ROBOTS_WORDS = "Its robots.txt asks automated readers to stay out; that is recorded, and it was read anyway.";

function worksWords(row: LeadRow): string {
  const on = row.found?.platformLabel ? ` It spreads to other places on ${row.found.platformLabel}.` : "";
  const robots = row.found?.robots?.verdict === "DISALLOWED" ? ` ${ROBOTS_WORDS}` : "";
  return `Works: plain code read it. Saved as a lesson with you as the source.${on}${robots}`;
}

/** Test what is due across every open order, save what was learned, and record each row's result on its order. */
export async function runLeadsPass(input: LeadsPassInput): Promise<LeadsPassResult> {
  const orders = (await input.repos.leadOrders.listWhere(["open"], "true")).filter((row) => isLeadOrder(row.value));
  const result = { orders: orders.length, tested: 0, works: 0, paid: 0, failed: 0, waiting: 0, lessons: 0, lessonError: null as string | null };
  if (orders.length === 0) return result;
  const nowMs = input.now();
  const changed = new Map<string, Map<number, LeadRow>>();
  const change = (orderId: string, row: LeadRow) => {
    const rows = changed.get(orderId) ?? new Map<number, LeadRow>();
    rows.set(row.n, row);
    changed.set(orderId, rows);
  };

  const due: { order: LeadOrder; row: LeadRow }[] = [];
  for (const { value: order } of orders) {
    for (const row of order.rows) {
      if (row.state === "QUEUED" && row.url !== null && (row.notBefore === null || Date.parse(row.notBefore) <= nowMs)) due.push({ order, row });
    }
  }
  const byHost = new Map<string, { order: LeadOrder; row: LeadRow }[]>();
  for (const item of due.slice(0, input.maxTests ?? LEADS_PASS_MAX_TESTS)) {
    const host = hostOf(item.row.url!);
    byHost.set(host, [...(byHost.get(host) ?? []), item]);
  }

  const memory = memoryInProcess();
  const readHost = async (items: readonly { order: LeadOrder; row: LeadRow }[]): Promise<void> => {
    for (const { order, row } of items) {
      if (input.deadlineMs !== undefined && input.now() >= input.deadlineMs) return;
      const fetched = await researchFetch(row.url!, { get: input.get, memory, now: input.now, sleep: input.sleep,
        ...(input.spacingMs !== undefined ? { spacingMs: input.spacingMs } : {}) });
      const at = new Date(input.now()).toISOString();
      const verdict = verdictOf(fetched, row, input.now());
      if (verdict.kind === "later") {
        change(order.orderId, { ...row, testedAt: verdict.countsTry ? at : row.testedAt, tries: row.tries + (verdict.countsTry ? 1 : 0), why: verdict.why,
          notBefore: verdict.until === null ? null : new Date(verdict.until).toISOString() });
        result.waiting += 1;
        if (verdict.countsTry) result.tested += 1;
        continue;
      }
      const tested = { ...row, testedAt: at, tries: row.tries + 1, notBefore: null, found: verdict.found };
      result.tested += 1;
      if (verdict.kind === "works") {
        change(order.orderId, { ...tested, state: "WORKS", why: worksWords(tested) });
        result.works += 1;
      } else if (verdict.kind === "turned-away" && insideSentPlace(row.place, input.sendPlaceIds)) {
        change(order.orderId, { ...tested, state: "PAID",
          why: `Plain code couldn't read it: ${verdict.why}. Its place has your money, so paid workers there are given it to try.` });
        result.paid += 1;
      } else {
        const why = verdict.kind === "failed" ? verdict.why
          : `Plain code couldn't read it: ${verdict.why}. Paid work runs only inside places you've sent money to, and ${row.place === null ? "no place is known for this link" : "this link's place isn't one of them"}.`;
        change(order.orderId, { ...tested, state: "FAILED", why });
        result.failed += 1;
      }
    }
  };
  const hosts = [...byHost.entries()];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, input.concurrency ?? 6), hosts.length) }, async () => {
    while (next < hosts.length) {
      await readHost(hosts[next++]![1]);
    }
  }));

  // Lessons: every row that worked or went to paid work and has none saved yet, including ones a failed write left behind.
  const nowIso = new Date(input.now()).toISOString();
  const owed: { orderId: string; row: LeadRow; entry: FieldManualEntry }[] = [];
  for (const { value: order } of orders) {
    for (const held of order.rows) {
      const row = changed.get(order.orderId)?.get(held.n) ?? held;
      if ((row.state === "WORKS" || row.state === "PAID") && row.lessonId === null && row.found !== null && row.url !== null) owed.push({ orderId: order.orderId, row, entry: lessonFor(row, order, nowIso) });
    }
  }
  if (owed.length > 0) {
    const saved = await writeFieldManual(input.repos, owed.map((o) => o.entry), nowIso);
    if (saved.error === undefined) {
      result.lessons = owed.length;
      for (const o of owed) change(o.orderId, { ...o.row, lessonId: o.entry.id });
    } else {
      result.lessonError = saved.error;
      for (const o of owed) change(o.orderId, { ...o.row, why: `${o.row.why.replace(/ Saving the lesson failed.*$/, "")} Saving the lesson failed this round; it is tried again next round.` });
    }
  }

  for (const [orderId, rows] of changed) await saveRows(input.repos, orderId, rows, nowIso);
  return result;
}

/** Fold changed rows into the order under its compare-and-set; a lost race re-reads the order and folds again. */
async function saveRows(repos: LeadsPassInput["repos"], orderId: string, rows: ReadonlyMap<number, LeadRow>, nowIso: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const held = await repos.leadOrders.read(orderId);
    if (held === null || !isLeadOrder(held.value)) return;
    const merged = held.value.rows.map((row) => rows.get(row.n) ?? row);
    const next: LeadOrder = { ...held.value, rows: merged, open: merged.some(rowOpen), updatedAt: nowIso };
    try {
      await repos.leadOrders.compareAndSet(orderId, held.revision, next, nowIso);
      return;
    } catch (error) {
      if (!(error instanceof ConcurrentModification) || attempt === 4) throw error;
    }
  }
}
