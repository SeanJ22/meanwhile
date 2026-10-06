/**
 * **SAMPLE DATA FOR THE DEVELOPMENT PREVIEW ONLY.**
 *
 * Ported from the v6 prototype (`Admin Command Center v6.dc.html`). Every number,
 * incident, identifier and outcome here is an EXAMPLE. It is never evidence and
 * no production page imports this folder. Each section built here is wrapped in
 * `sample(...)` with the dependency that would replace it, so the screens label
 * it "Sample data" wherever it shows.
 *
 * The world is a small reducer so the preview can show a control's natural
 * effect (a job appears after a resource request, a hidden association can be
 * undone). The checklist uses the REAL 325 definitions passed in by the page.
 */
import { PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { SECTION_DEP } from "../dependencies.ts";
import { GROUP_NAMES, PLACE_GROUP_NAMES } from "../groups.ts";
import {
  sample,
  type ActionKind,
  type ActionRef,
  type AdminV6Data,
  type ChecklistGroupCount,
  type ChecklistItem,
  type ClosedFix,
  type Definition,
  type Hunt,
  type ItemStatus,
  type OpenFix,
  type Place,
  type ReaderResult,
  type ReceiptItem,
  type ReceiptStatus,
  type SavedDoc,
  type StageMark,
  type StuckItem,
  type TrailStage,
  type UiReceipt,
  type WaitingItem,
  type WorkerEvent,
  type WorkerJob,
  type WorkRow,
} from "../model.ts";
import { EMPTY_LIFECYCLE } from "../receipts.ts";
import { SAMPLE_AUDIT } from "./register-audit.ts";

/* ------------------------------------------------------------------ world */

export interface SampleWorld {
  readonly contained: boolean;
  readonly stoppedItems: readonly string[];
  readonly workFirst: readonly string[];
  readonly fixRank: readonly string[];
  readonly decisions: Readonly<Record<string, string>>;
  readonly docReady: readonly string[];
  readonly paidPaused: boolean;
  readonly runnerPaused: boolean;
  readonly tasks: readonly { readonly fixId: string; readonly id: string }[];
  readonly jobsStopped: readonly string[];
  readonly focus: Readonly<Record<string, string>>;
  readonly hunts: Readonly<Record<string, Partial<Hunt>>>;
}

export const INITIAL_WORLD: SampleWorld = {
  contained: false,
  stoppedItems: [],
  workFirst: [],
  fixRank: [],
  decisions: {},
  docReady: [],
  paidPaused: false,
  runnerPaused: false,
  tasks: [],
  jobsStopped: [],
  focus: {},
  hunts: {},
};

export const SAMPLE_AS_OF = "2026-09-28T06:53:00.000Z";

/* ----------------------------------------------------------------- places */

const STATE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(US_STATES.map((st) => [st.code.toUpperCase(), st.name]));

export const K = {
  us: "us",
  az: "st:az",
  nh: "st:nh",
  nj: "st:nj",
  cochise: "geo:az.county.04003",
  pima: "geo:az.county.04019",
  z85635: "geo:az.zcta.85635",
  z85701: "geo:az.zcta.85701",
  cochiseBos: "body:cochise-bos",
  svCouncil: "body:sv-council",
  merrimack: "geo:nh.county.33013",
  nhExec: "body:nh-exec",
  morris: "geo:nj.county.34027",
  morrisComm: "body:morris-comm",
} as const;

function samplePlaces(): readonly Place[] {
  const out: Place[] = [{ key: K.us, name: "United States", kind: "Country", navParent: null, within: [] }];
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    out.push({ key: `st:${code.toLowerCase()}`, name, kind: "State", navParent: K.us, within: [K.us], code, tracked: Object.values(K).includes(`st:${code.toLowerCase()}` as typeof K[keyof typeof K]) });
  }
  const add = (key: string, name: string, kind: Place["kind"], navParent: string, within: readonly string[]) => out.push({ key, name, kind, navParent, within });
  add(K.cochise, "Cochise County, AZ", "County", K.az, [K.az]);
  add(K.pima, "Pima County, AZ", "County", K.az, [K.az]);
  add(K.z85635, "ZIP 85635 · Sierra Vista", "ZIP", K.cochise, [K.cochise]);
  add(K.z85701, "ZIP 85701 · Tucson", "ZIP", K.pima, [K.pima]);
  add(K.cochiseBos, "Cochise County Board of Supervisors", "Body", K.cochise, [K.cochise]);
  add(K.svCouncil, "Sierra Vista City Council", "Body", K.z85635, [K.z85635]);
  add(K.merrimack, "Merrimack County, NH", "County", K.nh, [K.nh]);
  add(K.nhExec, "NH Executive Council", "Body", K.nh, [K.nh]);
  add(K.morris, "Morris County, NJ", "County", K.nj, [K.nj]);
  add(K.morrisComm, "Morris County Board of Commissioners", "Body", K.morris, [K.morris]);
  return out;
}

function sampleHunts(w: SampleWorld): readonly Hunt[] {
  const base: Hunt[] = [
    { id: "hunt-85635", placeKey: K.z85635, name: "ZIP 85635 hunt", startedAt: "2026-09-27T22:17:00.000Z", limitUsd: 50, limitSource: "your instruction on Sep 27, read by the workers at 11:39 PM", spentUsd: 15.16, heldUsd: 6.12, unpricedEntries: 154, status: "running", researchWorkers: 4 },
    { id: "hunt-merrimack", placeKey: K.merrimack, name: "Merrimack County hunt", startedAt: "2026-09-26T13:00:00.000Z", limitUsd: 30, limitSource: "your instruction on Sep 26", spentUsd: 8.4, heldUsd: 2.1, unpricedEntries: 12, status: "running", researchWorkers: 2 },
  ];
  const out = base.map((h) => ({ ...h, ...(w.hunts[h.placeKey] ?? {}) }) as Hunt);
  for (const [key, h] of Object.entries(w.hunts)) {
    if (!base.some((b) => b.placeKey === key) && h.id) out.push(h as Hunt);
  }
  return out;
}

/* ------------------------------------------------------------------ docs */

const DOCS: Readonly<Record<string, SavedDoc>> = {
  "doc-cochise-ics": { id: "doc-cochise-ics", name: "Cochise County calendar feed (.ics)", meta: "Saved Sep 27, 5:33 PM · 3,044 bytes · fingerprint checked 11:56 PM · private copy", sourceUrl: "https://cochise.az.gov/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar", access: "private", preview: "BEGIN:VEVENT\nSUMMARY:Board of Supervisors Regular Meeting\nDTSTART;TZID=America/Phoenix:20261013T100000\nLOCATION:1415 Melody Lane, Bisbee AZ\nEND:VEVENT\n… (sample excerpt)" },
  "doc-cochise-agenda": { id: "doc-cochise-agenda", name: "Cochise County Agenda Center page", meta: "Saved Sep 27, 5:33 PM · 227,375 bytes · private copy", sourceUrl: "https://cochise.az.gov/AgendaCenter", access: "private", preview: "Agenda Center · Board of Supervisors · Oct 13, 2026 Regular Meeting · Agenda (PDF) · Packet (PDF) … (sample excerpt)" },
  "doc-sv-list": { id: "doc-sv-list", name: "Sierra Vista meeting list page", meta: "Saved Sep 26, 3:47 AM · 189,174 bytes · private copy", sourceUrl: "https://www.sierravistaaz.gov/our-city/calendar-meeting-list", access: "private", preview: "City Council Regular Meeting · October 8, 2026 · 5:00 PM · Council Chambers … (sample excerpt)" },
  "doc-nh-agenda": { id: "doc-nh-agenda", name: "Executive Council agenda page", meta: "Saved Sep 26, 4:20 PM · public page", sourceUrl: "https://www.sos.nh.gov/", access: "public", preview: "Governor and Executive Council · Wednesday, October 7, 2026 · 10:00 AM · State House, Room 207 … (sample excerpt)" },
  "doc-az-fin": { id: "doc-az-fin", name: "AZ Secretary of State finance export", meta: "Read Sep 27, 11:20 PM · 14.2 MB · only its fingerprint and pulled-out records are kept", sourceUrl: "https://azsos.gov/elections", access: "unavailable", unavailableWhy: "No saved copy: the export is larger than we store. Only its fingerprint and the pulled-out records are kept." },
  "doc-morris-roster": { id: "doc-morris-roster", name: "Board of Commissioners roster", meta: "Saved Sep 26 · public page", sourceUrl: "https://www.morriscountynj.gov/", access: "public", preview: "Commissioner (seat 2) · term ends December 31, 2026 … (sample excerpt)" },
  "doc-morris-clerk": { id: "doc-morris-clerk", name: "County clerk officials list", meta: "Saved Sep 26 · public page", sourceUrl: "https://www.morriscountynj.gov/", access: "public", preview: "Commissioner (seat 2) · term expires 12/31/2027 … (sample excerpt)" },
};
export const SAMPLE_DOC_IDS = Object.keys(DOCS);

/* --------------------------------------------------------------- results */

function st(name: string, mark: StageMark, when: string, what: string, extra: Partial<TrailStage> = {}): TrailStage {
  return { name, mark, when, what, ...extra };
}
const marks = (s: string): StageMark[] =>
  s.split("").map((c) => ({ d: "done", o: "not-yet", x: "wrong", p: "partial", r: "reported", w: "waiting" } as const)[c as "d"]);

