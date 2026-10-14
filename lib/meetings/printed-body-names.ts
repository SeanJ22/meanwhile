const flat = (value: string) => value.replace(/\s+/g, " ").trim();

export function ownNameWords(jurisdictionId: string): ReadonlySet<string> {
  const slug = jurisdictionId.split(":")[2] ?? "";
  return new Set(slug.split("-").filter((w) => w !== "" && !/^\d+$/.test(w) && !["city", "town", "village", "township", "borough", "county", "of", "the", "school", "district", "sch", "dist"].includes(w)));
}

export const BODY_NOUNS: ReadonlySet<string> = new Set([
  "commission", "committee", "subcommittee", "board", "council", "authority", "trustees", "commissioners", "supervisors", "selectmen",
  "aldermen", "panel", "corporation", "agency", "legislature", "court", "selectboard", "jury", "freeholders", "selectpersons",
]);
const CONNECTORS: ReadonlySet<string> = new Set(["of", "and", "&", "for", "on", "the", "to"]);
export const LEADING_NOISE: ReadonlySet<string> = new Set([
  "regular", "special", "joint", "emergency", "adjourned", "rescheduled", "cancelled", "canceled", "annual", "monthly", "organizational",
  "reorganization", "work", "study", "public", "virtual", "hybrid", "quarterly", "continued", "recessed", "postponed", "amended", "revised",
  "updated", "tentative", "draft", "the", "notice", "agenda", "meeting", "of", "and", "&", "for", "on", "to",
]);
const RIGHT_STOPS: ReadonlySet<string> = new Set([
  "meeting", "meetings", "session", "sessions", "hearing", "hearings", "workshop", "agenda", "minutes", "retreat", "orientation", "training",
  "tour", "canceled", "cancelled", "postponed", "rescheduled", "regular", "special", "work", "study", "general", "budget", "business",
  "executive", "closed", "annual", "monthly", "quarterly", "emergency", "organizational", "reorganization", "public", "virtual", "hybrid",
  "briefing", "joint", "workshops", "forum", "open", "house",
]);
const MAX_OF_WORDS = 4;

interface Token { readonly text: string; readonly start: number; readonly end: number }

export function tokenize(s: string): Token[] {
  return [...s.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*(?:[.-][A-Za-z0-9'’]+)*|&/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

export interface PrintedName {
    readonly text: string;
    readonly whole: string;
  readonly start: number;
  readonly end: number;
}

export function printedNames(title: string, jurisdictionId: string): readonly PrintedName[] {
  const t = tokenize(title);
  const cap = (i: number): boolean => /^[A-Z]/.test(t[i]!.text);
  const lowAt = (i: number): string => t[i]!.text.toLowerCase();
  /* A separator between two tokens (a dash, a colon, a slash, a comma, parentheses) ends a name. */
  const joined = (i: number): boolean => i > 0 && /^\s*$/.test(title.slice(t[i - 1]!.end, t[i]!.start));
  const spans: { a: number; b: number }[] = [];
  for (let i = 0; i < t.length; i++) {
    const w = lowAt(i);
    const noun = BODY_NOUNS.has(w) || (w === "force" && i > 0 && lowAt(i - 1) === "task" && joined(i));
    if (!noun || !cap(i)) continue;
    let a = i;
    while (a > 0 && joined(a)) {
      const pw = lowAt(a - 1);
      if (cap(a - 1) && pw !== "and") {
        a -= 1;
        continue;
      }
      if (CONNECTORS.has(pw) && a - 2 >= 0 && joined(a - 1) && cap(a - 2)) {
        /* "Council and Planning Commission" is two bodies; "Parks and Recreation Commission" is one. */
        if ((pw === "and" || pw === "&") && BODY_NOUNS.has(lowAt(a - 2))) break;
        a -= 2;
        continue;
      }
      break;
    }
    let b = i;
    if (b + 1 < t.length && lowAt(b + 1) === "of" && joined(b + 1)) {
      let c = b + 2;
      if (c < t.length && lowAt(c) === "the" && joined(c)) c += 1;
      let last = -1;
      let words = 0;
      while (c < t.length && joined(c) && cap(c) && !RIGHT_STOPS.has(lowAt(c)) && words < MAX_OF_WORDS) {
        last = c;
        words += 1;
        /* A body noun ends the name: "Board of County Commissioners", "Board of Trustees". */
        if (BODY_NOUNS.has(lowAt(c))) break;
        c += 1;
        if (c + 1 < t.length && (lowAt(c) === "and" || lowAt(c) === "&") && joined(c) && joined(c + 1) && cap(c + 1) && !RIGHT_STOPS.has(lowAt(c + 1))) c += 1;
      }
      if (last >= 0) b = last;
    }
    spans.push({ a, b });
  }
  const kept = spans
    .sort((x, y) => (y.b - y.a) - (x.b - x.a) || x.a - y.a)
    .filter((s, index, all) => !all.slice(0, index).some((k) => k.a <= s.a && s.b <= k.b))
    .sort((x, y) => x.a - y.a);
  const own = ownNameWords(jurisdictionId);
  return kept.map(({ a, b }): PrintedName => {
    let from = a;
    while (from < b && (LEADING_NOISE.has(lowAt(from)) || own.has(lowAt(from)))) from += 1;
    /* The government's own class word stays printed ("County Commission" of a county); `canonical` sets it aside. */
    const words = flat(title.slice(t[from]!.start, t[b]!.end));
    return { text: words, whole: words, start: t[from]!.start, end: t[b]!.end };
  });
}
