/**
 * Sample section data for photographing Admin's Now and Workers pages (scripts/admin-now-shots.mts). Shaped like
 * the live sections: all 56 states and territories, 79 ZIP hunts in the three tracked states, paid work paused by
 * the owner, a round that ended with a stack trace, a migration outcome, and many doors shut for the same few
 * reasons. Figures are made up for the picture; nothing here is read back as a fact.
 *
 * `backend` picks what each backend sends: "before" is river before DS-03 (every hunt "unreported", migration
 * output on the card's face); "after" is DS-03 (a paused hunt says why; migration output behind the details).
 */
import { US_STATES } from "../../../lib/control-plane/readiness/catalog.ts";
import type { DoorsView } from "../../../lib/control-plane/admin-view/v6-doors-read.ts";
import { SECTION_IDS } from "../../../app/(admin)/_mw/admin-v6/contract.ts";
import type { Hunt, StateRow, StuckItem, UpdateCard, WorkerStatus } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { SectionState } from "../../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { liveReference } from "../../../app/(admin)/_mw/admin-v6/reference.ts";

const NOW = "2026-10-13T14:00:00.000Z";
const PAUSED_AT = "2026-10-12T21:40:00.000Z";

/** A stable spread of made-up figures per state, so the picture is the same on every run. */
function figure(code: string, salt: number, mod: number): number {
  let h = salt;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h % mod;
}

const HUNT_ZIPS: Readonly<Record<string, readonly string[]>> = {
  az: ["85701", "85705", "85710", "85711", "85712", "85713", "85714", "85715", "85716", "85718", "85719", "85730", "85741", "85742", "85745", "85746", "85747", "85748", "85749", "85750", "85755", "85756", "85757", "85003", "85004", "85006", "85007", "85008", "85012", "85013", "85014", "85015", "85016", "85018", "85020", "85021", "85022", "85023", "85024", "85028"],
  nj: ["08608", "08609", "08610", "08611", "08618", "08619", "08620", "08628", "08629", "08638", "08648", "08690", "08691", "07102", "07103", "07104", "07105", "07106", "07107", "07108", "07112", "07114", "07030", "07302", "07304"],
  nh: ["03031", "03038", "03053", "03060", "03062", "03063", "03064", "03101", "03102", "03103", "03104", "03106", "03109", "03301"],
};

function hunts(backend: "before" | "after"): Hunt[] {
  return Object.entries(HUNT_ZIPS).flatMap(([st, zips]) => zips.map((zip, i) => {
    const limit = 25;
    const spent = (figure(zip, 7, 2200) / 100);
    const pausedOwn = st === "nh" && i === 0;
    return {
      id: `exp:${st}:${zip}#rcpt-${zip}`, placeKey: `geo:${st}.zcta.${zip}`, name: `ZIP ${zip} hunt`,
      startedAt: `2026-10-0${1 + (i % 9)}T15:00:00.000Z`, limitUsd: pausedOwn ? 0 : limit, limitSource: "your hunt instruction",
      spentUsd: spent, heldUsd: 0.5, unpricedEntries: 0, researchWorkers: null, basis: "lifetime" as const,
      status: backend === "before" ? (pausedOwn ? "paused" as const : "unreported" as const) : "paused" as const,
      ...(backend === "after" ? { pause: pausedOwn
        ? { kind: "budget" as const, since: "2026-10-09T18:00:00.000Z", note: null }
        : { kind: "paid-work" as const, since: PAUSED_AT, note: "Holding spend until the new hunter prompt ships." } } : {}),
    };
  }));
}

function national(): StateRow[] {
  return US_STATES.map((st) => {
    const zips = HUNT_ZIPS[st.code]?.length ?? 0;
    const total = 40 + figure(st.code, 3, 900);
    return {
      placeKey: `st:${st.code}`, code: st.code.toUpperCase(), name: st.name, kind: "State" as const, parentKey: "us",
      hunts: zips, stuck: st.pilot ? figure(st.code, 5, 6) : 0, checklistItems: null, tracked: st.pilot,
      zipsWorked: zips ? zips - 3 : 0, zipsTotal: total,
      score: st.pilot ? 40 + figure(st.code, 11, 450) / 10 : figure(st.code, 13, 380) / 10,
    };
  });
}

const stuck: StuckItem[] = [
  { id: "stk-1", title: "Pima County agendas need a new door", applies: ["geo:az.zcta.85701"], lane: "decision", cause: "The county moved its agendas to a new site that needs a sign-in to read.", age: "2 days", ageRank: 2, tried: "Read the old and new sites.", helped: "—", next: "Choose whether to pay for the vendor's feed.", owner: "You", actions: [] },
  { id: "stk-2", title: "Trenton council minutes are scanned images", applies: ["geo:nj.zcta.08608"], lane: "software", cause: "The minutes are pictures of pages, so no text can be read from them yet.", age: "5 days", ageRank: 5, tried: "Plain text read.", helped: "—", next: "Engineering adds page reading for scans.", owner: "Engineering", actions: [] },
];

const STACK = [
  "Error: SOURCE_READ_FAILED: legistar.granicus.com answered 503",
  "    at readFamily (scripts/ingest.ts:702:13)",
  "    at async runCycle (scripts/pilot-runner.mts:1188:5)",
  "    at async main (scripts/pilot-runner.mts:1240:3)",
].join("\n");

