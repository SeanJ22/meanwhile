import type { AgendaSourceType } from "../../registry/types.ts";
import {
  meetingSourceNamesForWiring,
  wiringForMeetingSource,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import { makeApptegySource } from "../apptegy/index.ts";
import { makeBoardBookSource } from "../boardbook/index.ts";
import { makeMunicodeSource } from "../municode/index.ts";
import { makeBoardDocsSource } from "../boarddocs/index.ts";
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

type ChildFactory = (rows: BodySourceWiring[], fetchImpl?: typeof fetch) => ReportingMeetingSource<unknown>;

/** Add the composite accounting shape without adding a membership registry. */
function legistarReporting(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<LegistarEventWithClient> {
  const clients = legistarClientsFromWiring(rows);
  return {
  ...makeLegistarSource(clients, fetchImpl),
  /* @accounting-delegated-to lib/sources/legistar/index.ts` */
  normalizeWithDrops(raw, now) {
    // Returned as the adapter branded it. A second branding here would judge the same pass twice and could
    // disagree with the first (it would not pass the adapter's `countedButProduced` for kept placeless
    // meetings); the drop shapes already agree, so nothing needs translating.
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

    name: "legistar-insite",
    types: ["LEGISTAR"],
    make: (rows) => makeLegistarInSiteSource({ tenants: inSiteTenantsFromWiring(rows) }) as ReportingMeetingSource<unknown>,
  },
  {
    name: "civicplus",
    types: ["CIVICPLUS"],
    make: (rows, fetchImpl) => makeCivicPlusSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
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
    name: "municode", types: ["MUNICODE"],
    make: (rows, fetchImpl) => makeMunicodeSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
  },
  {
    name: "boarddocs", types: ["BOARDDOCS"],
    make: (rows, fetchImpl) => makeBoardDocsSource(rows, fetchImpl) as ReportingMeetingSource<unknown>,
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
    // A college's own pages. Reads and records each host's robots.txt before every run, which blocks nothing;
    // see lib/sources/permission-gate.ts.
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

export function wiringForSourceName(name: string): BodySourceWiring[] {
  return allCapabilities().some((capability) => capability.name === name)
    ? wiringForMeetingSource(name)
    : [];
}

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
