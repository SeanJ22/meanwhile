import jurisdictionLabels from "../../data/reference/us-jurisdiction-labels.json" with { type: "json" };

export type OfficeKey = string;

interface OfficeRule {
  key: OfficeKey;
  pattern: RegExp;
  blurbType?: string;
  stateBlurbTypes?: Readonly<Record<string, string>>;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5,
  six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
  eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14,
  fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18,
  nineteen: 19, nineteenth: 19, twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40,
  fifty: 50, fiftieth: 50, sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70, eighty: 80, eightieth: 80,
  ninety: 90, ninetieth: 90, hundred: 100, hundredth: 100, thousand: 1000, thousandth: 1000,
};
const WORD_NUMBER_PATTERN = `(?:${Object.keys(NUMBER_WORDS).join("|")})(?:[\\s-]+(?:and|${Object.keys(NUMBER_WORDS).join("|")}))*`;
export const OFFICE_NUMBER_PATTERN = `(?:\\d+(?:st|nd|rd|th)?|${WORD_NUMBER_PATTERN})`;

/** The publisher's district number, whether it uses digits or English words. */
export function officeNumber(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (/^\d+(?:st|nd|rd|th)?$/.test(raw)) {
    const number = Number(raw.replace(/(?:st|nd|rd|th)$/, ""));
    return Number.isSafeInteger(number) ? String(number) : null;
  }
  const words = raw.split(/[\s-]+/);
  let total = 0, current = 0, last = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index], number = NUMBER_WORDS[word];
    if (word === "and") {
      if (index === 0 || index === words.length - 1 || !["hundred", "thousand"].includes(words[index - 1])) return null;
      continue;
    }
    if (!number || /(?:first|second|third|(?:th))$/.test(word) && index !== words.length - 1) return null;
    if (number === 100) {
      if (current < 1 || current > 9 || last >= 10) return null;
      current *= 100;
    } else if (number === 1000) {
      if (!current || total) return null;
      total = current * 1000; current = 0;
    } else {
      if (last > 0 && last < 20 || last >= 20 && last < 100 && (last % 10 !== 0 || number >= 10)) return null;
      current += number;
    }
    last = number;
  }
  return total + current > 0 ? String(total + current) : null;
}

const DISTRICT_KIND = "(?:congressional|legislative|representative|senatorial|delegate)";
const NUMBERED_DISTRICT = new RegExp(`\\b(${OFFICE_NUMBER_PATTERN})\\s+(?:${DISTRICT_KIND}\\s+)?(?:district|dist\\.?)(?=\\s|$|[,;)])`, "gi");
const SUFFIX_DISTRICT = new RegExp(`\\b(?:congressional|legislative|senatorial)\\s+district\\s+(${OFFICE_NUMBER_PATTERN})\\b`, "gi");
const NAMED_DISTRICT = new RegExp(`\\b(?:district|dist\\.?)\\s+(${WORD_NUMBER_PATTERN})\\b`, "gi");

function stripDistrictLabels(title: string): string {
  return title.replace(NUMBERED_DISTRICT, (match, number: string, offset: number, whole: string) => {
    if (officeNumber(number) === null) return match;
    return /\brepresentative\s+district\b/i.test(match) &&
      !/\brepresentative\b/i.test(whole.slice(0, offset) + whole.slice(offset + match.length)) ? " Representative " : " ";
  })
    .replace(SUFFIX_DISTRICT, (match, number: string) => officeNumber(number) === null ? match : " ")
    .replace(NAMED_DISTRICT, (match, number: string) => officeNumber(number) === null ? match : " ")
    .replace(/\b(?:representative|delegate)\s+district\s+\d+\b/gi, (match, offset: number, whole: string) =>
      /(?:assembly|delegates)\b/i.test(whole.slice(0, offset)) ? " " : match);
}

