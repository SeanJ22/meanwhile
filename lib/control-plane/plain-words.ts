import { MODELS, modelTierFor } from "../models.ts";

export interface PlainWord {
  readonly words: string;
  readonly means?: string;
}

/** Keys are the exact constants the control plane emits. */
export const PLAIN_WORDS: Readonly<Record<string, PlainWord>> = {
  CYCLE_DEFERRED: {
    words: "Cycle time used",
    means: "The cycle ran out of dispatch time before it reached this item. This is not a dollar spending limit. The item keeps its place in line for a later cycle.",
  },
  WALL_CLOCK_CEILING: {
    words: "Time limit reached",
    means: "The cycle ran for as long as it is allowed to. The rest of the work is still owed and runs next cycle.",
  },
  DISPATCH_CEILING: {
    words: "Job limit reached",
    means: "This cycle started as many jobs as it is allowed to start.",
  },
  CYCLE_MODEL_SPEND_CEILING: {
    words: "Spending limit for this run",
    means: "This run reached the dollar limit set for a single cycle.",
  },
  OPERATIONAL_NIGHT_MODEL_SPEND_CEILING: {
    words: "Spending limit for the night",
    means: "The overnight working window reached its dollar limit.",
  },
  ROLLING_24_HOUR_MODEL_SPEND_CEILING: {
    words: "Spending limit for the day",
    means: "The last 24 hours of paid model work reached the daily dollar limit.",
  },
  PROVIDER_REQUEST_CEILING: {
    words: "Request limit reached",
    means: "This cycle made as many outside requests as it is allowed to make.",
  },
  PAYLOAD_BYTE_CEILING: {
    words: "Download limit reached",
    means: "This cycle moved as much data as it is allowed to move.",
  },
  UNMEASURED_MODEL_SPEND: {
    words: "Cost could not be measured",
    means: "A model reply did not report what it cost, so the run stopped rather than spend money it cannot account for.",
  },
  SCHEDULED_BLACKOUT: {
    words: "Scheduled quiet period",
    means: "No paid or network research runs during the Saturday-evening-to-Sunday-morning quiet window.",
  },
  PROVIDER_CIRCUIT_BROKEN: {
    words: "A provider is paused",
    means: "A provider refused work in a way that will not fix itself by retrying, so it is paused until the named time.",
  },

  ACTIVE: { words: "Active", means: "The runner is working on schedule." },
  PAUSED: { words: "Paused", means: "You paused it. It stays paused until you resume it." },
  "SCHEDULED BLACKOUT": { words: "Scheduled quiet period" },
  "CIRCUIT BROKEN": { words: "A provider is paused" },

  REFUSED_BY_HOST: {
    words: "The source refused the request",
    means: "The website or API turned us away — a block page, a login wall or a bot check. It is retried on a schedule.",
  },
  RATE_LIMITED: {
    words: "The source asked us to slow down",
    means: "We asked too often. The next attempt waits longer.",
  },
  UPSTREAM_ERROR: {
    words: "The source had an error",
    means: "Their server broke while answering. It is retried on a schedule.",
  },
  TRANSPORT_FAILED: {
    words: "We could not reach the source",
    means: "The connection never completed — no answer came back at all. It is retried on a schedule.",
  },
  WORKER_LOST: {
    words: "The worker holding it stopped",
    means: "The job was picked up and then the worker went away. It goes back in the queue.",
  },
  EXTRACTION_FAILED: {
    words: "We got the page but could not read it",
    means: "The document came back and nothing usable could be pulled out of it. Another way of reading it is tried.",
  },
  NEVER_DISPATCHED: {
    words: "Not reached yet",
    means: "This was scheduled and its turn passed before a cycle got to it. It is still owed.",
  },
  AWAITING_ADAPTER: {
    words: "Waiting for a reader to be built",
    means: "Nothing refused us. The code that reads this kind of record does not exist yet, so engineering owns the next step.",
  },
  AWAITING_ROUTINE_READ: {
    words: "Waiting for its scheduled read",
    means: "A routine read on its own clock carries this record and has not filled it yet. It is still owed.",
  },

  CURRENT: { words: "Current", means: "Done and recently checked." },
  PARTIAL_OR_STALE: { words: "Partly done or out of date", means: "Some of it is done, or all of it is done but the check is old." },
  NOT_WALKED: { words: "Not checked yet", means: "Nobody has looked at this yet. It is not a finding that anything is missing." },
  ARGUED_ABSENT: { words: "Looked for, does not exist", means: "We walked every route we know and recorded that there is nothing there to find." },
  BLOCKED: { words: "Blocked", means: "Something outside the system is stopping this." },
  GATED_ON_OPERATOR: { words: "Waiting on you", means: "This one needs a decision from you before it can move." },

  SOURCE_KNOWN: { words: "Source found" },
  ACQUIRED: { words: "Records fetched" },
  VERIFIED: { words: "Independently checked" },
  SHOWN_TO_READER: { words: "Live on the site" },
  ASK_ANSWERS: { words: "Ask can answer it" },

  /*
   * A robots.txt verdict is recorded, never a block; only an access control stops a read.
   * ALLOWED, DISALLOWED and CANNOT_TELL are shared with other vocabularies, so their labels stay general.
   */
  NO_ROBOTS: { words: "No robots file published", means: "The host publishes no robots file. That is recorded; it neither allows nor blocks anything." },
  ALLOWED: { words: "Allowed by the host" },
  DISALLOWED: {
    words: "The host's rules name it",
    means: "The host's published rules name this. For a web page that is its robots file, which is recorded and does not block reading a public page (your decision of 2026-09-25); a login, a paywall or a bot check would.",
  },
  CANNOT_TELL: { words: "Cannot tell" },

  SCOUT: { words: "Hunter" },
  ACQUIRER: { words: "Acquirer" },
  PARSER: { words: "Parser" },
  DETECTIVE: { words: "Detective" },
  VALIDATOR: { words: "Validator" },
  ADVERSARIAL_AUDITOR: { words: "Auditor" },
  ENGINEERING: { words: "Engineer" },
  RELEASE_ORCHESTRATOR: { words: "Release orchestrator" },

  UNRESOLVED_INVESTIGATION: {
    words: "Still looking",
    means: "The routes tried so far have not settled this. The next step is another route, not an ending.",
  },
  DETERMINISTIC_REPLAYS: {
    words: "Repeat runs without a model",
    means: "Times ordinary code walked a route by itself after a worker taught it how.",
  },
  BOUNDED_MODEL_WORKER: { words: "Paid model" },
  DETERMINISTIC: { words: "Plain code" },
  COMPLETED: { words: "Finished" },
  ABORTED: { words: "Stopped early" },
  FAILED: { words: "Did not succeed" },
  BLOCKED_ON_DEPENDENCY: { words: "Waiting on an earlier step" },

  NOT_READY: { words: "Not proven yet" },
  NOT_MEASURED: { words: "Not measured" },
  SESSION_MEASURED: { words: "Measured by a work session" },
  INDEPENDENTLY_REPRODUCED: { words: "Reproduced independently" },
  NOT_CONFIGURED: { words: "Not set up" },
  PREDATES_FIELDS: { words: "Ran before this was measured" },
  UNMEASURED: { words: "Not measured" },

  INTRODUCED: { words: "Introduced by this change" },
  INHERITED: { words: "Already there before this change" },
  OWNER_GATED: { words: "Waiting on you" },
  EXTERNAL: { words: "Outside our control" },

  READ_ONLY: { words: "Read only", means: "Looks at things. Changes nothing." },
  PROPOSE_ONLY: { words: "Can suggest only", means: "Can put something forward for you; cannot carry it out." },
  REVERSIBLE_NONPRODUCTION: { words: "Safe and undoable", means: "Changes something off the live site that can be put back." },
  CODE_CHANGE: { words: "Changes code", means: "Writes code on a branch. Nothing reaches the live site without the usual checks." },
  GOVERNED_INTEGRATION: { words: "Ships through the usual gates", means: "Goes through the merge queue, the checks and the deploy proof like every other change." },
  OWNER_DECISION_REQUIRED: { words: "Needs your decision", means: "No machine may make this call." },
  PROHIBITED: { words: "Not allowed", means: "The system refuses this outright." },

  STAGING_READY_FOR_OWNER_REVIEW: {
    words: "Ready for your review",
    means: "The test site has finished building and is waiting for you to look at it.",
  },
  READY_FOR_REVIEW: { words: "Ready for your review", means: "The test site is built and waiting for you." },
  STAGING_BOUNDARY_STABLE: {
    words: "The test site is settled",
    means: "The test site is not mid-change, so what you review now is what you decide on.",
  },
  MANIFEST_UNAVAILABLE: {
    words: "We could not read the test site",
    means: "The test site did not answer when we asked what it is running, so nothing on this page is a claim about it.",
  },
  OWNER_APPROVED_FOR_PRODUCTION: {
    words: "You approved it",
    means: "You recorded that this build is good to ship. Recording it does not ship it.",
  },
  REVIEWABLE: { words: "Ready to review", means: "This section is on the test build and you can record what you think of it." },
  NOT_YET_REVIEWABLE: {
    words: "Not on this build yet",
    means: "The test site has not shown us this section, so there is nothing here to judge.",
  },
  AWAITING_OWNER_CHOICE: { words: "Waiting on a choice from you", means: "This one needs you to pick between the options before it can go further." },
  STALE_SHA: {
    words: "The test site moved",
    means: "The build changed while you were reading, so what you were about to decide on is no longer what is there.",
  },
  NOT_REVIEWABLE: { words: "Not reviewable" },
  NOT_RECORDABLE: { words: "Cannot be recorded yet" },
  ALREADY_RECORDED: { words: "Already recorded" },
  STORE_UNAVAILABLE: { words: "The record could not be written" },
  RAISED_STATE_CHOICE_REQUIRED: { words: "A variant has to be chosen first" },
  RECORDED: { words: "Recorded" },
  REFRESHED: { words: "Read again" },
};

