/**
 * Reading a rule off a page's own words: how often a body meets, and how the public may speak to it. A rule is a
 * sentence or a schedule phrase the page states, never a heading, a menu item or the text of a link.
 */

const DAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
const ORDINAL = "(?:1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last|other)";
const TIME = "\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?\\s?m\\.?)";
/** "each 2nd and 4th Monday of each month at 6 p.m.", "every Tuesday", "first and third Thursdays". */
const SCHEDULE = new RegExp(
  `(?:(?:every|each)\\s+(?:${ORDINAL}(?:\\s*(?:,|and|&)\\s*${ORDINAL})*\\s+)?${DAY}s?|${ORDINAL}(?:\\s*(?:,|and|&)\\s*${ORDINAL})*\\s+${DAY}s?)` +
  `(?:\\s+of\\s+(?:each|every|the)\\s+month)?(?:\\s*(?:,|at|@)?\\s*${TIME})?`, "i");

/** The schedule a line states, in the page's own words, or null. */
export function schedulePhrase(line: string): string | null {
  return SCHEDULE.exec(line)?.[0].trim().replace(/[,;]$/, "") ?? null;
}

/** The sentence of a line that holds a phrase. */
export function sentenceWith(line: string, phrase: string): string {
  return splitSentences(line).find(sentence => sentence.includes(phrase)) ?? line;
}

function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(sentence => sentence.trim()).filter(Boolean);
}

const COMMENT = /\b(public comments?|public participation|written comments?|speak at|speak before|address the (?:council|board|commission|committee)|attend the meeting|register to speak|call to the public|citizens? (?:comments?|may speak|to be heard)|request to speak|speaker (?:card|slip|form))\b/i;
/** A line that names how the public speaks, whatever it is. */
export const mentionsComment = (text: string): boolean => COMMENT.test(text);

const VERB = /\b(is|are|was|were|be|been|may|must|shall|will|can|could|should|would|do|does|did|has|have|had|please|submit|sign|register|speak|speaks|address|addresses|attend|attends|limit|limited|allowed|required|requires|require|provide|provided|contact|email|e-mail|fill|complete|send|mail|deliver|join|watch|view|read|follow|bring|state|give|given|take|takes|taken|held|hold|holds|meets?|offer|offers|invite|invites|invited|encourage|encouraged|welcome|welcomes|wish|wishes|desire|desiring|want|wants|need|needs|include|includes|begin|begins|start|starts|receive|received|accepted|accept|accepts|ask|asks|allow|allows)\b/i;
/** A rule about a meeting, not a notice about a grant, a floodplain or a survey that happens to ask for comment. */
const MEETING_TOPIC = /\b(meetings?|council|board|commission|committee|session|hearings?|agenda|speakers?|podium|clerk|minutes)\b/i;
export const OTHER_NOTICE = /\b(floodplain|wetlands?|environmental review|fema|hud|fonsi|release of funds|grant recipient|notice of intent|survey)\b/i;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** A heading or a menu item: no sentence mark, every word capitalised. */
function headingShaped(text: string): boolean {
  const all = words(text);
  return !/[.!?:;]/.test(text.replace(/[.!?]+$/, "")) && all.filter(word => /^[\p{Lu}\d]/u.test(word)).length / all.length >= 0.7;
}

/** Whether text reads as a sentence: four words or more, a verb, and not a heading. */
export const isPlainSentence = (text: string): boolean => words(text).length >= 4 && VERB.test(text) && !headingShaped(text);

/** Whether a sentence states a rule: a verb, six words or more, not a heading and not link text. */
export function isRuleSentence(sentence: string, linkTexts: ReadonlySet<string>): boolean {
  const flat = sentence.replace(/\s+/g, " ").trim().toLowerCase();
  return words(sentence).length >= 6 && VERB.test(sentence) && !headingShaped(sentence) && ![...linkTexts].some(text => text.length > 0 && (flat === text || flat.length <= text.length + 12 && text.includes(flat) || flat.includes(text) && flat.length <= text.length + 12));
}

/** The sentences of a line that are comment rules for the body's meetings; empty when the line is a heading, link text, or a notice about something else. */
export function commentRuleSentences(line: string, linkTexts: ReadonlySet<string>): string[] {
  return splitSentences(line).filter(sentence => COMMENT.test(sentence) && MEETING_TOPIC.test(sentence) && !OTHER_NOTICE.test(sentence) && isRuleSentence(sentence, linkTexts));
}

/** A link whose own text names how to comment: its page is where the instructions are. */
export const isCommentLinkText = (text: string): boolean => COMMENT.test(text) && words(text).length <= 12;
