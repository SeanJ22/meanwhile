import { nameAReaderCanSay, type BindableEntity } from "../routing/named-entity.ts";
import type { CanonicalBodyIdentity } from "./body-identity.ts";

/**
 * The bodies a reader can name: one entity per distinct `Meeting.bodyId`, and
 * the entity's id is that body id. The division rides alongside as `ocdId`
 * for the class tie-break and reporting, never as the identity. The name comes
 * from the canonical registry (`lib/ask/body-identity.ts`), not
 * `meeting.bodyName`, which is the meeting's own title. The resolver is a
 * parameter so this module stays pure and offline.
 */

/** The identity fields this module reads off a meeting. Nothing else. */
export interface MeetingIdentity {
  /** WHICH BODY IS MEETING. The registry id, not the geography. */
  bodyId?: string | null;
  /** WHERE it sits. Context only — never the body's identity. */
  ocdId: string | null;
}

/**
 * A body a reader can name, resolved to its registry identity. A meeting with
 * no `bodyId` contributes nothing and is never attributed to its division.
 */
export function snapshotEntities(
  meetings: readonly MeetingIdentity[],
  identify: (bodyId: string) => CanonicalBodyIdentity | null,
): BindableEntity[] {
  const seen = new Map<string, BindableEntity>();
  for (const meeting of meetings) {
    const bodyId = meeting.bodyId;
    if (!bodyId || seen.has(bodyId)) continue;
    const identity = identify(bodyId);
    /* A body the registry does not hold falls back to un-slugging its own `#slot`, never the division. */
    const name = identity
      ? nameAReaderCanSay(identity.name, identity.divisionLabel)
      : unslugBodySuffix(bodyId);
    if (!name) continue;
    seen.set(bodyId, {
      id: bodyId,
      name,
      nameClass: "body",
      divisionType: identity?.divisionType ?? divisionTypeOf(meeting.ocdId),
      level: "BODY",
      ocdId: identity?.ocdId ?? meeting.ocdId,
    });
  }
  return [...seen.values()];
}

/** The `#slot` half of a body id, un-slugged. Never the division half. */
function unslugBodySuffix(bodyId: string): string {
  const at = bodyId.lastIndexOf("#");
  if (at < 0) return "";
  return bodyId.slice(at + 1).replace(/[-_]/g, " ").trim();
}

/**
 * The division type out of a division id — `county`, `place`,
 * `school_district`. Used only when the registry could not supply it, and only
 * ever as the binder's CLASS tie-break, which cannot turn a `BOUND` into a
 * wrong `BOUND` (see `lib/routing/named-entity.ts`).
 */
function divisionTypeOf(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const last = ocdId.split("/").pop() ?? "";
  const [divisionType] = last.split(":");
  return divisionType || null;
}

/**
 * A slugged division name, title-cased for a sentence. Not a claim about what
 * a government calls itself, and applied only to names that are slugs.
 */
export function titleCaseName(slugWords: string): string {
  return slugWords
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