export function stripSeatFurniture(title: string): string {
  return stripDistrictLabels(String(title ?? ""))
    .replace(/—|–/g, "-")
    .replace(/\s*\(\s*\d+\s*(?:st|nd|rd|th)?\s*(?:congressional\s+)?district[^)]*\)/gi, " ")
    .replace(/\s*\([^)]*(?:seats?|unexpired|full term)[^)]*\)/gi, " ")
    .replace(/[,\-\s]*\b(?:district|dist\.?|ward|position|seat|division|group)\b[\s.:#-]*(?:no\.?\s*)?[0-9ivxlc]+[a-z]?\b/gi, " ")
    .replace(/[,\-\s]*\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:congressional\s+)?district\b/gi, " ")
    .replace(/\b(?:unexpired|full)\s+term\b/gi, " ")
    .replace(/\b(?:statewide|vacancy)\s*$/i, " ")
    .replace(/\bat[-\s]large\b/gi, " ")
    .replace(/\(\s*[, -]*\)/g, " ")
    .replace(/\s*(?:,\s*|\(\s*)(?:(?:vice|deputy)\s+)?(?:chair(?:man)?|president|clerk|secretary)\s*\)?$/i, "")
    .replace(/^[\s,\-]+/g, "")
    .replace(/[\s,\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RULES: OfficeRule[] = [
  { key: "us_senator", blurbType: "us-senator", pattern: /^(?:member of (?:the )?)?(?:u\.?s\.?|united states) senat(?:or|e)$|^senator in congress$/i },
  { key: "us_representative", blurbType: "us-representative", pattern: /^(?:member of (?:the )?)?(?:u\.?s\.?|united states) (?:representative|house(?: of representatives)?|congress)$|^(?:(?:representative|rep\.?) (?:in|to) congress(?: \d+(?:st|nd|rd|th)?)?|member of (?:the )?congress|member of the house of representatives|congress(?:ional representative|man|woman|person))$/i },
  { key: "governor_and_lieutenant_governor", pattern: /^governor (?:and|&|\/) (?:lieutenant|lt\.?) governor$/i },
  { key: "lieutenant_governor", pattern: /^(?:lieutenant|lt\.?) governor$/i },
  { key: "governor", blurbType: "governor", pattern: /^(?:state )?governor$/i },
  { key: "secretary_of_state", blurbType: "secretary-of-state", pattern: /^(?:state )?secretary of (?:the )?state$/i },
  { key: "attorney_general", blurbType: "attorney-general", pattern: /^(?:state )?attorney general$/i },
  { key: "state_treasurer", blurbType: "state-treasurer", pattern: /^(?:state )?treasurer$/i },
  { key: "superintendent_of_public_instruction", blurbType: "superintendent-public-instruction", pattern: /^(?:state )?superintendent of public instruction$/i },
  { key: "state_mine_inspector", blurbType: "mine-inspector", pattern: /^(?:arizona )?(?:state )?mine inspector$/i },
  { key: "corporation_commissioner", blurbType: "corporation-commissioner", pattern: /^(?:state )?corporation commissioner$/i },
  { key: "state_auditor", pattern: /^(?:(?:state )?auditor|auditor of (?:the )?state)$/i },
  { key: "state_comptroller", pattern: /^(?:state )?(?:comptroller|controller)$/i },
  { key: "insurance_commissioner", pattern: /^(?:state )?(?:insurance commissioner|commissioner of insurance)$/i },
  { key: "chief_election_officer", pattern: /^chief election officer$/i },
  { key: "agriculture_commissioner", pattern: /^(?:state )?(?:agriculture commissioner|commissioner of agriculture)$/i },
  { key: "public_lands_commissioner", pattern: /^(?:state )?(?:public lands commissioner|commissioner of (?:public )?lands?|land commissioner)$/i },
  { key: "labor_commissioner", pattern: /^(?:state )?(?:labor commissioner|commissioner of labor)$/i },
  { key: "public_service_commissioner", pattern: /^(?:state )?(?:public service commissioner|public service commission|public utilities commissioner|public utilities commission|railroad commissioner|railroad commission)$/i },
  { key: "state_senator", blurbType: "state-senator", pattern: /^(?:(?:member of (?:the )?)?(?:state )?senat(?:or|e)|senator in (?:the )?general assembly(?: sen\.? \d+)?|state senate member|sen\.?)$/i },
  { key: "state_lower_house", blurbType: "state-representative", pattern: /^(?:state representative|representative|rep\.?|state house representative|member of (?:the )?state house of representatives|(?:\d+(?:st|nd|rd|th)? )?representative (?:in )?(?:the )?general (?:court|assembly)(?: rep\.? \d+)?|representative (?:in (?:the )?state legislature|to (?:the )?assembly)|representative (?:the )?general assembly for representative in|state house(?: of representatives)?|house of representatives|state assembly ?(?:member|man|woman)?|assembly ?(?:member|man|woman)|member of the (?:general )?assembly|member of (?:the )?(?:state )?house of delegates|house of delegates|delegate|house member|state representative, [a-z ]+ county)$/i },
  { key: "executive_councilor", blurbType: "executive-councilor", pattern: /^executive council(?:or|lor)$/i },
  { key: "county_commissioner", blurbType: "county-commissioner", pattern: /^(?:member of the )?(?:board of )?county commissioners?$|^[a-z ]+ county commissioner$/i },
  { key: "county_supervisor", blurbType: "county-commissioner", pattern: /^(?:member of the )?(?:board of )?(?:county )?supervisors?$/i },
  { key: "county_sheriff", blurbType: "county-sheriff", pattern: /^(?:[a-z ]+ county )?sheriff$|^county sheriff$/i },
  { key: "county_attorney", blurbType: "county-attorney", pattern: /^(?:(?:[a-z ]+ )?county )?attorney$|^(?:county )?prosecuting attorney$/i },
  { key: "county_treasurer", blurbType: "county-treasurer", pattern: /^(?:[a-z ]+ )?county treasurer$/i },
  { key: "register_of_deeds", blurbType: "register-of-deeds", pattern: /^(?:[a-z ]+ county )?register of deeds$/i },
  { key: "register_of_probate", blurbType: "register-of-probate", pattern: /^(?:[a-z ]+ county )?register of probate$/i },
  { key: "county_surrogate", blurbType: "county-surrogate", pattern: /^(?:(?:[a-z ]+ )?county )?surrogate$/i },
  { key: "county_clerk", blurbType: "county-clerk", pattern: /^(?:[a-z ]+ county )?(?:county )?clerk$/i },
  { key: "county_assessor", pattern: /^(?:[a-z ]+ county )?assessor$|^county assessor$/i },
  { key: "county_recorder", pattern: /^(?:[a-z ]+ county )?recorder$|^county recorder$/i },
  { key: "county_coroner", pattern: /^(?:[a-z ]+ county )?coroner$|^county coroner$/i },
  { key: "county_engineer", pattern: /^(?:[a-z ]+ )?county engineer$/i },
  { key: "county_tax_collector", pattern: /^(?:county )?tax collector$/i },
  { key: "mayor", blurbType: "mayor", pattern: /^(?:city |town |village )?mayor$/i },
  { key: "municipal_council", blurbType: "select-board", pattern: /^(?:member of the )?(?:board of selectmen|select ?(?:board(?: (?:member|chair|vice chair))?|man|woman|person))$/i },
  { key: "municipal_council", blurbType: "city-council", stateBlurbTypes: { nj: "nj-municipal-governing-body" }, pattern: /^(?:member of the )?(?:borough|town|township) council$|^(?:member of the )?(?:township|town) committee$/i },
  { key: "municipal_council", blurbType: "city-council", pattern: /^(?:member of the )?(?:city|village|common) council$|^(?:city |town |village )?council ?(?:member|man|woman|president|vice president)$|^alder(?:man|woman|person)$|^(?:member of the )?board of (?:aldermen|trustees)$/i },
  { key: "school_board", blurbType: "school-board", pattern: /^(?:member of the )?(?:regional )?board of education$|^(?:member of the )?school (?:board(?: (?:member|chair|vice chair))?|committee)$|^(?:member of the )?governing board(?: (?:member|president|vice president|clerk))?$|^school (?:district )?(?:trustee|director)$/i },
  { key: "library_trustee", pattern: /^library (?:board )?(?:trustee|board member)$/i },
  { key: "school_superintendent", blurbType: "superintendent", pattern: /^(?:school |district |school district )?superintendent$/i },
  { key: "state_supreme_court", pattern: /^(?:(?:chief |associate )?justice(?: of (?:the )?)?(?:state )?supreme court|(?:state )?supreme court(?: (?:chief |associate )?(?:justice|judge))?|justice supreme court of maryland(?: - appellate circuit \d+)?)$/i },
  { key: "state_appeals_court", pattern: /^(?:judge(?: of (?:the )?)?(?:state )?court of appeals|(?:state )?court of appeals(?: judge)?|(?:state )?appeals court(?: judge)?)$/i },
  { key: "circuit_court_judge", pattern: /^(?:circuit court judge|judge of (?:the )?circuit court)$/i },
  { key: "district_court_judge", pattern: /^(?:district court judge|judge of (?:the )?district court)$/i },
  { key: "superior_court_judge", pattern: /^(?:superior court judge|judge of (?:the )?superior court)$/i },
  { key: "probate_court_judge", pattern: /^(?:probate (?:court )?judge|judge of (?:the )?probate court)$/i },
  { key: "justice_of_the_peace", pattern: /^justice of the peace$/i },
];

const MEASURE_TITLE = /^(?:proposition|question|measure|referendum|public question|amendment|bond)\b/i;

const jurisdictionCodes = new Map(jurisdictionLabels.jurisdictions.flatMap(row =>
  [[row.name.toLowerCase(), row.postal], [row.postal.toLowerCase(), row.postal]]));
const jurisdictionPrefix = new RegExp(`^(?:(?:state|commonwealth) of )?(${[...jurisdictionCodes.keys()]
  .sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+(.+)$`, "i");
const ONLY_CONGRESSIONAL_DISTRICT = new RegExp(`^(?:${OFFICE_NUMBER_PATTERN})\\s+congressional district$`, "i");

function normalizedOfficeTitle(title: string): string {
  return title.replace(/\bU\s*\.?\s*S\.?(?=\s|$)/gi, "U.S.")
    .replace(/^\s*member\s*,\s*/i, "Member of ")
    .replace(/^\s*for\s+(?:the\s+)?/i, "")
    .replace(/\b(?:pos|position|seat)\b\.?\s*(?:no\.?\s*)?[:#]?\s*(?:\d+|[A-Z])\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function officeRule(title: string | null | undefined, divisionOcdId?: string | null): OfficeRule | null {
  const original = normalizedOfficeTitle(title ?? "");
  if (!original || MEASURE_TITLE.test(original)) return null;
  const byKey = (key: string) => RULES.find(rule => rule.key === key) ?? null;
  const context = /\/(cd|sldl|sldu):[^/]+$/.exec(divisionOcdId ?? "")?.[1];
  if (ONLY_CONGRESSIONAL_DISTRICT.test(original)) return byKey("us_representative");
  let stripped = stripSeatFurniture(original).replace(/^for\s+(?:the\s+)?/i, "");
  const jurisdiction = jurisdictionPrefix.exec(stripped);
  if (jurisdiction && /^(?:state\s+)?(?:house|representative|rep\.?|senate|senator|sen\.?|assembly)\b/i.test(jurisdiction[2])) {
    const state = /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(divisionOcdId ?? "")?.[1];
    if (state && jurisdictionCodes.get(jurisdiction[1].toLowerCase()) !== state.toUpperCase()) return null;
    stripped = `State ${jurisdiction[2].replace(/^state\s+/i, "")}`;
  }
  if (/^(?:member of (?:the )?)?(?:house|house of representatives)$/i.test(stripped)) {
    if (context === "cd") return byKey("us_representative");
    if (context === "sldl") return byKey("state_lower_house");
    if (/^(?:house|member of house of representatives)$/i.test(stripped)) return null;
  }
  if (/^member of (?:the )?legislature$/i.test(stripped)) return context === "sldu" ? byKey("state_senator")
    : context === "sldl" ? byKey("state_lower_house") : null;
  if (/\/place:[^/]+$/.test(divisionOcdId ?? "") &&
      /^(?:[a-z][a-z .'-]*\s+-\s+)?(?:city |town |village )?mayor(?:\s+-\s+[a-z][a-z .'-]*)?$/i.test(stripped)) return byKey("mayor");
  return !stripped ? null : RULES.find(rule => rule.pattern.test(stripped)) ?? null;
}

export function officeIdentity(title: string | null | undefined, divisionOcdId?: string | null): OfficeKey | null {
  return officeRule(title, divisionOcdId)?.key ?? null;
}

export function officeBlurbType(title: string | null | undefined, divisionOcdId?: string | null): string | null {
  const rule = officeRule(title, divisionOcdId);
  const state = /\/state:([a-z]{2})\b/.exec(divisionOcdId ?? "")?.[1];
  return state && rule?.stateBlurbTypes?.[state] || rule?.blurbType || rule?.key.replace(/_/g, "-") || null;
}

export function sameOffice(a: string | null | undefined, b: string | null | undefined, divisionOcdId?: string | null): boolean {
  const left = officeIdentity(a, divisionOcdId);
  return left !== null && left === officeIdentity(b, divisionOcdId);
}

export function unclassifiedOfficeTitles(titles: readonly (string | null | undefined)[]): string[] {
  return [...new Set(titles.map(title => stripSeatFurniture(title ?? ""))
    .filter(title => title && !MEASURE_TITLE.test(title) && officeIdentity(title) === null))].sort();
}
