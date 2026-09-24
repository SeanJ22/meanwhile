/**
 * **THE DERIVED WIRING ROW WRITER: WHAT DISCOVERY FOUND, DECIDED ROW BY ROW.**
 * (NH330 Stage 2, piece 2. 2026-09-24.)
 *
 * The meetings-discovery walk confirms that a government's own site publishes
 * its meetings. Stage 2 lets such a route start publishing without a code
 * change: the wiring store (CURATED_READER_RECORD, US:meeting-source-wiring)
 * is a DERIVED routine authority, and every version is computed only from
 * inputs that are already promoted or vaulted
 * (`lib/civic-data/derived-authority.ts`). This module decides each row of the
 * next version. It is pure, and every lookup it needs is handed to it.
 *
 * For each route the latest walk of a government confirmed, the row is:
 *
 * - **PROMOTE** only when every one of these holds: the route maps to a wiring
 *   kind the reader can run; its host is attested by the walk's recorded chain
 *   (the recorded address or a committed hint, each redirect, each linking
 *   page, each with its vaulted artifact); the government's registration pairs
 *   it with a registered body; no hand-wired route already serves that body; a
 *   reviewed crosswalk row supplies the body's own filter; and the reader
 *   adapter itself produces at least one sitting for that body from the
 *   vaulted bytes.
 * - **HOLD**, by name, at the first check that fails. A held row that was
 *   promoted before is carried, never dropped.
 * - **REMOVE** only when the publisher withdrew the route: its own 404 or 410,
 *   vaulted. A walk that did not reach the route (absent, a transport failure,
 *   a robots refusal, a challenge) holds it instead.
 *
 * Nothing here is inferred. A search result on its own is not attested, a body
 * filter is never derived from a name, and a lead is never a row.
 */

