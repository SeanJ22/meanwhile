import { nameAReaderCanSay, type BindableEntity } from "../routing/named-entity.ts";
import type { CanonicalBodyIdentity } from "./body-identity.ts";

/**
 * **THE BODIES A READER CAN NAME — one entity per CANONICAL BODY, never per
 * division.** (2026-08-29, the exact-body-identity session.)
 *
 * ## What this used to do, and what it cost
 *
 * It built the inventory from `meeting.ocdId` — the DIVISION — and stamped
 * each row `nameClass: "body"`. The Ask pipeline therefore called a division a
 * body, and `app/api/ask/grounded` then selected meetings with
 * `m.ocdId === subject.id`.
 *
 * A reader asked *"What's on the Pima County Board of Supervisors agenda?"* and
 * was told the Board's next meeting was **"CAP University: Deeper Dive on How
 * Water is Accounted for in the Lower Basin"** — an event of the Central
 * Arizona Water Conservation District, a different government that happens to
 * be recorded against the same county division. The Board's real next sitting
 * was a Study Session two months later. Nothing downstream could catch it: the
 * evidence pack was internally consistent, the model stayed inside it, and the
 * trace read `GROUNDED_CLAUDE`. **A wrong evidence pack produces a fluent wrong
 * answer with every check green.**
 *
 * The division carries 42 meetings and only 30 of them are the Board's. Nine
 * divisions in the committed snapshot carry more than one body; `place:tucson`
 * carries fifteen.
 *
 * ## The rule now
 *
 * **One entity per distinct `Meeting.bodyId`, and the entity's id IS that body
 * id.** The division travels alongside as `ocdId` — context for the class
 * tie-break and for reporting — and can never be mistaken for the identity,
 * because the identity is a different field with a different value.
 *
 * The name comes from the canonical registry (`lib/registry/body-identity.ts`)
 * and NOT from `meeting.bodyName`, which is the meeting's own title carried
 * onto the body: the corpus records the Vail school board as *"Governing Board
 * Meeting"* and the water district under four names including *"CAP
 * University"*. An inventory built from those contains no government a reader
 * could have named.
 *
 * ## Why the resolver is a parameter
 *
 * So this module stays PURE and offline. The registry read is the caller's, the
 * rule is here, and a test can state exactly what the rule does without a
 * filesystem. Same meetings plus same resolver, same inventory.
 */

/** The identity fields this module reads off a meeting. Nothing else. */
export interface MeetingIdentity {
  /** WHICH BODY IS MEETING. The registry id, not the geography. */
  bodyId?: string | null;
  /** WHERE it sits. Context only — never the body's identity. */
  ocdId: string | null;
}

/**
 * A body a reader can name, resolved to its canonical registry identity.
 *
 * **A meeting with no `bodyId` contributes NOTHING.** It is not silently
 * attributed to its division: `lib/meetings/snapshot.ts` refuses to serve a
 * snapshot whose meetings lack body identity precisely because that fallback
 * put 364 of 460 meetings on bodies which did not hold them, and re-introducing
 * it one layer up would be the same defect wearing the Ask pipeline's clothes.
 * The honest consequence of an unidentified meeting is that it is not
 * retrievable by body — which is true, and which more hunting fixes.
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
    /*
     * A body the registry does not hold is still a BODY and still keyed on its
     * own id. It falls back to un-slugging the id's own `#slot` half — never to
     * the division — so an unregistered body is at worst unnameable, and is
     * never another government's meetings under another government's name.
     */
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
 * A slugged division name, as a reader should see it.
 *
 * Mechanical and deliberately dumb: capitalise each word. It is not a claim
 * about what a government calls itself — the canonical id is still the identity
 * and the matcher still binds on the normalized form — it is only the
 * difference between "vail unified district" and "Vail Unified District" in a
 * sentence a person reads.
 *
 * This is the agenda route's original implementation, moved here rather than
 * merged with the grounded route's slightly different one. The two were a
 * word-boundary regex and a split-and-capitalise, equivalent for the slugged
 * names both actually receive; keeping the one that had already shipped and
 * been exercised is the conservative half of the consolidation.
 *
 * **It is applied only to names that ARE slugs.** A registry name already reads
 * as a person wrote it — *"Citizens' Water Advisory Committee"* — and forcing
 * it through here would not change it, but a name that arrives correctly cased
 * does not need it and does not get it.
 */
export function titleCaseName(slugWords: string): string {
  return slugWords
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
