/**
 * **ONE TRANSLATION LAYER — a machine constant never reaches the face of the
 * page.** (ADM-25 and the global plain-English render law, §9A.1 of the Admin C
 * brief, 2026-09-06.)
 *
 * The owner's words, verbatim: *"Get rid of all these underscores on the
 * display. If there's an underscore showing a space anywhere, it should just be
 * a space. I'm so tired of seeing these underscores."* And the frame the whole
 * pass is judged against: *"Think of someone: I'm not an engineer and I'm not a
 * coder at all. When I come into this what I want to see is: what is it that
 * I'm looking at? What needs to be taken action on?"*
 *
 * The feedback names one screen per defect and the defect is on every screen
 * (RULING 262). So this is ONE module, not a scatter of per-component string
 * replacements: every admin surface renders a code through {@link plainCode}
 * or a sentence through {@link plainText}, and the raw form survives in the
 * `title` attribute, the disclosure and the copy panel — nothing is hidden, it
 * just does not lead.
 *
 * ## Three layers, in the order the owner reads them
 *
 * ```
 *   plainCode(code)     the constant as ordinary words — "Cycle deferred"
 *   plainMeaning(code)  what it means to him, one sentence — "The cycle used up
 *                       its budget for this run; the work keeps its place."
 *   raw                 unchanged, for the hover and the disclosure
 * ```
 *
 * A code with no dictionary entry still renders as words: underscores become
 * spaces and the phrase takes sentence case. A code with an entry gets the
 * owner's wording, which is frequently NOT the mechanical de-underscoring —
 * `REFUSED_BY_HOST` is "The source refused the request", not "Refused by host",
 * because the second is still machine speech with the underscores taken out.
 *
 * PURE. No clock, no store, no environment. Every function is total.
 */

/** What one machine constant is called, and what it means, in the owner's words. */
export interface PlainWord {
  /** The constant as a short label. Sentence case, no underscores. */
  readonly words: string;
  /** One sentence saying what it means to the owner. Optional. */
  readonly means?: string;
}

/**
 * The dictionary. Keys are the exact constants the control plane emits.
 *
 * Grouped by where they come from so a new constant lands beside its family
 * rather than at the bottom of an alphabetical list nobody scans.
 */
