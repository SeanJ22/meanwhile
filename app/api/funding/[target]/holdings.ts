import { directFundingTargetPlan, stateFromContest, FEDERAL_CONTEST, type FundingTargetPlan } from "@/lib/funding/target-authorities";
import { campaignMoneyApiAnswer, type CampaignMoneyApiAnswer } from "@/lib/funding/campaign-money";
import { settleFundingSnapshotRead } from "@/lib/funding/snapshot";
import {
  settleStateMoneyRead,
  stateMoneyForTarget,
} from "@/lib/funding/state-snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { settleAzBallotRead } from "@/lib/civic-data/manual-read-models";
import { getRegistryRuntimeReadModel } from "@/lib/registry/runtime-read-model";
import { settleFederalDirectoryRead, settleRegistryAuthorityReads } from "@/lib/registry/server";
import { mayUseTestFixture, promotedVersionOrThrow, type CivicDataReadMetadata } from "@/lib/civic-data/read-model";

export interface FundingHoldingReaders {
  readonly identityPlan: (target: string) => Promise<FundingTargetPlan>;
  readonly federal: () => Promise<{ kind: "PROMOTED" | "BOOTSTRAP"; metadata: CivicDataReadMetadata }>;
  readonly state: (state: StateCampaignFinanceJurisdiction) => Promise<{ kind: "PROMOTED" | "BOOTSTRAP"; metadata: CivicDataReadMetadata | null }>;
  readonly azIdentity: () => Promise<void>;
  readonly answer: (
    target: string,
    contestId: string | undefined,
    selection: { federal: boolean; state: boolean; identity: boolean },
  ) => CampaignMoneyApiAnswer;
}

export type FundingHoldingSettlement =
  | {
      readonly kind: "ANSWER";
      readonly answer: CampaignMoneyApiAnswer;
      readonly holdingStatus: "HELD" | "PARTIAL";
      readonly unavailableAuthorities: string[];
      readonly dataState: "PROMOTED" | "BOOTSTRAP" | "PARTIAL";
      readonly dataMetadata: CivicDataReadMetadata | null;
    }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Each read is timed by name and reported in the `Server-Timing` header. */
export type ReadTimings = Record<string, number>;

export function timedRead<T>(timings: ReadTimings | undefined, name: string, read: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const running = Promise.resolve().then(read);
  if (!timings) return running;
  return running.finally(() => { timings[name] = Date.now() - started; });
}

async function currentFundingTargetPlan(target: string, timings?: ReadTimings): Promise<FundingTargetPlan> {
  const direct = directFundingTargetPlan(target);
  if ((direct.federal || direct.state !== null) && !target.startsWith("congress:") && !target.includes("|")) return direct;
  // The registry and the federal directory are served from the reader authority
  // edge when this request entered one, the database otherwise:
  // the same readers Ask uses.
  await timedRead(timings, "registry", () => settleRegistryAuthorityReads("REGISTRY"));
  const related = getRegistryRuntimeReadModel().officialCandidacies.rows.filter((row) =>
    row.holder.id === target || row.candidacy?.candidacyId === target,
  );
  if (related.some((row) => row.holder.authority === "FEDERAL_DIRECTORY")) {
    await timedRead(timings, "federalDirectory", settleFederalDirectoryRead);
  }
  const candidacy = related.find((row) => row.candidacy !== null)?.candidacy ?? null;
  const contestId = direct.contestId ?? candidacy?.contestId ?? null;
  const state = direct.state ?? stateFromContest(candidacy?.contestId ?? null);
  return {
    contestId,
    federal: direct.federal
      || related.some((row) => row.holder.authority === "FEDERAL_DIRECTORY")
      || (candidacy !== null && FEDERAL_CONTEST.test(candidacy.contestId)),
    state,
    azIdentity: state === "AZ" && target.includes("|"),
  };
}

