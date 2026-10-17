import { stateBallotContractId } from "../civic-data/state-scopes.ts";
import { fingerprint } from "../control-plane/ids.ts";
import { openOccurrence, recordNextDue, resumeOpenOccurrence, syncObligations } from "../control-plane/scheduler/durable.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { transitionWorkItem } from "../control-plane/repository/coordinator.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { Division } from "../registry/types.ts";
import type { VotingDoorScope, VotingSourceBlank, VotingSourceDoor, VotingSourceRead } from "./voting-source-types.ts";
import type { SiteKind, VotingJurisdiction, VotingSite } from "./voting-sites.ts";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const words = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();
const population = (scope: VotingDoorScope): number => Number.isFinite(scope.population) && scope.population! >= 0 ? scope.population! : -1;

/** The registered local election units, not merely the places where a source happened to work. */
export function votingSourcePlaces(input: {
  state: VotingDoorScope;
  divisions: readonly Pick<Division, "ocdId" | "divisionType" | "label" | "state" | "geoid" | "parentOcdId">[];
  delegation: "state" | "county" | "town";
  populations?: ReadonlyMap<string, number>;
}): VotingDoorScope[] {
  if (input.delegation === "state") return [input.state];
  const candidates = input.divisions.filter(division => division.state.toUpperCase() === input.state.state.toUpperCase() &&
    (input.delegation === "county" ? division.divisionType === "county"
      : division.divisionType === "place" || division.divisionType === "cousub"));
  const localityName = (label: string) => words(label).replace(/\s+(?:town|city|village|township)$/, "");
  const selected = candidates.filter(division => input.delegation !== "town" || division.geoid?.length !== 7 ||
    candidates.filter(other => other.geoid?.length === 10 && localityName(other.label) === localityName(division.label)).length !== 1);
  const places = selected.map(division => ({
    state: input.state.state, ocdId: division.ocdId, name: division.label,
    ...(division.geoid?.length === 5 ? { countyFips: division.geoid } : {}),
    ...(division.geoid?.length === 10 ? { countyFips: division.geoid.slice(0, 5), countySubdivisionGeoid: division.geoid } : {}),
    ...(input.populations?.has(division.ocdId) ? { population: input.populations.get(division.ocdId)! } : {}),
  }));
  // An unavailable registry leaves a named state obligation to enumerate its local election offices.
  return (places.length ? places : [input.state]).sort((a, b) => population(b) - population(a) || a.ocdId.localeCompare(b.ocdId));
}

function applies(scope: VotingDoorScope, place: VotingDoorScope): boolean {
  if (scope.countyFips && place.countyFips && scope.countyFips !== place.countyFips) return false;
  if (scope.countySubdivisionGeoid && place.countySubdivisionGeoid && scope.countySubdivisionGeoid !== place.countySubdivisionGeoid) return false;
  return scope.state.toUpperCase() === place.state.toUpperCase() && (scope.ocdId === place.ocdId ||
    place.ocdId.startsWith(`${scope.ocdId}/`) || (!!scope.countyFips && scope.countyFips === place.countyFips && !scope.countySubdivisionGeoid));
}

/** A statewide site's mere presence never fills a different county or town's blank. */
function siteAt(site: VotingSite, owner: VotingDoorScope, place: VotingDoorScope): boolean {
  if (!applies(owner, place)) return false;
  if (site.countyFips && place.countyFips && site.countyFips !== place.countyFips) return false;
  if (site.countySubdivisionGeoid && place.countySubdivisionGeoid) return site.countySubdivisionGeoid === place.countySubdivisionGeoid;
  if (place.countySubdivisionGeoid && site.town) return words(site.town) === words(place.name);
  if (owner.ocdId === place.ocdId) return true;
  if (place.countySubdivisionGeoid) return false;
  if (place.countyFips) return site.countyFips === place.countyFips;
  return owner.ocdId === place.ocdId;
}

const KIND_LABEL: Record<SiteKind, string> = {
  ELECTION_DAY: "Election Day polling places", VOTE_CENTER: "vote centers", EARLY_VOTING: "early voting sites",
  SATELLITE: "satellite offices", MOBILE: "mobile voting sites", DROP_BOX: "ballot drop boxes and return rules",
};

