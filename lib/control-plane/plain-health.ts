/**
 * **PILOT HEALTH IN PLAIN WORDS, WITH THE SCALE SHOWN.** (ADM-3, 9.4.26.)
 *
 * The owner's words: "It says amber. I don't even know the grading scale
 * here. Is it green, amber, or red?" and "it's completely unnecessarily
 * verbose. It needs really plain English words as to what's going on."
 *
 * The health TRUTH is unchanged and lives where it lived: the three
 * contracts in `lib/health/contracts.ts` and `pilotHealthView` in
 * owner-surface.ts. This module is presentation only — a pure projection of
 * a contract card into four short sentences an operator reads first:
 *
 *   what      what this contract measures (fixed, per contract)
 *   status    what state it is in, in words, with the number where there is one
 *   why       the plain reason it is in that state
 *   next      what happens next, as an action
 *
 * The instrument's own sentence (the `reason` the contract emitted, with its
 * run ids and thresholds) stays available behind a disclosure — nothing is
 * hidden, it just does not lead. Where the instrument's reason carries a
 * pattern this module recognises (a stale run past a tolerance, the shadow
 * scheduler's risk reading, an empty corpus), the plain sentence is derived
 * from it; otherwise the instrument's reason is quoted as the "why", which is
 * still one sentence.
 */
import type { ContractCard, HealthLevel, OwnerContractReading } from "./owner-surface.ts";

export interface PlainContract {
  readonly contract: string;
  readonly level: HealthLevel;
  readonly what: string;
  readonly status: string;
  readonly why: string;
  readonly next: string;
}

/** The scale, as the page shows it beside every grade. */
export const HEALTH_SCALE: readonly { readonly level: HealthLevel; readonly means: string }[] = [
  { level: "GREEN", means: "all three contracts are met, each on its own count" },
  { level: "AMBER", means: "not proven yet — a check is missing, too old to count, or waiting on your data" },
  { level: "RED", means: "a contract is measurably failing" },
  { level: "UNKNOWN", means: "no reading has been published" },
];

const WHAT: Record<string, string> = {
  READER:
    "Can a reader get a right answer? We ask the product a fixed set of questions about real places and count how many come back correct.",
  TRUTH:
    "Is what we say true? A hidden answer key of known facts is checked against what the product says, in both directions.",
  FRESHNESS:
    "Is it up to date? The scheduler's clock: whether every record we owe is refreshed on time.",
};

/**
 * What has to happen next, in ordinary words — **never a command** (ADM-37).
 *
 * The owner read `Next: To prove it: run the reader suite again (\`pnpm
 * reader:suite\`)` and answered: *"What has to happen? Think of someone who is
 * not an engineer and not a coder at all."* A shell command on the face of an
 * operator console is an instruction he cannot carry out and a fact he cannot
 * use.
 *
 * So each contract states the next step as a thing that happens, and the page
 * puts the control beside it. `control` names which control that is:
 *
 * ```
 *   RUN_CYCLE   a real, existing owner intent the runner honours
 *   QUEUE       there is no admin-side execution seam for this check; the
 *               honest control is to put it on the fix queue for a session
 * ```
 *
 * FRESHNESS is the one that can be advanced from here today. The reader suite
 * and the control set are produced by a work session on the runner machine and
 * nothing schedules them, so this module says that rather than inventing a
 * button that would do nothing, or promising a "next scheduled check" that no
 * scheduler runs.
 */
export type HealthControl = "RUN_CYCLE" | "QUEUE";

const NEXT_STEP: Record<string, { readonly says: string; readonly control: HealthControl; readonly expectation: string }> = {
  READER: {
    says: "The reader check has to be run again on the machine that runs it. Nothing schedules it today, so it happens when a work session runs it.",
    control: "QUEUE",
    expectation: "Putting it on the queue is what gets a session to run it; this card turns green once a fresh run passes.",
  },
  TRUTH: {
    says: "The hidden answer key has to be checked against the product again. Nothing schedules it today, so it happens when a work session runs it.",
    control: "QUEUE",
    expectation: "Putting it on the queue is what gets a session to run it; this card turns green once a fresh run passes.",
  },
  FRESHNESS: {
    says: "The runner has to cycle, and the scheduler leaves shadow once its results are reproduced independently.",
    control: "RUN_CYCLE",
    expectation: "A cycle takes about fifteen minutes. This card turns green once the scheduler's results have been independently reproduced.",
  },
};

