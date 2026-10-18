import { normalizeName } from "../routing/exact-name.ts";
import { bindNamedEntity, classPhraseIn, distinctiveTokens, mentionBeforeClassPhrase, COMMON_QUESTION_NOUNS, CLASS_PHRASE_DIVISIONS, type BindableEntity } from "../routing/named-entity.ts";
import type { ResolutionResult } from "./resolve.ts";

/** Ephemeral round-trip context, never persisted as reader data. */
export interface BodyConfirmation { bodyId: string; name: string; question: string }
export type BodyDecision =
  | { kind: "NONE" }
  | { kind: "BOUND"; entity: BindableEntity; confirmed: boolean }
  | { kind: "CONFIRM"; candidate: BindableEntity; alternatives: BindableEntity[] }
  | { kind: "CLARIFY" };

/** Damerau-Levenshtein: a transposed pair is one typo, not a new alias. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

function initials(entity: BindableEntity): string[] {
  const all = normalizeName(entity.name).split(" ").filter(word => word !== "the");
  const words = all.filter(word => !["of", "and"].includes(word));
  const core = [...words];
  while (["governing", "board", "directors", "trustees"].includes(core.at(-1) ?? "")) core.pop();
  const district = normalizeName(entity.name).replace(/ (?:governing board|board of education|board of trustees|board of directors|governing|board)$/, "").split(" ");
  const boardAt = all.indexOf("board");
  const values = [all.map(word => word[0]).join(""), words.map(word => word[0]).join(""),
    core.map(word => word[0]).join(""), district.map(word => word[0]).join(""),
    ...(boardAt >= 0 ? [all.slice(boardAt).map(word => word[0]).join("")] : [])];
  // The registry can omit the classifier "school" from a school district's
  // own name. This is a mechanical acronym expansion, never an alias table.
  if (entity.divisionType === "school_district" && !words.includes("school")) {
    values.push(core.map(word => word === "district" ? "sd" : word[0]).join(""));
  }
  return values.filter(value => value.length >= 3);
}

/** Resolve reader wording against canonical bodies, using their place to break local-name ties. */
export function decideNamedBody(question: string, bodies: readonly BindableEntity[], confirmation?: unknown, mentions: readonly string[] = [], localDivisionIds: readonly string[] = []): BodyDecision {
  const phrase = classPhraseIn(question);
  const wanted = phrase ? CLASS_PHRASE_DIVISIONS[phrase] : null;
  const eligible = bodies.filter(entity => entity.level === "BODY" &&
    distinctiveTokens(entity.name).some(value => value.length >= 3 && !COMMON_QUESTION_NOUNS.has(value)) &&
    (!wanted || wanted.includes(entity.divisionType ?? "") || (!entity.divisionType && classPhraseIn(entity.name) === phrase)));
  const binding = bindNamedEntity(question, eligible);
  if (binding.kind === "BOUND") return { kind: "BOUND", entity: binding.entity, confirmed: false };
  const questionWords = new Set(normalizeName(question).split(" "));
  // Ordinary question words can coincide with a body's initials (HOW, CAN).
  // An explicit capitalized acronym still names that body.
  const grammar = /^(?:the|and|for|what|when|where|which|who|whose|why|how|can|could|will|would|should|has|have|had|may|does|did|are|was|were|our|their|this|that|with|from|about|any|all|last|next)$/i;
  const acronymWords = new Set((question.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word =>
    word === word.toUpperCase() || !grammar.test(word) && !COMMON_QUESTION_NOUNS.has(word.toLowerCase())).map(word => word.toLowerCase()));
  const agendaName = /\b(?:on|for)\s+(?:the\s+)?(.+?)\s+(?:agenda|docket)\b/.exec(normalizeName(question))?.[1];
  const agendaTokens = agendaName ? distinctiveTokens(agendaName).filter(word => word.length >= 3 && !COMMON_QUESTION_NOUNS.has(word) &&
    !["my", "our", "their", "its", "this", "that", "next", "upcoming", "past", "last", "all", "regular", "special", "today", "tonight", "tomorrow"].includes(word)) : [];
  const mention = mentionBeforeClassPhrase(question) ?? agendaTokens.join(" ");
  const explicit = mentions.filter(value => normalizeName(question).includes(normalizeName(value)));
  const scored = eligible.flatMap(entity => {
    if (binding.kind === "AMBIGUOUS") return binding.candidates.some(value => value.id === entity.id) ? [{ entity, score: 100 }] : [];
    if (initials(entity).some(value => acronymWords.has(value))) return [{ entity, score: 90 + Number(Boolean(entity.divisionType)) }];
    if (!mention && explicit.length === 0) return [];
    const identifying = distinctiveTokens(entity.name).filter(value => !COMMON_QUESTION_NOUNS.has(value));
    if (!identifying.length) return [];
    const score = identifying.reduce((total, value) => {
      const best = Math.min(...[...questionWords].filter(word => word.length >= 3).map(word => distance(value, word)));
      const max = value.length >= 7 ? 2 : value.length >= 4 ? 1 : 0;
      return total + (best <= max ? 1 - best / value.length : 0);
    }, 0) / identifying.length;
    return score >= 0.7 ? [{ entity, score: score * 80 + Number(Boolean(entity.divisionType)) }] : [];
  }).sort((a, b) => b.score - a.score ||
    // Keep ordering stable when several names have the same match score.
    Number(b.entity.id.endsWith("#governing")) - Number(a.entity.id.endsWith("#governing")) ||
    a.entity.name.localeCompare(b.entity.name) || a.entity.id.localeCompare(b.entity.id));
  // Multiple registry names for one body are one answer. A governing-board
  // suffix is the same district's governing body, not a rival acronym match.
  const byId = new Map<string, typeof scored[number]>();
  for (const row of scored) if (!byId.has(row.entity.id)) byId.set(row.entity.id, row);
  const distinct = [...byId.values()];
  const best = distinct[0]?.score;
  let choices = distinct.filter(row => best !== undefined && best - row.score < 2);
  // A directory entry and the same district's sourced governing board do
  // not present two plausible calendars. Keep distinct local governments tied.
  if (/\b(?:meet\w*|agenda|docket|session|decid\w*|vote\w*)\b/i.test(question)) {
    choices = choices.filter(row => !row.entity.id.startsWith("government:") || !choices.some(other =>
      other.entity.id !== row.entity.id && other.entity.ocdId && other.entity.ocdId === row.entity.ocdId &&
      /#(?:governing|board)$/.test(other.entity.id)));
  }
  const local = choices.filter(row => row.entity.ocdId && localDivisionIds.includes(row.entity.ocdId));
  if (local.length) choices = local;
  const candidate = choices[0]?.entity;
  if (!candidate) return mention || explicit.length || binding.kind !== "NONE" ? { kind: "CLARIFY" } : { kind: "NONE" };
  const supplied = confirmation && typeof confirmation === "object" ? confirmation as Partial<BodyConfirmation> : null;
  // Recompute the suggestion from the ORIGINAL question. A client cannot send
  // a nearby body's ID, or reuse a confirmation against a different question.
  const selected = choices.find(row => row.entity.id === supplied?.bodyId)?.entity;
  if (selected && supplied?.question === question) return { kind: "BOUND", entity: selected, confirmed: true };
  if (choices.length === 1) return { kind: "BOUND", entity: candidate, confirmed: false };
  return { kind: "CONFIRM", candidate, alternatives: choices.slice(1).map(row => row.entity) };
}

/** Wrap the existing person/ballot/pronoun resolver only for named bodies. */
export function applyNamedBodyDecision(decision: BodyDecision, resolved: ResolutionResult, question: string): ResolutionResult {
  if (decision.kind === "BOUND") return { binding: { kind: "BOUND", entity: decision.entity, matchedOn: question }, basis: decision.confirmed ? "READER_CONFIRMATION" : "WHOLE_QUESTION", boundOn: question };
  if (decision.kind === "CONFIRM" || decision.kind === "CLARIFY") return { binding: { kind: "UNRESOLVED", mention: question }, basis: "WHOLE_QUESTION", boundOn: question };
  return resolved;
}
