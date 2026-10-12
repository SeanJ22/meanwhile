import { normalizeName } from "../routing/exact-name.ts";
import { officeIdentity, type OfficeKey } from "../officials/office-identity.ts";
import { stateOcdIdFrom, type SeatHolder } from "../officials/lookup.ts";
import type { EvidenceGap } from "./evidence.ts";
import { proseName } from "./sitting-answer.ts";

export interface ReaderOfficialsAsk {
  readonly keys: readonly OfficeKey[];
  readonly phrase: string;
  readonly contact?: boolean;
  readonly place?: string;
}

interface OfficePhrase {
  readonly pattern: RegExp;
  readonly keys: readonly OfficeKey[];
}

const ELECTED_OFFICIALS: readonly OfficeKey[] = ["us_senator", "us_representative", "governor", "state_senator", "state_lower_house"];
const STATE_LEGISLATORS: readonly OfficeKey[] = ["state_senator", "state_lower_house"];

const OFFICE_PHRASES: readonly OfficePhrase[] = [
  { pattern: /^(?:u s |us |united states |federal )senators?$/, keys: ["us_senator"] },
  { pattern: /^state senators?$/, keys: ["state_senator"] },
  { pattern: /^senators?$/, keys: ["us_senator", "state_senator"] },
  { pattern: /^(?:congressmen|congressman|congresswoman|congressperson|congress ?member|member of congress|congressional representative|(?:u s |us |united states |federal )(?:house )?(?:representative|rep)|house representative|representative in congress|rep in congress|(?:u s |us )house member)$/, keys: ["us_representative"] },
  { pattern: /^state (?:representatives?|reps?|house members?|house representatives?|assembly ?(?:members?|men|man|women|woman))$|^assembly ?(?:members?|men|man|women|woman)$/, keys: ["state_lower_house"] },
  { pattern: /^(?:representatives?|reps?)$/, keys: ["us_representative", "state_lower_house"] },
  { pattern: /^(?:state )?(?:legislators?|lawmakers?)$/, keys: STATE_LEGISLATORS },
  { pattern: /^governor$/, keys: ["governor"] },
  { pattern: /^(?:city |town |county )?mayor$/, keys: ["mayor"] },
  { pattern: /^(?:county )?supervisors?$/, keys: ["county_supervisor"] },
  { pattern: /^county commissioners?$/, keys: ["county_commissioner"] },
  { pattern: /^(?:county )?sheriff$/, keys: ["county_sheriff"] },
  { pattern: /^county attorney$/, keys: ["county_attorney"] },
  { pattern: /^county assessor$/, keys: ["county_assessor"] },
  { pattern: /^county recorder$/, keys: ["county_recorder"] },
  { pattern: /^county treasurer$/, keys: ["county_treasurer"] },
  { pattern: /^county clerk$/, keys: ["county_clerk"] },
  { pattern: /^(?:city |town )?(?:council ?(?:members?|men|man|women|woman|ors?)|alder(?:men|man|woman|persons?))$/, keys: ["municipal_council"] },
  { pattern: /^school board (?:members?|trustees?|representatives?)$|^school board$/, keys: ["school_board"] },
  { pattern: /^attorney general$/, keys: ["attorney_general"] },
  { pattern: /^secretary of state$/, keys: ["secretary_of_state"] },
  { pattern: /^(?:state )?chief election officer$/, keys: ["chief_election_officer"] },
  { pattern: /^(?:state )?treasurer$/, keys: ["state_treasurer"] },
  { pattern: /^(?:state )?superintendent of public instruction$|^state superintendent$/, keys: ["superintendent_of_public_instruction"] },
  { pattern: /^corporation commissioners?$/, keys: ["corporation_commissioner"] },
  { pattern: /^(?:elected )?(?:officials?|leaders|representatives and senators|politicians|electeds|elected representatives)$/, keys: ELECTED_OFFICIALS },
];

