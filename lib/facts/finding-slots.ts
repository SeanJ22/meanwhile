/** What a hunter's finding fills: a fact-store slot on the subject's body or one of its people, or the class it waits for. */
export type FindingSlot =
  | { readonly class: "rosters"; readonly slot: "member_name" | "member_office" | "term_note" | "term_start" | "term_end" }
  | { readonly class: "contacts"; readonly slot: "email" | "phone" }
  | { readonly class: "office contacts"; readonly slot: "office_address" | "office_phone" }
  | { readonly class: "schedules"; readonly slot: "meeting_cadence" }
  | { readonly class: "comment rules"; readonly slot: "comment:period" | "comment:detail" | "comment:signup" | "comment:written" | "comment:attend" | "comment:time_limit" }
  | { readonly class: string; readonly waiting: string };

/** Moves whenever a class gains slots, so findings waiting on it are looked at again. */
export const FINDING_SLOTS_VERSION = "1";

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

/** A hunter's own field name, matched to a slot by its words; candidate findings belong to the ballot classes. */
export function slotFor(field: string, value: unknown, recordClass: string | null): FindingSlot {
  // Hunters annotate names, as in `officeholder.name (Board Member)` or `officeholder.name/office`.
  const key = field.replace(/\(.*?\)/g, "").split("/")[0]!.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const dot = key.lastIndexOf("."), head = dot < 0 ? "" : key.slice(0, dot), last = key.slice(dot + 1);
  if (key.startsWith("candidate") || recordClass === "candidate-enrichment") return { class: "candidates", waiting: "CANDIDATE_CLASS_NOT_MOVED" };
  if (key === "commentperiod") return /^(yes|no)$/i.test(String(value)) ? { class: "comment rules", slot: "comment:period" } : { class: "comment rules", slot: "comment:detail" };
  if (COMMENT[key]) return { class: "comment rules", slot: COMMENT[key] };
  if (key === "meeting.schedule" || key === "body.meetingschedule" || key === "meetingschedule") return { class: "schedules", slot: "meeting_cadence" };
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
  if (DIRECTORY.test(key)) return { class: "directory", waiting: "DIRECTORY_CLASS_NOT_MOVED" };
  if (key.startsWith("meeting")) return { class: "meetings", waiting: "FINDING_NAMES_NO_SITTING" };
  return { class: "other", waiting: "NO_FACT_SLOT" };
}
