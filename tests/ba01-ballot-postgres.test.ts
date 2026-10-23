import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { runBallotPublication } from "../scripts/assemble-ballot-package.mts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { stateBallotScope, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import type { BallotWithTickets } from "../lib/ballot/tickets.ts";
import type { BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";

// Exercise the normal assembler and Postgres store against the actual production
// schema, including its history triggers. No production connection is used.
test("BA-01 publishes every state through all real migrations and preserves the prior ballot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ba01-postgres-"));
  const db = new PGlite();
  const originalFetch = neonConfig.fetchFunction;
  const names = ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL", "WTP_RUNTIME_MODE", "WTP_DB_ROLE", "WTP_SANCTIONED_WRITE"];
  const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    const journal = JSON.parse(await readFile("lib/db/migrations/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) {
      await db.exec(await readFile(`lib/db/migrations/${entry.tag}.sql`, "utf8"));
    }
    console.log(`Applied all ${journal.entries.length} journaled production migrations.`);
    const serializers = Object.fromEntries(Object.entries(db.serializers).map(([oid, serialize]) =>
      [oid, (value: unknown) => typeof value === "string" ? value : serialize(value)]));
    const raw = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString()
      : typeof value === "boolean" ? value ? "t" : "f" : typeof value === "object" ? JSON.stringify(value) : String(value);
    neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const execute = async (connection: PGlite | Transaction, statement: { query: string; params?: unknown[] }) => {
        const result = await connection.query<unknown[]>(statement.query, statement.params ?? [], { rowMode: "array", serializers });
        return { command: /^\s*(\w+)/.exec(statement.query)?.[1]?.toUpperCase() ?? "SELECT", fields: result.fields,
          rowAsArray: true, rowCount: result.affectedRows ?? result.rows.length, rows: result.rows.map(row => row.map(raw)) };
      };
      try {
        const value = request.queries ? { results: await db.transaction(async tx => {
          const values = [];
          for (const statement of request.queries) values.push(await execute(tx, statement));
          return values;
        }) } : await execute(db, request);
        return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({ message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code }),
          { status: 400, headers: { "content-type": "application/json" } });
      }
    };
    Object.assign(process.env, { DATABASE_URL: "postgresql://staging:staging@ep-ba01.us-east-2.aws.neon.tech/ballot",
      WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://staging:staging@ep-ba01.us-east-2.aws.neon.tech/ballot",
      WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" });
    const priorDirectory = join(directory, "prior");
    await mkdir(priorDirectory);
    const requestedStates = process.env.BA01_STATES?.split(",").map(state => state.trim().toLowerCase());
    const files = (await readdir("data/ballot/2026-general")).filter(file => /^[a-z]{2}\.json$/.test(file) &&
      (!requestedStates || requestedStates.includes(file.slice(0, 2)))).sort();
    assert.ok(files.length, "at least one requested state input must exist");
    if (requestedStates) console.log(`Focused state selection: ${requestedStates.join(", ")}`);
    const base = process.env.BA01_BASE_SHA ?? "7dbad3bb5f2ebdee6ab41f9e094237aa00eecb83";
    for (const file of files) {
      const state = file.slice(0, 2).toUpperCase() as BallotState;
      const path = `data/ballot/2026-general/${file}`;
      const existed = Boolean(execFileSync("git", ["ls-tree", "--name-only", base, "--", path], { encoding: "utf8" }).trim());
      const store = new PostgresRoutineDataStore({ purge: async () => ({ purged: true }) });
      Object.assign(store, { writeAuthority: assertRuntimeAuthority({ capabilities: ["MANUAL_CONTRACT"], contract: `ballot-contests:${state}` }) });
      if (existed) {
        const baseline = execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        await writeFile(join(priorDirectory, file), baseline);
        const prior = await runBallotPublication({ state, directory: priorDirectory, store });
        assert.equal(prior.report.status, "PUBLISHED", `${state} baseline: ${prior.report.reason}`);
      }
      const before = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store, bypassCache: true });
      if (existed) assert.equal(before.kind, "PROMOTED");
      const result = await runBallotPublication({ state, store });
      assert.equal(result.report.status, "PUBLISHED", `${state}: ${result.report.reason}`);
      const after = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store, bypassCache: true });
      assert.equal(after.kind, "PROMOTED", state);
      if (after.kind !== "PROMOTED") continue;
      const incoming = JSON.parse(await readFile(`data/ballot/2026-general/${file}`, "utf8")) as GenericBallotProjection;
      for (const [key, ballot] of Object.entries(incoming.ballots)) {
        const current = after.value.ballots[key];
        assert.ok(current, `${state} publishes the incoming election`);
        const complete = new Set(ballot.contests.filter(row => row.type === "MEASURE" || row.candidateListComplete === true).map(row => row.id));
        for (const field of ["contests", "candidacies", "measures"] as const) {
          const ids = new Set(current[field].map(row => row.id));
          for (const row of ballot[field]) if (complete.has(field === "contests" ? row.id : (row as { contestId: string }).contestId))
            assert.ok(ids.has(row.id), `${state} publishes verified incoming ${field} ${row.id}`);
        }
      }
      for (const ballot of Object.values(after.value.ballots)) {
        for (const membership of (ballot as BallotWithDistrictMemberships).districtMemberships ?? []) {
          const expected = ballot.contests.filter(row => row.ocdId === membership.districtOcdId);
          if (!expected.length) continue;
          const reader = ballotForDivisions(ballot, [membership.memberOcdId]);
          for (const contest of expected) assert.ok(reader.contests.some(row => row.id === contest.id),
            `${state} official whole-division membership reaches ${contest.id} through typed readback`);
        }
        const tickets = (ballot as BallotWithTickets).candidateTickets ?? [];
        if (!tickets.length) continue;
        for (const ticket of tickets) {
          const originalLead = ballot.candidacies.find(row => row.id === ticket.leadCandidacyId);
          const contest = ballot.contests.find(row => row.id === originalLead?.contestId);
          assert.ok(contest, `${state} retains ticket contest`);
          const reader = ballotForDivisions(ballot, [contest.ocdId]);
          const lead = reader.candidacies.find(row => row.id === ticket.leadCandidacyId);
          assert.ok(lead, `${state} retains ticket lead through typed readback`);
          assert.ok(ballotCandidateDisplayName(lead).includes(ballotCandidateDisplayName(ticket.runningMate)),
            `${state} reader includes the certified running mate`);
        }
      }
      for (const [key, ballot] of Object.entries(before.kind === "PROMOTED" ? before.value.ballots : {})) {
        const current = after.value.ballots[key];
        assert.ok(current, `${state} retains election ${key}`);
        for (const field of ["contests", "candidacies", "measures"] as const) {
          const ids = new Set(current[field].map(row => row.id));
          for (const row of ballot[field]) assert.ok(ids.has(row.id), `${state} retains ${field} ${row.id}`);
        }
      }
      console.log(`${state}: ${existed ? "prior published; updated published; previous ballot IDs retained" : "first ballot published"}; typed readback matches`);
    }
  } finally {
    neonConfig.fetchFunction = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