const REPRESENTS_IN: readonly OfficePhrase[] = [
  { pattern: /^(?:congress|washington|washington d ?c|the federal government)$/, keys: ["us_senator", "us_representative"] },
  { pattern: /^(?:the )?(?:u s |us |united states )?house(?: of representatives)?$/, keys: ["us_representative"] },
  { pattern: /^(?:the )?(?:u s |us |united states )senate$/, keys: ["us_senator"] },
  { pattern: /^(?:the )?state (?:legislature|house)$|^the legislature$/, keys: STATE_LEGISLATORS },
  { pattern: /^(?:the )?state senate$/, keys: ["state_senator"] },
];

const CONTACT_FORMS: readonly RegExp[] = [
  new RegExp("^how (?:do|can|could|would|should) (?:i|we) (?:contact|reach|get in touch with|email|call|phone|write to|talk to|speak to|speak with) (?:my|our) (.+)$"),
  new RegExp("^what (?:is|s) (?:my|our) (.+?) s (?:phone number|email address|email|contact information|contact info|number)$"),
  new RegExp("^what (?:is|s) the (?:phone number|email address|email|contact information|contact info) (?:for|of) (?:my|our) (.+)$"),
];

const FORMS: readonly RegExp[] = [
  /^who (?:is|s|are) (?:my|our) (.+)$/,
  /^(?:list|show|name|tell me) (?:all )?(?:of )?(?:my|our) (.+)$/,
  /^who (?:are|is) the (.+) (?:for|of|in) (?:my|our) (?:area|district|zip|zip code|neighborhood|town|city|county)$/,
];

const STATE_NAMES: Readonly<Record<string, string>> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia",
  fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska",
  nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

const STATEWIDE_OFFICES: ReadonlySet<OfficeKey> = new Set(["governor", "attorney_general", "secretary_of_state", "state_treasurer", "superintendent_of_public_instruction", "corporation_commissioner", "us_senator"]);

function statewideOffice(normalized: string, readerStates: readonly string[]): ReaderOfficialsAsk | null {
  const officeOf = (phrase: string): readonly OfficeKey[] | null => {
    const words = phrase.replace(/^the /, "").trim();
    const found = /^senators?$/.test(words) ? { keys: ["us_senator"] as readonly OfficeKey[] } : OFFICE_PHRASES.find((entry) => entry.pattern.test(words));
    return found && found.keys.length > 0 && found.keys.every((key) => STATEWIDE_OFFICES.has(key)) ? found.keys : null;
  };
  for (const code of readerStates) {
    const name = STATE_NAMES[code];
    if (!name) continue;
    const tail = new RegExp(`^who (?:is|s|are) (?:the )?(.+?) (?:of|from|in|for) (?:the state of )?${name}$`).exec(normalized)?.[1];
    const lead = new RegExp(`^who (?:is|s|are) (?:the )?${name} s (.+)$`).exec(normalized)?.[1];
    const keys = officeOf(tail ?? lead ?? "");
    if (keys) return { keys, phrase: tail ?? lead! };
  }
  if (readerStates.length === 1) {
    const bare = /^who (?:is|s|are) (?:the )?(.+)$/.exec(normalized)?.[1];
    const keys = bare ? officeOf(bare) : null;
    if (keys) return { keys, phrase: bare! };
  }
  return null;
}

function namedPlaceOffice(normalized: string, readerPlaces: readonly string[]): ReaderOfficialsAsk | null {
  const officeOf = (phrase: string): readonly OfficeKey[] | null => {
    const found = OFFICE_PHRASES.find((entry) => entry.pattern.test(phrase.replace(/^the /, "").trim()));
    return found && found.keys.every((key) => key === "mayor" || key === "municipal_council") ? found.keys : null;
  };
  for (const place of readerPlaces) {
    const tail = new RegExp(`^who (?:is|s|are) (?:the )?(.+?) (?:of|for) (?:the )?(?:city of |town of )?${place}(?: az| arizona)?$`).exec(normalized)?.[1];
    const lead = new RegExp(`^who (?:is|s|are) (?:the )?${place} s (.+)$`).exec(normalized)?.[1];
    const phrase = tail ?? lead;
    const keys = phrase ? officeOf(phrase) : null;
    if (keys && phrase) return { keys, phrase, place: place.replace(/ /g, "_") };
  }
  return null;
}