function sampleResults(w: SampleWorld): readonly ReaderResult[] {
  const c = w.contained;
  return [
    {
      id: "r-cochise-mtg", title: "Cochise County Board of Supervisors: upcoming meetings", applies: [K.cochiseBos, K.z85635], kind: "New",
      stages: marks(c ? "ddoooo" : "ddooox"),
      readerSees: c ? "Wrong meetings hidden from the card (can be undone). Cochise meetings are still missing." : "Wrong: the card shows 280 Tucson and Pima meetings instead",
      problem: !c,
      trail: [
        st("Found", "done", "Sep 27, 5:33 PM", "Found Cochise County’s official calendar feed and Agenda Center.", { technical: ["work discovery-meetings-az_county_county-of-cochise-86b08512", "method discovery:meetings"] }),
        st("Saved", "done", "checked Sep 27, 11:56 PM", "Saved 2 files. Both still match their fingerprints.", { docs: [DOCS["doc-cochise-ics"], DOCS["doc-cochise-agenda"]], technical: ["ar-10f1fa4e380d26d11a805a78", "ar-3c3c7171454e1da92d9b2e5a", "attempt da-1f140a3f5409858db96b8af7"] }),
        st("Facts pulled out", "not-yet", "not started", "Nobody has read the meetings out of these files yet.", { missing: "The software that pulls out facts can’t reach saved files.", next: "Collection engineering is letting it read saved files. Then the normal line runs it, with no new search.", facts: [{ field: "Date", value: "—", note: "not pulled out" }, { field: "Time and time zone", value: "—", note: "not pulled out" }, { field: "Location", value: "—", note: "not pulled out" }, { field: "Remote access", value: "—", note: "not captured by our software" }], technical: ["fix MW-060", "definition MTG-09"] }),
        st("Facts checked against sources", "waiting", "—", "Each meeting will be checked against the source for date, time, place and that it belongs to Cochise County."),
        st("Published", "waiting", "card v14 · Sep 20", "The current card has no Cochise meetings. It shows 280 from Pima County bodies because of a wrong link between records.", { facts: [{ field: "v14 · current", value: "280 meetings through the wrong link", note: c ? "hidden (can be undone)" : "wrong link" }, { field: "v13 · earlier", value: "No meetings", note: "missing" }] }),
        st("Checked on the public page", c ? "not-yet" : "wrong", "seen Sep 28, 12:10 AM", c ? "The wrong meetings are hidden. The exact card now says local meetings aren’t available yet." : "The exact card shows 280 meetings from Tucson and Pima County bodies. Its Sources tab lists Tucson Unified and the City of Tucson Clerk.", { missing: "Cochise County’s own meetings", next: "Engineers fix how county cards choose bodies. Then this card is checked again.", publicLink: { url: `${PUBLIC_SITE_ORIGIN}/?zip=85635&card=county-az-cochise&tab=meetings`, label: "Open the exact card (sample link)", seenAt: "2026-09-28T07:10:00.000Z" }, technical: ["reader view 85635 · Cochise · Meetings tab", "association assoc-cochise-card-pima-bodies", "fix MW-061"] }),
      ],
    },
    {
      id: "r-sv-mtg", title: "Sierra Vista City Council: upcoming meetings", applies: [K.svCouncil], kind: "New", stages: marks("ddoooo"),
      readerSees: "Nothing yet. The meeting list was saved Sep 26 but not read.", problem: false,
      trail: [
        st("Found", "done", "Sep 26, 3:47 AM", "Found the city’s official meeting list page."),
        st("Saved", "done", "Sep 26, 3:47 AM", "Saved the page. It still matches its fingerprint.", { docs: [DOCS["doc-sv-list"]], technical: ["ar-68529c147895b186fc93e8e8", "attempt da-3514d937229bb1fb2477633d"] }),
        st("Facts pulled out", "not-yet", "not started", "Nobody has read the meetings out of this page yet.", { missing: "The software that pulls out facts can’t reach saved files.", next: "The same fix as Cochise clears this." }),
        st("Facts checked against sources", "waiting", "—", "Waits for the step before."),
        st("Published", "waiting", "—", "Nothing published for this body yet."),
        st("Checked on the public page", "not-yet", "—", "Readers see no Sierra Vista City Council meetings."),
      ],
    },
    {
      id: "r-az-fin", title: "Arizona campaign finance filings", applies: [K.az], kind: "Updated", stages: marks("dpdppr"),
      readerSees: "Partly published: new filings are live, 37 committees kept from the old version. Not checked on the public page yet.", problem: true,
      trail: [
        st("Found", "done", "shared statewide", "The Secretary of State’s campaign finance export."),
        st("Saved", "partial", "Sep 27, 11:20 PM", "Only the fingerprint and pulled-out records are kept.", { docs: [DOCS["doc-az-fin"]] }),
        st("Facts pulled out", "done", "Sep 27, 11:25 PM", "Read by plain code.", { facts: [{ field: "Filings, Sep 1–27", value: "1,284 new", note: "new" }, { field: "Committees", value: "1,247 current", note: "updated" }, { field: "Committees missing from the new file", value: "37", note: "retained: old values kept and marked" }] }),
        st("Facts checked against sources", "partial", "Sep 27, 11:31 PM", "Passed for the new filings. Failed “records removed without explanation” for 37 committees."),
        st("Published", "partial", "v31 · Sep 27, 11:40 PM", "New filings published. The 37 committees were kept from v30.", { facts: [{ field: "v31 · current", value: "new filings + 37 retained", note: "retained" }, { field: "v30 · earlier", value: "previous file", note: "replaced" }] }),
        st("Checked on the public page", "reported", "not checked", "Another session reports it’s visible. No reader check is linked yet, so it isn’t counted as checked.", { next: "Run “Check the public page now”." }),
      ],
    },
    {
      id: "r-congress", title: "Members of Congress directory", applies: [K.us], kind: "Reused", stages: marks("dddddr"),
      readerSees: "Published Sep 27, 3:20 PM. The reader check isn’t linked yet.", problem: false,
      trail: [
        st("Found", "done", "shared national", "Congress’s official bulk roster."),
        st("Saved", "done", "Sep 27", "Saved by the national source worker.", { technical: ["saved file ID not linked in the current record"] }),
        st("Facts pulled out", "done", "Sep 27", "Read by plain code. No AI cost."),
        st("Facts checked against sources", "done", "Sep 27, 3:20 PM", "All required source checks passed."),
        st("Published", "done", "Sep 27, 3:20 PM", "Published to the data the site uses. Reused by every hunt, not new for any of them.", { technical: ["reader version cv-93c510e4769d65ade82653ecd376f91c"] }),
        st("Checked on the public page", "reported", "not linked", "The source pass recorded a readback, but it isn’t linked to this record. A data response isn’t proof a reader saw it.", { publicLink: { url: `${PUBLIC_SITE_ORIGIN}/api/directory`, label: "Data response (not reader proof)", seenAt: null } }),
      ],
    },
    {
      id: "r-nh-exec", title: "NH Executive Council: upcoming meetings", applies: [K.nhExec], kind: "New", stages: marks("dddddd"),
      readerSees: "Checked on the exact public page Sep 27, 9:12 PM", problem: false,
      trail: [
        st("Found", "done", "posted Sep 26, 4:00 PM", "The Executive Council’s official agenda page."),
        st("Saved", "done", "Sep 26, 4:20 PM", "Public page saved.", { docs: [DOCS["doc-nh-agenda"]] }),
        st("Facts pulled out", "done", "Sep 26, 4:24 PM", "Plain code, then the cheapest AI (Haiku 4.5) for the location line.", { facts: [{ field: "Date", value: "Wed, Oct 7, 2026", note: "new" }, { field: "Time", value: "10:00 AM EDT", note: "new" }, { field: "Location", value: "State House, Room 207", note: "new" }, { field: "Agenda link", value: "official PDF", note: "new" }, { field: "Remote access", value: "Not published by the source", note: "source doesn’t publish it · evidence saved" }] }),
        st("Facts checked against sources", "done", "Sep 26, 4:31 PM", "All 6 checks passed."),
        st("Published", "done", "v2 · Sep 26, 4:32 PM", "Published automatically.", { facts: [{ field: "v2 · current", value: "adds agenda link", note: "updated" }, { field: "v1 · earlier", value: "no agenda link", note: "replaced" }] }),
        st("Checked on the public page", "done", "seen Sep 27, 9:12 PM", "The exact card matches v2.", { publicLink: { url: `${PUBLIC_SITE_ORIGIN}/?state=NH&body=nh-executive-council&tab=meetings&meeting=2026-10-07`, label: "Open the exact card (sample link)", seenAt: "2026-09-28T04:12:00.000Z" } }),
      ],
    },
    {
      id: "r-morris-terms", title: "Morris County commissioners: term-end dates", applies: [K.morrisComm], kind: "Updated", stages: marks("dddxpd"),
      readerSees: w.decisions["morris"] ? `Your decision is saved: ${w.decisions["morris"]}. The change is pending.` : "Held: two official sources disagree. Old dates still shown, marked “being checked”.",
      problem: !w.decisions["morris"],
      trail: [
        st("Found", "done", "Sep 26", "Two official sources: the board’s roster and the county clerk’s list."),
        st("Saved", "done", "Sep 26", "Both pages saved.", { docs: [DOCS["doc-morris-roster"], DOCS["doc-morris-clerk"]] }),
        st("Facts pulled out", "done", "Sep 26", "Term-end dates read from both.", { facts: [{ field: "Seat 2 term end", value: "roster Dec 31, 2026 · clerk Dec 31, 2027", note: "conflict" }, { field: "Seat 4 term end", value: "roster Dec 31, 2026 · clerk Dec 31, 2028", note: "conflict" }, { field: "Other fields", value: "names, contacts", note: "updated" }] }),
        st("Facts checked against sources", "wrong", "Sep 26", "Failed: the sources disagree. The system stopped rather than guess."),
        st("Published", "partial", "v9 · Sep 26", "Other fields updated. The old dates (v8) are kept and marked “being checked”."),
        st("Checked on the public page", "done", "seen Sep 27", "The card shows the old dates with the note."),
      ],
    },
  ];
}

