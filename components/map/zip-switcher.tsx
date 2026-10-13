"use client";

import { useEffect, useRef, useState } from "react";
import { recordLocationOrigin } from "@/lib/state/location-origin";
import type { LocationOrigin } from "@/lib/ask/residency";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import { useRecentZips } from "@/hooks/use-recent-zips";
import { lookupZctaAsync, warmZctaTable } from "@/lib/geo/zcta-table";
import { ZIP_AREA_MISSING } from "@/lib/geo/postal-core";
import { ZipAddressPrompt } from "./zip-address-prompt";

/**
 * Changing zip from the floater: five digits of input with the device's recent
 * zips underneath. Resolves through the same `lookupZcta` and `onPick` as the
 * welcome card; recents are device-local (`use-recent-zips.ts`).
 */
export function ZipSwitcher({
  current,
  onPick,
  onAddressLocated,
  onClose,
  embedded = false,
}: {
  current: string | null;
  onPick: (zip: string, lat: number, lng: number) => void;
  onAddressLocated: (zip: string, lat: number, lng: number) => void;
  onClose: () => void;
  /** Inside the design ZIP popup, which owns dismissal and the title. */
  embedded?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addressZip, setAddressZip] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recents = useRecentZips();

  useDismissOnOutside(rootRef, onClose, !embedded);

  useEffect(() => {
    // preventScroll: inside a popup over an overflow-hidden map, a scrolling
    // focus shifts the whole screen sideways on a phone.
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  // Warm the lookup on open, while the reader is choosing.
  useEffect(() => {
    warmZctaTable();
  }, []);

  const take = async (zip: string, origin: LocationOrigin = "TYPED_ZIP") => {
    const found = await lookupZctaAsync(zip).catch(() => null);
    if (!found) {
      // A fact about our data, not about the zip.
      setError(ZIP_AREA_MISSING);
      setAddressZip(zip);
      return;
    }
    /* Records what the reader did; the server's `stampResidency` decides what it is worth. */
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

  // The current zip is not offered as a destination.
  const others = recents.filter((z) => z !== current);

  return (
    <div
      ref={rootRef}
      className={embedded ? "zip-switcher mw-zip-switcher" : "zip-switcher panel"}
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : "Change zip"}
    >
      {!embedded && <p className="t-eyebrow text-paper-dim">Show me</p>}
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
            setAddressZip(null);
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
      {addressZip && <ZipAddressPrompt zip={addressZip} onLocated={onAddressLocated} />}

      {others.length > 0 && (
        <>
          <p className="zip-switcher-label">{embedded ? "Recent" : "Recent on this device"}</p>
          <div className="zip-switcher-recents">
            {others.map((zip) => (
              /* Recents mix origins and nothing recorded which. */
              <button key={zip} type="button" onClick={() => void take(zip, "UNKNOWN")}>
                {zip}
              </button>
            ))}
          </div>
        </>
      )}
      {embedded && (
        <p className="mw-pop-note">
          A ZIP is orientation, not your exact districts or ballot.
        </p>
      )}
    </div>
  );
}
