import { ocdStateCode } from "../ocd/state-of.ts";
import { cache } from "react";

import type { SeatHolder } from "../officials/lookup.ts";
import { seatHoldersForOffice, seatHolderById } from "../registry/server.ts";
import { standingChipMayAttach } from "../officials/elected-role.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { currentOfficialIdentity } from "../funding/campaign-money.ts";

import {
  candidateUniverse,
  contestLabelEligibility,
  officeholderUniverse,
  statesFromResolution,
  type CandidateIncumbencyState,
  type ContestEligibility,
  type HolderSourceShape,
} from "./contest-universe.ts";
import { getGeneralLineup, lineupForContest } from "./general-lineup.ts";
import {
  nameParts,
  namesAgree,
  namesAgreeLoosely,
  resolveContestIncumbency,
  splitDisplayName,
  type IncumbencyDecision,
  type SeatHolderRef,
} from "./incumbency.ts";
import { nhLegislativeHolders, nhLegislativeRosterAppliesTo } from "./seat-holders.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../state-rollcalls/authority.ts";

export interface ContestCandidate {
  readonly key: string;
  readonly display: string;
  readonly targetKey: string;
}

export interface ContestForIncumbency {
  readonly id: string;
  readonly title: string;
  readonly ocdId: string;
  readonly candidates: readonly ContestCandidate[];
  readonly federal: boolean;
  readonly voteFor: number | null;
  readonly candidateListComplete?: boolean;
}

export interface ContestIncumbencyResult {
  readonly decisions: Map<string, IncumbencyDecision>;
  readonly resolved: Map<string, IncumbencyDecision>;
  readonly states: Map<string, CandidateIncumbencyState>;
  readonly eligibility: ContestEligibility;
  readonly holderFor: Map<string, SeatHolder>;
}

const committedHolderByKey = cache(
  async (ocdId: string, title: string, targetKey: string): Promise<SeatHolder | null> => {
    const office = officeIdentity(title, ocdId);
    if (!office || !standingChipMayAttach(title)) return null;
    const matches = readerPersonKeys(targetKey).keys.flatMap((key) => {
      const current = currentOfficialIdentity(key);
      return current && current.divisions.includes(ocdId) && officeIdentity(current.officeTitle, ocdId) === office
        && sameSeatDiscriminators(title, current.officeTitle, ocdId) ? [current.id] : [];
    });
    const ids = [...new Set(matches)];
    return ids.length === 1 ? seatHolderById(ids[0]) : null;
  },
);

export async function committedIncumbentHolderFor(
  contest: Pick<ContestForIncumbency, "ocdId" | "title">,
  targetKey: string,
): Promise<SeatHolder | null> {
  return committedHolderByKey(contest.ocdId, contest.title, targetKey);
}

export type FederalHolderLookup = (targetKey: string) => Promise<SeatHolder | null>;

function enumeratedSeatHolders(contest: { title: string; ocdId: string }): SeatHolderRef[] {
  if (!nhLegislativeRosterAppliesTo(contest)) return [];
  return nhLegislativeHolders(contest.title);
}

function certifiedNomineesFor(state: string, contestId: string): { source: string; names: string[] } | null {
  const entry = lineupForContest(state, contestId);
  if (entry === null) return null;
  const canvass = getGeneralLineup(state)?.canvass;
  return {
    source: [...new Set(entry.nominees.map(nominee => nominee.provenance
      ? `${nominee.provenance.sourceOrg} (${nominee.provenance.sourceUrl}, read ${nominee.provenance.collectedAt})`
      : canvass ? `${canvass.title} (${canvass.issuedBy}, read ${canvass.readAt})` : "the certified canvass"))].join("; "),
    names: entry.nominees.map((n) => n.name),
  };
}

const ENUMERATING_ROSTER_PREFIXES = [
  "congress:",
  "plural:",
  ...OFFICIAL_STATE_LEGISLATOR_TARGETS.map((target) => `${target.sourceId}:`),
];

