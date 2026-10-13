

import type {
  AdapterBinding,
  AdapterVerification,
  DerivedHeldReason,
  DerivedInputRef,
  DerivedReviewTrigger,
  DerivedRowDecision,
  DerivedVersionEntry,
  HostAttestation,
} from "../../civic-data/derived-authority.ts";
import {
  DERIVED_WIRING_SOURCE_NAMES,
  derivedAdapterConfig,
  derivedWiringKey,
  type DerivedWiringKind,
  type DerivedWiringRow,
} from "../../civic-data/derived-meeting-wiring.ts";
import type { MeetingBodyCrosswalkRow } from "../../civic-data/meeting-body-crosswalk.ts";
import type { DiscoveryFind, MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import { ocdStateCode } from "../../ocd/state-of.ts";

export { derivedWiringKey };
export type { DerivedWiringRow };

/** The discovery vendors whose finds can confirm each wiring kind's route. */
const CONFIRMING_VENDORS: Readonly<Record<DerivedWiringKind, readonly string[]>> = {
  ICAL: ["ical"],
  OFFICIAL_PAGE_EVENTS: ["official-page-events"],
  DILIGENT: ["diligent"],
  LEGISTAR: ["legistar-api"],
  CIVICPLUS: ["civicplus-agendacenter"],
  BOARDBOOK: ["boardbook"],
  BOARDDOCS: ["boarddocs"],
  ESCRIBE: ["escribe"],
  CIVICCLERK: ["civicclerk-api"],
  IQM2: ["iqm2"],
  REVIZE: ["revize"],
  APPTEGY: ["apptegy"],
  ONBASE: ["onbase"],
  SUITEONE: ["suiteone"],
  SCHEDULEPAGE: ["schedulepage"],
  DOCUMENT_LISTING: ["document-listing"],
  LEGISTAR_INSITE: ["legistar-insite"],
};

/** A discovery vendor's route as the wiring kind the reader runs, or why it cannot be one. */
export type WiringShape =
  | { readonly kind: DerivedWiringKind; readonly endpoint: Readonly<Record<string, string>> }
  | { readonly held: "ADAPTER_CONFIG_INCOMPLETE"; readonly detail: string };

export function wiringShapeFor(find: Pick<DiscoveryFind, "vendor" | "url">): WiringShape {
  let url: URL;
  try {
    url = new URL(find.url);
  } catch {
    return { held: "ADAPTER_CONFIG_INCOMPLETE", detail: `the route ${find.url} is not a URL` };
  }
  if (find.vendor === "escribe" && /^pub-[a-z0-9-]+\.escribemeetings\.com$/i.test(url.hostname)) return { kind: "ESCRIBE", endpoint: { portalUrl: url.origin } };
  if (find.vendor === "ical") return { kind: "ICAL", endpoint: { feedUrl: url.toString() } };
  if (find.vendor === "legistar-api" && url.hostname === "webapi.legistar.com") {
    const slug = /^\/v1\/([a-z0-9_-]+)\/events\/?$/i.exec(url.pathname)?.[1];
    if (slug) return { kind: "LEGISTAR", endpoint: { slug } };
  }
  if (find.vendor === "diligent" && url.pathname === "/Services/MeetingsService.svc/meetings") return { kind: "DILIGENT", endpoint: { serviceBase: url.origin } };
  if (find.vendor === "official-page-events") return { kind: "OFFICIAL_PAGE_EVENTS", endpoint: { pageUrl: url.toString(), officialHost: url.host } };
  if (find.vendor === "civicclerk-api" && url.hostname.endsWith(".api.civicclerk.com")) return { kind: "CIVICCLERK", endpoint: { apiBase: url.origin } };
  if (find.vendor === "boardbook") {
    const orgId = /^\/Public\/Organization\/([^/]+)/.exec(url.pathname)?.[1];
    if (orgId && url.hostname === "meetings.boardbook.org") return { kind: "BOARDBOOK", endpoint: { orgId } };
  }
  if (find.vendor === "iqm2" && url.hostname.endsWith(".iqm2.com")) return { kind: "IQM2", endpoint: { base: url.origin } };
  if (find.vendor === "legistar-insite" && url.hostname.endsWith(".legistar.com")) return { kind: "LEGISTAR_INSITE", endpoint: { insiteHost: url.host } };
  if (find.vendor === "civicplus-agendacenter") {
    return { kind: "CIVICPLUS", endpoint: { agendaCenterUrl: url.toString() } };
  }
  if (find.vendor === "boarddocs" && /(^|\.)boarddocs\.com$/i.test(url.hostname)) {
    const path = /^(\/[^/]+\/[^/]+\/Board\.nsf)(?:\/|$)/i.exec(url.pathname)?.[1];
    if (path) return { kind: "BOARDDOCS", endpoint: { portalUrl: `${url.origin}${path}/Public` } };
  }
  return { held: "ADAPTER_CONFIG_INCOMPLETE", detail: `no reviewed-filter wiring kind takes a ${find.vendor} route yet` };
}

type Attested = { readonly attestation: HostAttestation } | { readonly held: DerivedHeldReason; readonly detail: string };

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

/** What the reader adapter made of the vaulted bytes with the reviewed filter. */
export type WiringVerification =
  | {
      readonly verified: AdapterVerification;
      /** The sittings the filter selected, as `startsAt|title`: two bodies selecting one sitting is a conflict. */
      readonly selected: readonly string[];
    }
  /** The adapter could not be run on the bytes for a reason of ours: held, never a trigger. */
  | { readonly refused: string }
  /** The bytes no longer read as the calendar, or the filter selects nothing from them: CALENDAR_CHANGED. */
  | { readonly changed: string }
  /** A selected sitting names another reviewed body and not this one: WRONG_ATTRIBUTION. */
  | { readonly wrongAttribution: string };

export interface DerivedWiringInputs {

  readonly crosswalk: {
    readonly input: DerivedInputRef;
    readonly versionId: string;
    readonly rows: readonly MeetingBodyCrosswalkRow[];
    readonly automatic?: { readonly input: DerivedInputRef; readonly versionId: string; readonly rowIds: ReadonlySet<string> };
  };
  /** The registration input a row's division rests on, or why the division is not registered. */
  readonly registration: (row: MeetingBodyCrosswalkRow) => { readonly input: DerivedInputRef; readonly identityInput?: DerivedInputRef } | { readonly notRegistered: string };
  /** Saved walks containing each route's newest actual read, with original log identity. */
  readonly attempts: readonly { readonly attempt: MeetingsDiscoveryAttempt; readonly recordId: string; readonly recordedAt: string }[];
  /** A hand-wired meeting door already serves the body: shadow-compared, never a second writer. */
  readonly handWired: (bodyId: string) => boolean;
  /** The vault's record of an artifact, or null when it is not held. */
  readonly vaulted: (artifactId: string) => (DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" }) | null;
  /** The vault's record of bytes by their sha256 (bare hex), or null when no artifact holds them. */
  readonly vaultedBytes: (sha256: string) => (DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" }) | null;
  /** The reader adapter's own reading of the vaulted bytes with the reviewed filter. */
  readonly verify: (
    row: DerivedWiringRow,
    binding: AdapterBinding,
    evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" },
    otherBodies: readonly string[],
  ) => WiringVerification;
  readonly adapterDigest: (kind: DerivedWiringKind) => string;
  /** The previous wiring version's entries. */
  readonly previous: readonly DerivedVersionEntry<DerivedWiringRow>[];
  /** This pass's instant, the time a newly observed trigger is recorded at. */
  readonly now: string;
}

/** Original saved walks containing the newest actual read of each route.
 * Rotating through a site's request allowance never makes other routes absent. */
export const CURRENT_CALENDAR_READS_SQL = `
WITH latest_reads AS (
  SELECT DISTINCT ON (log_key, step->>'url') log_key, position, step->>'url' AS route
  FROM cp_log_discovery_attempts
  CROSS JOIN LATERAL jsonb_array_elements(record->'steps') step
  WHERE ($1::text[] IS NULL OR log_key = ANY($1::text[]))
    AND step->>'purpose' = 'endpoint'
    AND (step->>'status' IS NOT NULL OR step->>'transportError' IS NOT NULL)
  ORDER BY log_key, step->>'url', record->>'finishedAt' DESC, position DESC
)
SELECT saved.log_key AS id, saved.position, saved.record AS value, array_agg(reads.route) AS routes
FROM cp_log_discovery_attempts saved
JOIN latest_reads reads ON reads.log_key = saved.log_key AND reads.position = saved.position
GROUP BY saved.log_key, saved.position, saved.record`;

export function latestCalendarWalk(attempts: DerivedWiringInputs["attempts"], jurisdictionId: string, route: string) {
  const walks = attempts.filter(walk => walk.attempt.jurisdictionId === jurisdictionId)
    .sort((a, b) => b.attempt.finishedAt.localeCompare(a.attempt.finishedAt));
  return walks.find(walk => walk.attempt.steps.some(step => step.purpose === "endpoint" &&
    sameRoute(step.url, route) && (step.status !== null || step.transportError !== null))) ?? walks[0];
}

/** Two URLs name the same route: scheme and host case aside, and a trailing slash aside. */
export function sameRoute(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname.toLowerCase() === y.hostname.toLowerCase() &&
      x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && x.search === y.search;
  } catch {
    return false;
  }
}

/** The state a division lies in, `US-AZ`, from its OCD id: a state, DC or a territory (`US-PR`). */
function stateOf(ocdId: string): string {
  const code = ocdStateCode(ocdId);
  return code === null ? "" : `US-${code.toUpperCase()}`;
}

/** The wiring row a crosswalk row becomes. */
export function wiringRowFor(row: MeetingBodyCrosswalkRow): DerivedWiringRow {
  return {
    bodyId: row.bodyId,
    ocdId: row.ocdId,
    bodyName: row.bodyName,
    kind: row.kind,
    route: row.route,
    officialHost: row.officialHost,
    jurisdictionId: row.jurisdictionId,
    state: stateOf(row.ocdId),
    publishingOrg: row.publishingOrg,
    timeZone: row.timeZone,
    config: derivedAdapterConfig({ kind: row.kind, route: row.route, officialHost: row.officialHost, bodyId: row.bodyId, bodyName: row.bodyName, filter: row.filter }),
    crosswalkRowId: row.id,
    reviewedAt: row.reviewedAt,
    verifiedAt: row.evidence.readAt,
  };
}

type Decision = DerivedRowDecision<DerivedWiringRow>;

export function deriveWiringDecisions(inputs: DerivedWiringInputs): readonly Decision[] {
  const previous = new Map(inputs.previous.map((entry) => [entry.key, entry]));
  const previousRoutes = new Map(inputs.previous.map(entry =>
    [derivedWiringKey(entry.row.kind, entry.row.bodyId, entry.row.route), entry.key]));
  const keyFor = (row: Pick<MeetingBodyCrosswalkRow, "kind" | "bodyId" | "route">) => {
    const routeKey = derivedWiringKey(row.kind, row.bodyId, row.route);
    return previousRoutes.get(routeKey) ?? routeKey;
  };
  const decisions = new Map<string, Decision>();
  const crosswalkInput = inputs.crosswalk.input;
  const active = inputs.crosswalk.rows.filter((row) => row.status === "ACTIVE");
  /* Selections, to find two bodies claiming the same sittings; resolved after every row is read. */
  const selections = new Map<string, { readonly bodyId: string; readonly selected: ReadonlySet<string> }>();

  const hold = (key: string, reason: DerivedHeldReason, detail: string, inputsFor: readonly DerivedInputRef[]): Decision =>
    ({ disposition: "HOLD", key, reason, detail, inputs: inputsFor });
  /* A trigger suspends a promoted row; the same evidence holds a row never promoted, by name. */
  const trigger = (key: string, kind: DerivedReviewTrigger, detail: string, evidence: readonly DerivedInputRef[]): Decision =>
    previous.has(key)
      ? { disposition: "SUSPEND", key, trigger: kind, detail, at: inputs.now, evidence }
      : hold(key, "REVIEW_TRIGGERED", `${kind}: ${detail}`, evidence);

  const automatic = inputs.crosswalk.automatic;
  const isAutomatic = (rowId: string): boolean => automatic?.rowIds.has(rowId) === true;
  /* The crosswalk version a row rests on: the automatic one for a row its reviewer accepted, the reviewed one otherwise. */
  const inputFor = (rowId: string): DerivedInputRef => (isAutomatic(rowId) ? automatic!.input : crosswalkInput);
  const rowIdByKey = new Map<string, string>();

  for (const reviewed of active) {
    const key = keyFor(reviewed);
    if (decisions.has(key)) continue;
    rowIdByKey.set(key, reviewed.id);
    const base: DerivedInputRef[] = [inputFor(reviewed.id)];
    const decide = (d: Decision): void => void decisions.set(key, d);

    const registration = inputs.registration(reviewed);
    if ("notRegistered" in registration) {
      decide(hold(key, "BODY_NOT_REGISTERED", registration.notRegistered, base));
      continue;
    }
    base.push(registration.input);
    if (registration.identityInput !== undefined) base.push(registration.identityInput);
    const walked = latestCalendarWalk(inputs.attempts, reviewed.jurisdictionId, reviewed.route);
    if (walked === undefined) {
      decide(hold(key, "WALK_ABSENT", `no walk of ${reviewed.jurisdictionId} is recorded`, base));
      continue;
    }
    const attemptInput: DerivedInputRef = { kind: "DISCOVERY_ATTEMPT", attemptId: walked.attempt.attemptId, recordId: walked.recordId, recordedAt: walked.recordedAt };
    base.push(attemptInput);
    const row = wiringRowFor(reviewed);
    const binding: AdapterBinding = { adapter: DERIVED_WIRING_SOURCE_NAMES[reviewed.kind], closureDigest: inputs.adapterDigest(reviewed.kind), config: row.config };
    const others = active.filter((r) => r.jurisdictionId === reviewed.jurisdictionId && r.bodyId !== reviewed.bodyId).map((r) => r.bodyName);

    const find = walked.attempt.found.find((f) => sameRoute(f.url, reviewed.route) && CONFIRMING_VENDORS[reviewed.kind].includes(f.vendor));
    if (find === undefined) {
      /* The walk did not confirm the reviewed route. Why decides whether it is an outage or a trigger. */
      const step = [...walked.attempt.steps].reverse().find((s) => sameRoute(s.url, reviewed.route));
      if (step === undefined) {
        decide(hold(key, "WALK_ABSENT", `the latest walk of ${reviewed.jurisdictionId} did not reach ${reviewed.route}`, base));
        continue;
      }
      const stepEvidence = step.artifactId === null ? null : inputs.vaulted(step.artifactId);
      const evidence = stepEvidence === null ? base : [...base, stepEvidence];
      if (step.status === 404 || step.status === 410) {
        decide(trigger(key, "ROUTE_GONE", `${reviewed.route} answered ${step.status}`, evidence));
      } else if (step.accessControl !== undefined) {
        /* A bot challenge answered in place of the calendar: an access control holds the row; it never suspends it. */
        decide(hold(key, "CHALLENGED", `${reviewed.route}: ${step.accessControl}`, base));
      } else if (step.status === null && step.permission === "RECORDED_WALL") {
        decide(hold(key, "CHALLENGED", `${reviewed.route}: a recorded access-control wall; ${step.note}`, base));
      } else if (step.status === null && step.permission === "DISALLOWED") {
        /* Only an older walk skipped a route for robots.txt; the next walk reads it. */
        decide(hold(key, "ROBOTS_REFUSED", `${reviewed.route}: skipped for robots.txt by a walk before 2026-09-25; the next walk reads it. ${step.note}`, base));
      } else if (step.status === null) {
        decide(hold(key, step.transportError !== null ? "TRANSPORT_FAILED" : "WALK_ABSENT", `${reviewed.route}: ${step.transportError ?? step.note}`, base));
      } else if (step.status === 401 || step.status === 403 || step.status === 429) {
        decide(hold(key, "CHALLENGED", `${reviewed.route} answered ${step.status}`, base));
      } else if (step.status >= 500) {
        decide(hold(key, "TRANSPORT_FAILED", `${reviewed.route} answered ${step.status}; a server error holds, it never suspends`, base));
      } else if (step.status >= 300 && step.status < 400) {
        decide(trigger(key, "CALENDAR_CHANGED", `${reviewed.route} now answers ${step.status}: the calendar moved`, evidence));
      } else if (stepEvidence !== null) {
        /* It answered and the walk's content check did not confirm it: the adapter reads the bytes to say why. */
        const verification = inputs.verify(row, binding, stepEvidence, others);
        if ("changed" in verification) decide(trigger(key, "CALENDAR_CHANGED", verification.changed, evidence));
        else if ("wrongAttribution" in verification) decide(trigger(key, "WRONG_ATTRIBUTION", verification.wrongAttribution, evidence));
        else decide(hold(key, "ROUTE_NOT_CONFIRMED", `the latest walk read ${reviewed.route} (${step.status}) and did not confirm it: ${step.note}`, evidence));
      } else {
        decide(hold(key, "ROUTE_NOT_CONFIRMED", `the latest walk read ${reviewed.route} (${step.status}) and did not confirm it: ${step.note}`, base));
      }
      continue;
    }

    const attested = attestationFor(walked.attempt, find);
    if ("held" in attested) {
      decide(hold(key, attested.held, attested.detail, base));
      continue;
    }
    if (inputs.handWired(reviewed.bodyId)) {
      decide(hold(key, "ALREADY_WIRED", `a hand-wired route serves ${reviewed.bodyId}; the two are shadow-compared, never two writers`, base));
      continue;
    }
    const calendar = find.artifactId === null ? null : inputs.vaulted(find.artifactId);
    if (calendar === null) {
      decide(hold(key, "EVIDENCE_NOT_VAULTED", `the confirming bytes of ${reviewed.route} are not held in the vault`, base));
      continue;
    }
    const bodyPage = inputs.vaultedBytes(reviewed.evidence.bodyPage.sha256);
    if (bodyPage === null) {
      decide(hold(key, "EVIDENCE_NOT_VAULTED", `the government's page naming ${reviewed.bodyName} (${reviewed.evidence.bodyPage.url}) is not held in the vault`, [...base, calendar]));
      continue;
    }
    const withEvidence = [...base, calendar, bodyPage];
    const verification = inputs.verify(row, binding, calendar, others);
    if ("refused" in verification) {
      decide(hold(key, "ADAPTER_REFUSED", verification.refused, withEvidence));
      continue;
    }
    if ("changed" in verification) {
      decide(trigger(key, "CALENDAR_CHANGED", verification.changed, withEvidence));
      continue;
    }
    if ("wrongAttribution" in verification) {
      decide(trigger(key, "WRONG_ATTRIBUTION", verification.wrongAttribution, withEvidence));
      continue;
    }
    const suspension = previous.get(key)?.suspension;
    if (suspension !== undefined && !(Date.parse(reviewed.reviewedAt) > Date.parse(suspension.since))) {
      decide(hold(key, "REVIEW_OWED", `suspended since ${suspension.since} (${suspension.trigger}); it waits for a review after that`, withEvidence));
      continue;
    }
    selections.set(key, { bodyId: reviewed.bodyId, selected: new Set(verification.selected) });
    decide({
      disposition: "PROMOTE",
      key,
      row,
      attestation: attested.attestation,
      binding,
      verification: verification.verified,
      inputs: withEvidence,
      reviewedAt: reviewed.reviewedAt,
    });
  }

  /* Two reviewed bodies whose filters select the same sitting on one calendar: conflicting evidence, neither taken. */
  const keys = [...selections.keys()].sort();
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = selections.get(keys[i]!)!;
      const b = selections.get(keys[j]!)!;
      if (a.bodyId === b.bodyId) continue;
      const shared = [...a.selected].find((sitting) => b.selected.has(sitting));
      if (shared === undefined) continue;
      /* A reviewed row wins over an automatic one: only the automatic row meets the trigger. Two of a kind both do. */
      const auto = [keys[i]!, keys[j]!].map((key) => isAutomatic(rowIdByKey.get(key) ?? ""));
      const losers = auto[0] !== auto[1] ? [keys[auto[0] ? i : j]!] : [keys[i]!, keys[j]!];
      for (const key of losers) {
        const promoted = decisions.get(key);
        const evidence = promoted?.disposition === "PROMOTE" ? promoted.inputs : [inputFor(rowIdByKey.get(key) ?? "")];
        decisions.set(key, trigger(key, "CONFLICTING_EVIDENCE", `${a.bodyId} and ${b.bodyId} both select the sitting ${shared}`, evidence));
      }
    }
  }

  /* A promoted row whose reviewed crosswalk row is withdrawn, or gone, publishes nothing new until reviewed again. */
  const reviewedKeys = new Map(inputs.crosswalk.rows.map((row) => [keyFor(row), row] as const));
  for (const [key, entry] of previous) {
    if (decisions.has(key)) continue;
    const reviewed = reviewedKeys.get(key);
    if (reviewed === undefined || reviewed.status === "WITHDRAWN") {
      decisions.set(key, {
        disposition: "SUSPEND",
        key,
        trigger: "CROSSWALK_WITHDRAWN",
        detail: reviewed === undefined
          ? `the reviewed crosswalk ${inputs.crosswalk.versionId}${automatic ? ` and the automatic crosswalk ${automatic.versionId}` : ""} no longer hold ${entry.row.crosswalkRowId}`
          : `withdrawn by review: ${reviewed.withdrawal?.reason ?? "no reason recorded"}`,
        at: inputs.now,
        evidence: automatic && automatic.input !== crosswalkInput ? [crosswalkInput, automatic.input] : [crosswalkInput],
      });
    }
  }
  return [...decisions.values()];
}
