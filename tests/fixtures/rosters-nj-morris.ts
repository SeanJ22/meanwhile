import { bodyRosterFixture } from "./held-record-shapes.ts";
import DATA from "./rosters-nj-morris.json" with { type: "json" };

/** Immutable generated roster snapshot; original generation and source notes remain with the data. */
export const NJ_MORRIS_ROSTERS = bodyRosterFixture(DATA.rosters);
