import { normalizeName } from "../routing/exact-name.ts";
import { officeIdentity, type OfficeKey } from "../officials/office-identity.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type { EvidenceGap } from "./evidence.ts";
import { proseName } from "./sitting-answer.ts";

/**
 * **"WHO IS MY STATE SENATOR?" IS A LOOKUP IN WHAT WE HOLD, NOT A QUESTION FOR A
 * MODEL.** (2026-09-29, S3.)
 *
 * Measured on staging 2026-09-29: *"Who is my state senator?"*, *"Who is my
 * congressman?"* and *"Who is my county supervisor?"* at 85635 and 85641 spent
 * about a second on a model reading, found no subject, and answered nothing —
 * while the registry held every one of those people for the reader's own
 * divisions. §0's first line is "who governs them"; this answers it.
 *
 * The question is read here from its words, against a CLOSED table of offices
 * (the same `officeIdentity` vocabulary the ballot uses to join a contest to its
 * seat). Anything the table does not recognise returns null and the model reads
 * the question exactly as before. The answer is composed from the officeholders
 * the route already loaded for the reader's divisions and bodies, and faces the
 * same validator a model answer does.
 *
 * Three honesty rules:
 *
 * - A ZIP code can reach more than one district. Every district's holders are
 *   named with their district, never one of them as "yours".
 * - A body's seats (county supervisors, a council, a school board) are named with
 *   the body, and where the reader's own seat within it depends on an address we
 *   do not hold, the answer says so as a gap of ours.
 * - An office we hold no one for is said plainly as a gap of ours — a blank never
 *   reads as "nobody holds it".
 */

export interface ReaderOfficialsAsk {
  /** The offices asked about, in the order they are answered. */
  readonly keys: readonly OfficeKey[];
  /** The reader's own words for the office, for the trace only. */
  readonly phrase: string;
  /** "How do I contact my state senator?": each person is named with the phone and email their office publishes. */
  readonly contact?: boolean;
}

interface OfficePhrase {
  readonly pattern: RegExp;
  readonly keys: readonly OfficeKey[];
}

/** Federal and state legislators and the governor: what "my elected officials" means when nothing narrower is said. */
const ELECTED_OFFICIALS: readonly OfficeKey[] = ["us_senator", "us_representative", "governor", "state_senator", "state_lower_house"];
const STATE_LEGISLATORS: readonly OfficeKey[] = ["state_senator", "state_lower_house"];

/** Anchored over `normalizeName` of the office words alone. Closed: an unlisted office is the model's. */
const OFFICE_PHRASES: readonly OfficePhrase[] = [
  { pattern: /^(?:u s |us |united states |federal )senators?$/, keys: ["us_senator"] },
  { pattern: /^state senators?$/, keys: ["state_senator"] },
  { pattern: /^senators?$/, keys: ["us_senator", "state_senator"] },
  { pattern: /^(?:congressmen|congressman|congresswoman|congressperson|congress ?member|member of congress|congressional representative|(?:u s |us |united states |federal )(?:house )?(?:representative|rep)|house representative|representative in congress|rep in congress|(?:u s |us )house member)$/, keys: ["us_representative"] },
  { pattern: /^state (?:representatives?|reps?|house members?|house representatives?|assembly ?(?:members?|men|man|women|woman))$|^assembly ?(?:members?|men|man|women|woman)$/, keys: ["state_lower_house"] },
  { pattern: /^(?:representatives?|reps?)$/, keys: ["us_representative", "state_lower_house"] },
  { pattern: /^(?:state )?(?:legislators?|lawmakers?)$/, keys: STATE_LEGISLATORS },
  { pattern: /^governor$/, keys: ["governor"] },
  { pattern: /^(?:city |town )?mayor$/, keys: ["mayor"] },
  { pattern: /^(?:county )?supervisors?$/, keys: ["county_supervisor"] },
  { pattern: /^county commissioners?$/, keys: ["county_commissioner"] },
  { pattern: /^(?:city |town )?(?:council ?(?:members?|men|man|women|woman|ors?)|alder(?:men|man|woman|persons?))$/, keys: ["municipal_council"] },
  { pattern: /^school board (?:members?|trustees?|representatives?)$|^school board$/, keys: ["school_board"] },
  { pattern: /^attorney general$/, keys: ["attorney_general"] },
  { pattern: /^secretary of state$/, keys: ["secretary_of_state"] },
  { pattern: /^(?:state )?treasurer$/, keys: ["state_treasurer"] },
  { pattern: /^(?:state )?superintendent of public instruction$|^state superintendent$/, keys: ["superintendent_of_public_instruction"] },
  { pattern: /^corporation commissioners?$/, keys: ["corporation_commissioner"] },
  { pattern: /^(?:elected )?(?:officials?|leaders|representatives and senators|politicians|electeds|elected representatives)$/, keys: ELECTED_OFFICIALS },
];