/* ------------------------------------------------------------------ stuck */

const a = (kind: ActionKind, target: string, payload?: Record<string, string>): ActionRef => ({ kind, target, payload });

function sampleStuck(w: SampleWorld): readonly StuckItem[] {
  const stopped = (id: string) => w.stoppedItems.includes(id);
  const decided = (id: string) => w.decisions[id];
  const items: StuckItem[] = [
    { id: "i-wrong", applies: [K.cochiseBos, K.z85635], lane: "software", title: "The Cochise County card shows another county’s meetings", cause: "The card picks its bodies too broadly, so 280 meetings from Tucson and Pima County bodies are attached to it.", age: "since Sep 28, 12:10 AM", ageRank: 2, tried: "Nothing yet", helped: "—", next: "Publishing engineering fixes how a county card chooses its bodies. Meanwhile you can hide the wrong meetings from this card.", owner: "Publishing engineering", resultId: "r-cochise-mtg", readersAffected: !w.contained, fixId: "MW-061", unlocks: 1, actions: [

], latest: w.contained ? "Wrong meetings hidden (can be undone)" : undefined },
    { id: "i-cochise-held", applies: [K.cochiseBos, K.z85635], lane: "software", title: "Cochise meeting files are saved but never read", cause: "The calendar feed and Agenda Center page were saved and checked, but the software that pulls out facts can’t reach saved files.", age: "6 h 20 m", ageRank: 2, tried: "1 discovery · plain code, $0", helped: "Files saved, nothing delivered", next: "Collection engineering lets that software read saved files. Then the normal line runs it, with no new search.", owner: "Collection engineering", resultId: "r-cochise-mtg", fixId: "MW-060", unlocks: 2, group: "held", actions: [

], latest: w.workFirst.includes("w-cochise") ? "Put first" : undefined },
    { id: "i-sv-held", applies: [K.svCouncil], lane: "software", title: "Sierra Vista’s meeting list is saved but never read", cause: "Same cause as Cochise. The page has been saved since Sep 26.", age: "44 h", ageRank: 3, tried: "1 discovery · plain code, $0", helped: "Page saved, nothing delivered", next: "The same fix clears both.", owner: "Collection engineering", resultId: "r-sv-mtg", fixId: "MW-060", unlocks: 1, group: "held", actions: [

], latest: w.workFirst.includes("w-sv") ? "Put first" : undefined },
    { id: "i-az-fin", applies: [K.az], lane: "publisher", title: "Arizona’s finance file dropped 37 committees", cause: "The Secretary of State’s new file leaves out 37 committees the last one had, with no explanation. New filings were published. The 37 were kept as they were and marked retained.", age: "25 min", ageRank: 1, tried: "Publishing refused once, then a partial publish", helped: "Yes: new filings are live", next: "Automatic recheck of the source at 6:00 AM. If they’re still missing, it becomes a question for the publisher.", owner: "Waiting for the AZ Secretary of State", resultId: "r-az-fin", actions: [

] },
    { id: "i-unpriced", applies: [K.z85635], lane: "software", title: "154 AI charges in this hunt were saved without a price", cause: "They were recorded without a cost. Some may be refused or free calls, so the unknown amount is $0 or more.", age: "since the hunt started", ageRank: 2, tried: "None", helped: "—", next: "Cost engineering prices charges when they’re written and fills in these 154.", owner: "Cost engineering", fixId: "MW-063", actions: [

] },
    { id: "i-pima", applies: [K.pima], lane: "software", title: "Pima County Prop 423 finance: page format we can’t read", cause: "We found the records but have no reader for this format. It kept retrying: 8 of 9 attempts were retries.", age: "3 days", ageRank: 3, tried: "9 attempts · $1.63", helped: "No", next: "Stop this method, keep it owed, and add a reader for the format.", owner: "Collection engineering", fixId: "MW-062", group: "fmt", actions: [

], latest: stopped("i-pima") ? "Method stopped · still owed · repair scheduled" : undefined },
    { id: "i-avondale", applies: [K.az], lane: "software", title: "City of Avondale finance: page format we can’t read", cause: "Same missing reader. Plain code, so no AI cost.", age: "5 days", ageRank: 3, tried: "plain code · $0", helped: "No", next: "Add a reader for the format.", owner: "Collection engineering", fixId: "MW-062", group: "fmt", actions: [

], latest: stopped("i-avondale") ? "Method stopped · still owed · repair scheduled" : undefined },
    { id: "i-cassidy", applies: [K.merrimack], lane: "software", title: "Candidate Frank Cassidy: page format we can’t read", cause: "11 of 13 attempts were retries of the same method.", age: "4 days", ageRank: 3, tried: "13 attempts · $4.91", helped: "No", next: "Stop this method, keep it owed, and add a reader.", owner: "Collection engineering", fixId: "MW-062", group: "fmt", actions: [

], latest: stopped("i-cassidy") ? "Method stopped · still owed · repair scheduled" : undefined },
    { id: "i-davis", applies: [K.merrimack], lane: decided("davis") ? "auto" : "decision", title: "Candidate Erica Davis: automatic routes can’t find her own information", cause: "Every automatic route tried so far has failed. 16 of 17 attempts were retries.", age: "6 days", ageRank: 3, tried: "17 attempts · $7.25", helped: "No", next: "Your decision. You can look for another route, contact the campaign (needs outreach permission), or record it as unavailable with evidence.", owner: decided("davis") ? "Automatic, after your decision" : "You", unlocks: 1, group: "person", actions: [a("decide", "davis")], latest: decided("davis") ? `Decision saved: ${decided("davis")}` : undefined,
      decision: { id: "davis", question: "How should we get Erica Davis’s information?", options: [
        { id: "route", label: "Look for another route automatically", note: "Research workers try routes not yet tried, including the state filing office. Paid work stays within limits." },
        { id: "outreach", label: "Contact the campaign", note: "Someone would email the campaign on Meanwhile’s behalf.", outreach: true },
        { id: "absent", label: "Record it as not available from the source", note: "Needs evidence of what was checked and when. Counts as a source limit, not as delivered." },
        { id: "other", label: "Something else", note: "Say it in your own words.", ownWords: true },
      ] } },
    { id: "i-morris", applies: [K.morrisComm], lane: decided("morris") ? "auto" : "decision", title: "Two official sources disagree on two commissioners’ term-end dates", cause: "The board’s roster and the county clerk’s list are both current and give different dates. The system stopped rather than guess.", age: "2 days", ageRank: 2, tried: "Both sources re-read · $0.44", helped: "Confirmed the conflict", next: "Your decision on which source to trust, or ask for a third source.", owner: decided("morris") ? "Automatic, after your decision" : "You", resultId: "r-morris-terms", readersAffected: !decided("morris"), unlocks: 1, actions: [a("decide", "morris")], latest: decided("morris") ? `Decision saved: ${decided("morris")}` : undefined,
      decision: { id: "morris", question: "Which term-end dates should readers see?", options: [
        { id: "clerk", label: "Trust the county clerk’s list", note: "Publishes the clerk’s dates. The roster’s dates go into history." },
        { id: "roster", label: "Trust the board’s roster", note: "Publishes the roster’s dates. The clerk’s dates go into history." },
        { id: "both", label: "Show both dates with a note", note: "Readers see both sources until one changes." },
        { id: "third", label: "Look for a third official source", note: "Automatic. The dates stay marked “being checked” meanwhile." },
        { id: "other", label: "Something else", note: "Say it in your own words.", ownWords: true },
      ] } },
    { id: "i-marana", applies: [K.az], lane: "auto", title: "Marana Unified School District board: site can’t be reached", cause: "The site has timed out for 3 days. The system retries with longer gaps and tries the district’s second calendar address.", age: "3 days", ageRank: 3, tried: "5 tries · plain code, $0", helped: "Not yet", next: "Next try 6:00 AM. After 2 more failures it switches to the county’s posted notices.", owner: "Automatic repair", actions: [

] },
    { id: "i-retry", applies: [K.us], lane: "auto", title: "731 failed rows are retrying on their own", cause: "319 of them repeat the same method and get the same result. 412 are changing method between tries.", age: "mixed", ageRank: 2, tried: "Automatic retries", helped: "Not measured", next: "Stop the 319 repeats, keep them owed, and send them to repair. Keep the other 412 retrying.", owner: "Operations engineering", group: "retry", actions: [

] },
  ];
  return items;
}

/* ------------------------------------------------------------------ work */

