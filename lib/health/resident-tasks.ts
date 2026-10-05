/**
 * **FE-18 · RESIDENT TASKS RUN ON THE LIVE SITE.**
 *
 * Each task in `data/health/resident-tasks.json` (FE-17) is a plain-word goal
 * ("find when my council meets and how to comment"). This file turns each one
 * into scripted taps a resident would make and the things the page must then
 * show, judged in the reader's terms. The browser pass that drives them is
 * `scripts/resident-tasks.mts`; it runs at ZIPs sampled from the published
 * places (a newly published place's ZIPs first), on a phone and a desktop.
 *
 * Scripted, not model-driven: every step names what a resident would tap by
 * its words on the page and the row it sits in, never by a place. Nothing here
 * costs a model call except the Ask tasks, which go through Ask itself under
 * its own spending controls.
 *
 * A task PASSES when every tap found its target, the page then showed every
 * required thing, and the taps stayed within the task's tap budget. Anything
 * else FAILS and says why: the dead end (the thing a resident could not find
 * or could not tap), the things the page never showed, or the taps over
 * budget. The slowest step (action to usable result) is recorded with each
 * run; FE-02 judges speed against three seconds.
 *
 * PURE: the scripts, the ZIP choice, the verdict and Admin's reading.
 */
import { GROUNDED_MODES } from "./ask-evaluation.ts";
import { SPEED_BUDGET_MS, SPEED_PROFILES, sampleZips, type SpeedProfile } from "./worst-case-speed.ts";

export const TASK_PROFILES = SPEED_PROFILES;
export type TaskProfile = SpeedProfile;

export interface ResidentTask {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly success: string;
  readonly tapBudget: number;
  readonly question?: string;
}

export interface ResidentTaskFile {
  readonly surfaces: readonly string[];
  readonly tasks: readonly ResidentTask[];
}

/**
 * Something a resident taps. `css` narrows to the kind of control; `name` is
 * the words on it (a regular expression, case-insensitive); `near` is what its
 * own row must also say (e.g. the body type under a body's name). The first
 * finder in a step that finds a visible target wins.
 */
export interface Finder {
  readonly says: string;
  readonly css: string;
  readonly name?: string;
  readonly near?: string;
  /** Skip targets that read as concluded or canceled. */
  readonly upcoming?: boolean;
}

export type TaskStep =
  /** One tap. An optional tap is made only when its target is on screen (the phone's bottom sheet), and counts only then. */
  | { readonly kind: "tap"; readonly finders: readonly Finder[]; readonly optional?: boolean }
  /** Open Ask and send the task's question: two taps. */
  | { readonly kind: "ask" };

/** One thing the page must show, read inside the scope the task ends in. */
export interface TaskCheck {
  readonly says: string;
  /** A regular expression (case-insensitive) the scope's text must match. */
  readonly text?: string;
  /** A selector that must match inside the scope. Either this or `text` meets the check. */
  readonly css?: string;
  /** Look for `css` anywhere on the page (a map pin is on the map, not in the card). */
  readonly anywhere?: boolean;
  /** Also met when the scope says plainly that this is still being gathered. */
  readonly orGathering?: boolean;
  /** With `orGathering`: the words of this part's own heading; the "still being gathered" line must be on that line or the next, so one part's gap never answers for another. */
  readonly part?: string;
}

export interface TaskScript {
  readonly steps: readonly TaskStep[];
  /** Where the result is read: the open card, Ask's answer, or the page. The last match on the page wins (the card on top). */
  readonly scope: string;
  readonly checks: readonly TaskCheck[];
}

/* ---------------------------------------------------------------- words */

const DAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \\d{1,2}";
const LONG_DATE = "(?:January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}";
export const WORDS = {
  date: `${DAY}|${LONG_DATE}|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b`,
  time: "\\b\\d{1,2}(?::\\d{2})?\\s?[ap]\\.?m\\b",
  address: "\\b\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z0-9][A-Za-z0-9.' -]{0,40}\\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ct|Court|Ter|Terrace|Cir|Circle|Sq|Square|Pike|Trl|Trail|Route|Rte|Turnpike|Tpke)\\b",
  attendOrComment: "make your voice heard|public comment|comments? (?:may|can|will|are)|e-?comment|how to (?:attend|comment|speak|participate|watch|join)|call to the (?:audience|public)|join (?:online|by phone|the meeting|via|on)|zoom|teams meeting|webex|livestream|live stream|watch (?:live|online)|attend (?:in person|online|virtually|remotely)|online only|in person|sign up to speak|speak at the meeting|public participation|public hearing",
  agenda: "\\bagenda\\b",
  results: "\\bminutes\\b|\\bresults?\\b|\\boutcome\\b|\\b(?:passed|approved|adopted|failed|carried|denied|rejected|tabled)\\b|\\bvotes?\\b",
  voteOutcome: "\\b(?:passed|failed|adopted|approved|carried|denied|rejected|tabled)\\b|\\b(?:yes|no|aye|nay|yea)\\b|voted (?:for|against)",
  vote: "\\bvot(?:e|es|ed|ing)\\b|roll call",
  money: "\\$\\s?\\d[\\d,.]*",
  funding: "fund|raised|contribut|donor|donat",
  hours: "\\bhours\\b|\\bopen\\b.{0,40}\\b\\d{1,2}(?::\\d{2})?\\s?[ap]\\.?m|\\b\\d{1,2}(?::\\d{2})?\\s?[ap]\\.?m\\.?\\s?(?:-|–|to)\\s?\\d",
  contact: "\\(\\d{3}\\)\\s?\\d{3}-\\d{4}|\\b\\d{3}[-.]\\d{3}[-.]\\d{4}\\b|@[a-z0-9-]+\\.[a-z]{2,}|\\bphone\\b|\\bemail\\b|contact form|\\bwebsite\\b|official site",
  source: "\\bsources?\\b|sourced from|published by|from the .{1,80}(?:site|timeline|record|filing)|\\bread (?:on )?(?:\\w+ \\d|\\d{4}-\\d{2}-\\d{2})",
  housing: "housing|\\brent\\b|homeless|zoning|afford",
  plainMeasure: "\\byes\\b.{0,200}\\bno\\b|\\bno\\b.{0,200}\\byes\\b",
  contest: "vote for \\d|proposition|\\bmeasure\\b|\\bcontests?\\b|\\bfor (?:governor|senate|house|council|mayor|board)",
  registration: "regist",
  votingDeadline: "election day|early voting|vote by|polls (?:open|close)|ballots? (?:must|due)",
  pollingPlace: "polling place|vote center|voting location|where (?:can I|to) vote|polling location|drop box",
  /** A plain statement that a part is still being gathered (the reader copy for an uncovered section). */
  gathering: "working on getting this info|still being gathered|still gathering|being gathered|we don.t have this yet|not yet (?:published|available|collected)",
} as const;

const DIRECTIONS = "a[href*='maps/dir'], a[href*='google.com/maps'], a[href*='maps.apple.com'], a[href*='bing.com/maps']";
const PIN = ".wtp-pin, .maplibregl-marker";
const CARD = ".mw-card";
const ASK_ANSWER = "[data-ask-panel]";
/** An answer from our records: a grounded mode (never the general-knowledge fallback), a destination or the bodies list. */
const ASK_GROUNDED = [...GROUNDED_MODES.map((m) => `[data-ask-grounded-mode='${m}']`), "[data-ask-destination]", "[data-ask-answer-bodies]"].join(", ");

/* -------------------------------------------------------------- finders */

/** On a phone the stat cards sit in the bottom sheet; a desktop shows them without it. */
const OPEN_SHEET: TaskStep = { kind: "tap", optional: true, finders: [{ says: "Meetings, filters and more", css: "button.mw-sheet-handle" }] };
const WHO_GOVERNS: TaskStep = { kind: "tap", finders: [{ says: "Who governs here?", css: "button", name: "^\\s*who governs here\\?\\s*$" }] };
const MUNICIPAL = "MUNICIPAL|\\bCITY\\b|\\bTOWN\\b|TOWNSHIP|BOROUGH|VILLAGE";
const LOCAL_GOVERNMENT: TaskStep = {
  kind: "tap",
  finders: [
    { says: "the city or town government", css: "button.cursor-pointer", near: MUNICIPAL },
    { says: "the county government", css: "button.cursor-pointer", near: "\\bCOUNTY\\b" },
  ],
};
const SECTION = (says: string, name: string): TaskStep => ({ kind: "tap", finders: [{ says, css: "button.card-section-header", name }] });
const OFFICIALS_LIST: TaskStep = { kind: "tap", finders: [{ says: "the officials list", css: "button.stat-card", name: "officials" }] };
const FIRST_OFFICIAL: TaskStep = { kind: "tap", finders: [{ says: "an official's name", css: "button.cursor-pointer", name: "→" }] };
const MEETINGS_LIST: TaskStep = {
  kind: "tap",
  finders: [
    { says: "the meetings count on the map", css: "button.count-badge", name: "meetings" },
    { says: "the meetings list", css: "button.stat-card", name: "meetings" },
  ],
};
const FIRST_GROUP: TaskStep = { kind: "tap", optional: true, finders: [{ says: "the first group of meetings", css: "button.al-group-head", name: "^\\s*▸" }] };

