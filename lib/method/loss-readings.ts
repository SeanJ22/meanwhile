/**
 * **DP-29 — WHERE EACH KIND OF LOSS IS READ FROM.**
 *
 * Plain adapters from what the control plane already holds to the readings
 * `studyAllLosses` takes, and the place traits it compares on. Each takes only
 * the fields it needs, so a test can hand it records directly.
 *
 * ```
 *   shut doors           door registry: SHUT fails, OPEN works; by what the door holds; place = its division
 *   empty hunts          obligations: an argued absence fails, a worked obligation with none works; by record kind
 *   checker failures     work items: HELD fails, PUBLISHED works; by record kind; place = the item's subject
 *   auditors' red flags  the week's live audits: RED fails, GREEN works; by fact family; place = the audited area
 *   front-end red flags  recent look passes: a red screen fails at its ZIP; by screen and element at fault
 * ```
 *
 * Traits held today: the door's adapter as its platform, and the state named
 * in a division id or a work item's plan. Nothing is guessed for a place we
 * hold nothing about; it simply states no trait.
 */
import type { LookPass } from "../frontend/look-pass.ts";
import type { LossReading } from "./study-all-losses.ts";
import type { PlaceTraits } from "./study-losses.ts";

export interface DoorLike {
  readonly kind: string;
  readonly ocdId: string | null;
  readonly holds: readonly string[];
  readonly status: "OPEN" | "SHUT" | "SUSPENDED";
  readonly updatedAt: string;
  readonly shutSince?: string | null;
}

export interface ObligationLike {
  readonly recordClass: string;
  readonly subjectId: string;
  readonly lastWorkedAt: string | null;
  readonly absentUntil?: string | null;
  readonly absenceUnlock?: { readonly recordedAt?: string; readonly triggers?: readonly { readonly kind: string; readonly platform?: string }[] } | null;
}

export interface WorkItemLike {
  readonly subject: string;
  readonly autonomousPlan?: { readonly jurisdiction?: string; readonly contract?: { readonly recordClass?: string } } | null;
  readonly publicationOutcome?: { readonly status: string; readonly at: string } | null;
}

export interface AuditLike {
  readonly family: string;
  readonly area: string;
  readonly verdict: "GREEN" | "RED" | "INCONCLUSIVE";
  readonly checkedAt: string;
}

const words = (s: string) => s.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();

export function stateOf(place: string): string | null {
  return place.match(/(?:^|\/)state:([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase() ?? null;
}

export function doorReadings(doors: readonly DoorLike[]): LossReading[] {
  return doors.flatMap((d) => (d.ocdId === null || d.status === "SUSPENDED" ? [] : [{
    kind: "shut-door" as const, subject: [...d.holds].sort().join("+") || "unknown", subjectWords: `doors for ${[...d.holds].sort().map(words).join(" and ") || "records"}`,
    placeId: d.ocdId, failed: d.status === "SHUT", at: (d.status === "SHUT" ? d.shutSince : null) ?? d.updatedAt,
  }]));
}

export function absenceReadings(obligations: readonly ObligationLike[], now: string): LossReading[] {
  return obligations.flatMap((o) => {
    const absent = typeof o.absentUntil === "string" && Date.parse(o.absentUntil) > Date.parse(now);
    if (!absent && o.lastWorkedAt === null) return [];
    return [{ kind: "empty-hunt" as const, subject: o.recordClass, subjectWords: `hunts for ${words(o.recordClass)}`, placeId: o.subjectId, failed: absent,
      at: (absent ? o.absenceUnlock?.recordedAt : o.lastWorkedAt) ?? now }];
  });
}

export function holdReadings(items: readonly WorkItemLike[]): LossReading[] {
  return items.flatMap((i) => {
    const status = i.publicationOutcome?.status;
    const recordClass = i.autonomousPlan?.contract?.recordClass;
    if (!recordClass || (status !== "HELD" && status !== "PUBLISHED")) return [];
    return [{ kind: "checker" as const, subject: recordClass, subjectWords: `${words(recordClass)} facts`, placeId: i.subject, failed: status === "HELD", at: i.publicationOutcome!.at }];
  });
}

export function auditReadings(results: readonly AuditLike[]): LossReading[] {
  return results.flatMap((r) => (r.verdict === "INCONCLUSIVE" ? [] : [{
    kind: "audit" as const, subject: r.family, subjectWords: `${words(r.family)} on the live page`, placeId: r.area, failed: r.verdict === "RED", at: r.checkedAt,
  }]));
}

export function lookReadings(passes: readonly LookPass[]): LossReading[] {
  return passes.flatMap((p) => p.screens.flatMap((s) => (s.verdict !== "red" ? [] : [{
    kind: "front-end" as const, subject: `${s.surface}|${s.profile}|${(s.element ?? "the screen").toLowerCase()}`,
    subjectWords: `${s.element ?? "the screen"} on the ${s.label}`, placeId: `zip:${s.zip}`, failed: true, at: p.at,
  }])));
}

/** The traits we hold for each place: a door's adapter as its platform (when its doors agree), and the state its id or plan names. */
export function placeTraitsFrom(input: { readonly doors: readonly DoorLike[]; readonly items: readonly WorkItemLike[]; readonly places: readonly string[] }): Map<string, PlaceTraits> {
  const out = new Map<string, PlaceTraits>();
  const platforms = new Map<string, Set<string>>();
  for (const d of input.doors) if (d.ocdId) platforms.set(d.ocdId, (platforms.get(d.ocdId) ?? new Set()).add(d.kind.toLowerCase()));
  const planState = new Map<string, string>();
  for (const i of input.items) if (i.autonomousPlan?.jurisdiction && /^[a-z]{2}$/i.test(i.autonomousPlan.jurisdiction)) planState.set(i.subject, i.autonomousPlan.jurisdiction.toLowerCase());
  for (const place of new Set([...input.places, ...platforms.keys()])) {
    const kinds = platforms.get(place);
    const traits: PlaceTraits = {
      ...(kinds && kinds.size === 1 ? { platform: [...kinds][0] } : {}),
      ...((stateOf(place) ?? planState.get(place)) ? { state: stateOf(place) ?? planState.get(place)! } : {}),
    };
    if (Object.keys(traits).length) out.set(place, traits);
  }
  return out;
}
