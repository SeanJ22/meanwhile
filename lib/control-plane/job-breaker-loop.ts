import { readFileSync } from "node:fs";
import { hourStart } from "../db/transfer-by-caller.ts";
import { saveBreakerSnapshot } from "./job-breaker-local.ts";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, readJobBreakerState, readJobNormalSeed, writeJobBreakerEvents,
  type BreakerSql, type JobBreakerSnapshot, type JobTransfer } from "./job-transfer-breaker.ts";

export interface BreakerOwnTransfer { hour: string; requests: number; bytes: number }
interface Options {
  path: string;
  reader: BreakerSql;
  control: BreakerSql;
  release: () => string;
  meter: () => BreakerOwnTransfer[];
  log?: (line: string) => void;
}

/** The standing parent owns this loop. Launches only consult its atomic local snapshot. */
export class JobTransferBreaker {
  readonly #options: Options;
  #snapshot: JobBreakerSnapshot | null = null;
  /** The last check's totals: when the hour turns they are the finished hour, read up to ten minutes before its end. */
  #lastRows: JobTransfer[] | undefined;
  #running: Promise<void> | null = null;
  constructor(options: Options) { this.#options = options; }
  check(now = Date.now()): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#check(now).finally(()=>{this.#running=null;});
    return this.#running;
  }
  /** The newer of this host's file and the control plane's last check. Only a breaker with no saved state learns a first normal from the last day. */
  async #start(now: number): Promise<JobBreakerSnapshot> {
    let cached: Partial<JobBreakerSnapshot> | null = null;
    try { cached = JSON.parse(readFileSync(this.#options.path,"utf8")); } catch { /* A new host reads the control plane. */ }
    const saved = await readJobBreakerState(this.#options.control);
    const local = cached && typeof cached.hour === "string" && cached.jobs && typeof cached.checkedAt === "string" ? cached as JobBreakerSnapshot : null;
    const state = local && (!saved?.state || local.checkedAt >= saved.checkedAt) ? local : saved?.state
      ?? { hour: hourStart(now), jobs: await readJobNormalSeed(this.#options.reader, now) };
    const pendingEvents = cached?.pendingEvents?.filter(event => event.action === "CHECK");
    return { checkedAt: new Date(now).toISOString(), hour: state.hour, jobs: state.jobs, ...(pendingEvents?.length ? { pendingEvents } : {}) };
  }
  async #check(now: number): Promise<void> {
    const options = this.#options, at = new Date(now).toISOString(), hour = hourStart(now);
    this.#snapshot ??= await this.#start(now);
    const before = options.meter();
    const rows = jobTransfers(await options.reader.query(JOB_TRANSFER_SQL,[hour]));
    const { state, changes } = evaluateJobBreaker({ now, rows, state: this.#snapshot, closed: this.#lastRows });
    this.#lastRows = rows;
    const own = options.meter(), currentOwn = own.find(part=>part.hour === hour);
    // Only the newest check carries the state, so an outbox held through an outage stays small.
    const pending: JobBreakerSnapshot = {checkedAt:at,...state,pendingEvents:[...(this.#snapshot.pendingEvents??[]).map(event=>({...event,state:null})),{
      id:`check:${at}`,checked_at:at,hour,action:"CHECK",job:null,gb:(currentOwn?.bytes??0)/1e9,top_table:"database_transfer_hourly",
      bytes_per_request:currentOwn?.requests?currentOwn.bytes/currentOwn.requests:null,state,
      detail:{jobs:rows.length,before,throughRead:own,release:options.release(),changes},
    }]};
    // An uncertain control write leaves an idempotent outbox beside the enforced decision.
    saveBreakerSnapshot(options.path,pending);
    this.#snapshot=pending;
    await writeJobBreakerEvents(options.control,pending.pendingEvents!);
    this.#snapshot={checkedAt:at,...state};
    saveBreakerSnapshot(options.path,this.#snapshot);
    for(const change of changes) options.log?.(change.kind === "SLOW"
      ? `SLOW ${change.job}; ${(change.bytes/1e9).toFixed(3)} GB against its normal ${(change.normal/1e9).toFixed(3)} GB; launches ${change.times}x further apart`
      : `NORMAL ${change.job}; back at its ordinary pace`);
  }
}
