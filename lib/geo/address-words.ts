const words = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/Hawai[‘’' ]i/gi, "Hawaii")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
export const addressWords = (value: string): string =>
  TWO_WORD_STATES.reduce(
    (text, [name, code]) =>
      ` ${text} `.replace(` ${name} `, ` ${code} `).trim(),
    words(value),
  )
    .split(" ")
    .map((word) => USPS_WORDS[word] ?? word)
    .join(" ");
