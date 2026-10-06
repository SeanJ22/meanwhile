/**
 * **THE TYPED DETERMINISTIC QUERIES — one per question the console answers.**
 * (ADM-C7, the 9.6.26 Operator Control Room brief.)
 *
 * > Deterministic status questions should use deterministic read models. **Do
 * > not invoke a model merely to answer an exact database/status question when
 * > a typed deterministic query exists.**
 *
 * These are those queries. Each takes an {@link OperatorContext} — records
 * already read, each carrying which of the store's three answers it got — and
 * returns a {@link ChatAnswer}: sentences, the sources behind them, one number
 * with its denominator, whether the owner is needed, and the named gaps for
 * everything the answer could not cover.
 *
 * ## Nothing here derives a projection that already exists
 *
 * RULING 103 is the reason this module is mostly composition. The runner's
 * standing comes from `runnerStanding`, the fleet's shape from `buildFleetView`,
 * the decision split from `splitDecided`, the code identities from
 * `codeIdentityLine`, the plain words from `plain-words.ts`. A second reading of
 * "is the runner paused" written here would disagree with the page the first
 * time either changed, and the owner would be told two different things by one
 * console.
 *
 * ## Absence is argued, never asserted
 *
 * Every one of these can be asked when a record is missing or a store is down,
 * and none of them answers zero. A reading that is not HELD becomes a named
 * {@link Gap} on the answer with the owner of the gap attached, and the
 * sentence that would have used it is not written at all.
 *
 * PURE. No store, no clock, no environment, no model — `nowIso` arrives on the
 * context.
 */

import { formatEastern } from "../eastern-time.ts";
import { yesterdayWindow } from "../admin-view/cost-reporting-view.ts";
import { ageWords, count, plainCode, plainText, usdCents } from "../plain-words.ts";
import { codeIdentityLine } from "../code-identity.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { splitDecided } from "../decision-receipt.ts";
import { fixQueueView } from "../fix-queue.ts";
import { buildFleetView, whereOf } from "../fleet-view.ts";
import { decisionCardKind, measured, type Gap, type Held } from "../owner-surface.ts";
import { readIntents } from "../scheduler/research-policy.ts";
import { runnerStanding } from "../runner-standing.ts";
import type { Attempt } from "../attempt.ts";
import { spendAnswer } from "../admin-view/flow-rows.ts";
import { holding, type OperatorContext } from "./context.ts";
import {
  topicDefinition,
  type AnswerDenominator,
  type AnswerSource,
  type ChatAnswer,
  type ChatNeedsYou,
  type ChatTopic,
} from "./contract.ts";

/* ------------------------------------------------------------- assembling */

/**
 * The one place an answer is built, so every answer carries the same four
 * things and `usedModel` cannot be forgotten on one of them.
 */
interface Draft {
  readonly says: readonly string[];
  readonly denominator: Held<AnswerDenominator>;
  readonly sources: readonly AnswerSource[];
  readonly needsYou: ChatNeedsYou;
  readonly gaps: readonly Gap[];
  readonly detail: readonly string[];
}

function assemble(topic: ChatTopic, draft: Draft): ChatAnswer {
  const definition = topicDefinition(topic);
  return {
    topic,
    understoodAs: definition.asks,
    says: draft.says,
    denominator: draft.denominator,
    sources: draft.sources,
    needsYou: draft.needsYou,
    gaps: draft.gaps,
    // Stated rather than defaulted: the brief asks that an answer which used a
    // model says so, and the honest form of that on a console which never
    // calls one is to carry the field and say the opposite out loud.
    usedModel: false,
    readBackAt: definition.readBackAt,
    detail: draft.detail,
  };
}

/** A denominator, with its sentence, refusing every shape `measured` refuses. */
function denominator(
  says: string,
  value: number,
  of: number,
  contract: string,
  from: string,
): Held<AnswerDenominator> {
  return { held: true, value: { says, measured: measured(value, of, contract, from) } };
}

/** A gap where the number would have been, in the words of the reading that failed. */
function noNumber(gapValue: Gap): Held<AnswerDenominator> {
  return { held: false, gap: gapValue };
}

/** Collect the gap out of a holding, for the answer's gap list. */
function gapsOf(...holdings: readonly Held<unknown>[]): readonly Gap[] {
  return holdings.filter((h) => !h.held).map((h) => (h as { gap: Gap }).gap);
}

function source(says: string, at: string | null, raw: string): AnswerSource {
  return { says, at, raw };
}

const NOTHING_NEEDED: ChatNeedsYou = { needed: false };

/* ------------------------------------------------------------------ topic 1 */

/**
 * "What is blocking the Fleet?"
 *
 * Four domains in one answer, which is what makes it the cross-domain case:
 * the runner's own standing, the safety record it wrote at the end of its last
 * cycle, the work on record, and the incidents in the published snapshot. Each
 * contributes only if it was read; none of them substitutes for another.
 */
