import type { ElectionFieldKind } from "../civic-data/election-fields.ts";
import { CHECKLIST_FAMILIES } from "../coverage/checklist-map.ts";

/** Where a hunter's finding publishes: a fact-store slot, a meeting route hint, a ballot-navigation field, a campaign-site lead, or the class it waits for. */
export type FindingSlot =
  | { readonly class: "rosters"; readonly slot: "member_name" | "member_office" | "term_note" | "term_start" | "term_end" | "member_photo" }
  | { readonly class: "contacts"; readonly slot: "email" | "phone" | "website" }
  | { readonly class: "office contacts"; readonly slot: "office_address" | "office_phone" }
  | { readonly class: "body links"; readonly slot: "name" | "homepage" }
  | { readonly class: "schedules"; readonly slot: "meeting_cadence" }
  | { readonly class: "meeting routes"; readonly slot: "agenda_url" }
  | { readonly class: "sittings"; readonly slot: "agenda_url" | "video_url" }
  | { readonly class: "comment rules"; readonly slot: "comment:period" | "comment:detail" | "comment:signup" | "comment:written" | "comment:attend" | "comment:time_limit" }
  | { readonly class: "official hosts"; readonly slot: "host" }
  | { readonly class: "ballot navigation"; readonly election: ElectionFieldKind }
  | { readonly class: "campaign sites" | "candidates"; readonly lead: "campaign-site" | "candidate-profile" }
  | { readonly class: string; readonly waiting: string };

/** Moves whenever a class gains slots, so findings waiting on it are looked at again. */
export const FINDING_SLOTS_VERSION = "6";

/** The reason a campaign-site finding waits in the Box: the campaign-site chain takes it, checks it and offers it as a lead. */
export const CAMPAIGN_SITE_LEAD = "CAMPAIGN_SITE_CHAIN_TAKES_IT";
/** A candidate's bio, campaign contact or portrait waits for the candidate-profile writer, which knows each candidate's identity. */
export const CANDIDATE_PROFILE_LEAD = "CANDIDATE_PROFILE_WRITER_TAKES_IT";

const PHONE = /^\+?[\d\s().-]{7,}(\s*(x|ext\.?)\s*\d+)?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_VALUE = /^https?:\/\//i;
const DATE = /\b(19|20)\d{2}\b/;

const lookup = (quote: string): ElectionFieldKind | null => /polling|vote center|voting location|where to vote/i.test(quote) ? "polling_lookup"
  : /sample ballot|my ballot|ballot (lookup|status)/i.test(quote) ? "ballot_lookup" : /regist/i.test(quote) ? "registration_lookup" : null;
const navigation = (value: string, quote: string): FindingSlot => {
  const kind = URL_VALUE.test(value) ? lookup(quote) : null;
  return kind ? { class: "ballot navigation", election: kind } : { class: "ballot navigation", waiting: URL_VALUE.test(value) ? "LOOKUP_KIND_NOT_STATED" : "LOOKUP_IS_NOT_AN_ADDRESS" };
};

