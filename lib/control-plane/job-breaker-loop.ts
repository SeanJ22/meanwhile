import { readFileSync } from "node:fs";
import { hourStart } from "../db/transfer-by-caller.ts";
import { saveBreakerSnapshot } from "./job-breaker-local.ts";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, readJobBreakerStates, writeJobBreakerEvents,
  type BreakerSql, type JobBreakerSnapshot } from "./job-transfer-breaker.ts";

export interface BreakerOwnTransfer { hour: string; requests: number; bytes: number }
interface Options {
  path: string;
  reader: BreakerSql;
  control: BreakerSql;
  code: (job: string) => string | null;
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
  async #check(now: number): Promise<void> {
    const options = this.#options;
    if (!this.#snapshot) {
      let cached: JobBreakerSnapshot | null = null;
      try { cached = JSON.parse(readFileSync(options.path,"utf8")); } catch { /* A new host reads the control plane. */ }
      this.#snapshot = cached?.pendingEvents?.length ? cached : {
        checkedAt: new Date(now).toISOString(), states: await readJobBreakerStates(options.control),
      };
    }
    const before = options.meter();
    const rows = jobTransfers(await options.reader.query(JOB_TRANSFER_SQL,[hourStart(now)]));
    const result = evaluateJobBreaker({now,rows,states:this.#snapshot.states,code:options.code});
    const own = options.meter(), currentOwn = own.find(part=>part.hour === hourStart(now));
    const pending: JobBreakerSnapshot = {...result.snapshot,pendingEvents:[...this.#snapshot.pendingEvents??[],...result.events,{
      id:`check:${new Date(now).toISOString()}`,checked_at:new Date(now).toISOString(),hour:hourStart(now),action:"CHECK",
      job:null,gb:(currentOwn?.bytes??0)/1e9,top_table:"database_transfer_hourly",
      bytes_per_request:currentOwn?.requests?currentOwn.bytes/currentOwn.requests:null,state:null,
      detail:{jobs:rows.length,before,throughRead:own,release:options.release(),
        pauses:result.events.filter(event=>event.action==="PAUSE").map(event=>event.job)},
    }]};
    // An uncertain control write leaves an idempotent outbox beside the enforced decision.
    saveBreakerSnapshot(options.path,pending);
    this.#snapshot=pending;
    await writeJobBreakerEvents(options.control,pending.pendingEvents!);
    this.#snapshot=result.snapshot;
    saveBreakerSnapshot(options.path,result.snapshot);
    for(const event of result.events) options.log?.(`${event.action} ${event.job}; ${event.gb.toFixed(3)} GB; ${event.detail.reason}`);
  }
}