/* -------------------------------------------------------------- scripts */

const ask = (checks: TaskCheck[]): TaskScript => ({
  steps: [{ kind: "ask" }],
  scope: ASK_ANSWER,
  checks: [
    { says: "an answer from our records, not a refusal", css: ASK_GROUNDED },
    ...checks,
    { says: "its source", css: "[data-ask-sources]:not([data-ask-sources='0']), a[href^='http']" },
  ],
});

export const TASK_SCRIPTS: Readonly<Record<string, TaskScript>> = {
  "council-meeting-and-comment": {
    steps: [WHO_GOVERNS, LOCAL_GOVERNMENT, SECTION("the body's meetings", "^\\s*meetings")],
    scope: CARD,
    checks: [
      { says: "the next meeting's date", text: WORDS.date },
      { says: "its time", text: WORDS.time },
      { says: "where it is held", css: DIRECTIONS },
      { says: "how to attend or comment", text: WORDS.attendOrComment },
      { says: "the source", text: WORDS.source },
    ],
  },
  "mayor-vote": {
    steps: [
      WHO_GOVERNS, LOCAL_GOVERNMENT, SECTION("who sits on it", "^\\s*who sits on it"),
      { kind: "tap", finders: [{ says: "the mayor", css: "button.cursor-pointer", near: "\\bMAYOR\\b|FIRST SELECTMAN|SELECT ?BOARD CHAIR|\\bCHAIR(?:MAN|WOMAN|PERSON)?\\b" }] },
    ],
    scope: CARD,
    checks: [
      { says: "the mayor's name", text: "mayor|selectman|chair" },
      { says: "a recent vote", text: WORDS.vote },
      { says: "how the vote turned out", text: WORDS.voteOutcome },
      { says: "the source", text: WORDS.source },
    ],
  },
  "school-district-office-directions": {
    steps: [
      WHO_GOVERNS,
      { kind: "tap", finders: [{ says: "the school district", css: "button.cursor-pointer", near: "SCHOOL DISTRICT|\\bSCHOOLS?\\b" }] },
      SECTION("its contact details", "^\\s*contact"),
    ],
    scope: CARD,
    checks: [
      { says: "the office address", text: WORDS.address },
      { says: "a map pin for it", css: PIN, anywhere: true },
      { says: "a way to get directions", css: DIRECTIONS },
    ],
  },
  "ask-school-district-office": ask([
    { says: "an address", text: WORDS.address },
    { says: "directions", css: DIRECTIONS },
    { says: "its hours", text: WORDS.hours, orGathering: true },
  ]),
  "ask-next-council-meeting": ask([
    { says: "the next meeting date", text: WORDS.date },
    { says: "its agenda items", text: WORDS.agenda, orGathering: true },
  ]),
  "ask-mayor-votes": ask([
    { says: "the mayor's votes", text: WORDS.vote, orGathering: true },
    { says: "how each turned out", text: WORDS.voteOutcome, orGathering: true },
  ]),
  "ask-state-house-candidates": ask([
    { says: "the candidates for the seat", text: "candidate|running|\\b(?:Democratic|Republican|Independent|Libertarian|Green)\\b" },
    { says: "what each says about housing", text: WORDS.housing, orGathering: true },
  ]),
  "ask-congress-funders": ask([
    { says: "the biggest funders with amounts", text: WORDS.money, orGathering: true },
  ]),
  "ask-ballot-measure": ask([
    { says: "what the measure does", text: "measure|proposition|would|ballot question" },
    { says: "what a yes vote and a no vote each mean", text: WORDS.plainMeasure },
  ]),
  "official-portrait-and-contacts": {
    steps: [OPEN_SHEET, OFFICIALS_LIST, FIRST_OFFICIAL],
    scope: CARD,
    checks: [
      { says: "their portrait", css: "img" },
      { says: "a way to reach them", text: WORDS.contact },
      { says: "the source", text: WORDS.source },
    ],
  },
  "official-votes-and-money": {
    steps: [OPEN_SHEET, OFFICIALS_LIST, FIRST_OFFICIAL],
    scope: CARD,
    checks: [
      { says: "recent votes with outcomes", text: `${WORDS.voteOutcome}`, orGathering: true, part: "positions|votes|voting record" },
      { says: "their funding", text: `${WORDS.money}|${WORDS.funding}`, orGathering: true, part: "campaign money|funding|donors|contributions" },
      { says: "the source", text: WORDS.source },
    ],
  },
  "office-pin-with-directions": {
    steps: [{ kind: "tap", finders: [{ says: "an office pin on the map", css: PIN }] }],
    scope: `${CARD}, .maplibregl-popup`,
    checks: [
      { says: "the office address", text: WORDS.address },
      { says: "a directions link", css: DIRECTIONS },
    ],
  },
  "meeting-attend-or-comment": {
    steps: [MEETINGS_LIST, FIRST_GROUP, { kind: "tap", finders: [{ says: "an upcoming meeting", css: "button.al-row", upcoming: true }] }],
    scope: CARD,
    checks: [
      { says: "its agenda", text: WORDS.agenda, css: "a[href*='agenda' i]" },
      { says: "how to attend or comment", text: WORDS.attendOrComment },
    ],
  },
  "past-meeting-results": {
    steps: [MEETINGS_LIST, FIRST_GROUP, { kind: "tap", finders: [{ says: "a concluded meeting", css: "button.al-row", name: "concluded" }] }],
    scope: CARD,
    checks: [{ says: "its results", text: WORDS.results }],
  },
  "ballot-in-plain-english": {
    steps: [],
    scope: "main",
    checks: [
      { says: "the contests", text: WORDS.contest },
      { says: "the registration deadline", text: WORDS.registration },
      { says: "the voting deadlines", text: WORDS.votingDeadline },
      { says: "a way to find the polling place", text: WORDS.pollingPlace },
    ],
  },
};

