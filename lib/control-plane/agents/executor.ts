/**
 * **WHAT A BOUNDED DELEGATED RUN *IS*, AS POLICY.** (ADM-C8 / ACLOSE-1.)
 *
 * `provider.ts` says which providers exist and `review.ts` says how two of them
 * stay independent. Neither of them can start anything: `ReviewerExecutor` was
 * a type with no implementation, and `deps.execute(assignment)` was a call site
 * with nothing behind it. This module is the half of that seam that can be
 * reasoned about without a machine — the argv, the prompt, and the parse.
 * `run-host.ts` is the half that spawns.
 *
 * ## Why the argv lives in a frozen table and not in a caller
 *
 * §3.1 forbids an arbitrary terminal, an arbitrary command and an arbitrary
 * script path, and {@link LAUNCHERS} already holds that line for the *version*
 * check. A run is the same problem with a bigger blast radius, so it gets the
 * same shape: {@link RUN_ARGVS} is closed, frozen, and keyed by a provider id
 * that is itself a closed union. There is no parameter in this module through
 * which owner text, chat text or agent text can become a command word.
 *
 * **The prompt never touches the argv.** It goes in on STDIN. That is the whole
 * reason both argvs end the way they do — `codex exec … -` reads its
 * instructions from stdin, and `claude --print` with no prompt argument does
 * the same. A prompt passed as an argument would be one quoting bug away from
 * being read as flags; a prompt passed on a pipe cannot be.
 *
 * ## Why both runs are sandboxed twice
 *
 * Once by the provider — `codex exec --sandbox read-only` is Codex's own
 * refusal to write — and once by us, structurally: `run-host.ts` runs the child
 * in a FRESH EMPTY DIRECTORY. The frozen bytes are in the prompt, so an empty
 * working directory costs the reviewer nothing it was entitled to and denies it
 * everything it was not. A job's declared authority is READ_ONLY or
 * PROPOSE_ONLY (`assertAgentAuthority`); this is what makes that declaration a
 * property of the run rather than a promise about it.
 *
 * ## Why an unparseable answer is a FAILED job and never a summarised one
 *
 * The conclusion type carries a verdict, named topics with stances, and the
 * snapshot hash the reviewer echoed back. Those are the fields `compareConclusions`
 * computes agreement from and `proveIsolation` proves independence from. If the
 * provider printed something this module cannot turn into that shape, the honest
 * outcome is that the job did not finish — {@link conclusionFrom} throws and
 * `runOneSeat` records FAILED with the raw text. Inventing a verdict from prose
 * would put a fabricated stance into an agreement count, which is the one thing
 * a review surface must never do.
 */
import { STANCES, CONFIDENCES, type Confidence, type ReviewPoint, type ReviewerAssignment, type ReviewerConclusion, type Stance } from "./review.ts";
import { AGENT_BOUNDS, LAUNCHERS, type AgentProviderId } from "./provider.ts";

/**
 * The bytes a bounded run may print. A provider that prints more than its own
 * maximum context is not answering the question it was asked.
 */
export const MAX_OUTPUT_BYTES = AGENT_BOUNDS.maxContextBytes;

/**
 * The CLOSED table of what each provider is RUN as, exactly as {@link LAUNCHERS}
 * is the closed table of what each is PROBED as.
 *
 * Element 0 is the launcher NAME, never a path: `run-host.ts` resolves it
 * against a PATH it composes from this host's own PATH plus a closed list of
 * declared install directories. A caller cannot supply a path here because
 * there is no parameter for one.
 *
 * CODEX_SUBSCRIPTION
 *   `exec`                    the non-interactive subcommand
 *   `--sandbox read-only`     Codex's own sandbox, at its most restrictive
 *   `--skip-git-repo-check`   we run in an empty directory on purpose
 *   `--ephemeral`             no session file is left behind on the host
 *   `--color never`           escape codes are not part of an answer
 *   `-`                       instructions come from stdin
 *
 * CLAUDE_CODE_SUBSCRIPTION
 *   `--print`                 answer and exit; no interactive session
 *   `--output-format text`    the answer itself, not a transcript envelope
 *   `--permission-mode plan`  the mode that does not edit
 *   (no prompt argument)      instructions come from stdin
 */
export const RUN_ARGVS: Readonly<Record<AgentProviderId, readonly string[]>> = Object.freeze({
  CODEX_SUBSCRIPTION: Object.freeze([
    "codex",
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-",
  ]),
  CLAUDE_CODE_SUBSCRIPTION: Object.freeze([
    "claude",
    "--print",
    "--output-format",
    "text",
    "--permission-mode",
    "plan",
  ]),
});

