"use client";

import { useEffect, useRef, useState } from "react";

import { locateAddressInZip } from "@/lib/geo/census-geocoder";
import {
  clearSessionAddress,
  sessionAddressFor,
  writeSessionAddress,
} from "@/lib/geo/session-address";

/**
 * "Show me my actual ballot" (item 2, 2026-08-15).
 *
 * The page opens by saying a zip is orientation and not a ballot, and until
 * now that was where it stopped — an honest limitation with no way out of it.
 * This is the way out: a street and a house number, resolved to a point, and
 * the contests narrowed to the districts that actually contain it.
 *
 * ## What it does to the page
 *
 * Nothing is deleted. Contests outside the point's districts are marked
 * `data-scoped-out` and hidden by the stylesheet, and the banner says how
 * many were set aside with a one-tap undo — the reader can always see the
 * whole zip again. Hiding rows silently is how a reader ends up believing a
 * contest does not exist, and this feature would otherwise be a very good way
 * to make a ballot look shorter than it is.
 *
 * ## What is stored
 *
 * **Amended 2026-08-22 (NJ Hunt 3, RULING 74).** This section read "Nothing."
 * and that is no longer true, so it says what IS true rather than being left
 * to contradict the code below it.
 *
 * The house number still lives in this component's state for exactly as long
 * as the request does, and the resolved POINT is still never persisted — those
 * are the two values that would locate a home, and neither is kept. The two
 * requests it makes (`/api/geocode`, `/api/ballot/scope`) are still `no-store`
 * POSTs that write nothing on the server, and nothing here reaches a database.
 *
 * What IS now kept, in `sessionStorage` and nowhere else, is the RESOLVED
 * OUTCOME: the contest ids the point produced, plus the street the reader
 * typed for their own recognition. RULING 74 — an address, once given, is
 * never asked for twice — and the alternative was re-prompting on every
 * surface, which reads as a product that is not paying attention. A contest
 * list cannot be walked back to a house, the browser clears it when the tab
 * closes, and no schema anywhere grew a column. See
 * `lib/geo/session-address.ts` for the whole of it.
 *
 * The promise the narrowing chip makes on the map is the same one here, in the
 * same words: your address passes through our server to the Census Bureau's
 * geocoder, and it is not tied to an account. (F01 1e, 2026-08-19: the
 * never-store/never-log promise is struck by the author's order.)
 */
