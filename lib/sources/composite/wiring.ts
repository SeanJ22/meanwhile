import type { AgendaSourceType } from "../../registry/types.ts";
import {
  meetingSourceNamesForWiring,
  wiringForMeetingSource,
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
import { makePimaEduSource } from "../pima-edu/index.ts";
import { makeRevizeSource } from "../revize/index.ts";
import { makeSchedulePageSource } from "../schedulepage/index.ts";
import { makeOfficialPageEventsSource, officialLinkingPageFrom } from "../official-page-events/index.ts";
import { makeDocumentListingSource } from "../document-listing/index.ts";
import { makeSuiteOneSource } from "../suiteone/index.ts";
import {
  makeLegistarSource,
  normalizeWithDrops as legistarNormalizeWithDrops,
  type LegistarEventWithClient,
} from "../legistar/index.ts";
import { legistarClientsFromWiring } from "../legistar/client-registry.ts";
import { makeLegistarInSiteSource } from "../legistar-insite/index.ts";
import { inSiteTenantsFromWiring } from "../legistar-insite/tenant-registry.ts";
import { makeOnBaseSource } from "../onbase/index.ts";
import type { ReportingMeetingSource } from "../types.ts";

import { feedKindWiringType, installedFeedKinds, makeFeedKindSource } from "../feed-kinds.ts";
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
type ChildFactory = (rows: BodySourceWiring[], fetchImpl?: typeof fetch) => ReportingMeetingSource<unknown>;

/** Add the composite accounting shape without adding a membership registry. */
function legistarReporting(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<LegistarEventWithClient> {
  const clients = legistarClientsFromWiring(rows);
  return {
  ...makeLegistarSource(clients, fetchImpl),
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
    return legistarNormalizeWithDrops(raw, now ?? new Date(), clients);
  },
  };
}

export const CAPABILITIES: Array<{
  /** Must equal the built child's `name` — asserted in buildCompositeSource. */
  name: string;
  types: AgendaSourceType[];
  make: ChildFactory;
}> = [
  {
    name: "legistar",
    types: ["LEGISTAR"],
    make: (rows, fetchImpl) => legistarReporting(rows, fetchImpl) as ReportingMeetingSource<unknown>,
  },
  {
    /**
     * **THE SAME PRODUCT, AN INDEPENDENT ROUTE.** (2026-08-28.)
     *
     * `legistar` above reads `webapi.legistar.com`, which returns only the
     * sittings whose InSite meeting-detail page is publicly viewable. This
     * child reads the tenant's own `Calendar.aspx` grid, which returns all of
     * them. Measured the same day on one "Next Month" filter: Mesa 15 rows / 12
     * not viewable / exactly the 3 viewable from the API, Phoenix 8 / 8 / 0,
     * Pima 3 / 3 / 0.
     *
     * It is registered on the same `LEGISTAR` product type on purpose, but
     * SOURCE_WIRING explicitly selects its body membership. Pima currently
     * declares both independent routes; Mesa declares only InSite. Each
     * selected route/body pair owns a different contract, pointer, and clock.
     *
     * **Registration order is load-bearing.** `collapseDuplicateSittings`
     * breaks a tie in informativeness by keeping the row it saw first, and
     * first is source-registration order. `legistar` sits above this entry so
     * that when an explicitly dual-routed body publishes the same sitting on
     * both routes, the WebAPI record wins the presentation-only duplicate
     * collapse. This ordering never changes either route/body authority
     * partition or its durable receipt.
     */
    name: "legistar-insite",
    types: ["LEGISTAR"],
    make: (rows) => makeLegistarInSiteSource({ tenants: inSiteTenantsFromWiring(rows) }) as ReportingMeetingSource<unknown>,
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
    make: (rows, fetchImpl) => makeDiligentSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
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
    // Pima Community College's own pages — the route that replaced its
    // Diligent tenant (2026-09-23), and carries every sitting the tenant did.
    // Reads and records each host's robots.txt before every run, which blocks
    // nothing since the owner decision of 2026-09-25; see
    // lib/sources/permission-gate.ts.
    name: "pima-edu",
    types: ["PIMA_EDU"],
    make: (rows) => makePimaEduSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    // Not a vendor, a FORMAT. Ladder rung 8: an `.ics` feed is a calendar
    // handed to us, and one parse serves every town that publishes one.
    name: "ical",
    types: ["ICAL"],
    make: (rows, fetchImpl) => makeIcalSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
  },
  {
    // Not a vendor: the body's own official page, read for dated events in
    // every shape it publishes them and verified against the body per event.
    name: "official-page-events",
    types: ["OFFICIAL_PAGE_EVENTS"],
    make: (rows, fetchImpl) =>
      makeOfficialPageEventsSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
  },
  {
    // Not a vendor: a body's own agendas-and-minutes page, whose dated
    // document links ARE its list of sittings. Asks robots.txt every run.
    name: "document-listing",
    types: ["DOCUMENT_LISTING"],
    make: (rows) =>
      makeDocumentListingSource(rows) as ReportingMeetingSource<unknown>,
  },
  {
    // SuiteOne Media's hosted meeting portal: its server-rendered home page.
    // Asks robots.txt every run.
    name: "suiteone",
    types: ["SUITEONE"],
    make: (rows) => makeSuiteOneSource(rows) as ReportingMeetingSource<unknown>,
  },
];

/**
 * The built-in adapters, then the feed kinds an engineer built and installed for this pass (DB-50). Built-in names
 * come first and can never be taken; with no feed kind installed this is `CAPABILITIES` exactly.
 */
export function allCapabilities(): typeof CAPABILITIES {
  const feeds = installedFeedKinds();
  if (feeds.length === 0) return CAPABILITIES;
  return [
    ...CAPABILITIES,
    ...feeds.map((kind) => ({
      name: kind.kind,
      types: [feedKindWiringType(kind.kind) as AgendaSourceType],
      make: ((rows: BodySourceWiring[], fetchImpl?: typeof fetch) => makeFeedKindSource(kind, rows, fetchImpl) as ReportingMeetingSource<unknown>),
    })),
  ];
}

/**
 * The wiring rows a named adapter serves — how a snapshot's "this source
 * failed at the last refresh" becomes "these are the bodies you can't see
 * because of it". An unknown name returns no rows rather than throwing: a
 * snapshot can legitimately name a source this build no longer has.
 */
export function wiringForSourceName(name: string): BodySourceWiring[] {
  return allCapabilities().some((capability) => capability.name === name)
    ? wiringForMeetingSource(name)
    : [];
}

/**
 * Build the composite from the wiring rows. A capability with no wired body
 * contributes no child; a body whose type has no capability is invisible here
 * and stays whatever its coverage audit says — the composite serves sources,
 * it does not invent them.
 */
/**
 * The per-source/body budget a standing-runner child gets (F22, 2026-08-20).
 *
 * `CompositeSource` defaults to 20s, which was written for an interactive
 * diagnostic. A standing acquisition has nobody waiting, and on 2026-08-20
 * that borrowed default walled civicplus while its polite serial requests
 * were still making progress.
 *
 * The historical aggregate writer amplified that timeout across unrelated
 * sources. The permanent runner instead gives each exact route/body child
 * this budget and records only that partition's outcome.
 *
 * This changes no request rate and no politeness: adapters still serialize,
 * still identify themselves, still honour `Retry-After`. It only stops the
 * batch job from abandoning a source the reader's own timeout was written
 * for.
 */
export const STANDING_PARTITION_ACQUISITION_TIMEOUT_MS = 120_000;

export interface MeetingPartitionSelection {
  readonly sourceName: string;
  readonly bodyId: string;
}

export function wiringForSelectedMeetingSource(
  sourceName: string,
  selections?: readonly MeetingPartitionSelection[],
): BodySourceWiring[] {
  const wired = wiringForMeetingSource(sourceName);
  if (selections === undefined) return wired;
  const requested = selections.filter((selection) => selection.sourceName === sourceName);
  for (const selection of requested) {
    if (!wired.some((row) => row.bodyId === selection.bodyId)) {
      throw new Error(`MEETING_PARTITION_SELECTION_NOT_WIRED:${selection.sourceName}:${selection.bodyId}`);
    }
  }
  const selectedBodies = new Set(requested.map((selection) => selection.bodyId));
  return wired.filter((row) => selectedBodies.has(row.bodyId));
}

export function buildCompositeSource(
  options: {
    timeoutMs?: number;
    captureAcquisitionEvidence?: boolean;
    /** A derived family's shared transport for calendars and companion feeds. */
    fetchImpl?: typeof fetch;
    sourceNames?: readonly string[];
    meetingPartitions?: readonly MeetingPartitionSelection[];
    /**
     * A derived meeting family's member rows (C16), read from the promoted meeting-source wiring by the family's
     * own child and authorized at its promotion door. Exclusive of `meetingPartitions`: a family never reads a
     * SOURCE_WIRING row, and a SOURCE_WIRING partition never reads a derived one.
     */
    derivedRows?: readonly BodySourceWiring[];
    /** Already held official pages establish external calendar-host authority. */
    officialPages?: readonly {canonicalUrl:string;text:string}[];
  } = {},
): CompositeSource {
  if (options.derivedRows !== undefined && options.meetingPartitions !== undefined) {
    throw new Error("MEETING_DERIVED_ROWS_AND_PARTITIONS_ARE_EXCLUSIVE");
  }
  if (options.meetingPartitions) {
    for (const selection of options.meetingPartitions) {
      if (!wiringForMeetingSource(selection.sourceName).some((row) => row.bodyId === selection.bodyId)) {
        throw new Error(`MEETING_PARTITION_SELECTION_NOT_WIRED:${selection.sourceName}:${selection.bodyId}`);
      }
    }
  }
  const children: ReportingMeetingSource<unknown>[] = [];
  for (const capability of allCapabilities()) {
    if (options.sourceNames && !options.sourceNames.includes(capability.name)) continue;
    const rows = options.derivedRows !== undefined
      ? options.derivedRows.filter((row) => meetingSourceNamesForWiring(row).includes(capability.name))
      : wiringForSelectedMeetingSource(capability.name, options.meetingPartitions);
    // No wired body, no child — including Legistar, whose own client list is
    // only consulted once a wiring row routes a body to it.
    if (rows.length === 0) continue;
    const child = capability.name === 'official-page-events'
      ? makeOfficialPageEventsSource(rows,options.fetchImpl,url=>officialLinkingPageFrom(url,options.officialPages ?? [])) as ReportingMeetingSource<unknown>
      : capability.make(rows, options.fetchImpl);
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
