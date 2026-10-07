/**
 * When a method starts working somewhere, it is queued in every place whose
 * door has the same kind of website (`planSpread`): a free try everywhere, a
 * paid try only inside places the owner has sent money to. A queued try is the fix
 * map's "untried here" row for that place, which every worker there reads at
 * the head of its untried methods; a place with a result is never queued again.
 */

import { isTransferableMethod, type FieldManualEntry } from "../control-plane/field-manual.ts";
import type { AssignmentMembership } from "../control-plane/expansion/assignment-budget.ts";
import type { BudgetScope } from "../control-plane/expansion/membership.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WebsiteSize } from "../control-plane/scheduler/host-supervision.ts";
import { detectTenancy } from "../hunt/platform-tenancy.ts";
import { planSpread, type SpreadPlace } from "./spread.ts";
import type { FixMapRow } from "./fix-map.ts";

const place = (subject: string): string => subject.split("#")[0]!;

/** The places the owner has sent money to: members of a Send, and of an area with a budget. */
export function sentMoneyPlaces(input: { readonly areas: readonly BudgetScope[] | null; readonly sends: AssignmentMembership | null }): ReadonlySet<string> {
  const out = new Set<string>();
  for (const scope of input.areas ?? []) {
    if (scope.resolved && scope.budgetUsd > 0) for (const member of scope.members) out.add(place(member));
  }
  for (const members of input.sends?.byKey.values() ?? []) {
    for (const member of [...members.created.values(), ...members.reordered.values()]) out.add(place(member.subjectId));
  }
  return out;
}

export interface SpreadPassInput {
  readonly repos: Pick<ControlPlaneRepositories, "fieldManual" | "fixMap" | "doors">;
  /** Methods that started working at or after this instant are spread. */
  readonly since: string;
  readonly now: string;
  readonly sendPlaceIds: ReadonlySet<string>;
  /** How many paid tries the budget dial leaves this round. */
  readonly paidTriesLeft: number;
  readonly sizeFor?: (host: string) => WebsiteSize | null | undefined;
}

export interface SpreadPassResult {
  readonly methods: number;
  readonly free: number;
  readonly paid: number;
  readonly paidSkipped: number;
}

const detected = (host: string | undefined): string | null => {
  if (!host) return null;
  const url = `https://${host}/`;
  return detectTenancy(url, url)[0]?.platform ?? null;
};

function queued(methodId: string, target: SpreadPlace, worked: string, paid: boolean, now: string): FixMapRow {
  const how = paid ? "a paid try is allowed here" : "a free try";
  return { methodId, placeId: target.placeId, state: "UNTRIED", triedAt: null, attemptId: null, updatedAt: now,
    cause: `Queued: it worked in ${worked}, and this place has the same ${target.why === "door kind" ? "kind of door" : "website platform"}; ${how}.` };
}

/** Spread every method that started working since `since`. Never throws for one method; its failure is counted as skipped. */
export async function runSpreadPass(input: SpreadPassInput): Promise<SpreadPassResult> {
  const fresh = await input.repos.fixMap.worksSince(input.since, 1000);
  const ids = [...new Set(fresh.map((row) => row.methodId))];
  if (ids.length === 0) return { methods: 0, free: 0, paid: 0, paidSkipped: 0 };
  const methods = (await input.repos.fieldManual.readMany(ids)).map((row) => row.value).filter((entry: FieldManualEntry) => isTransferableMethod(entry));
  if (methods.length === 0) return { methods: 0, free: 0, paid: 0, paidSkipped: 0 };
  const doors = (await input.repos.doors.list()).map((row) => row.value);
  const platformOf = new Map(doors.map((door) => [door.doorId, detected(door.hosts[0])] as const));
  let left = Math.max(0, Math.floor(input.paidTriesLeft));
  let free = 0, paid = 0, paidSkipped = 0;
  for (const method of methods) {
    const plan = planSpread({
      method: { methodId: method.id, doorKind: method.platforms[0] ?? null, platforms: method.platforms },
      doors, detectedPlatform: (doorId) => platformOf.get(doorId),
      fixMapRows: await input.repos.fixMap.forMethod(method.id, 1000),
      ...(input.sizeFor ? { sizeFor: input.sizeFor } : {}),
      sendPlaceIds: input.sendPlaceIds, paidTriesLeft: left,
    });
    left -= plan.paid.length;
    paidSkipped += plan.paidSkipped.length;
    const worked = fresh.find((row) => row.methodId === method.id)?.placeId ?? "another place";
    const paidHere = new Set(plan.paid.map((target) => target.placeId));
    for (const target of [...plan.plain, ...plan.plainWaiting]) {
      await input.repos.fixMap.put(queued(method.id, target, worked, paidHere.has(target.placeId), input.now));
      if (paidHere.has(target.placeId)) paid += 1;
      else free += 1;
    }
  }
  return { methods: methods.length, free, paid, paidSkipped };
}
