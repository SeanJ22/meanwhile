/** The source release is acquired once. State consumers parse only their own
 * native records, and keep the archive and member identity in every receipt. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import { openZipFile, type FileArchiveMember } from "../archive.ts";
import { bulkUrl, indexDivisions, normalize, pluralRosterIssue, rowsToPeople, yamlToPeople, type PluralPerson, type RegistryDivisionLite } from "./index.ts";
import { PLURAL_PARSER_VERSION, PLURAL_REVISION_URL, PLURAL_SOURCE_ID, PLURAL_STATES } from "./targets.ts";
import { stateContainers, type ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { selectGeographyVersion } from "../../census-geography/selection.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { RepositoryLockHeld } from "../../control-plane/repository/types.ts";

const DAY = 24 * 60 * 60_000;
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
export async function statePeopleDivisions(state: string, asOf: string, query: ReadOnlyQuery | null = readerQuery()): Promise<RegistryDivisionLite[]> {
  const slice = await stateContainers(state, ["state_leg_upper", "state_leg_lower"], false, query);
  if (slice.kind !== "HELD") return [];
  const versions = slice.value.scopes.map(scope => ({ ...scope, key: scope.version }));
  const upper = selectGeographyVersion(versions, "state_leg_upper", { purpose: "representation", asOf });
  const lower = selectGeographyVersion(versions, "state_leg_lower", { purpose: "representation", asOf });
  return slice.value.containers.flatMap(({ ref }) => ref.ocdId &&
    (ref.type === "state_leg_upper" && ref.version === upper?.key || ref.type === "state_leg_lower" && ref.version === lower?.key)
    ? [{ ocdId: ref.ocdId, label: ref.label, divisionType: ref.type === "state_leg_upper" ? "sldu" : "sldl" }] : []);
}
export async function acquireStatePeople(input: SharedOptions & {
  readonly state: string; readonly signal: AbortSignal; readonly asOf?: string;
  readonly divisions?: readonly RegistryDivisionLite[];
  /** Exact previously captured CSV bytes can seed the shared release without a new request. */
  readonly readHeldCsv?: () => Promise<KnownRelease | null>;
}): Promise<StatePeopleRelease> {
  const state = input.state.toLowerCase();
  if (!PLURAL_STATES.includes(state)) throw new Error(`PLURAL_STATE_UNSUPPORTED:${state}`);
  const asOf = input.asOf ?? input.now?.() ?? new Date().toISOString();
  const shared: SharedOptions = { store: input.store, locks: input.locks, fetchImpl: input.fetchImpl, now: input.now };
  const gaps: { sourceUrl: string; detail: string }[] = [];
  let currentMembershipComplete = true;
  let people: PluralPerson[] = [], acquisitions: StatePeopleAcquisition[] = [], releaseId = "";
  try {
    const current = await acquireKnownRelease({ ...shared, sourceId: PLURAL_SOURCE_ID, releaseId: "people-current-revision",
      url: PLURAL_REVISION_URL, parserVersion: "openstates-revision/1", signal: input.signal, maxBytes: 1024 * 1024,
      checkAfterMs: DAY, validate: bytes => { revision(bytes); } });
    const sourceCheck = knownReleaseSourceCheck(current);
    const sha = revision(current.bytes), url = `https://codeload.github.com/openstates/people/zip/${sha}`;
    const release = await acquireKnownRelease({ ...shared, sourceId: PLURAL_SOURCE_ID, releaseId: `people:${sha}`, url,
      parserVersion: "openstates-archive/2", signal: input.signal, maxBytes: 96 * 1024 * 1024, checkAfterMs: Number.MAX_SAFE_INTEGER,
      // Central directory, every local header, member size and CRC are checked
      // before this immutable release can become a reuse candidate.
      validate: bytes => staged(bytes, async entries => {
        if (entries.some(entry => !entry.name.startsWith(`people-${sha}/`))) throw new Error("PLURAL_ARCHIVE_REVISION_MISMATCH");
        if (!entries.some(entry => /^people-[^/]+\/data\/[a-z]{2}\/legislature\/[^/]+\.ya?ml$/.test(entry.name))) throw new Error("PLURAL_ARCHIVE_LAYOUT_INVALID");
        for (const entry of entries) { input.signal.throwIfAborted(); for await (const chunk of entry.stream()) void chunk; }
      }),
    });
    releaseId = sha;
    await staged(release.bytes, async entries => {
      const selected = entries.filter(entry => new RegExp(`^people-[^/]+/data/${state}/(?:legislature|executive|municipal|municipalities)/.+\\.ya?ml$`).test(entry.name));
      if (!selected.length) throw new Error(`PLURAL_STATE_DIRECTORY_MISSING:${state}`);
      for (const entry of selected) {
        input.signal.throwIfAborted();
        const member = entry.name.slice(entry.name.indexOf("/") + 1);
        const sourceUrl = `https://raw.githubusercontent.com/openstates/people/${sha}/${member}`;
        const legislative = member.includes("/legislature/");
        let body: string;
        try { body = await memberText(entry); }
        catch (error) {
          input.signal.throwIfAborted();
          if (legislative) currentMembershipComplete = false;
          gaps.push({ sourceUrl, detail: `The known source member could not be decoded: ${error instanceof Error ? error.message : String(error)}. Its original bytes remain in the archive.` });
          continue;
        }
        if (legislative) {
          try { people.push(...yamlToPeople(body, state, sourceUrl, asOf, detail => {
            currentMembershipComplete = false; gaps.push({ sourceUrl, detail });
          })); } catch (error) {
            currentMembershipComplete = false;
            gaps.push({ sourceUrl, detail: error instanceof Error ? error.message : String(error) });
          }
        }
        else gaps.push({ sourceUrl,
          detail: "Known executive/municipal native record captured. Publication needs an exact existing office binding; it is not legislative coverage." });
        acquisitions.push({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
          body, retrievedAt: release.retrievedAt, rawHash: release.sha256,
          sourceCheck,
          ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}),
          extractedFrom: { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, sha256: release.sha256, member } });
      }
    });
    const counts = new Map<string, number>();
    for (const person of people) counts.set(person.id, (counts.get(person.id) ?? 0) + 1);
    people = people.filter(person => {
      if (counts.get(person.id) === 1) return true;
      currentMembershipComplete = false;
      gaps.push({ sourceUrl: person.sourceUrl ?? url, detail: `PLURAL_DUPLICATE_NATIVE_PERSON:${person.id}` });
      return false;
    });
    if (!people.length) throw new Error(`PLURAL_STATE_HAS_NO_CURRENT_PEOPLE:${state}`);
  } catch (error) {
    input.signal.throwIfAborted();
    if (error instanceof RepositoryLockHeld) throw error;
    gaps.push({ sourceUrl: PLURAL_REVISION_URL, detail: error instanceof Error ? error.message : String(error) });
    // The known reduced export remains a separately parsed fallback. Its
    // missing fields never masquerade as fields from the richer YAML source.
    const release = await acquireKnownRelease({ ...shared, sourceId: PLURAL_SOURCE_ID, releaseId: `people-current-csv:${state}`,
      url: bulkUrl(state), parserVersion: PLURAL_PARSER_VERSION, signal: input.signal, maxBytes: 8 * 1024 * 1024,
      checkAfterMs: DAY, readHeld: input.readHeldCsv,
      validate: bytes => { const issue = pluralRosterIssue(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); if (issue) throw new Error(issue); } });
    const body = new TextDecoder("utf-8", { fatal: true }).decode(release.bytes);
    people = rowsToPeople(body, state); releaseId = `csv:${release.sha256}`;
    currentMembershipComplete = true;
    acquisitions = [{ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus, body,
      retrievedAt: release.retrievedAt, rawHash: release.sha256, sourceCheck: knownReleaseSourceCheck(release),
      ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}) }];
  }
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error("PLURAL_DUPLICATE_NATIVE_PERSON");
  const divisions = input.divisions ?? await statePeopleDivisions(state, asOf);
  const collectedAt = acquisitions.map(row => row.retrievedAt).sort().at(-1)!;
  const roster = normalize(people, indexDivisions([...divisions]), collectedAt, `US-${state.toUpperCase()}`);
  return { state, releaseId, people, acquisitions, gaps,
    roster: { ...roster, currentMembershipComplete: currentMembershipComplete && roster.officeholders.length === people.length } };
}
