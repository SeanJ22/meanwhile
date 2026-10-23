import { createHash } from "node:crypto";
import { PLURAL_STATES } from "../plural/targets.ts";
import type { Officeholder } from "../../officials/types.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import type { SourceCheckEvidence } from "../../civic-data/types.ts";

export const LEGISCAN_VOTES_PARSER = "legiscan-votes/1";
export const LEGISCAN_VOTES_SOURCE = "legiscan";
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
export const nativePersonId = (value: unknown): boolean => typeof value === "string" && /^ocd-person\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function legiscanState(state: string) {
  const normalized = state.replace(/^US-/i, "").toLowerCase();
  if (!PLURAL_STATES.includes(normalized)) throw new Error(`LEGISCAN_STATE_UNSUPPORTED:${normalized}`);
  return normalized.toUpperCase();
}
/** Equivalent path encodings share a profile; path separators and queries remain exact. */
export function profileUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash || !url.pathname.replace(/\/$/, "")) return null;
    if (/^www\..+\.gov$/.test(url.hostname)) url.hostname = url.hostname.slice(4);
    url.pathname = url.pathname.replace(/%[0-9a-f]{2}/gi, encoded => {
      const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
      return /^[A-Za-z0-9._~()-]$/.test(character) ? character : encoded.toUpperCase();
    }).replace(/\/$/, "");
    return url.href;
  } catch { return null; }
}
export interface LegiscanSession {
  state: string; stateId: number; sessionId: number; sessionName: string; datasetHash: string; datasetDate: string;
  yearStart: number; yearEnd: number; special?: boolean; prefile?: boolean;
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
      datasetDate: row.dataset_date, yearStart: row.year_start, yearEnd: row.year_end, special: row.special === 1 || row.special === "1" || /\b(?:special|extra(?:ordinary)?)\b/i.test(text(row.session_name)), prefile: row.prefile === 1 || row.prefile === "1" || /\bprefil(?:e|ing)\b/i.test(text(row.session_name)) };
  });
  if (new Set(rows.map(row => row.stateId)).size > 1 || new Set(rows.map(row => row.sessionId)).size !== rows.length) throw new Error("LEGISCAN_DATASET_LIST_SCOPE_OR_DUPLICATE");
  const regularYears = [...new Set(rows.filter(row => !row.special).map(row => row.yearStart))].sort((a, b) => b - a);
  const fallbackYears = [...new Set(rows.map(row => row.yearStart))].sort((a, b) => b - a);
  const cutoff = regularYears[1] ?? regularYears[0] ?? fallbackYears[1] ?? fallbackYears[0];
  return rows.filter(row => row.yearStart >= cutoff).sort((a, b) => b.yearStart - a.yearStart || b.sessionId - a.sessionId);
}
export interface LegiscanDatasetEvidence {
  requestedUrl: string; finalUrl: string; retrievedAt: string; sha256: string; vaultKey?: string; sourceCheck?: SourceCheckEvidence;
  /** Exact decoded archive members are held only for this state's dataset. */
  members?: readonly { name: string; sha256: string }[];
}
interface LegiscanPersonJoin {
  legiscanPeopleId: number; personId: string; basis: "NATIVE_ID" | "EXACT_MEMBER_PROFILE_URL"; sourceUrl: string; matchedUrl: string | null;
  openStatesProfileUrl: string | null; legiscanProfileUrl: string | null;
  /** The independently promoted native roster version survives later departures. */
  sourceRosterVersionId?: string;
}
export interface LegiscanIdentityAuthority {
  scope: string; versionId: string; sourceId: "plural-openstates"; crosswalkSha256: string; joins: LegiscanPersonJoin[];
}
export type LegiscanIdentityHolder = Pick<Officeholder,"id"|"personId"|"nativeIds"> &
  Partial<Pick<Officeholder,"level"|"websiteUrl"|"profileUrls">> &
  { provenance?: Officeholder["provenance"] | null };
export function sourcePersonIds(holder: Pick<Officeholder,"id"|"personId"|"nativeIds">): string[] {
  return [...new Set([...(holder.nativeIds?.["ocd-person"] ?? []), holder.personId ?? "", holder.id].flatMap(value =>
    nativePersonId(value) ? [value] : /^plural:(?:[a-z]{2}:)?([0-9a-f-]{36})$/.test(value) ? [`ocd-person/${value.split(":").at(-1)}`] : []))];
}
/** Names, party, district and office title never participate in this crosswalk. */
export function legiscanIdentityJoins(holders: readonly LegiscanIdentityHolder[], people: readonly Record<string, unknown>[]) {
  const matches = new Map<number, Map<string, LegiscanPersonJoin>>();
  for (const person of people) {
    if (!positiveId(person.people_id)) continue;
    const bio = object(person.bio), social = object(bio.social), links = object(bio.links), official = object(links.official), personal = object(links.personal);
    const ballotpedia = text(person.ballotpedia);
    const ballotpediaUrl = ballotpedia && !/[\s/?#]/.test(ballotpedia) ? `https://ballotpedia.org/${ballotpedia}` : null;
    const votesmartId = text(person.votesmart_id) || (positiveId(person.votesmart_id) ? String(person.votesmart_id) : "");
    const votesmartUrl = /^[1-9]\d*$/.test(votesmartId) ? `https://justfacts.votesmart.org/candidate/biography/${votesmartId}` : null;
    const urls = new Map([social.biography, official.website, personal.website, social.ballotpedia, social.votesmart,
      social.campaign, social.campaign_website, ballotpediaUrl, votesmartUrl]
      .flatMap(value => profileUrl(value) ? [[profileUrl(value)!, text(value)] as const] : []));
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
