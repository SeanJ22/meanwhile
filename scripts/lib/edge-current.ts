import {
  AUTHORITY_FAMILIES,
  READER_ARTIFACT_FORMAT_VERSION,
  sha256OfJson,
  type ReaderManifest,
} from "../../lib/meetings/edge-artifacts.ts";
import type {
  PublishAuthority,
  PublishReaderExtras,
  PublishRegistrations,
} from "../../lib/meetings/edge-serving.ts";
import type { PrepareMeetingSnapshotResult } from "../../lib/meetings/prepared-snapshot.ts";
import { sameMeetingFreshChecks } from "../../lib/meetings/fresh-checks.ts";

export type ReaderEdgeCarry =
  | { readonly current: true; readonly sequence: number }
  /**
   * Everything the edge serves is carried except the quiet re-checks: the same
   * composition, re-checked since. Only the manifest is republished
   * (`publishReaderEdgeChecks`), and the prepared row is not read.
   */
  | { readonly current: false; readonly checksOnly: true; readonly reason: string }
  | { readonly current: false; readonly checksOnly?: false; readonly reason: string };

/** The embedded families exactly as `publishReaderEdgeArtifacts` fingerprints them. */
function extrasFingerprint(extras: { readonly commentAccess?: unknown; readonly everydayRouting?: unknown }): string {
  return sha256OfJson({
    commentAccess: extras.commentAccess ?? null,
    everydayRouting: extras.everydayRouting ?? null,
  });
}

/**
 * **Whether the served Reader edge already is what this pass would publish,
 * decided without reading the prepared meeting row (R28, 2026-09-25).**
 *
 * The meeting-aggregate repair child read the whole prepared row (about 7.5 MB)
 * every pass only to hand it to `publishReaderEdgeArtifacts`, which then found
 * the manifest unchanged and returned CURRENT. That publish compares four
 * things (lib/meetings/edge-serving.ts): each scope's meeting data, the
 * embedded comment-access and everyday-routing families, every authority
 * family's version, and every state's registration version. Each is known here
 * without the row:
 *
 *  - Meeting data. The prepared snapshot is CURRENT: the row was composed from
 *    exactly the partition versions now promoted, and this pass did not rewrite
 *    it. Its `generatedAt` comes from that same coupling read (the payload's own
 *    `generatedAt`, the newest partition's generation instant). A manifest with
 *    that `generatedAt` was partitioned from that composition, and partitioning
 *    is a pure function of the payload, so every scope's data is unchanged.
 *  - Extras. The families this pass read equal the manifest's embedded copies.
 *  - Authority. Every family is carried: its pointer still names the version
 *    the manifest serves. A family left out this pass that the manifest does
 *    not serve either stays out, which the publish would not change.
 *  - Registrations. Every state is carried at the version the manifest serves,
 *    and the manifest serves no other state.
 *
 * Any other case reads the row and publishes as before; nothing here decides a
 * publish, only that one would change nothing.
 *
 * **Quiet re-checks (2026-09-25, lib/meetings/fresh-checks.ts).** Since
 * migration 0029 a re-check that finds nothing new confirms the version instead
 * of promoting a copy, so "Last checked" and the route checks can move while the
 * composition stands. The composition is named by `composition` (the exact
 * partition versions); a manifest written before it existed is linked, as it
 * always was, by the composition's own generation instant. When only the checks
 * differ, the answer is `checksOnly`: republish the manifest alone.
 */
export function readerEdgeCarriesForward(input: {
  readonly prepared: PrepareMeetingSnapshotResult;
  readonly servedManifest: ReaderManifest | null;
  readonly extras: PublishReaderExtras | undefined;
  readonly authority: PublishAuthority;
  readonly registrations: PublishRegistrations | undefined;
}): ReaderEdgeCarry {
  const { prepared, servedManifest: manifest, extras, authority, registrations } = input;
  if (prepared.status !== "CURRENT") return { current: false, reason: `prepared snapshot ${prepared.status}` };
  if (prepared.generatedAt === null) return { current: false, reason: "prepared snapshot has no generation instant" };
  if (manifest === null) return { current: false, reason: "no served manifest" };
  if (manifest.formatVersion !== READER_ARTIFACT_FORMAT_VERSION) {
    return { current: false, reason: `served manifest format ${String(manifest.formatVersion)}` };
  }
  const sameComposition = manifest.composition !== undefined
    ? manifest.composition === prepared.composition
    : manifest.generatedAt === prepared.generatedAt;
  if (!sameComposition) {
    return { current: false, reason: `served manifest generated ${manifest.generatedAt} from another composition than the prepared ${prepared.generatedAt}` };
  }
  if (extras === undefined) return { current: false, reason: "embedded families were not read" };
  if (extrasFingerprint(extras) !== extrasFingerprint(manifest)) {
    return { current: false, reason: "embedded families changed" };
  }
  for (const family of AUTHORITY_FAMILIES) {
    const entry = authority[family];
    // Left out this pass and not served either (2026-09-25): the publish leaves it out
    // too, so it changes nothing. With thirteen proven-pointer families, one that
    // cannot be read must not cost every pass the whole prepared row.
    if (entry === undefined && manifest.authorityArtifacts?.[family] === undefined) continue;
    if (entry === undefined || !("carried" in entry)) return { current: false, reason: `${family} not carried` };
    if (manifest.authorityArtifacts?.[family]?.version !== entry.versionId) {
      return { current: false, reason: `${family} is not the served version` };
    }
  }
  if (registrations === undefined) return { current: false, reason: "registrations were not read" };
  const served = manifest.registrations;
  if (served === undefined) return { current: false, reason: "the manifest serves no registrations" };
  const states = Object.keys(registrations).sort();
  const servedStates = Object.keys(served).sort();
  if (states.length !== servedStates.length || states.some((state, index) => state !== servedStates[index])) {
    return { current: false, reason: "registration states changed" };
  }
  for (const state of states) {
    const entry = registrations[state]!;
    if (!("carried" in entry) || served[state]?.version !== entry.versionId) {
      return { current: false, reason: `registration ${state} moved` };
    }
  }
  const statesChecks = manifest.generatedAt === (prepared.servedGeneratedAt ?? prepared.generatedAt) &&
    manifest.composition === prepared.composition &&
    sameMeetingFreshChecks(manifest.freshChecks, prepared.freshChecks);
  return statesChecks
    ? { current: true, sequence: manifest.sequence }
    : { current: false, checksOnly: true, reason: `re-checked since: last checked ${prepared.servedGeneratedAt ?? prepared.generatedAt}, served ${manifest.generatedAt}` };
}
