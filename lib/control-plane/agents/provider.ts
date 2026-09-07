/**
 * **THE SUBSCRIPTION-FIRST AGENT BRIDGE — what a provider IS, and what we can
 * honestly say we know about it.** (ADM-C8; §4 and §3.4 of the Admin C brief,
 * 2026-09-06.)
 *
 * Sean pays for a ChatGPT/Codex subscription and a Claude subscription, and the
 * whole point of this bridge is that delegated work rides those subscriptions
 * rather than a metered API key. Two consequences run through every line here.
 *
 * ## 1. Paid API fallback is OFF, and stays OFF across a deploy
 *
 * §4: *"API fallback is OFF by default. Do not silently send work to paid API
 * endpoints when a subscription path is exhausted."* So this module reads NO
 * environment variable — a variable is exactly the thing that would quietly
 * come back ON after a restart, or differ between the runner and the deploy.
 * The only way the paid path opens is an owner setting durably recorded in the
 * `adminConfig` aggregate, and anything that is not literally `true` there is
 * OFF ({@link apiFallbackPolicy} fails closed on a string, a number, a missing
 * record and an unreachable store alike). {@link chooseExecutionPath} is the
 * one function that may return `PAID_API`, and it says why in the owner's
 * words every time it does not.
 *
 * ## 2. Detection is measured, never assumed
 *
 * §3.4 forbids the dishonest shortcut — no iframing ChatGPT or Claude, no
 * scraping a logged-in consumer site, no storing or replaying browser cookies,
 * no automating a consumer web session. "Subscription-first" means the
 * supported local, subscription-authenticated Codex / Claude Code execution
 * paths, and the honest question about those is: *can this machine actually
 * start one?* Three separate facts answer it, and they are separate because
 * they fail separately:
 *
 * ```
 *   launcher   the program resolves on this host's PATH        → it can start
 *   saved      the provider's home directory holds a sign-in   → someone signed in here
 *   answered   the program printed its version when asked      → it really starts
 * ```
 *
 * None of the three proves the subscription is currently good — only running a
 * job proves that — so {@link describeProvider} never reports `authenticated:
 * true`. The best any of them earns is `SIGNED_IN_UNVERIFIED`: *a saved
 * sign-in is on this machine; whether it is still good is only known when a job
 * runs*. The credential file's PRESENCE is the whole observation; its bytes are
 * never read and never travel.
 *
 * And the observation point matters more than any of it. The deployed console
 * is a Netlify function: no PATH, no home directory, no process table, nothing
 * of the runner machine at all. A reachability claim made from there would be
 * invented, so {@link unobservedFromWeb} refuses to make one and classifies the
 * provider `EXTERNAL` with a named gap, per the brief's honesty requirement.
 *
 * PURE except for {@link probeProvider}, which takes its host as an injected
 * {@link ProbeHost}. Nothing here reads the clock, the store or the environment
 * for itself, and nothing here accepts a command string from anyone — the argv
 * a probe runs comes from the frozen {@link LAUNCHERS} table, keyed by a
 * provider id, which is what keeps §3.1 (no arbitrary shell) true by
 * construction rather than by review.
 */

import {
  API_FALLBACK_ENFORCEMENT,
  API_FALLBACK_MISSING_SEAM,
  isAdminConfig,
  type AdminConfig,
} from "../gateway/admin-config.ts";
import { gap, held, measured, type Held, type Measured } from "../owner-surface.ts";

/* ------------------------------------------------------------- providers */

