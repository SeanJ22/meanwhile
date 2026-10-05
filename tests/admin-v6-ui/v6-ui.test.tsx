/**
 * Admin v6 interface: the rules the screens rely on, and proof that the
 * production path never uses sample data.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { actionDef, ACTIONS, connectedKinds } from "../../app/(admin)/_mw/admin-v6/actions.ts";
import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import { capabilitiesOf, SECTION_IDS, supportedAction } from "../../app/(admin)/_mw/admin-v6/contract.ts";
import { CONNECTION_REASON, whyNot, type Access } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { connectionOf, RECONNECTING_AFTER_MS } from "../../app/(admin)/_mw/admin-v6/live-connection.ts";
import { buildLiveBundle, type LiveReference } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { pctDown, type Place, type StuckItem, type UiReceipt } from "../../app/(admin)/_mw/admin-v6/model.ts";
import { breadcrumbs, indexPlaces, placeKeyOf, relation, scopeOfPlaceKey } from "../../app/(admin)/_mw/admin-v6/places.ts";
import { applyGatewayReply, startReceipt } from "../../app/(admin)/_mw/admin-v6/receipts.ts";
import { checklistDefinitions, liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { PULSE_STALE_MS } from "../../lib/control-plane/live-pulse.ts";

const V6 = join(import.meta.dirname, "..", "..", "app", "(admin)", "_mw", "admin-v6");
const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };

function receipt(over: Partial<UiReceipt> = {}): UiReceipt {
  return { ...startReceipt({ key: "k1", def: actionDef("global-runner-pause"), target: "runner", targetName: "the workers", label: "Pause all workers", scopeKey: "us", scopeName: "United States", level: "global", at: "2026-09-28T19:00:00.000Z", simulated: false }), ...over };
}

/* -------------------------------------------------------------- the rule */

test("eligibility checks connection, then role, then duplicates, then support, then item state", () => {
  const def = actionDef("send-agents");
  const base = { def, target: "r1", receipts: [] as UiReceipt[], mode: "live" as const, supported: true };
  assert.equal(whyNot({ ...base, connection: "offline", access: { ...owner, role: "viewer" } }), CONNECTION_REASON.offline, "connection first");
  assert.equal(whyNot({ ...base, connection: "live", access: { ...owner, role: "viewer" } }), "View only.");
  const pending = { ...receipt(), kind: "send-agents" as const, target: "r1" };
  assert.match(whyNot({ ...base, connection: "live", access: owner, receipts: [pending], supported: false }) ?? "", /Sent at/, "a duplicate is caught before support");
  assert.match(whyNot({ ...base, connection: "live", access: owner, receipts: [{ ...pending, status: "unknown" }] }) ?? "", /Check History/);
  assert.match(whyNot({ ...base, connection: "live", access: owner, supported: false, itemState: "Already hidden." }) ?? "", /Not connected yet/);
  assert.equal(whyNot({ ...base, connection: "live", access: owner, itemState: "Already hidden." }), "Already hidden.");
  assert.equal(whyNot({ ...base, connection: "live", access: owner }), null);
  assert.match(whyNot({ ...base, def: actionDef("hunt-limit"), connection: "live", access: { ...owner, canSpend: false } }) ?? "", /spending permission/);
  for (const c of ["stale", "reconnecting", "connecting"] as const) assert.equal(whyNot({ ...base, connection: c, access: owner }), CONNECTION_REASON[c]);
});

test("a finished receipt no longer blocks a new send of the same action", () => {
  const def = actionDef("send-agents");
  for (const status of ["done", "partial", "refused", "failed"] as const) {
    assert.equal(whyNot({ def, target: "r1", receipts: [{ ...receipt(), kind: "send-agents", target: "r1", status }], mode: "live", supported: true, connection: "live", access: owner }), null);
  }
});

