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

export type ReaderEdgeCarry =
  | { readonly current: true; readonly sequence: number }
  | { readonly current: false; readonly reason: string };

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
  if (manifest.generatedAt !== prepared.generatedAt) {
    return { current: false, reason: `served manifest generated ${manifest.generatedAt}, prepared ${prepared.generatedAt}` };
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
  return { current: true, sequence: manifest.sequence };
}
