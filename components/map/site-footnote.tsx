import { DataFreshness } from "@/components/map/data-freshness";
import type { SnapshotStatus } from "@/lib/meetings/freshness";

/**
 * **LAY-8 (2026-08-25, the author's annotated capture `08-53-15`) — the
 * product's own footnotes, all of them at the foot.**
 *
 * His red dotted arrow runs from the "What this site collects / Feedback"
 * block, which sat mid-rail, down past the rail's bottom edge to the "Last
 * checked" line. These are the same KIND of thing — quiet standing provenance
 * about the product rather than about a government — and the rail is the
 * column a reader is trying to get through.
 *
 * ## Why the links render unconditionally and the freshness line does not
 *
 * `DataFreshness` describes a SNAPSHOT, so with no snapshot there is nothing
 * for it to say and it renders nothing. The two links describe the PRODUCT and
 * are true at every zip, before any search, and when every source has failed.
 *
 * Gating them on the snapshot would have been the easy version of this move —
 * one component, one condition — and it would have deleted the transparency
 * link from the entry screen, which is the one screen where a reader who has
 * given nothing yet might want to read what we collect BEFORE giving it. The
 * disclosure rule puts the notice at the point of capture; this is the link
 * that lets somebody find it earlier than that.
 */
export function SiteFootnote({
  snapshot,
}: {
  snapshot: SnapshotStatus | null | undefined;
}) {
  return (
    <div className="site-footnote pointer-events-auto max-w-md">
      {snapshot && <DataFreshness snapshot={snapshot} />}
      <p className="t-caption leading-relaxed text-muted">
        <a
          href="/transparency"
          className="underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          What this site collects
        </a>
        {" · "}
        {/* R40 (2026-08-17): the author's personal address left the product.
            It is one in-app route now — nothing leaves the app to reach him,
            and no scraper reads an address off a shipped page. */}
        <a
          href="/feedback"
          className="underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          Feedback
        </a>
      </p>
    </div>
  );
}