/** What says the page each start surface opens on is ready to be tapped. */
export function readySelector(start: string): string {
  return start === "ballot" ? "main h1" : "button.ask-pill, button.mw-nav-seg";
}

/** Whether `text` meets a check by saying plainly that its part is still being gathered. */
export function saysGathering(text: string, check: Pick<TaskCheck, "orGathering" | "part">): boolean {
  if (!check.orGathering) return false;
  return check.part
    ? new RegExp(`(?:${check.part})[^\\n]{0,80}(?:\\n[^\\n]{0,80})?(?:${WORDS.gathering})`, "i").test(text)
    : new RegExp(WORDS.gathering, "i").test(text);
}

/** The page each start surface opens on. */
export function startPath(start: string, zip: string): string {
  return start === "ballot" ? `/ballot?zip=${zip}` : `/?zip=${zip}`;
}

/* ------------------------------------------------------------- the runs */

export interface TaskStepRecord {
  /** What was tapped, in the resident's words. */
  readonly says: string;
  /** Action to usable result, on the browser's clock. */
  readonly ms: number | null;
  /** The screenshot's key in the image store; null when it could not be stored. */
  readonly shot: string | null;
  /** Page-measurement issues on this screen (FE-16), by kind. */
  readonly issues: Readonly<Record<string, number>>;
}

export interface TaskRunInput {
  readonly taskId: string;
  readonly zip: string;
  readonly profile: TaskProfile;
  readonly steps: readonly TaskStepRecord[];
  readonly taps: number;
  /** What a resident could not find or tap; null when every tap landed. */
  readonly deadEnd: string | null;
  /** The checks the final screen did not meet. */
  readonly missing: readonly string[];
}

export interface TaskRun extends TaskRunInput {
  readonly title: string;
  readonly tapBudget: number;
  readonly worstMs: number | null;
  readonly verdict: "PASS" | "FAIL";
  readonly says: string;
}

export interface TaskPass {
  readonly at: string;
  readonly runId: string;
  readonly zips: readonly string[];
  /** ZIPs of newly published places, run first. */
  readonly queued: readonly string[];
  readonly runs: readonly TaskRun[];
  readonly passed: number;
  readonly failed: number;
}

/** Which tasks run where: every task at every ZIP on both profiles; Ask tasks only at the first `askZips` ZIPs, on a phone. */
export function taskTargets(tasks: readonly ResidentTask[], zips: readonly string[], askZips: number): { task: ResidentTask; zip: string; profile: TaskProfile }[] {
  const profiles = Object.keys(TASK_PROFILES) as TaskProfile[];
  return zips.flatMap((zip, i) => tasks.flatMap((task) => {
    if (!TASK_SCRIPTS[task.id]) return [];
    if (task.start === "ask") return i < askZips ? [{ task, zip, profile: "phone" as const }] : [];
    return profiles.map((profile) => ({ task, zip, profile }));
  }));
}

