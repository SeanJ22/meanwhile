import type { StuckRowLike } from "./blocker-causes.ts";

export interface StuckCounts { readonly states: Readonly<Record<string,number>>; readonly places: Readonly<Record<string,number>> }
export interface StuckGroup { readonly sample: StuckRowLike; readonly count: number; readonly states: readonly string[] }
export interface StuckSummary { readonly total:number; readonly groups:readonly StuckGroup[]; readonly counts:StuckCounts }