export function fleetBlockers(ctx: OperatorContext): ChatAnswer {
  const heartbeat = holding(ctx.heartbeat, "the runner's heartbeat");
  const research = holding(ctx.research, "the safety record the runner writes at the end of every cycle");
  const intents = holding(ctx.intents, "the intents you have recorded for the runner");
  const fleet = holding(ctx.fleet, "the work items, route tasks and attempts on record");
  const snapshot = holding(ctx.snapshot, "the published control-centre snapshot");

  const says: string[] = [];
  const detail: string[] = [];
  const sources: AnswerSource[] = [];
  let needsYou: ChatNeedsYou = NOTHING_NEEDED;

  const safety = research.held ? (research.value.fleetSafety ?? null) : null;

  if (heartbeat.held) {
    const standing = runnerStanding(
      heartbeat.value,
      intents.held ? intents.value : [],
      ctx.nowIso,
      safety,
    );
    says.push(`The runner is ${standing.headline.toLowerCase()}. ${standing.detail}`);
    detail.push(`runner standing state ${standing.state}; control ${standing.control}`);
    sources.push(source("the heartbeat the runner writes at the end of every cycle", heartbeat.value.beatAt, "cp_runner_heartbeat #pilot-runner"));
    if (standing.control === "RESUME_RUNNER") {
      needsYou = { needed: true, action: "resume the runner when you want it working again" };
    }
  }

  if (safety !== null) {
    sources.push(source("the safety record the runner wrote for its last cycle", safety.cycle.startedAt, "cp_research_state #level-1 · fleetSafety"));
    if (safety.stoppedBecause.length > 0) {
      says.push(
        `Work stopped ${safety.stoppedBecause.length === 1 ? "for one reason" : `for ${count(safety.stoppedBecause.length)} reasons`} in that cycle: ${safety.stoppedBecause.map((s) => plainText(s)).join("; ")}.`,
      );
      detail.push(...safety.stoppedBecause);
    } else {
      says.push("Nothing recorded a stop in that cycle — the runner reached its own end rather than a limit.");
    }
    if (safety.deferred.length > 0) {
      const first = safety.deferred[0];
      says.push(
        `${count(safety.deferred.length)} ${safety.deferred.length === 1 ? "item was" : "items were"} set aside by name; the first is ${plainCode(first.code).toLowerCase()} — ${plainText(first.why)}`,
      );
      detail.push(...safety.deferred.map((d) => `${d.work} — ${d.code}: ${d.why}`));
    }
    const activeCircuits = safety.providerCircuits.filter(circuit => Date.parse(circuit.eligibleAt) > Date.parse(ctx.nowIso));
    if (activeCircuits.length > 0) {
      says.push(
        `${count(activeCircuits.length)} ${activeCircuits.length === 1 ? "provider is" : "providers are"} paused after refusing work: ${activeCircuits.map((c) => `${c.provider} until ${formatEastern(c.eligibleAt)}`).join("; ")}.`,
      );
    }
    const eligibleCircuits = safety.providerCircuits.filter(circuit => Date.parse(circuit.eligibleAt) <= Date.parse(ctx.nowIso));
    if (eligibleCircuits.length > 0) says.push(
      `${count(eligibleCircuits.length)} ${eligibleCircuits.length === 1 ? "provider is" : "providers are"} eligible to retry: ${eligibleCircuits.map(circuit => `${circuit.provider} after ${circuit.condition}`).join("; ")}.`,
    );
    detail.push(...safety.providerCircuits.map((c) => `${c.provider} — ${c.condition}; eligible ${c.eligibleAt}`));
    if (safety.rolling24Hours.modelUsd !== null) {
      says.push(
        `Paid model work over the last 24 hours came to ${usdCents(safety.rolling24Hours.modelUsd)} against a ceiling of ${usdCents(safety.bounds.rolling24HourModelUsd)}.`,
      );
    }
  }

  let number: Held<AnswerDenominator>;
  if (fleet.held) {
    const held = fleet.value;
    const stuck = held.workItems.filter((w) =>
      w.state === "BLOCKED" ||
      w.state === "AWAITING_OWNER" ||
      w.state === "AUTHOR_DECISION_REQUIRED" ||
      w.state === "HUMAN_INTERACTION_REQUIRED" ||
      w.state === "RECORDS_REQUEST_REQUIRED",
    );
    const view = buildFleetView({ nowIso: ctx.nowIso, ...held });
    says.push(
      `Of the work on record, ${count(stuck.length)} ${stuck.length === 1 ? "item is" : "items are"} held up rather than moving, and ${count(view.workingNow)} ${view.workingNow === 1 ? "attempt is" : "attempts are"} open right now.`,
    );
    if (stuck.some((w) => w.state === "AWAITING_OWNER" || w.state === "AUTHOR_DECISION_REQUIRED")) {
      needsYou = { needed: true, action: "answer the work that is waiting on a decision from you" };
    }
    detail.push(
      ...stuck.slice(0, 5).map((w) => `${w.id} ${w.state} — ${w.obligation}`),
    );
    sources.push(source("the work items, route tasks and attempts in the control plane", ctx.nowIso, "cp_work_items · cp_route_tasks · cp_attempts"));
    number = denominator(
      `${count(stuck.length)} of the ${count(held.workItems.length)} work items on record are held up`,
      stuck.length,
      held.workItems.length,
      "How much of the registered work is not moving. It counts states that need something to change before a worker can proceed, not work that is simply queued behind other work.",
      "every WorkItem row in the control plane, counted at the instant this answer was built",
    );
  } else {
    number = noNumber(fleet.gap);
  }

  if (snapshot.held && snapshot.value.incidents.length > 0) {
    const worst = [...snapshot.value.incidents].sort((a, b) => (b.oldestHours ?? 0) - (a.oldestHours ?? 0))[0];
    says.push(
      `The published snapshot lists ${count(snapshot.value.incidents.length)} ${snapshot.value.incidents.length === 1 ? "incident" : "incidents"}; the longest-running is ${plainCode(worst.cause).toLowerCase()} against ${worst.target}${worst.oldestHours === null ? "" : `, ${ageWords(worst.oldestHours)} old`}.`,
    );
    sources.push(source("the control-centre snapshot the runner publishes after every cycle", snapshot.value.publishedAt, "cp_owner_snapshots #current"));
  }

  if (says.length === 0) {
    says.push("Nothing that would say what is blocking the Fleet could be read, so this answer names what is missing instead of guessing.");
  }

  return assemble("FLEET_BLOCKERS", {
    says,
    denominator: number,
    sources,
    needsYou,
    gaps: gapsOf(heartbeat, research, intents, fleet, snapshot),
    detail,
  });
}