const status: WorkerStatus = {
  cycle: { startedAt: "2026-10-13T13:20:00.000Z", finishedAt: "2026-10-13T13:31:00.000Z", exitCode: 1, signal: null, lastError: STACK },
  lastCheckIn: "2026-10-13T13:56:00.000Z",
  lastUsefulProgress: { at: "2026-10-13T13:28:00.000Z", what: "Published 14 meetings for Tucson Unified." },
  roundStartedAt: null, lastRoundFinishedAt: "2026-10-13T13:31:00.000Z", nextRoundDueAt: "2026-10-13T14:30:00.000Z",
  runnerState: "ALIVE",
  refused: { count: 12, why: "paid research is paused" },
  lanes: [{ name: "Research", active: 0, waiting: 41, blockedBy: "Paid research is paused." }, { name: "Plain code", active: 3, waiting: 8, blockedBy: null }],
  unread: [],
};

function update(backend: "before" | "after"): UpdateCard {
  const raw = ["expand: failed. ERROR: relation \"door_reads\" already exists (SQLSTATE 42P07) at migrate.mts:88 [private]", "contract: succeeded. 0035_doors_reason applied."];
  return backend === "before" ? {
    title: "Production migrations", checkedAt: "2026-10-13T12:10:00.000Z", what: raw.join("\n"),
    impact: "Expand runs before a deploy; contract runs after the matching code is serving.", owner: "Deployment and runner",
    next: "Engineering repairs the expand migration failure; that release step remains held.", youNeedToAct: "No action needed.", fixId: null, status: "FAILED",
    technical: ["Approved endpoint: ep-sample.neon.tech"],
  } : {
    title: "The latest database update", checkedAt: "2026-10-13T12:10:00.000Z",
    what: "The latest database update did not finish: the step that runs before new code goes live failed.",
    impact: "Database changes new code needs run before it goes live; changes that remove old parts run after the new code is serving.",
    owner: "Deployment and runner", next: "Engineering repairs the step that runs before new code goes live; that part of the release stays on hold until then.",
    youNeedToAct: "No action needed.", fixId: null, status: "FAILED", technical: [...raw, "Approved endpoint: ep-sample.neon.tech"],
  };
}

function doors(): DoorsView {
  const shut = [
    ...Array.from({ length: 23 }, (_, i) => ({ kind: "Legistar events", why: "3 reads in a row could not reach it", host: `city${i}.legistar.com` })),
    ...Array.from({ length: 9 }, (_, i) => ({ kind: "Official page events", why: "the address answers 404", host: `www.town${i}.gov` })),
    ...Array.from({ length: 4 }, (_, i) => ({ kind: "Legistar events", why: "the page no longer reads the way this door says", host: `county${i}.legistar.com` })),
    { kind: "Board docs", why: null, host: "go.boarddocs.com" },
  ];
  const rows = [
    ...shut.map((d, i) => ({ name: `Meetings on ${d.host}`, kind: d.kind, body: "—", status: "Shut" as const, why: d.why, since: `2026-10-${String(1 + (i % 12)).padStart(2, "0")}T10:00:00.000Z`, lastWorked: "2026-09-28T10:00:00.000Z", lastFailed: "2026-10-12T10:00:00.000Z" })),
    ...Array.from({ length: 60 }, (_, i) => ({ name: `Meetings on open${i}.gov`, kind: "Official page events", body: "—", status: "Open" as const, why: null, since: null, lastWorked: "2026-10-13T09:00:00.000Z", lastFailed: null })),
  ];
  return { observedAt: NOW, counts: { open: 60, shut: shut.length, setAside: 2, unreadable: 0 }, total: rows.length + 2, rows,
    changes: [{ at: "2026-10-12T10:00:00.000Z", says: "Meetings on city3.legistar.com was shut: 3 reads in a row could not reach it." }] };
}

export function adminNowFixture(backend: "before" | "after" = "after") {
  const reference = liveReference({ scope: { kind: "all" }, observedAt: NOW });
  const live = (data: unknown): SectionState => ({ phase: "live", data, asOf: NOW, revision: "sample", missingParts: [], attempts: 0 });
  const waiting: SectionState = { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 };
  const snapshot = Object.fromEntries(SECTION_IDS.map((id) => [id, waiting])) as Record<(typeof SECTION_IDS)[number], SectionState>;
  Object.assign(snapshot, {
    hunts: live(hunts(backend)),
    national: live(national()),
    stuck: live(stuck),
    history: live([]),
    sends: live([]),
    fixes: live({ open: [], closed: [], returned: [] }),
    scoreboard: live({ rows: [], byPlace: [], byFamily: [], missions: [], flow: null, gates: null, readiness: [], learning: null,
      vital: [
        { hour: "2026-10-13T13:00:00.000Z", factsLive: 212, costPerFactUsd: 0.0041, neonGb: 0.42, overNeonTarget: false, roundsFinished: 3, roundsKilled: 0, paidJobsEndedEmpty: 0, paidJobsEnded: 0 },
        { hour: "2026-10-13T12:00:00.000Z", factsLive: 188, costPerFactUsd: 0.0052, neonGb: 0.51, overNeonTarget: false, roundsFinished: 2, roundsKilled: 1, paidJobsEndedEmpty: 1, paidJobsEnded: 9 },
      ] }),
    workers: live({ status, jobs: null, running: null, waiting: null, events: null, update: update(backend), next: ["Paid research is paused."] }),
  });
  return {
    snapshot, reference, pulse: null,
    routes: {
      "/api/admin/v6/doors": doors(),
      "/api/admin/v6/scheduled": { rows: [] },
      "/api/admin/v6/reader-problems": { rows: [], unread: false },
    } as Record<string, unknown>,
  };
}
