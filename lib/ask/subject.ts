import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";

/**
 * **WHAT A SURFACE CAN HONESTLY SAY IS ON SCREEN.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## Why this is not a list of strings
 *
 * The ballot surface shipped its page context as contest titles and candidate
 * names — display strings, nothing else. They travelled to the interpretation
 * rung as prose and stopped there: the binder never saw them, so a challenger
 * on the reader's own ballot was not an entity this product could resolve,
 * and *"what has she done?"* had nothing canonical to point at. Katie Hobbs
 * worked because she is a statewide executive derived from the reader's
 * divisions, not because the ballot contributed anything.
 *
 * A display string cannot carry identity. Two candidates share a surname; a
 * contest title is not unique across elections; a measure is known by a number
 * that means nothing outside its own filing. So a surface passes REFERENCES —
 * the canonical id where it has one, the name for the model to read, and the
 * kind of thing it is — and retrieval selects on the id.
 *
 * ## `focused` is the difference between a referent and a guess
 *
 * A ballot page has every contest and every candidate on it. If "on screen"
 * meant all of them, a pronoun would be ambiguous every single time and the
 * follow-up would never work. If it meant "pick the first", the product would
 * be choosing a person for the reader, which is the substitution class wearing
 * a different hat.
 *
 * `focused` is what the reader actually opened — one battlecard, one contest.
 * A pronoun resolves against the focused set when that set decides it, and
 * asks otherwise. Nothing here ever picks between two plausible people.
 */

export type AskSubjectKind =
  | "BODY"
  | "PERSON"
  | "OFFICE"
  | "CONTEST"
  | "MEASURE";

/**
 * One thing a surface can say the reader is looking at, or that a prior turn
 * resolved to.
 *
 * `id` is the canonical identifier where the surface holds one. It is optional
 * only because a surface may legitimately know a name and no id — but a
 * reference with no id can never be RETRIEVED from, only bound by name, which
 * is why the ballot passes ids for everything it renders.
 */
export interface AskSubjectRef {
  id?: string | null;
  name: string;
  kind?: AskSubjectKind | null;
  /** The card the reader has open, as opposed to merely on the page. */
  focused?: boolean;
}

/** The reference shape as it arrives over the wire, before validation. */
export function readSubjectRefs(raw: unknown, max = 60): AskSubjectRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AskSubjectRef[] = [];
  for (const entry of raw.slice(0, max)) {
    /* A bare string is still accepted — the map surface has names and no ids
       for some of what it shows, and refusing those would silently remove page
       context rather than degrade it. */
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ name: entry.trim().slice(0, 160) });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
    if (!name && !id) continue;
    out.push({
      id: id ? id.slice(0, 240) : null,
      name: (name || id || "").slice(0, 160),
      kind: SUBJECT_KINDS.includes(value.kind as AskSubjectKind)
        ? (value.kind as AskSubjectKind)
        : null,
      focused: value.focused === true,
    });
  }
  return out;
}

export const SUBJECT_KINDS: AskSubjectKind[] = [
  "BODY",
  "PERSON",
  "OFFICE",
  "CONTEST",
  "MEASURE",
];

/**
 * An `EvidenceSubject`'s kind, as a surface reference's kind.
 *
 * **This exists because a surface was writing `PERSON` for everything.**
 * (ASK-05, 2026-08-28.) `components/ask/ask-box.tsx` pushed
 * `kind: "PERSON" as const` into the follow-up context for EVERY subject the
 * engine resolved — a school district, a ballot measure, a contest, all of
 * them recorded as people in the very list a later pronoun resolves against.
 *
 * It did not usually produce a wrong answer, because `resolveSubjectRef` tries
 * the id first and the ids were right. It produced a wrong REASON, which is
 * the more dangerous of the two: the moment a reference arrived without an id
 * — which `readSubjectRefs` explicitly accepts, because the map surface has
 * names and no ids for some of what it shows — the kind would have been the
 * discriminant, and it was a constant.
 *
 * The two vocabularies are separate on purpose and the mapping is total:
 * `EvidenceSubject.kind` is what RETRIEVAL resolved, `AskSubjectKind` is what
 * a SURFACE can say is on screen. They agree member for member today, and the
 * table below is `Record`-typed on BOTH so the day either grows a member the
 * compiler names it, rather than a cast quietly picking a default.
 */
type EvidenceSubjectKind = "BODY" | "PERSON" | "MEASURE" | "CONTEST" | "OFFICE";

const SUBJECT_KIND_OF: Readonly<Record<EvidenceSubjectKind, AskSubjectKind>> = {
  BODY: "BODY",
  PERSON: "PERSON",
  MEASURE: "MEASURE",
  CONTEST: "CONTEST",
  OFFICE: "OFFICE",
};

export function subjectKindOf(kind: EvidenceSubjectKind): AskSubjectKind {
  return SUBJECT_KIND_OF[kind];
}

/**
 * Resolve one surface reference against the inventory this request can answer
 * from.
 *
 * **The id is tried first and it is an EXACT match, never a fuzzy one.** That
 * is the whole reason a surface passes ids: a candidate named "Chris King" on
 * a Vail ballot and a Chris King anywhere else are one string and two people,
 * and only the id separates them. The name is a fallback for surfaces that
 * genuinely hold no id, and it goes through the same binder every other
 * candidate does — so a name that fits two entities does not silently pick one.
 */
export function resolveSubjectRef(
  ref: AskSubjectRef,
  entities: readonly BindableEntity[],
): BindableEntity | null {
  if (ref.id) {
    const exact = entities.find((e) => e.id === ref.id);
    if (exact) return exact;
  }
  if (!ref.name) return null;
  const binding = bindNamedEntity(ref.name, entities);
  return binding.kind === "BOUND" ? binding.entity : null;
}

/**
 * Every reference that resolved, de-duplicated by canonical id, with the
 * reference that produced each kept alongside.
 *
 * De-duplication is by ID rather than by name for the reason above: the same
 * person can legitimately appear as a candidate reference and as an
 * officeholder reference on one page, and counting them as two would turn a
 * defensible referent into a false ambiguity.
 */
export function resolveSubjectRefs(
  refs: readonly AskSubjectRef[],
  entities: readonly BindableEntity[],
): { ref: AskSubjectRef; entity: BindableEntity }[] {
  const seen = new Set<string>();
  const out: { ref: AskSubjectRef; entity: BindableEntity }[] = [];
  for (const ref of refs) {
    const entity = resolveSubjectRef(ref, entities);
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    out.push({ ref, entity });
  }
  return out;
}
