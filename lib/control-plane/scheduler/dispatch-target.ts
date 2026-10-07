/**
 * Reads the owner's dispatch words into keys a cycle can match. Pure. A target reorders registered work
 * and never invents an obligation. STATE codes come from state names or upper-case two-letter codes;
 * every other word of three letters or more (filler removed) is a TERM. A unit matches when it carries
 * any named state and, where terms were given, at least one term.
 */
import { US_STATES } from "../readiness/catalog.ts";
import { stateCodeOf } from "../unit-state.ts";

export interface DispatchTarget {
  readonly text: string;
  readonly states: readonly string[];
  readonly stateNames: readonly string[];
  readonly terms: readonly string[];
}

const FILLER = new Set([
  "the", "and", "for", "with", "into", "onto", "over", "all", "any", "every",
  "deep", "dive", "dig", "look", "go", "run", "please", "now", "fleet", "deploy",
  "send", "start", "work", "check", "research", "hunt", "find", "get", "everything",
  "about", "around", "from", "this", "that", "these", "those", "our", "your",
  "state", "county", "city", "town", "district", "area", "focus", "prioritise",
  "prioritize", "priority", "first",
  // Command words (who is sent and the verb that sends them) are not part of the place.
  "agents", "agent", "workers", "worker", "scouts", "scout", "crew", "team", "dispatch", "put", "point", "aim", "there", "here", "out", "more",
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
    // A bare two-letter code is a state only when upper-case in the original text.
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

/** Whether a unit's id or subject carries the state code, per `unit-state.ts`. `hay` is lower-cased by the caller. */
export function unitCarriesState(hay: string, code: string): boolean {
  return stateCodeOf(hay, "") === code;
}

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
