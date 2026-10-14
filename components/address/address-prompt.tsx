"use client";

import { useEffect, useRef, useState } from "react";
import type { GeographySelection } from "@/lib/census-geography/selection";

import {
  houseNumberReason,
  LEVEL_LABEL,
  type AddressResolution,
  type LevelKey,
} from "@/lib/geo/address-resolution";
import {
  clearSessionAddress,
  sessionAddressFor,
  writeSessionAddress,
} from "@/lib/geo/session-address";

export interface AddressPromptProps {
  zip: string;
  selection?: GeographySelection;
  /** Fires whenever the jurisdiction picture changes; callers re-read the session scope. */
  onResolved?: (scope: { divisionIds: string[]; contestIds: string[]; splitLevels: LevelKey[] }) => void;
  /** Fires only on an unambiguous street; an ambiguous one has no single point. */
  onPoint?: (point: { lat: number; lng: number }) => void;
  /** The reader accepted the offer to view the ZIP the address resolves in. */
  onSwitchZip?: (zip: string) => void;
  /** The reader asked to go back to the whole zip. */
  onCleared?: () => void;
  /** Copy for the collapsed control. Each surface names its own affordance. */
  trigger?: string;
  /** Render expanded from the start — the who-governs pill opens straight in. */
  startOpen?: boolean;
  /** Entry from a mail-only or unplaced ZIP accepts the reader's own city/state. */
  postalEntry?: boolean;
  /** Class on the open form's wrapper. Never applied to the collapsed trigger. */
  className?: string;
  /** Class on the collapsed trigger's wrapper. */
  triggerClassName?: string;
}

type Phase = "IDLE" | "ASKING" | "WORKING" | "NEEDS_NUMBER" | "SETTLED" | "FAILED";