/** The two canonical provider types (§4). There is no third, and no API-key provider. */
export const AGENT_PROVIDERS = ["CODEX_SUBSCRIPTION", "CLAUDE_CODE_SUBSCRIPTION"] as const;
export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return typeof value === "string" && (AGENT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * What each provider is called on the owner's page, and what it is.
 *
 * A per-surface wording table, the way `app/(admin)/fleet-wording.ts` carries
 * the fleet's. `plainCode` would render `CLAUDE_CODE_SUBSCRIPTION` as "Claude
 * code subscription", which is the machine constant with the underscores taken
 * out rather than the thing's name.
 */
export interface ProviderWords {
  /** The name on the card. */
  readonly name: string;
  /** Which subscription pays for it, in the owner's terms. */
  readonly paidBy: string;
  /** One sentence: what this provider is good for. */
  readonly usedFor: string;
}

export const PROVIDER_WORDS: Readonly<Record<AgentProviderId, ProviderWords>> = {
  CODEX_SUBSCRIPTION: {
    name: "Codex",
    paidBy: "your ChatGPT subscription",
    usedFor: "Reading code and answering questions about it — a second opinion on a change, a review, an architecture question.",
  },
  CLAUDE_CODE_SUBSCRIPTION: {
    name: "Claude Code",
    paidBy: "your Claude subscription",
    usedFor: "Bounded work inside the repository — reading it, and writing a change on a branch that still goes through every usual check.",
  },
};

/* ---------------------------------------------------------------- bounds */

/**
 * What a delegated job may cost in time and size. Bounded and typed (§4:
 * *"Do not build a general-purpose remote shell disguised as AI delegation"*).
 *
 * One job per provider at a time is deliberate: a subscription is one seat, and
 * a queue that fans out across a seat is a queue that gets rate-limited and
 * then reads as a provider outage.
 */
export const AGENT_BOUNDS = {
  /** One seat, one job. The second job waits. */
  maxConcurrentJobsPerProvider: 1,
  /** A job that has not finished in this long is abandoned, not extended. */
  maxJobWallMs: 15 * 60_000,
  /** The frozen context handed to a job. Bigger than this is a different job. */
  maxContextBytes: 256_000,
} as const;

/* -------------------------------------------------------- the observation */

/**
 * Where the reading was taken. This is the single most load-bearing field on a
 * provider card, because it decides which claims are even askable.
 */
export const OBSERVATION_POINTS = ["RUNNER_HOST", "WEB_FUNCTION"] as const;
export type ObservationPoint = (typeof OBSERVATION_POINTS)[number];

/** What one probe of one provider on one machine actually observed. */
export interface ProviderProbe {
  readonly provider: AgentProviderId;
  readonly observedFrom: ObservationPoint;
  readonly observedAt: string;
  /** Did the launcher resolve on this host, and where. Resolving never runs it. */
  readonly launcher: { readonly found: boolean; readonly at: string | null };
  /** The provider's home directory, and whether a saved sign-in file sits in it. Presence only. */
  readonly home: { readonly present: boolean; readonly savedSignIn: boolean };
  /** What the launcher printed when asked its version — the only proof it starts. */
  readonly version: { readonly asked: boolean; readonly printed: string | null; readonly why: string | null };
}

/** How sure we are that a signed-in subscription is behind this provider. */
export const AUTHENTICATION_READINGS = ["SIGNED_IN_UNVERIFIED", "NO_SAVED_SIGN_IN", "CANNOT_TELL_FROM_HERE"] as const;
export type AuthenticationReading = (typeof AUTHENTICATION_READINGS)[number];

/** Why an unavailable provider is unavailable, in the canonical blocker vocabulary (§3.9). */
export type ProviderBlocker = "OWNER_GATED" | "EXTERNAL" | null;

/** Busy or idle — derived from work in flight, never stored. */
export type ProviderOccupancy = "BUSY" | "IDLE";

/** The last thing this provider was asked to do, as the card shows it. */
export interface LatestTask {
  readonly jobId: string;
  readonly says: string;
  readonly at: string;
  readonly outcome: string;
}

/** The last thing that went wrong, in the owner's words, with the machine text kept for the hover. */
export interface LatestError {
  readonly at: string;
  readonly says: string;
  readonly raw: string;
}

/**
 * One provider, as the console renders it. Every one of the eight fields ADM-C8
 * names is here, and every one that cannot be measured from where the reading
 * was taken is a named gap rather than a comfortable default.
 */
export interface AgentProviderDescriptor {
  readonly provider: AgentProviderId;
  readonly name: string;
  readonly observedFrom: ObservationPoint;
  readonly observedAt: string;
  readonly configured: Held<boolean>;
  readonly reachable: Held<boolean>;
  readonly authenticated: Held<AuthenticationReading>;
  /** Free seats of total seats. A denominator, always. */
  readonly capacity: Held<Measured>;
  readonly occupancy: Held<ProviderOccupancy>;
  readonly latestTask: Held<LatestTask>;
  readonly latestError: Held<LatestError>;
  readonly fallbackPolicy: ApiFallbackPolicy;
  readonly blocker: ProviderBlocker;
  /** Can a job actually be started on the subscription path right now? */
  readonly canRunNow: boolean;
  /** One plain sentence: what happened. */
  readonly happened: string;
  /** One plain sentence: what happens next. */
  readonly next: string;
  /** Does this need the owner, and what should he do. */
  readonly needsYou: boolean;
  readonly needsYouAction: string | null;
}

/* ---------------------------------------------------------- the launchers */

/**
 * The CLOSED table of what each provider is launched as. A probe takes a
 * provider id and looks its argv up here; there is no parameter anywhere in
 * this module through which owner text, chat text or agent text could become a
 * command. That is §3.1 held by construction.
 */
export interface LauncherSpec {
  /** The program name resolved on PATH. */
  readonly launcher: string;
  /** The one frozen argv a probe may run. Asks a version and nothing else. */
  readonly versionArgv: readonly string[];
  /** The provider's home directory, relative to the host's home. */
  readonly homeDirName: string;
  /** The file whose PRESENCE means someone signed in on this machine. Never read. */
  readonly savedSignInFile: string;
}

export const LAUNCHERS: Readonly<Record<AgentProviderId, LauncherSpec>> = {
  CODEX_SUBSCRIPTION: Object.freeze({
    launcher: "codex",
    versionArgv: Object.freeze(["codex", "--version"]),
    homeDirName: ".codex",
    savedSignInFile: "auth.json",
  }),
  CLAUDE_CODE_SUBSCRIPTION: Object.freeze({
    launcher: "claude",
    versionArgv: Object.freeze(["claude", "--version"]),
    homeDirName: ".claude",
    savedSignInFile: ".claude.json",
  }),
};

/**
 * The host a probe runs against, injected so the whole detection path is
 * testable and so nothing here reaches for `node:child_process` by itself.
 *
 * `askVersion` receives a frozen argv from {@link LAUNCHERS} and nothing else.
 * `exists` answers a yes/no about a path; it never returns the bytes, because
 * the bytes are a credential.
 */
export interface ProbeHost {
  /** Resolve a launcher on PATH. Returns where it is, or null. Never runs it. */
  readonly resolve: (launcher: string) => string | null;
  /** Presence only. */
  readonly exists: (path: string) => boolean;
  /** Run one frozen argv and report what it printed. */
  readonly askVersion: (argv: readonly string[]) => { readonly ok: boolean; readonly printed: string | null; readonly why: string | null };
  /** This host's home directory, for locating a provider's own directory. */
  readonly homeDir: string;
  readonly now: string;
}

/** Join a home directory and a name without importing a path module into a pure-ish file. */
function under(homeDir: string, ...parts: readonly string[]): string {
  const base = homeDir.replace(/[\\/]+$/, "");
  return [base, ...parts].join("/");
}

/**
 * Probe one provider on this host. Three independent observations, no
 * inference between them: a launcher that resolves is not a launcher that
 * starts, and a saved sign-in is not a valid subscription.
 *
 * An unknown provider id throws rather than probing something unnamed — the
 * table is closed and an unclassified action fails closed (§3.6).
 */
export function probeProvider(host: ProbeHost, provider: AgentProviderId): ProviderProbe {
  const spec = LAUNCHERS[provider];
  if (spec === undefined) {
    throw new Error(
      `probeProvider refused the provider id ${String(provider)}: the launcher table is closed and ` +
        "an unrecognised provider has no argv, so there is nothing safe to run for it.",
    );
  }
  const at = host.resolve(spec.launcher);
  const homePath = under(host.homeDir, spec.homeDirName);
  const homePresent = host.exists(homePath);
  const savedSignIn = homePresent && host.exists(under(homePath, spec.savedSignInFile));
  // Only ask for a version when the launcher actually resolved. Running a name
  // the host could not resolve produces a shell error, not a measurement — and
  // "asked and got nothing" and "never asked" are different readings that must
  // not collapse into one another.
  const answered = at === null ? null : host.askVersion(spec.versionArgv);
  const version = answered === null
    ? { asked: false, printed: null, why: `The ${spec.launcher} program was not found on this machine, so nothing was run.` }
    : { asked: true, printed: answered.ok ? answered.printed : null, why: answered.why };
  return {
    provider,
    observedFrom: "RUNNER_HOST",
    observedAt: host.now,
    launcher: { found: at !== null, at },
    home: { present: homePresent, savedSignIn },
    version,
  };
}

/* --------------------------------------------------------- API fallback */

/**
 * The default, and the law: OFF. Named as a constant so a test can pin it and
 * so nothing has to read the word "false" out of a conditional to know it.
 */
export const API_FALLBACK_DEFAULT_ENABLED = false;

export interface ApiFallbackPolicy {
  readonly enabled: boolean;
  /** `DEFAULT` means nobody turned it on. `OWNER_DECISION` means the owner did, and when. */
  readonly source: "DEFAULT" | "OWNER_DECISION";
  readonly decidedAt: string | null;
  /** One plain sentence the owner reads on the card. */
  readonly says: string;
  /**
   * What recording this decision actually does today, and the exact piece that
   * is missing — both taken verbatim from the module that owns the setting, so
   * this surface and the action that writes it cannot disagree about which
   * state the system is in.
   */
  readonly enforcement: string;
  readonly missingSeam: string;
}

/**
 * Read the owner's paid-API setting, failing closed on everything.
 *
 * The setting lives in the `adminConfig` aggregate, written only by the
 * gateway's `config.setApiFallback` action. This module reads it and does not
 * carry a second copy of it or a second way to change it.
 *
 * `null` — no record, a store that could not be reached, or a stored value that
 * is not a config at all — is OFF. `isAdminConfig` is the same predicate the
 * gateway's own executor uses, so a corrupt row reads identically on both
 * sides. There is no path by which the absence of an answer turns paid spending
 * on, which is what makes "OFF by default, and OFF again after a deploy or a
 * restart" a property of the code rather than a hope about the environment.
 */
export function apiFallbackPolicy(config: AdminConfig | null | undefined): ApiFallbackPolicy {
  const valid = config !== null && config !== undefined && isAdminConfig(config);
  const enabled = valid && config.apiFallback.enabled === true;
  if (!enabled) {
    return {
      enabled: API_FALLBACK_DEFAULT_ENABLED,
      source: "DEFAULT",
      decidedAt: null,
      says: "Paid API spending is off. If a subscription cannot take the work, the console refuses the job and tells you — it never quietly bills a card instead.",
      enforcement: API_FALLBACK_ENFORCEMENT,
      missingSeam: API_FALLBACK_MISSING_SEAM,
    };
  }
  return {
    enabled: true,
    source: "OWNER_DECISION",
    decidedAt: config.apiFallback.decidedAt,
    says: "You have allowed paid API spending. When a subscription cannot take the work, a job may fall through to a metered API and cost money.",
    enforcement: API_FALLBACK_ENFORCEMENT,
    missingSeam: API_FALLBACK_MISSING_SEAM,
  };
}

/* --------------------------------------------------------- the routing */

/** Where a job would actually run, once the bridge has looked. */
export const EXECUTION_PATHS = ["SUBSCRIPTION", "PAID_API", "REFUSE"] as const;
export type ExecutionPath = (typeof EXECUTION_PATHS)[number];

export interface ExecutionChoice {
  readonly path: ExecutionPath;
  /** One plain sentence: why this path and not another. */
  readonly says: string;
  /** Set when the path is REFUSE: whose problem this is (§3.9). */
  readonly blocker: ProviderBlocker;
}

/**
 * THE function that decides whether money gets spent. One place, so there is
 * one thing to read and one thing to test.
 *
 * The order is the law: a working subscription always wins; when it is not
 * available the job is REFUSED unless the owner has explicitly and durably
 * turned the paid path on. There is no third branch, no retry-into-API, and no
 * "just this once" — §4's whole instruction is that an exhausted subscription
 * must not silently become a bill.
 */
export function chooseExecutionPath(
  subscriptionAvailable: boolean,
  fallback: ApiFallbackPolicy,
  providerName: string,
): ExecutionChoice {
  if (subscriptionAvailable) {
    return {
      path: "SUBSCRIPTION",
      says: `${providerName} runs this on your subscription. It costs nothing beyond what you already pay.`,
      blocker: null,
    };
  }
  if (fallback.enabled) {
    return {
      path: "PAID_API",
      says: `${providerName} cannot take this on your subscription, and you have turned paid API spending on, so this job will be billed per use.`,
      blocker: null,
    };
  }
  return {
    path: "REFUSE",
    says: `${providerName} cannot take this on your subscription right now, and paid API spending is off, so nothing was sent and nothing was charged.`,
    blocker: "EXTERNAL",
  };
}

/* ------------------------------------------------------- the descriptor */

/** What the descriptor builder needs beyond the probe itself. */
export interface DescribeInput {
  readonly probe: ProviderProbe;
  readonly fallback: ApiFallbackPolicy;
  /** Jobs of this provider's currently in flight, from the job log. */
  readonly inFlight: number;
  readonly latestTask: LatestTask | null;
  readonly latestError: LatestError | null;
}

/**
 * Turn one honest probe into one honest card.
 *
 * The rule running through every branch: a thing not measured is a gap that
 * says whose it is, never a `false` and never a green tick. "Not installed" is
 * OURS and it is `OWNER_GATED`, because installing it is something the owner
 * does. "The provider refused the account" is `EXTERNAL`. "We could not check
 * from here" is UNKNOWABLE_NOW and is neither.
 */
export function describeProvider(input: DescribeInput): AgentProviderDescriptor {
  const { probe, fallback } = input;
  const words = PROVIDER_WORDS[probe.provider];
  const configured = probe.launcher.found || probe.home.present;
  const starts = probe.version.asked && probe.version.printed !== null;

  const authenticated: Held<AuthenticationReading> = probe.home.present
    ? held(probe.home.savedSignIn ? "SIGNED_IN_UNVERIFIED" : "NO_SAVED_SIGN_IN")
    : gap<AuthenticationReading>(
        "OURS",
        `${words.name} has never been set up on the machine that runs the work, so there is no sign-in to check.`,
      );

  const free = Math.max(0, AGENT_BOUNDS.maxConcurrentJobsPerProvider - Math.max(0, input.inFlight));
  const capacity: Held<Measured> = held(
    measured(
      free,
      AGENT_BOUNDS.maxConcurrentJobsPerProvider,
      `Free job slots on ${words.name}. One job at a time, because a subscription is one seat and running two gets you rate-limited.`,
      "the delegated-job log, counting jobs started and not yet finished",
    ),
  );

  const canRunNow = starts && probe.home.savedSignIn;
  const choice = chooseExecutionPath(canRunNow, fallback, words.name);

  let blocker: ProviderBlocker = null;
  let happened: string;
  let next: string;
  let needsYouAction: string | null = null;

  if (!probe.launcher.found && probe.home.present) {
    /*
     * The distinction this branch exists for, measured on the owner's own
     * machine on 2026-09-06: both providers had a home directory and a saved
     * sign-in, and neither program was on the PATH of the process that would
     * start it. "Not installed" would have been the wrong sentence and the
     * wrong instruction — it is set up, it is signed in, and the runner simply
     * cannot reach it from where it stands.
     */
    blocker = "OWNER_GATED";
    happened = `${words.name} is set up on the machine that runs the work, but the program that starts it is not on the path that machine's runner searches.`;
    next = "Nothing runs on this provider until the runner can find the program.";
    needsYouAction = `make ${words.name} runnable from the runner's own path on that machine`;
  } else if (!probe.launcher.found) {
    blocker = "OWNER_GATED";
    happened = `${words.name} has never been set up on the machine that runs the work. Nothing has been tried and nothing has failed.`;
    next = "Nothing runs on this provider until it is installed and signed in.";
    needsYouAction = `install ${words.name} on the runner machine and sign in with ${words.paidBy}`;
  } else if (!starts) {
    blocker = "EXTERNAL";
    happened = `${words.name} is installed but did not answer when asked what version it is.`;
    next = "Jobs for this provider are refused until it answers.";
    needsYouAction = `check ${words.name} on the runner machine`;
  } else if (!probe.home.savedSignIn) {
    blocker = "OWNER_GATED";
    happened = `${words.name} starts, but nobody has signed in to it on this machine.`;
    next = "Jobs are refused until it is signed in; nothing falls through to a paid API.";
    needsYouAction = `sign in to ${words.name} with ${words.paidBy}`;
  } else {
    happened = `${words.name} starts on the runner machine and has a saved sign-in. Whether ${words.paidBy} is still good is only proven when a job runs.`;
    next = free > 0 ? "It can take a job now." : "It is busy; the next job waits for the one in flight to finish.";
  }

  return {
    provider: probe.provider,
    name: words.name,
    observedFrom: probe.observedFrom,
    observedAt: probe.observedAt,
    configured: held(configured),
    reachable: held(starts),
    authenticated,
    capacity,
    occupancy: held(input.inFlight > 0 ? "BUSY" : "IDLE"),
    latestTask: input.latestTask === null
      ? gap<LatestTask>("OURS", `${words.name} has not been asked to do anything yet.`)
      : held(input.latestTask),
    latestError: input.latestError === null
      ? gap<LatestError>("OURS", "Nothing has gone wrong that was recorded. That is not the same as nothing having gone wrong.")
      : held(input.latestError),
    fallbackPolicy: fallback,
    blocker,
    canRunNow: choice.path === "SUBSCRIPTION",
    happened,
    next,
    needsYou: needsYouAction !== null,
    needsYouAction,
  };
}

/**
 * The card for a provider nobody could look at from here.
 *
 * The deployed console is a Netlify function. It has no PATH, no home
 * directory and no process table, so it cannot resolve a launcher, cannot see a
 * saved sign-in and cannot run a version check. The brief's honesty
 * requirement names this case exactly: say so, classify it `EXTERNAL`, and do
 * not claim health that was never measured. Every field is a gap whose
 * sentence says why, and `canRunNow` is false — the website never starts a job
 * it cannot see a provider for.
 */
export function unobservedFromWeb(provider: AgentProviderId, fallback: ApiFallbackPolicy, observedAt: string): AgentProviderDescriptor {
  const words = PROVIDER_WORDS[provider];
  /*
   * The reason is stated ONCE, in `happened`, and each field then says only
   * which particular thing is unknowable. Six fields carrying one identical
   * paragraph is technically honest and reads as noise — measured on the
   * rendered page, 2026-09-06 — and §9A's whole complaint is about surfaces
   * that make the owner read the same sentence to find the one new word in it.
   */
  const onlyThere = (what: string): string => `${what} is only knowable on the machine that runs the work.`;
  return {
    provider,
    name: words.name,
    observedFrom: "WEB_FUNCTION",
    observedAt,
    configured: gap<boolean>("UNKNOWABLE_NOW", onlyThere(`Whether ${words.name} is set up`)),
    reachable: gap<boolean>("UNKNOWABLE_NOW", onlyThere(`Whether ${words.name} starts when asked`)),
    authenticated: gap<AuthenticationReading>("UNKNOWABLE_NOW", onlyThere(`Whether ${words.name} is signed in`)),
    capacity: gap<Measured>("UNKNOWABLE_NOW", onlyThere("How many job slots are free")),
    occupancy: gap<ProviderOccupancy>("UNKNOWABLE_NOW", onlyThere(`Whether ${words.name} is busy right now`)),
    latestTask: gap<LatestTask>("UNKNOWABLE_NOW", "The jobs themselves are listed below; this card is only about the machine that would run them."),
    latestError: gap<LatestError>("UNKNOWABLE_NOW", "Anything that went wrong is recorded with the jobs below; this card is only about the machine."),
    fallbackPolicy: fallback,
    blocker: "EXTERNAL",
    canRunNow: false,
    happened:
      `Nothing about ${words.name} was checked from here. It runs on the machine in your office, and this website cannot see that machine — ` +
      "so none of the readings below were taken.",
    next: "The runner machine records what it sees each time it publishes the console; this card fills in from that record.",
    needsYou: false,
    needsYouAction: null,
  };
}