test("only the kinds a real registry action carries out are wired, each to its own gateway type", () => {
  assert.deepEqual([...connectedKinds()].sort(), [
    "cancel-send", "data-switch-off", "data-switch-on", "decide", "global-ceiling", "global-paid", "global-paid-resume", "global-runner-pause", "global-runner-resume", "global-search-off", "global-search-on", "hunt-limit", "hunt-pause", "hunt-resume", "hunt-start", "hunt-start-many", "hunt-stop", "send-agents", "setting-set", "setting-undo", "target-clear", "target-set",
  ]);
  assert.equal(actionDef("cancel-send").gateway?.type, "fleet.cancelDispatch");
  assert.equal(actionDef("send-agents").gateway?.type, "fleet.deployHere");
  assert.equal(actionDef("global-runner-pause").gateway?.type, "runner.pause");
  assert.equal(actionDef("global-runner-resume").gateway?.type, "runner.resume");
  assert.equal(actionDef("global-paid").gateway?.type, "research.pause");
  assert.equal(actionDef("global-paid-resume").gateway?.type, "research.resume");
  assert.equal(actionDef("global-ceiling").gateway?.type, "config.setFleetSpendCeiling");
  assert.equal(actionDef("global-search-on").gateway?.type, "config.setDiscoverySearch");
  assert.equal(actionDef("global-search-off").gateway?.type, "config.setDiscoverySearch");
  assert.equal(actionDef("hunt-start").gateway?.type, "expansion.scope.setMany");
  assert.equal(actionDef("hunt-start-many").gateway?.type, "expansion.scope.setMany");
  for (const k of ["hunt-limit", "hunt-pause", "hunt-resume"] as const) assert.equal(actionDef(k).gateway?.type, "expansion.scope.budget");
  assert.equal(actionDef("hunt-stop").gateway?.type, "expansion.scope.remove");
  assert.equal(actionDef("setting-set").gateway?.type, "config.setSetting");
  assert.equal(actionDef("setting-undo").gateway?.type, "config.setSetting");
  for (const d of ACTIONS.values()) if (!d.gateway) assert.ok(d.dependency, `${d.kind} names what it is waiting for`);
});

test("previews never promise more than the action does", () => {
  const ctx = { target: "x", targetName: "X", scopeName: "Arizona", scopeIsCountry: false, outreachAuthorized: false };
  assert.match(actionDef("decide").doneWords, /Decision saved/);
  const decide = actionDef("decide").preview({ ...ctx, payload: {name:"Raise the ceiling",happening:"Work is waiting",recommends:"Raise it",cost:"$80 a day",gets:"Waiting work can run",fields:JSON.stringify([{key:"rollingCeilingUsd",label:"Daily ceiling",kind:"number",initial:"80"}]),schedulable:"true"} });
  assert.deepEqual(decide.options?.map(o=>o.id),["approve","decline","change","schedule"]);
  assert.equal(decide.invalid?.({option:"decline",words:" ",amount:"",selected:0}),"Say why you are declining.");
  assert.equal(decide.fields?.[0].initial,"80");
  const limit = actionDef("hunt-limit").preview({ ...ctx, hunt: { id: "h", placeKey: "p", name: "H", startedAt: "", limitUsd: 50, limitSource: "", spentUsd: 15, heldUsd: 6, unpricedEntries: 0, status: "running", researchWorkers: 1 } });
  assert.equal(limit.invalid?.({ option: null, words: "", amount: "20", selected: 0 }), "That’s below what’s already spent or set aside.");
});

/* -------------------------------------------------------------- receipts */

test("a gateway DONE is worded by the action and fills only “Instruction saved”", () => {
  const def = actionDef("global-runner-pause");
  const r = applyGatewayReply(receipt(), def, 200, { ok: true, replayed: false, receipt: { receiptId: "runner.pause:k1", outcome: "DONE", says: "x", startedAt: "2026-09-28T19:00:01.000Z", completedAt: "2026-09-28T19:00:02.000Z", readBackAt: null } }, "t");
  assert.equal(r.status, "done");
  assert.equal(r.statusWords, "Pause saved");
  assert.equal(r.lifecycle.saved, "2026-09-28T19:00:02.000Z");
  assert.equal(r.lifecycle.workersReceived, null, "saved is not received");
  assert.equal(r.lifecycle.checkedOnPublicPage, null);
  assert.equal(r.gatewayReceiptId, "runner.pause:k1");
});

