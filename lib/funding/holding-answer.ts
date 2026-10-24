import { settleFundingSnapshotRead } from "./snapshot.ts";
import { REGISTRY_STATES,type BallotState } from "../civic-data/state-scopes.ts";
import { readerBallotSourcesForDivisions } from "../ballot/reader-sources.ts";
import { ballotCandidateAliases, ballotCandidatePeople, withCandidateTickets } from "../ballot/tickets.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { settleFederalDirectoryRead, settleRegistryAuthorityReads } from "../registry/server.ts";
import { directFundingTargetPlan, stateFromContest, FEDERAL_CONTEST, type FundingTargetPlan } from "./target-authorities.ts";
import { campaignMoneyApiAnswer, resolvedCandidacyForOfficial, type CampaignMoneyApiAnswer } from "./campaign-money.ts";
import { type CivicDataReadMetadata } from "../civic-data/read-model.ts";
import { currentReaderSelection } from "../db/reader-route.ts";

interface FundingHoldingReaders {
  readonly identityPlan: (target: string) => Promise<FundingTargetPlan>;
  readonly federal: () => Promise<{ kind: "PROMOTED" | "BOOTSTRAP"; metadata: CivicDataReadMetadata }>;
  readonly ballotIdentity: () => Promise<void>;
  readonly answer: (
    target: string,
    contestId: string | undefined,
    selection: { federal: boolean; identity: boolean },
  ) => CampaignMoneyApiAnswer;
}

type FundingHoldingSettlement =
  | {
      readonly kind: "ANSWER";
      readonly answer: CampaignMoneyApiAnswer;
      readonly holdingStatus: "HELD" | "PARTIAL";
      readonly unavailableAuthorities: string[];
      readonly dataState: "PROMOTED" | "BOOTSTRAP" | "PARTIAL";
      readonly dataMetadata: CivicDataReadMetadata | null;
    }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Reads a target's own id already decides; none of them reads the authority edge. */
interface DirectFundingReads {
  readonly federal?: ReturnType<FundingHoldingReaders["federal"]>;
  readonly ballotIdentity?: ReturnType<FundingHoldingReaders["ballotIdentity"]>;
}

export function startDirectFundingReads(direct: FundingTargetPlan, readers: FundingHoldingReaders): DirectFundingReads {
  const observed = <T,>(running: Promise<T>): Promise<T> => { running.catch(() => undefined); return running; };
  return {
    ...(direct.federal ? { federal: observed(Promise.resolve().then(() => readers.federal())) } : {}),
    ...(direct.ballotIdentity ? { ballotIdentity: observed(Promise.resolve().then(() => readers.ballotIdentity())) } : {}),
  };
}

/** Read only the authorities applicable to this target and settle them independently. */
export async function settleFundingHoldingAnswer(
  target: string,
  readers?: FundingHoldingReaders,
  started?: DirectFundingReads,
  divisions: readonly string[] = [],
): Promise<FundingHoldingSettlement> {
  readers ??= fundingHoldingReaders(divisions);
  const direct = directFundingTargetPlan(target);
  const identityPromise = Promise.resolve().then(() => readers.identityPlan(target));
  const early = started ?? startDirectFundingReads(direct, readers);
  const [identityResult] = await Promise.allSettled([identityPromise]);
  const plan = identityResult.status === "fulfilled" ? identityResult.value : direct;

  const federalPromise = plan.federal
    ? early.federal ?? Promise.resolve().then(() => readers.federal())
    : Promise.resolve(null);
  const ballotIdentityPromise = plan.ballotIdentity
    ? early.ballotIdentity ?? Promise.resolve().then(() => readers.ballotIdentity())
    : Promise.resolve(null);
  const [federalResult, ballotIdentityResult] = await Promise.allSettled([
    federalPromise,
    ballotIdentityPromise,
  ]);

  const unavailableAuthorities: string[] = [];
  if (identityResult.status === "rejected") unavailableAuthorities.push("PERSON_IDENTITY");
  if (plan.federal && federalResult.status === "rejected") unavailableAuthorities.push("FEC_FUNDING");
  if (plan.ballotIdentity && ballotIdentityResult.status === "rejected") unavailableAuthorities.push("BALLOT_CANDIDACY_IDENTITY");

  const federalHeld = plan.federal && federalResult.status === "fulfilled" && federalResult.value !== null;
  const identityHeld = identityResult.status === "fulfilled";
  if (plan.federal && !federalHeld) {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }
  if (!plan.federal && plan.state === null && !identityHeld && /^(?:statewide:|plural:|roster:)/.test(target)) {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }

  const federalValue = federalResult.status === "fulfilled" ? federalResult.value : null;
  const heldKinds = [federalHeld ? federalValue?.kind : null]
    .filter((kind): kind is "PROMOTED" | "BOOTSTRAP" => kind === "PROMOTED" || kind === "BOOTSTRAP");
  const holdingStatus = unavailableAuthorities.length ? "PARTIAL" : "HELD";
  const dataState = holdingStatus === "PARTIAL"
    ? "PARTIAL"
    : heldKinds.includes("BOOTSTRAP") ? "BOOTSTRAP" : "PROMOTED";
  const dataMetadata = federalHeld
    ? federalValue?.metadata ?? null
    : null;

  try {
    return {
      kind: "ANSWER",
      answer: readers.answer(target, plan.contestId ?? undefined, {
        federal: federalHeld,
        identity: identityHeld,
      }),
      holdingStatus,
      unavailableAuthorities,
      dataState,
      dataMetadata,
    };
  } catch {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities: [...new Set([...unavailableAuthorities, "ANSWER_ASSEMBLY"])] };
  }
}


