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

/** Case each filed all-capitals word; preserve mixed-case words and initials. */
export function surnameDisplayCase(surname: string): string {
  const trimmed = surname.trim();
  if (trimmed.length === 0) return surname;
  // Single letters with periods (initials like "B.") and suffixes keep form.
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => (part.length <= 2 || part !== part.toUpperCase() || /^\s+$/.test(part) || part === "-" ? part : caseWord(part)))
    .join("");
}

export function ballotCandidateDisplayName(candidate: Pick<Candidacy, "givenName" | "familyName">): string {
  if (candidate.givenName.trim()) return `${surnameDisplayCase(candidate.givenName)} ${surnameDisplayCase(candidate.familyName)}`.trim();
  return candidate.familyName.split(/\s*\/\s*/).map(person => {
    const [family, given, ...suffixes] = person.split(",").map(part => part.trim());
    if (!given || /^(?:jr\.?|sr\.?|[ivx]+)$/i.test(given)) return surnameDisplayCase(person.trim());
    const name = `${surnameDisplayCase(given)} ${surnameDisplayCase(family)}`;
    return suffixes.length ? `${name}, ${suffixes.map(surnameDisplayCase).join(", ")}` : name;
  }).join(" / ");
}

export function searchableSurname(filed: string): string {
  const withoutSuffix = filed.replace(/,?\s*(JR|SR|II|III|IV)\.?\s*$/i, "").trim();
  return surnameDisplayCase(withoutSuffix || filed);
}

export function searchableGiven(filed: string): string {
  return surnameDisplayCase(filed.trim().split(/\s+/)[0] ?? filed);
}
