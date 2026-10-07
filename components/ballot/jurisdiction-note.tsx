import { AddressPrompt } from "@/components/address/address-prompt";

/**
 * One page-level note naming the jurisdictions this zip only partly covers,
 * with the address prompt, instead of a pill on every affected contest. Each
 * affected contest carries a short mark tying it back here. It never gates
 * anything: every contest still renders in full.
 */

/** The mark an affected contest heading carries, tying it to the block. */
export const JURISDICTION_MARK = "◆";

/** The block's copy, assembled once. */
export const JURISDICTION_NOTE_HEADING = "Some of these are decided by only part of your zip code";

export function JurisdictionMark() {
  return (
    <sup>
      <a
        href="#jurisdiction-note"
        title={JURISDICTION_NOTE_HEADING}
        aria-label={JURISDICTION_NOTE_HEADING}
        className="ml-0.5 align-super t-caption text-signal no-underline"
        data-jurisdiction-mark="true"
      >
        {JURISDICTION_MARK}
      </a>
    </sup>
  );
}

/**
 * The page-level block. Rendered once, above the contests, and only when at
 * least one contest is affected — a note about nothing is noise.
 *
 * `jurisdictions` is the list of body names this zip only partly covers, in the
 * order they appear on the page, deduplicated by the caller.
 */
export function JurisdictionNote({
  jurisdictions,
  unplaceable = 0,
  zip,
  onResolved,
  onPoint,
}: {
  /** Scopes the address prompt that ends the block. */
  zip: string;
  onResolved?: React.ComponentProps<typeof AddressPrompt>["onResolved"];
  onPoint?: React.ComponentProps<typeof AddressPrompt>["onPoint"];
  /** Bodies MEASURED as covering only part of this zip. Named outright. */
  jurisdictions: readonly string[];
  /**
   * Contests on a division with no boundary measurement for this zip
   * (`UNKNOWN`, not `AMBIGUOUS`). Counted, never named: naming them would
   * claim a partial coverage we never measured.
   */
  unplaceable?: number;
}) {
  if (jurisdictions.length === 0 && unplaceable === 0) return null;
  return (
    <section
      id="jurisdiction-note"
      data-jurisdiction-note="true"
      className="mt-5 rounded-[10px] border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-4"
    >
      <h2 className="t-heading font-semibold leading-snug text-paper">
        <span aria-hidden="true" className="mr-1.5 text-signal">
          {JURISDICTION_MARK}
        </span>
        {JURISDICTION_NOTE_HEADING}
      </h2>
      <p className="mt-1.5 t-body leading-relaxed text-voice">
        A zip code is a mail route, not a boundary — this one crosses several
        governments, and each of the contests marked{" "}
        <span aria-hidden="true" className="text-signal">
          {JURISDICTION_MARK}
        </span>{" "}
        below is decided by one of them rather than by all of you. We hold every
        one of these races in full; what we cannot tell from a zip code alone is
        which of them is yours.
      </p>
      {jurisdictions.length > 0 && (
        <p className="mt-2 t-body leading-relaxed text-voice">
          The ones that cover only part of this zip:{" "}
          <span className="font-semibold text-paper">{jurisdictions.join(", ")}</span>.
        </p>
      )}
      <div className="mt-3">
        <AddressPrompt
          zip={zip}
          trigger="Want to narrow it? Put in your address"
          onResolved={onResolved}
          onPoint={onPoint}
        />
      </div>
    </section>
  );
}
