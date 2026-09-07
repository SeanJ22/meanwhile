/**
 * **THE EXECUTION DECISION, WIRED TO THE THINGS THAT ACTUALLY DECIDE IT.**
 * (ACLOSE-2, closing the seam `admin-config.ts` named as `READY_FOR_NEXT_PASS`.)
 *
 * `chooseExecutionPath` has always been the one function that decides whether
 * money gets spent, and `apiFallbackPolicy` has always been the one reader of
 * the owner's durable setting. What did not exist was anything that called
 * them on the path a job actually takes: the setting could be recorded and it
 * permitted nothing, in either direction. This module is that call.
 *
 * ## The order, which is the law and not a preference
 *
 *   1. A working subscription always wins. It costs nothing beyond the
 *      subscription the owner already pays for, so there is never a reason to
 *      prefer a billed path over it.
 *   2. With no working subscription and the owner's setting OFF, the job is
 *      REFUSED. Nothing is sent, nothing is charged, and the receipt says so in
 *      those words. **This is the branch that runs by default and after every
 *      restart and every deploy**, because `defaultAdminConfig()` is `enabled:
 *      false` and `apiFallbackPolicy` reads an absent, unreachable or corrupt
 *      config as OFF.
 *   3. Only with the setting explicitly and durably ON may a paid adapter be
 *      selected — and only for a provider that HAS one, with its credential
 *      present and its spend ceiling not already reached.
 *
 * ## Why a provider can be ON and still refuse
 *
 * "The owner allowed paid spending" is not "this provider can be billed". This
 * repository has one governed model-call seam — the Anthropic Messages
 * transport the Scout executor uses — and it speaks to exactly one of the two
 * providers. There is no governed OpenAI client here, so CODEX_SUBSCRIPTION has
 * no paid path to fall through to, and the honest answer when its subscription
 * is unavailable is a refusal that says why. Inventing an API client so a
 * toggle would look symmetrical is the thing §4 warns about: it would make the
 * console claim a capability the machine does not have.
 *
 * ## What is deliberately NOT decided here
 *
 * Whether to spend is decided here; HOW to spend is the adapter's. The adapter
 * is injected ({@link PaidRunner}) because a module that both decided to bill
 * and did the billing could not be tested for the OFF case without a network
 * stub standing in for the thing under test.
 */
import { costEntryFromAttempt } from "../cost.ts";
import { type AdminConfig } from "../gateway/admin-config.ts";
import {
  apiFallbackPolicy,
  chooseExecutionPath,
  PROVIDER_WORDS,
  type AgentProviderId,
  type ApiFallbackPolicy,
  type ExecutionChoice,
  type ProviderProbe,
} from "./provider.ts";
import {
  completeJob,
  failJob,
  openJob,
  persistJob,
  refuseJob,
  type AgentJobLog,
  type AgentMode,
  type AllowedReach,
  type DelegatedAgentJob,
  type FrozenContext,
} from "./job.ts";

/* -------------------------------------------------- is the subscription up */

export interface SubscriptionReading {
  readonly can: boolean;
  /** One plain sentence: why it can or cannot. */
  readonly why: string;
}

/**
 * Can this provider's SUBSCRIPTION take a job right now, from what the probe
 * actually observed?
 *
 * Three independent facts, and all three are required. A launcher that resolves
 * is not a launcher that starts (it may be a stale shim); a launcher that
 * starts is not a signed-in subscription (it may be freshly installed). The
 * probe keeps them apart deliberately, so this reads all three rather than
 * inferring any from another.
 */
export function subscriptionCanTake(probe: ProviderProbe): SubscriptionReading {
  const name = PROVIDER_WORDS[probe.provider].name;
  if (!probe.launcher.found) {
    return { can: false, why: `${name} is not installed anywhere this machine can start it.` };
  }
  if (!probe.version.asked || probe.version.printed === null) {
    return { can: false, why: `${name} is installed but did not start when asked its version${probe.version.why === null ? "." : `: ${probe.version.why}`}` };
  }
  if (!probe.home.savedSignIn) {
    return { can: false, why: `${name} starts on this machine but nobody has signed in to it here.` };
  }
  return { can: true, why: `${name} is installed, starts, and has a saved sign-in on this machine.` };
}

/* ------------------------------------------------------------ paid adapter */

