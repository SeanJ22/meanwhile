"use client";

import { useEffect, useRef, useState } from "react";
import { recordLocationOrigin } from "@/lib/state/location-origin";
import type { LocationOrigin } from "@/lib/ask/residency";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import { useRecentZips } from "@/hooks/use-recent-zips";
import { lookupZctaAsync, warmZctaTable } from "@/lib/geo/zcta-table";

/**
 * Changing zip without opening the drawer (item 3, 2026-08-15).
 *
 * The author: changing zips meant opening the sidebar, finding CHANGE, and
 * going through the welcome card — three surfaces to do the single most
 * common thing a reader does twice. This is the fast path: the zip in the
 * floater is a button, and it opens five digits' worth of input with the
 * device's recent zips underneath at one tap each.
 *
 * It is a *fast* path, never a second source of truth: it resolves through
 * the same `lookupZcta` and calls the same `onPick` the welcome card does, so
 * a zip entered here and a zip entered there produce the identical state.
 * The recents are device-local (`use-recent-zips.ts`) and go nowhere.
 */
export function ZipSwitcher({
  current,
  onPick,
  onClose,
}: {
  current: string | null;
  onPick: (zip: string, lat: number, lng: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recents = useRecentZips();

  useDismissOnOutside(rootRef, onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // P-002 · the switcher is opened deliberately, so warming it on open puts
  // the fetch entirely inside the time the reader spends choosing.
  useEffect(() => {
    warmZctaTable();
  }, []);

  const take = async (zip: string, origin: LocationOrigin = "TYPED_ZIP") => {
    const found = await lookupZctaAsync(zip);
    if (!found) {
      // The honest failure, in the reader's terms: we do not hold a centroid
      // for this zip, which is a fact about our data and not about the zip.
      setError(`We don't have a location on file for ${zip}.`);
      return;
    }
    /* The ACT, never the conclusion it licenses — `stampResidency` on the
       server decides what a typed zip is worth. The default is TYPED_ZIP
       because `submit` is the typing path; the recents list below passes
       UNKNOWN, for the reason the welcome card's recents do. */
    recordLocationOrigin(found.zip, origin);
    onPick(found.zip, found.lat, found.lng);
    onClose();
  };

  const submit = () => {
    const zip = text.trim();
    if (!/^\d{5}$/.test(zip)) {
      setError("A zip code is five digits.");
      return;
    }
    void take(zip);
  };

  // The current zip is where the reader already is; offering it as a
  // destination is a button that does nothing.
  const others = recents.filter((z) => z !== current);

  return (
    <div ref={rootRef} className="reader-lumen-surface zip-switcher panel" role="dialog" aria-label="Change zip">
      <p className="t-eyebrow text-paper-dim">Show me</p>
      <div className="zip-switcher-entry">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          value={text}
          placeholder={current ?? "zip code"}
          aria-label="Zip code"
          onChange={(e) => {
            setText(e.target.value.replace(/\D/g, "").slice(0, 5));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button type="button" onClick={submit} disabled={text.length !== 5}>
          Go
        </button>
      </div>

      {error && <p className="zip-switcher-error">{error}</p>}

      {others.length > 0 && (
        <>
          <p className="zip-switcher-label">Recent on this device</p>
          <div className="zip-switcher-recents">
            {others.map((zip) => (
              /* Recents mix origins and nothing recorded which. UNKNOWN. */
              <button key={zip} type="button" onClick={() => void take(zip, "UNKNOWN")}>
                {zip}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
