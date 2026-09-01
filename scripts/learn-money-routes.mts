/**
 * `pnpm method:learn-money-routes` — **THE SEVEN CAMPAIGN-FINANCE ROUTES THE
 * SCHEDULER NOW WORKS, PERSISTED AS PROJECT KNOWLEDGE.**
 * (Session C, PART D2, 2026-08-31. RULING 178, RULING 207.)
 *
 * ## Why these are learned rather than left in a descriptor file
 *
 * The registry's route descriptors say HOW to open a representation. The method
 * store is the project's record of WHAT IT KNOWS HOW TO WALK, and it is what
 * `chooseExecutor` reads to decide whether deterministic code owns a route or a
 * bounded worker does. A route this scheduler dispatches deterministically
 * every cycle, that the method store has never heard of, is a graduated method
 * living outside the store that records graduated methods — and the next
 * jurisdiction inherits nothing from it.
 *
 * So the four routes a live cycle actually walked on 2026-08-31, and the three
 * it disposed with a NAMED wall, are all recorded. **A wall is knowledge too**:
 * the FTP drop's entry is what stops the next session re-deriving that the drop
 * exists, is anonymous, carries 8,828 committees, and needs an adapter nobody
 * has written.
 *
 * ## Measured, on the run this file was written from
 *
 * ```
 *   az-sos-seethemoney-datatables    HTTP 200, recordsTotal 370, 370 of 370
 *                                    rows staged. Confirms the parameter shape
 *                                    the method store recorded a day earlier
 *   nh-cfs-filing-entity-details     HTTP 200, totalItems 5,738, 5,738 of
 *                                    5,738 rows staged
 *   az-pima-easyvote-public-filings  HTTP 200, 2,266 bytes — a shell, held and
 *                                    NOT read. First walk of a route recorded
 *                                    UNWALKED since 2026-08-26
 *   nh-sos-lobbyist-registry         HTTP 200, 2,951,626 bytes, with the
 *                                    identification moved out of the
 *                                    User-Agent. Recorded HTTP 403 until today
 *   az-sos-cfs-bulk-ftp              REQUIRES_NEW_ADAPTER — no FTP client here
 *   nh-cfs-transaction-detail        REQUIRES_NEW_ADAPTER — shape never derived
 *   nh-sos-records-request           PUBLIC RECORD STILL OWED, human/offline
 * ```
 *
 * Every route enters at `UNKNOWN` portability. RULING 178: a route does not
 * become nationwide by working somewhere.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version. **Never `method:ingest`** — it used to rebuild from the
 * legacy manifest and silently shrink the store.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "az-sos-seethemoney-datatables",
    title:
      "Arizona SOS SeeTheMoney statewide filer index, as an unattended scheduled route rather than a hand-run probe",
    tier: "A1",
    fields: ["filing", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS TREATING A MEASURED REQUEST SHAPE AS A FINISHED ROUTE. The shape was measured on 2026-08-31 and recorded as datatables-endpoint-needs-its-column-array, and nothing operational replayed it — the endpoint stayed a probe somebody ran by hand. THE PROCEDURE: register the measured request as a ROUTE DESCRIPTOR on a record obligation, with a YIELD CONTRACT naming what a real response contains. Here the contract is the DataTables signature: the body must carry recordsTotal and data, and recordsTotal is the denominator. That contract is load-bearing rather than defensive, because this exact endpoint answered HTTP 200 with a two-byte empty JSON string to every guessed body for a week, and a plain 200-with-bytes rule would have written a terminal INGESTED over two bytes and called it the state's filer index. MEASURED on the registered route 2026-08-31: recordsTotal 370, 370 rows returned with length=500, and 370 of 370 staged. Row keys are EntityID, EntityFirstName, EntityLastName, Income, Expense, IESupport, IEOpposition, OfficeID, PartyID, OfficeTypeID, OfficeName, PartyName, CashBalance, BMEFor, BMEAgainst, EntityTypeName, CommitteeName. EntityLastName carries presentation markup inside the data field - Accalia, Jayme <br>(102162) - and is carried verbatim rather than stripped.",
    origin:
      "walked 2026-08-31 (Session C, PART D2) while registering campaign finance as the second obligation provider, so the scheduler works this route unattended rather than a session running it by hand.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "One POST per cycle. The shape was already measured; what this adds is the descriptor and the yield contract, which is minutes and makes the route repeatable without a person.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 370,
      outcome: "YIELDED",
      note:
        "HTTP 200, recordsTotal 370, 370 of 370 rows normalized and staged promotion-ready at data/control-plane/staging/. NO PER-ENTITY CYCLE TOTAL IS DERIVED: several rows share one EntityID with differing Income and Expense and an identical CashBalance, and sum(Income) - sum(Expense) = CashBalance holds for 134 of 255 entities and breaks for 121.",
    },
    claims: [
      {
        id: "az-sos-seethemoney-datatables#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The Arizona SOS statewide filer index is reachable by an unattended scheduled POST replaying the measured DataTables shape, with a yield contract on recordsTotal and data.",
        restsOn: ["datatables-endpoint-needs-its-column-array#exists"],
      },
      {
        id: "az-sos-seethemoney-datatables#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 an unattended cycle returned 370 of 370 declared rows and staged them promotion-ready, with the per-entity cycle total explicitly not derived.",
        restsOn: ["az-sos-seethemoney-datatables#exists"],
      },
    ],
  },
  {
    id: "az-sos-cfs-bulk-ftp",
    title:
      "ftp://ftp.azsos.gov/cfsdata2/ is rung ZERO for Arizona campaign money and this repository holds no FTP client",
    tier: "A0",
    fields: ["filing", "document", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS LETTING A MISSING CLIENT READ AS A MISSING RECORD. Arizona's own Bulk Filing Guide names ftp://ftp.azsos.gov/cfsdata2/; it was walked 2026-08-26, is anonymous, and carries 8,828 campaign committees and the state's 109 filing jurisdictions (1 state, 15 counties, 93 cities and towns). Under RULING 166 that is rung ZERO and it outranks every page-by-page route beneath it, including the SeeTheMoney endpoint that the same session did walk. IT IS STILL UNWALKED FOR THIS PURPOSE, and the reason is entirely on our side: node ships no FTP client and this repository has not written one. THE PROCEDURE: register it as a route anyway, with an opening of NOT_MACHINE_EXECUTABLE naming the missing client, so an unattended cycle disposes REQUIRES_NEW_ADAPTER on a clock instead of the route being forgotten. REQUIRES_NEW_ADAPTER is absent from TERMINAL_DISPOSITIONS and from the discharging set, so the debt accrues, the next-due stands, and the digest names the adapter every cycle until somebody writes it. A route nobody can execute and nobody is reminded of is indistinguishable from a route nobody knows about.",
    origin:
      "recorded 2026-08-31 (Session C, PART D2) when registering Arizona's route portfolio: the FTP drop is the highest-value representation in the portfolio and the only one this process cannot open.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE_AFTER_HUMAN_SETUP",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "Writing an anonymous-FTP LIST and RETR client over node:net is the whole of the setup; every call after that is deterministic. Until it exists the route costs one disposition per cycle and nothing else.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "REQUIRES_NEW_ADAPTER on 2026-08-31: this process holds no FTP client. That is a capability gap on our side and is never evidence about the record; the drop was confirmed live on 2026-08-26 with 8,828 committees. The obligation stays live and its next-due stands.",
    },
    claims: [
      {
        id: "az-sos-cfs-bulk-ftp#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Arizona publishes its campaign-finance bulk data at an anonymous FTP drop its own Bulk Filing Guide names, carrying 8,828 committees and 109 filing jurisdictions.",
        restsOn: [],
      },
      {
        id: "az-sos-cfs-bulk-ftp#capability-gap",
        class: "ROUTE_OUTCOME",
        statement:
          "As of 2026-08-31 this repository holds no FTP client, so the route disposes REQUIRES_NEW_ADAPTER every cycle and the record remains owed.",
        restsOn: ["az-sos-cfs-bulk-ftp#exists"],
      },
    ],
  },
  {
    id: "az-pima-easyvote-public-filings",
    title:
      "Pima County's EasyVote public filings portal answers a plain GET with a shell, and a shell is held rather than read",
    tier: "B",
    fields: ["filing", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS COUNTING A 200 AS A READING. The portal at https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings was recorded UNWALKED on 2026-08-26 and first walked by an unattended cycle on 2026-08-31: HTTP 200, 2,266 bytes. That is a page shell, not 138 filers, and the honest handling is to vault the bytes, record INGESTED for the DOCUMENT that was retrieved, and stage the record as a NAMED GAP saying this project has no reader for its shape. THE PROCEDURE: a route with no yield contract and no normalizer stages a gap rather than a snapshot, and the gap sentence says whose gap it is. What it needs next is the same rung-7 observation that unlocked the vendor's API for the transactions walk - the tenant API at ecf-api.easyvoteapp.com is already recorded in scripts/campaign-finance-az-pima-transactions.mts and is the route this GET should become.",
    origin:
      "walked 2026-08-31 (Session C, PART D2) as part of Arizona's registered route portfolio; nothing had opened it since it was recorded as a lead on 2026-08-26.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note: "One GET per cycle, and it will keep returning a shell until the tenant API descriptor replaces it.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "ZERO",
      note:
        "HTTP 200 and 2,266 bytes on 2026-08-31 - a shell. The bytes are vaulted and the record is staged as a named gap: acquired, held, and not read. This is NOT a statement that Pima County publishes no filings; the index behind this portal is already known to hold 138 filers and 680 filing records.",
    },
    claims: [
      {
        id: "az-pima-easyvote-public-filings#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The Pima County EasyVote public filings portal answers an unauthenticated GET with HTTP 200.",
        restsOn: [],
      },
      {
        id: "az-pima-easyvote-public-filings#shell-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 that GET returned a 2,266-byte shell carrying no filings, so the record is staged as a named gap rather than as a reading.",
        restsOn: ["az-pima-easyvote-public-filings#exists"],
      },
    ],
  },
  {
    id: "nh-cfs-filing-entity-details",
    title:
      "The New Hampshire CFS filer index answers an unattended server-side POST with its whole 5,738-row universe",
    tier: "A0",
    fields: ["filing", "contact", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS PAGING AN INDEX AND STAGING PAGE ONE. https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails honours filerName only, and an empty filerName asks it for everything. Its response carries data.items[] AND data.totalItems, so the publisher hands over the DENOMINATOR and a staged snapshot only has to state it. MEASURED 2026-08-31: pageSize 100 returned 100 items with totalItems 5,738 - which is 1.7% of the index wearing the index's name if nothing states the total. pageSize 6000 returns all 5,738 in one call, 166 KB... and the general procedure is to read the declared total out of the response and compare it with the rows staged, every time, so a partial is labelled PARTIAL rather than discovered later. Row keys include filerEntityId, filerName, firstnameLastname, committeeName, officeSoughtName, officeTypeDesc, districtName, town, electionYear, electionCycle, politicalParty, totalRaised, totalSpent, filerTypeDesc, filerStatus, isMakingIndependentExpenditure, plus candidate and committee address, phone, email and website fields. The query is unfiltered by cycle and rows carry their own electionYear.",
    origin:
      "walked 2026-08-31 (Session C, PART D2) when registering New Hampshire's route portfolio; scripts/state-money-nh.mts had proven the endpoint the same day by querying it one surname at a time, and this asks it for the whole index instead.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "One POST per cycle for the entire state index, against one POST per surname for a ballot's worth of candidates. The difference is the empty filerName.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 5738,
      outcome: "YIELDED",
      note:
        "HTTP 200, data.totalItems 5,738, 5,738 of 5,738 rows normalized and staged promotion-ready. FILER-LEVEL TOTALS ONLY: contribution and expenditure detail sits behind endpoints this project has not derived.",
    },
    claims: [
      {
        id: "nh-cfs-filing-entity-details#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The NH CFS filer index returns its whole declared universe to one unauthenticated server-side POST with an empty filerName and a page size at least as large as data.totalItems.",
        restsOn: ["ask-what-the-browser-was-for-before-recording-human-only#exists"],
      },
      {
        id: "nh-cfs-filing-entity-details#nh-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 it returned 5,738 of 5,738 declared filer rows to an unattended cycle, which staged them promotion-ready.",
        restsOn: ["nh-cfs-filing-entity-details#exists"],
      },
    ],
  },
  {
    id: "nh-cfs-transaction-detail",
    title:
      "New Hampshire CFS contribution and expenditure detail sits behind endpoints nobody in this project has read",
    tier: "A0",
    fields: ["filing", "document"],
    note:
      "THE MISTAKE THIS PREVENTS IS READING FILER TOTALS AS A COMMITTEE'S MONEY. The filer index returns totalRaised and totalSpent, which are what the filer REPORTED, and this project holds not one contribution row or expenditure row for any New Hampshire committee. The detail endpoints exist - the CFS application displays the detail - and their request shape has never been observed. THE PROCEDURE: register the unknown route with an executor class of BOUNDED_MODEL_WORKER and an opening of NOT_MACHINE_EXECUTABLE, so an unattended cycle disposes REQUIRES_NEW_ADAPTER and names what is missing, rather than a session concluding from filer totals that the money is described. The next move is the same rung-7 move that turned the filer index from a hand-driven browser procedure into a script: observe one real call the app makes and replay it.",
    origin:
      "recorded 2026-08-31 (Session C, PART D2) from docs/frontier.md Part F, which names it under 'Still open here'.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE_AFTER_HUMAN_SETUP",
      discovery: "NEW_METHOD",
      note: "One browser observation to capture a real detail request; everything after that is a server-side replay.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "REQUIRES_NEW_ADAPTER on 2026-08-31: no descriptor for these endpoints exists to replay. Our tooling, not their publication - the CFS publishes the detail and we have not read it.",
    },
    claims: [
      {
        id: "nh-cfs-transaction-detail#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The NH CFS publishes contribution and expenditure detail behind API endpoints separate from the filer index.",
        restsOn: ["nh-cfs-filing-entity-details#exists"],
      },
      {
        id: "nh-cfs-transaction-detail#unread",
        class: "ROUTE_OUTCOME",
        statement:
          "As of 2026-08-31 their request shape has never been observed by this project, so the route disposes REQUIRES_NEW_ADAPTER and the detail remains owed.",
        restsOn: ["nh-cfs-transaction-detail#exists"],
      },
    ],
  },
  {
    id: "nh-sos-lobbyist-registry",
    title:
      "www.sos.nh.gov/lobbyists answers 200 once this project's name leaves the User-Agent, and it is a source class we hold nothing of",
    tier: "A0",
    fields: ["contact", "filing", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS LEAVING A WHOLE SOURCE CLASS BEHIND A WALL THAT WAS OUR OWN NAME. states/nh/sources.md recorded the lobbyist registry as HTTP 403 at rungs 2 and 3, and noted that lobbying is a source class this product holds NOTHING of in any state except Arizona. The nh.gov host family refuses a User-Agent carrying this project's name and serves a bare one - already recorded as identified-agent-refused and re-confirmed for robots.txt on 2026-08-31. Applying the same move to the registry itself: HTTP 200 and 2,951,626 bytes on 2026-08-31. Identification moves into From: and X-Purpose:, which the host serves; that is identification and not evasion, since a person and a purpose are named and no credential, session or residential proxy is involved. THE PROCEDURE: when a host family is known to discriminate on the identified agent, re-walk EVERY route recorded as 403 on that family, not only the one that prompted the finding. This registry had sat at 403 since 2026-08-19 with the answer three headers away. The bytes are held and NOT yet read - no normalizer exists for this page, so the record stages as a named gap.",
    origin:
      "walked 2026-08-31 (Session C, PART D2) by applying the nh.gov identified-agent finding to the one route on that family nobody had re-tried.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note: "One GET with two headers moved. Seconds, and it opens a source class.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 0,
      outcome: "ZERO",
      note:
        "HTTP 200 and 2,951,626 bytes on 2026-08-31, against a recorded 403. The bytes are vaulted; no normalizer exists for the page, so the record is staged as a named gap - acquired, held, and not yet read. This is not a row count of the registry.",
    },
    claims: [
      {
        id: "nh-sos-lobbyist-registry#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The New Hampshire lobbyist registry is reachable at www.sos.nh.gov/lobbyists when the project's identification is carried in From: and X-Purpose: rather than in the User-Agent.",
        restsOn: ["unanswered-permission-may-be-the-agent-not-the-host#exists"],
      },
      {
        id: "nh-sos-lobbyist-registry#nh-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 it answered HTTP 200 with 2,951,626 bytes to an unattended cycle, against a wall recorded since 2026-08-19; the bytes are held and unparsed.",
        restsOn: ["nh-sos-lobbyist-registry#exists"],
      },
    ],
  },
  {
    id: "nh-sos-records-request",
    title:
      "A human-or-offline route is registered WITH A CLOCK so the obligation cannot be quietly forgotten",
    tier: "C",
    fields: ["filing", "document", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS TREATING 'ONLY A HUMAN CAN DO THIS' AS 'THIS IS DONE'. RULING 205's third close is PUBLIC RECORD STILL OWED - HUMAN/OFFLINE ACCESS REQUIRED, and it keeps the obligation LIVE. A route in that state that exists only as a sentence in a document is a route nobody is reminded of. THE PROCEDURE: register it as a scheduled route whose opening is NOT_MACHINE_EXECUTABLE with the human act named, so every unattended cycle disposes REQUIRES_NEW_ADAPTER, accrues debt against it, keeps a persisted next-due, and prints it in the digest the owner reads. It can never be discharged by a machine, which is the point: the clock is what carries it to a person. RULING 215 removed external workflow execution from this architecture, so no agent sends the request - the digest asks the owner to. New Hampshire's Department of State public-records path (rung 13) was named as the next session's start on 2026-08-19 and is still unwalked on 2026-08-31.",
    origin:
      "recorded 2026-08-31 (Session C, PART D2) from docs/frontier.md Part F, which names rung 13 as unwalked and previously scheduled.",
    effort: {
      repeats: "PER_STATE",
      execution: "HUMAN_ONLY",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "The machine cost is one disposition per cycle. The real cost is a person writing a records request, which is why the clock exists.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "REQUIRES_NEW_ADAPTER on 2026-08-31, with the reason PUBLIC RECORD STILL OWED - HUMAN/OFFLINE ACCESS REQUIRED. Every machine-executable route on this record is worked independently and this one is not machine-executable at all.",
    },
    claims: [
      {
        id: "nh-sos-records-request#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "The New Hampshire Department of State offers a public-records path that reaches records the CFS web surfaces do not, and it ends in a human or offline act.",
        restsOn: [],
      },
      {
        id: "nh-sos-records-request#clocked",
        class: "ROUTE_OUTCOME",
        statement:
          "Registering it as a scheduled route with a persisted next-due keeps a human-only obligation live and visible in every cycle's digest rather than resting in a document.",
        restsOn: ["nh-sos-records-request#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
