/**
 * Fleet operations map — panel metadata and the field-mapping annotations.
 *
 * These strings are DESIGN annotations (transcribed from the approved "Admin Fleet
 * Operations Map" canvas), not live data. They label which panels have a producer
 * today (`WIRED`) and which do not (`NO_PRODUCER`), map each panel to the exact
 * contract field it reads, and carry the honesty note the design attaches. The map
 * component fills WIRED panels from the REAL FleetOperationsReport; NO_PRODUCER
 * panels render the honest empty statement and never a placeholder.
 *
 * Unlike the design canvas — which was a hand-made FIXTURE — this component reads the
 * real report through the existing owner-snapshot transport, so it carries no
 * "illustrative fixture" label. Where the report is unavailable it says so; it never
 * fills an unavailable measurement in.
 */

export type PanelProducer = "WIRED" | "PARTIAL" | "NO_PRODUCER";

export interface FleetMapPanelMeta {
  readonly id: "receipts" | "served" | "spending" | "coverage" | "throughput" | "demand";
  readonly title: string;
  readonly producer: PanelProducer;
  /** Short producer label shown as a badge. */
  readonly status: string;
  /** The contract field(s) this panel reads — shown in the field-mapping view. */
  readonly field: string;
  /** The honesty note the design attaches, or null. */
  readonly note: string | null;
}

export const FLEET_MAP_PANELS: readonly FleetMapPanelMeta[] = [
  {
    id: "receipts", title: "Promotion receipts", producer: "WIRED", status: "Wired · needs host files",
    field:
      "FleetOperationsReport.receiptLoading (ReadOutcome<fleet-receipt-loading/v1>) → .value.entries[]{receiptId, target, state, observedAt, lastSuccessfulReadAt, gaps} · .value.limits · .value.truncated. Loader IMPLEMENTED; served reads arrive through the owner snapshot (receiptSource.kind OWNER_SNAPSHOT). Deploy-time file availability on the authorised host is an operational prerequisite, not a missing loader.",
    note:
      "LOADED means a valid file was read and bound to its summary. It does not mean promotion or verification passed. A retained success never makes a failed refresh look verified.",
  },
  {
    id: "served", title: "Served publication", producer: "NO_PRODUCER", status: "No producer · by design",
    field:
      "operations.value[].publication.{status, reason} · WIRED as a refusal. Served-reader proof: NO PRODUCER. Do not render stage counts as a publication figure and do not compute a percentage from them.",
    note:
      "publication.status is the literal string UNKNOWN and its reason names the missing join. This panel stays empty until served-reader proof exists as evidence.",
  },
  {
    id: "spending", title: "Spending", producer: "PARTIAL", status: "Partial · unmeasured",
    field:
      "operations.value[].spending.{usd: MeasuredTotal, costEntryCount, attemptsWithoutCostEntry[]} · WIRED. MeasuredTotal separates a measured amount from an unmeasured remainder — render both halves. A single total is a false figure.",
    note:
      "Never print $0. The known subtotal being zero and the total being unknown are different statements, and the difference is the whole point of MeasuredTotal.",
  },
  {
    id: "coverage", title: "Coverage gaps", producer: "WIRED", status: "Wired · historical stamps",
    field:
      "FleetOperationsReport.coverageGaps (ReadOutcome<{publishedAt, zipRows}>) · WIRED, from the existing ZIP reader instrument. It is explicitly NOT the ZIP completion denominator. Held-corpus reuse never establishes full source-universe coverage.",
    note:
      "Tier and corpus stamps are historical; population qualification and live readiness are unresolved, and current freshness is unknown. Held-corpus reuse is reuse, not coverage.",
  },
  {
    id: "throughput", title: "Throughput over time", producer: "NO_PRODUCER", status: "No producer",
    field:
      "NO PRODUCER. Building this needs a new persisted snapshot series, which is a backend dependency and not a rendering task. Named, not faked.",
    note: null,
  },
  {
    id: "demand", title: "Reader demand", producer: "NO_PRODUCER", status: "No producer",
    field: "NO PRODUCER. Do not add a placeholder chart here. An empty panel with this sentence is the honest render.",
    note: null,
  },
] as const;

export const FLEET_MAP_CONTRACTS = "fleet-operations/v1 · extensions/1 · fleet-delivery/v1 · fleet-receipt-loading/v1";
