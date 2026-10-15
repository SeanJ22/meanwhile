import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { FederalMoneySource, FederalMoneyCheckpoint } from "./model.ts";
import type { FederalMoneyNationalProjection } from "./candidate.ts";
import { federalMoneySourceStates } from "./sources.ts";

export async function readFederalMoneyNationalProjection(source: FederalMoneySource, options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalMoneyNationalProjection>("FEDERAL_MONEY", `${source}:US`, options);
  if (result.kind === "PROMOTED") {
    const value = result.value;
    if (value.formatVersion !== 2 || value.source !== source || value.state !== "US" || !Array.isArray(value.states) ||
      new Set(value.states.map(row => row.state)).size !== value.states.length ||
      value.states.some(row => !federalMoneySourceStates(source).includes(row.state) || !["COMPLETE", "BACKFILL", "OUTAGE"].includes(row.status) ||
        row.counts.loaded !== row.counts.joined + row.counts.unjoined) ||
      value.counts.loaded !== value.states.reduce((n, row) => n + row.counts.loaded, 0) ||
      value.counts.joined !== value.states.reduce((n, row) => n + row.counts.joined, 0) ||
      value.counts.unjoined !== value.states.reduce((n, row) => n + row.counts.unjoined, 0)) throw new Error("Federal national acquisition progress is invalid.");
  }
  return result;
}

export async function readFederalMoneyCheckpoint(source: FederalMoneySource, state: string, options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalMoneyCheckpoint>("FEDERAL_MONEY", `${source}:${state}`, options);
  if (result.kind === "PROMOTED") {
    const value = result.value;
    if (value.formatVersion !== 2 || value.source !== source || value.state !== state || !value.checkpoint ||
      value.counts.loaded !== value.counts.joined + value.counts.unjoined || "records" in value)
      throw new Error("Federal state checkpoint is invalid.");
  }
  return result;
}
