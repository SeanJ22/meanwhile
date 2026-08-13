import type { AgendaSourceType } from "../../registry/types.ts";
import {
  wiringForTypes,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import { makeApptegySource } from "../apptegy/index.ts";
import { makeCivicPlusSource } from "../civicplus/index.ts";
import { makeDiligentSource } from "../diligent/index.ts";
import {
  legistarSource,
  normalizeWithDrops as legistarNormalizeWithDrops,
  type LegistarEventWithClient,
} from "../legistar/index.ts";
import { makeOnBaseSource } from "../onbase/index.ts";
import type { ReportingMeetingSource } from "../types.ts";

import { CompositeSource } from "./index.ts";

/**
 * Which adapter serves which `AgendaSourceType` — the capability registry
 * (§0b).
 *
 * **Registering a new adapter is one entry here. Adding a body is a row in
 * `lib/registry/source-wiring.ts`, never code.** The two halves are kept
 * apart deliberately: this file knows about software, the wiring rows know
 * about governments, and at 90,000 governments only the second may grow.
 *
 * `DILIGENT` and `CIVICWEB` both dispatch to the Diligent adapter — different
 * products to a clerk, one wire format (`MeetingsService.svc`). They stay
 * distinct types on the body rows because collapsing them would erase which
 * portal a body actually runs, which is precisely the mistake CivicWeb ≠
 * CivicPlus already guards against.
 */
type ChildFactory = (rows: BodySourceWiring[]) => ReportingMeetingSource<unknown>;

/** Legistar keeps its own client registry; wrap it with the reporting shape. */
const legistarReporting: ReportingMeetingSource<LegistarEventWithClient> = {
  ...legistarSource,
  normalizeWithDrops(raw, now) {
    const { meetings, drops } = legistarNormalizeWithDrops(
      raw,
      now ?? new Date(),
    );
    return { meetings, drops: { ...drops, notConfigured: 0 } };
  },
};

const CAPABILITIES: Array<{
  types: AgendaSourceType[];
  make: ChildFactory;
}> = [
  {
    types: ["LEGISTAR"],
    make: () => legistarReporting as ReportingMeetingSource<unknown>,
  },
  {
    types: ["CIVICPLUS"],
    make: (rows) => makeCivicPlusSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    types: ["ONBASE"],
    make: (rows) => makeOnBaseSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    types: ["APPTEGY"],
    make: (rows) => makeApptegySource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    types: ["DILIGENT", "CIVICWEB"],
    make: (rows) => makeDiligentSource(rows) as ReportingMeetingSource<unknown>,
  },
];

/**
 * Build the composite from the wiring rows. A capability with no wired body
 * contributes no child; a body whose type has no capability is invisible here
 * and stays whatever its coverage audit says — the composite serves sources,
 * it does not invent them.
 */
export function buildCompositeSource(): CompositeSource {
  const children: ReportingMeetingSource<unknown>[] = [];
  for (const capability of CAPABILITIES) {
    const rows = wiringForTypes(capability.types);
    // No wired body, no child — including Legistar, whose own client list is
    // only consulted once a wiring row routes a body to it.
    if (rows.length === 0) continue;
    children.push(capability.make(rows));
  }
  return new CompositeSource(children);
}