/** Anything that is not a machine constant comes back untouched. */
export function plainCode(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (raw === "") return "";
  const entry = PLAIN_WORDS[raw];
  if (entry) return entry.words;
  // Not a screaming-snake constant: leave it alone.
  if (!/^[A-Z][A-Z0-9]*([ _][A-Z0-9]+)*$/.test(raw)) return raw;
  const lower = raw.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function plainMeaning(code: string | null | undefined): string | null {
  return PLAIN_WORDS[(code ?? "").trim()]?.means ?? null;
}

export function hasPlainMeaning(code: string | null | undefined): boolean {
  return plainMeaning(code) !== null;
}

/** An environment-variable name becomes a description, never a de-underscored name. */
export function plainText(text: string | null | undefined): string {
  const raw = text ?? "";
  if (raw === "") return "";
  /* Content-hash ids are replaced: the owner cannot use them, and the full sentence is one disclosure down. */
  return raw
    .replace(/\b(?:ar|at|wi|rt)[- ][0-9a-f]{12,}\b/gi, "a stored copy")
    .replace(/(?<![\w/-])[0-9a-f]{16,}(?![\w-])/gi, "a stored copy")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (match) => {
    if (isEnvVarName(match)) return "a credential held on the server";
    const entry = PLAIN_WORDS[match];
    if (entry) return entry.words.charAt(0).toLowerCase() + entry.words.slice(1);
    return match.replace(/_/g, " ").toLowerCase();
  });
}

