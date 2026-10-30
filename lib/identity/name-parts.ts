/** A published name taken apart: given name, middle names, surname, and any nickname the record itself prints. Parsing only; who a name belongs to is decided by `matchPerson`. */

export const NAME_SUFFIXES: ReadonlySet<string> = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** The shape every name comparison takes. `aliases` is optional for callers that build one by hand; `nameParts` always fills it. */
export interface ComparableName {
  first: string;
  middles: string[];
  last: string;
  aliases?: string[];
  /** A generational suffix the name prints (jr, sr, ii, iii, iv, v). Two names that print different ones are two people. */
  suffix?: string;
}
export type ParsedName = Required<Omit<ComparableName, "suffix">> & Pick<ComparableName, "suffix">;

const clean = (s: string) => s.toLowerCase().replace(/[.,'"`]/g, " ").replace(/\s+/g, " ").trim();

/** A name with its accents taken off, for callers whose sources spell one person with and without them. */
export const foldAccents = (name: string): string => name.normalize("NFKD").replace(/\p{M}/gu, "");

/** Drops case, punctuation and generational suffixes; middle names come back separately. A name the record prints in double quotes or parentheses is an alias; an apostrophe never delimits one. */
export function nameParts(given: string, family: string): ParsedName {
  const aliases: string[] = [];
  const givenWithoutAliases = String(given ?? "")
    .replace(/[“"]([^”"]+)[”"]/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    })
    .replace(/\(([^)]+)\)/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    });

  const givenTokens = clean(givenWithoutAliases).split(" ").filter(Boolean);
  const familyTokens = clean(family).split(" ").filter((t) => t.length > 0 && !NAME_SUFFIXES.has(t));

  return {
    first: givenTokens[0] ?? "",
    middles: givenTokens.slice(1),
    last: familyTokens.join(" "),
    aliases: aliases.map(clean).filter(Boolean),
  };
}

export function splitDisplayName(display: string): { givenName: string; familyName: string } {
  const tokens = display.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return { givenName: "", familyName: "" };
  if (tokens.length === 1) return { givenName: "", familyName: tokens[0] };

  let end = tokens.length - 1;
  while (end > 0 && NAME_SUFFIXES.has(tokens[end].toLowerCase().replace(/[.,]/g, ""))) end -= 1;
  return { givenName: tokens.slice(0, end).join(" "), familyName: tokens[end] };
}

/** A name as an agency or a ballot prints it: `SURNAME, FORENAME MIDDLE` or `Forename Middle Surname`. */
export function parsePersonName(printedName: string): ParsedName {
  // A suffix after a comma ("Ebert, III") is part of the name, not the start of a surname-first name.
  const display = printedName.replace(/,\s*(jr|sr|ii|iii|iv)\.?\s*$/i, " $1");
  const printed = display.trim().split(/\s+/), tail = printed.at(-1)!.toLowerCase().replace(/[.,]/g, "");
  const parts = withoutSuffix(display);
  return printed.length > 1 && NAME_SUFFIXES.has(tail) ? { ...parts, suffix: tail } : parts;
}

function withoutSuffix(display: string): ParsedName {
  const comma = display.indexOf(",");
  if (comma > 0) {
    const [family, ...rest] = display.split(",");
    const given = rest.join(" ").trim().split(/\s+/).filter(Boolean);
    while (given.length > 1 && NAME_SUFFIXES.has(given[given.length - 1].toLowerCase().replace(/[.,]/g, ""))) given.pop();
    return nameParts(given.join(" "), family);
  }
  const { givenName, familyName } = splitDisplayName(display);
  return nameParts(givenName, familyName);
}