/** What has to happen next for a contract, and which control does it. */
export function nextStepFor(contract: string): { readonly says: string; readonly control: HealthControl; readonly expectation: string } {
  return (
    NEXT_STEP[contract] ?? {
      says: "This check has to be run again.",
      control: "QUEUE",
      expectation: "Putting it on the queue is what gets a session to run it.",
    }
  );
}

function hoursText(h: number): string {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? "" : "s"}`;
}

/** Derive the plain "why" from the instrument's reason where a pattern is known. */
export function plainWhy(reading: OwnerContractReading): string {
  const r = reading.reason;
  const stale = r.match(/finished (\d+(?:\.\d+)?)h ago, past the (\d+)h freshness tolerance/);
  if (stale) {
    return `The newest check is ${hoursText(Number(stale[1]))} old, past the ${stale[2]}-hour limit, so it does not count as current.`;
  }
  if (/questions loaded — awaiting owner corpus/.test(r)) {
    return "No questions are loaded yet, so there is nothing to ask the product.";
  }
  if (/controls loaded — awaiting owner answer key/.test(r)) {
    return "No answer key is loaded yet, so there is nothing to check against.";
  }
  const risk = r.match(/measured staleness risk: (\d+) obligation\(s\) carry a derived next-due, (\d+) could not be scheduled[^,]*, (\d+) overdue, (\d+) debt row\(s\) across (\d+) incident\(s\)/);
  if (risk) {
    return `The scheduler is running in shadow: ${risk[1]} obligations are scheduled, ${risk[2]} could not be, ${risk[3]} are overdue, and ${risk[4]} debt rows sit behind ${risk[5]} incidents. It observes and records; it does not yet change what a reader sees.`;
  }
  if (/Session B deliverable/.test(r)) {
    return "The freshness clock is not switched on as the authority yet; the scheduler is still in shadow.";
  }
  if (reading.state === "GREEN") {
    return "The bar is met on this contract's own count.";
  }
  // Unknown pattern: the instrument's own sentence, first clause, capitalised.
  const first = r.split(/[;.]/)[0]?.trim() ?? r;
  return first.length === 0 ? r : `${first[0].toUpperCase()}${first.slice(1)}.`;
}

export function plainContract(card: ContractCard, reading: OwnerContractReading): PlainContract {
  const count = card.denominator.held
    ? `${card.denominator.value.value} of ${card.denominator.value.denominator}`
    : null;
  let status: string;
  switch (card.level) {
    case "GREEN":
      status = count ? `Met — ${count} right.` : "Met.";
      break;
    case "RED":
      status = count ? `Failing — ${count} right.` : "Failing.";
      break;
    case "AMBER":
      status =
        reading.state === "AWAITING_OWNER_DATA"
          ? "Waiting on your data."
          : count
            ? `Not proven yet — the last check scored ${count}, but it is too old to count.`
            : "Not proven yet.";
      break;
    default:
      status = "No reading.";
  }
  const why = plainWhy(reading);
  let next: string;
  switch (card.level) {
    case "GREEN":
      next = "Nothing to do; the next check keeps it current.";
      break;
    case "RED":
      next = `Investigate the failures. ${nextStepFor(card.contract).says}`;
      break;
    case "AMBER":
      next =
        reading.state === "AWAITING_OWNER_DATA"
          ? "Load the owner corpus or answer key this contract measures against."
          : nextStepFor(card.contract).says;
      break;
    default:
      next = "Publish a snapshot so there is something to read.";
  }
  return {
    contract: card.contract,
    level: card.level,
    what: WHAT[card.contract] ?? "What this contract measures is not described.",
    status,
    why,
    next,
  };
}

/** The one-sentence overall reading, plain. */
export function plainOverall(level: HealthLevel, cards: readonly PlainContract[]): string {
  switch (level) {
    case "GREEN":
      return "All three contracts are met.";
    case "RED": {
      const failing = cards.filter((c) => c.level === "RED").map((c) => c.contract);
      return `${failing.join(" and ")} ${failing.length === 1 ? "is" : "are"} failing; the rest ${cards.length - failing.length === 1 ? "is" : "are"} not.`;
    }
    case "AMBER": {
      const unproven = cards.filter((c) => c.level !== "GREEN").map((c) => c.contract);
      return `Nothing is failing, but ${unproven.join(", ")} ${unproven.length === 1 ? "is" : "are"} not proven yet.`;
    }
    default:
      return "No pilot-health reading has been published yet.";
  }
}