import type {
  AdapterBinding,
  AdapterVerification,
  DerivedHeldReason,
  DerivedInputRef,
  DerivedRowDecision,
  HostAttestation,
} from "../../civic-data/derived-authority.ts";
import type { DiscoveryFind, MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";

/** The wiring kinds a discovery find can become, with the route name `meetingSourceNamesForWiring` gives each. */
export const DERIVED_WIRING_KINDS = {
  ICAL: "ical",
  CIVICCLERK: "civicclerk",
  OFFICIAL_PAGE_EVENTS: "official-page-events",
  IQM2: "iqm2",
  BOARDBOOK: "boardbook",
  LEGISTAR: "legistar",
} as const;
export type DerivedWiringKind = keyof typeof DERIVED_WIRING_KINDS;

/** One row of the wiring store: the fields of `BodySourceWiring` a derived route can carry. */
export interface DerivedWiringRow {
  readonly bodyId: string;
  readonly ocdId: string;
  readonly agendaSourceType: DerivedWiringKind;
  /** Display only, as `BodySourceWiring.jurisdiction`. */
  readonly jurisdiction: string;
  readonly publishingOrg: string;
  readonly timeZone: string;
  readonly config: Readonly<Record<string, string>>;
  readonly verifiedAt: string;
  /** The discovery route this row wires, as the walk confirmed it. */
  readonly discoveredUrl: string;
}

/** A route's wiring kind and the endpoint configuration the find itself supplies. */
export type WiringShape =
  | { readonly kind: DerivedWiringKind; readonly endpoint: Readonly<Record<string, string>> }
  | { readonly held: "ADAPTER_CONFIG_INCOMPLETE"; readonly detail: string };

/**
 * The wiring kind for a confirmed route, from the vendor the walk confirmed and the URL itself. A vendor whose
 * reader wiring needs something the find cannot supply is held by name.
 */
export function wiringShapeFor(find: Pick<DiscoveryFind, "vendor" | "url">): WiringShape {
  let url: URL;
  try {
    url = new URL(find.url);
  } catch {
    return { held: "ADAPTER_CONFIG_INCOMPLETE", detail: `the route ${find.url} is not a URL` };
  }
  switch (find.vendor) {
    case "ical":
      return { kind: "ICAL", endpoint: { feedUrl: url.toString() } };
    case "civicclerk-api":
      return { kind: "CIVICCLERK", endpoint: { apiBase: url.origin } };
    case "official-page-events":
      return { kind: "OFFICIAL_PAGE_EVENTS", endpoint: { pageUrl: url.toString(), officialHost: url.host } };
    case "iqm2":
      return { kind: "IQM2", endpoint: { base: url.origin } };
    case "boardbook": {
      const org = /\/Public\/Organization\/(\d+)/i.exec(url.pathname)?.[1];
      return org === undefined
        ? { held: "ADAPTER_CONFIG_INCOMPLETE", detail: "a BoardBook route that names no organization id" }
        : { kind: "BOARDBOOK", endpoint: { orgId: org } };
    }
    case "legistar-api": {
      const slug = /^\/v1\/([^/]+)\/events/i.exec(url.pathname)?.[1];
      return slug === undefined
        ? { held: "ADAPTER_CONFIG_INCOMPLETE", detail: "a Legistar API route that names no client" }
        : { kind: "LEGISTAR", endpoint: { slug, sourceRoutes: "legistar" } };
    }
    case "civicplus-agendacenter":
      return {
        held: "ADAPTER_CONFIG_INCOMPLETE",
        detail: "CIVICPLUS wiring reads the site's iCal feed (icalUrl); an AgendaCenter page alone cannot be wired",
      };
    default:
      return { held: "ADAPTER_CONFIG_INCOMPLETE", detail: `no reader wiring kind takes a ${find.vendor} route` };
  }
}

type Attested = { readonly attestation: HostAttestation } | { readonly held: DerivedHeldReason; readonly detail: string };

/**
 * The host attestation for a confirmed route, from the chain the walk recorded (`attempt.site`, each find's
 * `via`). A page on the chain must have its vaulted artifact, or the chain cannot be recomputed.
 */
export function attestationFor(attempt: MeetingsDiscoveryAttempt, find: DiscoveryFind): Attested {
  const site = attempt.site;
  if (site === undefined) {
    return { held: "HOST_NOT_ATTESTED", detail: "the walk predates recorded provenance; the government is walked again" };
  }
  if (find.basis === "HINT") {
    const fingerprint = attempt.routeHints?.fingerprint;
    return fingerprint === undefined
      ? { held: "HOST_NOT_ATTESTED", detail: "a hinted route whose walk recorded no hint fingerprint" }
      : { attestation: { kind: "ROUTE_HINT", hintFingerprint: fingerprint } };
  }
  const home = site.homepage;
  if (home === null) return { held: "HOST_NOT_ATTESTED", detail: "no homepage was read as the government's own" };
  let homeAttestation: HostAttestation;
  if (home.basis === "ROUTE_HINT") {
    if (home.hintFingerprint === null) return { held: "HOST_NOT_ATTESTED", detail: "a hinted homepage with no hint fingerprint" };
    homeAttestation = { kind: "ROUTE_HINT", hintFingerprint: home.hintFingerprint };
  } else {
    if (site.address === null || site.address.versionId === null) {
      return { held: "HOST_NOT_ATTESTED", detail: "the recorded address's source version was not recorded" };
    }
    homeAttestation = { kind: "RECORDED_ADDRESS", source: site.address.source, versionId: site.address.versionId };
  }
  for (const hop of home.redirects) homeAttestation = { kind: "REDIRECT_FROM_ATTESTED", fromUrl: hop.from, from: homeAttestation };
  if (home.artifactId === null) return { held: "EVIDENCE_NOT_VAULTED", detail: "the homepage's body was not vaulted" };

  /* Walk the `via` chain back to the homepage: each linking page is itself a route the walk recorded. */
  const recorded = [...attempt.found, ...attempt.leads];
  const chain: { page: string; artifactId: string | null }[] = [];
  let via = find.via ?? null;
  const seen = new Set<string>();
  while (via !== null && via.page !== home.url) {
    if (seen.has(via.page)) return { held: "HOST_NOT_ATTESTED", detail: `the linking chain loops at ${via.page}` };
    seen.add(via.page);
    chain.unshift(via);
    const parent = recorded.find((r) => r.url === via!.page);
    if (parent === undefined) return { held: "HOST_NOT_ATTESTED", detail: `the page that linked it (${via.page}) is not a route the walk recorded` };
    if (parent.basis === "HINT") {
      const fingerprint = attempt.routeHints?.fingerprint;
      if (fingerprint === undefined) return { held: "HOST_NOT_ATTESTED", detail: "a hinted linking page with no hint fingerprint" };
      return link({ kind: "ROUTE_HINT", hintFingerprint: fingerprint }, chain);
    }
    via = parent.via ?? null;
  }
  if (via === null) {
    return { held: "HOST_NOT_ATTESTED", detail: find.basis === "SEARCH" ? "a search result is attested only when an attested page links it" : "no attested page links it" };
  }
  return link({ kind: "LINKED_FROM_ATTESTED_PAGE", pageArtifactId: home.artifactId, page: homeAttestation }, chain);

  function link(start: HostAttestation, pages: readonly { page: string; artifactId: string | null }[]): Attested {
    let attestation = start;
    for (const p of pages) {
      if (p.artifactId === null) return { held: "EVIDENCE_NOT_VAULTED", detail: `the linking page ${p.page} was not vaulted` };
      attestation = { kind: "LINKED_FROM_ATTESTED_PAGE", pageArtifactId: p.artifactId, page: attestation };
    }
    return { attestation };
  }
}

/** A reviewed crosswalk row's reader configuration for one body and one wiring kind (pending the owner's authorization). */
export interface ReviewedBodyFilter {
  readonly publishingOrg: string;
  readonly timeZone: string;
  /** The body's filter and anything else its kind needs: titleMatch or categoryMatch, nameTerms, boardMatch, slug. */
  readonly config: Readonly<Record<string, string>>;
  readonly input: DerivedInputRef;
}

export interface DerivedWiringInputs {
  /** The latest walk of each government, with its log record id and time. */
  readonly attempts: readonly { readonly attempt: MeetingsDiscoveryAttempt; readonly recordId: string; readonly recordedAt: string }[];
  /** Registration's explicit jurisdiction→body pair, or null when it has none (NH330 piece 3). */
  readonly identity: (jurisdictionId: string) => { readonly bodyId: string; readonly ocdId: string; readonly input: DerivedInputRef } | null;
  readonly registered: (bodyId: string) => boolean;
  /** A hand-wired SOURCE_WIRING route already serves the body: shadow-compared, never a second writer. */
  readonly handWired: (bodyId: string) => boolean;
  /** The reviewed crosswalk row for the body and kind, or null while none is reviewed. */
  readonly reviewed: (bodyId: string, kind: DerivedWiringKind) => ReviewedBodyFilter | null;
  /** The vault's record of an artifact, or null when it is not held. */
  readonly vaulted: (artifactId: string) => (DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" }) | null;
  /** The reader adapter's own verification of the row against the vaulted bytes. */
  readonly verify: (row: DerivedWiringRow, binding: AdapterBinding, evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" }) => AdapterVerification | { readonly refused: string };
  readonly adapterDigest: (kind: DerivedWiringKind) => string;
  /** The previous version's rows. */
  readonly previous: readonly { readonly key: string; readonly row: DerivedWiringRow }[];
}

/** The store key of a row: one route of one body, as a meeting partition names it. */
export function derivedWiringKey(kind: DerivedWiringKind, bodyId: string): string {
  return `${DERIVED_WIRING_KINDS[kind]}:${bodyId}`;
}

const heldBy = (key: string, reason: DerivedHeldReason, detail: string, inputs: readonly DerivedInputRef[]): DerivedRowDecision<DerivedWiringRow> =>
  ({ disposition: "HOLD", key, reason, detail, inputs });

/**
 * Decide every row of the next version. Each confirmed route of each government's latest walk gets one decision;
 * each previously promoted row the latest walks say nothing new about is held by what its government's latest walk
 * shows, or removed on its publisher's own withdrawal.
 */
export function deriveWiringDecisions(inputs: DerivedWiringInputs): readonly DerivedRowDecision<DerivedWiringRow>[] {
  const decisions = new Map<string, DerivedRowDecision<DerivedWiringRow>>();
  const decide = (d: DerivedRowDecision<DerivedWiringRow>): void => {
    if (!decisions.has(d.key)) decisions.set(d.key, d);
  };

  for (const { attempt, recordId, recordedAt } of inputs.attempts) {
    const attemptInput: DerivedInputRef = { kind: "DISCOVERY_ATTEMPT", attemptId: attempt.attemptId, recordId, recordedAt };
    const identity = inputs.identity(attempt.jurisdictionId);
    for (const find of attempt.found) {
      const shape = wiringShapeFor(find);
      const provisionalKey = `unidentified:${attempt.jurisdictionId}:${find.url}`;
      if ("held" in shape) {
        decide(heldBy(identity === null ? provisionalKey : `unwired:${identity.bodyId}:${find.url}`, shape.held, shape.detail, [attemptInput]));
        continue;
      }
      if (identity === null) {
        decide(heldBy(provisionalKey, "NO_REVIEWED_BODY_IDENTITY", `registration pairs ${attempt.jurisdictionId} with no body yet`, [attemptInput]));
        continue;
      }
      const key = derivedWiringKey(shape.kind, identity.bodyId);
      const base = [attemptInput, identity.input];
      if (!inputs.registered(identity.bodyId)) {
        decide(heldBy(key, "BODY_NOT_REGISTERED", `${identity.bodyId} is not in the promoted registry`, base));
        continue;
      }
      const attested = attestationFor(attempt, find);
      if ("held" in attested) {
        decide(heldBy(key, attested.held, attested.detail, base));
        continue;
      }
      if (inputs.handWired(identity.bodyId)) {
        decide(heldBy(key, "ALREADY_WIRED", `a hand-wired route serves ${identity.bodyId}; the two are shadow-compared, never two writers`, base));
        continue;
      }
      const reviewed = inputs.reviewed(identity.bodyId, shape.kind);
      if (reviewed === null) {
        decide(heldBy(key, "BODY_FILTER_NOT_ESTABLISHED", `no reviewed crosswalk row gives ${identity.bodyId}'s own filter for ${shape.kind}`, base));
        continue;
      }
      const evidence = find.artifactId === null ? null : inputs.vaulted(find.artifactId);
      if (evidence === null) {
        decide(heldBy(key, "EVIDENCE_NOT_VAULTED", `the confirming body of ${find.url} is not held in the vault`, [...base, reviewed.input]));
        continue;
      }
      const row: DerivedWiringRow = {
        bodyId: identity.bodyId,
        ocdId: identity.ocdId,
        agendaSourceType: shape.kind,
        jurisdiction: attempt.jurisdictionId,
        publishingOrg: reviewed.publishingOrg,
        timeZone: reviewed.timeZone,
        config: { ...shape.endpoint, ...reviewed.config },
        verifiedAt: evidence.retrievedAt,
        discoveredUrl: find.url,
      };
      const binding: AdapterBinding = { adapter: DERIVED_WIRING_KINDS[shape.kind], closureDigest: inputs.adapterDigest(shape.kind), config: row.config };
      const verification = inputs.verify(row, binding, evidence);
      if ("refused" in verification) {
        decide(heldBy(key, "ADAPTER_REFUSED", verification.refused, [...base, reviewed.input, evidence]));
        continue;
      }
      decide({ disposition: "PROMOTE", key, row, attestation: attested.attestation, binding, verification, inputs: [...base, reviewed.input, evidence] });
    }
  }

  /* A promoted row its government's latest walk did not confirm again: withdrawn by the publisher, or held by why. */
  for (const { key, row } of inputs.previous) {
    if (decisions.has(key)) continue;
    const latest = inputs.attempts.find((a) => a.attempt.jurisdictionId === row.jurisdiction);
    if (latest === undefined) continue;
    const step = [...latest.attempt.steps].reverse().find((s) => s.url === row.discoveredUrl);
    const attemptInput: DerivedInputRef = { kind: "DISCOVERY_ATTEMPT", attemptId: latest.attempt.attemptId, recordId: latest.recordId, recordedAt: latest.recordedAt };
    if (step === undefined) {
      decide(heldBy(key, "WALK_ABSENT", `the latest walk of ${row.jurisdiction} did not reach ${row.discoveredUrl}`, [attemptInput]));
      continue;
    }
    if ((step.status === 404 || step.status === 410) && step.artifactId !== null) {
      const evidence = inputs.vaulted(step.artifactId);
      if (evidence !== null) {
        decide({ disposition: "REMOVE", key, removal: { kind: "ROUTE_WITHDRAWN_BY_PUBLISHER", how: "ROUTE_GONE", httpStatus: step.status, evidence } });
        continue;
      }
    }
    const reason: DerivedHeldReason =
      step.permission === "DISALLOWED" || step.permission === "RECORDED_WALL" ? "ROBOTS_REFUSED"
        : step.status === 401 || step.status === 403 || step.status === 429 ? "CHALLENGED"
          : step.status === null ? (step.transportError !== null ? "TRANSPORT_FAILED" : "WALK_ABSENT")
            /* It answered, but the walk's content check no longer confirms it: held until it does, or it is withdrawn. */
            : step.status >= 200 && step.status < 300 ? "VERIFICATION_STALE"
              : "WALK_ABSENT";
    decide(heldBy(key, reason, `the latest walk read ${row.discoveredUrl} as ${step.status ?? step.transportError ?? step.permission}: ${step.note}`, [attemptInput]));
  }
  return [...decisions.values()];
}