/** One open locality blank collects what is owed, the actual reads, and the next official routes. */
export function planVotingSourceBlanks(input: {
  electionDate: string;
  places: readonly VotingDoorScope[];
  doors: readonly VotingSourceDoor[];
  reads: readonly VotingSourceRead[];
  jurisdictions?: readonly VotingJurisdiction[];
}): VotingSourceBlank[] {
  const readsByDoor = new Map(input.reads.map(read => [read.doorId, read]));
  const result: VotingSourceBlank[] = [];
  for (const place of input.places) {
    const doors = input.doors.filter(door => door.electionDate === input.electionDate && applies(door.scope, place));
    const reads = doors.flatMap(door => { const read = readsByDoor.get(door.id); return read ? [{ door, read }] : []; });
    const held = (input.jurisdictions ?? []).filter(jurisdiction => jurisdiction.electionDate === input.electionDate && applies(jurisdiction, place));
    const noGeneral = [...doors, ...held].find(jurisdiction => jurisdiction.publication?.status === "NO_GENERAL_ELECTION" && jurisdiction.publication.source.url);
    if (noGeneral) {
      const owed = reads.flatMap(({ read }) => read.blanks.filter(blank => applies(blank.scope, place)));
      if (noGeneral.publication?.specialElections === undefined) result.push({
        id: `voting-sites:${input.electionDate}:${place.ocdId}`, doorId: doors[0]?.id ?? `voting-office:${place.ocdId}`,
        scope: place, status: "open", reason: "missing-sites",
        owed: `Check the official special-election calendar for any election applying in ${place.name} on ${input.electionDate}. The published absence of a general election does not establish whether a special election applies.`,
        tried: unique(reads.flatMap(({ read }) => read.attempts.map(attempt => `${attempt.url}: ${attempt.outcome}`))),
        next: unique([noGeneral.publication!.source.url, ...owed.flatMap(blank => blank.next)]),
      });
      continue;
    }
    const sites = [...reads.flatMap(({ door, read }) => read.sites.filter(site => siteAt(site, door.scope, place))),
      ...held.flatMap(jurisdiction => jurisdiction.sites.filter(site => siteAt(site, jurisdiction, place)))];
    const owed: string[] = [];
    const rules = [...reads.flatMap(({ read }) => read.rules), ...held.flatMap(jurisdiction => jurisdiction.rules ?? [])];
    const absent = new Set(rules.filter(rule => rule.source.url).flatMap(rule => rule.absenceOf ?? []));
    const fulfilled = (kind: SiteKind) => sites.some(site => site.kind === kind) || absent.has(kind);
    // The goal supplies the owed categories even when discovery has found only a polling-place door.
    // Absence is explicit source data; a return rule alone cannot establish that a kind is not offered.
    if (!sites.some(site => site.kind === "ELECTION_DAY" || site.kind === "VOTE_CENTER") && !(absent.has("ELECTION_DAY") && absent.has("VOTE_CENTER"))) owed.push(`Find Election Day polling places or vote centers for ${place.name}, or the office's published rule explaining how to vote without them`);
    for (const kind of unique<SiteKind>(["EARLY_VOTING", "SATELLITE", "DROP_BOX", ...doors.flatMap(door => door.covers).filter(kind => kind === "MOBILE")])) {
      if (!fulfilled(kind)) owed.push(`Find ${KIND_LABEL[kind]} for ${place.name}, or the office's published rule explaining their absence`);
    }
    const missingHours = sites.filter(site => !site.hours);
    const missingDays = sites.filter(site => ["EARLY_VOTING", "SATELLITE", "MOBILE"].includes(site.kind) && !site.days);
    if (missingHours.length) owed.push(`Published hours for ${unique(missingHours.map(site => site.name)).join(", ")}`);
    if (missingDays.length) owed.push(`Published days for ${unique(missingDays.map(site => site.name)).join(", ")}`);
    const ungeocoded = sites.filter(site => site.lat === null || site.lng === null);
    if (ungeocoded.length) owed.push(`Census geocodes for ${unique(ungeocoded.map(site => site.name)).join(", ")}`);
    const office = doors.filter(door => door.scope.ocdId === place.ocdId).some(door => !!(readsByDoor.get(door.id)?.office ?? door.office)?.phone) ||
      reads.some(({ read }) => read.contacts?.some(contact => contact.scope.ocdId === place.ocdId && !!(contact.office.phone || contact.office.email))) ||
      held.some(jurisdiction => jurisdiction.ocdId === place.ocdId && !!(jurisdiction.office?.phone || jurisdiction.office?.email));
    if (!office) owed.push(`Local election office contact for ${place.name}`);
    const inherited = reads.flatMap(({ read }) => read.blanks.filter(blank => applies(blank.scope, place)));
    owed.push(...inherited.map(blank => blank.owed));
    const later = unique([...doors.flatMap(door => door.publicationMessage ? [door.publicationMessage] : []),
      ...reads.flatMap(({ read }) => read.publicationMessage ? [read.publicationMessage] : [])]);
    if (later.length) owed.push(...later.map(text => `Recheck the office's posting: “${text}”`));
    if (!owed.length) continue;
    const tried = unique([...reads.flatMap(({ read }) => read.attempts.map(attempt => `${attempt.url} (${attempt.route}): ${attempt.outcome}`)),
      ...rules.map(rule => `${rule.source.url}: Published rule: ${rule.text}`),
      ...inherited.flatMap(blank => blank.tried)]);
    const next = unique([...inherited.flatMap(blank => blank.next), ...doors
      .filter(door => door.shape !== "identity-locked-lookup" && door.access?.status !== "identity-locked")
      .map(door => door.url), ...doors.map(door => door.electionPageUrl),
      `Follow the chief election office's directory to ${place.name}'s local election office; read its files, lists and public map data`,
      "Start with the chief election office and follow its official links; never use a search engine or Google Civic for a background hunt",
      "Record what robots.txt says as evidence and read the public page anyway; use the existing browser-UA rung only if it passes without a challenge; never log in, solve a CAPTCHA, or ask for identity details"]);
    result.push({ id: `voting-sites:${input.electionDate}:${place.ocdId}`, doorId: doors[0]?.id ?? `voting-office:${place.ocdId}`,
      scope: place, owed: unique(owed).join("; "), tried, next, status: "open",
      reason: !sites.length ? "missing-sites" : later.length ? "unpublished" : inherited[0]?.reason ?? (ungeocoded.length ? "geocode" : "missing-sites") });
  }
  return result.sort((a, b) => population(b.scope) - population(a.scope) || a.scope.ocdId.localeCompare(b.scope.ocdId));
}