/** A State Run Checklist item a packet hunter reports, routed where that record publishes; some take their route from the value's shape. */
const CHECKLIST: Readonly<Record<string, (value: string, quote: string) => FindingSlot>> = {
  "GOV-01": () => ({ class: "body links", slot: "name" }),
  "GOV-02": () => ({ class: "body links", slot: "name" }),
  "GOV-08": value => PHONE.test(value) ? { class: "office contacts", slot: "office_phone" } : URL_VALUE.test(value) ? { class: "body links", slot: "homepage" }
    : EMAIL.test(value) ? { class: "body links", waiting: "NO_READER_FIELD" } : { class: "office contacts", slot: "office_address" },
  "REF-07": () => ({ class: "official hosts", slot: "host" }),
  "OFF-02": () => ({ class: "rosters", slot: "member_office" }),
  "OFF-04": () => ({ class: "rosters", slot: "member_name" }),
  "OFF-06": (value, quote) => !DATE.test(value) ? { class: "rosters", slot: "term_note" }
    : /\b(since|began|begins|start|appointed|elected|sworn)\b/i.test(quote) ? { class: "rosters", slot: "term_start" } : { class: "rosters", slot: "term_end" },
  "OFF-17": value => URL_VALUE.test(value) ? {class:"rosters",slot:"member_photo"} : {class:"rosters",waiting:"PORTRAIT_IS_NOT_AN_ADDRESS"},
  "OFF-08": value => URL_VALUE.test(value) ? { class: "contacts", slot: "website" } : { class: "contacts", waiting: "PAGE_IS_NOT_AN_ADDRESS" },
  "OFF-09": value => EMAIL.test(value) ? { class: "contacts", slot: "email" } : PHONE.test(value) ? { class: "contacts", slot: "phone" }
    : { class: "contacts", waiting: "CONTACT_IS_NEITHER_EMAIL_NOR_PHONE" },
  "MTG-01": value => URL_VALUE.test(value) ? { class: "meeting routes", slot: "agenda_url" } : { class: "meeting routes", waiting: "ROUTE_IS_NOT_AN_ADDRESS" },
  "MTG-02": value => URL_VALUE.test(value) ? { class: "meeting routes", slot: "agenda_url" } : { class: "meeting routes", waiting: "ROUTE_IS_NOT_AN_ADDRESS" },
  "MTG-04": () => ({ class: "schedules", slot: "meeting_cadence" }),
  "DOC-01": value => URL_VALUE.test(value) ? { class: "sittings", slot: "agenda_url" } : { class: "sittings", waiting: "LINK_IS_NOT_AN_ADDRESS" },
  "DOC-07": value => URL_VALUE.test(value) ? { class: "sittings", slot: "video_url" } : { class: "sittings", waiting: "LINK_IS_NOT_AN_ADDRESS" },
  "PAR-01": () => ({ class: "comment rules", slot: "comment:attend" }),
  "PAR-02": () => ({ class: "comment rules", slot: "comment:detail" }),
  "PAR-03": () => ({ class: "comment rules", slot: "comment:time_limit" }),
  "ELE-02": () => ({ class: "ballot navigation", election: "election_office" }),
  "ELE-08": (_value, quote) => /regist/i.test(quote) ? { class: "ballot navigation", election: "registration_deadline" }
    : /early/i.test(quote) ? { class: "ballot navigation", election: "early_voting" } : { class: "ballot navigation", waiting: "DEADLINE_HAS_NO_FIELD" },
  "ELE-09": navigation,
  "ELE-15": () => ({ class: "ballot navigation", election: "certified_outcome" }),
  "ELE-20": navigation,
  "ELE-24": navigation,
  "CAN-04": value => URL_VALUE.test(value) ? { class: "campaign sites", lead: "campaign-site" } : { class: "campaign sites", waiting: "SITE_IS_NOT_AN_ADDRESS" },
  "CAN-05": value => URL_VALUE.test(value) ? { class: "campaign sites", lead: "campaign-site" } : { class: "campaign sites", waiting: "SITE_IS_NOT_AN_ADDRESS" },
  "CAN-06": value => EMAIL.test(value) || PHONE.test(value) ? { class: "candidates", lead: "candidate-profile" }
    : { class: "candidates", waiting: "CONTACT_IS_NEITHER_EMAIL_NOR_PHONE" },
  "CAN-16": () => ({ class: "candidates", lead: "candidate-profile" }),
  "CAN-17": value => URL_VALUE.test(value) ? { class: "candidates", lead: "candidate-profile" } : { class: "candidates", waiting: "PORTRAIT_IS_NOT_AN_ADDRESS" },
};

