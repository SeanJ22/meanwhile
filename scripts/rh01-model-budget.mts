/** Measurement-only spend exception. Production settings and budgets are never written. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { modelRequestWorstCaseUsd, modelResponseUsd } from "../lib/control-plane/fleet-safety.ts";
import { ModelRequestNotSent, type ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MODELS, MODEL_PRICE_SOURCE, MODEL_PRICES_STATED_ON } from "../lib/models.ts";

export type DiagnosticPhase = "before" | "after";
export type DiagnosticRole = "SCOUT" | "ADVERSARIAL_AUDITOR";
export const RH01_DIAGNOSTIC_LIMITS = {
  totalUsd: 5, model: MODELS.haiku.model,
  perPhase: { SCOUT: { usd: 2.49, calls: 80, outputTokens: 8_192 }, ADVERSARIAL_AUDITOR: { usd: 0.01, calls: 1, outputTokens: 2_048 } },
  priceSource: MODEL_PRICE_SOURCE, pricesStatedOn: MODEL_PRICES_STATED_ON,
} as const;
const nanos = (usd: number) => Math.ceil(usd * 1_000_000_000);
const refusal = (reason: string) => new ModelRequestNotSent(`RH01_DIAGNOSTIC_NOT_SENT:${reason}`);

/** Reservations remain charged at their conservative bound even after a response or failure. */
export class DiagnosticModelBudget {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA cache_size=-1024;
      CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,phase TEXT NOT NULL,role TEXT NOT NULL,
        bound_nanos INTEGER NOT NULL,request_hash TEXT NOT NULL,sent_at TEXT NOT NULL,actual_usd REAL,usage_json TEXT,response_at TEXT);
      CREATE TABLE IF NOT EXISTS policy(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);`);
    const json = JSON.stringify(RH01_DIAGNOSTIC_LIMITS);
    this.db.prepare("INSERT OR IGNORE INTO policy VALUES (1,?)").run(json);
    if (this.db.prepare("SELECT json FROM policy WHERE id=1").get()?.json !== json) throw refusal("budget policy differs");
  }
  close(): void { this.db.close(); }
  snapshot() {
    return { limits: RH01_DIAGNOSTIC_LIMITS, calls: this.db.prepare(`SELECT id,phase,role,bound_nanos/1000000000.0 AS reservedUsd,
      request_hash AS requestHash,sent_at AS sentAt,actual_usd AS actualUsd,usage_json AS usageJson,response_at AS responseAt FROM calls ORDER BY id`).all() };
  }
  transport(input: { readonly phase: DiagnosticPhase; readonly role: DiagnosticRole; readonly authorized: boolean;
    readonly transport: ModelTransport }): ModelTransport {
    return async request => {
      if (!input.authorized) throw refusal("explicit diagnostic spending authorization is absent");
      const limit = RH01_DIAGNOSTIC_LIMITS.perPhase[input.role];
      if (request.model !== RH01_DIAGNOSTIC_LIMITS.model) throw refusal("only the native Haiku model is allowed; escalation is refused");
      if (!Number.isSafeInteger(request.max_tokens) || request.max_tokens <= 0 || request.max_tokens > limit.outputTokens) throw refusal("output allowance exceeds the native role");
      const bound = modelRequestWorstCaseUsd(request);
      if (bound === null || !Number.isFinite(bound) || bound <= 0) throw refusal("request price is unknown");
      const reserve = nanos(bound), hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
      let id: number;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const total = Number(this.db.prepare("SELECT COALESCE(sum(bound_nanos),0) AS n FROM calls").get()!.n);
        const own = this.db.prepare("SELECT count(*) AS calls,COALESCE(sum(bound_nanos),0) AS n FROM calls WHERE phase=? AND role=?").get(input.phase,input.role)!;
        if (Number(own.calls) >= limit.calls) throw refusal("native role call limit reached");
        if (Number(own.n) + reserve > nanos(limit.usd) || total + reserve > nanos(RH01_DIAGNOSTIC_LIMITS.totalUsd)) throw refusal("shared before/after dollar cap reached");
        id = Number(this.db.prepare("INSERT INTO calls(phase,role,bound_nanos,request_hash,sent_at) VALUES (?,?,?,?,?)")
          .run(input.phase,input.role,reserve,hash,new Date().toISOString()).lastInsertRowid);
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      // A single provider attempt; no retry, batch submission, escalation or paid search is reachable here.
      const response = await input.transport(request);
      this.db.prepare("UPDATE calls SET actual_usd=?,usage_json=?,response_at=? WHERE id=?")
        .run(modelResponseUsd(response),JSON.stringify(response.usage ?? null),new Date().toISOString(),id);
      return response;
    };
  }
}
