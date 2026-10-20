import type { DoorRecord } from "../../doors/registry.ts";
import type { DoorSittings } from "../../doors/overdue.ts";
import type { HourCosts } from "../vital-signs.ts";
import type { ReadinessWitness } from "../../coverage/readiness-counts.ts";

export const READER_FAMILIES = ["Government bodies","Officials and members","Meetings","Agendas","Taking part","Campaign money","Elections","Votes","Statements","Public finances","Services","Districts"] as const;
export const HOUR = 3_600_000;
export const LINE_KEEPER_ID = "line-keeper:current";
export const LINE_KEEPER_BY = "The line keeper";
export type ClockDoor = Pick<DoorRecord, "doorId" | "kind" | "bodyIds" | "meeting" | "status" | "lastSuccessAt" | "lastFailureAt" | "updatedAt" | "checkEveryMinutes" | "observedChangeMinutes"> & { readonly ocdId: string | null;readonly firstSeenAt?:string };
export interface FamilyCount { readonly state: string; readonly family: string; readonly saved: number; readonly live: number; readonly eligibleFacts?:readonly import("./public.ts").FactTarget[] }
export interface EmptyWork { readonly state: string; readonly family: string; readonly route: string; readonly runs: number; readonly fetchedNothing: number; readonly savedNothing: number; readonly empty: number; readonly failed: number; readonly unknown: number }
export interface Problem { readonly key: string; readonly where: string; readonly says: string; readonly owner: string; readonly next: string; readonly technical?: readonly string[] }
export interface LineHour {
  readonly from: string; readonly through: string; readonly measuredAt: string;
  readonly facts: readonly FamilyCount[] | null;
  readonly links?: readonly import("./links.ts").LinkCount[];
  readonly waiting?: readonly import("./links.ts").WaitingWork[];
  readonly posting?: readonly import("./posting.ts").KeeperPosting[];
  readonly configGrowth?: { readonly fixBytes:number; readonly briefBytes:number; readonly totalBytes:number; readonly fourCallersBytesPerHour:number|null };
  readonly pageProofs?: readonly import("./public.ts").PageProof[];
  readonly countryFreshness?:{readonly n:number;readonly of:number;readonly states:number};
  readonly recordsLive: number | null;
  readonly recordsByKind?:readonly {state:string;family:string;kind:string;saved:number;api:number;live:number}[];
  readonly work: readonly EmptyWork[] | null;
  readonly costs: HourCosts | null;
  readonly delivery?: {readonly seen:number;readonly total:number;readonly byFamily:readonly {family:string;seen:number;total:number}[]} | null;
  readonly rounds: { readonly finished: number | null; readonly killed: number | null };
  readonly transfer: { readonly control: number; readonly reader: number | null;readonly complete?:boolean;readonly window?:{readonly from:string;readonly through:string}; readonly byCaller: readonly { caller: string; bytes: number }[] } | null;
  readonly runnerTransferByCaller?:readonly {caller:string;bytes:number}[];
  readonly sources: { readonly scheduled: number; readonly overdue: number; readonly complete: boolean; readonly byState: readonly { state: string; scheduled: number; overdue: number }[];readonly byKind?:readonly {state:string;family:string;scheduled:number;overdue:number}[] } | null;
  readonly problems: readonly Problem[];
  readonly gates?: readonly import("../admin-view/gate-health.ts").GateHealthRow[];
  readonly readiness: Readonly<Record<string, ReadinessWitness>>;
  readonly own: { readonly bytesRead: number; readonly byCaller: Readonly<Record<string, number>>; readonly aiCostUsd: 0; readonly transferCostUsd: number };
}
export interface LineState {
  readonly version: 1; readonly seededAt: string | null; readonly checkedAt: string;
  readonly doors: Readonly<Record<string, ClockDoor>>;
  readonly sittings: Readonly<Record<string, Readonly<Record<string, DoorSittings>>>>;
  readonly hours: readonly LineHour[];
  readonly waitingIndex?: Readonly<Record<string,readonly Record<string,unknown>[]>>;
  readonly posting?: readonly import("./posting.ts").KeeperPosting[];
  readonly targets?: readonly import("./public.ts").MeetingTarget[];
  readonly inventory?: import("./inventory.ts").Inventory;
  readonly destinations?:Readonly<Record<string,string>>;
  readonly recordTargets?:readonly import('./records.ts').RecordTarget[];
  readonly transferSample?:import('./transfer.ts').TransferSample;
}
export function emptyState(at: string): LineState { return { version: 1, seededAt: null, checkedAt: at, doors: {}, sittings: {}, hours: [] }; }
export function closedHour(at: string): { from: string; through: string } {
  const end = Math.floor(Date.parse(at) / HOUR) * HOUR;
  if (!Number.isFinite(end)) throw Error("Invalid line keeper clock");
  return { from: new Date(end - HOUR).toISOString(), through: new Date(end).toISOString() };
}
export function keeperStatus(state: LineState | null, at: string): string {
  if (!state) return "The line keeper’s report is unavailable.";
  if (Date.parse(at) - Date.parse(state.checkedAt) > HOUR) return "The line keeper has stopped reporting.";
  const hour = closedHour(at);
  if (!state.hours.some(h => h.from === hour.from)) return "The line keeper has not reported for the last full hour.";
  return "The line keeper is checking every hour.";
}