export function BallotNarrowing({ zip }: { zip: string }) {
  const [open, setOpen] = useState(false);
  const [house, setHouse] = useState("");
  const [street, setStreet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How many contests the point set aside. Null means no narrowing applied. */
  const [setAside, setSetAside] = useState<number | null>(null);
  const streetRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) streetRef.current?.focus();
  }, [open]);


  /** Mark the sections. The page renders every contest; this hides some. */
  const applyScope = (contestIds: string[] | null): number => {
    const sections =
      document.querySelectorAll<HTMLElement>("[data-contest-id]");
    let hidden = 0;
    for (const section of sections) {
      const id = section.dataset.contestId ?? "";
      const out = contestIds !== null && !contestIds.includes(id);
      if (out) {
        section.dataset.scopedOut = "true";
        hidden += 1;
      } else {
        delete section.dataset.scopedOut;
      }
      /*
       * RULING 71 + RULING 74. A contest the address CONFIRMS no longer says
       * "could govern you" — the reader has settled it, and repeating the
       * question after it has been answered is the product not paying
       * attention. Restored on undo, because "show the whole zip again" puts
       * the reader back where the question is open.
       */
      if (contestIds === null) {
        if (section.dataset.couldGovernParked === "true") {
          section.dataset.couldGovern = "true";
          delete section.dataset.couldGovernParked;
        }
      } else if (!out && section.dataset.couldGovern === "true") {
        delete section.dataset.couldGovern;
        section.dataset.couldGovernParked = "true";
      }
    }
    return hidden;
  };

  /*
   * **RULING 74: AN ADDRESS, ONCE GIVEN, IS NEVER ASKED FOR TWICE.**
   *
   * A reader who gave an address on any surface this session — this one, the
   * who-governs card, anywhere — has already answered the question this
   * component asks. So on mount the session's resolved scope is applied
   * silently, and the prompt does not render. It is not a second prompt
   * pre-filled; it is no prompt.
   *
   * Only for THIS zip: an address resolved in 07866 says nothing about 03255,
   * and treating the two as one would be the product asserting a location the
   * reader never gave it.
   *
   * It runs once on mount rather than on every render, and reads storage
   * rather than a prop, because the surface that wrote it may not be this one.
   */
  useEffect(() => {
    const held = sessionAddressFor(zip);
    if (!held) return;
    /*
     * Deferred a tick rather than run synchronously, for two reasons that
     * happen to agree. React refuses a synchronous `setState` inside an effect
     * because it cascades a render; and `applyScope` reaches into the DOM for
     * `[data-contest-id]` sections, which is a read of what the browser has
     * actually laid out rather than of what React has committed. A tick later
     * is the honest moment for both.
     */
    const id = window.setTimeout(() => {
      setSetAside(applyScope(held.contestIds));
      setStreet(held.streetLabel);
    }, 0);
    return () => window.clearTimeout(id);
  }, [zip]);

  const undo = () => {
    applyScope(null);
    setSetAside(null);
    setHouse("");
    setStreet("");
    // RULING 74 in reverse: a reader asking for the whole zip back is asking
    // us to forget what they told us. It goes, for every surface at once.
    clearSessionAddress();
  };

  const submit = async () => {
    const number = house.trim();
    const road = street.trim();
    if (!number || road.length < 3) {
      setError("A house number and a street, please.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const point = await locateAddressInZip(number, road, zip);
      if (!point) {
        // The honest failure. It is about our lookup, never about the
        // reader's address being wrong.
        setError(
          `We couldn't place ${number} ${road} in ${zip}. The whole zip is still below.`,
        );
        return;
      }
      const response = await fetch("/api/ballot/scope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: point.lat, lng: point.lng }),
      });
      if (!response.ok) {
        setError("We couldn't check that address just now. Nothing has changed.");
        return;
      }
      const body = (await response.json()) as {
        ok?: boolean;
        contestIds?: unknown;
      };
      if (body.ok !== true || !Array.isArray(body.contestIds)) {
        setError("We couldn't check that address just now. Nothing has changed.");
        return;
      }
      const ids = body.contestIds.filter(
        (id): id is string => typeof id === "string",
      );
      if (ids.length === 0) {
        setError(
          "We don't hold a ballot for that address yet. The whole zip is still below.",
        );
        return;
      }
      const hidden = applyScope(ids);
      setSetAside(hidden);
      setOpen(false);
      /*
       * RULING 74. The RESOLVED OUTCOME goes to `sessionStorage` so every
       * other surface this session reads it instead of asking again. The
       * street the reader typed goes with it for their own recognition; the
       * HOUSE NUMBER and the COORDINATES do not, and a contest list cannot be
       * walked back to a house. Nothing reaches the server and nothing reaches
       * disk — see `lib/geo/session-address.ts` for the whole of what is kept.
       */
      writeSessionAddress({ zip, contestIds: ids, streetLabel: road });
      // The number is done with the moment the request is. Nothing keeps it.
      setHouse("");
    } finally {
      setBusy(false);
    }
  };

  if (setAside !== null) {
    return (
      <div className="ballot-narrowed">
        <p>
          {setAside === 0
            ? "Every contest below is on the ballot at that address."
            : `Narrowed to that address — ${setAside} ${
                setAside === 1 ? "contest" : "contests"
              } elsewhere in ${zip} ${setAside === 1 ? "is" : "are"} hidden.`}
        </p>
        <button type="button" onClick={undo}>
          Show the whole zip again
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <p className="mt-2">
        <button
          type="button"
          className="ballot-narrow-link"
          onClick={() => setOpen(true)}
        >
          Narrow this to where you live <span aria-hidden="true">→</span>
        </button>
      </p>
    );
  }

  return (
    <div className="ballot-narrow-form">
      <p className="ballot-narrow-ask">
        What&apos;s your street and house number? We use it to find your
        districts and nothing else.
      </p>
      <div className="ballot-narrow-fields">
        <input
          type="text"
          inputMode="numeric"
          value={house}
          aria-label="House number"
          placeholder="No."
          onChange={(e) => {
            setHouse(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <input
          ref={streetRef}
          type="text"
          value={street}
          aria-label="Street"
          placeholder="Street"
          onChange={(e) => {
            setStreet(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? "Checking…" : "Show mine"}
        </button>
      </div>
      {error && <p className="ballot-narrow-error">{error}</p>}
      <p className="ballot-narrow-promise">
        Your address passes through our server to the Census Bureau&apos;s
        geocoder, which turns it into a point we match to your districts.{" "}
        <button type="button" onClick={() => setOpen(false)}>
          No thanks
        </button>
      </p>
    </div>
  );
}
