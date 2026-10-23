

import { isTransferableMethod, placeLabel, saveFieldManualEntries, type FieldManualEntry, type FieldManualRepos } from "../control-plane/field-manual.ts";
import { recordAttemptsKeepingHistory } from "../control-plane/fix-history.ts";
import type { AssignmentMembership } from "../control-plane/expansion/assignment-budget.ts";
import type { BudgetScope } from "../control-plane/expansion/membership.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { PermissionVerdict } from "../control-plane/scheduler/robots.ts";
import type { WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { PROBE_URL_KEYS, type ProbeFetch } from "../doors/probe.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { detectTenancy } from "../hunt/platform-tenancy.ts";
import type { FixMapRow } from "./fix-map.ts";
import type { MethodAttempt } from "./fix-map-record.ts";
import { subjectDivisionOf } from "./method-places.ts";
import { plainTrier, type PlainTry } from "./method-try.ts";
import { planSpread, SPREAD_ATTEMPT, type SpreadPlace } from "./spread.ts";


/** At most this many free tries a round; the rest stay queued for the next. */
export const FREE_TRIES_PER_ROUND = 200;


export function sentMoneyPlaces(input: { readonly areas: readonly BudgetScope[] | null; readonly sends: AssignmentMembership | null }): ReadonlySet<string> {
  const out = new Set<string>();
  for (const scope of input.areas ?? []) {
    if (scope.resolved && scope.budgetUsd > 0) for (const member of scope.members) { const at = subjectDivisionOf(member); if (at !== null) out.add(at); }
  }
  for (const members of input.sends?.byKey.values() ?? []) {
    for (const member of [...members.created.values(), ...members.reordered.values()]) { const at = subjectDivisionOf(member.subjectId); if (at !== null) out.add(at); }
  }
  return out;
}

export interface SpreadPassInput {
  readonly repos: Pick<ControlPlaneRepositories, "fieldManual" | "fixMap" | "doors" | "adminConfig">;
  readonly now: string;
  readonly sendPlaceIds: ReadonlySet<string>;
  /** How many paid tries the budget dial leaves this round. */
  readonly paidTriesLeft: number;
  /** The free tries' plain fetch (`pacedProbeFetch`): identified, and paced by the one per-website count every reader shares. */
  readonly fetch: ProbeFetch;
  readonly sizeFor?: WebsiteSizeForUrl;
}

/** One method's round, for the log: where it could go and what each place came to. */
export interface SpreadMethodReport {
  readonly methodId: string;
  readonly title: string;
  readonly platforms: readonly string[];
  readonly workedIn: string;
  readonly matchingDoors: number;
  readonly matchingPlaces: number;
  readonly alreadyTried: number;
  readonly freeTries: number;
  readonly worked: readonly { readonly place: string; readonly note: string }[];
  readonly didNotFit: readonly { readonly place: string; readonly note: string }[];
  /** Tried and undecided: a worker there is offered it. */
  readonly leftForWorker: readonly { readonly place: string; readonly note: string }[];
  readonly waiting: readonly { readonly place: string; readonly note: string }[];
  readonly paidAllowed: readonly string[];
  readonly paidRefused: readonly { readonly place: string; readonly reason: string }[];
}

export interface SpreadPassResult {
  readonly methods: number;
  readonly perMethod: readonly SpreadMethodReport[];
  /** Free tries made this round, by what they found. */
  readonly tried: { readonly works: number; readonly fails: number; readonly undecided: number };
  /** Free tries still queued: a small publisher's allowance, a website backing off, or the round's limit. */
  readonly waiting: number;
  readonly paid: number;
  readonly paidSkipped: number;
  /** What robots.txt said about each request made, recorded and never obeyed as a block. */
  readonly robots: Readonly<Partial<Record<PermissionVerdict, number>>>;
  readonly requests: number;
  /** Fix-map or field-manual writes that failed, in a sentence; null when all were written. */
  readonly writeError: string | null;
}

/** Every platform the door's websites are on, by their addresses. */
const platformsOf = (door: DoorRecord): string[] =>
  [...new Set(door.hosts.flatMap((host) => {
    const url = `https://${host}/`;
    return detectTenancy(url, url).map((hit) => hit.platform.toLowerCase());
  }))];

function untried(methodId: string, target: SpreadPlace, attemptId: string, cause: string, now: string): FixMapRow {
  return { methodId, placeId: target.placeId, state: "UNTRIED", triedAt: null, attemptId, updatedAt: now, cause };
}

const sameWebsite = (target: SpreadPlace): string => target.why === "door kind" ? "the same kind of door" : "the same website platform";

/** One round of the spread. Never throws for one method or one place; failed writes are reported. */
export async function runSpreadPass(input: SpreadPassInput): Promise<SpreadPassResult> {
  const { repos, now } = input;
  const working = await repos.fixMap.workingMethods(1000);
  const workedIn = new Map(working.map((row) => [row.methodId, placeLabel(row.placeId)] as const));
  const methods = working.length === 0 ? [] : (await repos.fieldManual.readMany([...workedIn.keys()])).map((row) => row.value).filter((entry: FieldManualEntry) => isTransferableMethod(entry));
  const empty: SpreadPassResult = { methods: 0, perMethod: [], tried: { works: 0, fails: 0, undecided: 0 }, waiting: 0, paid: 0, paidSkipped: 0, robots: {}, requests: 0, writeError: null };
  if (methods.length === 0) return empty;
  const doors = (await repos.doors.listWhereNarrowed(["status"], "OPEN", {
    doorId: true, kind: true, ocdId: true, hosts: true, status: true, config: PROBE_URL_KEYS,
  })).map(row => row.value as DoorRecord);
  const doorById = new Map<string, DoorRecord>(doors.map((door) => [door.doorId, door] as const));
  const platformOf = new Map(doors.map((door) => [door.doorId, platformsOf(door)] as const));
  const perMethod: SpreadMethodReport[] = [];
  const trier = plainTrier({ fetch: input.fetch });
  const tried = { works: 0, fails: 0, undecided: 0 };
  const robots: Partial<Record<PermissionVerdict, number>> = {};
  const attempts: MethodAttempt[] = [];
  const results = new Map<string, FieldManualEntry>();
  let left = Math.max(0, Math.floor(input.paidTriesLeft));
  let freeLeft = FREE_TRIES_PER_ROUND;
  let waiting = 0, paid = 0, paidSkipped = 0;
  let writeError: string | null = null;
  const put = async (row: FixMapRow): Promise<void> => {
    try {
      await repos.fixMap.put(row);
    } catch (error) {
      writeError ??= `the fix map was not updated: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  for (const method of methods) {
    const worked = workedIn.get(method.id) ?? "another place";
    const plan = planSpread({
      method: { methodId: method.id, doorKind: method.platforms[0] ?? null, platforms: method.platforms },
      doors, detectedPlatforms: (doorId) => platformOf.get(doorId) ?? [],
      fixMapRows: await repos.fixMap.forPlaces(method.id, doors.flatMap(door => door.ocdId === null ? [] : [door.ocdId])),
      ...(input.sizeFor ? { sizeFor: (host: string) => input.sizeFor!(`https://${host}/`) } : {}),
      sendPlaceIds: input.sendPlaceIds, paidTriesLeft: left,
    });
    const report = { methodId: method.id, title: method.title, platforms: method.platforms, workedIn: worked, matchingDoors: plan.matchingDoors,
      matchingPlaces: plan.matching, alreadyTried: plan.alreadyTried, freeTries: 0,
      worked: [] as { place: string; note: string }[], didNotFit: [] as { place: string; note: string }[], leftForWorker: [] as { place: string; note: string }[],
      waiting: [] as { place: string; note: string }[], paidAllowed: plan.paid.map((p) => p.placeId),
      paidRefused: plan.paidSkipped.map((skip) => ({ place: skip.place.placeId, reason: skip.reason })) };
    perMethod.push(report);
    const queue = (target: SpreadPlace, why: string) =>
      put(untried(method.id, target, SPREAD_ATTEMPT.QUEUED, `Queued: it worked in ${worked}, and this place has ${sameWebsite(target)}; ${why}.`, now));

    for (const target of plan.plain) {
      const door = doorById.get(target.doorId);
      if (door === undefined) continue;
      if (freeLeft <= 0) {
        waiting += 1;
        report.waiting.push({ place: target.placeId, note: "the round's free tries are used; it waits for the next round" });
        await queue(target, "a free try waits for the next round");
        continue;
      }
      freeLeft -= 1;
      const got: PlainTry = await trier.tryAt(method, door, target.why);
      if (got.robots !== null) robots[got.robots] = (robots[got.robots] ?? 0) + 1;
      if (got.outcome === "WAITING") {
        waiting += 1;
        report.waiting.push({ place: target.placeId, note: got.note });
        await queue(target, `a free try waits: ${got.note}`);
      } else if (got.outcome === "UNDECIDED") {
        report.freeTries += 1;
        report.leftForWorker.push({ place: target.placeId, note: got.note });
        tried.undecided += 1;
        await put(untried(method.id, target, SPREAD_ATTEMPT.PLAIN_TRIED,
          `Tried by plain code: ${got.note}. It worked in ${worked}; a worker here is offered it.`, now));
      } else {
        report.freeTries += 1;
        (got.outcome === "WORKS" ? report.worked : report.didNotFit).push({ place: target.placeId, note: got.note });
        tried[got.outcome === "WORKS" ? "works" : "fails"] += 1;
        attempts.push({ kind: "ROUTE_RUN", attemptId: `${SPREAD_ATTEMPT.PLAIN_TRIED}:${now}`, placeId: target.placeId, methodIds: [method.id],
          outcome: got.outcome === "WORKS" ? "SUCCEEDED" : "FAILED", cause: `Tried by plain code: ${got.note}.`, at: now });
        const held = results.get(method.id) ?? { ...method, placeResults: [] };
        results.set(method.id, { ...held, placeResults: [...(held.placeResults ?? []),
          { place: target.placeId, outcome: got.outcome === "WORKS" ? "YIELDED" : "FAILED", observedAt: now }] });
      }
    }
    for (const target of plan.plainWaiting) {
      waiting += 1;
      report.waiting.push({ place: target.placeId, note: "this small publisher's hourly allowance is used this round" });
      await queue(target, "a free try waits for this small publisher's hourly allowance");
    }
    left -= plan.paid.length;
    paidSkipped += plan.paidSkipped.length;
    for (const target of plan.paid) {
      paid += 1;
      await put(untried(method.id, target, SPREAD_ATTEMPT.PAID,
        `The free try could not decide; it worked in ${worked}; a paid try is allowed here.`, now));
    }
  }

  if (attempts.length > 0) {
    const titles = new Map(methods.map((method) => [method.id, method.title] as const));
    const done = await recordAttemptsKeepingHistory(repos.fixMap, { adminConfig: repos.adminConfig }, attempts, (id) => titles.get(id) ?? null)
      .catch((error: unknown) => ({ failed: 1, error }));
    if (done.failed > 0) writeError ??= `the fix map was not updated for ${done.failed} free tr${done.failed === 1 ? "y" : "ies"}`;
  }
  if (results.size > 0) {
    const saved = await saveFieldManualEntries(repos as FieldManualRepos, [...results.values()], now);
    if (saved.error !== undefined) writeError ??= `the field manual was not updated: ${saved.error}`;
  }
  const requests = [...trier.requests.values()].reduce((sum, n) => sum + n, 0);
  return { methods: methods.length, perMethod, tried, waiting, paid, paidSkipped, robots, requests, writeError };
}

/** One line for the round's log. */
export function spreadLine(result: SpreadPassResult): string {
  const { works, fails, undecided } = result.tried;
  const robots = Object.entries(result.robots).map(([verdict, n]) => `${verdict.toLowerCase().replace(/_/g, " ")} ${n}`).join(", ");
  return `${result.methods} working method(s) tried elsewhere by plain code: ${works} worked, ${fails} did not fit, ${undecided} left for a worker, ` +
    `${result.waiting} waiting; ${result.paid} paid tr${result.paid === 1 ? "y" : "ies"} allowed inside places with money sent` +
    `${result.paidSkipped ? `, ${result.paidSkipped} not allowed (no money sent there, or past the budget dial)` : ""}; ${result.requests} request(s)` +
    `${robots ? ` (robots.txt: ${robots})` : ""}${result.writeError ? `; ${result.writeError}` : ""}`;
}