/** The one run argv this provider has. An unknown id has none, and throws. */
export function runArgvFor(provider: AgentProviderId): readonly string[] {
  const argv = RUN_ARGVS[provider];
  if (argv === undefined) {
    throw new Error(
      `runArgvFor refused the provider id ${String(provider)}: the run table is closed and an ` +
        "unrecognised provider has no argv, so there is nothing safe to run for it.",
    );
  }
  return argv;
}

/**
 * Is this argv, element for element, one of the two declared runs?
 *
 * The same predicate shape as `argvIsPermitted` in `host.ts`, and for the same
 * reason: a caller inside this repository holding the run host still cannot run
 * anything that is not in the table.
 */
export function runArgvIsPermitted(argv: readonly string[]): boolean {
  return Object.values(RUN_ARGVS).some(
    (allowed) => allowed.length === argv.length && allowed.every((part, i) => part === argv[i]),
  );
}

/** Every launcher name a run may start, taken from the closed table. */
export function runLauncherNames(): readonly string[] {
  return Object.values(RUN_ARGVS).map((argv) => argv[0]);
}

/* ------------------------------------------------------------- the prompt */

/**
 * The answer shape a reviewer is required to print, stated to it in its own
 * prompt and parsed back out by {@link parseAgentReply}.
 *
 * It is small on purpose. Every field maps to one field of `ReviewerConclusion`,
 * and there is no field a reviewer could fill in that the console would not
 * render — a reply format with a slot nothing reads teaches the model that some
 * of its output does not matter.
 */
export const REPLY_CONTRACT = `{
  "reviewedHash": "<echo back the exact SNAPSHOT HASH you were given>",
  "verdict": "<one sentence: your overall answer to the question>",
  "points": [
    {
      "topic": "<short stable name for the thing this claim is about>",
      "stance": "YES | NO | UNSURE",
      "says": "<your claim, in your own words>",
      "confidence": "HIGH | MEDIUM | LOW",
      "evidence": "<what in the snapshot you are pointing at>"
    }
  ]
}`;

/**
 * The exact text one reviewer is given.
 *
 * Both seats get this from the same `assignment.body` and the same
 * `assignment.question` — `assignmentFor` built them from one frozen snapshot —
 * so the only difference between the two prompts is the provider that receives
 * it. Nothing about the other seat appears here, because nothing about the
 * other seat exists in a `ReviewerAssignment` to put here.
 */
export function reviewPrompt(assignment: ReviewerAssignment): string {
  return [
    "You are reviewing a frozen snapshot of source code. Answer ONLY from the bytes below.",
    "Do not read files, do not search the internet, and do not run anything: everything you are",
    "entitled to see is in this message, and a claim you cannot ground in these bytes is not a finding.",
    "",
    `SNAPSHOT HASH: ${assignment.snapshot.hash}`,
    `SNAPSHOT DESCRIBES: ${assignment.snapshot.describes}`,
    `SNAPSHOT BYTES: ${assignment.snapshot.bytes}`,
    "",
    `QUESTION: ${assignment.question}`,
    "",
    "Reply with ONE JSON object and nothing else — no prose before it, no prose after it, no code fence.",
    "It must match this shape exactly:",
    "",
    REPLY_CONTRACT,
    "",
    "If the reviewed invariants hold, say so in `verdict` and record the topics you checked with",
    "stance YES. If you find a concrete violation, record it with stance NO and quote the exact",
    "evidence. Use UNSURE when the snapshot does not settle the question — an honest UNSURE is worth",
    "more than a confident guess.",
    "",
    "----- BEGIN FROZEN SNAPSHOT -----",
    assignment.body,
    "----- END FROZEN SNAPSHOT -----",
  ].join("\n");
}

/* -------------------------------------------------------------- the parse */

/** What a provider printed, once it is known to be the shape we asked for. */
export interface AgentReply {
  readonly reviewedHash: string;
  readonly verdict: string;
  readonly points: readonly ReviewPoint[];
}

export type ParsedReply =
  | { readonly ok: true; readonly reply: AgentReply }
  | { readonly ok: false; readonly why: string };

/**
 * The outermost balanced JSON object in a blob of text, or null.
 *
 * A CLI prints its own chrome around an answer — a banner, a token count, a
 * trailing newline — so "the whole of stdout is JSON" is not a safe assumption
 * even when the prompt asked for exactly that. Scanning for a balanced object
 * is, and it is string-aware so a `{` inside a quoted evidence excerpt cannot
 * unbalance the scan.
 */