/** Ids whose record publishes only as a whole import (a directory reading, a ballot list, a filing, a dataset), never one value at a time. */
const WHOLE_RECORDS = new Set(("GEO-07 GEO-08 GEO-10 GOV-03 GOV-05 GOV-06 OFF-11 OFF-12 OFF-15 OFF-18 OFF-19 OFF-20 MTG-05 MTG-13 MTG-19 " +
  "DOC-02 DOC-03 DOC-06 DOC-08 DOC-09 DOC-10 DOC-17 PAR-07 LEG-02 LEG-03 LEG-04 LEG-05 LEG-06 LEG-07 LEG-09 LEG-11 LEG-17 LEG-18 LEG-20 LEG-21 " +
  "ELE-01 ELE-04 ELE-07 ELE-11 ELE-16 ELE-21 ELE-22 ELE-25 ELE-26 CAN-01 CAN-02 CAN-03 CAN-07 CAN-12 CAN-21 " +
  "CAM-01 CAM-02 CAM-03 CAM-05 CAM-06 CAM-07 CAM-13 CAM-14 FIN-01 FIN-02 FIN-03 FIN-04 FIN-05 FIN-06 FIN-07 FIN-08 FIN-09 FIN-10 " +
  "FIN-11 FIN-12 FIN-13 FIN-14 FIN-15 PRL-01 PRL-02 PRL-03 REF-01 EXE-01 EXE-02 EXE-03 EXE-04 EXE-05").split(" "));
/** Ids our own code decides (a constant, a derived count, a reader rule), so no page can fill them. */
const CODE_HELD = new Set(("GEO-09 GEO-11 GOV-12 OFF-03 OFF-05 MTG-16 DOC-14 DOC-15 LEG-01 LEG-14 LEG-22 ELE-06 ELE-10 ELE-12 ELE-13 ELE-23 " +
  "CAN-14 FIN-16 REF-03 REF-10").split(" "));
/** A sitting's time, place and source come from reading its door, which a sentence about it cannot stand in for. */
const SITTING_READ = new Set("MTG-06 MTG-07 MTG-08 MTG-12".split(" "));
/** Definitions are written from the saved page by the translation step, never copied from a hunter's quote. */
const TRANSLATED = new Set("GOV-07 GOV-09 REF-04 REF-05".split(" "));
/** Readers have a place for these, but nothing publishes them yet. */
const UNPRODUCED = new Set("GOV-13 CAM-15".split(" "));

function checklistWait(id: string): string {
  return WHOLE_RECORDS.has(id) ? "TAKES_WHOLE_RECORDS_ONLY" : CODE_HELD.has(id) ? "HELD_IN_CODE_NOT_ON_A_PAGE"
    : SITTING_READ.has(id) ? "SITTING_FIELDS_COME_FROM_ITS_DOOR" : TRANSLATED.has(id) ? "WRITTEN_BY_TRANSLATION_FROM_THE_SAVED_PAGE"
    : UNPRODUCED.has(id) ? "NO_PUBLICATION_PATH_YET" : "NO_READER_FIELD";
}

const PERSON = /^(officeholder|member|boardmember|councilmember|(governingboard|governingbody|board|council)\.member)(\.(mayor|vicemayor|superintendent|chair|vicechair|president|vicepresident|member|councilmember))?$/;
const TERM: Readonly<Record<string, "term_note" | "term_start" | "term_end">> = {
  term: "term_note", termnote: "term_note", termstart: "term_start", termbegins: "term_start",
  termend: "term_end", termends: "term_end", termexpires: "term_end", termexpiration: "term_end",
};
const BODY = /^(district|body|office|organization|contact|governingbody|board|council|district\.office|district\.contact|body\.office)$/;
const SERVICES = /(recorder|election|publicworks|service|clerk|treasurer|assessor|sheriff|police|fire|utility|library)/;
const DIRECTORY = /^(body\.name|bodyname|subordinatebody\.name|district\.name|office\.name|homepageurl|jurisdictionname|jurisdiction\.county|district\.county|district\.website|body\.website)$/;
const COMMENT: Readonly<Record<string, "comment:detail" | "comment:signup" | "comment:written" | "comment:attend" | "comment:time_limit">> = {
  commentperioddetail: "comment:detail", "publiccomment.calltothepublic": "comment:detail", "publiccomment.detail": "comment:detail",
  "publiccomment.signup": "comment:signup", signup: "comment:signup",
  "publiccomment.timelimit": "comment:time_limit", "publiccomment.speakinglimit": "comment:time_limit", timelimit: "comment:time_limit",
  writtencomments: "comment:written", writtencomment: "comment:written", "publiccomment.written": "comment:written",
  "publiccomment.attend": "comment:attend", attend: "comment:attend",
};