export function AddressPrompt({
  zip,
  selection,
  onResolved,
  onPoint,
  onCleared,
  onSwitchZip,
  trigger = "Add your address",
  startOpen = false,
  postalEntry = false,
  className,
  triggerClassName,
}: AddressPromptProps) {
  const [phase, setPhase] = useState<Phase>(startOpen ? "ASKING" : "IDLE");
  const [street, setStreet] = useState("");
  /** Cleared in the `finally`, whatever the request returned. */
  const [houseNumber, setHouseNumber] = useState("");
  const [resolution, setResolution] = useState<AddressResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The ZIP this address does resolve in, when it resolves elsewhere. */
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const streetRef = useRef<HTMLInputElement | null>(null);
  const numberRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (phase === "ASKING") streetRef.current?.focus();
    if (phase === "NEEDS_NUMBER") numberRef.current?.focus();
  }, [phase]);

  /* An address already given this session for this zip is reused, never asked again. */
  useEffect(() => {
    const held = sessionAddressFor(zip, selection);
    if (!held) return;
    const id = window.setTimeout(() => {
      setStreet(held.streetLabel);
      setPhase("SETTLED");
      onResolved?.({
        divisionIds: held.divisionIds,
        contestIds: held.contestIds,
        splitLevels: held.splitLevels as LevelKey[],
      });
    }, 0);
    return () => window.clearTimeout(id);
    // Deliberately keyed on the zip alone: this is a mount-time read of a store
    // some other surface may have written, not a subscription to a prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip]);

  const send = async (withNumber: string) => {
    setPhase("WORKING");
    setError(null);
    try {
      const response = await fetch("/api/address/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zip,
          ...(selection ? { selection } : {}),
          ...(postalEntry ? { postalEntry: true } : {}),
          street: street.trim(),
          ...(withNumber ? { houseNumber: withNumber } : {}),
        }),
      });
      if (!response.ok) {
        setError("We couldn't check that just now. Nothing has changed.");
        setPhase(withNumber ? "NEEDS_NUMBER" : "ASKING");
        return;
      }
      const body = (await response.json()) as {
        ok?: boolean;
        resolution?: AddressResolution;
        contestIds?: unknown;
        point?: { lat?: unknown; lng?: unknown } | null;
      };
      if (body.ok !== true || !body.resolution) {
        setError("We couldn't check that just now. Nothing has changed.");
        setPhase(withNumber ? "NEEDS_NUMBER" : "ASKING");
        return;
      }

      const result = body.resolution;
      setResolution(result);

      if (result.status === "FAILED") {

        if (!withNumber && !result.resolvesInZip) {
          setError(null);
          setPhase("NEEDS_NUMBER");
          return;
        }
        setError(
          result.resolvesInZip
            ? `${street.trim()} doesn't resolve in ${zip} — it resolves in ` +
              `${result.resolvesInZip}. Everything here stays listed.`
            : `We couldn't place ${street.trim()} in ${zip}. Everything stays listed.`,
        );
        setElsewhere(result.resolvesInZip ?? null);
        setPhase("FAILED");
        return;
      }

      const contestIds = Array.isArray(body.contestIds)
        ? body.contestIds.filter((id): id is string => typeof id === "string")
        : [];
      const divisionIds = result.levels.filter((l) => l.certain).flatMap((l) => l.divisionIds);
      const splitLevels = result.status === "AMBIGUOUS" ? result.split : [];


      writeSessionAddress({
        zip,
        contestIds,
        divisionIds,
        splitLevels,
        streetLabel: street.trim(),
        ...(selection ? { selection } : {}),
      });
      onResolved?.({ divisionIds, contestIds, splitLevels });
      if (
        body.point &&
        typeof body.point.lat === "number" &&
        typeof body.point.lng === "number"
      ) {
        onPoint?.({ lat: body.point.lat, lng: body.point.lng });
      }

      setPhase(result.status === "AMBIGUOUS" ? "NEEDS_NUMBER" : "SETTLED");
    } catch {
      setError("We couldn't check that just now. Nothing has changed.");
      setPhase(withNumber ? "NEEDS_NUMBER" : "ASKING");
    } finally {
      // The number is done with the moment the request is. Nothing keeps it.
      setHouseNumber("");
    }
  };

  const submitStreet = () => {
    if (street.trim().length < 3) {
      setError("A street name, please.");
      return;
    }
    void send("");
  };

  const reset = () => {
    clearSessionAddress();
    setStreet("");
    setHouseNumber("");
    setResolution(null);
    setError(null);
    setPhase("IDLE");
    onCleared?.();
  };

  /* ------------------------------------------------------------- idle --- */
  if (phase === "IDLE") {
    return (
      <p className={triggerClassName}>
        <button type="button" className="address-prompt-trigger" onClick={() => setPhase("ASKING")}>
          {trigger} <span aria-hidden="true">→</span>
        </button>
      </p>
    );
  }

  /* ---------------------------------------------------------- settled --- */
  if (phase === "SETTLED") {
    const confirmed = resolution && resolution.status !== "FAILED" ? resolution.levels.filter((l) => l.certain) : [];
    return (
      <div className={`address-prompt address-prompt-settled ${className ?? ""}`}>
        <p className="address-prompt-confirmed">
          {confirmed.length > 0
            ? `Set to ${confirmed.flatMap((l) => l.divisionLabels).join(", ")}.`
            : street.trim().length > 0
              ? `Set to ${street.trim()}.`
              : "Set to your address."}{" "}
          <span className="address-prompt-kept">Kept on this device for this visit only.</span>
        </p>
        <button type="button" className="address-prompt-undo" onClick={reset}>
          Show the whole area again
        </button>
      </div>
    );
  }

  /* ---------------------------------------------- the house-number ask --- */
  if (phase === "NEEDS_NUMBER" || (phase === "WORKING" && houseNumber)) {
    const split: LevelKey[] =
      resolution && resolution.status === "AMBIGUOUS" ? resolution.split : [];
    const confirmed =
      resolution && resolution.status !== "FAILED" ? resolution.levels.filter((l) => l.certain) : [];
    return (
      <div className={`address-prompt address-prompt-split ${className ?? ""}`}>
        {confirmed.length > 0 && (
          /* Confirmed levels are shown before the extra question is asked. */
          <p className="address-prompt-confirmed">
            Settled: {confirmed.flatMap((l) => l.divisionLabels).join(", ")}.
          </p>
        )}
        <label htmlFor={`wtp-house-${zip}`} className="address-prompt-ask">
          {split.length > 0
            ? houseNumberReason(split)
            : resolution?.status === "FAILED"
              ? `We couldn't place ${street.trim()} from the street name on its own. ` +
                "A house number will settle it."
              : "Your street crosses a boundary. A house number settles it."}
        </label>
        <div className="address-prompt-fields">
          <input
            id={`wtp-house-${zip}`}
            ref={numberRef}
            inputMode="numeric"
            autoComplete="off"
            value={houseNumber}
            placeholder="No."
            aria-label="House number"
            onChange={(e) => setHouseNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && houseNumber.trim()) void send(houseNumber.trim());
            }}
          />
          <button
            type="button"
            onClick={() => houseNumber.trim() && void send(houseNumber.trim())}
            disabled={!houseNumber.trim() || phase === "WORKING"}
          >
            {phase === "WORKING" ? "Checking…" : "Use it"}
          </button>
          {/* Skipping leaves every confirmed level confirmed. */}
          <button
            type="button"
            className="address-prompt-skip"
            onClick={() => {
              /* Nothing was settled when the street never placed. */
              if (resolution?.status === "FAILED") {
                setError(`We couldn't place ${street.trim()} in ${zip}. Everything stays listed.`);
                setPhase("FAILED");
                return;
              }
              setPhase("SETTLED");
            }}
          >
            skip
          </button>
        </div>
        {error && <p className="address-prompt-error">{error}</p>}
      {/* The switch is offered, never taken automatically. */}
      {elsewhere && onSwitchZip && (
        <button
          type="button"
          data-address-switch-zip={elsewhere}
          className="address-prompt-ask"
          onClick={() => onSwitchZip(elsewhere)}
        >
          Show the {elsewhere} ballot instead
        </button>
      )}
        <p className="address-prompt-promise">
          The number is used to find {split.length === 1 ? LEVEL_LABEL[split[0]] : "your districts"} and
          is not kept.
        </p>
      </div>
    );
  }

  /* ------------------------------------------------- the street ask --- */
  return (
    <div className={`address-prompt ${className ?? ""}`}>
      <p className="address-prompt-ask">{postalEntry ? "Your street, city and state" : "What street do you live on?"}</p>
      <div className="address-prompt-fields">
        <input
          ref={streetRef}
          type="text"
          value={street}
          placeholder={postalEntry ? "Street, city, state" : "Street"}
          aria-label={postalEntry ? "Street address" : "Street"}
          onChange={(e) => {
            setStreet(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitStreet();
          }}
        />
        <button type="button" onClick={submitStreet} disabled={phase === "WORKING"}>
          {phase === "WORKING" ? "Checking…" : "Show mine"}
        </button>
      </div>
      {error && <p className="address-prompt-error">{error}</p>}
      {/* The switch is offered, never taken automatically. */}
      {elsewhere && onSwitchZip && (
        <button
          type="button"
          data-address-switch-zip={elsewhere}
          className="address-prompt-ask"
          onClick={() => onSwitchZip(elsewhere)}
        >
          Show the {elsewhere} ballot instead
        </button>
      )}
      <p className="address-prompt-promise">
        We ask for your street, and for a house number when the street crosses a boundary or when
        we can&apos;t place it from the name on its own. It passes through our server to the U.S.
        Census Bureau&apos;s free address lookup and is not tied to an account. What comes back
        stays on this device for this visit.{" "}
        <button type="button" className="address-prompt-skip" onClick={() => setPhase("IDLE")}>
          No thanks
        </button>
      </p>
    </div>
  );
}