function sampleRows(): readonly WorkRow[] {
  const R: [WorkRow["stage"], string, string, string, WorkRow["link"]?][] = [
    ["waiting", "Cochise County: pull meetings from saved files", K.cochiseBos, "6 h", { type: "stuck", id: "i-cochise-held" }],
    ["waiting", "Sierra Vista: pull meetings from saved list", K.svCouncil, "44 h", { type: "stuck", id: "i-sv-held" }],
    ["waiting", "Hereford NRCD: find a meeting route", K.z85635, "5 h"],
    ["waiting", "Palominas ESD: find a meeting route", K.z85635, "5 h"],
    ["waiting", "Sierra Vista USD: find a meeting route", K.z85635, "5 h"],
    ["waiting", "Pima County Board of Adjustment: agenda packets", K.pima, "1 day"],
    ["waiting", "Cochise College District: find a meeting route", K.z85635, "5 h"],
    ["waiting", "Whetstone Fire District: find a meeting route", K.z85635, "5 h"],
    ["stuck", "Pima County Prop 423 finance", K.pima, "3 days", { type: "stuck", id: "i-pima" }],
    ["stuck", "City of Avondale finance", K.az, "5 days", { type: "stuck", id: "i-avondale" }],
    ["stuck", "Candidate Frank Cassidy", K.merrimack, "4 days", { type: "stuck", id: "i-cassidy" }],
    ["stuck", "Candidate Erica Davis", K.merrimack, "6 days", { type: "stuck", id: "i-davis" }],
    ["stuck", "Morris County term-end dates", K.morrisComm, "2 days", { type: "stuck", id: "i-morris" }],
    ["retrying", "Marana USD board: read calendar", K.az, "3 days", { type: "stuck", id: "i-marana" }],
    ["retrying", "Merrimack County register: read filings", K.merrimack, "1 day"],
    ["done", "NH Executive Council: meetings refresh", K.nhExec, "Sep 27", { type: "result", id: "r-nh-exec" }],
    ["done", "Congress roster refresh", K.us, "Sep 27", { type: "result", id: "r-congress" }],
    ["done", "AZ finance export (partly published)", K.az, "Sep 27", { type: "result", id: "r-az-fin" }],
    ["done", "Tucson Unified board: meetings refresh", K.pima, "Sep 27"],
    ["done", "Morris County meetings refresh", K.morris, "Sep 26"],
    ["retired", "Old Cochise scraping route (replaced by feed)", K.cochise, "Sep 20"],
    ["retired", "NJ duplicate roster route", K.nj, "Sep 18"],
  ];
  return R.map(([stage, title, placeKey, age, link], i) => ({ id: `w${i}`, stage, title, placeKey, age, link }));
}

/* --------------------------------------------------------------- workers */

function sampleJobs(w: SampleWorld): readonly WorkerJob[] {
  const J: WorkerJob[] = [
    { id: "j1", stage: "finding", title: "Hereford NRCD: find a meeting route", placeKey: K.z85635, hunt: "ZIP 85635 hunt", requirement: "Meetings: publisher route", startedAt: "2026-09-28T06:44:00.000Z", elapsed: "9 min so far", method: "A route that worked before, from our saved routes, so no new search is paid for", model: "Cheapest AI (Haiku 4.5)", modelWhy: "Starts with the cheapest AI", cost: "$0.12 set aside", latest: "Tried 2 of 5 saved routes", next: "Try the county notice board" },
    { id: "j2", stage: "finding", title: "Palominas ESD: find a meeting route", placeKey: K.z85635, hunt: "ZIP 85635 hunt", requirement: "Meetings: publisher route", startedAt: "2026-09-28T06:47:00.000Z", elapsed: "6 min so far", method: "Search, then the district site", model: "Cheapest AI (Haiku 4.5)", modelWhy: "Starts with the cheapest AI", cost: "$0.12 set aside", latest: "Found the board’s page", next: "Save it as evidence" },
    { id: "j3", stage: "collecting", title: "Merrimack County register: campaign filings", placeKey: K.merrimack, hunt: "Merrimack County hunt", requirement: "Campaign finance filings", startedAt: "2026-09-28T06:40:00.000Z", elapsed: "13 min so far", method: "Official register site · plain code", model: "No AI (plain code)", modelWhy: "No AI needed", cost: "$0.00", latest: "Downloaded 3 of 7 filings", next: "Download the other 4" },
    { id: "j4", stage: "extracting", title: "Merrimack candidates: profiles", placeKey: K.merrimack, hunt: "Merrimack County hunt", requirement: "Candidate profile fields", startedAt: "2026-09-28T06:42:00.000Z", elapsed: "11 min so far", method: "Saved candidate pages (reused evidence)", model: "Mid-level AI (Sonnet 5.5)", modelWhy: "Moved up one step because the cheapest AI got the office name wrong in its check", cost: "$0.40 set aside · $0.22 spent", latest: "4 of 9 profiles pulled out", next: "Check them against the source" },
    { id: "j6", stage: "publishing", title: "Congress roll calls: refresh", placeKey: K.us, hunt: "Shared national", requirement: "Roll-call votes", startedAt: "2026-09-28T06:50:00.000Z", elapsed: "3 min so far", method: "Congress bulk data · plain code", model: "No AI (plain code)", modelWhy: "No AI needed", cost: "$0.00", latest: "New version ready", next: "Publish, then check the exact card" },
  ];
  if (w.focus["A-1"] === "research") {
    J.push({ id: "j7", stage: "collecting", title: "Marana schools calendar: try the county’s posted notices", placeKey: K.az, hunt: "Shared statewide", requirement: "Meetings: official meeting source", startedAt: "2026-09-28T06:55:00.000Z", elapsed: "just started", method: "The county’s posted notices, plain code", model: "No AI (plain code)", modelWhy: "Extra worker slots you asked for", cost: "$0.00", latest: "Starting", next: "Save what it finds" });
  }
  return J.filter((j) => !w.jobsStopped.includes(j.id));
}

function sampleWaiting(): readonly WaitingItem[] {
  return [
    { kind: "Scheduled", title: "Arizona finance: recheck the 37 dropped committees", why: "Waiting for the Secretary of State’s next update, so nothing is running yet.", nextTime: "6:00 AM", owner: "Automatic", applies: [K.az], actions: [] },
    { kind: "Waiting on a fix", title: "Cochise meeting extraction", why: "The software that pulls out facts can’t read saved files yet.", nextTime: "when that fix is in use by the workers", owner: "Collection engineering", applies: [K.cochiseBos, K.z85635], actions: [

] },
    { kind: "Method", title: "Pima County Prop 423 finance", why: "No reader for this page format. The method is stopped and the requirement stays owed.", nextTime: "when the reader ships", owner: "Collection engineering", applies: [K.pima], actions: [

] },
    { kind: "Website", title: "Marana USD calendar", why: "The district’s site keeps timing out.", nextTime: "next try 6:00 AM", owner: "Automatic repair", applies: [K.az], actions: [] },
    { kind: "Setting", title: "Paid work in every hunt", why: "The $105-a-day spending restriction still applies to the workers. $17.33 used today, so nothing is paused now.", nextTime: "when the workers restart with the update", owner: "Operations engineering", applies: [K.us], actions: [] },
    { kind: "Permission", title: "Contacting Erica Davis’s campaign", why: "Outreach isn’t authorized.", nextTime: "once outreach is authorized", owner: "You", applies: [K.merrimack], actions: [a("decide", "davis")] },
    { kind: "Website refuses automated access", title: "Arizona legislative votes", why: "The host refuses automated access, and no permitted route is chosen yet.", nextTime: "not scheduled", owner: "Operations engineering", applies: [K.az], actions: [] },
    { kind: "Money set aside", title: "Merrimack County hunt", why: "$2.10 is set aside for calls that are running.", nextTime: "frees as calls settle", owner: "Automatic", applies: [K.merrimack], actions: [] },
  ];
}

function sampleEvents(): readonly WorkerEvent[] {
  return [
    { at: "11:50 PM", kind: "Publishing", text: "Roll-call version ready. National and shared, reused by every hunt.", applies: [K.us], tone: "good" },
    { at: "11:44 PM", kind: "Automatic repair", text: "Marana: switched to the second calendar address. It hasn’t helped yet.", applies: [K.az], tone: "good" },
    { at: "11:42 PM", kind: "Moved up to a stronger AI model", text: "Merrimack profiles moved from Haiku 4.5 to Sonnet 5.5 because the office field failed its check.", applies: [K.merrimack], tone: "warn" },
    { at: "11:41 PM", kind: "Reused what it learned", text: "3 search attempts used saved routes into websites, so no new search was paid for.", applies: [K.z85635], tone: "info" },
    { at: "11:40 PM", kind: "Publishing", text: "Arizona finance v31 published in part, with 37 committees retained.", applies: [K.az], tone: "good" },
    { at: "11:39 PM", kind: "Your instruction", text: "The ZIP 85635 instruction was read and 57 paid items moved first.", applies: [K.z85635], tone: "info" },
    { at: "Sep 27 9:12 PM", kind: "Checked on the public page", text: "The NH Executive Council exact card matches v2.", applies: [K.nhExec], tone: "good" },
  ];
}

/* ------------------------------------------------------------- checklist */