/** The checklist id a candidate finding's own field name stands for, from its words and its value's shape. */
export function candidateChecklistId(field: string, value: unknown): string | null {
  if (/^CAN-\d{2}$/.test(field.trim())) return field.trim();
  const key = field.toLowerCase().replace(/[^a-z0-9.]/g, ""), text = String(value).trim();
  if (/(^|\.)(bio|biography)(\.|$)/.test(key)) return "CAN-16";
  if (/(photo|portrait|headshot|image)/.test(key)) return "CAN-17";
  if (/(campaignsite|campaignwebsite|website|site)$/.test(key)) return "CAN-04";
  if (/(email|phone|contact)/.test(key) && (EMAIL.test(text) || PHONE.test(text))) return "CAN-06";
  if (/(position|statement|stance|issue|priorit)/.test(key)) return "CAN-07";
  return null;
}

/** A checklist id, or a hunter's own field name matched to a slot by its words; candidate findings belong to the ballot classes. */
export function slotFor(field: string, value: unknown, recordClass: string | null, quote = ""): FindingSlot {
  const item = /^([A-Z]{3})-\d{2}$/.exec(field.trim());
  if (item) return CHECKLIST[item[0]]?.(String(value).trim(), quote)
    ?? { class: CHECKLIST_FAMILIES[item[1]!]?.name.toLowerCase() ?? "other", waiting: checklistWait(item[0]) };
  // Hunters annotate names, as in `officeholder.name (Board Member)` or `officeholder.name/office`.
  const key = field.replace(/\(.*?\)/g, "").split("/")[0]!.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const dot = key.lastIndexOf("."), head = dot < 0 ? "" : key.slice(0, dot), last = key.slice(dot + 1);
  if (key.startsWith("candidate") || recordClass === "candidate-enrichment") {
    const id = candidateChecklistId(field, value);
    return id === null ? { class: "candidates", waiting: "NO_FACT_SLOT" } : CHECKLIST[id]?.(String(value).trim(), quote) ?? { class: "candidates", waiting: checklistWait(id) };
  }
  if (key === "commentperiod") return /^(yes|no)$/i.test(String(value)) ? { class: "comment rules", slot: "comment:period" } : { class: "comment rules", slot: "comment:detail" };
  if (COMMENT[key]) return { class: "comment rules", slot: COMMENT[key] };
  if (key === "meeting.schedule" || key === "body.meetingschedule" || key === "meetingschedule") return { class: "schedules", slot: "meeting_cadence" };
  if (PERSON.test(head) && /^(?:photo|photourl|portrait|portraiturl|headshot)$/.test(last))return {class:"rosters",slot:"member_photo"};
  if (PERSON.test(head) || head === "superintendent" || head === "") {
    if (last === "name") return { class: "rosters", slot: "member_name" };
    if (last === "office" || last === "title") return { class: "rosters", slot: "member_office" };
    if (TERM[last]) return { class: "rosters", slot: TERM[last] };
  }
  if (last === "member" && /^(officeholder|board|council|governingboard|governingbody)$/.test(head)) return { class: "rosters", slot: "member_name" };
  if (/^(officeholder(\.contact)?)?$/.test(head) && (last === "email" || last === "phone")) return { class: "contacts", slot: last };
  if (BODY.test(head) && (last === "phone" || last === "mainphone")) return { class: "office contacts", slot: "office_phone" };
  if (BODY.test(head) && (last === "address" || last === "physicaladdress" || last === "officeaddress")) return { class: "office contacts", slot: "office_address" };
  if (SERVICES.test(key)) return { class: "services", waiting: "SERVICES_CLASS_NOT_MOVED" };
  if (/^(homepageurl|district\.website|body\.website)$/.test(key) && URL_VALUE.test(String(value))) return { class: "body links", slot: "homepage" };
  if (DIRECTORY.test(key)) return { class: "directory", waiting: "DIRECTORY_CLASS_NOT_MOVED" };
  if (key.startsWith("meeting")) return { class: "meetings", waiting: "FINDING_NAMES_NO_SITTING" };
  return { class: "other", waiting: "NO_FACT_SLOT" };
}
