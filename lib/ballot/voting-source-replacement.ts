import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import { sourceTextWithoutNuls } from "../doors/source-text.ts";
import type { VotingRawCapture } from "./voting-sites-data-plane.ts";
import type { VotingSitesFile } from "./voting-sites.ts";
import { readVotingSource } from "./voting-source-readers.ts";
import { combineVotingSourceReads, mergeVotingSourceRead } from "./voting-source-publication.ts";
import { registerVotingSourceReplacementVerifier, votingSourceReplacement } from "./voting-source-replacement-contract.ts";

/** Reconstruct the entire replacement from immutable evidence, with no network fallback. */
export async function verifyVotingSourceReplacement(candidate: RoutineCandidate, predecessor: RoutineCandidate | null): Promise<string | null> {
  const proof = votingSourceReplacement(candidate.normalizedPayload);
  if (!proof) return "Voting-source replacement has no exact source-group proof.";
  if (candidate.recordClass !== "VOTING_SITE" || candidate.sourceId !== "voting-sites" || !predecessor ||
      proof.doors.some(door => stateBallotScope("voting-sites", door.scope.state) !== candidate.scope ||
        !isOfficialSource(door.url, door.officialLinkingPage))) return "Voting-source replacement has no matching held partition and official source authority.";
  const prior = predecessor.readModel as VotingSitesFile;
  const next = candidate.readModel as VotingSitesFile;
  const previous = prior.jurisdictions?.find(row => row.ocdId === proof.jurisdictionId);
  const current = next.jurisdictions?.find(row => row.ocdId === proof.jurisdictionId);
  if (!previous || !current || current.electionDate !== proof.electionDate || previous.electionDate !== proof.electionDate) {
    return "Voting-source replacement may retire sites only within its held jurisdiction and election.";
  }
  const acquisition = (candidate.normalizedPayload as { acquisition?: VotingRawCapture[] }).acquisition;
  if (!Array.isArray(acquisition) || !acquisition.length) return "Voting-source replacement has no saved source captures.";
  const captures = new Map<string, { bytes: Uint8Array; type: string; hash: string }>();
  const redirects = new Map<string, string>();
  try {
    for (const capture of acquisition) {
      if (!capture.savedDocument || capture.savedDocument.encoding !== "gzip-base64") return `Replacement source bytes are unavailable: ${capture.url}.`;
      const bytes = gunzipSync(Buffer.from(capture.savedDocument.body, "base64"));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== capture.rawHash || bytes.length !== capture.byteLength) return `Replacement source bytes do not match their saved digest: ${capture.url}.`;
      const url = new URL(capture.url).href;
      const held = captures.get(url);
      if (held && held.hash !== hash) return `Replacement has ambiguous source snapshots for ${url}.`;
      captures.set(url, { bytes, type: capture.contentType, hash });
      // A redirected request is replayed as the same redirect to the final page it reached.
      if (capture.requestedUrl && new URL(capture.requestedUrl).href !== url) {
        const requested = new URL(capture.requestedUrl).href;
        if (redirects.has(requested) && redirects.get(requested) !== url) return `Replacement has ambiguous source snapshots for ${requested}.`;
        redirects.set(requested, url);
      }
    }
    const unavailable = new Set<string>();
    const fetchSaved: typeof fetch = async input => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).href;
      const location = redirects.get(url);
      if (location && !captures.has(url)) return new Response(null, { status: 301, headers: { location } });
      const capture = captures.get(url);
      if (!capture) { unavailable.add(url); throw new Error(`No saved replacement response for ${url}`); }
      return new Response(new Uint8Array(capture.bytes).buffer, { headers: { "content-type": capture.type } });
    };
    const runtime = { fetch: fetchSaved, now: () => candidate.retrieval.retrievedAt,
      captureCache: new Map(),
      resolveCountyFips: (name: string, state: string) => {
        const door = proof.doors.find(door => door.scope.state === state &&
          door.scope.name.replace(/\s+county$/i, "").toLowerCase() === name.replace(/\s+county$/i, "").toLowerCase());
        return door?.scope.countyFips ?? null;
      } };
    const reads = [];
    for (const door of proof.doors) {
      const read = sourceTextWithoutNuls(await readVotingSource(door, runtime));
      if (!read.sites.length || !read.rawBodies.length || read.blanks.some(blank => ["access", "extraction", "missing-sites"].includes(blank.reason))) {
        return `Saved official replacement is not a complete site read: ${door.id}.`;
      }
      reads.push(read);
    }
    // Failed robots observations can be absent, but no uncaptured document may supply a site.
    if ([...unavailable].some(url => url !== new URL("/robots.txt", url).href)) return "Replacement attempted a document outside its saved source captures.";
    const primary = { ...proof.doors[0]!, supersedes: [...new Set(proof.doors.flatMap(door => door.supersedes ?? []))] };
    const reconstructed = mergeVotingSourceRead(previous, primary, combineVotingSourceReads(reads), candidate.retrieval.retrievedAt);
    // Each mapping's original read clock can be milliseconds after the group's
    // acquisition clock. Observation metadata is not a native location fact.
    const withoutObservationClock = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutObservationClock) :
      value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "checkedAt")
        .map(([key, child]) => [key, withoutObservationClock(child)])) : value;
    const ordered = (sites: typeof current.sites) => withoutObservationClock([...sites].sort((left, right) => left.id.localeCompare(right.id)));
    if (canonicalCivicDataHash(ordered(reconstructed.sites), { durable: true }) !== canonicalCivicDataHash(ordered(current.sites), { durable: true })) {
      return "The proposed voting sites differ from the complete saved-source replacement and independently held sites.";
    }
    return null;
  } catch (error) {
    return `Saved voting-source replacement could not be replayed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

registerVotingSourceReplacementVerifier(verifyVotingSourceReplacement);