/** `readerStates` are lowercase two-letter codes for the states the reader's divisions sit in. */
export function readerOfficialsQuestion(question: string, readerStates: readonly string[] = [], readerPlaces: readonly string[] = []): ReaderOfficialsAsk | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 90) return null;
  const statewide = statewideOffice(normalized, readerStates);
  if (statewide) return statewide;
  const named = namedPlaceOffice(normalized, readerPlaces);
  if (named) return named;
  const represents = /^who (?:represents|represent) me(?: in (.+))?$/.exec(normalized);
  if (represents) {
    if (!represents[1]) return { keys: ELECTED_OFFICIALS, phrase: "who represents me" };
    const found = REPRESENTS_IN.find((entry) => entry.pattern.test(represents[1]!));
    return found ? { keys: found.keys, phrase: represents[1]! } : null;
  }
  for (const [forms, contact] of [[FORMS, false], [CONTACT_FORMS, true]] as const) {
    for (const form of forms) {
      const phrase = form.exec(normalized)?.[1]?.trim();
      if (!phrase) continue;
      const found = OFFICE_PHRASES.find((entry) => entry.pattern.test(phrase));
      if (found) return { keys: found.keys, phrase, ...(contact ? { contact: true } : {}) };
    }
  }
  return null;
}

export function placeNamesOf(ocdIds: readonly string[]): string[] {
  return [...new Set(ocdIds.flatMap((id) => {
    const match = /[/]place:([a-z_]+)$/.exec(id);
    return match && !match[1]!.endsWith("_ccd") ? [match[1]!.replace(/_/g, " ")] : [];
  }))];
}

export function stateDivisionsOf(ocdIds: readonly string[]): string[] {
  return [...new Set(ocdIds.flatMap((id) => {
    const state = stateOcdIdFrom(id);
    return state ? [state] : [];
  }))];
}

export interface HeldOfficial {
  readonly seat: SeatHolder;
  readonly divisionIds: readonly string[];
  readonly bodyId: string | null;
  readonly bodyName: string | null;
}

