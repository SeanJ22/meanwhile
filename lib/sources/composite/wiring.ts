import type { AgendaSourceType } from "../../registry/types.ts";
import {
  wiringForTypes,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import { makeApptegySource } from "../apptegy/index.ts";
import { makeBoardBookSource } from "../boardbook/index.ts";
import { makeCivicPlusSource } from "../civicplus/index.ts";
import { makeClerksBoardsSource } from "../clerksboards/index.ts";
import { makeCivicClerkSource } from "../civicclerk/index.ts";
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
import { makeLegistarInSiteSource } from "../legistar-insite/index.ts";
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
  /**
   * `@accounting-delegated-to lib/sources/legistar/index.ts`
   *
   * Declared rather than inferred — `tests/zero-row-contract.test.ts` reads this
   * marker, and checks that the module it names is itself a branding
   * implementor. See the note inside for what the second branding cost.
   */
  normalizeWithDrops(raw, now) {
    /*
     * RETURNED AS THE ADAPTER BRANDED IT. There is no second branding here,
     * and REMOVING it is the fix rather than a tidy-up.
     *
     * ## What the second branding cost, reproduced before it was removed
     *
     * `accountedNormalize` cancels a tally that is counted in `drops` and then
     * PRODUCED anyway, through its `countedButProduced` option. Legistar has
     * exactly one such tally: `placeless`. A meeting with no physical place is
     * counted under `drops.placeless` — a name D18 kept on purpose so the
     * series stays comparable across every snapshot ever written — and is then
     * KEPT and produced, so the adapter passes `countedButProduced:
     * keptButPlaceless` to cancel it.
     *
     * This wrapper re-branded the same arrays and **did not pass that option**,
     * so every placeless-but-kept meeting was counted once as produced and once
     * as dropped. Against the recorded Pima events fixture — 18 events, 4 of
     * them online — the adapter reports `CONSERVED, 18 of 18` and this wrapper
     * threw `4 more disposition(s) than records`. Against the live feed on
     * 2026-08-25 it was 3, and it took the whole daily refresh red: run
     * 32833989579, `legistar: JOB FAILURE`, `considered 16, accounted for 19`.
     *
     * The comment that used to sit here said the wrapper "judges the same fact
     * twice and cannot disagree with itself". It disagreed with itself for as
     * long as it existed, because the second judgement was missing an argument
     * the first one had — RULING 103's duplicated implementation, living in an
     * accounting rather than in a function.
     *
     * ## Why re-branding is not needed at all any more
     *
     * The stated reason for it was that the drop SHAPES differed: legistar
     * counted three reasons and this contract carries four. A-002 gave the
     * adapter its own `notConfigured` counter, so the shapes agree and there is
     * nothing left to translate. Two accountings of one pass is the thing that
     * can disagree; one cannot.
     */
    return legistarNormalizeWithDrops(raw, now ?? new Date());
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
    /**
     * **THE SAME BODIES, THE OTHER ROUTE.** (2026-08-28.)
     *
     * `legistar` above reads `webapi.legistar.com`, which returns only the
     * sittings whose InSite meeting-detail page is publicly viewable. This
     * child reads the tenant's own `Calendar.aspx` grid, which returns all of
     * them. Measured the same day on one "Next Month" filter: Mesa 15 rows / 12
     * not viewable / exactly the 3 viewable from the API, Phoenix 8 / 8 / 0,
     * Pima 3 / 3 / 0.
     *
     * It is registered on the SAME `LEGISTAR` type on purpose — it serves the
     * same wired bodies, so a failure here attributes to the same bodies a
     * `legistar` failure does, and `wiringForSourceName` resolves both.
     *
     * **Registration order is load-bearing.** `collapseDuplicateSittings`
     * breaks a tie in informativeness by keeping the row it saw first, and
     * first is source-registration order. `legistar` sits above this entry so
     * that when the same sitting reaches both routes — which it does the moment
     * the clerk publishes the agenda — the WebAPI record wins even before it
     * has an agenda file to win on. The portal supplies the rows `/events` does
     * not have; it does not supersede the ones it does.
     */
    name: "legistar-insite",
    types: ["LEGISTAR"],
    make: () => makeLegistarInSiteSource() as ReportingMeetingSource<unknown>,
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
    name: "civicclerk",
    types: ["CIVICCLERK"],
    make: (rows) =>
      makeCivicClerkSource(rows) as ReportingMeetingSource<unknown>,
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
