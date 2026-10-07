/**
 * `leads.upload`: the owner's research leads become one tracked order. Every
 * link is checked against what is already held (a saved capture, a door we
 * read, a lead already learned from) and marked so; the rest are queued for
 * the runner's plain-code test. A row that is not a public web address fails
 * at once with the reason.
 */

import type { ActionResult, RegisteredAction, Validation } from "../gateway/registry.ts";
import { writeFailureSays } from "../gateway/write-readback.ts";
import { fieldManualEntryId } from "../field-manual.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import {
  canonicalLeadUrl,
  isPublicLeadUrl,
  LEAD_LINK_MAX_CHARS,
  LEAD_NOTE_KEYS_MAX,
  LEAD_NOTE_MAX_CHARS,
  leadCounts,
  leadCountsWords,
  LEADS_ACTION,
  LEADS_MAX_ROWS,
  OWNER_LEAD_SOURCE,
  placeFromNotes,
  rowOpen,
  type LeadOrder,
  type LeadRow,
} from "./order.ts";
import { stateOfPlace } from "../../method/fix-map.ts";

const bad = (why: string): Validation => ({ ok: false, why });
const refuse = (says: string): ActionResult => ({ ok: false, refusal: "DOWNSTREAM_REFUSED", says });

interface InputRow {
  readonly link: string;
  readonly notes: Readonly<Record<string, string>>;
}

function validateRows(raw: unknown): { readonly ok: true; readonly rows: readonly InputRow[] } | { readonly ok: false; readonly why: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, why: "there are no links in this upload" };
  if (raw.length > LEADS_MAX_ROWS) return { ok: false, why: `that is ${raw.length.toLocaleString("en-US")} links; one upload takes at most ${LEADS_MAX_ROWS.toLocaleString("en-US")}. Split it` };
  const rows: InputRow[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i] as Readonly<Record<string, unknown>> | null;
    const link = r !== null && typeof r === "object" && typeof r.link === "string" ? r.link.trim() : "";
    if (link === "") return { ok: false, why: `row ${i + 1} has no link` };
    const notes: Record<string, string> = {};
    const given = r!.notes !== null && typeof r!.notes === "object" && !Array.isArray(r!.notes) ? Object.entries(r!.notes as Record<string, unknown>) : [];
    for (const [key, value] of given.slice(0, LEAD_NOTE_KEYS_MAX)) {
      if (typeof value !== "string" || value.trim() === "") continue;
      notes[key.trim().slice(0, 60) || "Note"] = value.replace(/\s+/g, " ").trim().slice(0, LEAD_NOTE_MAX_CHARS);
    }
    rows.push({ link: link.slice(0, LEAD_LINK_MAX_CHARS), notes });
  }
  return { ok: true, rows };
}

/** Every web address a door's record names, canonical. */
function doorUrls(door: DoorRecord): string[] {
  const out: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value.trim())) {
        const url = canonicalLeadUrl(value);
        if (url !== null) out.push(url);
      }
    } else if (Array.isArray(value)) for (const v of value) visit(v, depth + 1);
    else if (value !== null && typeof value === "object") for (const v of Object.values(value)) visit(v, depth + 1);
  };
  visit(door.config, 0);
  visit(door.meeting, 0);
  return out;
}

const hostOf = (url: string): string => new URL(url).hostname.toLowerCase();