const PLACE_GROUPS = PLACE_GROUP_NAMES;
const BASE: Readonly<Record<string, readonly number[]>> = {
  GEO: [0, 2, 4, 6, 0, 2, 0], GOV: [0, 0, 11, 110, 11, 22, 0], OFF: [0, 6, 4, 150, 30, 30, 0], MTG: [0, 0, 4, 150, 33, 33, 0], DOC: [0, 0, 2, 120, 40, 25, 0],
  LEG: [0, 4, 0, 20, 10, 10, 0], ELE: [0, 2, 0, 14, 4, 6, 0], CAN: [0, 0, 0, 120, 24, 24, 0], CAM: [0, 0, 6, 24, 12, 12, 0], FIN: [0, 0, 0, 60, 60, 56, 0],
  PAR: [0, 0, 0, 40, 24, 24, 0], ASK: [0, 0, 0, 10, 6, 4, 0],
};
const SCALE: Readonly<Record<string, readonly number[]>> = {
  [K.z85635]: [1, 0, 0], [K.svCouncil]: [0.09, 0, 0], [K.cochiseBos]: [0.09, 0, 0], [K.cochise]: [1.6, 0, 0], [K.pima]: [3.1, 0, 0.03], [K.z85701]: [0.9, 0, 0.03],
  [K.az]: [14, 0, 0.03], [K.nh]: [8, 0.12, 0.04], [K.merrimack]: [1.5, 0.1, 0.04], [K.nhExec]: [0.1, 0.3, 0.05], [K.nj]: [6, 0.1, 0.04], [K.morris]: [1.3, 0.1, 0.04],
  [K.morrisComm]: [0.1, 0.2, 0.05], [K.us]: [28, 0.07, 0.04],
};
const GOVS = ["Cochise County", "City of Sierra Vista", "Sierra Vista Unified School District", "Fort Huachuca Accommodation Schools", "Cochise College District", "Palominas Elementary School District", "Hereford NRCD", "Cochise County Flood Control District", "Cochise County Library District", "Whetstone Fire District", "Naco Fire District"];

export function sampleGroupCounts(scope: string): readonly ChecklistGroupCount[] | null {
  const sc = SCALE[scope];
  if (!sc) return null;
  return Object.keys(PLACE_GROUPS).map((g) => {
    const x = BASE[g].map((v) => Math.round(v * sc[0]));
    const moved = Math.round(x[3] * sc[1]);
    x[0] += moved;
    x[3] -= moved;
    const pub = Math.round(x[3] * sc[2]);
    x[1] += pub;
    x[3] -= pub;
    return { group: g, name: PLACE_GROUPS[g], counts: x };
  });
}

function splitParts(text: string): string[] {
  return text.split(/;\s|,\s(?=and |or )|\s(?=before |unless |while )/).map((s) => s.trim()).filter(Boolean);
}

export function sampleItems(scope: string, defs: readonly Definition[]): readonly ChecklistItem[] | null {
  const subjects = scope === K.z85635 ? GOVS.map((g, i) => [g, i] as const) : scope === K.cochiseBos ? [["Cochise County", 0] as const] : scope === K.svCouncil ? [["City of Sierra Vista", 1] as const] : null;
  if (!subjects) return null;
  const mtg = defs.filter((d) => d.group === "MTG");
  const out: ChecklistItem[] = [];
  for (const [subject, gi] of subjects) {
    for (const d of mtg) {
      const n = d.id.slice(4);
      let status: ItemStatus = ["09", "11", "15"].includes(n) ? "needs-fix" : ["14", "17", "20"].includes(n) ? "unsure" : "can-do";
      if (gi < 2 && ["01", "02"].includes(n)) status = "collected";
      const [name, text] = d.requirement.includes(" — ") ? d.requirement.split(" — ") : [d.id, d.requirement];
      const partStatus = status === "needs-fix" ? ["Not possible yet", "warn"] : status === "unsure" ? ["Applies? Unknown", "muted"] : status === "collected" ? ["Evidence held, not proven", "warn"] : ["Not proven yet", "muted"];
      const emptyCase = d.id === "MTG-15" && gi < 2;
      out.push({
        key: `${d.id}|${gi}`,
        definitionId: d.id,
        name,
        subject,
        period: "Meetings in the next 90 days: Sep 28 – Dec 27, 2026",
        status,
        missing: { collected: "Pulling out and publishing. The saved files are waiting for the software that pulls out facts.", "can-do": "Not collected yet. The method exists, but no source has been read for this subject.", "needs-fix": "Our software can’t do this yet.", unsure: `Nobody has shown whether this applies to ${subject}.`, checked: "", published: "", absent: "" }[status],
        appliesBecause: status === "unsure" ? "Unknown. Evidence needed: whether this body holds these kinds of sessions." : `${subject} is a governing body with public meetings (reviewed Arizona registry).`,
        owner: { collected: "Collection engineering", "can-do": "Automatic (the workers)", "needs-fix": "Publishing engineering", unsure: "Automatic check of whether it applies", checked: "", published: "", absent: "" }[status],
        next: { collected: "Pulling out facts runs as soon as the saved-file fix is in use.", "can-do": "Runs in the normal line.", "needs-fix": "Waits for the software fix.", unsure: "An automatic check gathers evidence either way.", checked: "", published: "", absent: "" }[status],
        parts: splitParts(text).map((p, i) => ({
          text: p,
          status: emptyCase && i > 0 ? "Blocked" : partStatus[0],
          tone: (emptyCase && i > 0 ? "warn" : partStatus[1]) as "warn" | "muted",
          proof: emptyCase
            ? i === 0 ? `Saved ${gi === 0 ? "calendar feed" : "meeting list"} lists upcoming meetings. Nobody has compared pulled-out meetings against it yet.` : "Can’t be called empty: the saved files contain meetings. Proof needed: pulled-out meetings for the next 90 days."
            : "No proof recorded for this part yet.",
        })),
        resultId: gi === 0 ? "r-cochise-mtg" : gi === 1 ? "r-sv-mtg" : undefined,
        actions: status === "needs-fix" ? [

] : gi < 2 ? [

] : [

],
      });
    }
  }
  return out;
}

const SYS_COUNTS: Readonly<Record<string, readonly number[]>> = {
  GATE: [7, 2, 4, 1], ACQ: [3, 4, 13, 0], REC: [7, 6, 7, 0], PUB: [2, 9, 7, 0], SAFE: [0, 0, 8, 0], REF: [1, 2, 6, 1], EXE: [0, 0, 6, 0], PRL: [6, 0, 0, 0], ENG: [1, 0, 6, 0],
};

/* ----------------------------------------------------------------- fixes */

export const FIX_TITLES: Readonly<Record<string, string>> = {
  "MW-011": "We can’t yet confirm what readers actually see",
  "MW-013": "Costs can’t be split by place or result yet",
  "MW-027": "Learning isn’t tracked week by week yet",
  "MW-031": "The reason for using a stronger AI model isn’t saved",
  "MW-041": "Some provider bills aren’t read automatically",
  "MW-060": "Saved files can’t be read back to pull out facts",
  "MW-061": "County cards show bodies from the wrong county",
  "MW-062": "Some website layouts can’t be read yet",
  "MW-063": "Some AI charges were saved without a price",
  "MW-064": "The daily spending restriction is still active for the workers",
  "A-1": "The Marana schools calendar site keeps timing out",
};

