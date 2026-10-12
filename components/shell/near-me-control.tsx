"use client";

import { useState } from "react";

import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Browser geolocation. The point resolves the containing districts and the map
 * flies to it; nothing is stored, and the search log records only the nearest
 * ZCTA the server resolved.
 */
export function NearMeControl({
  onPoint,
}: {
  /** The resolved point; the same handler a narrowed street address uses. Fires once per fix. */
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
        // Same handler and lifetime as a narrowed street address.
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
        <span className="prox-label">
          Near me
          <span className="mw-switch-sub">
            {ui.nearMeEnabled ? "On · around your location" : "Off · showing the whole area"}
          </span>
        </span>
      </label>

      {/* Only an error renders here; a control that silently does nothing is a defect. */}
      {error && (
        <div className="prox-radius-wrap">
          <p className="prox-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
