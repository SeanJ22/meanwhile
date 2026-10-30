import { join } from "node:path";
import { readerFactDb, preparedStatement } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { loadParsers } from "../lib/sources/parser-hook.ts";
import { LEAD_LEASE_MS, runParserWorkers } from "../lib/sources/parser-worker.ts";

prepareProductionCivicDataWrite();
let drain = false;
process.on("SIGTERM", () => { drain = true; });
process.on("message", message => { if (message && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") drain = true; });
const stopRequested = () => drain || Date.now() >= passDeadlineFromEnv();
const slots = routineProcessSlots({ admissionsOpen: () => !stopRequested() });
const release = await slots.acquire("parser-worker.mts", Date.now() + 60_000);
try {
  const url = controlPlaneUrlFromEnv();
  if (url === null) throw new Error("parser lane: the control-plane URL is not set");
  const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
  const query = controlPlaneQuery(), connection = readerFactDb();
  const facts = { query: connection.query, transaction: <T,>(work: (query: typeof connection.query) => Promise<T>) =>
    connection.transaction(query => work((text, params) => query(preparedStatement(text), params))) };
  const parsers = await loadParsers();
  const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR)), fetch = pacedProbeFetch({ pacing: repos.websitePacing });
  const heartbeat = setInterval(() => { console.log(`Page readers: working; readers installed for ${[...parsers.keys()].join(", ")}`); }, 60_000);
  try {
    // A setting Sean changes holds within the minute; only the two clocks are read, and only when the settings changed.
    let clocks = factClocks(null), clocksAt = 0, adminVersion: string | undefined;
    const settings = async () => {
      const [row] = await query(`SELECT md5((value->'settings')::text) AS version FROM cp_admin_config WHERE id='current'`);
      if (row?.version === adminVersion) return;
      const [admin] = await query(`SELECT jsonb_build_object('settings',jsonb_build_object('facts.freshnessHours',value#>'{settings,facts.freshnessHours}',
        'facts.retryMinutes',value#>'{settings,facts.retryMinutes}')) AS value FROM cp_admin_config WHERE id='current'`);
      clocks = factClocks((admin?.value ?? null) as Parameters<typeof factClocks>[0]);
      adminVersion = String(row?.version);
    };
    while (!stopRequested()) {
      if (Date.now() - clocksAt >= 60_000) { await settings(); clocksAt = Date.now(); }
      const stats = await runParserWorkers({ concurrency: 4, maxClaims: 100, stopRequested, log: console.error, deps: {
        list: workList(query, { owner: `parser:${process.pid}`, leaseMs: LEAD_LEASE_MS }), facts, repos, parsers, clocks, vault, fetch, now: () => new Date() } });
      if (stats.claimed) console.log(`Page readers: ${JSON.stringify(stats)}`);
      else await new Promise(done => setTimeout(done, 5_000));
    }
  } finally { clearInterval(heartbeat); }
} finally { release(); }
