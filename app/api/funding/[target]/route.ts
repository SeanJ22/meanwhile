import { directFundingTargetPlan, stateFromContest, FEDERAL_CONTEST, type FundingTargetPlan } from "@/lib/funding/target-authorities";
import { campaignMoneyApiAnswer, type CampaignMoneyApiAnswer } from "@/lib/funding/campaign-money";
import { settleFundingSnapshotRead } from "@/lib/funding/snapshot";
import {
  settleStateMoneyRead,
  stateMoneyForTarget,
} from "@/lib/funding/state-snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { readGenericBallotProjection } from "@/lib/ballot/generic-projection";
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
  readonly ballotIdentity: () => Promise<void>;
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
  // The registry and the federal directory are served from the reader authority
  // edge when this request entered one (GET below), the database otherwise:
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
    ballotIdentity: target.includes("|"),
  };
}

function defaultReadersFor(timings?: ReadTimings): FundingHoldingReaders {
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
    ballotIdentity: () => timedRead(timings, "ballots", async () => { promotedVersionOrThrow(await readGenericBallotProjection()); }),
    answer: (target, contestId, selection) => campaignMoneyApiAnswer(target, contestId, selection),
  };
}

const defaultReaders: FundingHoldingReaders = defaultReadersFor();

/** Reads a target's own id already decides; none of them reads the authority edge. */
export interface DirectFundingReads {
  readonly federal?: ReturnType<FundingHoldingReaders["federal"]>;
  readonly state?: ReturnType<FundingHoldingReaders["state"]>;
  readonly ballotIdentity?: ReturnType<FundingHoldingReaders["ballotIdentity"]>;
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
    ...(direct.ballotIdentity ? { ballotIdentity: observed(Promise.resolve().then(() => readers.ballotIdentity())) } : {}),
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
  /*
   * The edge is entered here, before any money is read, in this handler's own execution:
   * `AsyncLocalStorage.enterWith` never reaches reads chained on a helper that entered it.
   */
  const direct = directFundingTargetPlan(target);
  const manifest = await timedRead(timings, "edgeManifest", () => readReaderManifest().catch(() => null));
  const onEdge = (family: AuthorityFamily) => Boolean(manifest?.authorityArtifacts?.[family]);
  const fromDatabase = startDirectFundingReads({
    ...direct,
    federal: direct.federal && !onEdge("federal-funding"),
    state: onEdge("state-money") ? null : direct.state,
    ballotIdentity: direct.ballotIdentity && !onEdge("ballot-contests"),
  }, readers);
  if (manifest?.authorityArtifacts) {
    const edge = await timedRead(timings, "authorityEdge", () => ensureReaderAuthorityEdge(manifest, undefined, READER_FUNDING_AUTHORITY_FAMILIES).catch(() => null));
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const fromEdge = startDirectFundingReads({
    ...direct,
    federal: direct.federal && fromDatabase.federal === undefined,
    state: fromDatabase.state === undefined ? direct.state : null,
    ballotIdentity: direct.ballotIdentity && fromDatabase.ballotIdentity === undefined,
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