/** What a paid run reports back. Usage is required: an unpriced call cannot be metered. */
export interface PaidRunOutcome {
  readonly raw: string;
  readonly usd: number;
  readonly model: string;
}

/** The one shape a paid runner may have. Injected, never constructed here. */
export type PaidRunner = (input: { readonly prompt: string; readonly wallMs: number }) => Promise<PaidRunOutcome>;

/**
 * Which providers this repository has a GOVERNED paid adapter for at all.
 *
 * Closed, and a literal rather than a lookup, because "does a paid path exist"
 * is a fact about this codebase and not about the environment. The credential
 * and the ceiling are checked separately: having an adapter, having a key and
 * being under the cap are three different reasons a paid run may not happen,
 * and collapsing them produces a card that says the wrong thing.
 */
export const PAID_ADAPTER_EXISTS: Readonly<Record<AgentProviderId, boolean>> = Object.freeze({
  CLAUDE_CODE_SUBSCRIPTION: true,
  CODEX_SUBSCRIPTION: false,
});

/** Why a provider has no paid path, in the owner's words. */
export function noPaidAdapterReason(provider: AgentProviderId): string {
  return (
    `${PROVIDER_WORDS[provider].name} has no paid API path in this system. Paid spending is allowed, but ` +
    "there is no governed client here that could bill this provider, so the job is refused rather than " +
    "quietly handed to something unmetered."
  );
}

export interface PaidReadiness {
  readonly ready: boolean;
  readonly why: string;
}

/**
 * Is a paid run actually possible for this provider right now?
 *
 * `credentialPresent` is a BOOLEAN the caller computed by reading a variable by
 * name. The value never enters this module, is never returned, and is never
 * placed in a record — presence is the only fact a policy needs.
 */
export function paidReadiness(
  provider: AgentProviderId,
  credentialPresent: boolean,
  ceiling: { readonly permits: boolean; readonly why: string },
): PaidReadiness {
  if (!PAID_ADAPTER_EXISTS[provider]) return { ready: false, why: noPaidAdapterReason(provider) };
  if (!credentialPresent) {
    return {
      ready: false,
      why:
        `${PROVIDER_WORDS[provider].name} has a paid API path, but no API credential is configured on this ` +
        "machine, so nothing could be billed even though you have allowed it.",
    };
  }
  if (!ceiling.permits) {
    return { ready: false, why: `Paid spending is allowed, and the spend ceiling stops this one: ${ceiling.why}.` };
  }
  return { ready: true, why: `${PROVIDER_WORDS[provider].name} may fall through to its paid API for this job, and it will be billed and recorded.` };
}

/* ------------------------------------------------------------ the decision */

export interface ExecutionInput {
  readonly provider: AgentProviderId;
  readonly probe: ProviderProbe;
  /** The durable owner setting, exactly as read from the control plane. Null reads as OFF. */
  readonly config: AdminConfig | null;
  readonly credentialPresent: boolean;
  readonly ceiling: { readonly permits: boolean; readonly why: string };
}

export interface LiveExecutionChoice {
  readonly choice: ExecutionChoice;
  readonly fallback: ApiFallbackPolicy;
  readonly subscription: SubscriptionReading;
  /** Set only when the path came out PAID_API and then could not actually be taken. */
  readonly paid: PaidReadiness | null;
}

/**
 * THE runner-side execution decision. One function, wired to the durable
 * setting, the real probe, the real credential presence and the real ceiling.
 *
 * A `PAID_API` answer from `chooseExecutionPath` is a permission, not a
 * capability, so it is re-tested against {@link paidReadiness} here and
 * downgraded to a REFUSE that says which of the three reasons applied. The
 * downgrade only ever moves toward refusing: nothing in this function can turn
 * a REFUSE into a spend.
 */
export function liveExecutionChoice(input: ExecutionInput): LiveExecutionChoice {
  const fallback = apiFallbackPolicy(input.config);
  const subscription = subscriptionCanTake(input.probe);
  const name = PROVIDER_WORDS[input.provider].name;
  const choice = chooseExecutionPath(subscription.can, fallback, name);
  if (choice.path !== "PAID_API") {
    return { choice, fallback, subscription, paid: null };
  }
  const paid = paidReadiness(input.provider, input.credentialPresent, input.ceiling);
  if (paid.ready) return { choice, fallback, subscription, paid };
  return {
    choice: { path: "REFUSE", says: `${subscription.why} ${paid.why}`, blocker: "EXTERNAL" },
    fallback,
    subscription,
    paid,
  };
}

