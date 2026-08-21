import type { AgendaSourceType } from "../../registry/types.ts";
import {
  wiringForTypes,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import { makeApptegySource } from "../apptegy/index.ts";
import { makeBoardBookSource } from "../boardbook/index.ts";
import { makeCivicPlusSource } from "../civicplus/index.ts";
import { makeClerksBoardsSource } from "../clerksboards/index.ts";
import { makeDiligentSource } from "../diligent/index.ts";
import { makeIcalSource } from "../ical/index.ts";
import { makeIqm2Source } from "../iqm2/index.ts";
import { makeRevizeSource } from "../revize/index.ts";
import { makeSchedulePageSource } from "../schedulepage/index.ts";
import {
  legistarSource,
  normalizeWithDrops as legistarNormalizeWithDrops,
  type LegistarEventWithClient,
} from "../legistar/index.ts";
import { makeOnBaseSource } from "../onbase/index.ts";
import type { ReportingMeetingSource } from "../types.ts";

import { CompositeSource } from "./index.ts";
import { accountedNormalize } from "../normalize-account.ts";

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
    // Re-branded because the drop shape changes here — legistar counts three
    // reasons, the composite's contract carries four. Same input array, so the
    // factory judges the same fact twice and cannot disagree with itself.
    return accountedNormalize("legistar", raw, {
      meetings,
      drops: { ...drops, notConfigured: 0 },
    });
  },
};

export const CAPABILITIES: Array<{
  /** Must equal the built child's `name` — asserted in buildCompositeSource. */
  name: string;
  types: AgendaSourceType[];
  make: ChildFactory;
}> = [
  {
    name: "legistar",
    types: ["LEGISTAR"],
    make: () => legistarReporting as ReportingMeetingSource<unknown>,
  },
  {
    name: "civicplus",
    types: ["CIVICPLUS"],
    make: (rows) => makeCivicPlusSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "onbase",
    types: ["ONBASE"],
    make: (rows) => makeOnBaseSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "apptegy",
    types: ["APPTEGY"],
    make: (rows) => makeApptegySource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "diligent",
    types: ["DILIGENT", "CIVICWEB"],
    make: (rows) => makeDiligentSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "clerksboards",
    types: ["CLERKSBOARDS"],
    make: (rows) =>
      makeClerksBoardsSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "boardbook",
    types: ["BOARDBOOK"],
    make: (rows) => makeBoardBookSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "iqm2",
    types: ["IQM2"],
    make: (rows) => makeIqm2Source(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "revize",
    types: ["REVIZE"],
    make: (rows) => makeRevizeSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    name: "schedulepage",
    types: ["SCHEDULEPAGE"],
    make: (rows) =>
      makeSchedulePageSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    // Not a vendor, a FORMAT. Ladder rung 8: an `.ics` feed is a calendar
    // handed to us, and one parse serves every town that publishes one.
    name: "ical",
    types: ["ICAL"],
    make: (rows) => makeIcalSource(rows) as ReportingMeetingSource<unknown>,
  },
];

/**
 * The wiring rows a named adapter serves — how a snapshot's "this source
 * failed at the last refresh" becomes "these are the bodies you can't see
 * because of it". An unknown name returns no rows rather than throwing: a
 * snapshot can legitimately name a source this build no longer has.
 */
export function wiringForSourceName(name: string): BodySourceWiring[] {
  const capability = CAPABILITIES.find((c) => c.name === name);
  return capability ? wiringForTypes(capability.types) : [];
}

/**
 * Build the composite from the wiring rows. A capability with no wired body
 * contributes no child; a body whose type has no capability is invisible here
 * and stays whatever its coverage audit says — the composite serves sources,
 * it does not invent them.
 */
/**
 * The per-source budget a SCHEDULED refresh gets (F22, 2026-08-20).
 *
 * `CompositeSource` defaults to 20s, which is right for the live map: a
 * reader is waiting, and a source that has not answered in twenty seconds is
 * better reported as unreachable than left spinning. A four-times-a-day batch
 * job has nobody waiting, and on 2026-08-20 that borrowed default is what
 * walled civicplus — it serializes an iCal GET and an AgendaCenter GET per
 * wired body, at the polite spacing every adapter honours, and ran past
 * twenty seconds. Nothing was refusing us; we hung up.
 *
 * The cost of that hang-up was not one source: carry-forward clipped 23 of
 * Rockaway Township's archived sittings (F23), the gate's floor caught the
 * shortfall, and the whole refresh went red with ten healthy sources' fresh
 * data uncommitted.
 *
 * This changes no request rate and no politeness: adapters still serialize,
 * still identify themselves, still honour `Retry-After`. It only stops the
 * batch job from abandoning a source the reader's own timeout was written
 * for.
 */
export const SCHEDULED_REFRESH_TIMEOUT_MS = 120_000;

export function buildCompositeSource(
  options: { timeoutMs?: number } = {},
): CompositeSource {
  const children: ReportingMeetingSource<unknown>[] = [];
  for (const capability of CAPABILITIES) {
    const rows = wiringForTypes(capability.types);
    // No wired body, no child — including Legistar, whose own client list is
    // only consulted once a wiring row routes a body to it.
    if (rows.length === 0) continue;
    const child = capability.make(rows);
    if (child.name !== capability.name) {
      // The capability name is what maps a snapshot's per-source report back
      // to the bodies it serves; a drift here would misattribute failures.
      throw new Error(
        `capability "${capability.name}" built a child named "${child.name}"`,
      );
    }
    children.push(child);
  }
  return new CompositeSource(children, options);
}
