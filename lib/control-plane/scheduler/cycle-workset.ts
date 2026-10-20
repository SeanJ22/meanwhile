import { closeHistoryIndex, openHistoryIndex, type HistoryIndex } from "../workers/streamed-history.ts";
import { rmSync } from "node:fs";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { DiskRows } from "./disk-rows.ts";
import { debtHours, type FreshnessDebt, type Incident } from "./debt.ts";
import type { ScheduledObligation, UnscheduledObligation } from "./obligation.ts";
import type { ExecutorDecision } from "./dispatch.ts";

type Statement=ReturnType<HistoryIndex["prepare"]>;
type Index=Awaited<ReturnType<typeof openHistoryIndex>>;
export interface QueueSlot {readonly seq:number;readonly row:ScheduledObligation;readonly decision:ExecutorDecision|undefined;readonly round:number;readonly order:number}

/** Complete cycle records stay on disk. Only a scheduling row or an admitted task is decoded at a time. */
export class CycleWorkset {
  private readonly index:Index;
  private readonly statements=new Map<string,Statement>();
  private closed=false;
  private sequence=0;
  private debtSequence=0;
  private outputSequence=0;
  private rankRevision:string|null=null;
  private pendingRemaining=-1;
  private readonly cleanOnExit=()=>{if(this.closed)return;this.closed=true;this.index.db.close();rmSync(temporaryPath(this.index.directory),{recursive:true,force:true});};
  private constructor(index:Index) {
    this.index=index;
    index.db.exec(`CREATE TABLE scheduled(seq INTEGER PRIMARY KEY,id TEXT NOT NULL,body TEXT NOT NULL,scheduled INTEGER NOT NULL,next_due TEXT NOT NULL,next_ms REAL NOT NULL,waiting TEXT NOT NULL,placed INTEGER NOT NULL,eligible INTEGER NOT NULL DEFAULT 0,due_group INTEGER NOT NULL DEFAULT 0,work_order INTEGER NOT NULL DEFAULT 0,lane TEXT NOT NULL DEFAULT '',decision TEXT NOT NULL DEFAULT '',round INTEGER NOT NULL DEFAULT 0,pool_order INTEGER NOT NULL DEFAULT 0,place_rank REAL NOT NULL DEFAULT 1e999,picked INTEGER NOT NULL DEFAULT 0,recovered INTEGER NOT NULL DEFAULT 0,discharged INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX scheduled_id ON scheduled(id); CREATE INDEX pending_queue ON scheduled(lane,picked,round,place_rank,pool_order);
      CREATE INDEX pending_order ON scheduled(lane,picked,pool_order);
      CREATE TABLE debts(id TEXT PRIMARY KEY,seq INTEGER NOT NULL,body TEXT NOT NULL,original TEXT NOT NULL,retry INTEGER NOT NULL,backoff INTEGER NOT NULL);
      CREATE TABLE output(seq INTEGER PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL); CREATE INDEX output_kind ON output(kind,seq);
      CREATE TABLE hunt_counts(hunt TEXT PRIMARY KEY,count INTEGER NOT NULL);
      CREATE TABLE incidents(key TEXT PRIMARY KEY,seq INTEGER NOT NULL,cause TEXT NOT NULL,target TEXT NOT NULL,count INTEGER NOT NULL,oldest REAL NOT NULL,detail TEXT NOT NULL,retry TEXT NOT NULL);
      CREATE TABLE sorting(seq INTEGER PRIMARY KEY,rank INTEGER NOT NULL)`);
    process.once("exit",this.cleanOnExit);
  }
  static async open():Promise<CycleWorkset>{const index=await openHistoryIndex();try{return new CycleWorkset(index);}catch(error){await closeHistoryIndex(index);throw error;}}
  statement(sql:string):Statement {let held=this.statements.get(sql);if(!held){held=this.index.db.prepare(sql);this.statements.set(sql,held);}return held;}
  number(sql:string,...params:(string|number)[]):number {return Number(this.statement(sql).get(...params)?.value??0);}
  rows<T>(sql:string,...params:(string|number)[]):DiskRows<T> {const statement=this.statement(sql);return new DiskRows(function*(){for(const row of statement.iterate(...params))yield JSON.parse(row.body) as T;},()=>this.number(`SELECT count(*) AS value FROM (${sql})`,...params));}
  output<T>(kind:string):DiskRows<T>{return this.rows<T>("SELECT body FROM output WHERE kind=? ORDER BY seq",kind);}
  append(kind:string,value:unknown):void {this.statement("INSERT INTO output VALUES(?,?,?)").run(this.outputSequence++,kind,JSON.stringify(value));}
  addDebt(debt:FreshnessDebt,nowMs:number,initial=false):void {
    const retry=debt.cause!=="AWAITING_ADAPTER"&&Date.parse(debt.retryAt)<=nowMs?1:0;
    const json=JSON.stringify(debt);
    this.statement(initial
      ?"INSERT INTO debts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,original=excluded.original,retry=excluded.retry,backoff=excluded.backoff"
      :"INSERT INTO debts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seq=CASE WHEN body='' THEN excluded.seq ELSE seq END,body=excluded.body").run(debt.obligationId,this.debtSequence++,json,initial?json:"",retry,debt.consecutiveFailures>0&&!retry?1:0);
  }
  debt(id:string,original=false):FreshnessDebt|null {const row=this.statement(original?"SELECT original AS body FROM debts WHERE id=?":"SELECT body FROM debts WHERE id=?").get(id);return row?.body?JSON.parse(row.body) as FreshnessDebt:null;}
  clearDebt(id:string):void {this.statement("UPDATE debts SET body='' WHERE id=?").run(id);}
  get debts():DiskRows<FreshnessDebt>{return this.rows("SELECT body FROM debts WHERE body<>'' ORDER BY seq");}
  get backedOff():DiskRows<FreshnessDebt>{return this.rows("SELECT original AS body FROM debts WHERE backoff=1 ORDER BY seq");}
  add(row:ScheduledObligation|UnscheduledObligation,placed:boolean,nowMs:number):void {
    const scheduled="nextDueAt" in row,id=row.obligation.id,debt=this.debt(id,true),due=scheduled?row.nextDueAt:"";
    const waiting=debt&&debt.consecutiveFailures>0&&debt.retryAt>due?debt.retryAt:due;
    const state=this.statement("SELECT retry,backoff FROM debts WHERE id=?").get(id),retry=Number(state?.retry??0),backoff=Number(state?.backoff??0);
    const dueNow=scheduled&&Date.parse(due)<=nowMs&&!backoff;
    this.statement("INSERT INTO scheduled(seq,id,body,scheduled,next_due,next_ms,waiting,placed,eligible,due_group) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(this.sequence++,id,JSON.stringify(row),scheduled?1:0,due,scheduled?Date.parse(due):0,waiting,placed?1:0,scheduled&&(dueNow||retry)?1:0,dueNow?0:1);
  }
  get scheduled():DiskRows<ScheduledObligation>{return this.rows("SELECT body FROM scheduled WHERE scheduled=1 ORDER BY seq");}
  get unscheduled():DiskRows<UnscheduledObligation>{return this.rows("SELECT body FROM scheduled WHERE scheduled=0 ORDER BY seq");}
  get work():DiskRows<ScheduledObligation>{return this.rows("SELECT body FROM scheduled WHERE eligible=1 ORDER BY placed DESC,due_group,CASE WHEN due_group=0 THEN next_due ELSE '' END,seq");}
  get dueCount():number{return this.number("SELECT count(*) AS value FROM scheduled WHERE eligible=1");}
  scheduledFor(id:string):ScheduledObligation|null {const row=this.statement("SELECT body FROM scheduled WHERE id=? AND scheduled=1 ORDER BY seq DESC LIMIT 1").get(id);return row?JSON.parse(row.body) as ScheduledObligation:null;}
  recover(id:string,discharged:boolean):void {this.statement("UPDATE scheduled SET recovered=1,discharged=MAX(discharged,?) WHERE id=?").run(discharged?1:0,id);}
  isRecovered(id:string):boolean{return this.number("SELECT max(recovered) AS value FROM scheduled WHERE id=?",id)>0;}
  discharged(id:string):void {this.statement("UPDATE scheduled SET discharged=1 WHERE id=?").run(id);}
  get overdueCount():number{return this.number("SELECT count(*) AS value FROM scheduled WHERE eligible=1 AND discharged=0");}
  async classify(decide:((row:ScheduledObligation)=>ExecutorDecision)|undefined):Promise<void> {
    let order=0;
    for(const held of this.statement("SELECT seq,body FROM scheduled WHERE eligible=1 AND recovered=0 ORDER BY placed DESC,due_group,CASE WHEN due_group=0 THEN next_due ELSE '' END,seq").iterate()) {
      const row=JSON.parse(held.body) as ScheduledObligation,decision=decide?.(row);
      this.statement("UPDATE scheduled SET lane=?,decision=?,work_order=? WHERE seq=?").run(decision?.kind==="BOUNDED_MODEL_WORKER"?"model":"deterministic",decision?JSON.stringify(decision):"",order++,Number(held.seq));
    }
  }
  laneCount(lane:string):number{return this.number("SELECT count(*) AS value FROM scheduled WHERE lane=?",lane);}
  get modelRows():DiskRows<ScheduledObligation>{return this.rows("SELECT body FROM scheduled WHERE lane='model' ORDER BY work_order");}
  prepareQueue(huntFor:((row:ScheduledObligation)=>string|null|undefined)|undefined):void {
    let order=0;
    for(const held of this.statement("SELECT seq,body FROM scheduled WHERE lane='deterministic' ORDER BY placed DESC,waiting,work_order").iterate()) {
      const row=JSON.parse(held.body) as ScheduledObligation,hunt=huntFor?.(row)??"standing";
      const round=huntFor?this.number("SELECT count AS value FROM hunt_counts WHERE hunt=?",hunt):0;
      this.statement("INSERT INTO hunt_counts VALUES(?,1) ON CONFLICT(hunt) DO UPDATE SET count=count+1").run(hunt);
      this.statement("UPDATE scheduled SET round=?,pool_order=? WHERE seq=?").run(round,order++,Number(held.seq));
    }
    this.pendingRemaining=order;
  }
  private slot(row:Record<string,string>):QueueSlot{return {seq:Number(row.seq),row:JSON.parse(row.body) as ScheduledObligation,decision:row.decision?JSON.parse(row.decision) as ExecutorDecision:undefined,round:Number(row.round),order:Number(row.pool_order)};}
  pending():Iterable<QueueSlot>{const statement=this.statement("SELECT seq,body,decision,round,pool_order FROM scheduled WHERE lane='deterministic' AND picked=0 ORDER BY pool_order"),decode=(row:Record<string,string>)=>this.slot(row);return {*[Symbol.iterator](){for(const row of statement.iterate())yield decode(row);}};}
  get pendingCount():number{if(this.pendingRemaining<0)this.pendingRemaining=this.number("SELECT count(*) AS value FROM scheduled WHERE lane='deterministic' AND picked=0");return this.pendingRemaining;}
  take(seq:number):void{this.statement("UPDATE scheduled SET picked=1 WHERE seq=?").run(seq);this.pendingRemaining--;}
  /** Stable external merge sort retains comparator semantics without an in-memory pending queue. */
  sortPending(compare:(left:ScheduledObligation,right:ScheduledObligation)=>number):void {
    const count=this.pendingCount;
    for(let width=1;width<count;width*=2) {
      this.index.db.exec("DELETE FROM sorting");let rank=0;
      for(let start=0;start<count;start+=2*width) {
        const a=this.statement("SELECT seq,body,decision,round,pool_order FROM scheduled WHERE lane='deterministic' AND picked=0 ORDER BY pool_order LIMIT ? OFFSET ?").iterate(width,start)[Symbol.iterator]();
        // Independent statements keep both bounded cursors live during the merge.
        const b=this.statement("SELECT seq,body,decision,round,pool_order FROM scheduled WHERE lane='deterministic' AND picked=0 ORDER BY pool_order LIMIT ? OFFSET ? /* right */").iterate(width,start+width)[Symbol.iterator]();
        let left=a.next(),right=b.next();
        while(!left.done||!right.done) {
          let useLeft=right.done;
          if(!left.done&&!right.done) {const l=this.slot(left.value),r=this.slot(right.value);useLeft=l.round-r.round<0 || l.round===r.round&&!(compare(l.row,r.row)>0);}
          const chosen=useLeft?left.value!:right.value!;
          this.statement("INSERT INTO sorting VALUES(?,?)").run(Number(chosen.seq),rank++);
          if(useLeft)left=a.next();else right=b.next();
        }
      }
      this.index.db.exec("UPDATE scheduled SET pool_order=(SELECT rank FROM sorting WHERE sorting.seq=scheduled.seq) WHERE seq IN(SELECT seq FROM sorting)");
    }
  }
  rankPending(priority:{readonly revision:string;readonly rank:(id:string)=>number|null}):void {
    if(priority.revision===this.rankRevision)return;
    for(const held of this.statement("SELECT seq,id FROM scheduled WHERE lane='deterministic' AND picked=0").iterate())this.statement("UPDATE scheduled SET place_rank=? WHERE seq=?").run(priority.rank(held.id)??Infinity,Number(held.seq));
    this.index.db.exec("WITH ranked AS(SELECT seq,row_number() OVER(ORDER BY round,place_rank,pool_order)-1 AS rank FROM scheduled WHERE lane='deterministic' AND picked=0) UPDATE scheduled SET pool_order=(SELECT rank FROM ranked WHERE ranked.seq=scheduled.seq) WHERE seq IN(SELECT seq FROM ranked)");
    this.rankRevision=priority.revision;
  }
  buildIncidents(nowMs:number):{readonly oldestDebtHours:number|null} {
    this.index.db.exec("DELETE FROM incidents");let sequence=0,oldest:number|null=null;
    for(const debt of this.debts) {
      const hours=debtHours(debt,nowMs);oldest=oldest===null?hours:Math.max(oldest,hours);
      this.statement("INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1,detail=CASE WHEN excluded.oldest>oldest THEN excluded.detail ELSE detail END,oldest=MAX(oldest,excluded.oldest),retry=MIN(retry,excluded.retry)")
        .run(`${debt.cause}\0${debt.target}`,sequence++,debt.cause,debt.target,1,hours,debt.detail,debt.retryAt);
    }
    return {oldestDebtHours:oldest};
  }
  get incidents():DiskRows<Incident> {const statement=this.statement("SELECT * FROM incidents ORDER BY count DESC,seq");return new DiskRows(function*(){for(const row of statement.iterate())yield {cause:row.cause as Incident["cause"],target:row.target,obligationsAffected:Number(row.count),oldestHours:Number(row.oldest),exampleDetail:row.detail,nextRetryAt:row.retry};},()=>this.number("SELECT count(*) AS value FROM incidents"));}
  async close():Promise<void>{if(this.closed)return;this.closed=true;process.removeListener("exit",this.cleanOnExit);await closeHistoryIndex(this.index);}
}