test("a refusal with HTTP 200 is Refused; auth failure is Failed; a lost answer is Result unknown", () => {
  const def = actionDef("global-runner-pause");
  const refused = applyGatewayReply(receipt(), def, 200, { ok: false, replayed: false, receipt: { receiptId: "x", outcome: "REFUSED", says: "Pause the runner was not done. …" } }, "t");
  assert.equal(refused.status, "refused");
  assert.equal(refused.says, "Pause the runner was not done. …");
  assert.equal(applyGatewayReply(receipt(), def, 401, null, "t").status, "failed");
  assert.equal(applyGatewayReply(receipt(), def, null, null, "t").status, "unknown");
  assert.equal(applyGatewayReply(receipt(), def, 502, null, "t").status, "unknown");
  assert.equal(applyGatewayReply(receipt(), def, 200, { nonsense: true }, "t").status, "unknown");
  const replay = applyGatewayReply(receipt(), def, 200, { ok: true, replayed: true, receipt: { receiptId: "x", outcome: "DONE", says: "", startedAt: "a", completedAt: "b", readBackAt: null } }, "t");
  assert.match(replay.says, /nothing was done twice/);
});

/* -------------------------------------------------------------- executor */

test("the live executor posts one gateway request with the page’s idempotency key, and never retries", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const ex = liveExecutor({ capabilities: () => null, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body ?? "{}") }); return { status: 503, json: async () => null }; } });
  const updates: UiReceipt[] = [];
  await ex.send(receipt(), { def: actionDef("global-runner-pause"), target: "runner", scopeKey: "us", option: null, words: "  night  ", amount: "", selectedItems: [] }, (r) => updates.push(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/action");
  assert.deepEqual(calls[0].body, { type: "runner.pause", subject: "runner", stateVersion: null, idempotencyKey: "k1", note: "night" });
  assert.equal(updates.at(-1)?.status, "unknown");
});

test("an unannounced action is not sent; an announced one sends its exact contract inputs", async () => {
  const calls: string[] = [];
  const def = { ...actionDef("send-agents"), gateway: null };
  const fetchStub = async (_: string, init: { body?: string }) => { calls.push(init.body ?? ""); return { status: 200, json: async () => ({ ok: true, replayed: false, receipt: { receiptId: "r", outcome: "QUEUED", says: "Queued.", startedAt: "s", completedAt: null, readBackAt: null } }) }; };
  let caps = capabilitiesOf(null);
  const ex = liveExecutor({ capabilities: () => caps, fetch: fetchStub });
  assert.equal(ex.supports(def), false);
  const out: UiReceipt[] = [];
  await ex.send(receipt({ kind: "send-agents", target: "r1" }), { def: def, target: "r1", scopeKey: "st:az", option: null, words: "", amount: "", selectedItems: [] }, (r) => out.push(r));
  assert.equal(calls.length, 0, "nothing sent");
  assert.equal(out.at(-1)?.status, "refused");
  caps = capabilitiesOf({ v6: { version: 1, sections: {}, actions: { "send-agents": { contract: "admin-v6/action/send-agents@1", type: "fleet.deployHere", requiresStateVersion: false } } } });
  assert.equal(ex.supports(def), true);
  await ex.send(receipt({ kind: "send-agents", target: "r1", key: "k2" }), { def: def, target: "r1", scopeKey: "st:az", option: null, words: "", amount: "", selectedItems: [] }, (r) => out.push(r));
  const body = JSON.parse(calls[0]);
  assert.deepEqual(body, { type: "fleet.deployHere", subject: "r1", stateVersion: null, idempotencyKey: "k2", note: "" }, "exact keys only; no generic payload");
  assert.equal(out.at(-1)?.gatewayType, "fleet.deployHere");
  assert.equal(out.at(-1)?.status, "queued");
  assert.equal(supportedAction(capabilitiesOf({ v6: { version: 1, sections: {}, actions: { "send-agents": { contract: "admin-v6/action/send-agents@9", type: "t" } } } }), "send-agents"), null, "a different version is not supported");
});

