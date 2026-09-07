/**
 * **THE OWNER'S DISPATCH TARGET, READ INTO SOMETHING A CYCLE CAN MATCH.**
 * (ADM-8, 9.4.26 admin feedback.)
 *
 * The owner types what he wants in plain words — "deep dive on Illinois",
 * "Pima County campaign finance", "85701" — and the fleet is dispatched
 * accordingly. This module is the whole translation, and it is PURE: no
 * clock, no store, no network, so a test can pin every reading.
 *
 * ## What a target may do, and what it may not
 *
 * A dispatch REORDERS AND PRIORITISES registered work. It never invents an
 * obligation: the registry's providers enumerate the universe from committed
 * files (RULING 273 — the denominator is finite and stated at the start), and
 * a target that matches nothing registered is honored with a sentence saying
 * so, never with a manufactured unit. Adding a state to the registry is a
 * scope decision, and it goes to the owner as a row rather than being made by
 * a button.
 *
 * ## How matching works
 *
 * Two kinds of key come out of the text:
 *   - STATE codes, from any state or territory name or two-letter code in the
 *     text ("Illinois" → il, "NH" → nh). A unit matches a state when its id or
 *     subject carries `state:<code>` (every OCD-shaped id does) or `/<code>/`.
 *   - TERMS, every other word of three letters or more, lower-cased, with the
 *     filler stripped ("deep", "dive", "on", "the", ...). A unit matches a term
 *     when its id or subject contains it.
 *
 * A unit matches the target when it matches EVERY state named and at least
 * one term where terms were given; a target of only a state matches the whole
 * state. That reading is deliberately literal — "deep dive on Illinois" is
 * "everything registered for Illinois", not a guess at what deep means.
 */
import { US_STATES } from "../readiness/catalog.ts";
import { stateCodeOf } from "../unit-state.ts";

export interface DispatchTarget {
  /** The owner's words, whitespace-normalised. */
  readonly text: string;
  /** Two-letter lower-case codes named in the text, in the order first seen. */
  readonly states: readonly string[];
  /** Full names for those codes, for a sentence. */
  readonly stateNames: readonly string[];
  /** Remaining lower-cased search terms (three letters or more, filler removed). */
  readonly terms: readonly string[];
}

/** Words that carry no target: verbs, articles, the owner's phrasing. */
const FILLER = new Set([
  "the", "and", "for", "with", "into", "onto", "over", "all", "any", "every",
  "deep", "dive", "dig", "look", "go", "run", "please", "now", "fleet", "deploy",
  "send", "start", "work", "check", "research", "hunt", "find", "get", "everything",
  "about", "around", "from", "this", "that", "these", "those", "our", "your",
  "state", "county", "city", "town", "district", "area", "focus", "prioritise",
  "prioritize", "priority", "first",
]);

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(
  US_STATES.map((s) => [s.name.toLowerCase(), s.code]),
);
const CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code));

export function parseDispatchTarget(raw: string): DispatchTarget {
  const text = raw.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const states: string[] = [];
  let rest = lower;

  // Longest names first so "West Virginia" wins over "Virginia".
  const names = [...NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const at = rest.indexOf(name);
    if (at === -1) continue;
    const before = at === 0 ? " " : rest[at - 1];
    const after = at + name.length >= rest.length ? " " : rest[at + name.length];
    if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;
    const code = NAME_TO_CODE.get(name)!;
    if (!states.includes(code)) states.push(code);
    rest = `${rest.slice(0, at)} ${rest.slice(at + name.length)}`;
  }

  const terms: string[] = [];
  for (const word of rest.split(/[^a-z0-9]+/)) {
    if (word.length === 0) continue;
    // A bare two-letter code is a state only when it is upper-case in the
    // owner's text ("NH", not "in" or "or"), so the original casing is checked.
    if (word.length === 2 && CODES.has(word)) {
      const upper = new RegExp(`(^|[^A-Za-z])${word.toUpperCase()}([^A-Za-z]|$)`);
      if (upper.test(text)) {
        if (!states.includes(word)) states.push(word);
        continue;
      }
    }
    if (word.length < 3 && !/^\d+$/.test(word)) continue;
    if (FILLER.has(word)) continue;
    if (!terms.includes(word)) terms.push(word);
  }

  return {
    text,
    states,
    stateNames: states.map((c) => US_STATES.find((s) => s.code === c)?.name ?? c.toUpperCase()),
    terms,
  };
}

