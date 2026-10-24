import { OFFICE_NUMBER_PATTERN, officeNumber } from "./office-identity.ts";

const NUMBER = `(?:${OFFICE_NUMBER_PATTERN}|[ivxlcdm]+|[a-z])`;
const AFTER_LABEL = new RegExp(`\\b(ward|seat|position|pos\\.?|division|district|dist\\.?|group|place|class)\\s*(?:no\\.?\\s*)?[:#]?\\s*(${NUMBER})\\b`, "gi");
const BEFORE_DISTRICT = new RegExp(`\\b(${NUMBER})\\s+(?:(?:congressional|legislative|representative|senatorial|delegate)\\s+)?district\\b`, "gi");
const REPRESENTATIVE_DISTRICT = new RegExp(`\\b(${OFFICE_NUMBER_PATTERN})\\s+representative\\s+(?:in\\s+)?(?:the\\s+)?general\\s+assembly\\b`, "gi");

function seatValue(kind: string, value: string): string | null {
  const number = officeNumber(value);
  if (number !== null) return number;
  if (/^[a-z]$/i.test(value) && !["district", "division"].includes(kind)) return value.toLowerCase();
  if (/^[ivxlcdm]+$/i.test(value)) {
    const roman: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    const digits = [...value.toLowerCase()].map(letter => roman[letter]);
    return String(digits.reduce((total, digit, index) => total + (digit < (digits[index + 1] ?? 0) ? -digit : digit), 0));
  }
  return /^[a-z]$/i.test(value) ? value.toLowerCase() : null;
}

function qualifiers(title: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (kind: string, value: string) => {
    const normalized = seatValue(kind, value);
    if (normalized !== null) found.set(kind, normalized);
  };
  for (const match of title.matchAll(AFTER_LABEL)) {
    const kind = /^dist/i.test(match[1]) ? "district" : /^pos/i.test(match[1]) ? "position" : match[1].toLowerCase();
    add(kind, match[2]);
  }
  for (const match of title.matchAll(BEFORE_DISTRICT)) add("district", match[1]);
  for (const match of title.matchAll(REPRESENTATIVE_DISTRICT)) add("district", match[1]);
  for (const match of title.matchAll(/\b(?:sen|rep)\.?\s*(\d+)\b/gi)) add("district", match[1]);
  if (/\bat[-\s]large\b/i.test(title)) found.set("at-large", "true");
  for (const match of title.matchAll(/\b(?:commenc(?:ing|es)|begin(?:ning|s)|starting)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gi))
    found.set("term-start", `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`);
  for (const match of title.matchAll(/\b(?:commenc(?:ing|es)|begin(?:ning|s)|starting)\s+(\d{4}-\d{2}-\d{2})\b/gi))
    found.set("term-start", match[1]);
  return found;
}

/** Missing roster seat detail can identify a person, without proving that exact seat's incumbency. */
export function sameSeatDiscriminators(contestTitle: string, holderTitle: string, ocdId: string,
  options: { allowUnspecified?: boolean } = {}): boolean {
  const left = qualifiers(contestTitle), right = qualifiers(holderTitle);
  const district = /\/(?:cd|sldl|sldu|(?:[a-z_]+_)?district):([^/]+)$/.exec(ocdId)?.[1];
  const numberedDistrict = district && officeNumber(district);
  for (const kind of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(kind), b = right.get(kind);
    if (kind === "district" && numberedDistrict && [a, b].some(value => value && value !== numberedDistrict)) return false;
    if (a && b) { if (a !== b) return false; continue; }
    if (kind === "district" && district) continue;
    if (kind === "at-large" && district === "at-large") continue;
    if (!["at-large", "term-start", "place"].includes(kind) && ocdId.endsWith(`/${kind}:${a ?? b}`)) continue;
    if (options.allowUnspecified) continue;
    return false;
  }
  return true;
}