/* ------------------------------------------------------------------ topic 2 */

/** "What changed since the last cycle?" */
export function sinceLastCycle(ctx: OperatorContext): ChatAnswer {
  const heartbeat = holding(ctx.heartbeat, "the runner's heartbeat");
  const digests = holding(ctx.digests, "the digests the runner writes after each cycle");
  const fleet = holding(ctx.fleet, "the attempts on record");

  const says: string[] = [];
  const detail: string[] = [];
  const sources: AnswerSource[] = [];
  /*
   * The default is a GAP rather than a zero, and which gap depends on which
   * reading failed: with no heartbeat there is no boundary to count from, and
   * with a heartbeat that carries no cycle start there is a record and no
   * boundary in it. Those are different facts and the sentence says which.
   */
  let number: Held<AnswerDenominator> = heartbeat.held
    ? noNumber({ whose: "OURS", says: "The heartbeat records no start time for the last cycle, so there is no boundary to count changes from." })
    : noNumber(heartbeat.gap);

  let startedAt: string | null = null;
  if (heartbeat.held) {
    const beat = heartbeat.value;
    startedAt = beat.lastCycleStartedAt;
    sources.push(source("the heartbeat the runner writes at the end of every cycle", beat.beatAt, "cp_runner_heartbeat #pilot-runner"));
    if (beat.lastCycleStartedAt !== null) {
      const finished = beat.lastCycleFinishedAt === null
        ? "and it has not recorded finishing"
        : `and finished ${formatEastern(beat.lastCycleFinishedAt)}`;
      const verdict = beat.lastCycleOk === null
        ? "The runner recorded no verdict on that cycle."
        : beat.lastCycleOk
          ? "The runner recorded that cycle as having gone through."
          : "The runner recorded that cycle as not having gone through.";
      says.push(`The last cycle started ${formatEastern(beat.lastCycleStartedAt)} ${finished}. ${verdict}`);
    } else {
      says.push("The heartbeat carries no start time for the last cycle, so there is no boundary to measure changes from.");
    }
    if (beat.testedSha !== null) detail.push(`runner executed ${beat.testedSha}`);
  }

  if (digests.held && digests.value.length > 0) {
    // `readDigests` reverses the log, so element zero is the newest.
    const latest = digests.value[0];
    says.push(`The digest the runner wrote says: ${plainText(latest.headline).trim()}`);
    sources.push(source("the digest the runner wrote for that cycle", latest.writtenAt, "cp_log_owner_digests #owner-digest"));
    detail.push(...latest.lines);
  }

  if (fleet.held) {
    const attempts = fleet.value.attempts;
    const since = startedAt === null ? [] : attempts.filter((a) => a.startedAt >= startedAt);
    if (startedAt !== null) {
      const finished = since.filter((a) => a.outcome !== null);
      const completed = since.filter((a) => a.outcome === "COMPLETED");
      says.push(
        `${count(since.length)} ${since.length === 1 ? "attempt has" : "attempts have"} started since that cycle began; ${count(finished.length)} ${finished.length === 1 ? "has" : "have"} ended and ${count(completed.length)} reached a finish.`,
      );
      number = denominator(
        `${count(since.length)} of the ${count(attempts.length)} attempts on record started since the last cycle began`,
        since.length,
        attempts.length,
        "How much of everything the Fleet has ever attempted belongs to the current cycle. A small share is normal; a share of zero on a running cycle means nothing was dispatched.",
        "every Attempt row in the control plane, compared against the cycle start on the runner's own heartbeat",
      );
      detail.push(...since.slice(0, 5).map((a) => `${a.id} ${a.worker.role} ${a.outcome ?? "open"} ${a.startedAt}`));
    }
    sources.push(source("every attempt the Fleet has recorded", ctx.nowIso, "cp_attempts"));
  }

  if (says.length === 0) {
    says.push("Nothing that would say what changed could be read, so this answer names what is missing instead of guessing.");
  }

  return assemble("SINCE_LAST_CYCLE", {
    says,
    denominator: number,
    sources,
    needsYou: NOTHING_NEEDED,
    gaps: gapsOf(heartbeat, digests, fleet),
    detail,
  });
}

