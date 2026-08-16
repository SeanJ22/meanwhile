"use client";

import { useState } from "react";

import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Browser geolocation.
 *
 * **6f (2026-08-15, the author): Near me RESOLVES DISTRICTS now.** It used to
 * move the map centre and nothing else, and say so — which was honest and,
 * the author's word, counterintuitive: a reader who tells an app where they
 * are expects the app to answer for where they are, and a control that
 * politely declines to use what it just asked for is worse than one that
 * never asked.
 *
 * The rule it was written to respect is still respected, because the rule was
 * never "don't use a point". It is that **a point is orientation, not
 * identity, and is used and discarded.** That is exactly what a typed street
 * address already does (D53): the point resolves the containing districts,
 * the map flies to it, and nothing is stored — not in localStorage, not in
 * sessionStorage, not in the search log, which records the nearest ZCTA the
 * server resolved and never the coordinates it was handed.
 *
 * So the caveat stays on screen and changes what it is honest about: the
 * READING is approximate (a browser's location is a radius, not a doorstep),
 * rather than the app declining to use it.
 */
export function NearMeControl({
  onPoint,
}: {
  /**
   * The resolved point, for the parent to answer at — the same handler a
   * narrowed street address uses, so the two paths cannot drift into two
   * different ideas of what a point means. Fires once per successful fix.
   */
  onPoint?: (point: { lat: number; lng: number }) => void;
}) {
  const ui = useUi();
  const dispatch = useUiDispatch();
  const [error, setError] = useState<string | null>(null);

  function request(enabled: boolean) {
    setError(null);
    dispatch({ type: "nearMe/toggle", enabled });
    if (!enabled) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser can't share a location.");
      dispatch({ type: "nearMe/toggle", enabled: false });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        dispatch({
          type: "nearMe/position",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        // 6f: and now the point is USED — same handler as a narrowed street
        // address, same lifetime (React state for this tab), same promise.
        onPoint?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn't get a location.",
        );
        dispatch({ type: "nearMe/toggle", enabled: false });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <div className="prox-control">
      <label className="prox-toggle">
        <input
          type="checkbox"
          checked={ui.nearMeEnabled}
          onChange={(e) => request(e.target.checked)}
        />
        <span className="prox-slider" />
        <span className="prox-label">Near me</span>
      </label>

      <div className="prox-radius-wrap">
        <p className="prox-note">
          Approximate — a browser&apos;s location is a rough fix, not your
          doorstep. We use it to find your districts and then discard it;
          it&apos;s never stored or logged.
        </p>
        {error && (
          <p className="prox-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        {ui.nearMe && (
          <p className="prox-count">
            {ui.nearMe.lat.toFixed(3)}, {ui.nearMe.lng.toFixed(3)}
          </p>
        )}
      </div>
    </div>
  );
}
