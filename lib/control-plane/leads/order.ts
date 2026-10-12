/**
 * A research-leads order: the links the owner uploaded, one row each, kept as
 * one aggregate per order (`cp_lead_orders`, keyed by the order's receipt id).
 * A row starts held or queued; the runner's plain-code pass moves each queued
 * row to works, sent to paid work, or failed with the reason.
 */

import { stateOfPlace } from "../../method/fix-map.ts";
import { stateEntry, US_STATES } from "../readiness/catalog.ts";

export const LEADS_ACTION = "leads.upload";
/** The most rows one upload takes. */
export const LEADS_MAX_ROWS = 5000;
export const LEAD_LINK_MAX_CHARS = 2048;
export const LEAD_NOTE_KEYS_MAX = 12;
export const LEAD_NOTE_MAX_CHARS = 300;
/** Lessons from the owner's leads carry this source. */
export const OWNER_LEAD_SOURCE = "owner-lead";

export type LeadRowState = "HELD" | "QUEUED" | "WORKS" | "PAID" | "FAILED";

export interface LeadRow {
  /** The row's number in the upload, from 1. */
  readonly n: number;
  /** The link as the owner gave it. */
  readonly link: string;
  /** The canonical form, or null when it is not a web address. */
  readonly url: string | null;
  readonly notes: Readonly<Record<string, string>>;
  readonly state: LeadRowState;
  /** Plain words: where it is held, why it waits, why it failed, or what was learned. */
  readonly why: string;
  /** The division the link serves, when the notes or a door say. */
  readonly place: string | null;
  /** Lowercase two-letter state, when known. */
  readonly stateAbbr: string | null;
  readonly tries: number;
  readonly testedAt: string | null;
  /** Not tested again before this time (the website asked us to wait, or pacing held it back). */
  readonly notBefore: string | null;
  readonly found: LeadFound | null;
  /** The field manual entry it became, once saved. */
  readonly lessonId: string | null;
}

/** What the plain-code read saw, kept so a lesson can be saved again without reading again. */
export interface LeadFound {
  readonly finalUrl: string;
  readonly httpStatus: number | null;
  readonly contentType: string;
  readonly platform: string | null;
  readonly platformLabel: string | null;
  readonly robots: { readonly verdict: string; readonly detail: string } | null;
}

export interface LeadOrder {
  readonly formatVersion: 1;
  readonly orderId: string;
  readonly receivedAt: string;
  readonly actorRef: string;
  /** True while any row is still owed a test or a lesson. */
  readonly open: boolean;
  readonly rows: readonly LeadRow[];
  readonly updatedAt: string;
}

/** The link as an absolute web address with no fragment, the form captures are keyed by; null when it is not one. */
export function canonicalLeadUrl(raw: string): string | null {
  const t = raw.trim().replace(/^<|>$/g, "");
  if (t === "" || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$)/i.test(t) ? `https://${t}` : null;
  if (withScheme === null) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** A public host: no credentials and no private network. */
export function isPublicLeadUrl(url: string): boolean {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) return false;
  return !(host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || host.startsWith("["));
}

const OCD = /ocd-division\/[^\s"'<>#,;)]+/i;

/** The place and state the owner's notes name: any division id, and a state column by code or name. */
export function placeFromNotes(notes: Readonly<Record<string, string>>): { readonly place: string | null; readonly state: string | null } {
  let place: string | null = null;
  let state: string | null = null;
  for (const [key, value] of Object.entries(notes)) {
    const ocd = OCD.exec(value)?.[0];
    if (ocd && place === null) place = ocd.toLowerCase();
    if (state === null && /^(?:state|st|state_?code)$/i.test(key.trim())) {
      const v = value.trim().toLowerCase();
      if (/^[a-z]{2}$/.test(v) && stateEntry(v)) state = v;
      else {
        const named = US_STATES.find((s) => s.name.toLowerCase() === v);
        if (named) state = named.code;
      }
    }
  }
  return { place, state: state ?? (place ? stateOfPlace(place) : null) };
}

/** A row still owes work: a test, or a lesson that has not saved yet. */
export function rowOpen(row: LeadRow): boolean {
  return row.state === "QUEUED" || ((row.state === "WORKS" || row.state === "PAID") && row.lessonId === null);
}

export function isLeadOrder(value: unknown): value is LeadOrder {
  const v = value as Partial<LeadOrder> | null;
  return v !== null && typeof v === "object" && v.formatVersion === 1 && typeof v.orderId === "string" && Array.isArray(v.rows);
}

export type LeadItemStatus = "done" | "failed" | "queued" | "running";

/** One row as order tracking shows it. */
export interface LeadItem {
  readonly name: string;
  readonly status: LeadItemStatus;
  readonly label: string;
  readonly note: string;
}

const ITEM_NAME_MAX = 160;
const LABELS: Readonly<Record<LeadRowState, string>> = {
  HELD: "Already held",
  QUEUED: "Queued",
  WORKS: "Works",
  PAID: "Sent to paid work",
  FAILED: "Failed",
};

/** Failed rows first, then rows still owed, then what worked and what was held, each in upload order. */
export function leadItems(order: LeadOrder): LeadItem[] {
  const rank: Readonly<Record<LeadRowState, number>> = { FAILED: 0, QUEUED: 1, WORKS: 2, PAID: 2, HELD: 3 };
  return [...order.rows].sort((a, b) => rank[a.state] - rank[b.state] || a.n - b.n).map((row) => {
    const name = row.link.length > ITEM_NAME_MAX ? `${row.link.slice(0, ITEM_NAME_MAX - 1)}…` : row.link;
    const status: LeadItemStatus = row.state === "FAILED" ? "failed" : row.state === "QUEUED" ? (row.tries > 0 || row.notBefore !== null ? "running" : "queued") : "done";
    return { name, status, label: row.state === "QUEUED" && row.notBefore !== null ? "Waiting" : LABELS[row.state], note: row.why };
  });
}

export interface LeadCounts {
  readonly total: number;
  readonly held: number;
  readonly works: number;
  readonly paid: number;
  readonly failed: number;
  readonly queued: number;
  /** Rows tested at least once. */
  readonly tested: number;
}

export function leadCounts(order: LeadOrder): LeadCounts {
  const count = (state: LeadRowState) => order.rows.filter((r) => r.state === state).length;
  return {
    total: order.rows.length, held: count("HELD"), works: count("WORKS"), paid: count("PAID"), failed: count("FAILED"), queued: count("QUEUED"),
    tested: order.rows.filter((r) => r.testedAt !== null).length,
  };
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The order in one line: what each row came to. */
export function leadCountsWords(c: LeadCounts): string {
  const parts = [
    c.held > 0 ? `${c.held.toLocaleString("en-US")} already held` : null,
    c.works > 0 ? `${c.works.toLocaleString("en-US")} work` : null,
    c.paid > 0 ? `${c.paid.toLocaleString("en-US")} sent to paid work` : null,
    c.failed > 0 ? `${c.failed.toLocaleString("en-US")} failed` : null,
    c.queued > 0 ? `${c.queued.toLocaleString("en-US")} still to test` : null,
  ].filter((p): p is string => p !== null);
  return `${plural(c.total, "link", "links")}: ${parts.join(", ")}.`;
}
