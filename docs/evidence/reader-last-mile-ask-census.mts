import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unifiedCorpus, unifiedCorpusCounts } from "../../lib/corpus/unified.ts";
import { loadBallotForDivisions } from "../../lib/ask/server-sources.ts";
import { ballotAskInventory } from "../../lib/ask/ballot-inventory.ts";
import { readSnapshot } from "../../lib/meetings/snapshot.ts";
import { getVotesSnapshot } from "../../lib/votes/snapshot.ts";
import { getStateVotesSnapshot } from "../../lib/sources/legiscan/snapshot.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
delete process.env.ANTHROPIC_API_KEY;
const after = process.argv.includes("--after");
const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
const state = (code: string) => `ocd-division/country:us/state:${code}`;
const pilots = [
  { zip: "85701", state: "az", ids: [state("az"), `${state("az")}/county:pima`, `${state("az")}/place:tucson`, `${state("az")}/cd:7`, `${state("az")}/sldu:20`, `${state("az")}/sldl:20`] },
  { zip: "85641", state: "az", ids: [state("az"), `${state("az")}/county:pima`, `${state("az")}/school_district:vail_unified_district`, `${state("az")}/cd:7`, `${state("az")}/sldu:19`, `${state("az")}/sldl:19`] },
  { zip: "07866", state: "nj", ids: [state("nj"), `${state("nj")}/county:morris`, `${state("nj")}/county:morris/place:rockaway`, `${state("nj")}/cd:11`, `${state("nj")}/sldu:25`, `${state("nj")}/sldl:25`] },
  { zip: "03255", state: "nh", ids: [state("nh"), `${state("nh")}/county:merrimack`, `${state("nh")}/county:merrimack/place:newbury`, `${state("nh")}/cd:2`, `${state("nh")}/sldu:7`] },
];
const snapshots = unifiedCorpus().snapshots;
const meetings = readSnapshot()!;
const readbacks = [];
for (const pilot of pilots) {
  const ballot = await loadBallotForDivisions(pilot.ids);
  const inventory = ballotAskInventory(ballot.set, ballot.contests, ballot.nominees);
  const controls = pilot.state === "az" ? ["How much money has Katie Hobbs raised and spent?", "What has Andy Biggs voted on?", pilot.zip === "85641" ? "What's on the Vail school district agenda?" : "What did the Pima County Board of Supervisors decide at its last meeting?", after ? "What does Adelita Grijalva say about families?" : "What does Adelita Grijalva say about housing?"] : pilot.state === "nj" ? [after ? "How much campaign money has Tayfun Selen raised?" : "How much campaign money has Mikie Sherrill raised?", "Who is running for U.S. House in the 11th District?", after ? "What does Analilia Mejia say about minimum wage?" : "What does Analilia Mejia say about housing?", "When is the next Rockaway Township Council meeting?"] : ["How much campaign money has Kelly Ayotte raised?", "Who is running for Governor?", after ? "What does Maggie Goodlander say about democracy?" : "What does Maggie Goodlander say about housing?", "When is the next Newbury Select Board meeting?"];
  for (const question of controls) {
    resetGroundedState();
    const result = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-ask-before" }, body: JSON.stringify({ question, ocdIds: pilot.ids, surface: "BALLOT", today: "2026-09-04" }) }));
    readbacks.push({ zip: pilot.zip, question, status: result.status, payload: await result.json() as AskAnswerPayload });
  }
  readbacks.push({ zip: pilot.zip, scopedPopulation: { contests: ballot.contests.length, candidacies: [...inventory.subjects.values()].filter((r) => r.kind === "PERSON").length, absences: ballot.absences.length, meetings: meetings.meetings.filter((m) => m.ocdId && pilot.ids.includes(m.ocdId)).length }, identities: [...inventory.subjects.values()].filter((r) => r.kind === "PERSON").map((r) => ({ readerKey: r.id, candidacyId: r.candidacyId })) });
}
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const counts = (record: object) => Object.fromEntries(Object.entries(record).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
const census = {
  boundary: "Committed normalized reader projections only; autonomous acquisition/validation does not establish civic verification.",
  execution: "Real POST handler and committed loaders; ANTHROPIC_API_KEY deleted to prove structured grounding without model knowledge. Scope IDs are explicit route fixtures, not an address geocoder proof.",
  families: [
    { family: "ballot", path: "data/states/*/ballot/*", consumer: "loadBallotForDivisions -> ballotAskInventory -> ballotRecordsFor -> POST.records", eligibility: "Normalized BALLOT_SOURCES only; acquired candidate PDFs excluded", status: "RENDERED", issue: "Canonical candidacy and legacy lineup keys coexist; money and corpus joins need canonical bridge." },
    { family: "candidate-corpus", path: "data/candidates/corpus-2026.json", consumer: "unifiedCorpus -> positions endpoint; Ask only curated positionsFor", counts: unifiedCorpusCounts(), eligibleSubjects: [...new Set(snapshots.filter((s) => s.subjectId.startsWith("ballot") && s.extraction === "ok" && s.text).map((s) => s.subjectId))], status: "ELIGIBLE_BUT_NOT_RENDERED", issue: "Ask does not search unified corpus; prewritten position topics are not complete corpus retrieval." },
    { family: "statement-corpus", path: "data/corpus/statements.json", consumer: "unifiedCorpus -> positions endpoint; no Ask consumer", counts: counts(readJson("data/corpus/statements.json")), eligibleSubjects: [...new Set(snapshots.filter((s) => !s.subjectId.startsWith("ballot") && s.extraction === "ok" && s.text).map((s) => s.subjectId))], status: "ELIGIBLE_BUT_NOT_RENDERED", issue: "Ask never loads officeholder-keyed statements; person inventory excludes many held officeholders." },
    { family: "meetings", path: "data/meetings-snapshot.json", consumer: "readSnapshot -> bodyId -> selectSitting -> POST.records", counts: counts(meetings), status: "RENDERED", issue: "Global snapshot failure currently returns 503 for every Ask family; scoped bodies with no meeting are absent from binder." },
    { family: "outcomes", path: "data/states/az/outcomes/legistar-outcomes.json", consumer: "outcomeEvidenceFor -> POST.records", counts: counts(readJson("data/states/az/outcomes/legistar-outcomes.json")), status: "RENDERED", eligibility: "Exact body and meeting identity; action summary never promoted into member votes." },
    { family: "votes", path: "data/votes/votes-snapshot.json and data/states/*/votes/*", consumer: "voteEvidenceFor -> getVotesSnapshot/getStateVotesSnapshot -> POST.records", counts: { federal: counts(getVotesSnapshot()), state: counts(getStateVotesSnapshot()) }, status: "RENDERED", issue: "Exact normalized full-name join refuses variant names even when the reader already has a canonical official ID; stable ID retrieval required." },
    { family: "state-money", path: "data/states/*/funding/state-money-*.json", consumer: "stateMoneyForCard visual only; absent from Ask", status: "ELIGIBLE_BUT_NOT_RENDERED", issue: "Normalized reader totals and sourced filing absences omitted, generic scope gap rendered." },
  ],
  tracing: { required: ["data/meetings-snapshot.json", "data/states/*/ballot/*.json", "data/candidates/*.json", "data/corpus/*.json", "data/states/*/officials/*.json", "data/states/*/votes/*.json", "data/votes/*.json", "data/states/*/outcomes/*.json", "data/states/*/funding/*.json", "lib/registry/*.json"], verification: "Parent-owned deployment trace census; local imports alone do not prove bundle." },
  withheld: [
    { state: "AZ", holding: "data/health/autonomous-agent-fleet/2026-09-03-corona.json; 2026-09-03-sonoita.json", status: "STAGED_NOT_ELIGIBLE", reason: "Autonomous acquired fire-district evidence; external authority/denominator/extraction/audit obligations remain diagnostic input, never normalized reader records." },
    { state: "NJ", holding: "data/health/autonomous-agent-fleet/2026-09-03-nj-atlantic-scout.json; 2026-09-03-nj-followed-records.json", status: "STAGED_NOT_ELIGIBLE", reason: "Atlantic County acquired candidate PDFs are acquisition inventory without canonical civic promotion." },
    { state: "NH", holding: "data/health/autonomous-agent-fleet/2026-09-03-nh-directory-identity.json; 2026-09-03-springfield.json", status: "IDENTITY_UNRESOLVED", reason: "Publisher-directory evidence does not establish canonical government identity or external civic verification." },
  ],
  readbacks,
};
const output = after ? {
  execution: census.execution,
  executionLevel: "REAL_ROUTE_HANDLER",
  exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceHashes: Object.fromEntries([
    "app/api/ask/grounded/route.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts",
    "lib/ask/server-sources.ts", "lib/ask/ballot-inventory.ts", "lib/ask/campaign-money.ts",
    "lib/ask/statements.ts", "lib/ask/candidate-profile.ts", "lib/ask/meeting-outcomes.ts",
    "lib/identity/reader-person.ts", "lib/corpus/reader-positions.ts",
  ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  phase: "after",
  controls: "These sixteen pilot known-answer POSTs preserve actual returned records, contacts, canonical identities, provenance and gaps with model generation disabled. Separate exhaustive route artifacts cover current and historical finance targets, corpus snapshots, dated meetings and outcomes, source ballot filings, certified lineups, adopted analyses, sourced contacts, candidate profile fields, recorded votes and key-vote context. This pilot sample alone does not discharge those complete populations.",
  readbacks, withheld: census.withheld,
} : census;
writeFileSync(new URL(after ? "./reader-last-mile-ask-after.json" : "./reader-last-mile-ask-before.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ phase: after ? "after" : "before", readbacks: readbacks.flatMap((r) => r.payload ? [{ zip: r.zip, question: r.question, status: r.status, mode: r.payload.mode, subject: r.payload.subject?.id, records: r.payload.records?.length, kinds: [...new Set(r.payload.records?.map((v) => v.kind))] }] : []) }, null, 2));