function sampleFixes(w: SampleWorld) {
  const res: Record<string, string> = {
    "MW-011": "1 engineer (Publishing engineering)", "MW-013": "Not assigned yet", "MW-027": "Not assigned yet", "MW-031": "1 engineer, part time", "MW-041": "1 engineer, part time",
    "MW-060": "1 engineer (Collection engineering)", "MW-061": "1 engineer (Publishing engineering)", "MW-062": "Not assigned yet", "MW-063": "Not assigned yet",
    "MW-064": "Done by engineering. Waiting for the workers to restart.", "A-1": "1 worker slot, automatic repair",
  };
  const got: Record<string, Record<string, string>> = { "MW-060": { eng: "2 engineers: 1 on the code, 1 on tests and review" }, "A-1": { research: "3 worker slots, automatic repair", model: "Allowed to use Sonnet 5.5 when needed" } };
  for (const [id, opt] of Object.entries(w.focus)) res[id] = got[id]?.[opt] ?? "1 more engineer, starting after their current task";
  const tasks: Record<string, [string, number]> = { "MW-061": ["ET-12", 2], "MW-060": ["ET-13", 1], "MW-064": ["ET-14", 4] };
  for (const t of w.tasks) tasks[t.fixId] = [t.id, 0];
  const rank = (id: string) => (w.fixRank.includes(id) ? "Moved to the top" : "Normal order");
  const O: [string, OpenFix["tab"], string, string, string, readonly string[], OpenFix["origin"]][] = [
    ["A-1", "fixing", "Automatic repair", "The site has timed out for 3 days. The automatic repair is trying the district’s second calendar address and will switch to the county’s posted notices after 2 more failures.", "Marana schools’ meetings", ["i-marana"], "automatic"],
    ["MW-060", "fixing", "Collection engineering", "Files we already saved can’t be read back, so the facts in them never reach readers.", "2 local meeting lists in Arizona right now", ["i-cochise-held", "i-sv-held"], "engineering"],
    ["MW-061", "fixing", "Publishing engineering", "A county card is showing bodies from another county.", "Correct county cards everywhere", ["i-wrong"], "engineering"],
    ["MW-011", "fixing", "Publishing engineering", "We know what we published, but not whether each exact public card shows it.", "Accurate “checked on the public page” counts", [], "engineering"],
    ["MW-031", "fixing", "Operations engineering", "When a stronger AI model is used, the reason isn’t saved. Engineers are choosing where to store it.", "Reasons shown in Money", [], "engineering"],
    ["MW-041", "fixing", "Cost engineering", "Some provider bills have to be typed in by hand.", "Account totals without manual entry", [], "engineering"],
    ["MW-062", "attention", "Not assigned yet", "Some websites use a layout our software can’t read. Records are found, but the facts can’t be pulled out.", "3 stuck items in 2 states", ["i-pima", "i-avondale", "i-cassidy"], "engineering"],
    ["MW-063", "attention", "Not assigned yet", "Some AI charges were saved without a price, so the known cost is too low.", "A complete hunt cost", ["i-unpriced"], "engineering"],
    ["MW-013", "attention", "Not assigned yet", "Costs exist, but can’t be split by place or by result.", "Money by place, and cost per checked result", [], "engineering"],
    ["MW-027", "attention", "Not assigned yet", "Week-by-week learning isn’t recorded.", "Trends on Is it learning", [], "engineering"],
    ["MW-064", "update", "Operations engineering", "The removal you approved is released, but the workers haven’t restarted with it.", "Paid work runs all day within each hunt’s limit", [], "engineering"],
  ];
  const open: OpenFix[] = O.map(([id, tab, owner, problem, helps, linked, origin]) => ({
    id, title: FIX_TITLES[id], tab, owner, problem, helps, placeInLine: rank(id), resourcesNow: id in res ? res[id] : "Not assigned yet",
    taskStage: tasks[id]?.[1] ?? null, taskId: tasks[id]?.[0] ?? null, linkedStuck: linked, origin,
    technical: `${id}${tasks[id] ? ` · task ${tasks[id][0]}` : ""}${origin === "automatic" ? " · automatic repair, no code change" : ""}`,
  }));
  const D: [string, string, string, string, ClosedFix["origin"], string, string, string, string, string, string, string, string?][] = [
    ["Tucson Unified meetings showed the wrong time zone", "Meeting times are now read with Arizona’s time zone, which has no daylight saving.", "Pima County · Tucson readers", "2026-09-22T19:00:00.000Z", "Engineering fix", "Prevention tested", "A test now fails any meeting check that drops the time zone. The released version is in use by the workers.", "Exact Tucson Unified card rechecked Sep 22, 3:10 PM: times match the source.", "412 comparable meeting checks over the 6 days since: 0 wrong time zones.", "A time-zone check added to every meeting check", "All meeting checks in every state", "fix MW-052 · release r-0921 · test mtg-tz-regression"],
    ["Marana schools’ calendar moved to a new address", "The automatic repair found the new address and saved it as a route.", "Arizona · Marana readers", "2026-09-24T19:00:00.000Z", "Automatic repair", "Reused successfully on another job", "No code change. The route was saved to our route library.", "Exact Marana card rechecked Sep 24: meetings match.", "Sep 26: Amphitheater schools used the same kind of route and found its calendar on the first try, with no paid search.", "Route pattern: a school district moved its calendar to a vendor site", "Every search attempt for school boards", "route rt-5d7a4e0e · attempt da-77f1"],
    ["NH Executive Council agenda link was missing", "The agenda link was read from the page again and added.", "New Hampshire · statewide", "2026-09-26T19:00:00.000Z", "Automatic repair", "Fixed once", "Nothing was saved to prevent it happening again.", "Exact card checked Sep 27, 9:12 PM: the link works.", "No later attempts to compare yet.", "Nothing saved", "—", "reader version v2"],
    ["Pima County board PDFs wouldn’t open", "A reader for this kind of PDF was added.", "Pima County", "2026-09-20T19:00:00.000Z", "Engineering fix", "Prevention saved", "Released and in use by the workers.", "Exact Pima card rechecked Sep 20: agendas open.", "Not yet tried on another county’s PDFs, so reuse isn’t proven.", "PDF reading rule for this file type", "Any body whose agendas use this PDF type", "fix MW-048 · release r-0919"],
    ["Congress vote records appeared twice", "A duplicate check now runs before publishing.", "United States · every reader", "2026-09-18T19:00:00.000Z", "Engineering fix", "Prevention tested", "Released, in use, and covered by a test.", "Votes page rechecked Sep 18: no duplicates.", "5 refreshes since, with the same source: 0 duplicates.", "Duplicate check before publishing votes", "Every votes refresh", "fix MW-045 · test leg-dup-regression"],
    ["Morris County roster was read from the wrong table", "The automatic repair picked the table with the commissioners’ names.", "Morris County, NJ", "2026-09-23T19:00:00.000Z", "Automatic repair", "Not checked yet", "Nothing was saved yet.", "Exact card not rechecked yet.", "No later attempts to compare yet.", "Nothing saved", "—", "attempt da-5b20"],
    ["Candidate filing PDFs were missing their office name", "The office name is now read from the filing’s header block.", "New Hampshire · candidates", "2026-09-17T19:00:00.000Z", "Engineering fix", "Prevention saved", "Released and in use by the workers.", "Exact candidate card rechecked Sep 17: office names show.", "No other state’s filings tried yet.", "Header-block reading rule", "Candidate filing reads", "fix MW-043"],
  ];
  const mk = (x: (typeof D)[number], i: number): ClosedFix => ({
    id: `fx-${i}`, title: x[0], changed: x[1], places: x[2], fixedAt: x[3], origin: x[4], whatChanged: x[6], readerRecheck: x[7], since: x[8], saved: x[9], usedBy: x[10], technical: x[11], returnedDetail: x[12],
  });
  const closed = D.map(mk);
  const returned: ClosedFix[] = [mk(["Sierra Vista meeting list kept timing out", "Retries were spaced further apart.", "ZIP 85635 · Sierra Vista readers", "2026-09-21T19:00:00.000Z", "Automatic repair", "Problem returned", "No code change.", "Rechecked Sep 21: it worked then.", "Returned Sep 26: 2 of 5 later attempts timed out.", "Longer wait between retries", "This site only", "attempt da-3514d937", "The same timeout came back on Sep 26 and Sep 27. The page was saved on Sep 26 before it failed, so the saved copy is still usable once the saved-file fix is in use."], 99)];
  return { open, closed, returned };
}

/* ------------------------------------------------------------ everything */

