import { REGISTRY_STATES, type BallotState } from "../civic-data/state-scopes.ts";
import { campaignFinanceScopeForState } from "./campaign-scopes.ts";
import { readCampaignFinance, settleCampaignFinanceReads } from "./campaign-finance-reader.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { settleFundingSnapshotRead } from "./snapshot.ts";
import { settleStateMoneyRead, stateMoneyForTarget } from "./state-snapshot.ts";
import { readerBallotSourcesForDivisions } from "../ballot/reader-sources.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { settleFederalDirectoryRead, settleRegistryAuthorityReads } from "../registry/server.ts";
import { directFundingTargetPlan, stateFromContest, FEDERAL_CONTEST, type FundingTargetPlan } from "./target-authorities.ts";
import { campaignMoneyApiAnswer, resolvedCandidacyForOfficial, type CampaignMoneyApiAnswer } from "./campaign-money.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "./data-plane.ts";
import { mayUseTestFixture, type CivicDataReadMetadata } from "../civic-data/read-model.ts";

interface FundingHoldingReaders {
  readonly identityPlan: (target: string) => Promise<FundingTargetPlan>;
  readonly federal: () => Promise<{ kind: "PROMOTED" | "BOOTSTRAP"; metadata: CivicDataReadMetadata }>;
  readonly state: (state: BallotState) => Promise<{ kind: "PROMOTED" | "BOOTSTRAP"; metadata: CivicDataReadMetadata | null }>;
  readonly ballotIdentity: () => Promise<void>;
  readonly answer: (
    target: string,
    contestId: string | undefined,
    selection: { federal: boolean; state: boolean; identity: boolean },
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
  readonly state?: ReturnType<FundingHoldingReaders["state"]>;
  readonly ballotIdentity?: ReturnType<FundingHoldingReaders["ballotIdentity"]>;
}

export function startDirectFundingReads(direct: FundingTargetPlan, readers: FundingHoldingReaders): DirectFundingReads {
  const observed = <T,>(running: Promise<T>): Promise<T> => { running.catch(() => undefined); return running; };
  return {
    ...(direct.federal ? { federal: observed(Promise.resolve().then(() => readers.federal())) } : {}),
    ...(direct.state ? { state: observed(Promise.resolve().then(() => readers.state(direct.state!))) } : {}),
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
  const statePromise = plan.state
    ? (early.state && plan.state === direct.state ? early.state : Promise.resolve().then(() => readers.state(plan.state!)))
    : Promise.resolve(null);
  const ballotIdentityPromise = plan.ballotIdentity
    ? early.ballotIdentity ?? Promise.resolve().then(() => readers.ballotIdentity())
    : Promise.resolve(null);
  const [federalResult, stateResult, ballotIdentityResult] = await Promise.allSettled([
    federalPromise,
    statePromise,
    ballotIdentityPromise,
  ]);

  const unavailableAuthorities: string[] = [];
  if (identityResult.status === "rejected") unavailableAuthorities.push("PERSON_IDENTITY");
  if (plan.federal && federalResult.status === "rejected") unavailableAuthorities.push("FEC_FUNDING");
  if (plan.state && stateResult.status === "rejected") unavailableAuthorities.push(`STATE_CAMPAIGN_FINANCE:${plan.state}`);
  if (plan.ballotIdentity && ballotIdentityResult.status === "rejected") unavailableAuthorities.push("BALLOT_CANDIDACY_IDENTITY");

  const federalHeld = plan.federal && federalResult.status === "fulfilled" && federalResult.value !== null;
  const stateHeld = plan.state !== null
    && stateResult.status === "fulfilled"
    && stateResult.value !== null
    && (!plan.ballotIdentity || ballotIdentityResult.status === "fulfilled");
  const identityHeld = identityResult.status === "fulfilled";
  if ((plan.federal || plan.state !== null) && !federalHeld && !stateHeld) {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }
  if (!plan.federal && plan.state === null && !identityHeld && /^(?:statewide:|plural:|roster:)/.test(target)) {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }

  const federalValue = federalResult.status === "fulfilled" ? federalResult.value : null;
  const stateValue = stateResult.status === "fulfilled" ? stateResult.value : null;
  const heldKinds = [federalHeld ? federalValue?.kind : null, stateHeld ? stateValue?.kind : null]
    .filter((kind): kind is "PROMOTED" | "BOOTSTRAP" => kind === "PROMOTED" || kind === "BOOTSTRAP");
  const holdingStatus = unavailableAuthorities.length ? "PARTIAL" : "HELD";
  const dataState = holdingStatus === "PARTIAL"
    ? "PARTIAL"
    : heldKinds.includes("BOOTSTRAP") ? "BOOTSTRAP" : "PROMOTED";
  const dataMetadata = federalHeld
    ? federalValue?.metadata ?? null
    : stateHeld ? stateValue?.metadata ?? null : null;

  try {
    return {
      kind: "ANSWER",
      answer: readers.answer(target, plan.contestId ?? undefined, {
        federal: federalHeld,
        state: stateHeld,
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
  const contestId = direct.contestId ?? candidacy?.contestId ?? null;
  for (const { source } of await readerBallotSourcesForDivisions(divisions)) {
    const ballot = source.normalize(await source.fetch());
    const filed = [...ballot.candidacies, ...ballot.filingCandidacies ?? []].find(row => row.id === target || row.id === candidacy?.candidacyId);
    const contest = ballot.contests.find(row => row.id === (filed?.contestId ?? contestId));
    if (!contest) continue;
    const office = officeIdentity(contest.title);
    const federal = office === "us_senator" || office === "us_representative";
    const state = ballot.election.state as BallotState;
    return { contestId: contest.id, federal, state: !federal && REGISTRY_STATES.includes(state) ? state : null,
      ballotIdentity: target.includes("|") };
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
    state: (state) => timedRead(timings, `stateMoney_${state}`, () => settleCampaignMoneyForState(state)),
    ballotIdentity: () => timedRead(timings, "ballots", async () => {
      for (const { source } of await readerBallotSourcesForDivisions(divisions)) source.normalize(await source.fetch());
    }),
    answer: (target, contestId, selection) => campaignMoneyApiAnswer(target, contestId, selection),
  };
}

export async function settleCampaignMoneyForState(state: BallotState) {
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state)!;
  const division = `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
  const reads = await Promise.allSettled([
    readCampaignFinance(campaignFinanceScopeForState(state)),
    ...(Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, state) ? [settleStateMoneyRead(state as StateCampaignFinanceJurisdiction)] : []),
  ]);
  if (reads[0].status === "fulfilled" && reads[0].value.kind === "PROMOTED") await settleCampaignFinanceReads([division]);
  const held = reads.flatMap(row => row.status === "fulfilled" && row.value.kind === "PROMOTED" ? [row.value] : []);
  if (held.length) return { kind: "PROMOTED" as const, metadata: held[0].metadata };
  if (mayUseTestFixture()) {
    stateMoneyForTarget(`ballot-${state.toLowerCase()}-fixture-probe:contest:candidate`);
    return { kind: "BOOTSTRAP" as const, metadata: null };
  }
  throw new Error("The state's campaign filings could not be read.");
}
