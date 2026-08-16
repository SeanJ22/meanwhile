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

/**
 * The four zips with live sources behind them — the product's depth-first
 * coverage (docs/state.md §9). Labeled by place, because a tester should not
 * have to know a zip code to see the product work.
 */
const QUICK_ZIPS = [
  { zip: "85701", label: "Tucson, AZ" },
  { zip: "85641", label: "Vail, AZ" },
  { zip: "07866", label: "Rockaway Twp., NJ" },
  { zip: "03255", label: "Newbury, NH" },
] as const;

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

        {/*
          6e2 (2026-08-15, the author): "NOTICE OF PUBLIC MEETINGS" is gone.
          It undersold the mission text doing the real work below it —
          institutional boilerplate as the first thing a reader meets, on the
          one surface that has to convince them this product is not a
          government portal. The header is the name and the mission, and
          nothing between them.
        */}
        <h1 className="welcome-title">We the People</h1>

        {/* The author's mission text, verbatim (session brief 1a). Do not
            edit it here: tests/welcome-copy.test.ts pins every sentence. */}
        <div className="welcome-msg space-y-2 text-left">
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

        <p className="welcome-divider">Or try a place we cover well</p>

        <div className="welcome-teams">
          {QUICK_ZIPS.map((quick) => (
            <button
              key={quick.zip}
              type="button"
              className="welcome-team-btn"
              onClick={() => submit(quick.zip)}
            >
              {quick.label}
            </button>
          ))}
        </div>

        {/*
          The honest coverage statement, before anyone types a zip we cannot
          answer well. Any zip works; what differs is how much we hold, and
          the map's coverage notice says exactly which bodies we can't see
          yet. Nothing here ranks or suggests — it states where the data is.
        */}
        <p className="welcome-fineprint">
          These four areas have the deepest coverage today. Any U.S. zip
          works — elsewhere you&apos;ll see what we have so far, and the map
          says plainly which local governments we can&apos;t see yet.
        </p>

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