/* ------------------------------------------------------------------ topic 3 */

/** "Which sources are overdue?" */
export function overdueSources(ctx: OperatorContext): ChatAnswer {
  const snapshot = holding(ctx.snapshot, "the published control-centre snapshot");
  if (!snapshot.held) {
    return assemble("OVERDUE_SOURCES", {
      says: ["The snapshot that carries the freshness debt could not be read, so nothing is being said about which sources are overdue."],
      denominator: noNumber(snapshot.gap),
      sources: [],
      needsYou: NOTHING_NEEDED,
      gaps: [snapshot.gap],
      detail: [],
    });
  }

  const snap = snapshot.value;
  const says: string[] = [];
  const detail: string[] = [];
  const gaps: Gap[] = [];

  let number: Held<AnswerDenominator>;
  if (snap.freshnessDebtRows.held) {
    const debt = snap.freshnessDebtRows.value;
    says.push(`${count(debt.value)} of the ${count(debt.denominator)} refresh obligations are overdue. ${debt.contract}`);
    number = denominator(
      `${count(debt.value)} of the ${count(debt.denominator)} refresh obligations are overdue`,
      debt.value,
      debt.denominator,
      debt.contract,
      debt.denominatorSource,
    );
  } else {
    says.push(snap.freshnessDebtRows.gap.says);
    gaps.push(snap.freshnessDebtRows.gap);
    number = noNumber(snap.freshnessDebtRows.gap);
  }

  const byProvider = [...snap.obligationsByProvider].sort((a, b) => b.count.value - a.count.value);
  if (byProvider.length > 0) {
    const top = byProvider.slice(0, 5);
    says.push(
      `By provider, the most owed are: ${top.map((r) => `${r.provider.replace(/-/g, " ")} (${count(r.count.value)} of ${count(r.count.denominator)})`).join("; ")}.`,
    );
    detail.push(...byProvider.map((r) => `${r.provider}: ${r.count.value}/${r.count.denominator} — ${r.count.contract}`));
  }

  const byState = [...snap.obligationsByState].sort((a, b) => b.count.value - a.count.value);
  if (byState.length > 0) {
    const top = byState.slice(0, 5);
    says.push(`By state, the most owed are: ${top.map((r) => `${r.state} (${count(r.count.value)})`).join("; ")}.`);
    detail.push(...byState.map((r) => `${r.state}: ${r.count.value}/${r.count.denominator}`));
  }

  if (snap.incidents.length > 0) {
    says.push(
      `${count(snap.incidents.length)} ${snap.incidents.length === 1 ? "incident is" : "incidents are"} recorded against those obligations: ${snap.incidents
        .slice(0, 4)
        .map((i) => `${plainCode(i.cause).toLowerCase()} at ${i.target} (${count(i.obligationsAffected)} affected${i.oldestHours === null ? "" : `, oldest ${ageWords(i.oldestHours)}`})`)
        .join("; ")}.`,
    );
    detail.push(...snap.incidents.map((i) => `${i.cause} ${i.target} ${i.obligationsAffected} ${i.oldestHours ?? "no age recorded"}`));
  }

  return assemble("OVERDUE_SOURCES", {
    says,
    denominator: number,
    sources: [source("the control-centre snapshot the runner publishes after every cycle", snap.publishedAt, "cp_owner_snapshots #current")],
    needsYou: NOTHING_NEEDED,
    gaps,
    detail,
  });
}

/* ------------------------------------------------------------------ topic 4 */

/** Roles whose work is an acquisition, when the question said "acquisition". */
const ACQUIRING_ROLES: readonly string[] = ["ACQUIRER", "SCOUT"];

/**
 * "Show me the latest failed acquisition."
 *
 * A failure is an Attempt with an outcome that is not COMPLETED. An Attempt
 * with a NULL outcome is still running and is not a failure — collapsing the
 * two would report every open job as a failure the moment a cycle started.
 */
