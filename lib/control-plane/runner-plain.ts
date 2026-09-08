/**
 * **THE RUNNER CARD, REBUILT AROUND THE FOUR QUESTIONS.** (ADM-24, ADM-27,
 * ADM-30; §9A.3 of the Admin C brief, 2026-09-06.)
 *
 * The owner, reading the old card:
 *
 * > *"Under Runner. It's just so squished together. I don't know what it is
 * > that I'm even looking at… Runner, what is a runner? I'm sorry I just don't
 * > know what a runner is… Why did work stopped? Cycle Deferred. The cycle's
 * > dispatch budget was spent at September 6, 2026, 9:10 pm Eastern. Before this
 * > item was reached, it keeps its Next Due and is dispatched by a later cycle…
 * > What is that saying? Why did work stop? Budget reached. That's it, that's
 * > all. You can say, 'Budget reached 9:10 pm Eastern September 6, 2026,' and
 * > then give me a will-resume time. That's all I want there."*
 *
 * So the face of the card is four lines and nothing else:
 *
 * ```
 *   what      what a runner IS — the thing that starts a cycle of work
 *   when      last run, next run, on schedule or not
 *   did       what this cycle actually did, in one sentence
 *   stopped   why work stopped, and when it resumes
 *   + Needs you: Yes/No
 * ```
 *
 * Host, SHA, model lane, credential state, request and payload ceilings,
 * circuit-breaker internals and the sixty-word supervisor explanation all move
 * behind `Technical details`. Nothing is removed; it stops leading.
 *
 * PURE. Snapshot and clock in, sentences out. No store, no environment.
 */
import type { FleetNamedDeferral, FleetSafetySnapshot } from "./fleet-safety.ts";
import { ageWords, count, plainCode, plainMeaning } from "./plain-words.ts";
import type { RunnerStanding } from "./runner-standing.ts";
import type { RunnerHeartbeat } from "./owner-surface.ts";

/** Whether the card needs the owner, and what he should do. */
export interface RunnerNeeds {
  readonly needed: boolean;
  readonly action: string | null;
}

/** A group of deferred work, by the reason it was deferred. */
export interface DeferralGroup {
  readonly code: string;
  /** The reason as words. */
  readonly words: string;
  /** What it means, one sentence. */
  readonly means: string | null;
  readonly items: number;
  /** Up to a handful of names, for the disclosure. Never the whole list. */
  readonly examples: readonly string[];
}

export interface RunnerFace {
  /** What a runner IS. Fixed; the owner asked the question outright. */
  readonly what: string;
  /** Its state as a word: Active, Paused by you, Late, Silent. */
  readonly state: string;
  /** What it did this cycle, one sentence. */
  readonly did: string;
  /**
   * Why work stopped and when it resumes, in one sentence — or null when
   * nothing stopped it.
   */
  readonly stopped: string | null;
  /** Every stop reason as words, for the disclosure. */
  readonly stopReasons: readonly { readonly words: string; readonly means: string | null }[];
  /** The circuit-breaker line, always a sentence and never a bare "none". */
  readonly circuits: string;
  /** The deferred work, as a count and a sentence — never a list of thousands. */
  readonly deferred: { readonly total: number; readonly says: string; readonly groups: readonly DeferralGroup[] } | null;
  readonly needs: RunnerNeeds;
}

/** What the runner IS, in one sentence, for an owner who asked. */
export const WHAT_A_RUNNER_IS =
  "The runner is the program on your own machine that wakes up on a schedule, starts a cycle of research and refresh work, and writes down what happened.";

/**
 * The stop-reason codes the fleet emits, in the order they should be reported.
 *
 * ## Why CYCLE_DEFERRED moved to the bottom (ADM-51, the 9.7.26 feedback)
 *
 * The owner read *"Why work stopped: Budget reached at 11:20 PM ET"* beside a
 * spend table reading `$0.00` on every row, and asked the obvious question.
 *
 * `CYCLE_DEFERRED` is not a code the safety controller emits. It is the
 * FALLBACK the shadow loop applies to any deferral whose reason text does not
 * begin with a SCREAMING_SNAKE code, and at least three lower-case reasons fall
 * into it — the cycle's wall clock, a stated deterministic ceiling, and the
 * debt backoff. None of them is a dollar.
 *
 * Ranking that residual ABOVE `DISPATCH_CEILING` and `WALL_CLOCK_CEILING` meant
 * the catch-all outranked the two specific codes it was standing in for: when a
 * cycle emitted both, the owner was shown the vaguest one. A residual must
 * report LAST, so that any code that names itself wins.
 */
const STOP_PRIORITY: readonly string[] = [
  "PROVIDER_CIRCUIT_BROKEN",
  "SCHEDULED_BLACKOUT",
  "UNMEASURED_MODEL_SPEND",
  "ROLLING_24_HOUR_MODEL_SPEND_CEILING",
  "OPERATIONAL_NIGHT_MODEL_SPEND_CEILING",
  "CYCLE_MODEL_SPEND_CEILING",
  "DISPATCH_CEILING",
  "PROVIDER_REQUEST_CEILING",
  "PAYLOAD_BYTE_CEILING",
  "WALL_CLOCK_CEILING",
  // ADM-51: the admission window closing. It used to have no code and fall
  // into the residual below, where it was rendered as "Budget reached".
  "CYCLE_TIME_EXHAUSTED",
  // The residual, last: it means "something deferred this and did not name
  // itself", which is the least useful thing that can be said about a cycle.
  "CYCLE_DEFERRED",
];

/**
 * The code inside an instrument's stop sentence.
 *
 * `stoppedBecause` entries are shaped `CODE: prose`, and several are joined
 * with `; `. This pulls the codes out without reading the prose, because the
 * prose is exactly what the owner asked us to stop showing him.
 */