export function buildSampleData(w: SampleWorld, defs: readonly Definition[], profileVersion: string, scope: string): AdminV6Data {
  const places = samplePlaces();
  const hunts = sampleHunts(w);
  const stuck = sampleStuck(w);
  const national = places.filter((p) => p.kind === "State").map((p) => {
    const inside = hunts.filter((h) => h.status !== "stopped" && (h.placeKey === p.key || places.find((x) => x.key === h.placeKey)?.within.some((k) => k === p.key || places.find((y) => y.key === k)?.within.includes(p.key))));
    const stuckHere = stuck.filter((i) => i.lane !== "auto" && i.applies.some((x) => x === p.key || places.find((y) => y.key === x)?.within.includes(p.key) || places.find((y) => y.key === x)?.within.some((k) => places.find((z) => z.key === k)?.within.includes(p.key))));
    const sc = SCALE[p.key];
    const total = sc ? Math.round(Object.values(BASE).reduce((s, r) => s + r.reduce((x, y) => x + y, 0), 0) * sc[0]) : null;
    return { placeKey: p.key, code: p.code!, name: p.name, hunts: inside.length, stuck: stuckHere.length, checklistItems: total, tracked: !!p.tracked };
  });
  const groups = [...new Set(defs.map((d) => d.group))];
  const systemGroups = groups.filter((g) => !PLACE_GROUPS[g]).map((g) => ({
    group: g,
    name: GROUP_NAMES[g] ?? g,
    counts: SYS_COUNTS[g] ?? null,
    audit: Object.fromEntries(defs.filter((d) => d.group === g).map((d) => [d.id, d.id in SAMPLE_AUDIT ? SAMPLE_AUDIT[d.id] : "No audit note in the sample."])),
  }));
  const f = sampleFixes(w);
  return {
    places: sample(places, SECTION_DEP.places, SAMPLE_AS_OF),
    hunts: sample(hunts, SECTION_DEP.hunts, SAMPLE_AS_OF),
    national: sample(national, SECTION_DEP.national, SAMPLE_AS_OF),
    results: sample(sampleResults(w), SECTION_DEP.results, SAMPLE_AS_OF),
    stuck: sample(stuck, SECTION_DEP.stuck, SAMPLE_AS_OF),
    sameCause: sample([
      { key: "fmt", cause: "Page formats we can’t read", lane: "software", count: "3", itemIds: ["i-pima", "i-avondale", "i-cassidy"],},
      { key: "held", cause: "Saved files that were never read", lane: "software", count: "2", itemIds: ["i-cochise-held", "i-sv-held"],},
      { key: "person", cause: "Automatic routes tried and failed", lane: "decision", count: "1", itemIds: ["i-davis"], action: a("decide", "davis") },
      { key: "retry", cause: "Retries repeating the same failure", lane: "auto", count: "319", itemIds: ["i-retry"],},
    ], SECTION_DEP.stuck, SAMPLE_AS_OF),
    agents: sample([], SECTION_DEP.agents, SAMPLE_AS_OF),
    sends: sample([], SECTION_DEP.sends, SAMPLE_AS_OF),
    reliability: sample([], SECTION_DEP.reliability, SAMPLE_AS_OF),
    publication: { state: "not-connected", load: "ready", data: null, asOf: null, dependency: SECTION_DEP.publication },
    spend: { state: "not-connected", load: "ready", data: null, asOf: null, dependency: SECTION_DEP.spend },
    history: sample(sampleHistory(), SECTION_DEP.history, SAMPLE_AS_OF),
    workers: sample({
      status: { lastCheckIn: "2026-09-28T06:53:12.000Z", lastUsefulProgress: { at: "2026-09-28T06:50:00.000Z", what: "New congressional vote records were ready to publish" }, roundStartedAt: "2026-09-28T06:39:00.000Z", lastRoundFinishedAt: "2026-09-28T06:38:00.000Z", nextRoundDueAt: null, runnerState: w.runnerPaused ? "PAUSED" : "ALIVE", lanes: null, unread: [] },
      jobs: sampleJobs(w),
      waiting: sampleWaiting(),
      events: sampleEvents(),
      update: { title: "The research workers need an update", checkedAt: "2026-09-28T06:53:00.000Z", what: "The website has the latest update, but the workers that collect, check and publish information are still using an older version. So your approved removal of the daily spending restriction isn’t active for them yet.", impact: "Paid research could still pause for the day after $105, even when a hunt has money left. $17.33 has been used in the last 24 hours, so nothing is paused right now.", owner: "Operations engineering", next: "The update is released. It starts working when the workers restart, and no restart is scheduled in the records we can see.", youNeedToAct: "No. If you want it sooner, focus more engineering time on it.", fixId: "MW-064", technical: ["Website version b12e5b5 · workers version a41c9e0 · 2 changes behind", "Current round #1 482, started 11:39 PM", "Engineering task ET-14 · fix MW-064", "No “apply update” button: no authorized operation for restarting workers exists yet"] },
      next: ["The 2 source-finding jobs save what they found, then pulling out facts starts.", "At 6:00 AM: the Arizona finance and Marana rechecks.", "When the next round starts isn’t reported yet, so no finish time is shown."],
    }, SECTION_DEP.workers, SAMPLE_AS_OF),
    checklist: sample({ profileVersion, definitionCount: defs.length, definitions: defs, groupNames: GROUP_NAMES, placeGroups: sampleGroupCounts(scope), items: sampleItems(scope, defs), systemGroups }, SECTION_DEP.checklistItems, SAMPLE_AS_OF),
    money: sample({
      account: [
        { provider: "Anthropic", amountUsd: 238.85, how: "Reported by Anthropic · our records show $202.57; the gap includes other users and delay" },
        { provider: "Neon", amountUsd: 220.86, how: "Worked out from usage at Launch plan prices · storage not included" },
        { provider: "GitHub", amountUsd: 87.67, how: "Reported by GitHub" },
        { provider: "Search (Exa, Brave)", amountUsd: 0.02, how: "Estimated from requests" },
        { provider: "MapTiler", amountUsd: 0, how: "Read: within plan, no overage" },
        { provider: "Netlify", amountUsd: null, how: "No billing reading. Unknown, not $0." },
      ],
      accountMonth: "September 2026",
      monthlyPlans: [{ name: "Claude subscription", note: "A flat monthly plan, shown apart from usage charges" }],
      limits: [
        { name: "Fleet · rolling 24 hours", figure: "$17.33 / $105.00", usedUsd: 17.33, limitUsd: 105, fraction: 17.33 / 105, note: "Approved for removal Sep 28 · the change is waiting for the workers to restart · still enforced at the last read, 11:39 PM", tone: "warn" },
        { name: "Anthropic account cap", figure: "Not read yet", usedUsd: null, limitUsd: null, fraction: null, note: "Needs a read from Anthropic", tone: "neutral" },
        { name: "Neon and GitHub caps", figure: "Not read yet", usedUsd: null, limitUsd: null, fraction: null, note: "Typed in by hand until this is automated", tone: "neutral" },
      ],
      reconciliation: null,
      readings: [],
      otherServices: "Search $0.01, estimated from requests. Hosting, database and GitHub are shared platform costs and aren’t assigned to hunts.",
    }, SECTION_DEP.money, SAMPLE_AS_OF),
    scoreboard: sample({
      rows: [
        { id: "Orders", name: "Orders", value: "12", counts: "9 done · 2 in progress · 1 could not be done", says: "The newest 12 orders. Could not be done: The place is not set up yet.", notMeasured: null },
        { id: "Public delivery", name: "Public delivery", value: "91%", counts: "410 of 450 accepted records seen on the public page", says: "Counts accepted records the page was checked for.", notMeasured: null },
        { id: "Shut doors", name: "Shut doors", value: "3", counts: "3 shut · 41 open · 2 set aside", says: "How many ways in are shut right now.", notMeasured: null },
        { id: "Facts live per hour", name: "Facts live per hour", value: null, counts: null, says: "Not measured yet.", notMeasured: "Counted in a later step." },
      ],
      byPlace: [], byFamily: [], missions: [],
      gates: null,
      readiness: [],
      learning: {
      trends: [
        { question: "What does it cost to find something?", big: "$0.11", bigNote: "per find this week, down from $1.46", series: [{ name: "Dollars per find", color: "blue" }], weeks: wk([[1.46], null, [1.0], [0.6], [0.11]]), format: "usd", max: 1.46, limits: "A find isn’t a delivered result yet.", method: dl("Paid research attempts that found a route into a site, or the record itself", "All tracked states", "Each week (UTC)", "Attempts that found something: 19, none recorded, 58, 164, 147", "Not directly. Each week looked for different records.") },
        { question: "Does it do better after a failure?", big: "92% vs 85%", bigNote: "found something this week: started from earlier notes vs from scratch", series: [{ name: "Started from earlier notes", color: "blue" }, { name: "Started from scratch", color: "amber" }], weeks: wk([[100, 100], null, [60, 46], [78, 96], [92, 85]]), format: "pct", max: 100, limits: "Since Sep 4, both groups are at 79%.", method: dl("Search attempts that found something, split by whether they started from an earlier attempt’s notes", "All tracked states", "Each week (UTC)", "This week: 100 from notes, 65 from scratch", "Only roughly. The two groups looked for different records.") },
        { question: "Does it reuse routes it already learned?", big: "60%", bigNote: "of search attempts used a route they were given", series: [{ name: "Used a saved route", color: "teal" }], weeks: wk([null, null, null, [18], [60]]), format: "pct", max: 100, limits: "70 attempts rebuilt a route we already had.", method: dl("Search attempts that used a route into a site that earlier attempts had saved", "All tracked states", "Each week (UTC)", "Attempts given at least one saved route: 11 last week, 165 this week", "No. The kind of work changed a lot.") },
      ],
      readings: [
        { question: "How long from the source to the reader?", big: "5 h 12 m", bigNote: "one NH meeting", body: "Posted 4:00 PM, saved 4:20, checked 4:31, published 4:32, seen on the page 9:12 PM. Most of the wait came after publishing.", method: dl("Time from the source posting it to a reader-page check", "One result", "Sep 26–27", "1 result with both times recorded", "It’s one example, not a typical time") },
        { question: "Do blocked sites come back on their own?", big: "8 of 14", bigNote: "recovered without anyone acting", body: "Covers routine meeting reads over one 7-day window. Other kinds of repair aren’t measured.", method: dl("Bodies that failed at least once, then worked later", "All tracked states", "Last 7 days", "14 bodies that failed at least once", "One reading only") },
        { question: "Is it using the most expensive AI less?", big: "2,240 of 2,412", bigNote: "September charges were on the strongest model", body: "Since Sep 25, work starts on the cheapest model (Haiku 4.5). 7 of 176 attempts that recorded their steps moved up.", method: dl("AI charges by model", "All tracked states", "September 2026", "All 2,412 AI charges", "No. The starting model changed on Sep 25.") },
      ],
      notMeasured: [
        { question: "What does each checked public result cost?", why: "Costs aren’t linked to reader-page checks yet.", needs: "Reader proof and cost by result" },
        { question: "How much repeated work was avoided?", why: "Reuse is recorded, but not whether it replaced a paid call. No saving is claimed.", needs: "Learning over time" },
        { question: "Do hard-to-read places become routine?", why: "Each place’s recent reads are saved, but nothing adds them up over time.", needs: "Learning over time" },
      ],
      },
    }, SECTION_DEP.scoreboard, SAMPLE_AS_OF),
    fixes: sample(f, SECTION_DEP.fixes, SAMPLE_AS_OF),
  };
}

function wk(v: readonly (readonly number[] | null)[]) {
  const weeks = ["Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28"];
  return weeks.map((week, i) => ({ week, values: v[i] }));
}
function dl(a1: string, b: string, c: string, d: string, e: string) {
  return [{ k: "What’s counted", v: a1 }, { k: "Where", v: b }, { k: "Time period", v: c }, { k: "Counted out of", v: d }, { k: "Fair to compare weeks?", v: e }];
}

function receipt(p: Partial<UiReceipt> & Pick<UiReceipt, "key" | "kind" | "target" | "targetName" | "label" | "scopeKey" | "scopeName" | "status" | "statusWords" | "says" | "sentAt">): UiReceipt {
  return { level: "local", steps: [], items: [], lifecycle: EMPTY_LIFECYCLE, simulated: true, gatewayType: null, gatewayReceiptId: null, readBackAt: null, replayed: false, ...p };
}