function blankPlan(blank: VotingSourceBlank, electionDate: string): AutonomousWorkPlan {
  const seedUrls = unique(blank.next.flatMap(value => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? [url.href] : []; }
    catch { return []; }
  }));
  const instructions = [`Owed: ${blank.owed}`, ...blank.tried.map(tried => `Tried: ${tried}`), ...blank.next.map(next => `Next: ${next}`)];
  return {
    version: 1, capability: "voting-source-blanks", jurisdiction: blank.scope.state.toUpperCase(), missionPart: "ballot",
    ...(population(blank.scope) >= 0 ? { subjectPopulation: population(blank.scope) } : {}),
    sourceRegistryReferences: [blank.doorId, blank.scope.ocdId], seedUrls, sources: [], acquisition: [], auditScope: "SOURCE_UNIVERSE",
    publication: { contractId: stateBallotContractId("voting-sites", blank.scope.state), bodyId: blank.scope.ocdId }, ownerInstructions: ["VS-01"],
    contract: { schemaVersion: 2, recordClass: "VOTING_SITE", subjectId: blank.scope.ocdId,
      requiredFields: ["jurisdictionName", "model", "name", "address", "kind"],
      identity: { namespace: blank.id, keyFields: ["name", "address", "kind"] },
      jurisdiction: { country: "US", state: blank.scope.state.toUpperCase(), canonicalId: blank.scope.ocdId },
      completenessScope: `${blank.scope.name}, election ${electionDate}. ${instructions.join("\n")}`,
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `unobserved:${blank.doorId}`, publisher: blank.scope.name,
        routeIds: [blank.doorId], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: blank.owed },
      verification: { required: false, authorities: [] } },
  };
}