export function latestFailedAcquisition(ctx: OperatorContext, acquisitionsOnly: boolean): ChatAnswer {
  const fleet = holding(ctx.fleet, "the attempts and work items on record");
  if (!fleet.held) {
    return assemble("LATEST_FAILED_ACQUISITION", {
      says: ["The attempts could not be read, so nothing is being said about the latest failure."],
      denominator: noNumber(fleet.gap),
      sources: [],
      needsYou: NOTHING_NEEDED,
      gaps: [fleet.gap],
      detail: [],
    });
  }

  const { attempts, workItems } = fleet.value;
  const population = acquisitionsOnly ? attempts.filter((a) => ACQUIRING_ROLES.includes(a.worker.role)) : attempts;
  const failed = population
    .filter((a) => a.outcome !== null && a.outcome !== "COMPLETED")
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));

  const itemById = new Map(workItems.map((w) => [w.id, w]));
  const says: string[] = [];
  const detail: string[] = [];

  const populationWords = acquisitionsOnly ? "attempts by the hunters and acquirers" : "attempts by every role";

  if (failed.length === 0) {
    says.push(
      `No ${acquisitionsOnly ? "acquisition" : "attempt"} on record ended without finishing. That is a reading of ${count(population.length)} ${populationWords}, not a statement that nothing has ever gone wrong.`,
    );
  } else {
    const worst: Attempt = failed[0];
    const item = itemById.get(worst.workItemId) ?? null;
    const where = whereOf(item?.subject ?? null, null);
    says.push(
      `The latest one ended ${formatEastern(worst.endedAt ?? worst.startedAt)}, run by a ${plainCode(worst.worker.role).toLowerCase()}${where === null ? "" : ` on ${where}`}.`,
    );
    says.push(`It ${plainCode(worst.outcome).toLowerCase()}. ${plainText(worst.abortReason ?? "No reason was recorded on the attempt.")}`);
    if (item !== null) says.push(`It was run for this work: ${item.obligation}`);
    detail.push(`${worst.id} · ${worst.outcome} · ${worst.worker.role} ${worst.worker.provider} ${worst.worker.version}`);
    detail.push(`work item ${worst.workItemId}${item === null ? " (not on record)" : ` — ${item.state}`}`);
    detail.push(...failed.slice(1, 5).map((a) => `${a.id} ${a.outcome} ${a.startedAt}`));
  }

  return assemble("LATEST_FAILED_ACQUISITION", {
    says,
    denominator: denominator(
      `${count(failed.length)} of the ${count(population.length)} ${populationWords} on record ended without finishing`,
      failed.length,
      population.length,
      "How often work of this kind ends short of a boundary. It counts attempts that ENDED without completing; work still running is not counted as a failure.",
      acquisitionsOnly
        ? "every Attempt row in the control plane whose worker role hunts or acquires"
        : "every Attempt row in the control plane",
    ),
    sources: [source("every attempt the Fleet has recorded, with the work item each was run for", ctx.nowIso, "cp_attempts · cp_work_items")],
    needsYou: NOTHING_NEEDED,
    gaps: [],
    detail,
  });
}

/* ------------------------------------------------------------------ topic 5 */

/**
 * "What is waiting on me?"
 *
 * The split is the answer. Cards waiting on a decision are his; intents the
 * runner has not honoured yet are the runner's; queued fixes are his to send.
 * A count that lumped the three together would tell him to act on work that is
 * already moving.
 */