export function outermostJsonObject(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

const isStance = (v: unknown): v is Stance => typeof v === "string" && (STANCES as readonly string[]).includes(v);
const isConfidence = (v: unknown): v is Confidence =>
  typeof v === "string" && (CONFIDENCES as readonly string[]).includes(v);

/**
 * Turn what a provider printed into the reply we asked for, or say why not.
 *
 * Every rejection names the field, because the raw text is kept on the failed
 * job and the next reader's question is always "what exactly was wrong with
 * it". A parser that returns a bare false teaches nothing.
 */
export function parseAgentReply(raw: string): ParsedReply {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, why: "It printed nothing at all, so there is no answer to read." };
  const json = outermostJsonObject(text);
  if (json === null) {
    return { ok: false, why: "Its answer contained no JSON object, and the reply format asks for exactly one." };
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, why: `Its answer looked like JSON and did not parse (${(error as Error)?.name ?? "error"}).` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, why: "Its answer parsed to something that is not a JSON object." };
  }
  const record = value as Record<string, unknown>;
  const reviewedHash = record.reviewedHash;
  const verdict = record.verdict;
  if (typeof reviewedHash !== "string" || reviewedHash.trim() === "") {
    return { ok: false, why: "Its answer carried no `reviewedHash`, so it never echoed back what it was given." };
  }
  if (typeof verdict !== "string" || verdict.trim() === "") {
    return { ok: false, why: "Its answer carried no `verdict`, so it reached no overall conclusion." };
  }
  const rawPoints = record.points;
  if (!Array.isArray(rawPoints)) {
    return { ok: false, why: "Its answer carried no `points` array, so there is nothing to compare against the other reviewer." };
  }
  const points: ReviewPoint[] = [];
  for (const [i, entry] of rawPoints.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, why: `Point ${i + 1} is not an object.` };
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.topic !== "string" || p.topic.trim() === "") return { ok: false, why: `Point ${i + 1} has no topic, and a point with no topic cannot be agreed or disagreed with.` };
    if (!isStance(p.stance)) return { ok: false, why: `Point ${i + 1} ("${p.topic}") has stance ${JSON.stringify(p.stance)}, which is not one of ${STANCES.join(", ")}.` };
    if (typeof p.says !== "string" || p.says.trim() === "") return { ok: false, why: `Point ${i + 1} ("${p.topic}") says nothing.` };
    if (!isConfidence(p.confidence)) return { ok: false, why: `Point ${i + 1} ("${p.topic}") has confidence ${JSON.stringify(p.confidence)}, which is not one of ${CONFIDENCES.join(", ")}.` };
    points.push({
      topic: p.topic,
      stance: p.stance,
      says: p.says,
      confidence: p.confidence,
      evidence: typeof p.evidence === "string" ? p.evidence : "",
    });
  }
  if (points.length === 0) {
    return { ok: false, why: "Its answer carried an empty `points` array, so it named nothing it had checked." };
  }
  return { ok: true, reply: { reviewedHash, verdict, points } };
}

/**
 * The conclusion for one seat, or a throw that becomes a FAILED job.
 *
 * `reviewedHash` is recorded EXACTLY as the reviewer echoed it, including when
 * it does not match the hash it was given. That mismatch is a real reading —
 * `proveIsolation` turns it into `eachReviewedWhatItWasGiven: false` — and
 * quietly substituting the correct hash here would forge the very proof the
 * field exists to supply.
 */
export function conclusionFrom(
  assignment: ReviewerAssignment,
  raw: string,
  startedAt: string,
  completedAt: string,
): ReviewerConclusion {
  const parsed = parseAgentReply(raw);
  if (!parsed.ok) {
    throw new Error(
      `${assignment.provider} answered the review for ${assignment.reviewId} in a shape this bridge ` +
        `cannot read: ${parsed.why} Nothing was inferred from it — a review that cannot be read is not a review.`,
    );
  }
  return {
    slot: assignment.slot,
    provider: assignment.provider,
    reviewedHash: parsed.reply.reviewedHash,
    verdict: parsed.reply.verdict,
    points: parsed.reply.points,
    startedAt,
    completedAt,
  };
}

/**
 * Did the reviewer echo back the hash it was actually given?
 *
 * Reported separately rather than enforced, so a run whose reviewer paraphrased
 * its hash is recorded as a run whose isolation could not be proven — not
 * discarded, and not silently passed.
 */
export function echoedItsOwnSnapshot(assignment: ReviewerAssignment, conclusion: ReviewerConclusion): boolean {
  return conclusion.reviewedHash === assignment.snapshot.hash;
}

/**
 * The provider whose launcher name this is, or null.
 *
 * `run-host.ts` needs the mapping in this direction to decide which declared
 * install directories to look in, and deriving it from the closed table keeps
 * one table rather than two that can disagree.
 */
export function providerForLauncher(launcher: string): AgentProviderId | null {
  for (const [provider, spec] of Object.entries(LAUNCHERS)) {
    if (spec.launcher === launcher) return provider as AgentProviderId;
  }
  return null;
}
