export type OfficeKey = string;

interface OfficeRule {
  key: OfficeKey;
  pattern: RegExp;
  blurbType?: string;
  stateBlurbTypes?: Readonly<Record<string, string>>;
}

export function stripSeatFurniture(title: string): string {
  return String(title ?? "")
    .replace(/—|–/g, "-")
    .replace(/\s*\(\s*\d+\s*(?:st|nd|rd|th)?\s*(?:congressional\s+)?district[^)]*\)/gi, " ")
    .replace(/\s*\([^)]*(?:seats?|unexpired|full term)[^)]*\)/gi, " ")
    .replace(/[,\-\s]*\b(?:district|dist\.?|ward|position|seat|division|group)\b[\s.:#-]*(?:no\.?\s*)?[0-9ivxlc]+[a-z]?\b/gi, " ")
    .replace(/[,\-\s]*\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:congressional\s+)?district\b/gi, " ")
    .replace(/\b(?:unexpired|full)\s+term\b/gi, " ")
    .replace(/\bat[-\s]large\b/gi, " ")
    .replace(/\s*(?:,\s*|\(\s*)(?:(?:vice|deputy)\s+)?(?:chair(?:man)?|president|clerk|secretary)\s*\)?$/i, "")
    .replace(/^[\s,\-]+/g, "")
    .replace(/[\s,\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RULES: OfficeRule[] = [
  { key: "us_senator", blurbType: "us-senator", pattern: /^(?:member of (?:the )?)?(?:u\.?s\.?|united states) senat(?:or|e)$|^senator in congress$/i },
  { key: "us_representative", blurbType: "us-representative", pattern: /^(?:member of (?:the )?)?(?:u\.?s\.?|united states) (?:representative|house(?: of representatives)?)$|^(?:representative (?:in|to) congress|member of (?:the )?congress|member of the house of representatives|congress(?:ional representative|man|woman|person))$/i },
  { key: "governor_and_lieutenant_governor", pattern: /^governor (?:and|&) (?:lieutenant|lt\.?) governor$/i },
  { key: "lieutenant_governor", pattern: /^(?:lieutenant|lt\.?) governor$/i },
  { key: "governor", blurbType: "governor", pattern: /^(?:state )?governor$/i },
  { key: "secretary_of_state", blurbType: "secretary-of-state", pattern: /^(?:state )?secretary of state$/i },
  { key: "attorney_general", blurbType: "attorney-general", pattern: /^(?:state )?attorney general$/i },
  { key: "state_treasurer", blurbType: "state-treasurer", pattern: /^(?:state )?treasurer$/i },
  { key: "superintendent_of_public_instruction", blurbType: "superintendent-public-instruction", pattern: /^(?:state )?superintendent of public instruction$/i },
  { key: "state_mine_inspector", blurbType: "mine-inspector", pattern: /^(?:arizona )?(?:state )?mine inspector$/i },
  { key: "corporation_commissioner", blurbType: "corporation-commissioner", pattern: /^(?:state )?corporation commissioner$/i },
  { key: "state_auditor", pattern: /^(?:state )?auditor$/i },
  { key: "state_comptroller", pattern: /^(?:state )?(?:comptroller|controller)$/i },
  { key: "insurance_commissioner", pattern: /^(?:state )?(?:insurance commissioner|commissioner of insurance)$/i },
  { key: "chief_election_officer", pattern: /^chief election officer$/i },
  { key: "agriculture_commissioner", pattern: /^(?:state )?(?:agriculture commissioner|commissioner of agriculture)$/i },
  { key: "public_lands_commissioner", pattern: /^(?:state )?(?:public lands commissioner|commissioner of (?:public )?lands?|land commissioner)$/i },
  { key: "labor_commissioner", pattern: /^(?:state )?(?:labor commissioner|commissioner of labor)$/i },
  { key: "public_service_commissioner", pattern: /^(?:state )?(?:public service commissioner|public service commission|public utilities commissioner|public utilities commission|railroad commissioner|railroad commission)$/i },
  { key: "state_senator", blurbType: "state-senator", pattern: /^(?:(?:member of (?:the )?)?(?:state )?senat(?:or|e)|state senate member|sen\.?)$/i },
  { key: "state_lower_house", blurbType: "state-representative", pattern: /^(?:state representative|representative|rep\.?|state house representative|member of (?:the )?state house of representatives|representative in (?:the )?general (?:court|assembly)|state house(?: of representatives)?|house of representatives|state assembly ?(?:member|man|woman)?|assembly ?(?:member|man|woman)|member of the (?:general )?assembly|member of (?:the )?(?:state )?house of delegates|house of delegates|delegate|house member|state representative, [a-z ]+ county)$/i },
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
  { key: "state_supreme_court", pattern: /^(?:(?:chief |associate )?justice(?: of (?:the )?)?(?:state )?supreme court|(?:state )?supreme court(?: (?:chief |associate )?(?:justice|judge))?)$/i },
  { key: "state_appeals_court", pattern: /^(?:judge(?: of (?:the )?)?(?:state )?court of appeals|(?:state )?court of appeals(?: judge)?|(?:state )?appeals court(?: judge)?)$/i },
  { key: "circuit_court_judge", pattern: /^(?:circuit court judge|judge of (?:the )?circuit court)$/i },
  { key: "district_court_judge", pattern: /^(?:district court judge|judge of (?:the )?district court)$/i },
  { key: "superior_court_judge", pattern: /^(?:superior court judge|judge of (?:the )?superior court)$/i },
  { key: "probate_court_judge", pattern: /^(?:probate (?:court )?judge|judge of (?:the )?probate court)$/i },
  { key: "justice_of_the_peace", pattern: /^justice of the peace$/i },
];

const MEASURE_TITLE = /^(?:proposition|question|measure|referendum|public question|amendment|bond)\b/i;

function officeRule(title: string | null | undefined): OfficeRule | null {
  const stripped = stripSeatFurniture(title ?? "");
  return !stripped || MEASURE_TITLE.test(stripped) ? null : RULES.find(rule => rule.pattern.test(stripped)) ?? null;
}

export function officeIdentity(title: string | null | undefined): OfficeKey | null {
  return officeRule(title)?.key ?? null;
}

export function officeBlurbType(title: string | null | undefined, divisionOcdId?: string | null): string | null {
  const rule = officeRule(title);
  const state = /\/state:([a-z]{2})\b/.exec(divisionOcdId ?? "")?.[1];
  return state && rule?.stateBlurbTypes?.[state] || rule?.blurbType || rule?.key.replace(/_/g, "-") || null;
}

export function sameOffice(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = officeIdentity(a);
  return left !== null && left === officeIdentity(b);
}

export function unclassifiedOfficeTitles(titles: readonly (string | null | undefined)[]): string[] {
  return [...new Set(titles.map(title => stripSeatFurniture(title ?? ""))
    .filter(title => title && !MEASURE_TITLE.test(title) && officeIdentity(title) === null))].sort();
}