export function waitingOnYou(ctx: OperatorContext): ChatAnswer {
  const snapshot = holding(ctx.snapshot, "the published control-centre snapshot");
  const decisions = holding(ctx.decisions, "the decisions you have already recorded");
  const intents = holding(ctx.intents, "the intents you have recorded for the runner");
  const heartbeat = holding(ctx.heartbeat, "the runner's heartbeat");

  const says: string[] = [];
  const detail: string[] = [];
  const sources: AnswerSource[] = [];
  let needsYou: ChatNeedsYou = NOTHING_NEEDED;
  let number: Held<AnswerDenominator>;

  const collapsed = decisions.held ? collapseDecisionLog(decisions.value) : [];

  if (snapshot.held) {
    const cards = snapshot.value.decisionCards;
    const split = splitDecided(cards, collapsed);
    const forks = split.waiting.filter((c) => decisionCardKind(c) === "DECISION");
    const acknowledge = split.waiting.filter((c) => decisionCardKind(c) === "ACKNOWLEDGE");
    const blocked = split.waiting.filter((c) => decisionCardKind(c) === "BLOCKED_WHILE");

    if (forks.length === 0) {
      says.push(`Nothing on the published queue is waiting for a decision from you. ${count(cards.length)} ${cards.length === 1 ? "card was" : "cards were"} published and ${count(split.decided.length)} already carry a recorded decision.`);
    } else {
      const oldest = [...forks].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))[0];
      says.push(
        `${count(forks.length)} ${forks.length === 1 ? "decision is" : "decisions are"} waiting on you. The oldest is "${oldest.title}"${oldest.ageDays === null ? "" : `, open ${ageWords(oldest.ageDays * 24)}`} — ${oldest.whatIsNeeded}`,
      );
      needsYou = { needed: true, action: `answer ${forks.length === 1 ? "it" : "them"} on the control centre` };
    }
    if (acknowledge.length > 0) says.push(`${count(acknowledge.length)} more ${acknowledge.length === 1 ? "card is" : "cards are"} for your information only; reading them closes them.`);
    if (blocked.length > 0) says.push(`${count(blocked.length)} ${blocked.length === 1 ? "card is" : "cards are"} blocked on something outside this console and carries no button.`);

    detail.push(...split.waiting.map((c) => `${c.rowId} ${decisionCardKind(c)} — ${c.title}`));
    sources.push(source("the control-centre snapshot the runner publishes after every cycle", snapshot.value.publishedAt, "cp_owner_snapshots #current"));
    number = denominator(
      `${count(forks.length)} of the ${count(cards.length)} published cards are waiting for a decision from you`,
      forks.length,
      cards.length,
      "How much of the owner queue is a fork only you can take. Cards for information and cards blocked on something outside the console are in the denominator and not in the count.",
      "every decision card in the latest published snapshot, split against the decisions already recorded in the log",
    );
  } else {
    number = noNumber(snapshot.gap);
  }

  if (decisions.held) {
    const queue = fixQueueView(collapsed);
    if (queue.counts.queued > 0) {
      says.push(`${count(queue.counts.queued)} ${queue.counts.queued === 1 ? "gap is" : "gaps are"} in the fix queue waiting for you to send them.`);
      needsYou = { needed: true, action: needsYou.needed ? `${needsYou.action}, and send the fix queue` : "send the fix queue" };
    }
    sources.push(source("the decisions you have recorded, folded to one row each", ctx.nowIso, "cp_log_owner_decisions #owner-decision"));
    detail.push(`fix queue: ${queue.counts.queued} queued, ${queue.counts.sent} sent, ${queue.counts.opened} opened, ${queue.counts.refused} refused`);
  }

  if (intents.held) {
    const reading = readIntents(intents.value);
    const pending = reading.pendingDispatch.length + reading.pendingRunNow.length;
    if (pending > 0) {
      says.push(`${count(pending)} ${pending === 1 ? "instruction you recorded is" : "instructions you recorded are"} waiting on the runner rather than on you; it records honouring each one when it next cycles.`);
    }
    if (reading.runnerPause.paused) {
      says.push("The runner is paused because you paused it, and stays paused until you resume it.");
      needsYou = { needed: true, action: needsYou.needed ? `${needsYou.action}, and resume the runner` : "resume the runner when you want it working again" };
    }
    sources.push(source("the intents you have recorded for the runner", ctx.nowIso, "cp_log_research_intents #level-1"));
  }

  if (heartbeat.held && heartbeat.value.codeIdentity && heartbeat.value.codeIdentity.verdict === "RUNNER_BEHIND_EXECUTABLE") {
    says.push("The runner is running older code than the newest change on the integration branch, which is a thing to know before you read anything else it reports.");
  }

  if (says.length === 0) {
    says.push("Nothing that would say what is waiting on you could be read, so this answer names what is missing instead of guessing.");
  }

  return assemble("WAITING_ON_YOU", {
    says,
    denominator: number,
    sources,
    needsYou,
    gaps: gapsOf(snapshot, decisions, intents, heartbeat),
    detail,
  });
}

/* ------------------------------------------------------------------ topic 6 */

/**
 * "Compare production, main, and staging."
 *
 * FIVE identities, not three: production's own build, staging's own manifest,
 * the tip of the integration branch, the newest commit on it that changes
 * anything executable, and the commit the runner reports having executed. The
 * last three come from the runner's heartbeat because only the runner can say
 * what it ran, and the distinction between the tip and the executable head is
 * what stops an observer-only commit reading as a stale runner.
 */
export function compareEnvironments(ctx: OperatorContext): ChatAnswer {
  const heartbeat = holding(ctx.heartbeat, "the runner's heartbeat");
  const environments = holding(ctx.environments, "production's build identity and the staging release manifest");

  const says: string[] = [];
  const detail: string[] = [];
  const sources: AnswerSource[] = [];
  const gaps: Gap[] = [];
  let readable = 0;

  if (environments.held) {
    for (const env of [environments.value.production, environments.value.staging]) {
      if (env.sha === null) {
        says.push(`${env.name} did not answer with a build identity. ${env.detail ?? "No reason was recorded."}`);
        gaps.push({ whose: "UNKNOWABLE_NOW", says: `${env.name} could not be asked which build it is running.` });
      } else {
        readable += 1;
        const extra = env.reviewState === null ? "" : ` Its review state is ${plainCode(env.reviewState).toLowerCase()}.`;
        says.push(`${env.name} is running ${env.sha.slice(0, 7)}${env.branch === null ? "" : ` from ${env.branch}`}, as ${env.name} itself reported at ${formatEastern(env.observedAt)}.${extra}`);
        detail.push(`${env.name}: ${env.sha}${env.deployId === null ? "" : ` deploy ${env.deployId}`} — ${env.source}`);
      }
      sources.push(source(env.source, env.observedAt, `${env.name} build identity`));
    }
  } else {
    gaps.push(environments.gap);
  }

  if (heartbeat.held) {
    const identity = heartbeat.value.codeIdentity ?? null;
    sources.push(source("the heartbeat the runner writes at the end of every cycle", heartbeat.value.beatAt, "cp_runner_heartbeat #pilot-runner · codeIdentity"));
    if (identity === null) {
      says.push("The runner's heartbeat carries no reading of the integration branch, so the three code identities cannot be compared. That is a fact about the beat, not about the code.");
      gaps.push({ whose: "OURS", says: "The runner has not recorded which commits it compared itself against." });
    } else {
      if (identity.rawMainSha !== null) readable += 1;
      if (identity.effectiveExecutableSha !== null) readable += 1;
      if (identity.runnerTestedSha !== null) readable += 1;
      says.push(identity.detail);
      says.push(`The console reads that as: ${plainCode(identity.verdict).toLowerCase()}.`);
      detail.push(codeIdentityLine(identity));
    }
  } else {
    gaps.push(heartbeat.gap);
  }

  if (says.length === 0) {
    says.push("None of the environments could be read, so this answer names what is missing instead of guessing.");
  }

  return assemble("COMPARE_ENVIRONMENTS", {
    says,
    denominator: denominator(
      `${count(readable)} of the 5 build identities could be read`,
      readable,
      5,
      "How complete this comparison is. The five are production, staging, the tip of the integration branch, the newest commit on it that changes executable code, and the commit the runner reports having run. A comparison missing one of them is not a comparison of all three environments.",
      "a fixed set of five identities, each read from the environment or record that owns it",
    ),
    sources,
    needsYou: NOTHING_NEEDED,
    gaps,
    detail,
  });
}

