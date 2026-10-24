/** Only the agenda's header is read: the place a sitting is held is stated first. */
const HEADER_CHARS = 700;

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20",
};
const DIRECTIONALS: Readonly<Record<string, string>> = {
  north: "n", south: "s", east: "e", west: "w", n: "n", s: "s", e: "e", w: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", ne: "ne", nw: "nw", se: "se", sw: "sw",
};
const SUFFIXES: Readonly<Record<string, string>> = {
  street: "st", st: "st", avenue: "ave", ave: "ave", boulevard: "blvd", blvd: "blvd", road: "rd", rd: "rd",
  drive: "dr", dr: "dr", place: "pl", pl: "pl", way: "way", lane: "ln", ln: "ln", court: "ct", ct: "ct",
  parkway: "pkwy", pkwy: "pkwy", circle: "cir", cir: "cir", highway: "hwy", hwy: "hwy", plaza: "plz", plz: "plz",
};

const NUMBER = `(\\d{1,6}|${Object.keys(NUMBER_WORDS).join("|")})`;
const DIRECTIONAL = `(?:(${Object.keys(DIRECTIONALS).join("|")})\\.?\\s+)?`;
const NAME = "((?:[A-Za-z0-9][A-Za-z0-9'-]*\\s+){0,3}?[A-Za-z0-9][A-Za-z0-9'-]*)";
const SUFFIX = `(${Object.keys(SUFFIXES).join("|")})\\b\\.?`;
/** A street address: a number, an optional directional, one to four name words, a suffix. */
const STREET = new RegExp(`\\b${NUMBER}\\s+${DIRECTIONAL}${NAME}\\s+${SUFFIX}`, "i");
/** "Broadway" and its kin are whole street names with no suffix. */
const SUFFIXLESS = new RegExp(`\\b${NUMBER}\\s+${DIRECTIONAL}(Broadway)\\b`, "i");
const CITY_STATE_ZIP = /^[\s,]*(?:(?:\d+(?:st|nd|rd|th)\s+Floor|Suite\s+\w+|Room\s+\w+|lower level)[\s,]*)*([A-Z][A-Za-z .'-]{1,40}?),\s*([A-Z]{2})(?:\s+(\d{5}))?\b/;
/** The words a header prints before the place; everything up to them is the body's and the document's name. */
const HEADER_NOISE = /\b(?:MEETING LOCATION|Meeting Agenda\s*-\s*Final|Agenda\s*-\s*Final|Meeting Agenda|Final|Revised|Amended)\b/g;

export interface StatedAgendaAddress {
  /** The place words the agenda prints before the address ("City Hall"), or null. */
  readonly place: string | null;
  /** The street address exactly as printed ("20 East Main Street"). */
  readonly street: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  /** The street reduced to what two spellings of one building agree on ("20 e main st"). */
  readonly key: string;
}

function normalizedStreet(number: string, directional: string | undefined, name: string, suffix: string | undefined): string {
  const digits = NUMBER_WORDS[number.toLowerCase()] ?? number;
  const direction = directional ? DIRECTIONALS[directional.toLowerCase()] ?? directional.toLowerCase() : "";
  const words = name.toLowerCase().replace(/[.']/g, "").split(/\s+/).filter(Boolean)
    .map((word) => NUMBER_WORDS[word] ?? word);
  const ending = suffix ? SUFFIXES[suffix.toLowerCase().replace(/\.$/, "")] ?? suffix.toLowerCase() : "";
  // "Broadway" is printed with and without "Blvd"; both are one street.
  if (words.length === 1 && words[0] === "broadway") return [digits, direction, "broadway"].filter(Boolean).join(" ");
  return [digits, direction, ...words, ending].filter(Boolean).join(" ");
}

/** The first street address in `text`, reduced to its building-level key. */
export function streetKeyOf(text: string): { readonly key: string; readonly index: number; readonly length: number } | null {
  const full = STREET.exec(text);
  const bare = SUFFIXLESS.exec(text);
  const hit = full && (!bare || full.index <= bare.index) ? { match: full, suffix: full[4] } : bare ? { match: bare, suffix: undefined } : null;
  if (!hit) return null;
  const [, number, directional, name] = hit.match;
  return {
    key: normalizedStreet(number!, directional, name!, hit.suffix),
    index: hit.match.index,
    length: hit.match[0].length,
  };
}

/**
 * The place the agenda states in its header, or null when it states no street
 * address there.
 */
export function statedAgendaAddress(agendaText: string): StatedAgendaAddress | null {
  const header = agendaText.replace(/\s+/g, " ").trim().slice(0, HEADER_CHARS);
  const street = streetKeyOf(header);
  if (!street) return null;
  const printed = header.slice(street.index, street.index + street.length).trim();
  const after = CITY_STATE_ZIP.exec(header.slice(street.index + street.length));
  let place: string | null = null;
  const before = header.slice(0, street.index);
  let cut = 0;
  for (const noise of before.matchAll(HEADER_NOISE)) cut = noise.index + noise[0].length;
  const words = before.slice(cut).replace(/^[\s,:-]+|[\s,:-]+$/g, "");
  if (words && words.length <= 80) place = words;
  return {
    place,
    street: printed,
    city: after?.[1]?.trim() ?? null,
    state: after?.[2] ?? null,
    zip: after?.[3] ?? null,
    key: street.key,
  };
}

/** The issuing board's street address in its own agenda letterhead, before the agenda begins. */
export function agendaLetterheadOffice(text:string,jurisdiction:string,state:string):string|null {
  let header=text.replace(/\s+/g," ").trim().slice(0,HEADER_CHARS);
  const title=/\b(?:Meeting\s+)?Agenda\b/i.exec(header);
  const street=streetKeyOf(header);
  if(!title||!street||street.index>=title.index)return null;
  header=header.slice(0,title.index);
  const name=jurisdiction.replace(/,\s*[A-Z]{2}$/i,"").trim();
  for(const label of [name,name.replace(/^(county|city|town|village|borough) of (.+)$/i,"$2 $1"),
    name.replace(/^(.+) (county|city|town|village|borough)$/i,"$2 of $1")]){
    if(!label)continue;
    const at=header.toLowerCase().indexOf(label.toLowerCase());
    if(at>=0)header=header.slice(0,at)+" ".repeat(label.length)+header.slice(at+label.length);
  }
  const address=statedAgendaAddress(header);
  if(!address?.city||address.state!==state)return null;
  return `${address.street}, ${address.city}, ${address.state}${address.zip?` ${address.zip}`:""}`;
}