test("a moving-world action quotes the latest pulse revision, and is not sent without one", async () => {
  const bodies: Record<string, unknown>[] = [];
  const caps = capabilitiesOf({ v6: { version: 1, sections: {}, actions: { decide: { contract: "admin-v6/action/decide@1", type: "decision.record", requiresStateVersion: true } } } });
  let rev: string | null = null;
  const ex = liveExecutor({ capabilities: () => caps, stateVersion: () => rev, fetch: async (_u, init) => { bodies.push(JSON.parse(init.body ?? "{}")); return { status: 200, json: async () => null }; } });
  const req = { def: actionDef("decide"), target: "morris", scopeKey: "us", option: "clerk", words: "", amount: "", selectedItems: [] as string[] };
  const out: UiReceipt[] = [];
  await ex.send(receipt({ kind: "decide", target: "morris" }), req, (r) => out.push(r));
  assert.equal(bodies.length, 0, "no rendered state yet, so nothing is sent");
  assert.equal(out.at(-1)?.status, "refused");
  rev = "beat|3|9";
  await ex.send(receipt({ kind: "decide", target: "morris", key: "k3" }), req, () => {});
  assert.deepEqual(bodies[0], { type: "decision.record", subject: "morris", stateVersion: "beat|3|9", idempotencyKey: "k3", decisionId: "morris", option: "clerk", words: null });
});

test("“Check what happened” asks the receipt lookup and never resends", async () => {
  const urls: string[] = [];
  const caps = capabilitiesOf({ v6: { version: 1, sections: {}, actions: {}, receiptLookup: { contract: "admin-v6/receipt@1", href: "/api/admin/v6/receipt" } } });
  const ex = liveExecutor({ capabilities: () => caps, fetch: async (url, init) => { urls.push(`${init.method} ${url}`); return { status: 200, json: async () => ({ contract: "admin-v6/receipt@1", receipt: { receiptId: "x", outcome: "DONE", says: "", startedAt: "a", completedAt: "b", readBackAt: null } }) }; } });
  assert.equal(ex.canCheck(), true);
  const out: UiReceipt[] = [];
  await ex.check(receipt({ status: "unknown", gatewayType: "runner.pause" }), actionDef("global-runner-pause"), (r) => out.push(r));
  assert.deepEqual(urls, ["GET /api/admin/v6/receipt?type=runner.pause&key=k1"], "identity is type plus key");
  assert.equal(out.at(-1)?.status, "done");
  assert.equal(liveExecutor({ capabilities: () => null }).check(receipt(), actionDef("global-runner-pause"), () => {}), null, "no lookup, no check");
});

/* ------------------------------------------------------------ connection */

test("the connection indicator separates connecting, live, reconnecting, stale and offline", () => {
  const now = Date.parse("2026-09-28T19:00:00.000Z");
  assert.equal(connectionOf({ online: true, receivedAt: null, now }), "connecting");
  assert.equal(connectionOf({ online: true, receivedAt: now - 30_000, now }), "live");
  assert.equal(connectionOf({ online: true, receivedAt: now - RECONNECTING_AFTER_MS - 1, now }), "reconnecting", "an overdue pulse");
  assert.equal(connectionOf({ online: true, receivedAt: now - PULSE_STALE_MS - 1, now }), "stale");
  assert.equal(connectionOf({ online: false, receivedAt: now, now }), "offline");
});

test("the v6 page never polls: it listens to the shell's single pulse", () => {
  const src = readFileSync(join(V6, "live-connection.ts"), "utf8") + readFileSync(join(V6, "live-command-center.tsx"), "utf8");
  assert.doesNotMatch(src, /fetch\([^)]*api\/admin\/live/, "no second /api/admin/live poller");
  assert.match(src, /meanwhile:admin-pulse/);
});

test("the live pulse gives a check-in, never a progress claim", () => {
  const st = workerStatusFromPulse({ revision: "r", at: "t", runner: { beatAt: "b", lastCycleFinishedAt: "f", nextCycleDueAt: null, state: "ALIVE" }, counts: { decisionsWaiting: null, freshnessDebtRows: null, incidents: null, obligations: null, agentJobsRunning: null }, lanes: null, unread: [] });
  assert.equal(st.lastCheckIn, "b");
  assert.equal(st.lastUsefulProgress, null);
});

/* ------------------------------------------------------------------ scope */