export function defaultReadersFor(timings?: ReadTimings): FundingHoldingReaders {
  return {
    identityPlan: (target) => currentFundingTargetPlan(target, timings),
    // Each edge first: a request that entered the reader edge
    // (this route's GET, a /ballot card, Ask) reads the proven copy through the
    // same Reader; the database otherwise.
    federal: () => timedRead(timings, "fec", async () => {
      const result = await settleFundingSnapshotRead();
      if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") throw new Error(result.detail);
      return { kind: result.kind, metadata: result.metadata };
    }),
    state: (state) => timedRead(timings, `stateMoney_${state}`, async () => {
      const result = await settleStateMoneyRead(state);
      if (result.kind === "PROMOTED") return { kind: "PROMOTED" as const, metadata: result.metadata };
      // Deterministic tests can install the explicit fixture behind the exact
      // state cache. Touching a made-up key verifies that exact cache without
      // manufacturing a record or opening a sibling state.
      if (mayUseTestFixture()) {
        stateMoneyForTarget(`ballot-${state.toLowerCase()}-fixture-probe:contest:candidate`);
        return { kind: "BOOTSTRAP" as const, metadata: null };
      }
      throw new Error(result.detail);
    }),
    azIdentity: () => timedRead(timings, "azBallot", async () => { promotedVersionOrThrow(await settleAzBallotRead()); }),
    answer: (target, contestId, selection) => campaignMoneyApiAnswer(target, contestId, selection),
  };
}

const defaultReaders: FundingHoldingReaders = defaultReadersFor();

/** Reads a target's own id already decides; none of them reads the authority edge. */
export interface DirectFundingReads {
  readonly federal?: ReturnType<FundingHoldingReaders["federal"]>;
  readonly state?: ReturnType<FundingHoldingReaders["state"]>;
  readonly azIdentity?: ReturnType<FundingHoldingReaders["azIdentity"]>;
}

/**
 * Start what the target's own id already decides beside the registry read that plans the rest. Each is
 * observed at once, so a failure before it is awaited is never an unhandled rejection.
 */
export function startDirectFundingReads(direct: FundingTargetPlan, readers: FundingHoldingReaders): DirectFundingReads {
  const observed = <T,>(running: Promise<T>): Promise<T> => { running.catch(() => undefined); return running; };
  return {
    ...(direct.federal ? { federal: observed(Promise.resolve().then(() => readers.federal())) } : {}),
    ...(direct.state ? { state: observed(Promise.resolve().then(() => readers.state(direct.state!))) } : {}),
    ...(direct.azIdentity ? { azIdentity: observed(Promise.resolve().then(() => readers.azIdentity())) } : {}),
  };
}

/** Read only the authorities applicable to this target and settle them independently. */
export async function settleFundingHoldingAnswer(
  target: string,
  readers: FundingHoldingReaders = defaultReaders,
  started?: DirectFundingReads,
): Promise<FundingHoldingSettlement> {
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
  const azIdentityPromise = plan.azIdentity
    ? early.azIdentity ?? Promise.resolve().then(() => readers.azIdentity())
    : Promise.resolve(null);
  const [federalResult, stateResult, azIdentityResult] = await Promise.allSettled([
    federalPromise,
    statePromise,
    azIdentityPromise,
  ]);

  const unavailableAuthorities: string[] = [];
  if (identityResult.status === "rejected") unavailableAuthorities.push("PERSON_IDENTITY");
  if (plan.federal && federalResult.status === "rejected") unavailableAuthorities.push("FEC_FUNDING");
  if (plan.state && stateResult.status === "rejected") unavailableAuthorities.push(`STATE_CAMPAIGN_FINANCE:${plan.state}`);
  if (plan.azIdentity && azIdentityResult.status === "rejected") unavailableAuthorities.push("AZ_CANDIDACY_IDENTITY");

  const federalHeld = plan.federal && federalResult.status === "fulfilled" && federalResult.value !== null;
  const stateHeld = plan.state !== null
    && stateResult.status === "fulfilled"
    && stateResult.value !== null
    && (!plan.azIdentity || azIdentityResult.status === "fulfilled");
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