/** "who represents me in <chamber>": the chamber words, closed. */
const REPRESENTS_IN: readonly OfficePhrase[] = [
  { pattern: /^(?:congress|washington|washington d ?c|the federal government)$/, keys: ["us_senator", "us_representative"] },
  { pattern: /^(?:the )?(?:u s |us |united states )?house(?: of representatives)?$/, keys: ["us_representative"] },
  { pattern: /^(?:the )?(?:u s |us |united states )senate$/, keys: ["us_senator"] },
  { pattern: /^(?:the )?state (?:legislature|house)$|^the legislature$/, keys: STATE_LEGISLATORS },
  { pattern: /^(?:the )?state senate$/, keys: ["state_senator"] },
];

/** "How do I contact my ...", "What is my ...'s phone number": the same offices, asked for the way to reach them. */
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

/**
 * The offices a question about the reader's OWN officials asks for, or null.
 * The whole question must be one of the closed forms: a qualifier ("...and how
 * did she vote"), a second subject or an unlisted office is left to the model.
 */
export function readerOfficialsQuestion(question: string): ReaderOfficialsAsk | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 90) return null;
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

/** The state division each of these divisions sits in: the U.S. Senators and statewide executives are held there, and a ZIP's own divisions never name it. */
export function stateDivisionsOf(ocdIds: readonly string[]): string[] {
  return [...new Set(ocdIds.flatMap((id) => {
    const match = /^(ocd-division\/country:us\/state:[a-z]{2})(?:\/|$)/.exec(id);
    return match ? [match[1]!] : [];
  }))];
}

/** A held officeholder, with where the reader's area holds them. */
export interface HeldOfficial {
  readonly seat: SeatHolder;
  /** The division ids the seat was found under (a district, a county, the state). */
  readonly divisionIds: readonly string[];
  /** The governing body the seat sits on, when it came from a body's roster. */
  readonly bodyId: string | null;
  readonly bodyName: string | null;
}

/**
 * The office a held seat is, in the ballot's own vocabulary. A trailing
 * parenthetical ("District 2 (Vice Chair)") is the seat's role in its body, not a
 * different office; a school board's seats are titled by the board ("Governing
 * Board Member") and are known by the body they sit on.
 */
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
  state_senator: ["state senator", "state senators"],
  state_lower_house: ["state representative", "state representatives"],
  county_supervisor: ["county supervisor", "county supervisors"],
  county_commissioner: ["county commissioner", "county commissioners"],
  mayor: ["mayor", "mayors"],
  municipal_council: ["city council member", "city council members"],
  school_board: ["school board member", "school board members"],
  attorney_general: ["Attorney General", "Attorneys General"],
  secretary_of_state: ["Secretary of State", "Secretaries of State"],
  state_treasurer: ["State Treasurer", "State Treasurers"],
  superintendent_of_public_instruction: ["Superintendent of Public Instruction", "Superintendents of Public Instruction"],
  corporation_commissioner: ["Corporation Commissioner", "Corporation Commissioners"],
};