function shapeOfRegistryHolders(holders: readonly SeatHolder[]): HolderSourceShape {
  if (holders.length === 0) return "NOTHING_READ";
  return holders.every((h) => ENUMERATING_ROSTER_PREFIXES.some((prefix) => (h.id ?? "").startsWith(prefix)))
    ? "ENUMERATES_THE_SEAT"
    : "COLLECTED_PERSON_BY_PERSON";
}

export async function contestIncumbency(
  contest: ContestForIncumbency,
  federalHolderFor: FederalHolderLookup,
  holdersForSeat: (ocdId: string, officeTitle: string) => Promise<SeatHolder[]> = seatHoldersForOffice,
  universeSources: {
    enumeratedHolders?: (contest: { title: string; ocdId: string }) => SeatHolderRef[];
    certifiedNominees?: (contestId: string) => { source: string; names: readonly string[] } | null;
    committedHolder?: typeof committedIncumbentHolderFor;
  } = {},
): Promise<ContestIncumbencyResult> {
  const candidates = contest.candidates.map((c) => ({
    id: c.key,
    ...splitDisplayName(c.display),
  }));

  const officeIsElected = standingChipMayAttach(contest.title);

  const registryHolders = officeIsElected ? (await holdersForSeat(contest.ocdId, contest.title)).filter(holder =>
    officeIdentity(holder.officeTitle, contest.ocdId) === officeIdentity(contest.title, contest.ocdId) &&
    sameSeatDiscriminators(contest.title, holder.officeTitle, contest.ocdId)) : [];
  let holders: SeatHolderRef[] = registryHolders.map((h) => ({
    ...splitDisplayName(h.name),
    personKey: h.id?.trim() || null,
    source: `the officeholder registry for ${h.officeTitle} on ${contest.ocdId}`,
  }));
  let shape: HolderSourceShape = shapeOfRegistryHolders(registryHolders);

  if (officeIsElected) {
    const enumerated = (universeSources.enumeratedHolders ?? enumeratedSeatHolders)(contest);
    if (enumerated.length > 0) {
      holders = enumerated;
      shape = "ENUMERATES_THE_SEAT";
    }
  }

  if (holders.length === 0 && contest.federal) {
    const resolved = await Promise.all(
      contest.candidates.map(async (c) => {
        const holder = await federalHolderFor(c.targetKey);
        return holder === null || officeIdentity(holder.officeTitle, contest.ocdId) !== officeIdentity(contest.title, contest.ocdId) ||
          !sameSeatDiscriminators(contest.title, holder.officeTitle, contest.ocdId) ? null : { display: c.display, holder };
      }),
    );
    holders = resolved
      .filter((r): r is { display: string; holder: SeatHolder } => r !== null)
      .map(({ display, holder }) => ({
        ...splitDisplayName(display),
        personKey: holder.id?.trim() || null,
        source: "the FEC candidate/committee join against the congressional roster",
      }));
    if (holders.length > 0) shape = "PROBED_PER_CANDIDATE";
  }

  const resolved = resolveContestIncumbency({ candidates, holders, officeIsElected });

  const committed = new Map<string, SeatHolder>();
  for (const candidate of contest.candidates) {
    try {
      const holder = await (universeSources.committedHolder ?? committedIncumbentHolderFor)(contest, candidate.targetKey);
      if (holder) committed.set(candidate.key, holder);
    } catch {
    }
  }
  for (const [key, holder] of committed) {
    if ([...committed.values()].filter(other => other.id === holder.id).length !== 1) continue;
    resolved.set(key, { standing: "INCUMBENT", basis: "The committed candidacy/person identity and current sourced officeholder agree on this exact division and office.", source: holder.sourceUrl ?? holder.provenance?.sourceOrg ?? holder.id });
    if (shape !== "ENUMERATES_THE_SEAT" && !holders.some(row => row.personKey === holder.id)) {
      holders.push({ ...splitDisplayName(holder.name), personKey: holder.id, source: holder.sourceUrl ?? holder.provenance?.sourceOrg ?? holder.id });
      shape = "COLLECTED_PERSON_BY_PERSON";
    }
  }

  const holderFor = new Map<string, SeatHolder>();
  for (const c of contest.candidates) {
    if (resolved.get(c.key)?.standing !== "INCUMBENT") continue;
    const exact = committed.get(c.key);
    if (exact && [...committed.values()].filter(other => other.id === exact.id).length === 1) {
      holderFor.set(c.key, exact);
      continue;
    }
    const cand = nameParts(splitDisplayName(c.display).givenName, splitDisplayName(c.display).familyName);
    const hit = registryHolders.find((h) => {
      const parts = splitDisplayName(h.name);
      const hp = nameParts(parts.givenName, parts.familyName);
      return namesAgree(cand, hp) || namesAgreeLoosely(cand, hp);
    });
    if (hit) holderFor.set(c.key, hit);
  }

  const candidateKeys = contest.candidates.map((c) => c.key);
  const holderSourceName = holders[0]?.source ?? null;

  if (!officeIsElected) {
    const states = statesFromResolution(resolved, candidateKeys, false);
    return {
      decisions: resolved,
      resolved,
      states,
      eligibility: contestLabelEligibility({
        candidateUniverse: {
          complete: false,
          contradicted: false,
          source: null,
          reason: "incumbency does not attach to an office that is not filled by election.",
        },
        officeholderUniverse: {
          complete: false,
          contradicted: false,
          source: null,
          reason: "incumbency does not attach to an office that is not filled by election.",
        },
        candidateKeys,
        states,
      }),
      holderFor,
    };
  }

  const officeholders = officeholderUniverse({
    shape,
    source: holderSourceName,
    holders: holders.length,
    seatsThisContestFills: contest.voteFor,
  });
  const certified = contest.candidateListComplete ? { source: "the state election authority’s complete candidate list",
    names: contest.candidates.map(c => c.display) } : (universeSources.certifiedNominees ? universeSources.certifiedNominees(contest.id) : certifiedNomineesFor(ocdStateCode(contest.ocdId) ?? "", contest.id));
  const candidatesUniverse = candidateUniverse({
    certified,
    rendered: contest.candidates.map((c) => c.display),
    renderedSource: contest.candidates.length > 0 ? "the contest's own filed-candidate record" : null,
  });
  if (contest.candidateListComplete) for (const key of candidateKeys) {
    if (resolved.get(key)?.standing === "INCUMBENT" || resolved.get(key)?.standing === "UNKNOWN") continue;
    resolved.set(key, { standing: "CHALLENGER", basis: "This non-incumbent is on the state election authority’s complete candidate list.", source: certified!.source });
  }
  const states = statesFromResolution(resolved, candidateKeys, officeholders.complete || contest.candidateListComplete === true);
  const eligibility = contestLabelEligibility({
    candidateUniverse: candidatesUniverse,
    officeholderUniverse: officeholders,
    candidateKeys,
    states,
  });

  if (eligibility.eligible || contest.candidateListComplete) return { decisions: resolved, resolved, states, eligibility, holderFor };

  const gap = holders.length > 0 ? ("CONTEST_NOT_ESTABLISHED" as const) : ("HOLDER_NOT_SOURCED" as const);
  const decisions = new Map<string, IncumbencyDecision>();
  for (const key of candidateKeys) {
    const identityContradicted = eligibility.candidateUniverse.contradicted;
    const resolvedHere = resolved.get(key);
    if (!identityContradicted && resolvedHere?.standing === "INCUMBENT") {
      decisions.set(key, resolvedHere);
      continue;
    }
    decisions.set(key, {
      standing: "UNKNOWN",
      basis: eligibility.reason,
      source: holderSourceName,
      gap,
    });
  }
  return { decisions, resolved, states, eligibility, holderFor };
}
