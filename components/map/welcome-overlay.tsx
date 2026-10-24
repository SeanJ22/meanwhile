"use client";

import { useEffect, useRef, useState } from "react";
import { ZIP_AREA_MISSING } from "@/lib/geo/postal-core";
import { ZipAddressPrompt } from "./zip-address-prompt";

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
  onPointLocated: (lat: number, lng: number) => void;
  /** Null while no zip is stored: there is nothing behind the card to dismiss into. */
  onDismiss: (() => void) | null;
}

export function WelcomeOverlay({
  open,
  onResolved,
  onAddressLocated,
  onPointLocated,
  onDismiss,
}: WelcomeOverlayProps) {
  const [zip, setZip] = useState("");
  const recents = useRecentZips();
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressZip, setAddressZip] = useState<string | null>(null);
  const choiceRequest = useRef(0);
  useEffect(() => () => { choiceRequest.current++; }, []);

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
      (position) => {
        setLocating(false);
        if (request !== choiceRequest.current) return;
        recordLocationOrigin(null, "DEVICE_LOCATION");
        onPointLocated(position.coords.latitude, position.coords.longitude);
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

  return (
    <div
      className={`welcome-overlay${open ? "" : " hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a location"
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onDismiss) onDismiss();
      }}
    >
      <div className="welcome-card">
        <div className="welcome-lockup">
          <h1 className="welcome-title">
            <Logo variant="wordmark" size={34} />
          </h1>
        </div>
        <hr className="welcome-rule" />

        {/* Mission text pinned by tests/welcome-copy.test.ts. */}
        <div className="welcome-msg space-y-[5px] text-left">
          <p>
            Whether you care about politics or not, politics cares about you.
          </p>
          <p>Government reports to you.</p>
          <p>
            While you were at work, a data center was approved three miles from
            your kids&apos; school. While you were at soccer practice, the
            school board adopted a new AI policy. While you were living an
            ordinary week, decisions about your next four years got made.
          </p>
          <p>
            Not in secret. In public, on a schedule, in a room you were allowed
            to walk into. Nobody told you.
          </p>
          <p>
            Know where it&apos;s happening. Know when it&apos;s happening. Show
            up if you can.
          </p>
          <p>And when you can&apos;t — say something anyway.</p>
        </div>

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

        {onDismiss && (
          <>
            <p className="welcome-divider">or</p>
            <button
              type="button"
              className="welcome-team-btn"
              onClick={onDismiss}
            >
              Keep current view
            </button>
          </>
        )}

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