/** Our own variables carry the project prefix; anything ending in a credential word is one too. */
export function isEnvVarName(name: string): boolean {
  return /^(WTP|NEXT_PUBLIC)_/.test(name) || /_(API_KEY|SECRET|TOKEN|PASSWORD|COOKIE|DATABASE_URL|CLIENT_ID|CLIENT_SECRET|SESSION_KEY)$/.test(name);
}

/** Model ids whose display name is not derivable from the id. */
const MODEL_NAMES: Readonly<Record<string, string>> = {
  "no model (deterministic work)": "No model — plain code",
};

/** Date-stamped ids render without the stamp: `claude-haiku-4-5-20251001` is `Claude Haiku 4.5`. */
export function modelName(id: string | null | undefined): string {
  const raw = (id ?? "").trim();
  if (raw === "") return "";
  const tier = modelTierFor(raw);
  if (tier) return MODELS[tier].name;
  const known = MODEL_NAMES[raw];
  if (known) return known;
  if (!/^[a-z0-9]+(-[a-z0-9.]+)+$/.test(raw)) return raw;
  const parts = raw.split("-").filter((p) => !/^\d{8}$/.test(p));
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    // A bare number that follows another bare number is a minor version: 4-5 → 4.5.
    if (/^\d+$/.test(p) && out.length > 0 && /^\d+(\.\d+)?$/.test(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]}.${p}`;
      continue;
    }
    out.push(/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1));
  }
  return out.join(" ");
}

/** Dollars to the cent; a non-zero amount that rounds to `$0.00` renders `<$0.01`. */
export function usdCents(value: number): string {
  if (!Number.isFinite(value)) return "$—";
  if (value > 0 && value < 0.005) return "<$0.01";
  if (value < 0 && value > -0.005) return ">-$0.01";
  return `$${value.toFixed(2)}`;
}

/** A spend against its ceiling, both to the cent: `$0.44 of $25.00`. */
export function usdOf(value: number, ceiling: number): string {
  return `${usdCents(value)} of ${usdCents(ceiling)}`;
}

/** `2,985` — a count with thousands separators, which is how a person reads it. */
export function count(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

/** `1 document`, `2 documents`. */
export function plainCount(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** Milliseconds in, seconds out: `1552` is `1.6 seconds`. */
export function plainDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} seconds`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  const minutes = ms / 60_000;
  return minutes < 60 ? `${minutes.toFixed(1)} minutes` : `${(minutes / 60).toFixed(1)} hours`;
}

/** Hours in, words out: `577` is `24 days`. */
export function ageWords(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "an unknown time";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} days`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `${weeks} week${weeks === 1 ? "" : "s"}` : `${Math.floor(days / 30)} months`;
}
