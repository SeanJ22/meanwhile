import { readFileSync } from "node:fs";
import { hourStart } from "../db/transfer-by-caller.ts";
import { saveBreakerSnapshot } from "./job-breaker-local.ts";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, pausedStates, readJobBreakerLatest, readJobReleases, writeJobBreakerEvents,
  type BreakerSql, type JobBreakerSnapshot } from "./job-transfer-breaker.ts";

export interface BreakerOwnTransfer { hour: string; requests: number; bytes: number }
interface Options {
  path: string;
  reader: BreakerSql;
  control: BreakerSql;
  release: () => string;
  meter: () => BreakerOwnTransfer[];
  log?: (line: string) => void;
}

/** The standing parent owns this loop. Children only consult its atomic local snapshot. */
export class JobTransferBreaker {
  readonly #options: Options;
  #snapshot: JobBreakerSnapshot | null = null;
  #running: Promise<void> | null = null;
  constructor(options: Options) { this.#options = options; }
  check(now = Date.now()): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#check(now).finally(()=>{this.#running=null;});
    return this.#running;
  }
  /** The control plane is the record; a pause still in this host's outbox stands unless a later entry for that job is held. */
  async #start(now: number): Promise<JobBreakerSnapshot> {
    let cached: JobBreakerSnapshot | null = null;
    try { cached = JSON.parse(readFileSync(this.#options.path,"utf8")); } catch { /* A new host reads the control plane. */ }
    const latest = await readJobBreakerLatest(this.#options.control), states = pausedStates(latest);
    for (const event of cached?.pendingEvents ?? []) {
      const held = latest.find(row => row.job === event.job);
      if (event.action === "PAUSE" && event.job && (!held || Date.parse(held.at) < Date.parse(event.checked_at)))
        states[event.job] = { job: event.job, mode: "PAUSED", at: event.checked_at, hour: event.hour, offsetBytes: 0 };
    }
    return { checkedAt: new Date(now).toISOString(), states, releasesThrough: latest.reduce<string | null>((newest, row) =>
      newest !== null && newest >= row.at ? newest : row.at, null), ...(cached?.pendingEvents?.length ? { pendingEvents: cached.pendingEvents } : {}) };
  }
  async #check(now: number): Promise<void> {
    const options = this.#options;
    this.#snapshot ??= await this.#start(now);
    const before = options.meter();
    const releases = await readJobReleases(options.control, this.#snapshot.releasesThrough ?? null);
    const rows = jobTransfers(await options.reader.query(JOB_TRANSFER_SQL,[hourStart(now)]));
    const result = evaluateJobBreaker({now,rows,states:this.#snapshot.states,releases});
    const releasesThrough = [this.#snapshot.releasesThrough ?? null, releases.at(-1)?.at ?? null].reduce((a, b) => a === null || (b !== null && b > a) ? b : a);
    const own = options.meter(), currentOwn = own.find(part=>part.hour === hourStart(now));
    const pending: JobBreakerSnapshot = {...result.snapshot,releasesThrough,pendingEvents:[...this.#snapshot.pendingEvents??[],...result.events,{
      id:`check:${new Date(now).toISOString()}`,checked_at:new Date(now).toISOString(),hour:hourStart(now),action:"CHECK",
      job:null,gb:(currentOwn?.bytes??0)/1e9,top_table:"database_transfer_hourly",
      bytes_per_request:currentOwn?.requests?currentOwn.bytes/currentOwn.requests:null,state:null,
      detail:{jobs:rows.length,before,throughRead:own,release:options.release(),
        pauses:result.events.map(event=>event.job),released:result.released},
    }]};
    // An uncertain control write leaves an idempotent outbox beside the enforced decision.
    saveBreakerSnapshot(options.path,pending);
    this.#snapshot=pending;
    await writeJobBreakerEvents(options.control,pending.pendingEvents!);
    this.#snapshot={...result.snapshot,releasesThrough};
    saveBreakerSnapshot(options.path,this.#snapshot);
    for(const event of result.events) options.log?.(`PAUSE ${event.job}; ${event.gb.toFixed(3)} GB; ${event.detail.reason}`);
    for(const job of result.released) options.log?.(`RELEASED ${job}; new launches allowed`);
  }
}