/**
 * Does a registered unit (its id and subject) carry a state code? Ids take
 * several shapes — `az-sos-cfs-bulk-ftp`, `AZ_SEETHEMONEY_PLAIN_FETCH`,
 * `freshness:candidate-enrichment:nh:2026:...`, `state-az-sldl-11`,
 * `ocd-division/country:us/state:az/...` — so a code counts only where an id
 * puts a state: after `state:` or `state-`, at the very start, or as a whole
 * colon- or slash-delimited segment. A hyphen-bounded token in the middle of a
 * slug is NOT a state: "representative-in-congress" is not Indiana and
 * "de-los-santos" is not Delaware.
 *
 * That last sentence was the INTENT and the regex did not honour it: the
 * lookahead admitted a following hyphen, so `…:de-venezia-marie` — a New Jersey
 * town-council candidate — carried Delaware, and `ballot-az-pima` carried no
 * state at all because the hyphen BEFORE the code was not admitted. Both were
 * read back from the production control plane on 2026-09-06 (ADM-29). The rule
 * now lives in one place, `lib/control-plane/unit-state.ts`, which reads the
 * id's structure and attributes a unit to at most one state; this function is
 * the predicate shape the target matcher and the two publishers already call.
 * `hay` is lower-cased by the caller.
 */
export function unitCarriesState(hay: string, code: string): boolean {
  return stateCodeOf(hay, "") === code;
}

/**
 * Does a registered unit (its id and subject) match the target? A unit
 * matches when it carries ANY state the owner named (a target naming two
 * states means both), and, where terms were given, at least one term.
 */
export function unitMatchesTarget(
  target: DispatchTarget,
  unit: { readonly id: string; readonly subjectId: string },
): boolean {
  const hay = `${unit.id} ${unit.subjectId}`.toLowerCase();
  if (target.states.length > 0 && !target.states.some((code) => unitCarriesState(hay, code))) {
    return false;
  }
  if (target.terms.length === 0) return target.states.length > 0;
  return target.terms.some((t) => hay.includes(t));
}

/**
 * The sentence the HONORED record carries. It states the denominator, and when
 * nothing matched it says WHY in the owner's own vocabulary rather than
 * leaving a zero to read as an idle fleet.
 */
export function describeDispatchMatch(
  target: DispatchTarget,
  matched: number,
  registered: number,
  registeredStates: readonly string[],
): string {
  const named =
    target.stateNames.length > 0 ? target.stateNames.join(", ") : `"${target.text}"`;
  if (registered === 0) {
    return `"${target.text}": the registry enumerated no units at all this cycle, so nothing could be dispatched — that is a registry failure, not an idle fleet.`;
  }
  if (matched === 0) {
    const unregistered = target.states.filter((c) => !registeredStates.includes(c));
    const why =
      unregistered.length > 0
        ? ` ${unregistered
            .map((c) => target.stateNames[target.states.indexOf(c)] ?? c)
            .join(", ")} is not enumerated yet: no jurisdiction registry exists for it, and enumerating a new state is a scope decision that goes to you as a row, never a button.`
        : " Nothing registered carries those words.";
    return `"${target.text}" matched 0 of ${registered} registered units.${why}`;
  }
  return `"${target.text}" matched ${matched} of ${registered} registered units for ${named}; they were placed first in both lanes this cycle.`;
}