export const PLAIN_WORDS: Readonly<Record<string, PlainWord>> = {
  /* --------------------------------- fleet safety: why a cycle stopped */
  /*
   * ADM-51 — THIS WAS THE WORD THAT UNDID THE WHOLE RUNNER BLOCK.
   *
   * The owner read "Why work stopped: Budget reached at 11:20 PM ET" with every
   * spend row showing $0.00 of $2.00 / $10.00 / $25.00, and could not reconcile
   * the two. He was right not to: no money had been spent, and no dollar
   * ceiling had been reached.
   *
   * CYCLE_DEFERRED is not a ceiling at all. It is the FALLBACK the shadow loop
   * applies to any deferral whose reason text does not start with a
   * SCREAMING_SNAKE code — the cycle's wall clock, a stated deterministic
   * ceiling and the debt backoff all land in it. Calling that "Budget reached"
   * put a money word on a clock and a job counter, and then the sentence
   * doubled down with "spent its budget".
   *
   * The honest words say what is actually known, which is less than the old
   * ones claimed: the cycle stopped before reaching this item, and the reason
   * did not name itself. When a cycle DOES name its limiter, the specific code
   * now outranks this one (see STOP_PRIORITY in runner-plain.ts).
   */
  CYCLE_DEFERRED: {
    words: "Ran out of room this cycle",
    means:
      "The cycle stopped before it reached this item and did not record which of its limits stopped it — it may have been the job count, the clock or a stated ceiling, but it was not a dollar. The item keeps its place in line and a later cycle picks it up.",
  },
  WALL_CLOCK_CEILING: {
    words: "Time limit reached",
    means: "The cycle ran for as long as it is allowed to. The rest of the work is still owed and runs next cycle.",
  },
  /*
   * ADM-51: the deferral that used to have no code at all and therefore became
   * "Budget reached". It is a clock — the cycle stops STARTING work a few
   * minutes before its hard wall so it can finish what it began and write its
   * state cleanly. Distinct from WALL_CLOCK_CEILING, which is the hard wall
   * itself; this one is the admission window closing.
   */
  CYCLE_TIME_EXHAUSTED: {
    words: "Ran out of time to start it",
    means:
      "The cycle stops starting new work a few minutes before its time is up, so it can finish what it already began. This item was still waiting when that moment came. It keeps its place and a later cycle starts it.",
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

  /* ------------------------------------- fleet safety: overall state */
  ACTIVE: { words: "Active", means: "The runner is working on schedule." },
  PAUSED: { words: "Paused", means: "You paused it. It stays paused until you resume it." },
  "SCHEDULED BLACKOUT": { words: "Scheduled quiet period" },
  "CIRCUIT BROKEN": { words: "A provider is paused" },

  /* ---------------------------- freshness debt: why a refresh failed */
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

  /* -------------------------------------------- readiness cell states */
  CURRENT: { words: "Current", means: "Done and recently checked." },
  PARTIAL_OR_STALE: { words: "Partly done or out of date", means: "Some of it is done, or all of it is done but the check is old." },
  NOT_WALKED: { words: "Not checked yet", means: "Nobody has looked at this yet. It is not a finding that anything is missing." },
  ARGUED_ABSENT: { words: "Looked for, does not exist", means: "We walked every route we know and recorded that there is nothing there to find." },
  BLOCKED: { words: "Blocked", means: "Something outside the system is stopping this." },
  GATED_ON_OPERATOR: { words: "Waiting on you", means: "This one needs a decision from you before it can move." },

  /* ------------------------------------------------ readiness gates */
  SOURCE_KNOWN: { words: "Source found" },
  ACQUIRED: { words: "Records fetched" },
  VERIFIED: { words: "Independently checked" },
  SHOWN_TO_READER: { words: "Live on the site" },
  ASK_ANSWERS: { words: "Ask can answer it" },

  /* ------------------------------------------- permission verdicts */
  NO_ROBOTS: { words: "No rules file published", means: "The host publishes no robots file, so nothing there forbids this route." },
  ALLOWED: { words: "Allowed by the host" },
  DISALLOWED: { words: "Not allowed by the host" },
  CANNOT_TELL: { words: "Cannot tell" },

  /* -------------------------------------------------- worker roles */
  SCOUT: { words: "Hunter" },
  ACQUIRER: { words: "Acquirer" },
  PARSER: { words: "Parser" },
  DETECTIVE: { words: "Detective" },
  /*
   * ADM-63: "Verifier", not "Validator". The owner's five names are Hunters,
   * Detectives, Verifiers, Auditors and Engineers, and this dictionary is the
   * console's ONE translation layer — so the word changes here and every
   * surface follows, rather than being corrected on the one screen the
   * feedback happened to name (RULING 262).
   *
   * It was already half-corrected and that was the visible defect: the role
   * card's heading came from here and said "Validators" while the activity
   * sentence directly beneath it came from a second dictionary and said
   * "verifiers". Two words for one worker, on one card.
   */
  VALIDATOR: { words: "Verifier" },
  ADVERSARIAL_AUDITOR: { words: "Auditor" },
  ENGINEERING: { words: "Engineer" },
  RELEASE_ORCHESTRATOR: { words: "Release orchestrator" },

  /* ------------------------------------------- attempt / work states */
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

  /* ------------------------------------------- health / proof classes */
  NOT_READY: { words: "Not proven yet" },
  NOT_MEASURED: { words: "Not measured" },
  SESSION_MEASURED: { words: "Measured by a work session" },
  INDEPENDENTLY_REPRODUCED: { words: "Reproduced independently" },
  NOT_CONFIGURED: { words: "Not set up" },
  PREDATES_FIELDS: { words: "Ran before this was measured" },
  UNMEASURED: { words: "Not measured" },

  /* ------------------------------------------------ blocker classes */
  INTRODUCED: { words: "Introduced by this change" },
  INHERITED: { words: "Already there before this change" },
  OWNER_GATED: { words: "Waiting on you" },
  EXTERNAL: { words: "Outside our control" },

  /* ---------------------------------------------- authority classes */
  READ_ONLY: { words: "Read only", means: "Looks at things. Changes nothing." },
  PROPOSE_ONLY: { words: "Can suggest only", means: "Can put something forward for you; cannot carry it out." },
  REVERSIBLE_NONPRODUCTION: { words: "Safe and undoable", means: "Changes something off the live site that can be put back." },
  CODE_CHANGE: { words: "Changes code", means: "Writes code on a branch. Nothing reaches the live site without the usual checks." },
  GOVERNED_INTEGRATION: { words: "Ships through the usual gates", means: "Goes through the merge queue, the checks and the deploy proof like every other change." },
  OWNER_DECISION_REQUIRED: { words: "Needs your decision", means: "No machine may make this call." },
  PROHIBITED: { words: "Not allowed", means: "The system refuses this outright." },

  /* --------------------------------- the release manifest's own status words
   * (9.6.26 owner feedback, ACLOSE-6). These were the HEADLINE of the release
   * review page — the owner opened it and read STAGING_READY_FOR_OWNER_REVIEW
   * in the title and STAGING_BOUNDARY_STABLE in the identity block, and said he
   * did not know what to do with any of it. They are the manifest's own words
   * and they stay available under Build identity; these are what the page says
   * instead. */
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

/**
 * A constant as ordinary words: the dictionary entry when there is one,
 * otherwise underscores as spaces in sentence case.
 *
 * Anything that is not a machine constant comes back untouched, so this is safe
 * to call on a value that may already be a phrase.
 */
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

/** What a constant means to the owner, when the dictionary says. */
export function plainMeaning(code: string | null | undefined): string | null {
  return PLAIN_WORDS[(code ?? "").trim()]?.means ?? null;
}

/** Does the dictionary carry an owner sentence for this constant? */
export function hasPlainMeaning(code: string | null | undefined): boolean {
  return plainMeaning(code) !== null;
}

/**
 * Every machine constant inside a sentence, replaced by its words.
 *
 * Instruments emit sentences with constants embedded — *"CYCLE_DEFERRED: the
 * cycle's dispatch budget was spent…"*. This rewrites those in place so a
 * quoted instrument sentence reads as English even where the page cannot
 * restructure it. An environment-variable name is replaced with a description
 * rather than a de-underscored version of itself, because the owner should
 * never read a variable name at all.
 */
export function plainText(text: string | null | undefined): string {
  const raw = text ?? "";
  if (raw === "") return "";
  /*
   * ADM-44: an instrument names the stored copy it read by its content hash —
   * *"from the already vaulted artifact ar 3d81f6aea2603d8c2f5b4ebc"*. Twenty-four
   * hex characters in the middle of a sentence is not something the owner can
   * use, and the sentence reads correctly without it. The whole sentence,
   * artifact id and all, is still one disclosure down.
   */
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

/**
 * Is this constant the name of an environment variable rather than a state?
 *
 * The brief names `WTP_WORKERS_ANTHROPIC_API_KEY` as text that must never reach
 * the face. The shape is the tell: our own variables carry the project prefix,
 * and everything else that ends in a credential word is one too.
 */
export function isEnvVarName(name: string): boolean {
  return /^(WTP|NEXT_PUBLIC)_/.test(name) || /_(API_KEY|SECRET|TOKEN|PASSWORD|COOKIE|DATABASE_URL|CLIENT_ID|CLIENT_SECRET|SESSION_KEY)$/.test(name);
}

/* --------------------------------------------------------------- models */

/** Model ids whose display name is not derivable from the id. */
const MODEL_NAMES: Readonly<Record<string, string>> = {
  "no model (deterministic work)": "No model — plain code",
};

/**
 * A model id as a name the owner reads: `claude-opus-5` → `Claude Opus 5`
 * (ADM-33 — *"Just say 'Claude Opus 5'. Stop with the dashes."*).
 *
 * Date-stamped ids keep their stamp in the hover, never on the face: a
 * `claude-haiku-4-5-20251001` renders `Claude Haiku 4.5`.
 */
export function modelName(id: string | null | undefined): string {
  const raw = (id ?? "").trim();
  if (raw === "") return "";
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

/* ---------------------------------------------------------------- money */

/**
 * Dollars to the cent, always (ADM-26 — *"round up to the nearest hundredth …
 * It should just be $0.4400 of $25.00"*, and the spreadsheet's reading of the
 * same instruction: *"$0.44 of $25.00"*).
 *
 * A non-zero amount that would round to `$0.00` renders `<$0.01` rather than
 * claiming nothing was spent.
 */
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

/* ------------------------------------------------------------- counting */

/** `2,985` — a count with thousands separators, which is how a person reads it. */
export function count(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

/**
 * `1 document`, `2 documents` — a count with a noun that agrees with it.
 * (9.6.26 owner feedback, ACLOSE-6.)
 *
 * The fleet panel rendered `1 artifacts / 1`, which is the unit union member
 * printed verbatim beside a number. A plural on a one is the tell that nobody
 * is reading the sentence, and it appeared on every attempt row.
 */
export function plainCount(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * A duration in words: `1552` → `1.6 seconds`, `839` → `0.8 seconds`.
 *
 * Milliseconds are the instrument's unit and seconds are the owner's. The exact
 * millisecond figure stays in the disclosure beside the contract that produced
 * it, exactly like every other raw number on the console.
 */
export function plainDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} seconds`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  const minutes = ms / 60_000;
  return minutes < 60 ? `${minutes.toFixed(1)} minutes` : `${(minutes / 60).toFixed(1)} hours`;
}

/**
 * An age in hours as ordinary words: `577` → `24 days`.
 *
 * The incident list showed `oldest 577 h` and the spreadsheet's note is that
 * nobody reads 577 hours as three weeks (ADM-30).
 */
export function ageWords(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "an unknown time";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} days`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `${weeks} week${weeks === 1 ? "" : "s"}` : `${Math.floor(days / 30)} months`;
}