/* ------------------------------------------------------------------ topic 7 */

/**
 * "Why is this PR not integrated?"
 *
 * The honest half of this answer is what the console CANNOT see. Nothing in
 * the control plane records a pull request, a check run or a merge queue, and
 * the Admin never reads GitHub — so the console says exactly what it holds
 * about integration (the staging manifest's review state, production's build,
 * and the runner's code identities) and names the missing seam rather than
 * inventing a status.
 */
export const NO_PULL_REQUEST_RECORD: Gap = {
  whose: "OURS",
  says:
    "Nothing in this console records pull requests, their checks or the merge queue. It reads one control-plane database and two build endpoints, and none of those three holds a pull request. Naming a number here would not make one exist.",
};

export function integrationStatus(ctx: OperatorContext, subject: string | null): ChatAnswer {
  const heartbeat = holding(ctx.heartbeat, "the runner's heartbeat");
  const environments = holding(ctx.environments, "production's build identity and the staging release manifest");

  const says: string[] = [];
  const detail: string[] = [];
  const sources: AnswerSource[] = [];
  const gaps: Gap[] = [NO_PULL_REQUEST_RECORD];
  let known = 0;

  says.push(
    subject === null
      ? "This console cannot tell you why a pull request is not integrated, because it holds no record of pull requests at all. What it can tell you is what each environment is running and what the release review has recorded."
      : `This console holds no record of ${subject} as a pull request. What it can tell you is what each environment is running and what the release review has recorded.`,
  );

  if (environments.held) {
    const staging = environments.value.staging;
    const production = environments.value.production;
    if (staging.sha !== null) {
      known += 1;
      says.push(
        `Staging is showing ${staging.sha.slice(0, 7)}${staging.reviewStatus === null ? "" : `, which its manifest reports as ${plainCode(staging.reviewStatus).toLowerCase()}`}${staging.reviewState === null ? "" : ` and its review state as ${plainCode(staging.reviewState).toLowerCase()}`}.`,
      );
      detail.push(`staging ${staging.sha} — ${staging.source}`);
    } else {
      says.push(`Staging did not answer. ${staging.detail ?? "No reason was recorded."}`);
      gaps.push({ whose: "UNKNOWABLE_NOW", says: "Staging could not be asked which build it is showing." });
    }
    if (production.sha !== null) {
      known += 1;
      says.push(`Production is running ${production.sha.slice(0, 7)}, as production itself reported at ${formatEastern(production.observedAt)}.`);
      detail.push(`production ${production.sha} — ${production.source}`);
      if (staging.sha !== null && staging.sha === production.sha) {
        says.push("Staging and production are showing the same build, so whatever you are asking about is either already in both or in neither.");
      }
    } else {
      gaps.push({ whose: "UNKNOWABLE_NOW", says: "Production could not be asked which build it is running." });
    }
    sources.push(source(staging.source, staging.observedAt, "staging release manifest"));
    sources.push(source(production.source, production.observedAt, "production build identity"));
  } else {
    gaps.push(environments.gap);
  }

  if (heartbeat.held) {
    const identity = heartbeat.value.codeIdentity ?? null;
    sources.push(source("the heartbeat the runner writes at the end of every cycle", heartbeat.value.beatAt, "cp_runner_heartbeat #pilot-runner · codeIdentity"));
    if (identity !== null) {
      known += 1;
      says.push(`On the integration branch: ${identity.detail}`);
      detail.push(codeIdentityLine(identity));
      if (subject !== null && identity.rawMainSha !== null && subject.length >= 7 && identity.rawMainSha.startsWith(subject)) {
        says.push("That commit is the tip of the integration branch, so it is integrated as far as this console can see.");
      }
    }
  } else {
    gaps.push(heartbeat.gap);
  }

  return assemble("INTEGRATION_STATUS", {
    says,
    denominator: denominator(
      `${count(known)} of the 3 integration facts this console holds could be read`,
      known,
      3,
      "How much of what this console CAN see about integration was readable: what staging is showing, what production is running, and what the integration branch points at. It is not a measure of the pull request, which this console does not hold.",
      "a fixed set of three readings, each from the environment or record that owns it",
    ),
    sources,
    needsYou: NOTHING_NEEDED,
    gaps,
    detail,
  });
}

