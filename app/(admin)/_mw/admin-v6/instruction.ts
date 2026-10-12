/** A fixed matcher over the supported actions, not a model call, so operating Admin never spends money. The server re-checks every action. */
import type { ActionKind, Place, StuckItem } from "./model.ts";
import { COUNTRY_KEY, isWithin, relation, type PlaceIndex } from "./places.ts";

export interface ParsedAction {
  readonly kind: ActionKind;
  readonly target: string;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface Parsed {
  readonly text: string;
  readonly actions: readonly ParsedAction[];
  readonly clarify: { readonly question: string; readonly options: readonly { readonly value: string; readonly label: string }[] } | null;
  readonly unsupported: boolean;
}

export const INSTRUCTION_EXAMPLES: readonly string[] = [
  "Put this place first",
  "Reprocess the files we already saved",
  "Use https://www.cochise.az.gov/agendacenter as the official source",
  "Try another method for anything stuck",
  "Stop repeating what keeps failing, everywhere",
  "Recheck the reader card",
  "The software can’t read this format. Get it fixed",
];

export function parseInstruction(input: {
  readonly text: string;
  readonly scope: string;
  readonly places: readonly Place[];
  readonly index: PlaceIndex;
  readonly stuck: readonly StuckItem[];
  readonly chosenBody: string | null;
}): Parsed {
  const text = input.text.trim();
  const t = text.toLowerCase();
  const acts: ParsedAction[] = [];
  let clarify: Parsed["clarify"] = null;
  const everywhere = /everywhere|all (the )?(places|states|affected)|across|nationwide/.test(t);
  const target = everywhere ? COUNTRY_KEY : input.scope;
  const scopePlace = input.index.get(input.scope);

  const url = (text.match(/https?:\/\/\S+/) ?? [])[0];
  if (url) {
    if (scopePlace?.kind === "Body") {
      acts.push({ kind: "use-url", target: input.scope, payload: { url } });
    } else {
      const bodies = input.places.filter((p) => p.kind === "Body" && isWithin(input.index, p.key, input.scope));
      clarify = { question: "Which body is this address for?", options: bodies.map((b) => ({ value: b.key, label: b.name })) };
      if (input.chosenBody && bodies.some((b) => b.key === input.chosenBody)) acts.push({ kind: "use-url", target: input.chosenBody, payload: { url } });
    }
  }
  if (/prioriti|first|sooner|urgent|faster/.test(t)) acts.push({ kind: "scope-first", target });
  if (/reprocess|already (saved|have)|saved (file|evidence|cop)|what we saved/.test(t)) acts.push({ kind: "reprocess", target });
  if (/another method|different (way|method)|other (way|method)/.test(t)) acts.push({ kind: "retry-method", target });
  if (/wrong (county|place|body|card)|belongs? to|association|attached/.test(t)) {
    const wrong = input.stuck.find((i) => i.actions.some((a) => a.kind === "contain") && relation(input.index, i.applies, input.scope) !== null);
    if (wrong) acts.push({ kind: "contain", target: wrong.id });
    else clarify = clarify ?? { question: "Which card has the wrong records?", options: [] };
  }
  if (/stop (retry|repeat|trying)|keeps? failing|stop wasting/.test(t)) acts.push({ kind: "scope-stop", target });
  if (/publish|verif|recheck|check the (page|card)|reader/.test(t)) acts.push({ kind: "resume-publish", target });
  if (/code|bug|software|engineer|developer/.test(t)) {
    const item = input.stuck.find((i) => i.lane === "software" && i.fixId && relation(input.index, i.applies, input.scope) !== null);
    if (item?.fixId) acts.push({ kind: "eng-task", target: item.fixId, payload: { item: item.id } });
    else clarify = clarify ?? { question: "Which software problem should engineers fix?", options: [] };
  }
  const seen = new Set<string>();
  const actions = acts.filter((a) => {
    const k = `${a.kind}|${a.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { text, actions, clarify, unsupported: actions.length === 0 && clarify === null };
}
