"use client";

import { useState } from "react";

import { isWellFormedZip, nearestZcta, resolveZip } from "@/lib/geo/zcta";

import { ZipComb } from "./zip-comb";

/**
 * The entry overlay.
 *
 * Ports EdiaStratMap's welcome card: a dimmed, blurred sheet over the map with
 * a single card on it, quick-jump buttons, and one secondary action. Replaces
 * the old full-width entry notice.
 *
 * It stays a modal over the whole screen rather than a panel beside the map,
 * because the map behind it has nothing on it yet — offering a sidebar full of
 * filters over an empty map is offering to filter nothing.
 */

/** The three ways lib/geo/zcta.ts can fail, each with its own message. They
 *  are genuinely different situations and collapsing them into "invalid zip"
 *  tells two thirds of the people who hit one the wrong thing. */
const MESSAGES = {
  malformed: "A zip code is five digits.",
  unknown: "No such zip code. Check the digits.",
  uncovered:
    "That zip isn't in our copy of the Census zip list yet. Try a nearby one.",
} as const;

/** The four zips with meeting fixtures behind them. */
const QUICK_ZIPS = ["85701", "85641", "07866", "03255"] as const;

interface WelcomeOverlayProps {
  open: boolean;
  onResolved: (zip: string, lat: number, lng: number) => void;
  /** Null while no zip is stored: the card cannot be dismissed into an empty
   *  map, so the close affordance only exists once there is something behind
   *  it to go back to. */
  onDismiss: (() => void) | null;
}

export function WelcomeOverlay({
  open,
  onResolved,
  onDismiss,
}: WelcomeOverlayProps) {
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function submit(value: string = zip) {
    const result = resolveZip(value);

    if (!result.ok) {
      setError(MESSAGES[result.reason]);
      return;
    }

    setError(null);
    setZip("");
    onResolved(result.centroid.zip, result.centroid.lat, result.centroid.lng);
  }

  function useMyLocation() {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser can't share a location.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const near = nearestZcta(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (!near) {
          setError("Couldn't match that location to a zip code.");
          return;
        }
        onResolved(near.zip, near.lat, near.lng);
      },
      (err) => {
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
        <svg
          className="welcome-icon"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>

        <h1 className="welcome-title">We the People</h1>
        <p className="welcome-subtitle">Notice of public meetings</p>

        <p className="welcome-msg">
          Councils, boards, and commissions decide what happens on your street,
          in rooms anyone can walk into. Enter a zip code to see which ones are
          meeting near you.
        </p>

        <div className="welcome-field">
          <ZipComb
            value={zip}
            onChange={(next) => {
              setZip(next);
              if (error) setError(null);
            }}
            onSubmit={() => submit()}
            invalid={Boolean(error)}
            describedBy={error ? "welcome-error" : "welcome-fineprint"}
            autoFocus={open}
          />
          <p id="welcome-error" role="alert" className="welcome-error">
            {error ?? ""}
          </p>
        </div>

        <button
          type="button"
          className="welcome-submit"
          disabled={!isWellFormedZip(zip)}
          onClick={() => submit()}
        >
          Show meetings
        </button>

        <p className="welcome-divider">Or jump to</p>

        <div className="welcome-teams">
          {QUICK_ZIPS.map((quick) => (
            <button
              key={quick}
              type="button"
              className="welcome-team-btn"
              onClick={() => submit(quick)}
            >
              {quick}
            </button>
          ))}
        </div>

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

        <p id="welcome-fineprint" className="welcome-fineprint">
          A zip code points the map somewhere. It can&apos;t tell us your
          districts — zip boundaries run straight through cities, counties, and
          school districts. Using your location does the same thing: it finds
          the nearest zip, and is no more authoritative for having come from
          GPS. If you later want the ballot you personally vote, we&apos;ll ask
          for a street address and explain why then.
        </p>

        <p className="welcome-fineprint">
          Searches here are logged without any identity attached —{" "}
          <a
            href="/transparency"
            className="underline decoration-dotted underline-offset-2 hover:text-signal"
          >
            what this site collects
          </a>
          .
        </p>
      </div>
    </div>
  );
}