/** Each read is timed by name and reported in the `Server-Timing` header. */
type ReadTimings = Record<string, number>;

export function timedRead<T>(timings: ReadTimings | undefined, name: string, read: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const running = Promise.resolve().then(read);
  if (!timings) return running;
  return running.finally(() => { timings[name] = Date.now() - started; });
}

async function currentFundingTargetPlan(target: string, divisions: readonly string[], timings?: ReadTimings): Promise<FundingTargetPlan> {
  const direct = directFundingTargetPlan(target);
  if ((direct.federal || direct.state !== null) && !target.startsWith("congress:") && !target.includes("|")) return direct;
  await timedRead(timings, "registry", () => settleRegistryAuthorityReads("REGISTRY"));
  if (target.startsWith("congress:")) await timedRead(timings, "federalDirectory", settleFederalDirectoryRead);
  const candidacy = resolvedCandidacyForOfficial(target);
  if (candidacy) currentReaderSelection()?.keys.add(candidacy.candidacyId);
  const contestId = direct.contestId ?? candidacy?.contestId ?? null;
  for (const { source } of await readerBallotSourcesForDivisions(divisions)) {
    const ballot = withCandidateTickets(source.normalize(await source.fetch()));
    const matches = (person: (typeof ballot.candidacies)[number]) => ballotCandidateAliases(person)
      .some(id => id === target || id === candidacy?.candidacyId);
    const choice = [...ballot.candidacies, ...ballot.filingCandidacies ?? []].find(row => ballotCandidatePeople(row).some(matches));
    const filed = choice && ballotCandidatePeople(choice).find(matches);
    const contest = ballot.contests.find(row => row.id === (choice?.contestId ?? contestId) || row.aliases?.includes(contestId ?? ""));
    if (!contest) continue;
    if (filed) currentReaderSelection()?.keys.add(filed.id);
    const memberOffice = filed && choice?.ticket?.runningMate.id === filed.id ? choice.ticket.runningMate.office : null;
    const office = officeIdentity(memberOffice ?? contest.title, contest.ocdId);
    const federal = office === "us_senator" || office === "us_representative";
    const state = ballot.election.state as BallotState;
    return { contestId: contest.id, federal, state: !federal && REGISTRY_STATES.includes(state) ? state : null,
      ballotIdentity: target.includes("|") || Boolean(filed && target !== filed.id) };
  }
  return { contestId, federal: direct.federal || (contestId !== null && FEDERAL_CONTEST.test(contestId)),
    state: direct.state ?? stateFromContest(contestId), ballotIdentity: target.includes("|") };

}

export function fundingHoldingReaders(divisions: readonly string[], timings?: ReadTimings): FundingHoldingReaders {
  return {
    identityPlan: target => currentFundingTargetPlan(target, divisions, timings),
    federal: () => timedRead(timings, "fec", async () => {
      const result = await settleFundingSnapshotRead();
      if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") throw new Error(result.detail);
      return { kind: result.kind, metadata: result.metadata };
    }),
    ballotIdentity: () => timedRead(timings, "ballots", async () => {
      for (const { source } of await readerBallotSourcesForDivisions(divisions)) source.normalize(await source.fetch());
    }),
    answer: (target, contestId, selection) => campaignMoneyApiAnswer(target, contestId, selection),
  };
}
