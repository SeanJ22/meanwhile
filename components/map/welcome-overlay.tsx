"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZIP_AREA_MISSING } from "@/lib/geo/postal-core";
import { ZipAddressPrompt } from "./zip-address-prompt";

import { nearestZctaAsync } from "@/lib/geo/zcta-table";
import { isWellFormedZip, resolveReaderZip } from "@/lib/reader/zip";

import { useRecentZips } from "@/hooks/use-recent-zips";
import { recordLocationOrigin } from "@/lib/state/location-origin";
import type { LocationOrigin } from "@/lib/ask/residency";
import { ZipComb } from "./zip-comb";
import { Logo } from "@/components/brand/logo";

/**
 * The entry overlay: a dimmed sheet over the map with one card, a ZIP input
 * and a location action.
 */

/** An unplaced ZIP is our coverage gap, with street-address entry ready. */
const MESSAGES = {
  malformed: "A zip code is five digits.",
  uncovered: ZIP_AREA_MISSING,
} as const;

interface WelcomeOverlayProps {
  open: boolean;
  onResolved: (zip: string, lat: number, lng: number) => void;
  onAddressLocated: (zip: string, lat: number, lng: number) => void;
  onDismiss: () => void;
}

export function WelcomeOverlay({
  open,
  onResolved,
  onAddressLocated,
  onDismiss,
}: WelcomeOverlayProps) {
  const [zip, setZip] = useState("");
  const recents = useRecentZips();
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressZip, setAddressZip] = useState<string | null>(null);
  const choiceRequest = useRef(0);
  useEffect(() => () => { choiceRequest.current++; }, []);
  const dismiss = useCallback(() => {
    choiceRequest.current++;
    setLocating(false);
    onDismiss();
  }, [onDismiss]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  /*
   * Records how the zip was given (typed, tapped, device location). Only this
   * card knows the act; `stampResidency` on the server decides what it proves.
   */
  async function submit(value: string = zip, origin: LocationOrigin = "TYPED_ZIP") {
    const request = ++choiceRequest.current;
    const result = await resolveReaderZip(value).catch(() => ({ ok: false, reason: "uncovered" } as const));
    if (request !== choiceRequest.current) return;

    if (!result.ok) {
      setError(MESSAGES[result.reason]);
      setAddressZip(result.reason === "uncovered" ? value.trim() : null);
      return;
    }

    setError(null);
    setAddressZip(null);
    setZip("");
    recordLocationOrigin(result.centroid.zip, origin);
    onResolved(result.centroid.zip, result.centroid.lat, result.centroid.lng);
  }

  function useMyLocation() {
    const request = ++choiceRequest.current;
    setError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser can't share a location.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setLocating(false);
        const near = await nearestZctaAsync(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (request !== choiceRequest.current) return;
        if (!near) {
          setError("Couldn't match that location to a zip code.");
          return;
        }
        /* A device fix proves presence, never residence. */
        recordLocationOrigin(near.zip, "DEVICE_LOCATION");
        onResolved(near.zip, near.lat, near.lng);
      },
      (err) => {
        if (request !== choiceRequest.current) return;
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enter a zip instead."
            : "Couldn't get a location. Enter a zip instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  if (!open) return null;

  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a location"
    >
      <div className="welcome-card">
        <div className="welcome-lockup">
          <h1 className="welcome-title">
            <Logo variant="wordmark" size={34} />
          </h1>
        </div>
        <hr className="welcome-rule" />

        <p className="welcome-msg">Understand your government, find meetings, and have your say.</p>

        <p className="welcome-start">Start where you live</p>

        <div className="welcome-field">
          <ZipComb
            value={zip}
            onChange={(next) => {
              choiceRequest.current++;
              setLocating(false);
              setZip(next);
              setAddressZip(null);
              if (error) setError(null);
            }}
            onSubmit={() => void submit()}
            invalid={Boolean(error)}
            describedBy={error ? "welcome-error" : "welcome-fineprint"}
            autoFocus={open}
          />
          <p id="welcome-error" role="alert" className="welcome-error">
            {error ?? ""}
          </p>
        </div>

        {addressZip && <ZipAddressPrompt zip={addressZip} onLocated={onAddressLocated} />}

        <button
          type="button"
          className="welcome-submit"
          disabled={!isWellFormedZip(zip)}
          onClick={() => void submit()}
        >
          Show meetings
        </button>

        {/* The reader's own recent places first; none of them resolves a district. */}
        {recents.length > 0 && (
          <>
            <p className="welcome-divider">Pick up where you left off</p>
            <div className="welcome-teams">
              {recents.map((zip) => (
                <button
                  key={zip}
                  type="button"
                  className="welcome-team-btn"
                  /* Recents mix origins and nothing recorded which. */
                  onClick={() => void submit(zip, "UNKNOWN")}
                >
                  {zip}
                </button>
              ))}
            </div>
          </>
        )}

        <p id="welcome-fineprint" className="welcome-fineprint">Any U.S. zip works.</p>

        <button
          type="button"
          className="welcome-opps-btn"
          onClick={useMyLocation}
          disabled={locating}
        >
          {locating ? "Locating…" : "Use my location"}
        </button>

        <button type="button" className="welcome-team-btn" onClick={dismiss}>
          Skip, show me the map
        </button>

        <p className="welcome-fineprint">
          <a
            href="/transparency"
            className="underline decoration-dotted underline-offset-2 hover:text-signal"
          >
            What this site collects
          </a>
        </p>
      </div>
    </div>
  );
}