/** The chamber's district word, for the kinds a district decides. */
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
/** Body seats whose place in the body depends on the reader's address, which we do not hold. */
const ADDRESS_DECIDED: Readonly<Record<string, string>> = {
  county_supervisor: "county supervisor district",
  county_commissioner: "county commissioner district",
  municipal_council: "city council ward",
};

const list = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

const person = (seat: SeatHolder, detail?: string | null, channels = false): string => {
  /* What the office itself publishes, as the roster holds it: never a guess, never a page. */
  const reach = channels ? [seat.phone ? `phone ${seat.phone}` : null, seat.email ? `email ${seat.email}` : null] : [];
  const inner = [seat.partyLabel, detail, ...reach].filter(Boolean).join(", ");
  return inner ? `${seat.name} (${inner})` : seat.name;
};

/** "District 1" or "Ward 3", when the seat's own title carries it. */
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

export interface OfficialsComposition {
  answer: string;
  citedUrls: string[];
  /** Gaps of ours the answer states, to sit beside its records in the pack. */
  gaps: EvidenceGap[];
  /** Every held official the answer names, in the order named — the records the reader is shown. */
  named: HeldOfficial[];
}

/**
 * Compose the answer from the held officials: one clause per office asked, joined
 * so the whole stays one sentence (the length contract counts "U.S." as a
 * sentence end, so the federal offices are spelled out), then one sentence for
 * each thing about the reader's own seat that we do not hold. Null when no
 * office was asked.
 */
export function composeReaderOfficials(input: {
  ask: ReaderOfficialsAsk;
  held: readonly HeldOfficial[];
  /** Officeholder records could not be read for this answer: an absence is then a failure of ours, said so. */
  holdingFailed: boolean;
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
      const prior = seats.get(held.seat.id);
      seats.set(held.seat.id, prior
        ? { ...prior, divisionIds: [...new Set([...prior.divisionIds, ...held.divisionIds])], bodyId: prior.bodyId ?? held.bodyId, bodyName: prior.bodyName ?? held.bodyName }
        : held);
    }
    const holders = [...seats.values()];
    if (holders.length === 0) {
      if (input.holdingFailed) {
        gap("Our officeholder records could not be read for this answer. This is a failure of our holding, not a finding that no one holds the office.");
        clauses.push(`we could not read our officeholder records for your ${singular}`);
      } else {
        gap(`We have not recorded who holds the office of ${singular} for your area yet.`);
        clauses.push(`we have not recorded who your ${singular} is yet`);
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
        /* The ZIP reaches more than one district: every district's holders, each with its district. */
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
  }
  if (clauses.length === 0) return null;
  const lead = `${clauses[0]![0]!.toUpperCase()}${clauses[0]!.slice(1)}`;
  const answer = [`${[lead, ...clauses.slice(1)].join("; ")}.`, ...sentences].join(" ");
  return { answer, citedUrls: [...urls], gaps, named };
}

/**
 * **WHO SITS ON A NAMED BODY, FROM ITS ROSTER.** (2026-09-29, S3.) *"Who is on the
 * Vail school board?"* cost a model call (about 2.8 s on the fast writer) to
 * restate a sourced roster. The members and staff are the contacts the route
 * already read off that body's roster; the sentence names them, keeps a
 * chair/president/clerk title beside the name, and states each roster gap of ours
 * in its own words. Alphabetical, as the contacts are: any other order would rank.
 * A roster too large for the length contract fails the validator and the model
 * writes, as before.
 */
export function composeBodyRoster(input: {
  bodyName: string;
  contacts: readonly { name: string; officeTitle: string; basis: string; sourceUrl: string | null }[];
  gaps: readonly EvidenceGap[];
}): { answer: string; citedUrls: string[] } | null {
  const members = input.contacts.filter((contact) => contact.basis === "BODY_MEMBER");
  const staff = input.contacts.filter((contact) => contact.basis === "BODY_STAFF");
  /* A plain "Member" title says nothing the count does not; a role or a ward does. */
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