export const LEAD_ACTIONS: readonly RegisteredAction[] = [
  {
    definition: {
      type: LEADS_ACTION,
      label: "Send research leads",
      does:
        "Records the links you uploaded as one order, one row each, with your other columns kept as notes. Links already held are marked so. " +
        "The runner tests every new link with plain code at normal pacing; what works is saved as a lesson with you as the source and spreads to places with the same kind of website.",
      doesNot:
        "Makes no model call to record or test a link, and sends no paid work outside places you have sent money to. Does not change any budget or limit.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a list of research leads",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const rows = validateRows(input.rows);
      return rows.ok ? { ok: true, value: { rows: rows.rows } } : bad(rows.why);
    },
    async execute(deps, context, input) {
      const given = input.rows as readonly InputRow[];
      const at = context.at;
      const seen = new Set<string>();
      let repeats = 0;
      const drafts: { link: string; url: string | null; notes: Readonly<Record<string, string>>; bad: string | null }[] = [];
      for (const row of given) {
        const url = canonicalLeadUrl(row.link);
        const key = url ?? row.link;
        if (seen.has(key)) {
          repeats += 1;
          continue;
        }
        seen.add(key);
        drafts.push({ link: row.link, url, notes: row.notes,
          bad: url === null ? "This isn't a web address we can open." : !isPublicLeadUrl(url) ? "This isn't a public web address." : null });
      }
      const urls = drafts.filter((d) => d.bad === null).map((d) => d.url!);
      let captured: ReadonlySet<string>;
      let doors: readonly DoorRecord[];
      let learned: ReadonlySet<string>;
      try {
        captured = deps.repos.capturedCanonicalUrls ? await deps.repos.capturedCanonicalUrls(urls) : new Set();
        doors = (await deps.repos.doors.list()).map((row) => row.value);
        const ids = new Map(urls.map((url) => [fieldManualEntryId(OWNER_LEAD_SOURCE, url), url] as const));
        learned = new Set((await deps.repos.fieldManual.readMany([...ids.keys()])).map((row) => ids.get(row.id)!));
      } catch (error) {
        return refuse(writeFailureSays("the check against what is already held", error));
      }
      const doorByUrl = new Map<string, DoorRecord>();
      const placesByHost = new Map<string, Set<string>>();
      for (const door of doors) {
        for (const url of doorUrls(door)) if (!doorByUrl.has(url)) doorByUrl.set(url, door);
        if (door.ocdId === null) continue;
        for (const host of door.hosts) {
          const set = placesByHost.get(host.toLowerCase()) ?? new Set<string>();
          set.add(door.ocdId.split("#")[0]!);
          placesByHost.set(host.toLowerCase(), set);
        }
      }
      const rows: LeadRow[] = drafts.map((d, i) => {
        const named = placeFromNotes(d.notes);
        const door = d.url === null ? undefined : doorByUrl.get(d.url);
        const byHost = d.url === null || d.bad !== null ? null : placesByHost.get(hostOf(d.url));
        const place = named.place ?? (door?.ocdId ? door.ocdId.split("#")[0]! : byHost?.size === 1 ? [...byHost][0]! : null);
        const base = { n: i + 1, link: d.link, url: d.url, notes: d.notes, place, stateAbbr: named.state ?? (place ? stateOfPlace(place) : null),
          tries: 0, testedAt: null, notBefore: null, found: null, lessonId: null };
        if (d.bad !== null) return { ...base, state: "FAILED", why: d.bad };
        if (captured.has(d.url!)) return { ...base, state: "HELD", why: "Already held: a saved copy of this page is on file." };
        if (door !== undefined) return { ...base, state: "HELD", why: "Already held: we read this page on a schedule." };
        if (learned.has(d.url!)) return { ...base, state: "HELD", why: "Already held: you sent this link before, and it is saved as a lesson." };
        return { ...base, state: "QUEUED", why: "Waiting for the runner's plain-code test." };
      });
      const order: LeadOrder = { formatVersion: 1, orderId: context.receiptId, receivedAt: at, actorRef: context.request.actorRef,
        open: rows.some(rowOpen), rows, updatedAt: at };
      try {
        await deps.repos.leadOrders.put(order.orderId, order, at);
      } catch (error) {
        return refuse(writeFailureSays("your research leads", error));
      }
      const counts = leadCounts(order);
      const repeated = repeats > 0 ? ` ${repeats.toLocaleString("en-US")} repeated link${repeats === 1 ? " was" : "s were"} counted once.` : "";
      return {
        ok: true,
        outcome: order.open ? "QUEUED" : "DONE",
        subject: `${counts.total} leads`,
        says: `Received ${leadCountsWords(counts)}${repeated}` + (order.open ? " The runner tests each new link with plain code; every row shows its result here as it comes in." : ""),
        openedWork: [],
        readBackAt: "/admin/queue",
        undo: null,
      };
    },
  },
];