/** Existing obligations/occurrences put every blank in Admin and the standing hunter queue. */
export async function persistVotingSourceBlanks(input: {
  repos: ControlPlaneRepositories; blanks: readonly VotingSourceBlank[]; electionDate: string; now: string;
}): Promise<{ obligationIds: string[]; workItemIds: string[] }> {
  const obligationIds: string[] = [], workItemIds: string[] = [];
  const grouped = new Map<string, VotingSourceBlank>();
  for (const blank of input.blanks) {
    const prior = grouped.get(blank.scope.ocdId);
    grouped.set(blank.scope.ocdId, prior ? { ...prior,
      scope: population(blank.scope) > population(prior.scope) ? blank.scope : prior.scope,
      owed: unique([prior.owed, blank.owed]).join("; "), tried: unique([...prior.tried, ...blank.tried]), next: unique([...prior.next, ...blank.next]),
    } : blank);
  }
  for (const blank of [...grouped.values()].sort((a, b) => population(b.scope) - population(a.scope) || a.id.localeCompare(b.id))) {
    const plan = blankPlan(blank, input.electionDate);
    const id = `voting-source-blank:${fingerprint([input.electionDate, blank.scope.ocdId])}`;
    const synced = await syncObligations(input.repos, [{ id, recordClass: "VOTING_SITE", subjectId: blank.scope.ocdId,
      scopeDivisions: [blank.scope.ocdId], routeId: `voting-source-discovery:${blank.scope.ocdId}`, active: true,
      readerImpactAt: `${input.electionDate}T00:00:00.000Z`, observedChangeRateHours: null,
      lastWorkedAt: null, autonomousPlan: plan }], input.now, { exactReads: true });
    let row = synced.all[0];
    // Retain repaired mappings and evidence; refresh just the locality's outstanding instructions.
    const refreshed = { ...row.autonomousPlan!, ownerInstructions: plan.ownerInstructions, subjectPopulation: plan.subjectPopulation,
      ...(row.autonomousPlan?.contract.schemaVersion === 2 && plan.contract.schemaVersion === 2
        ? { contract: { ...row.autonomousPlan.contract, completenessScope: plan.contract.completenessScope } } : {}) };
    if (canonicalJson(refreshed) !== canonicalJson(row.autonomousPlan)) {
      const held = await input.repos.obligations.mustRead(id);
      row = (await input.repos.obligations.compareAndSet(id, held.revision, { ...held.value,
        autonomousPlan: refreshed, updatedAt: input.now }, input.now)).value;
    }
    const resumed = await resumeOpenOccurrence(input.repos, row, await input.repos.dispatchState.readOpen({ obligationIds: [row.id] }));
    const due = scheduleObligation(row, Date.parse(input.now));
    if ("nextDueAt" in due) await recordNextDue(input.repos, { obligationId: id, nextDueAt: due.nextDueAt, now: input.now });
    const opened = resumed ? null : await openOccurrence(input.repos, {
      obligation: row, dueAt: "nextDueAt" in due ? due.nextDueAt : input.now, now: input.now,
    });
    const occurrenceId = resumed?.kind === "OPEN" ? resumed.id : resumed?.kind === "SETTLED" ? resumed.settled.occurrenceId : opened?.occurrence.id;
    if (occurrenceId) {
      const occurrence = await input.repos.occurrences.mustRead(occurrenceId);
      let item = await input.repos.workItems.mustRead(occurrence.value.workItemId);
      if (item.value.state !== "OPEN" && item.value.state !== "REOPENED") {
        item = await transitionWorkItem(input.repos, { workItemId: item.id, to: "OPEN", by: "voting-source-refresh",
          why: blank.owed, now: input.now });
      }
      if (item.value.autonomousPlan) {
        const next = { ...item.value.autonomousPlan, ownerInstructions: plan.ownerInstructions, subjectPopulation: plan.subjectPopulation,
          ...(item.value.autonomousPlan.contract.schemaVersion === 2 && plan.contract.schemaVersion === 2
            ? { contract: { ...item.value.autonomousPlan.contract, completenessScope: plan.contract.completenessScope } } : {}) };
        if (canonicalJson(next) !== canonicalJson(item.value.autonomousPlan) || item.value.why !== blank.owed) {
          await input.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, why: blank.owed, autonomousPlan: next }, input.now);
        }
      }
      workItemIds.push(item.id);
    }
    obligationIds.push(id);
  }
  return { obligationIds, workItemIds };
}
