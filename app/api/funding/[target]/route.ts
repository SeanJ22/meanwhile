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
import { ensureReaderAuthorityEdge, READER_FUNDING_AUTHORITY_FAMILIES, readReaderManifest } from "@/lib/meetings/edge-serving";
import type { AuthorityFamily } from "@/lib/meetings/edge-artifacts";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { mayUseTestFixture, promotedVersionOrThrow, type CivicDataReadMetadata } from "@/lib/civic-data/read-model";

export { directFundingTargetPlan, type FundingTargetPlan } from "@/lib/funding/target-authorities";

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

/** Each read is timed by name and reported in the `Server-Timing` header. */
type ReadTimings = Record<string, number>;

function timedRead<T>(timings: ReadTimings | undefined, name: string, read: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const running = Promise.resolve().then(read);
  if (!timings) return running;
  return running.finally(() => { timings[name] = Date.now() - started; });
}

async function currentFundingTargetPlan(target: string, timings?: ReadTimings): Promise<FundingTargetPlan> {
  const direct = directFundingTargetPlan(target);
  if ((direct.federal || direct.state !== null) && !target.startsWith("congress:") && !target.includes("|")) return direct;

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

function defaultReadersFor(timings?: ReadTimings): FundingHoldingReaders {
  return {
    identityPlan: (target) => currentFundingTargetPlan(target, timings),

    federal: () => timedRead(timings, "fec", async () => {
      const result = await settleFundingSnapshotRead();
      if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") throw new Error(result.detail);
      return { kind: result.kind, metadata: result.metadata };
    }),
    state: (state) => timedRead(timings, `stateMoney_${state}`, async () => {
      const result = await settleStateMoneyRead(state);
      if (result.kind === "PROMOTED") return { kind: "PROMOTED" as const, metadata: result.metadata };

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

  const timings: ReadTimings = {};
  const startedAt = Date.now();
  const readers = defaultReadersFor(timings);

  const direct = directFundingTargetPlan(target);
  const manifest = await timedRead(timings, "edgeManifest", () => readReaderManifest().catch(() => null));
  let authorityEdge: Awaited<ReturnType<typeof ensureReaderAuthorityEdge>> | null = null;
  if (manifest) {
    const edge = await timedRead(timings, "authorityEdge", () => ensureReaderAuthorityEdge(manifest, undefined, READER_FUNDING_AUTHORITY_FAMILIES, [direct.state ?? /^ballot-([a-z]{2})-/.exec(target)?.[1]].filter((state): state is string => Boolean(state))).catch(() => null));
    authorityEdge = edge;
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const onEdge = (family: AuthorityFamily) => Boolean(manifest?.authorityArtifacts?.[family] || authorityEdge?.promotedFamilies?.has(family));
  const fromDatabase = startDirectFundingReads({
    ...direct,
    federal: direct.federal && !onEdge("federal-funding"),
    state: onEdge("state-money") ? null : direct.state,
    azIdentity: direct.azIdentity && !onEdge("ballot-az"),
  }, readers);
  const fromEdge = startDirectFundingReads({
    ...direct,
    federal: direct.federal && fromDatabase.federal === undefined,
    state: fromDatabase.state === undefined ? direct.state : null,
    azIdentity: direct.azIdentity && fromDatabase.azIdentity === undefined,
  }, readers);
  const settled = await settleFundingHoldingAnswer(target, readers, { ...fromDatabase, ...fromEdge });
  timings.total = Date.now() - startedAt;
  const serverTiming = Object.entries(timings).map(([name, ms]) => `${name};dur=${ms}`).join(", ");
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json(
      { error: "funding data unavailable", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: settled.unavailableAuthorities },
      { status: 503, headers: { "server-timing": serverTiming } },
    );
  }
  return Response.json({
    ...settled.answer,
    dataState: settled.dataState,
    dataMetadata: settled.dataMetadata,
    holdingStatus: settled.holdingStatus,
    unavailableAuthorities: settled.unavailableAuthorities,
  }, {
    headers: {
      "server-timing": serverTiming,
      "cache-control": settled.holdingStatus === "HELD"
        && settled.dataState === "PROMOTED"
        && settled.dataMetadata?.stale === "CURRENT"
        ? "public, max-age=3600"
        : "private, no-store",
    },
  });
}
