import { directFundingTargetPlan, stateFromContest, FEDERAL_CONTEST, type FundingTargetPlan } from "@/lib/funding/target-authorities";
import { campaignMoneyApiAnswer, type CampaignMoneyApiAnswer } from "@/lib/funding/campaign-money";
import { readFundingSnapshot } from "@/lib/funding/snapshot";
import {
  refreshStateMoneyProjectionFromPromoted,
  stateMoneyForTarget,
} from "@/lib/funding/state-snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { refreshAzBallotFromPromoted } from "@/lib/civic-data/manual-read-models";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import {
  getRegistryRuntimeReadModel,
  refreshRegistryRuntimeFromPromoted,
} from "@/lib/registry/runtime-read-model";
import { mayUseTestFixture, type CivicDataReadMetadata } from "@/lib/civic-data/read-model";

export { directFundingTargetPlan, type FundingTargetPlan } from "@/lib/funding/target-authorities";

/**
 * GET /api/funding/<app-side id> — the funding answer for one exact target.
 * The target is selected before a store is opened. Federal, state, and
 * identity holdings settle independently; one failed authority cannot erase
 * a source-linked answer from another and no tracked data is a runtime
 * fallback.
 */

export const runtime = "nodejs";

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

async function currentFundingTargetPlan(target: string): Promise<FundingTargetPlan> {
  await refreshRegistryRuntimeFromPromoted();
  const direct = directFundingTargetPlan(target);
  const related = getRegistryRuntimeReadModel().officialCandidacies.rows.filter((row) =>
    row.holder.id === target || row.candidacy?.candidacyId === target,
  );
  if (related.some((row) => row.holder.authority === "FEDERAL_DIRECTORY")) {
    await refreshFederalDirectoryFromPromoted();
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
    azIdentity: state === "AZ",
  };
}

const defaultReaders: FundingHoldingReaders = {
  identityPlan: currentFundingTargetPlan,
  federal: async () => {
    const result = await readFundingSnapshot();
    if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") throw new Error(result.detail);
    return { kind: result.kind, metadata: result.metadata };
  },
  state: async (state) => {
    const result = await refreshStateMoneyProjectionFromPromoted(state);
    if (result.kind === "PROMOTED") return { kind: "PROMOTED", metadata: result.metadata };
    // Deterministic tests can install the explicit fixture behind the exact
    // state cache. Touching a made-up key verifies that exact cache without
    // manufacturing a record or opening a sibling state.
    if (mayUseTestFixture()) {
      stateMoneyForTarget(`ballot-${state.toLowerCase()}-fixture-probe:contest:candidate`);
      return { kind: "BOOTSTRAP", metadata: null };
    }
    throw new Error(result.detail);
  },
  azIdentity: async () => { await refreshAzBallotFromPromoted(); },
  answer: (target, contestId, selection) => campaignMoneyApiAnswer(target, contestId, selection),
};

/** Read only the authorities applicable to this target and settle them independently. */
export async function settleFundingHoldingAnswer(
  target: string,
  readers: FundingHoldingReaders = defaultReaders,
): Promise<FundingHoldingSettlement> {
  const direct = directFundingTargetPlan(target);
  const [identityResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.identityPlan(target)),
  ]);
  const plan = identityResult.status === "fulfilled" ? identityResult.value : direct;

  const federalPromise = plan.federal
    ? Promise.resolve().then(() => readers.federal())
    : Promise.resolve(null);
  const statePromise = plan.state
    ? Promise.resolve().then(() => readers.state(plan.state!))
    : Promise.resolve(null);
  const azIdentityPromise = plan.azIdentity
    ? Promise.resolve().then(() => readers.azIdentity())
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ target: string }> },
) {
  let target: string;
  try { target = decodeURIComponent((await params).target); }
  catch { return Response.json({ error: "invalid target encoding" }, { status: 400 }); }
  if (!target || target.length > 512) {
    return Response.json({ error: "target must contain 1–512 characters" }, { status: 400 });
  }

  const settled = await settleFundingHoldingAnswer(target);
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({ error: "funding data unavailable", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: settled.unavailableAuthorities }, { status: 503 });
  }
  return Response.json({
    ...settled.answer,
    dataState: settled.dataState,
    dataMetadata: settled.dataMetadata,
    holdingStatus: settled.holdingStatus,
    unavailableAuthorities: settled.unavailableAuthorities,
  }, {
    headers: {
      "cache-control": settled.holdingStatus === "HELD"
        && settled.dataState === "PROMOTED"
        && settled.dataMetadata?.stale === "CURRENT"
        ? "public, max-age=3600"
        : "private, no-store",
    },
  });
}