function officeKeyOf(held: HeldOfficial): OfficeKey | null {
  const title = held.seat.officeTitle.replace(/\s*\([^)]*\)\s*$/, "");
  const key = officeIdentity(title);
  if (key) return key;
  if (held.bodyId && /\/school_district:[^/#]+#/.test(held.bodyId) && /^(?:governing |school )?board (?:member|president|vice president|clerk|chair|vice chair|secretary)$/i.test(title)) return "school_board";
  return null;
}

const LABELS: Readonly<Record<string, readonly [string, string]>> = {
  us_senator: ["United States Senator", "United States Senators"],
  us_representative: ["United States Representative", "United States Representatives"],
  governor: ["governor", "governors"],
  chief_election_officer: ["chief election officer", "chief election officers"],
  state_senator: ["state senator", "state senators"],
  state_lower_house: ["state representative", "state representatives"],
  county_supervisor: ["county supervisor", "county supervisors"],
  county_commissioner: ["county commissioner", "county commissioners"],
  county_sheriff: ["county sheriff", "county sheriffs"],
  county_attorney: ["county attorney", "county attorneys"],
  county_assessor: ["county assessor", "county assessors"],
  county_recorder: ["county recorder", "county recorders"],
  county_treasurer: ["county treasurer", "county treasurers"],
  county_clerk: ["county clerk", "county clerks"],
  mayor: ["mayor", "mayors"],
  municipal_council: ["city council member", "city council members"],
  school_board: ["school board member", "school board members"],
  attorney_general: ["Attorney General", "Attorneys General"],
  secretary_of_state: ["Secretary of State", "Secretaries of State"],
  state_treasurer: ["State Treasurer", "State Treasurers"],
  superintendent_of_public_instruction: ["Superintendent of Public Instruction", "Superintendents of Public Instruction"],
  corporation_commissioner: ["Corporation Commissioner", "Corporation Commissioners"],
};

const DISTRICT_PATTERN: Readonly<Record<string, RegExp>> = {
  us_representative: /\/cd:(\d+)$/,
  state_senator: /\/sldu:(\d+)$/,
  state_lower_house: /\/sldl:(\d+)$/,
};
const DISTRICT_NOUN: Readonly<Record<string, string>> = {
  us_representative: "congressional",
  state_senator: "state senate",
  state_lower_house: "state house",
};
const ADDRESS_DECIDED: Readonly<Record<string, string>> = {
  county_supervisor: "county supervisor district",
  county_commissioner: "county commissioner district",
  municipal_council: "city council ward",
};

const list = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

const person = (seat: SeatHolder, detail?: string | null, channels = false): string => {
  const reach = channels ? [seat.phone ? `phone ${seat.phone}` : null, seat.email ? `email ${seat.email}` : null] : [];
  const inner = [seat.partyLabel, detail, ...reach].filter(Boolean).join(", ");
  return inner ? `${seat.name} (${inner})` : seat.name;
};

const seatDetail = (seat: SeatHolder): string | null => {
  const match = /\b(district|ward|position|seat)\s*(\d+)\b/i.exec(seat.officeTitle);
  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} ${match[2]}` : null;
};

const districtOf = (held: HeldOfficial, key: string): string | null => {
  const pattern = DISTRICT_PATTERN[key];
  if (!pattern) return null;
  for (const id of held.divisionIds) {
    const match = pattern.exec(id);
    if (match) return match[1]!;
  }
  return null;
};

const inPlace = (held: HeldOfficial, place: string): boolean =>
  [...held.divisionIds, ...(held.bodyId ? [held.bodyId] : [])].some((id) => new RegExp(`[/]place:${place}(?:#|$)`).test(id));

export interface OfficialsComposition {
  answer: string;
  citedUrls: string[];
  gaps: EvidenceGap[];
  named: HeldOfficial[];
}

export function composeReaderOfficials(input: {
  ask: ReaderOfficialsAsk;
  held: readonly HeldOfficial[];
  holdingFailed: boolean;
  placesReached?: number;
}): OfficialsComposition | null {
  const contact = Boolean(input.ask.contact);
  const clauses: string[] = [];
  const sentences: string[] = [];
  const gaps: EvidenceGap[] = [];
  const named: HeldOfficial[] = [];
  const urls = new Set<string>();
  const gap = (statement: string) => { if (!gaps.some((held) => held.statement === statement)) gaps.push({ whose: "OURS", statement }); };
  for (const key of input.ask.keys) {
    const [singular, plural] = LABELS[key] ?? [key.replace(/_/g, " "), key.replace(/_/g, " ")];
    const seats = new Map<string, HeldOfficial>();
    for (const held of input.held) {
      if (officeKeyOf(held) !== key) continue;
      if (input.ask.place && !inPlace(held, input.ask.place)) continue;
      const prior = seats.get(held.seat.id);
      seats.set(held.seat.id, prior
        ? { ...prior, divisionIds: [...new Set([...prior.divisionIds, ...held.divisionIds])], bodyId: prior.bodyId ?? held.bodyId, bodyName: prior.bodyName ?? held.bodyName }
        : held);
    }
    const holders = [...seats.values()];
    if (holders.length === 0) {
      if (input.holdingFailed) {
        gap("We couldn't load our records of who holds this office. Please try again in a moment.");
        clauses.push(`we couldn't load the name of your ${singular}`);
      } else {
        const where = input.ask.place ? input.ask.place.split("_").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ") : null;
        gap(`We have not recorded who holds the office of ${singular} for ${where ?? "your area"} yet.`);
        clauses.push(where ? `we have not recorded who the ${singular} of ${where} is yet` : `we have not recorded who your ${singular} is yet`);
      }
      continue;
    }
    for (const held of holders) {
      named.push(held);
      if (held.seat.sourceUrl) urls.add(held.seat.sourceUrl);
      if (contact && !held.seat.phone && !held.seat.email) {
        const statement = `We have not recorded a published phone number or email for ${held.seat.name}.`;
        gap(statement);
        sentences.push(statement);
      }
    }
    const be = holders.length === 1 ? "is" : "are";
    const label = holders.length === 1 ? singular : plural;
    if (DISTRICT_PATTERN[key]) {
      const districts = new Map<string, HeldOfficial[]>();
      for (const held of holders) {
        const district = districtOf(held, key) ?? "";
        districts.set(district, [...(districts.get(district) ?? []), held]);
      }
      if (districts.size > 1 && !districts.has("")) {
        const parts = [...districts].sort(([a], [b]) => Number(a) - Number(b)).map(([district, group]) =>
          `${list(group.map((held) => person(held.seat, null, contact)))} for District ${district}`);
        clauses.push(`your ZIP code reaches ${districts.size} ${DISTRICT_NOUN[key]} districts: ${list(parts)}`);
      } else {
        const [only] = [...districts.keys()];
        clauses.push(`your ${label} ${be} ${list(holders.map((held) => person(held.seat, null, contact)))}${only ? ` for District ${only}` : ""}`);
      }
      continue;
    }
    const bodies = new Map<string, HeldOfficial[]>();
    for (const held of holders) bodies.set(held.bodyName ?? "", [...(bodies.get(held.bodyName ?? "") ?? []), held]);
    for (const [body, group] of bodies) {
      const items = group.map((held) => person(held.seat, seatDetail(held.seat), contact));
      if (!body) clauses.push(`your ${group.length === 1 ? singular : plural} ${group.length === 1 ? "is" : "are"} ${list(items)}`);
      else if (group.length === 1) clauses.push(`on ${proseName(body)}, the ${singular} is ${items[0]}`);
      else clauses.push(`${proseName(body)} has ${group.length} ${plural}: ${list(items)}`);
    }
    const decided = ADDRESS_DECIDED[key];
    if (decided && holders.length > 1) {
      const statement = `We have not recorded which ${decided} your address is in, so we cannot say which of them is yours.`;
      gap(statement);
      sentences.push(statement);
    }
    const countyOrDistrictMayors = key === "mayor" && holders.every(held => {
      const jurisdiction = held.seat.officeJurisdictionOcdId ?? "";
      return /\/county:[^/]+$/.test(jurisdiction) || jurisdiction === "ocd-division/country:us/district:dc";
    });
    if ((key === "mayor" || key === "municipal_council") && !countyOrDistrictMayors && !input.ask.place && (input.placesReached ?? 0) > 1) {
      const statement = `Your ZIP code reaches ${input.placesReached} places, so a ZIP code alone does not say which city's ${singular} is yours.`;
      gap(statement);
      sentences.push(statement);
    }
  }
  if (clauses.length === 0) return null;
  const lead = `${clauses[0]![0]!.toUpperCase()}${clauses[0]!.slice(1)}`;
  const answer = [`${[lead, ...clauses.slice(1)].join("; ")}.`, ...sentences].join(" ");
  return { answer, citedUrls: [...urls], gaps, named };
}

export function composeBodyRoster(input: {
  bodyName: string;
  contacts: readonly { name: string; officeTitle: string; basis: string; sourceUrl: string | null }[];
  gaps: readonly EvidenceGap[];
}): { answer: string; citedUrls: string[] } | null {
  const members = input.contacts.filter((contact) => contact.basis === "BODY_MEMBER");
  const staff = input.contacts.filter((contact) => contact.basis === "BODY_STAFF");
  const item = (contact: { name: string; officeTitle: string }) =>
    /\bmember\b/i.test(contact.officeTitle) && !/\d/.test(contact.officeTitle)
      ? contact.name
      : `${contact.name} (${contact.officeTitle.replace(/\s*\(([^)]*)\)/g, ", $1")})`;
  const sentences: string[] = [];
  if (members.length === 0 && staff.length === 0) {
    sentences.push(`We have not recorded who sits on ${proseName(input.bodyName)} yet.`);
  } else {
    if (members.length > 0) sentences.push(`${proseName(input.bodyName)} has ${members.length} ${members.length === 1 ? "member" : "members"}: ${list(members.map(item))}.`);
    if (staff.length > 0) sentences.push(`Its roster also lists ${list(staff.map(item))}.`);
  }
  for (const gap of input.gaps) sentences.push(gap.statement);
  return { answer: sentences.join(" "), citedUrls: [...new Set(input.contacts.flatMap((contact) => contact.sourceUrl ? [contact.sourceUrl] : []))] };
}