export function stopCodesIn(sentences: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:/g)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
  }
  return found.sort((a, b) => {
    const ai = STOP_PRIORITY.indexOf(a);
    const bi = STOP_PRIORITY.indexOf(b);
    return (ai < 0 ? STOP_PRIORITY.length : ai) - (bi < 0 ? STOP_PRIORITY.length : bi);
  });
}

/**
 * The moment the instrument named inside its own sentence, if it named one.
 *
 * The fleet writes `spent at 2026-09-07T04:31:00.000Z before this item was
 * reached`. The owner asked for that time and nothing else from the sentence.
 */
export function stopMomentIn(sentences: readonly string[]): string | null {
  for (const sentence of sentences) {
    const m = sentence.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/);
    if (m) return m[1];
  }
  return null;
}

/** Group the named deferrals by their code so a count leads and a list follows. */
export function groupDeferrals(deferred: readonly FleetNamedDeferral[]): readonly DeferralGroup[] {
  const byCode = new Map<string, FleetNamedDeferral[]>();
  for (const d of deferred) {
    const list = byCode.get(d.code);
    if (list) list.push(d);
    else byCode.set(d.code, [d]);
  }
  return [...byCode.entries()]
    .map(([code, items]) => ({
      code,
      words: plainCode(code),
      means: plainMeaning(code),
      items: items.length,
      examples: items.slice(0, 5).map((i) => i.work),
    }))
    .sort((a, b) => b.items - a.items);
}

/**
 * The runner card's face.
 *
 * `resumesAt` is the heartbeat's recorded next-due, already an ISO string; the
 * component renders it in Eastern. A null next-due is NOT "not scheduled" — the
 * runner not writing one down is a fact about the record, not about the
 * schedule — so the sentence says which.
 */
export function runnerFace(input: {
  readonly standing: RunnerStanding;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly safety: FleetSafetySnapshot | null;
  /** Rendered as Eastern by the caller; passed in already formatted. */
  readonly resumesAtWords: string | null;
  readonly stoppedAtWords: string | null;
  /** Dispatches this cycle and what came of them, from the digest. */
  readonly didThisCycle: string | null;
}): RunnerFace {
  const safety = input.safety;
  const codes = safety ? stopCodesIn(safety.stoppedBecause) : [];
  const stopReasons = codes.map((c) => ({ words: plainCode(c), means: plainMeaning(c) }));

  let stopped: string | null = null;
  if (codes.length > 0) {
    const lead = plainCode(codes[0]);
    const when = input.stoppedAtWords ? ` at ${input.stoppedAtWords}` : "";
    const resumes = input.resumesAtWords
      ? ` Work resumes with the next cycle at ${input.resumesAtWords}.`
      : " The runner did not write down when the next cycle is due, so this page will not guess.";
    stopped = `${lead}${when}.${resumes}`;
  }

  const did =
    input.didThisCycle ??
    (safety === null
      ? "This cycle's activity has not been recorded yet."
      : safety.cycle.dispatches === 0
        ? "Nothing was started this cycle — it reached a limit before it got to any work. Everything it owed is still owed."
        : `Started ${count(safety.cycle.dispatches)} piece${safety.cycle.dispatches === 1 ? "" : "s"} of work and made ${count(safety.cycle.requests)} request${safety.cycle.requests === 1 ? "" : "s"} to outside sources.`);

  const live = (safety?.providerCircuits ?? []).filter((c) => c.eligibleAt !== "");
  const circuits =
    live.length === 0
      ? "No data source is currently being throttled."
      : `${live.length} source${live.length === 1 ? " is" : "s are"} paused after refusing us: ${live
          .map((c) => c.provider)
          .join(", ")}. Each retries by itself once its pause ends.`;

  const deferrals = safety?.deferred ?? [];
  const deferred =
    deferrals.length === 0
      ? null
      : {
          total: deferrals.length,
          says: `${count(deferrals.length)} item${deferrals.length === 1 ? " was" : "s were"} moved to a later cycle because this one ran out of budget. Nothing was dropped; each keeps its place in line.`,
          groups: groupDeferrals(deferrals),
        };

  const needs = runnerNeeds(input.standing, safety);

  return {
    what: WHAT_A_RUNNER_IS,
    state: plainCode(input.standing.state),
    did,
    stopped,
    stopReasons,
    circuits,
    deferred,
    needs,
  };
}

/**
 * Does the runner need the owner right now?
 *
 * A budget ceiling never does — that is the system working as designed, and the
 * whole point of §9A.3's rewrite is that "budget reached" stops reading as an
 * alarm. A silent runner with no recorded pause does, and so does a latched
 * provider circuit, because neither clears itself.
 */
export function runnerNeeds(standing: RunnerStanding, safety: FleetSafetySnapshot | null): RunnerNeeds {
  if (standing.state === "SILENT") {
    return { needed: true, action: "the runner has stopped and nothing says you meant it — restart it, or record that you paused it" };
  }
  if (standing.state === "NEVER_BEAT") {
    return { needed: true, action: "the runner has never reported in — start it on the machine that runs it" };
  }
  if ((safety?.providerCircuits.length ?? 0) > 0) {
    return { needed: true, action: "a source refused us in a way retrying will not fix — see which one under Technical details" };
  }
  if (standing.state === "PAUSED") {
    return { needed: true, action: "it is paused; resume it when you are ready" };
  }
  return { needed: false, action: null };
}

/** The runner card's headline age line, for the disclosure. */
export function beatAgeWords(sinceBeatMinutes: number | null): string {
  if (sinceBeatMinutes === null) return "no heartbeat on record";
  return `last heard from ${ageWords(sinceBeatMinutes / 60)} ago`;
}