/* --------------------------------------------------------- the single job */

/** What one bounded, one-provider job needs. The same fields a review seat gets. */
export interface SingleJobInput {
  readonly mode: Extract<AgentMode, "GPT" | "CLAUDE">;
  readonly provider: AgentProviderId;
  readonly context: FrozenContext;
  readonly scope: string;
  readonly allowed: AllowedReach;
  readonly requestedOutput: string;
  readonly idempotencyKey: string;
  /** The exact question, already composed. This module never assembles a command. */
  readonly prompt: string;
  readonly wallMs: number;
}

export interface SingleJobDeps {
  readonly log: AgentJobLog;
  readonly now: () => string;
  /** The wired decision for this provider. */
  readonly pathFor: (provider: AgentProviderId) => ExecutionChoice;
  /** Run it on the subscription. The only implementation lives in `run-host.ts`. */
  readonly runSubscription: (input: { readonly provider: AgentProviderId; readonly prompt: string; readonly wallMs: number }) => Promise<string>;
  /** Run it on a metered API. Absent for a provider with no governed adapter. */
  readonly runPaid?: PaidRunner;
  /** Append a priced entry to the cost ledger. Required whenever `runPaid` is. */
  readonly recordSpend?: (outcome: PaidRunOutcome, job: DelegatedAgentJob) => Promise<void>;
}

export interface SingleJobOutcome {
  readonly job: DelegatedAgentJob;
  readonly raw: string | null;
  /** What this job cost. Zero on the subscription path, and stated rather than omitted. */
  readonly usd: number;
  readonly path: ExecutionChoice["path"];
}

/**
 * Run ONE bounded job on ONE provider through the canonical record path.
 *
 * The record path is the same one `runOneSeat` uses — `openJob` → `persistJob`
 * → (`completeJob` | `refuseJob` | `failJob`) → `persistJob` — so a job started
 * here is indistinguishable in the log from a job started by a review, and the
 * console reads both with the same code. A refusal is persisted exactly like a
 * completion, because "we did not do this, and here is why" is a result.
 */
