"use client";

import { useState } from "react";

import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Browser geolocation.
 *
 * Same control shape as the radius toggle, and the same rule as the stored zip:
 * **this is orientation, not identity.** It moves the map centre and nothing
 * else. It never resolves a district, and the label says "approximate" on
 * screen rather than only in a comment, because a coordinate feels
 * authoritative in a way a zip does not and that feeling is the problem.
 *
 * CLAUDE.md: zip is stored as `approximate_location` and never treated as
 * district truth. Geolocation gets the same treatment — it is deliberately not
 * persisted at all.
 */
export function NearMeControl() {
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
      (position) =>
        dispatch({
          type: "nearMe/position",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
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
          Approximate. Moves the map only — it doesn&apos;t decide which
          districts you&apos;re in.
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
