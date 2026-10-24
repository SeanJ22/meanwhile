const words = (value: string): string =>
  value
    .replace(/Hawai[‘’' ]i/gi, "Hawaii")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const hasWords = (whole: string, part: string): boolean =>
  ` ${whole} `.includes(` ${part} `);
// Census names parts of an address in USPS form (W, ST, AZ); a publisher spells them out (West, Street, Arizona).
const USPS_WORDS: Readonly<Record<string, string>> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  boulevard: "blvd",
  court: "ct",
  circle: "cir",
  expressway: "expy",
  plaza: "plz",
  center: "ctr",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  terrace: "ter",
  trail: "trl",
  square: "sq",
  way: "way",
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  wisconsin: "wi",
  wyoming: "wy",
};
const TWO_WORD_STATES: ReadonlyArray<readonly [string, string]> = [
  ["new hampshire", "nh"],
  ["new jersey", "nj"],
  ["new mexico", "nm"],
  ["new york", "ny"],
  ["north carolina", "nc"],
  ["north dakota", "nd"],
  ["south carolina", "sc"],
  ["south dakota", "sd"],
  ["west virginia", "wv"],
  ["rhode island", "ri"],
];
const usps = (value: string): string =>
  TWO_WORD_STATES.reduce(
    (text, [name, code]) =>
      ` ${text} `.replace(` ${name} `, ` ${code} `).trim(),
    words(value),
  )
    .split(" ")
    .map((word) => USPS_WORDS[word] ?? word)
    .join(" ");

interface CensusMatch {
  readonly matchedAddress?: string;
  readonly coordinates?: { readonly x?: number; readonly y?: number };
  readonly addressComponents?: {
    readonly city?: string;
    readonly state?: string;
    readonly zip?: string;
    readonly streetName?: string;
    readonly preDirection?: string;
    readonly suffixType?: string;
  };
}

/**
 * A Census street point is accepted only for one exact house/street/city/state match.
 * The ZIP is checked only when the published text carries one.
 */
export function verifiedCensusVenuePoint(
  published: string,
  response: unknown,
): { lat: number; lng: number; address: string } | null {
  const matches = (response as { result?: { addressMatches?: CensusMatch[] } })
    ?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  const components = match.addressComponents;
  const address = match.matchedAddress ?? "";
  const house = /^\s*(\d+)\b/.exec(address)?.[1];
  if (
    !house ||
    !components?.streetName ||
    !components.city ||
    !components.state
  )
    return null;
  const folded = usps(published);
  const street = usps(
    [
      house,
      components.preDirection,
      components.streetName,
      components.suffixType,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (
    !hasWords(folded, street) ||
    !hasWords(folded, usps(components.city)) ||
    !hasWords(folded, usps(components.state))
  )
    return null;
  const zipPattern = new RegExp(
    `\\b${usps(components.state)}\\s+(\\d{5})\\b`,
    "g",
  );
  const publishedZip =
    [...folded.matchAll(zipPattern)].at(-1)?.[1] ??
    /\b(\d{5})(?:-\d{4})?\s*$/.exec(published)?.[1];
  if (publishedZip && components.zip !== publishedZip) return null;
  const lat = match.coordinates?.y;
  const lng = match.coordinates?.x;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return null;
  return { lat, lng, address };
}