function sampleHistory(): readonly UiReceipt[] {
  return [
    receipt({ key: "rc-3", kind: "send-agents", target: "r-congress", targetName: "Members of Congress directory", label: "Check the public page now", scopeKey: K.us, scopeName: "United States", status: "unknown", statusWords: "Result unknown", says: "The checker didn’t answer within 30 seconds. It may still have run. Check what happened before trying again.", sentAt: "2026-09-28T06:20:00.000Z", steps: [{ label: "Sent", at: "2026-09-28T06:20:00.000Z" }, { label: "Read by the workers", at: "2026-09-28T06:20:05.000Z" }, { label: "No clear answer", at: "2026-09-28T06:21:00.000Z" }] }),
    receipt({ key: "rc-2", kind: "decide", target: "ceiling", targetName: "$105 rolling 24-hour ceiling", label: "Decide: remove it", scopeKey: K.us, scopeName: "Whole system", level: "global", status: "done", statusWords: "Decision saved — change pending", says: "Approved: remove it. The change is released but waiting for the workers to restart. The ceiling stays in force until then.", sentAt: "2026-09-28T07:05:00.000Z", steps: [{ label: "Sent", at: "2026-09-28T07:05:00.000Z" }, { label: "Saved", at: "2026-09-28T07:05:01.000Z" }], lifecycle: { ...EMPTY_LIFECYCLE, saved: "2026-09-28T07:05:01.000Z" } }),
    receipt({ key: "rc-1", kind: "hunt-start", target: K.z85635, targetName: "ZIP 85635", label: "Start a hunt here", scopeKey: K.z85635, scopeName: "ZIP 85635 · Sierra Vista", status: "done", statusWords: "Hunt started", says: "Hunt started. The workers created 62 of 65 required items for 11 governments and moved 132 existing items first. Done means the hunt started, not that it’s finished.", sentAt: "2026-09-27T22:17:00.000Z", steps: [{ label: "Sent", at: "2026-09-27T22:17:00.000Z" }, { label: "Read by the workers", at: "2026-09-28T06:39:00.000Z" }, { label: "Running", at: "2026-09-28T06:39:10.000Z" }, { label: "Done", at: "2026-09-28T06:39:30.000Z" }], lifecycle: { ...EMPTY_LIFECYCLE, saved: "2026-09-27T22:17:00.000Z", workersReceived: "2026-09-28T06:39:00.000Z", workStarted: "2026-09-28T06:39:10.000Z" } }),
  ];
}

/* --------------------------------------------------------------- outcomes */

export interface SampleOutcome {
  readonly final: Exclude<ReceiptStatus, "queued" | "read" | "running">;
  readonly says: string;
  readonly items?: readonly ReceiptItem[];
  readonly statusWords?: string;
  readonly effect?: (w: SampleWorld) => SampleWorld;
}

/** The natural result of each control against the sample world. */
export function sampleOutcome(kind: ActionKind, target: string, input: { readonly option: string | null; readonly words: string; readonly amount: string; readonly selected: readonly string[] }, ctx: { readonly names: (id: string) => string }): SampleOutcome {
  const { option, words, amount } = input;
  switch (kind) {
    case "decide": {
      if (option === "outreach") return { final: "refused", says: "Refused: outreach isn’t authorized for this account. Nothing was sent. Ask for outreach permission, or choose another option." };
      const label = option === "other" ? `“${words.trim()}”` : ({ route: "look for another route", absent: "record as not available", clerk: "trust the clerk’s list", roster: "trust the roster", both: "show both dates", third: "look for a third source" } as Record<string, string>)[option ?? ""] ?? "recorded";
      return { final: "done", statusWords: "Decision saved — change pending", says: `Decision saved: ${label}. Carrying it out is a separate step, shown on the item.`, effect: (w) => ({ ...w, decisions: { ...w.decisions, [target]: label } }) };
    }
    case "global-ceiling": return { final: "done", statusWords: "Daily budget saved", says: "Sample preview: the daily budget was set. Nothing real was sent.", effect: (w) => w };
    case "global-search-on":
    case "global-search-off": return { final: "done", statusWords: "Paid search setting saved", says: "Sample preview: the paid search setting was saved. Nothing real was sent.", effect: (w) => w };
    case "global-paid-resume": return { final: "done", statusWords: "Paid research resumed", says: "Sample preview: paid research may run again. Nothing real was sent.", effect: (w) => w };
    case "hunt-start-many": return { final: "done", statusWords: "Hunts started", says: "Sample preview: the hunts were started. Nothing real was sent.", effect: (w) => w };
    case "hunt-start": return { final: "done", statusWords: "Hunt started", says: "Hunt started. The workers created its checklist work. Nothing is delivered yet. Results appear as they land.", effect: (w) => ({ ...w, hunts: { ...w.hunts, [target]: { id: `hunt-${target.split(".").pop()}`, placeKey: target, name: `${ctx.names(target)} hunt`, startedAt: new Date().toISOString(), limitUsd: Number(amount) || 25, limitSource: "your instruction just now", spentUsd: 0, heldUsd: 0, unpricedEntries: 0, status: "running", researchWorkers: 0 } } }) };
    case "hunt-pause": return { final: "done", says: "Paused. Calls already running finished and were charged.", effect: (w) => ({ ...w, hunts: { ...w.hunts, [target]: { ...(w.hunts[target] ?? {}), status: "paused" } } }) };
    case "hunt-resume": return { final: "done", says: "Resumed.", effect: (w) => ({ ...w, hunts: { ...w.hunts, [target]: { ...(w.hunts[target] ?? {}), status: "running" } } }) };
    case "hunt-limit": return { final: "done", says: "The new limit is saved. Spending so far is unchanged.", effect: (w) => ({ ...w, hunts: { ...w.hunts, [target]: { ...(w.hunts[target] ?? {}), limitUsd: Number(amount) } } }) };
    case "hunt-stop": return { final: "done", says: "Stopped. Money set aside but not used was returned.", effect: (w) => ({ ...w, hunts: { ...w.hunts, [target]: { ...(w.hunts[target] ?? {}), status: "stopped", heldUsd: 0 } } }) };
    case "global-paid": return { final: "done", says: "Saved. Paid research pauses everywhere at the start of the next round.", effect: (w) => ({ ...w, paidPaused: !w.paidPaused }) };
    case "global-runner-pause": return { final: "done", statusWords: "Pause saved", says: "Pause saved. The workers stop after the round they are in.", effect: (w) => ({ ...w, runnerPaused: true }) };
    case "global-runner-resume": return { final: "done", statusWords: "Saved", says: "Saved. The workers may start rounds again.", effect: (w) => ({ ...w, runnerPaused: false }) };
    case "cancel-send":
      return { final: "done", statusWords: "Requested", says: "Your request to take it back is saved. It stays a request until the runner records it." };
    case "order-schedule":
      return {final:"done",statusWords:"Scheduled",says:"Sample preview: the order is scheduled. Nothing real was sent."};
    case "owed-add":
    case "owed-decline":
    case "owed-undo":
      return { final: "done", statusWords: "Saved", says: "Sample preview: the change to what is owed is saved with its reason." };
    case "order-unschedule":
      return { final: "done", statusWords: "Cancelled", says: "Sample preview: the scheduled order is cancelled and will not be sent." };
    case "target-set":
    case "target-clear":
      return { final: "done", statusWords: "Saved", says: "Sample preview: the target is saved. The runner reads it on its next round." };
    case "data-switch-on":
    case "data-switch-off":
      return { final: "done", statusWords: "Saved", says: "Sample preview: the switch is saved. It takes effect on the next read." };
    case "setting-set":
    case "setting-undo":
      return { final: "done", statusWords: "Saved", says: "Sample preview: the setting is saved with its earlier value." };
    case "send-agents":
      return { final: "done", statusWords: "Sent", says: "The fleet was told where to go. The runner puts it first on its next round." };
    default:
      return { final: "refused", says: "This control is not available yet." };
  }
}

/** What "Check what happened" finds in the sample: the earlier send had finished. */
export function sampleCheck(_kind: ActionKind): SampleOutcome {
  return { final: "done", says: "Checked: it had finished. Nothing was sent twice." };
}

/** Item-state reasons in the sample world (rule 5 of the eligibility order). */
export function sampleItemState(w: SampleWorld, kind: ActionKind, target: string, extra: { readonly hunts: readonly Hunt[]; readonly placeKind: string | null }): string | null {
  if (kind === "hunt-start") {
    if (extra.placeKind === "Country" || extra.placeKind === null) return "Choose a state, county, ZIP or body. A nationwide hunt isn’t offered.";
    const h = extra.hunts.find((x) => x.placeKey === target && x.status !== "stopped");
    if (h) return `A hunt is already running here (${h.name}). Change it on its card.`;
  }
  if (kind === "decide" && w.decisions[target]) return `Decided: ${w.decisions[target]}.`;
  if (kind === "global-runner-pause" && w.runnerPaused) return "The workers are already paused.";
  if (kind === "global-runner-resume" && !w.runnerPaused) return "The workers aren’t paused.";
  if (["hunt-pause", "hunt-resume", "hunt-limit", "hunt-stop"].includes(kind)) {
    const h = extra.hunts.find((x) => x.placeKey === target);
    if (h?.status === "stopped") return "This hunt is stopped.";
    if (kind === "hunt-pause" && h?.status === "paused") return "Paid work is already paused.";
    if (kind === "hunt-resume" && h?.status === "running") return "Paid work is already on.";
  }
  return null;
}
