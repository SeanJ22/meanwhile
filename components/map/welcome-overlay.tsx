"use client";

import { useEffect, useState } from "react";

import {
  isWellFormedZip,
  nearestZctaAsync,
  resolveZipAsync,
  warmZctaTable,
} from "@/lib/geo/zcta-table";

import { useRecentZips } from "@/hooks/use-recent-zips";
import { recordLocationOrigin } from "@/lib/state/location-origin";
import type { LocationOrigin } from "@/lib/ask/residency";
import { ZipComb } from "./zip-comb";
import { Logo } from "@/components/brand/logo";

/**
 * The entry overlay.
 *
 * Ports EdiaStratMap's welcome card: a dimmed, blurred sheet over the map with
 * a single card on it, a ZIP input and a location action. Replaces
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
    "We’re working on getting this info for that zip. Try a nearby one.",
} as const;

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
  const recents = useRecentZips();
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  /*
   * P-002 · the 960 KB centroid table is fetched when the reader arrives, not
   * when the page paints. By the time five digits are typed it is almost
   * always already here; if it is not, the await below waits for it.
   */
  useEffect(() => {
    warmZctaTable();
  }, []);

  /*
   * **THE ORIGIN IS RECORDED WHERE IT HAPPENS, BECAUSE NOWHERE ELSE CAN.**
   * (PR #212 follow-up, 2026-08-28.)
   *
   * A stored zip looks identical whether it was typed, tapped off the
   * demonstration list, or resolved from the browser's own geolocation — and
   * those are three different things about the reader. `lib/ask/residency.ts`
   * turns the act into what it proves; this card is the only place in the
   * product that knows which act it was.
   *
   * What is recorded is a FACT about what happened, never a conclusion:
   * `stampResidency` on the server decides what a typed zip is worth, so no
   * client can assert a confidence it did not earn.
   */
  async function submit(value: string = zip, origin: LocationOrigin = "TYPED_ZIP") {
    const result = await resolveZipAsync(value);

    if (!result.ok) {
      setError(MESSAGES[result.reason]);
      return;
    }

    setError(null);
    setZip("");
    recordLocationOrigin(result.centroid.zip, origin);
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
      async (position) => {
        setLocating(false);
        const near = await nearestZctaAsync(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (!near) {
          setError("Couldn't match that location to a zip code.");
          return;
        }
        /* A device fix proves PRESENCE and never RESIDENCE — `stampResidency`
           maps it to UNKNOWN rather than to a home for exactly that reason. */
        recordLocationOrigin(near.zip, "DEVICE_LOCATION");
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
        {/*
          6e2 (2026-08-15, the author): "NOTICE OF PUBLIC MEETINGS" is gone.
          It undersold the mission text doing the real work below it —
          institutional boilerplate as the first thing a reader meets, on the
          one surface that has to convince them this product is not a
          government portal. The header is the name and the mission, and
          nothing between them.

          F01 13.1 (2026-08-19, the author): *"the map pin icon next to
          'Meanwhile' is now up and to the left. It looks very wonky. The map
          icon and 'Meanwhile' should be at the top and then a very grayish thin
          line right under 'Meanwhile', and then the mission and then the zip
          code."*

          THE CAUSE, because it is not obvious from the old markup: the card is
          `text-align: center`, and centring an inline SVG that way works — but
          Tailwind's preflight sets `svg { display: block }`, so this one was a
          BLOCK element and `text-align` could not reach it. It sat hard against
          the card's left padding while the centred `<h1>` sat below it, which
          is precisely "up and to the left".

          Centring it by hand would have fixed the symptom. The author asked for
          the arrangement instead, and it is the better answer: the icon and the
          name are one lockup on one line, so nothing has to be centred
          independently and the preflight rule stops mattering. The rule under
          it is what closes the header off from the mission.
        */}
        {/*
          ITEM J (2026-09-01) — THE PIN AND THE LINK COLOUR BOTH GO.

          What stood here was a 30px map-pin SVG plus the product name in bold
          sans, on one flex row. Three things wrong with it, and only one of
          them was the redesign:

          1. A PIN DROPS ONTO A HOUSE. The standing rule is that a ZIP and a
             geolocation are ORIENTATION, not identity, and this overlay is
             the surface where a reader is asked for a ZIP for the first time.
             The first mark they meet may not contradict the sentence under it.
          2. `.welcome-icon` WAS COLOURED `var(--link)` — the interactive
             accent, the colour this app uses for "tappable". The brand was
             wearing the affordance colour, so the identity read as a control.
             That was a live defect independent of any redesign.
          3. Bold sans is the app's OWN voice. The name is not a thing the app
             says; it is what the thing is called.

          `.welcome-rule` under the lockup is unchanged — it still closes the
          header off from the mission.
        */}
        <div className="welcome-lockup">
          <h1 className="welcome-title">
            <Logo variant="wordmark" size={34} />
          </h1>
        </div>
        <hr className="welcome-rule" />

        {/* The author's mission text, verbatim (session brief 1a). Do not
            edit it here: tests/welcome-copy.test.ts pins every sentence. */}
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

        {/* Sean, October 1, 2026: the words that tell a first-time reader which
            ZIP to give, directly above the entry boxes. */}
        <p className="welcome-start">Start where you live</p>

        <div className="welcome-field">
          <ZipComb
            value={zip}
            onChange={(next) => {
              setZip(next);
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

        <button
          type="button"
          className="welcome-submit"
          disabled={!isWellFormedZip(zip)}
          onClick={() => void submit()}
        >
          Show meetings
        </button>

        {/*
          M07 (2026-08-18) — the returning reader gets their OWN places back,
          at the one moment it matters.

          The 6f ruling made the current location session-scoped: reopening the
          app does not restore where you were, it ASKS. That ruling is right and
          this does not touch it — nothing here restores anything. But the
          re-ask was landing on a card that offered four zips belonging to
          somebody else, while the list of places this reader had actually
          looked at sat unused in `wtp.recent_zips`, reachable only from the zip
          switcher, which cannot be opened until a location already exists. So a
          returning reader's only route back to their own town was to retype it,
          and the recents list — built so the second visit costs one tap
          (item 3, 2026-08-15) — was unreachable on the second visit.

          Offering a tap is still asking. Being shown your own recent places and
          choosing one is the "confirms" half of this item; typing a new zip is
          the "re-enters" half; and neither assumes anything, which is the third
          and load-bearing clause — a zip stays `approximate_location`, and no
          district is resolved from it here or anywhere else.

          The reader's own places come FIRST and our coverage showcase second,
          because a list of where they have been outranks a list of where we
          happen to be good.
        */}
        {recents.length > 0 && (
          <>
            <p className="welcome-divider">Pick up where you left off</p>
            <div className="welcome-teams">
              {recents.map((zip) => (
                <button
                  key={zip}
                  type="button"
                  className="welcome-team-btn"
                  /* A recents tap mixes origins: this list carries places that
                     were typed and places that were tapped off the showcase
                     below, and nothing ever recorded which. UNKNOWN is the
                     honest floor — claiming a home from it would be the demo-chip
                     over-claim arriving one visit later. */
                  onClick={() => void submit(zip, "UNKNOWN")}
                >
                  {zip}
                </button>
              ))}
            </div>
          </>
        )}

        {/*
          RULING 59 (2026-08-21). This read: "These four areas have the deepest
          coverage today. Any U.S. zip works — elsewhere you'll see what we
          have so far, and the map says plainly which local governments we
          can't see yet."

          Two sentences, both deleted, for two different reasons.

          The first is the banned form: a claim about our holdings, ranked
          ("deepest"), counted ("four"), and dated ("today") — and derived from
          nothing on the screen, so it goes stale silently the moment a fifth
          area is worked and nobody remembers this file. Found by the RULING 59
          guard rather than by reading, which is the point of the guard.

          The second had already gone false. It pointed at the map's coverage
          notice as the thing that "says plainly which local governments we
          can't see yet" — and that notice is what RULING 59 deleted. A
          sentence whose whole job is to forward the reader to a deleted
          surface is a broken promise on the first screen anyone sees.

          What survives is the only part that was ever about what the reader
          can DO, which is the register this surface is in.
        */}
        <p className="welcome-fineprint">Any U.S. zip works.</p>

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
