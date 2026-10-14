import type { BodyRoster } from "../../lib/registry/body-rosters.ts";
import HOLDINGS from "../../data/states/az/officials/cawcd-rosters.json" with { type: "json" };

/** Typed consumer of the canonical state holding. */
export const AZ_CAWCD_ROSTERS: BodyRoster[] = HOLDINGS.records.AZ_CAWCD_ROSTERS as BodyRoster[];
