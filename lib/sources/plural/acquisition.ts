/** The source release is acquired once. State consumers parse only their own
 * native records, and keep the archive and member identity in every receipt. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireKnownRelease, KnownReleaseUnavailable, knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { openZipFile, type FileArchiveMember } from "../archive.ts";
import { indexDivisions, normalize, yamlToPeople, type PluralPerson, type RegistryDivisionLite } from "./index.ts";
import { PLURAL_REVISION_URL, PLURAL_SOURCE_ID, PLURAL_STATES } from "./targets.ts";
import { stateContainers, type ReadOnlyQuery, type Slice } from "../../control-plane/admin-view/promoted-slices.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { selectGeographyVersion } from "../../census-geography/selection.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import type { OfficeholderSet } from "../../officials/types.ts";

const DAY = 24 * 60 * 60_000;

async function acquirePeopleRelease(options: KnownReleaseOptions) {
  try { return await acquireKnownRelease(options); }
  catch (error) {
    if (error instanceof KnownReleaseUnavailable) return error.held;
    throw error;
  }
}
const ARCHIVE_LIMITS = { maxEntries: 100_000, maxMemberBytes: 16 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 };
type SharedOptions = Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now">;
export interface StatePeopleRelease {
  readonly state: string;
  readonly releaseId: string;
  readonly people: readonly PluralPerson[];
  readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[];
  readonly gaps: readonly { sourceUrl: string; detail: string }[];
}
async function staged<T>(bytes: Uint8Array, read: (entries: readonly FileArchiveMember[]) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "meanwhile-openstates-"));
  try {
    const path = join(root, "people.zip"); await writeFile(path, bytes);
    return await read(await openZipFile(path, ARCHIVE_LIMITS));
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function memberText(entry: FileArchiveMember): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.stream()) chunks.push(chunk);
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
function revision(bytes: Uint8Array): string {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const sha = Array.isArray(value) ? (value[0] as { sha?: unknown } | undefined)?.sha : undefined;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("PLURAL_REVISION_INVALID");
  return sha;
}
/** No ZIP or Send needed to read an independently held state people source. */
export async function statePeopleDivisions(state: string, asOf: string, query: ReadOnlyQuery | null = readerQuery()): Promise<Slice<RegistryDivisionLite[]>> {
  const slice = await stateContainers(state, ["state_leg_upper", "state_leg_lower"], false, query);
  if (slice.kind !== "HELD") return slice;
  const versions = slice.value.scopes.map(scope => ({ ...scope, key: scope.version }));
  const upper = selectGeographyVersion(versions, "state_leg_upper", { purpose: "representation", asOf }, state);
  const lower = selectGeographyVersion(versions, "state_leg_lower", { purpose: "representation", asOf }, state);
  const divisions = slice.value.containers.flatMap(({ ref }) => {
    if (!(ref.type === "state_leg_upper" && ref.version === upper?.key || ref.type === "state_leg_lower" && ref.version === lower?.key)) return [];
    const ocdId = censusWorkDivision(ref);
    return ocdId ? [{ ocdId, label: ref.label, divisionType: ref.type === "state_leg_upper" ? "sldu" : "sldl" }] : [];
  });
  return { kind: "HELD", versionId: slice.versionId, value: divisions };
}
export async function acquireStatePeople(input: SharedOptions & {
  readonly state: string; readonly signal: AbortSignal; readonly asOf?: string;
  readonly divisions?: readonly RegistryDivisionLite[];
  readonly geographyQuery?: ReadOnlyQuery | null;
}): Promise<StatePeopleRelease> {
  const state = input.state.toLowerCase();
  if (!PLURAL_STATES.includes(state)) throw new Error(`PLURAL_STATE_UNSUPPORTED:${state}`);
  const asOf = input.asOf ?? input.now?.() ?? new Date().toISOString();
  const shared: SharedOptions = { store: input.store, locks: input.locks, fetchImpl: input.fetchImpl, now: input.now };
  const gaps: { sourceUrl: string; detail: string }[] = [];
  let currentMembershipComplete = true;
  let people: PluralPerson[] = [], releaseId = "";
  const acquisitions: StatePeopleAcquisition[] = [];
  {
    const current = await acquirePeopleRelease({ ...shared, sourceId: PLURAL_SOURCE_ID, releaseId: "people-current-revision",
      url: PLURAL_REVISION_URL, parserVersion: "openstates-revision/1", signal: input.signal, maxBytes: 1024 * 1024,
      checkAfterMs: DAY, validate: bytes => { revision(bytes); } });
    const sourceCheck = knownReleaseSourceCheck(current);
    if (current.outage) gaps.push({ sourceUrl: current.requestedUrl, detail: current.outage });
    const sha = revision(current.bytes), url = `https://codeload.github.com/openstates/people/zip/${sha}`;
    const release = await acquirePeopleRelease({ ...shared, sourceId: PLURAL_SOURCE_ID, releaseId: `people:${sha}`, url,
      parserVersion: "openstates-archive/2", signal: input.signal, maxBytes: 96 * 1024 * 1024, checkAfterMs: Number.MAX_SAFE_INTEGER,
      // Central directory, every local header, member size and CRC are checked
      // before this immutable release can become a reuse candidate.
      validate: bytes => staged(bytes, async entries => {
        if (entries.some(entry => !entry.name.startsWith(`people-${sha}/`))) throw new Error("PLURAL_ARCHIVE_REVISION_MISMATCH");
        if (!entries.some(entry => /^people-[^/]+\/data\/[a-z]{2}\/legislature\/[^/]+\.ya?ml$/.test(entry.name))) throw new Error("PLURAL_ARCHIVE_LAYOUT_INVALID");
        for (const entry of entries) { input.signal.throwIfAborted(); for await (const chunk of entry.stream()) void chunk; }
      }),
    });
    if (release.outage) gaps.push({ sourceUrl: release.requestedUrl, detail: release.outage });
    releaseId = sha;
    await staged(release.bytes, async entries => {
      const selected = entries.filter(entry => new RegExp(`^people-[^/]+/data/${state}/(?:legislature|executive|municipal|municipalities)/.+\\.ya?ml$`).test(entry.name))
        .sort((left,right)=>left.name.localeCompare(right.name));
      if (!selected.length) throw new Error(`PLURAL_STATE_DIRECTORY_MISSING:${state}`);
      for (const entry of selected) {
        input.signal.throwIfAborted();
        const member = entry.name.slice(entry.name.indexOf("/") + 1);
        const sourceUrl = `https://raw.githubusercontent.com/openstates/people/${sha}/${member}`;
        let body: string;
        try { body = await memberText(entry); }
        catch (error) {
          input.signal.throwIfAborted();
          currentMembershipComplete = false;
          gaps.push({ sourceUrl, detail: `The known source member could not be decoded: ${error instanceof Error ? error.message : String(error)}. Its original bytes remain in the archive.` });
          continue;
        }
        try { people.push(...yamlToPeople(body, state, sourceUrl, asOf, detail => {
          currentMembershipComplete = false; gaps.push({ sourceUrl, detail });
        },true)); } catch (error) {
          currentMembershipComplete = false;
          gaps.push({ sourceUrl, detail: error instanceof Error ? error.message : String(error) });
        }
        acquisitions.push({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
          body, retrievedAt: release.retrievedAt, rawHash: release.sha256,
          sourceCheck,
          ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}),
          extractedFrom: { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, sha256: release.sha256, member } });
      }
    });
    const byNativeId = new Map<string, PluralPerson>();
    for (const person of people) {
      const prior = byNativeId.get(person.id);
      if (!prior) { byNativeId.set(person.id, person); continue; }
      if (prior.name !== person.name) {
        currentMembershipComplete = false;
        gaps.push({sourceUrl:person.sourceUrl ?? url,detail:`PLURAL_NATIVE_PERSON_NAME_CONFLICT:${person.id}:${prior.name}:${person.name}`});
      }
      const roles = [...new Map([...(prior.roles ?? []),...(person.roles ?? [])].map(role=>[
        JSON.stringify([role.type,role.jurisdiction,role.district,role.title,role.start_date,role.end_date]),role])).values()];
      const offices = [...new Map([...(prior.offices ?? []),...(person.offices ?? [])].map(office=>[
        JSON.stringify([office.name,office.address,office.voice,office.email]),office])).values()];
      const identifiers = Object.fromEntries([...new Set([...Object.keys(prior.identifiers ?? {}),...Object.keys(person.identifiers ?? {})])]
        .map(key=>[key,[...new Set([...(prior.identifiers?.[key] ?? []),...(person.identifiers?.[key] ?? [])])]]));
      const combined = {...person,...prior,roles,offices,identifiers};
      for (const key of ["email","image","capitol_address","capitol_voice","district_address","district_voice","current_party"] as const) combined[key] ||= person[key];
      combined.links = [...new Set([prior.links,person.links].flatMap(value=>value.split(";")).filter(Boolean))].join(";");
      combined.sources = [...new Set([prior.sources,person.sources].flatMap(value=>value.split(";")).filter(Boolean))].join(";");
      byNativeId.set(person.id,combined);
    }
    // Ended native tenures must reach normalization even when another source
    // record is malformed and this refresh cannot claim a complete roster.
    people = [...byNativeId.values()];
    if (!people.some(person=>person.roles?.some(role=>role.current))) throw new Error(`PLURAL_STATE_HAS_NO_CURRENT_PEOPLE:${state}`);
  }
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error("PLURAL_DUPLICATE_NATIVE_PERSON");
  let divisions = input.divisions;
  if (divisions === undefined) {
    const geography = await statePeopleDivisions(state, asOf, input.geographyQuery);
    divisions = geography.kind === "HELD" ? geography.value : [];
    if (geography.kind !== "HELD") gaps.push({
      sourceUrl: "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
      detail: `CENSUS_GEOGRAPHY_${geography.kind}:${state.toUpperCase()}: ${geography.kind === "UNREAD" ? geography.detail : "The Census district file has not been published to the reader store."}`,
    });
  }
  const collectedAt = acquisitions.map(row => row.retrievedAt).sort().at(-1)!;
  const roster = normalize(people, indexDivisions([...divisions]), collectedAt, `US-${state.toUpperCase()}`);
  const currentPeople = people.filter(person=>!person.roles || person.roles.some(role=>role.current));
  return { state, releaseId, people:currentPeople, acquisitions, gaps,
    roster: { ...roster, currentMembershipComplete: currentMembershipComplete && roster.officeholders.length === currentPeople.length } };
}