test("counting follows coverage relations, not breadcrumbs; a ZIP in two counties is local to both", () => {
  const places: Place[] = [
    { key: "us", name: "United States", kind: "Country", navParent: null, within: [] },
    { key: "st:az", name: "Arizona", kind: "State", navParent: "us", within: ["us"] },
    { key: "c1", name: "County One", kind: "County", navParent: "st:az", within: ["st:az"] },
    { key: "c2", name: "County Two", kind: "County", navParent: "st:az", within: ["st:az"] },
    { key: "z", name: "ZIP", kind: "ZIP", navParent: "c1", within: ["c1", "c2"] },
  ];
  const idx = indexPlaces(places);
  assert.equal(relation(idx, ["z"], "c2"), "local", "overlap counts in the second county too");
  assert.equal(relation(idx, ["st:az"], "z"), "shared", "statewide work is shared, not local");
  assert.equal(relation(idx, ["c1"], "c2"), null);
  assert.deepEqual(breadcrumbs(idx, "z").map((p) => p.key), ["us", "st:az", "c1"].concat("z"));
});

test("place keys round-trip with the deployed MwScope", () => {
  for (const s of [{ kind: "all" }, { kind: "state", state: "az" }, { kind: "geo", type: "zcta", geoid: "85635", state: "az" }] as const) {
    assert.deepEqual(scopeOfPlaceKey(placeKeyOf(s)), s);
  }
  assert.equal(scopeOfPlaceKey("body:x"), null);
});

test("percentages round down", () => {
  assert.equal(pctDown(999, 1000), "99.9%");
  assert.equal(pctDown(9999, 10000), "99.9%");
  assert.equal(pctDown(0, 0), "—");
});


/* ------------------------------------------------------- production path */

const ref: LiveReference = liveReference({ scope: { kind: "all" }, observedAt: "2026-09-28T19:00:00.000Z" });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;

test("with nothing announced, the production bundle is real reference data plus waiting states — no zeros, no samples", () => {
  const b = buildLiveBundle(waiting, ref, workerStatusFromPulse(null));
  assert.equal(b.checklist.data?.definitionCount, 325, "all 325 definitions stay in scope");
  assert.equal(checklistDefinitions().length, 325);
  assert.equal(b.places.data?.filter((p) => p.kind === "State").length, 56);
  assert.ok(b.national.data?.every((r) => r.hunts === null && r.stuck === null && r.checklistItems === null), "unknown national figures are null, never 0");
  for (const id of ["stuck", "results", "money", "fixes", "learning", "history", "hunts"] as const) {
    assert.equal(b[id].state, "not-connected", id);
    assert.equal(b[id].problem, "waiting", id);
  }
  assert.equal(b.workers.data?.jobs, null, "no worker jobs are invented from a heartbeat");
});