export function placeStuck(ctx: OperatorContext): ChatAnswer {
  const read = holding(ctx.placeStuck, "this place’s live score and stuck work");
  if (!read.held) return assemble("PLACE_STUCK", { says: [read.gap.says], denominator: noNumber(read.gap), sources: [], needsYou: NOTHING_NEEDED, gaps: [read.gap], detail: [] });
  const r = read.value;
  const answer = assemble("PLACE_STUCK", {
    says: [`${r.label}: ${r.captured} of ${r.owed} facts captured${r.percent === null ? "" : ` (${r.percent}%)`}; ${r.stuck} stuck items${r.causes.length ? ` — ${r.causes.join("; ")}` : "."}`],
    denominator: denominator(`${r.captured} of ${r.owed} owed facts captured`, r.captured, r.owed, "The place’s core capture score", "the live owed list"),
    sources: [source("the place’s capture score and published stuck work", r.observedAt, r.key)], needsYou: NOTHING_NEEDED, gaps: [], detail: [],
  });
  return { ...answer, readBackAt: `/admin?view=work&scope=${encodeURIComponent(r.key)}` };
}

/* --------------------------------------------------------------- the switch */

/**
 * The one place a topic becomes an answer. Exhaustive over {@link ChatTopic},
 * so adding a topic without a query is a compile error rather than a blank
 * panel.
 */
export function spendAndFacts(ctx: OperatorContext): ChatAnswer {
  const ours = (says: string): Gap => ({ whose: "OURS", says });
  const flow = holding(ctx.flow, "the hourly flow of facts and settled spend");
  if (!flow.held) {
    return assemble("SPEND_AND_FACTS", {
      says: ["The hourly record of spend and facts going live could not be read, so nothing is being said about what was spent or what it got."],
      denominator: noNumber(flow.gap),
      sources: [],
      needsYou: NOTHING_NEEDED,
      gaps: [flow.gap],
      detail: [],
    });
  }
  const week = flow.value;
  const line = spendAnswer(week);
  const last = week.days[week.days.length - 1];
  if (line === null || last === undefined || last.read === null) {
    const g = ours("No spend or facts-live record covers the last day yet.");
    return assemble("SPEND_AND_FACTS", {
      says: ["Nothing has been recorded for the last day yet, so there is no spend or fact count to give."],
      denominator: noNumber(g),
      sources: [],
      needsYou: NOTHING_NEEDED,
      gaps: [g],
      detail: [],
    });
  }
  const unpriced = line.spendUsd === null;
  const number = unpriced
    ? noNumber(ours("Some charges in the last day have no price, so the spend is not known and no cost per fact is given."))
    : denominator(
        `${count(line.facts)} facts went live for $${line.spendUsd!.toFixed(2)} of settled spend over the last day`,
        line.facts,
        line.facts,
        "How many new or changed reader records went live in the last 24 hours, next to the settled spend over the same hours. Rechecks that changed nothing earn no credit.",
        "the hourly publication-flow record and the cost log, over the last 24 hours",
      );
  return assemble("SPEND_AND_FACTS", {
    says: [line.says, "The Scoreboard shows both numbers with their seven-day trend: /admin?view=scoreboard."],
    denominator: number,
    sources: [source("the hourly flow of facts going live, and the settled spend in the cost log", last.through, "cp_log_owner_digests publication-flow; cp_log_costs")],
    needsYou: NOTHING_NEEDED,
    gaps: unpriced ? [ours("Some charges in the last day have no price.")] : [],
    detail: [`facts live ${line.facts}`, `settled spend ${line.spendUsd ?? "not known"}`],
  });
}

/* --------------------------------------------------------------- the switch */

/**
 * The one place a topic becomes an answer. Exhaustive over {@link ChatTopic},
 * so adding a topic without a query is a compile error rather than a blank
 * panel.
 */

export function answerFor(topic: ChatTopic, ctx: OperatorContext, asked: string, subject: string | null): ChatAnswer {
  switch (topic) {
    case "SPEND_AND_FACTS": return spendAndFacts(ctx);
    case "PLACE_STUCK": return placeStuck(ctx);
    case "FLEET_BLOCKERS":
      return fleetBlockers(ctx);
    case "SINCE_LAST_CYCLE":
      return sinceLastCycle(ctx);
    case "OVERDUE_SOURCES":
      return overdueSources(ctx);
    case "LATEST_FAILED_ACQUISITION":
      return latestFailedAcquisition(ctx, /acquisition|acquire|acquirer/.test(asked));
    case "WAITING_ON_YOU":
      return waitingOnYou(ctx);
    case "COMPARE_ENVIRONMENTS":
      return compareEnvironments(ctx);
    case "INTEGRATION_STATUS":
      return integrationStatus(ctx, subject);
  }
}
