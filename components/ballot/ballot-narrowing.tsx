"use client";

import { useEffect, useRef, useState } from "react";

import { locateAddressInZip } from "@/lib/geo/census-geocoder";

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
 * Nothing. The house number lives in this component's state for exactly as
 * long as the request does; the point lives in React state for as long as the
 * tab is on this page. Neither is written to storage, neither is logged, and
 * the two requests it makes (`/api/geocode`, `/api/ballot/scope`) are both
 * `no-store` POSTs that write nothing on the server. The promise the
 * narrowing chip makes on the map is the same one here, in the same words:
 * your address passes through our server to the Census Bureau's geocoder,
 * and it is not tied to an account. (F01 1e, 2026-08-19: the
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
    }
    return hidden;
  };

  const undo = () => {
    applyScope(null);
    setSetAside(null);
    setHouse("");
    setStreet("");
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