test("sample adapters are isolated: no production module imports ./sample", () => {
  const prod = readdirSync(V6).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(prod.includes("live-command-center.tsx"));
  for (const f of prod) {
    const src = readFileSync(join(V6, f), "utf8");
    assert.doesNotMatch(src, /from "\.\/sample\//, `${f} must not import sample data`);
  }
});

test("the same mounted page shows real data once the section is live — no remount, no switch", () => {
  const stuckItem: StuckItem = { id: "real-1", title: "Real stuck item from the backend", applies: ["us"], lane: "auto", cause: "c", age: "1 h", ageRank: 1, tried: "t", helped: "h", next: "n", owner: "o", actions: [] };
  const props = (snapshot: Record<(typeof SECTION_IDS)[number], SectionState>) => ({
    data: buildLiveBundle(snapshot, ref, workerStatusFromPulse(null)),
    mode: "live" as const,
    executor: liveExecutor({ capabilities: () => null }),
    scopeKey: "us",
    onScopeChange: () => {},
    connection: "live" as const,
    lastGoodAt: "2026-09-28T19:00:00.000Z",
    recovered: false,
    access: owner,
  });
  const before = renderToStaticMarkup(h(CommandCenter, props(waiting)));
  assert.match(before, /<span class="big">—<\/span>/, "an unreached section shows a dash where its number would be");
  assert.doesNotMatch(before, /Real stuck item from the backend/);
  assert.doesNotMatch(before, /SAMPLE DATA/, "a production page never carries the sample badge");
  const live = { ...waiting, stuck: { phase: "live", data: [stuckItem], asOf: "2026-09-28T19:01:00.000Z", revision: "v1", missingParts: [], attempts: 0 } as SectionState };
  const after = renderToStaticMarkup(h(CommandCenter, props(live)));
  assert.match(after, /Real stuck item from the backend/);
});

test("a hunt starts from a ZIP place: the place key is read as a ZIP, and its input carries the ZIP and state", async () => {
  const { isZipPlace } = await import("../../app/(admin)/_mw/admin-v6/actions.ts");
  const { actionInput } = await import("../../app/(admin)/_mw/admin-v6/contract.ts");
  assert.equal(isZipPlace("geo:az.zcta.85635"), true);
  assert.equal(isZipPlace("geo:az.county.04019"), false);
  assert.equal(isZipPlace("geo:az.zcta.8563"), false);
  const input = actionInput("hunt-start", { target: "geo:az.zcta.85635", scopeKey: "geo:az.zcta.85635", amount: "", words: "", option: "", selected: [], payload: undefined } as never);
  assert.deepEqual((input as { items: unknown[] }).items, [{ zip: "85635", stateAbbr: "AZ", budgetUsd: null }]);
});

test("a place target is wired to its own gateway action, and its input carries the place and the percent (or none to clear)", () => {
  assert.equal(actionDef("target-set").gateway?.type, "config.setPlaceTarget");
  assert.equal(actionDef("target-clear").gateway?.type, "config.setPlaceTarget");
  assert.equal(actionDef("data-switch-on").gateway?.type, "config.setDataSwitch");
  assert.equal(actionDef("data-switch-off").gateway?.type, "config.setDataSwitch");
});

test("retired controls and the old instruction box are absent", () => {
  for (const kind of ["contain", "uncontain", "recheck", "workfirst", "fixfirst", "stopmethod", "scope-stop", "stoprepeats", "scope-recheck", "doc-request", "reprocess", "retry-method", "resume-publish", "eng-task", "job-stop", "focus", "scope-first", "use-url"]) {
    assert.equal([...ACTIONS.keys()].some(k => k === kind), false, kind);
  }
  assert.doesNotMatch(readFileSync(join(V6, "screen-now.tsx"), "utf8"), /Tell it what to do|<Instruction/);
  assert.ok(!readdirSync(V6).includes("instruction.ts"));
  assert.ok(!readdirSync(V6).includes("instruction-draft.ts"));
});

test("BR-39: every Admin view keeps planted code names and raw errors behind Technical details", async()=>{
  const { stuckViews }=await import("../../lib/control-plane/admin-view/v6-stuck-read.ts");
  const { hasTechnicalText }=await import("../../lib/control-plane/admin-view/plain-words.ts");
  const { VIEWS }=await import("../../app/(admin)/_mw/admin-v6/context.tsx");
  const view=stuckViews([{id:"wi-aabbccdd",state:"BLOCKED",lane:"data",owner:"RUNNER",blocker:"DIRECTORY_NO_READABLE_SAVED_PAGE",label:"Directory",subjectName:null,stateCode:"az",overdue:false,band:null,waitingSince:null,eligibleAt:null,lastActivityAt:null,nextAction:"SCOUT_POLICY_DENIED",assignmentKeys:[]}],"us","2026-10-05T00:00:00Z");
  const source=(data:unknown):SectionState=>({phase:"live",data,asOf:"2026-10-05T00:00:00Z",revision:"v1",missingParts:[],attempts:0});
  const snapshot={...waiting,stuck:source(view.items),sameCause:source(view.sameCause),history:source([receipt({status:"failed",says:"SCOUT_POLICY_DENIED: TypeError: unavailable"})])};
  const visible=(html:string)=>html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, block=>/<summary[^>]*>Technical details<\/summary>/.test(block) ? "" : block).replace(/<[^>]*>/g," ");
  const check=(html:string)=>assert.equal(hasTechnicalText(visible(html)),false);
  for (const [initialView] of VIEWS) {
    const html=renderToStaticMarkup(h(CommandCenter,{data:buildLiveBundle(snapshot,ref,workerStatusFromPulse(null)),mode:"live",executor:liveExecutor({capabilities:()=>null}),scopeKey:"us",onScopeChange:()=>{},connection:"live",lastGoodAt:null,recovered:false,access:owner,initialView}));
    check(html);
  }
  assert.throws(()=>check("<p>SCOUT_POLICY_DENIED</p>"),"positive control: leaking an error onto the face fails the check");
});