/**
 * The ZIPs for one pass: every published ZIP never run before comes first
 * (a newly published place is queued for its first run), then the day's
 * rotating sample of the rest, up to `count` (queued ZIPs are never dropped).
 */
export function chooseTaskZips(published: readonly string[], everRun: ReadonlySet<string>, count: number, now: string): { zips: string[]; queued: string[] } {
  const queued = [...new Set(published)].filter((zip) => !everRun.has(zip)).sort();
  const rest = sampleZips(published.filter((zip) => !queued.includes(zip)), Math.max(0, count - queued.length), now);
  return { zips: [...queued, ...rest], queued };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;
const list = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The verdict for one run, in plain words. */
export function judgeTask(task: ResidentTask, input: TaskRunInput): TaskRun {
  const finished = input.steps.flatMap((s) => (s.ms === null ? [] : [s.ms]));
  const worstMs = finished.length > 0 ? Math.max(...finished) : null;
  const overBudget = input.taps > task.tapBudget;
  const verdict = input.deadEnd === null && input.missing.length === 0 && !overBudget ? "PASS" : "FAIL";
  const where = `at ${input.zip} on a ${input.profile}`;
  const speed = worstMs === null ? "" : `; slowest step ${secs(worstMs)}${worstMs > SPEED_BUDGET_MS ? ", over three seconds" : ""}`;
  const taps = `${input.taps} tap${input.taps === 1 ? "" : "s"}`;
  const says = input.deadEnd !== null
    ? `${task.title} ${where}: dead end after ${taps}: ${input.deadEnd}.`
    : input.missing.length > 0
      ? `${task.title} ${where}: after ${taps} the page did not show ${list(input.missing)}${speed}.`
      : overBudget
        ? `${task.title} ${where}: done, but it took ${taps}, over the ${task.tapBudget}-tap budget${speed}.`
        : `${task.title} ${where}: done in ${taps}${speed}.`;
  return { ...input, title: task.title, tapBudget: task.tapBudget, worstMs, verdict, says };
}

export function taskPass(runs: readonly TaskRun[], at: string, runId: string, queued: readonly string[]): TaskPass {
  return {
    at, runId, queued: [...queued],
    zips: [...new Set(runs.map((r) => r.zip))].sort(),
    runs,
    passed: runs.filter((r) => r.verdict === "PASS").length,
    failed: runs.filter((r) => r.verdict === "FAIL").length,
  };
}

/** Where a step's screenshot is kept in the image store. Only plain path parts, so the Admin image route can serve it. */
export function shotKey(at: string, runId: string, taskId: string, zip: string, profile: TaskProfile, step: number): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `resident-tasks/${at.slice(0, 10)}/${safe(runId)}/${safe(taskId)}-${safe(zip)}-${profile}-${step}.png`;
}

/* --------------------------------------------------------- Admin's view */

export interface TaskRowView {
  readonly task: string;
  readonly zip: string;
  readonly device: string;
  readonly result: "Passed" | "Failed";
  readonly says: string;
  /** The step-by-step screenshot strip, in order. */
  readonly strip: readonly { readonly says: string; readonly image: string | null; readonly took: string }[];
}

export interface TaskPassView {
  readonly ran: string;
  readonly summary: string;
  readonly rows: readonly TaskRowView[];
}

/** Plain English for Admin: one row per task run, failures first, each with its screenshot strip. */
export function residentTaskView(pass: TaskPass | null, imageUrl: (key: string) => string): TaskPassView | null {
  if (!pass) return null;
  const rows = [...pass.runs]
    .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "FAIL" ? -1 : 1))
    .map((run): TaskRowView => ({
      task: run.title,
      zip: run.zip,
      device: run.profile === "phone" ? "Phone" : "Desktop",
      result: run.verdict === "PASS" ? "Passed" : "Failed",
      says: run.says,
      strip: run.steps.map((s) => ({ says: s.says, image: s.shot ? imageUrl(s.shot) : null, took: s.ms === null ? "—" : secs(s.ms) })),
    }));
  const fresh = pass.queued.length > 0 ? ` First run for newly published ${pass.queued.length === 1 ? "ZIP" : "ZIPs"} ${list(pass.queued)}.` : "";
  return {
    ran: pass.at,
    summary: `${pass.passed} of ${pass.runs.length} resident tasks passed at ${list(pass.zips)}.${fresh}`,
    rows,
  };
}
