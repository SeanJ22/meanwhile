import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { installAzBallot, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { servableAzBallot } from "./helpers/reader-fixtures.ts";
import { ASK_SAVE_STATUS_HEADER, askSaveNotice } from "../lib/ask/save-status.ts";
import { submitDemandSignal } from "../lib/demand/client.ts";
import { submitSpeakYourMind } from "../lib/speak/client.ts";
import { resetGroundedState } from "../lib/ask/grounded-state.ts";

const candidateId = "ballot-az-pima:governor:fixture";
await installRegistryAuthority();
await installAzBallot(servableAzBallot([{
  id: "ballot-az-pima:governor", title: "Governor",
  candidacies: [{ id: candidateId, givenName: "Fixture", familyName: "Candidate" }],
  lineup: [{ name: "Fixture Candidate", partyLabel: "Independent", outcome: "RECONCILED", candidacyId: candidateId }],
}]));
const { POST: ask } = await import("../app/api/ask/grounded/route.ts");
const { POST: speak } = await import("../app/api/speak/route.ts");
const { POST: demand } = await import("../app/api/demand-signal/route.ts");

function request(path: string, body: unknown): Request {
  return new Request(`https://reader.test${path}`, { method: "POST",
    headers: { "content-type": "application/json", origin: "https://reader.test", "x-wtp-synthetic-run": "step3-offline" },
    body: JSON.stringify(body) });
}

test("Ask, Speak and demand reach their real writers and report storage failure honestly", async (t) => {
  const priorEnv = { ...process.env }, priorNeonFetch = neonConfig.fetchFunction;
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
    Object.assign(process.env, priorEnv);
    neonConfig.fetchFunction = priorNeonFetch;
  });
  process.env.DATABASE_URL = "postgresql://fixture:fixture@ep-step3.invalid/fixture";
  process.env.WTP_DB_ROLE = "local";
  process.env.WTP_RIPCORD_RATE_LIMITS = "pulled";
  process.env.WTP_RIPCORD_REACTION_INTAKE = "live";
  delete process.env.WTP_SANCTIONED_WRITE;
  delete process.env.ANTHROPIC_API_KEY;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network permitted in this fixture"); });

  const rows = new Map<string, Record<string, unknown>[]>();
  const failed = new Set<string>();
  const stalled = new Set<string>();
  const committedBeforeTimeout = new Set<string>();
  const aborted: string[] = [];
  let pendingWrites = 0;
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as { query?: string; params?: unknown[]; queries?: { query: string; params: unknown[] }[] };
    const result = (statement: { query: string; params: unknown[] }) => {
      const insert = /insert into "([^"]+)" \(([^)]+)\) values \(([^)]+)\)/i.exec(statement.query);
      if (insert) {
        const [, table, names, values] = insert;
        if (failed.has(table)) throw Object.assign(new Error("fixture write refused"), { code: "42703" });
        const columns = names.split(", ").map(name => name.replaceAll('"', ""));
        const cells = values.split(", ");
        const row = Object.fromEntries(columns.flatMap((name, index) => {
          const parameter = /^\$(\d+)$/.exec(cells[index]);
          return parameter ? [[name, statement.params[Number(parameter[1]) - 1]]] : [];
        }));
        rows.set(table, [...(rows.get(table) ?? []), row]);
      }
      return { command: insert ? "INSERT" : "SELECT", rowCount: insert ? 1 : 0, rowAsArray: true, fields: [], rows: [] };
    };
    const table = /insert into "([^"]+)"/i.exec(body.query ?? "")?.[1];
    if (table && stalled.has(table)) {
      if (committedBeforeTimeout.has(table)) result({ query: body.query!, params: body.params ?? [] });
      const signal = init?.signal;
      assert.ok(signal, "the real Neon request must receive its cancellation signal");
      pendingWrites++;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => { pendingWrites--; aborted.push(table); reject(signal.reason); };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    try {
      return Response.json(body.queries ? { results: body.queries.map(result) }
        : result({ query: body.query ?? "", params: body.params ?? [] }));
    } catch (error) {
      return Response.json({ message: (error as Error).message, code: "42703" }, { status: 400 });
    }
  };
  const askBody = { question: "Who is running for governor?", surface: "BALLOT", approximateLocation: "85701",
    ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima"],
    continuityKey: "fixture-ask-key", today: "2026-10-01" };

  resetGroundedState();
  const saved = await ask(request("/api/ask/grounded", askBody));
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get(ASK_SAVE_STATUS_HEADER), "SAVED");
  const savedAnswer = await saved.json();
  assert.match(savedAnswer.answer, /Fixture Candidate/);
  const questions = rows.get("ask_interactions") ?? [];
  assert.equal(questions.length, 1, "the default production writer received exactly one prepared question");
  assert.equal(questions[0].question_scrubbed, askBody.question);
  assert.equal(questions[0].approximate_location, "85701");
  assert.deepEqual(JSON.parse(String(questions[0].ocd_ids)), askBody.ocdIds);
  assert.equal(questions[0].answer_text, savedAnswer.answer);
  assert.doesNotMatch(JSON.stringify(questions[0]), /fixture-ask-key/);
  assert.equal(askSaveNotice(saved.headers), null);

  const mapReply = await ask(request("/api/ask/grounded", { ...askBody,
    surface: "MAP", question: "What was decided about the fixture community garden?", ocdIds: [] }));
  assert.equal(mapReply.status, 200);
  assert.equal(mapReply.headers.get(ASK_SAVE_STATUS_HEADER), "SAVED");
  const mapAnswer = await mapReply.json();
  const mapRow = rows.get("ask_interactions")!.at(-1)!;
  assert.equal(mapRow.surface, "MAP");
  assert.equal(mapRow.answer_mode, mapAnswer.mode);
  assert.equal(mapRow.answer_text, mapAnswer.answer);
  const storedQuestionCount = rows.get("ask_interactions")!.length;
  assert.equal(storedQuestionCount, 2, "both the short ballot path and the full Ask path save once");

  const missingKey = await ask(request("/api/ask/grounded", { ...askBody, continuityKey: "" }));
  assert.equal(missingKey.status, 200);
  assert.equal(missingKey.headers.get(ASK_SAVE_STATUS_HEADER), "FAILED");
  assert.equal(rows.get("ask_interactions")!.length, storedQuestionCount);

  failed.add("ask_interactions");
  const refused = await ask(request("/api/ask/grounded", askBody));
  assert.equal(refused.status, 200, "a save failure does not discard the answer");
  assert.equal((await refused.json()).answer, savedAnswer.answer);
  assert.equal(refused.headers.get(ASK_SAVE_STATUS_HEADER), "FAILED");
  assert.match(askSaveNotice(refused.headers)!, /couldn't confirm that this question was saved/);
  assert.equal(rows.get("ask_interactions")?.length, storedQuestionCount);
  assert.ok(rows.get("write_alarm")?.some(row => row.store === "ask_interactions" && row.error_code === "42703"));

  failed.clear();
  process.env.WTP_RIPCORD_REACTION_INTAKE = "pulled";
  const paused = await ask(request("/api/ask/grounded", askBody));
  assert.equal((await paused.json()).answer, savedAnswer.answer);
  assert.equal(paused.headers.get(ASK_SAVE_STATUS_HEADER), "PAUSED");
  assert.equal(rows.get("ask_interactions")?.length, storedQuestionCount, "the existing owner intake switch still stops writes");
  process.env.WTP_RIPCORD_REACTION_INTAKE = "live";

  const speakBody = { subjectType: "CANDIDATE", subjectId: candidateId,
    text: "Please explain the school budget.", speakKey: "a".repeat(32) };
  assert.equal((await speak(request("/api/speak", speakBody))).status, 204);
  assert.equal(rows.get("speak_your_mind")?.length, 1);
  failed.add("speak_your_mind");
  const speakFailure = await speak(request("/api/speak", speakBody));
  assert.equal(speakFailure.status, 500, "a caught writer failure must not become no-store202");
  assert.ok(rows.get("write_alarm")?.some(row => row.store === "speak_your_mind"));

  const demandBody = { subjectType: "CANDIDATE", subjectId: candidateId, signal: "WANT_THIS_SOONER" };
  assert.equal((await demand(request("/api/demand-signal", demandBody))).status, 204);
  assert.equal(rows.get("demand_signals")?.length, 1);
  failed.add("demand_signals");
  assert.equal((await demand(request("/api/demand-signal", demandBody))).status, 500);
  assert.ok(rows.get("write_alarm")?.some(row => row.store === "demand_signals"));

  failed.add("write_alarm");
  failed.add("ask_interactions");
  const noAlarm = await ask(request("/api/ask/grounded", askBody));
  assert.equal(noAlarm.headers.get(ASK_SAVE_STATUS_HEADER), "FAILED");
  assert.equal(noAlarm.status, 200);
  assert.ok(logs.some(line => JSON.stringify(line).includes("write alarm unavailable")));
  assert.doesNotMatch(JSON.stringify(logs), /fixture-ask-key|Please explain the school budget/);

  for (const scenario of ["save", "alarm", "acknowledgement"] as const) {
    failed.clear();
    stalled.clear();
    committedBeforeTimeout.clear();
    if (scenario === "alarm") {
      failed.add("ask_interactions");
      stalled.add("write_alarm");
    } else {
      stalled.add("ask_interactions");
      if (scenario === "acknowledgement") committedBeforeTimeout.add("ask_interactions");
    }
    const before = rows.get("ask_interactions")!.length;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      ask(request("/api/ask/grounded", askBody)),
      new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error(`${scenario} stalled the answer`)), 3000); }),
    ]).finally(() => clearTimeout(deadline));
    assert.equal(reply.status, 200, scenario);
    assert.equal((await reply.json()).answer, savedAnswer.answer, scenario);
    assert.equal(reply.headers.get(ASK_SAVE_STATUS_HEADER), "FAILED", scenario);
    assert.match(askSaveNotice(reply.headers)!, /couldn't confirm/, scenario);
    assert.equal(aborted.at(-1), scenario === "alarm" ? "write_alarm" : "ask_interactions", scenario);
    assert.equal(pendingWrites, 0, "the request is aborted rather than left writing after the answer");
    assert.equal(rows.get("ask_interactions")!.length, before + (scenario === "acknowledgement" ? 1 : 0),
      "a lost acknowledgement may follow a committed row and must not trigger a duplicate retry");
  }
  stalled.clear();
  committedBeforeTimeout.clear();

  delete process.env.DATABASE_URL;
  assert.equal((await speak(request("/api/speak", speakBody))).status, 202);
  assert.equal((await demand(request("/api/demand-signal", demandBody))).status, 503);
  const noStore = await ask(request("/api/ask/grounded", askBody));
  assert.equal(noStore.headers.get(ASK_SAVE_STATUS_HEADER), "FAILED");
  assert.equal(noStore.status, 200);
});

test("clients confirm only stored submissions and keep Ask failure wording separate from the answer", async (t) => {
  for (const status of [204, 202, 500, 503]) {
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    assert.equal(await submitDemandSignal("CANDIDATE", candidateId), status === 204);
    assert.equal(await submitSpeakYourMind("CANDIDATE", candidateId, "A comment"),
      status === 204 ? "RECORDED" : status === 202 ? "NOT_STORED" : status === 503 ? "REFUSED" : "FAILED");
    t.mock.restoreAll();
  }
  assert.match(askSaveNotice(new Headers())!, /couldn't confirm/);
  assert.match(askSaveNotice(new Headers({ [ASK_SAVE_STATUS_HEADER]: "PAUSED" }))!, /paused/);
});
