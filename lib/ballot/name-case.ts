import type { Candidacy } from "./types.ts";

const EXCEPTIONS: Record<string, string> = {
  DECROCE: "DeCroce",
  DIMAIO: "DiMaio",
  DELGAUDIO: "DelGaudio",
  LAVECCHIA: "LaVecchia",
  MACDONALD: "MacDonald",
  MCDONALD: "McDonald",
};

/** Generational suffixes that are correctly all-caps and must not be cased. */
const KEEP_AS_IS = new Set(["II", "III", "IV", "V"]);

function caseWord(word: string): string {
  if (word.length === 0) return word;
  if (KEEP_AS_IS.has(word)) return word;
  const exception = EXCEPTIONS[word];
  if (exception) return exception;

  // O'BRIEN / D'AMATO / L'HEUREUX — capital after the apostrophe.
  const apostrophe = word.match(/^([ODL])(['’])(.+)$/);
  if (apostrophe) {
    return `${apostrophe[1]}${apostrophe[2]}${caseWord(apostrophe[3])}`;
  }

  // McDONALD / MCDONALD — Mc keeps its internal capital. (Mac is NOT safely
  // inferable — MACEY is not MacEy — so Mac names go via the exceptions map.)
  if (word.startsWith("MC") && word.length > 2) {
    return `Mc${caseWord(word.slice(2))}`;
  }

  return word.charAt(0) + word.slice(1).toLowerCase();
}

/** The generational suffixes written Jr/Sr however they were filed; other two-letter capitals may be initials. */
const CASED_SHORT_SUFFIX = /^(?:JR|SR)$/;

/** Case each filed all-capitals word; preserve mixed-case words and initials. */
export function surnameDisplayCase(surname: string): string {
  const trimmed = surname.trim();
  if (trimmed.length === 0) return surname;
  // Initials ("B.", "S.K.", a quoted "BJ") keep the form the filing prints; JR and SR are written Jr and Sr.
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => ((part.replace(/[^A-Za-z]/g, "").length <= 2 && !CASED_SHORT_SUFFIX.test(part.replace(/[^A-Za-z]/g, ""))) ||
      /^(?:[A-Z]\.)+$/.test(part) || part !== part.toUpperCase() || /^\s+$/.test(part) || part === "-" ? part : caseWord(part)))
    .join("");
}

export function ballotCandidateDisplayName(candidate: Pick<Candidacy, "givenName" | "familyName" | "ticket">): string {
  if (candidate.ticket) return `${ballotCandidateDisplayName({ ...candidate, ticket: undefined })} / ${ballotCandidateDisplayName(candidate.ticket.runningMate)}`;
  const givenName = candidate.givenName ?? "", familyName = candidate.familyName ?? "";
  if (givenName.trim()) return `${surnameDisplayCase(givenName)} ${surnameDisplayCase(familyName)}`.trim();
  return familyName.split(/\s*\/\s*/).map(person => {
    const [family, given, ...suffixes] = person.split(",").map(part => part.trim());
    if (!given || /^(?:jr\.?|sr\.?|[ivx]+)$/i.test(given)) return surnameDisplayCase(person.trim());
    const name = `${surnameDisplayCase(given)} ${surnameDisplayCase(family)}`;
    return suffixes.length ? `${name}, ${suffixes.map(surnameDisplayCase).join(", ")}` : name;
  }).join(" / ");
}