export async function runSingleJob(deps: SingleJobDeps, input: SingleJobInput): Promise<SingleJobOutcome> {
  const startedAt = deps.now();
  const job = openJob({
    mode: input.mode,
    role: "SINGLE",
    provider: input.provider,
    context: input.context,
    scope: input.scope,
    authority: "READ_ONLY",
    allowed: input.allowed,
    requestedOutput: input.requestedOutput,
    startedAt,
    idempotencyKey: input.idempotencyKey,
  });
  await persistJob(deps.log, job, startedAt);

  const choice = deps.pathFor(input.provider);

  /*
   * FAIL CLOSED ON A PATH THIS FUNCTION DOES NOT RECOGNISE.
   *
   * Found by the Codex reviewer on the first real ACLOSE-3 job against these
   * exact bytes, and it was right: this used to handle REFUSE and PAID_API and
   * let EVERYTHING ELSE fall through to `runSubscription`. `ExecutionChoice` is
   * a TypeScript type and `pathFor` is an injected function — the union is not
   * checked at runtime, so a caller (or a later member added to
   * `EXECUTION_PATHS`) could hand this an unrecognised classification and get
   * execution, reported as `SUBSCRIPTION`.
   *
   * §3.6 says an unclassified action fails closed. An allowlist of the two
   * paths that may run is that rule, written where it is enforced rather than
   * implied by the order of two `if`s.
   */
  if (choice.path !== "REFUSE" && choice.path !== "SUBSCRIPTION" && choice.path !== "PAID_API") {
    const at = deps.now();
    const refused = refuseJob(
      job,
      {
        code: "AGENT_EXECUTION_PATH_UNCLASSIFIED",
        says:
          `The bridge could not classify how this job would run (${String(choice.path)}), so it did not run it. ` +
          "Nothing was sent and nothing was charged.",
      },
      at,
    );
    await persistJob(deps.log, refused, at);
    return { job: refused, raw: null, usd: 0, path: "REFUSE" };
  }

  if (choice.path === "REFUSE") {
    const at = deps.now();
    const refused = refuseJob(job, { code: "AGENT_PROVIDER_UNAVAILABLE", says: choice.says }, at);
    await persistJob(deps.log, refused, at);
    return { job: refused, raw: null, usd: 0, path: "REFUSE" };
  }

  if (choice.path === "PAID_API" && (deps.runPaid === undefined || deps.recordSpend === undefined)) {
    // Belt and braces against a caller that decided PAID_API and supplied no
    // way to bill or to record it. A paid path with no ledger entry is an
    // unmetered spend, and this refuses rather than becoming one.
    const at = deps.now();
    const refused = refuseJob(
      job,
      {
        code: "AGENT_PAID_PATH_UNMETERED",
        says: noPaidAdapterReason(input.provider),
      },
      at,
    );
    await persistJob(deps.log, refused, at);
    return { job: refused, raw: null, usd: 0, path: "REFUSE" };
  }

  try {
    if (choice.path === "PAID_API") {
      const outcome = await deps.runPaid!({ prompt: input.prompt, wallMs: input.wallMs });
      /*
       * ONCE THE CALL HAS HAPPENED, THE MONEY IS SPENT — AND THE RECORD MUST SAY
       * SO EVEN IF THE LEDGER WRITE IS THE THING THAT FAILED.
       *
       * Found by the Claude Code reviewer on the ACLOSE-3 job against these
       * bytes: `recordSpend` used to sit inside the outer `try` immediately
       * after the call, so a throw from the LEDGER dropped through to the catch
       * and the job was recorded FAILED with `usd: 0`. The API had already
       * billed. "The log says the job failed and cost nothing" is the exact
       * shape of a false claim about money, and it is worse than the unmetered
       * spend the guard above refuses, because it is an unmetered spend that
       * also denies itself.
       *
       * So the ledger write gets its own boundary: a failure there does not
       * unspend the money, so it does not un-report it either.
       */
      let ledger: string | null = null;
      try {
        await deps.recordSpend!(outcome, job);
      } catch (error) {
        ledger =
          `The paid call was made and billed $${outcome.usd.toFixed(2)}, and writing it to the cost ledger failed ` +
          `(${(error as Error)?.message ?? "error"}). The spend is real; the ledger is short by this entry.`;
      }
      const at = deps.now();
      const done = completeJob(
        job,
        {
          says: ledger === null ? `Answered on the paid API (${outcome.model}).` : `Answered on the paid API (${outcome.model}). ${ledger}`,
          detail: outcome.raw,
          reviewedHash: input.context.hash,
        },
        at,
      );
      await persistJob(deps.log, done, at);
      return { job: done, raw: outcome.raw, usd: outcome.usd, path: "PAID_API" };
    }
    const raw = await deps.runSubscription({ provider: input.provider, prompt: input.prompt, wallMs: input.wallMs });
    const at = deps.now();
    const done = completeJob(
      job,
      {
        says: `Answered on ${PROVIDER_WORDS[input.provider].paidBy}. Nothing was charged.`,
        detail: raw,
        reviewedHash: input.context.hash,
      },
      at,
    );
    await persistJob(deps.log, done, at);
    return { job: done, raw, usd: 0, path: "SUBSCRIPTION" };
  } catch (error) {
    const at = deps.now();
    /*
     * A FAILURE ON THE PAID PATH CANNOT CLAIM NOTHING WAS SPENT.
     *
     * The narrower half of the finding above, which the reviewer raised against
     * the already-fixed bytes and was still right about: wrapping `recordSpend`
     * only covers a throw from the LEDGER. If `runPaid` itself throws — the
     * request went out, the provider billed it, and the response failed to
     * parse — we genuinely do not know whether money moved. Saying `$0.00`
     * there is a claim, and it is the one direction a spending record must
     * never guess in.
     *
     * So a failure on the paid path says it cannot tell. `usd` stays 0 because
     * an invented number would be worse, and the sentence carries what the
     * number cannot.
     */
    const words = PROVIDER_WORDS[input.provider].name;
    const why =
      choice.path === "PAID_API"
        ? `${words} started this job on the paid API and did not finish it (${(error as Error)?.message ?? "error"}). ` +
          "We cannot tell from here whether that call was billed, so this is not a claim that it cost nothing."
        : `${words} started this job and did not finish it (${(error as Error)?.message ?? "error"}).`;
    const failed = failJob(job, why, at);
    await persistJob(deps.log, failed, at);
    return { job: failed, raw: null, usd: 0, path: choice.path };
  }
}

/** Re-exported so a caller composing a paid runner has one import for the ledger shape. */
export { costEntryFromAttempt };
