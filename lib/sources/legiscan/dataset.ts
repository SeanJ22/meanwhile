import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openZipFile } from "../archive.ts";
import { PLURAL_STATES } from "../plural/targets.ts";
import type { PluralVoteFact } from "../plural/votes.ts";
import type { Officeholder } from "../../officials/types.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import type { SourceCheckEvidence } from "../../civic-data/types.ts";

export const LEGISCAN_VOTES_PARSER = "legiscan-votes/1";
export const LEGISCAN_VOTES_SOURCE = "legiscan";
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
export const nativePersonId = (value: unknown): boolean => typeof value === "string" && /^ocd-person\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function legiscanState(state: string) {
  const normalized = state.replace(/^US-/i, "").toLowerCase();
  if (!PLURAL_STATES.includes(normalized)) throw new Error(`LEGISCAN_STATE_UNSUPPORTED:${normalized}`);
  return normalized.toUpperCase();
}
/** Official .gov www aliases share their publisher namespace; paths and queries remain exact. */
export function profileUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash || !url.pathname.replace(/\/$/, "")) return null;
    if (/^www\..+\.gov$/.test(url.hostname)) url.hostname = url.hostname.slice(4);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  } catch { return null; }
}
export interface LegiscanSession {
  state: string; stateId: number; sessionId: number; sessionName: string; datasetHash: string; datasetDate: string;
  yearStart: number; yearEnd: number;
}
/** Current and immediately previous legislative years include intervening special sessions. */
export function parseLegiscanDatasetList(body: string, state: string): LegiscanSession[] {
  const root = object(JSON.parse(body)), normalized = legiscanState(state);
  if (root.status !== "OK" || !Array.isArray(root.datasetlist)) throw new Error("LEGISCAN_DATASET_LIST_INVALID");
  const rows = root.datasetlist.map(value => {
    const row = object(value);
    if (!positiveId(row.state_id) || !positiveId(row.session_id) || !positiveId(row.year_start) || !positiveId(row.year_end) ||
      !text(row.session_name) || !/^[a-f0-9]{32,64}$/.test(text(row.dataset_hash)) || !validDay(row.dataset_date)) throw new Error("LEGISCAN_DATASET_LIST_SESSION_INVALID");
    return { state: normalized, stateId: row.state_id, sessionId: row.session_id, sessionName: text(row.session_name), datasetHash: text(row.dataset_hash),
      datasetDate: row.dataset_date, yearStart: row.year_start, yearEnd: row.year_end };
  });
  if (new Set(rows.map(row => row.stateId)).size > 1 || new Set(rows.map(row => row.sessionId)).size !== rows.length) throw new Error("LEGISCAN_DATASET_LIST_SCOPE_OR_DUPLICATE");
  const years = [...new Set(rows.map(row => row.yearStart))].sort((a, b) => b - a).slice(0, 2);
  return rows.filter(row => years.includes(row.yearStart)).sort((a, b) => b.yearStart - a.yearStart || b.sessionId - a.sessionId);
}
export interface LegiscanDatasetEvidence {
  requestedUrl: string; finalUrl: string; retrievedAt: string; sha256: string; vaultKey?: string; sourceCheck?: SourceCheckEvidence;
  /** Exact decoded archive members are held only for this state's dataset. */
  members?: readonly { name: string; sha256: string }[];
}
export interface LegiscanPersonJoin {
  legiscanPeopleId: number; personId: string; basis: "NATIVE_ID" | "EXACT_MEMBER_PROFILE_URL"; sourceUrl: string; matchedUrl: string | null;
  openStatesProfileUrl: string | null; legiscanProfileUrl: string | null;
  /** The independently promoted native roster version survives later departures. */
  sourceRosterVersionId?: string;
}
export interface LegiscanIdentityAuthority {
  scope: string; versionId: string; sourceId: "plural-openstates"; crosswalkSha256: string; joins: LegiscanPersonJoin[];
}
export function sourcePersonIds(holder: Officeholder): string[] {
  return [...new Set([...(holder.nativeIds?.["ocd-person"] ?? []), holder.personId ?? "", holder.id].flatMap(value =>
    nativePersonId(value) ? [value] : /^plural:(?:[a-z]{2}:)?([0-9a-f-]{36})$/.test(value) ? [`ocd-person/${value.split(":").at(-1)}`] : []))];
}
/** Names, party, district and office title never participate in this crosswalk. */
export function legiscanIdentityJoins(holders: readonly Officeholder[], people: readonly Record<string, unknown>[]) {
  const matches = new Map<number, Map<string, LegiscanPersonJoin>>();
  for (const person of people) {
    if (!positiveId(person.people_id)) continue;
    const bio = object(person.bio), social = object(bio.social), official = object(object(bio.links).official);
    const urls = new Map([social.biography, official.website].flatMap(value => profileUrl(value) ? [[profileUrl(value)!, text(value)] as const] : []));
    const candidates = new Map<string, LegiscanPersonJoin>();
    for (const holder of holders) {
      const sourceUrl = holder.provenance?.sourceUrl;
      if (holder.level !== "STATE" || !sourceUrl || !profileUrl(sourceUrl)) continue;
      const ids = sourcePersonIds(holder);
      if (ids.length !== 1) continue;
      const native = Object.entries(holder.nativeIds ?? {}).filter(([scheme]) => /^legiscan$/i.test(scheme)).flatMap(([, ids]) => ids).includes(String(person.people_id));
      const originalUrl = [holder.websiteUrl, ...(holder.profileUrls ?? [])].find(value => profileUrl(value) !== null && urls.has(profileUrl(value)!));
      const sharedUrl = profileUrl(originalUrl);
      if (!native && !sharedUrl) continue;
      candidates.set(ids[0], { legiscanPeopleId: person.people_id, personId: ids[0], basis: native ? "NATIVE_ID" : "EXACT_MEMBER_PROFILE_URL",
        sourceUrl, matchedUrl: native ? null : sharedUrl!,
        openStatesProfileUrl: native ? null : originalUrl!, legiscanProfileUrl: native ? null : urls.get(sharedUrl!)! });
    }
    matches.set(person.people_id, candidates);
  }
  const one = [...matches.values()].filter(matches => matches.size === 1).map(matches => [...matches.values()][0]);
  // A shared profile or alias cannot bind two vendor people to the same native person.
  const repeated = new Set(one.filter((row, at, all) => all.findIndex(other => other.personId === row.personId) !== at).map(row => row.personId));
  return one.filter(row => !repeated.has(row.personId)).sort((a, b) => a.legiscanPeopleId - b.legiscanPeopleId);
}
export async function parseLegiscanDataset(input: { state: string; session: LegiscanSession; bytes: Uint8Array; evidence: LegiscanDatasetEvidence;
  holders: readonly Officeholder[]; signal: AbortSignal }) {
  const state = legiscanState(input.state);
  const stagingDirectory = await mkdtemp(join(tmpdir(), "meanwhile-legiscan-"));
  const bills = new Map<number, Record<string, unknown>>(), rolls: Record<string, unknown>[] = [], people: Record<string, unknown>[] = [];
  const members: { name: string; sha256: string }[] = [];
  try {
    const path = join(stagingDirectory, "dataset.zip"); await writeFile(path, input.bytes);
    const entries = await openZipFile(path, { maxEntries: 250_000, maxMemberBytes: 32 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 });
    if (!entries.length || entries.some(entry => !entry.name.startsWith(`${state}/`))) throw new Error("LEGISCAN_DATASET_STATE_MISMATCH");
    for (const entry of entries) {
      input.signal.throwIfAborted();
      const relevant = /\/(bill|vote|people)\/[^/]+\.json$/.exec(entry.name)?.[1];
      const chunks: Uint8Array[] = [];
      for await (const chunk of entry.stream()) { input.signal.throwIfAborted(); if (relevant) chunks.push(chunk); }
      if (!relevant) continue;
      const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), value = object(JSON.parse(body));
      // Original archive bytes live once in the vault. Member hashes make every row replayable.
      members.push({ name: entry.name, sha256: digest(body) });
      if (relevant === "bill") {
        const bill = object(value.bill);
        if (!positiveId(bill.bill_id) || bill.state !== state || bill.session_id !== input.session.sessionId) throw new Error("LEGISCAN_BILL_SCOPE_INVALID");
        if (bills.has(bill.bill_id)) throw new Error("LEGISCAN_BILL_DUPLICATE");
        // Bill text, amendments, sponsor lists and history remain in the archive;
        // the member-position join needs only these native roll metadata fields.
        bills.set(bill.bill_id, { bill_id: bill.bill_id, bill_number: bill.bill_number, title: bill.title,
          url: bill.url, state_link: bill.state_link, votes: bill.votes });
      } else if (relevant === "vote") rolls.push(object(value.roll_call));
      else {
        const person = object(value.person);
        if (!positiveId(person.people_id) || person.state_id !== input.session.stateId) throw new Error("LEGISCAN_PERSON_SCOPE_INVALID");
        people.push(person);
      }
    }
  } finally { await rm(stagingDirectory, { recursive: true, force: true }); }
  if (new Set(people.map(person => person.people_id)).size !== people.length) throw new Error("LEGISCAN_PERSON_DUPLICATE");
  const joins = legiscanIdentityJoins(input.holders, people), peopleById = new Map(joins.map(identity => [identity.legiscanPeopleId, identity.personId]));
  const votes: PluralVoteFact[] = [], held: { key: string; detail: string }[] = people.filter(person => !peopleById.has(Number(person.people_id)))
    .map(person => ({ key: `legiscan:people:${person.people_id}`, detail: "No unique source-backed OpenStates person identity joined this vendor person." }));
  const repeated = new Set(rolls.filter((roll, at, all) => all.findIndex(other => other.roll_call_id === roll.roll_call_id) !== at).map(roll => roll.roll_call_id));
  for (const roll of rolls) {
    const key = `legiscan:roll_call:${roll.roll_call_id}`;
    try {
      const bill = bills.get(Number(roll.bill_id)), meta = (Array.isArray(bill?.votes) ? bill.votes : []).map(object).find(meta => meta.roll_call_id === roll.roll_call_id);
      if (!positiveId(roll.roll_call_id) || repeated.has(roll.roll_call_id) || !bill || !meta || !text(bill.bill_number) || !text(bill.title) ||
        !validDay(roll.date) || roll.date > input.evidence.retrievedAt.slice(0, 10) || !text(roll.desc) || !["H", "S"].includes(text(roll.chamber)) ||
        !positiveId(roll.chamber_id) || ![0, 1].includes(Number(roll.passed)) || !Array.isArray(roll.votes)) throw new Error("native roll identity, bill, date or chamber is unresolved");
      const positions: PluralVoteFact["positions"] = [], seen = new Set<number>();
      let unresolvedPositions = 0;
      for (const raw of roll.votes) {
        const row = object(raw);
        if (!positiveId(row.people_id) || seen.has(row.people_id) || !text(row.vote_text)) throw new Error("native member position is malformed or duplicated");
        seen.add(row.people_id);
        const personId = peopleById.get(row.people_id);
        if (!personId) { unresolvedPositions++; continue; }
        positions.push({ personId, option: text(row.vote_text), retrievedAt: input.evidence.retrievedAt });
      }
      if (!positions.length) throw new Error("no exact OpenStates person identity joined this roll");
      const counts = ["yea", "nay", "nv", "absent"].map(option => {
        if (!Number.isSafeInteger(roll[option]) || Number(roll[option]) < 0) throw new Error("publisher tally is invalid");
        return { option, value: Number(roll[option]) };
      });
      if (counts.reduce((sum, row) => sum + row.value, 0) !== roll.total || roll.total !== roll.votes.length) throw new Error("publisher tally does not reconcile to native positions");
      const sourceUrls = [...new Set([meta.url, meta.state_link, bill.url, bill.state_link].flatMap(value => profileUrl(value) ? [profileUrl(value)!] : []))];
      if (!sourceUrls.some(url => url.startsWith(`https://legiscan.com/${state}/rollcall/`))) throw new Error("vendor roll source is unresolved");
      votes.push({ id: key, billId: `legiscan:bill:${bill.bill_id}`, billNumber: text(bill.bill_number), billTitle: text(bill.title),
        session: input.session.sessionName, organizationId: `legiscan:chamber:${state}:${roll.chamber_id}`, chamber: roll.chamber === "S" ? "upper" : "lower",
        date: roll.date, motion: text(roll.desc), result: roll.passed === 1 ? "Passed" : "Failed", counts, positions, unresolvedPositions,
        sourceUrls, sourceApiUrl: input.evidence.finalUrl, retrievedAt: input.evidence.retrievedAt });
    } catch (error) { held.push({ key, detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { votes, held, joins, evidence: { ...input.evidence, members } };
}
