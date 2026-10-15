import { createHash } from "node:crypto";
import type { FederalMoneyFact, FederalMoneySource } from "./model.ts";
import type { FederalMoneyTarget } from "./view.ts";

export const FEDERAL_MONEY_PAGE_SIZE = 100;
export interface FederalMoneyPageRef { readonly key: string; readonly hash: string; readonly count: number }
export interface FederalMoneyPlaceSegment {
  readonly year: string;
  readonly source: FederalMoneySource;
  readonly versionId: string;
  readonly contentHash: string;
  readonly checkedAt: string;
  readonly latestPublication: string | null;
  readonly pages: readonly FederalMoneyPageRef[];
}
export interface FederalMoneyPlaceIndex {
  readonly formatVersion: 2;
  readonly state: string;
  readonly place: string;
  readonly segments: Readonly<Record<string, FederalMoneyPlaceSegment>>;
}
export interface FederalMoneyPlacePage {
  readonly formatVersion: 2;
  readonly state: string;
  readonly place: string;
  readonly source: FederalMoneySource;
  readonly versionId: string;
  readonly records: readonly FederalMoneyFact[];
}
export interface FederalMoneySourceStatus {
  readonly checkedAt: string;
  readonly complete: boolean;
  readonly reason: string | null;
}
export interface FederalMoneyStateStatus {
  readonly formatVersion: 2;
  readonly state: string;
  readonly sources: Partial<Record<FederalMoneySource, FederalMoneySourceStatus>>;
}
export function federalMoneyPlaceKey(state: string, place: string): string {
  return `reader/federal-money/${state.toLowerCase()}/places/${createHash("sha256").update(place).digest("hex")}.json`;
}
export function federalMoneyStatusKey(state: string): string { return `reader/federal-money/${state.toLowerCase()}/status.json`; }
export function federalMoneyFactPlaces(fact: FederalMoneyFact): string[] {
  return [...new Set([...fact.bodyIds.map(id => `body:${id}`), ...fact.divisionIds.map(id => `division:${id}`)])];
}
export function federalMoneyTargetPlaces(target: FederalMoneyTarget): string[] {
  const county = /^(.+\/county:[^/]+)(?:\/|$)/.exec(target.divisionId)?.[1];
  return [...new Set([`division:${target.divisionId}`, ...(target.bodyId ? [`body:${target.bodyId}`] : []), ...(county ? [`division:${county}`] : [])])];
}
