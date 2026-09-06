"use client";

import { useEffect, useRef, useState } from "react";

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

/**
 * **THE ADDRESS PROMPT — one component, every surface.**
 * (WGH-5, 2026-08-22, the author's 8/22 walkthrough, item 9.)
 *
 * Who Governs Here, the "Narrow to this area" chip, the ballot's bottom box and
 * the JUR-2 meeting pill all call this. There were two separate implementations
 * of the same feature and they did not agree with each other about the most
 * basic thing in it — one promised the app never needs a house number, the
 * other refused to submit without one, and they shipped on the same screen.
 *
 * ## The default asks for a STREET and nothing else
 *
 * No house-number field. No apartment field. **Not optional, not collapsed —
 * absent.** It appears only when the reader's own street turns out to cross a
 * boundary, and when it appears it says which boundary and which office that
 * boundary decides. The ask is visibly caused by their street rather than being
 * a form step they have to get through.
 *
 * ## Partial ambiguity resolves partially
 *
 * A street unambiguous at county and municipal level but split at the
 * congressional level confirms county and municipal immediately and hedges only
 * the congressional row. The page is never held hostage to one level.
 *
 * ## What is kept
 *
 * The resolved **division ids** and **contest ids**, in `sessionStorage` and
 * nowhere else. Nothing to the server, nothing to disk, no column on the search
 * log, no column on the reactions store. The **house number is used for
 * resolution and not retained** — it lives in this component's state for
 * exactly as long as the request does, and the route it goes to writes nothing.
 * The browser sees a STREET midpoint only, and only when the street is
 * unambiguous — never a house, and never on a street that crosses a line.
 *
 * ## The promise, rewritten to one that is true
 *
 * The old footer said the app never needs a house number, absolutely, on the
 * same screen as a form asking for one. A reader whose street genuinely splits
 * would have caught the app in that the first time it happened. It now says
 * what is accurate — street first, house number when the street crosses a line
 * OR when the street name alone does not place — which is more credible than
 * the absolute version and has the advantage of being keepable.
 *
 * That second reason was added in Session C (2026-08-31) because it was
 * already TRUE and unsaid. The resolver probes a fixed ladder of sample house
 * numbers when none is given, and a street whose range excludes them all came
 * back FAILED — so the product told the owner it could not place his own road
 * and offered him no field to correct it with. The promise now names both
 * reasons a number is wanted, and the form asks in both cases.
 */

export interface AddressPromptProps {
  zip: string;
  /**
   * Fires whenever the reader's jurisdiction picture changes — resolved,
   * partially resolved, or cleared. The caller re-reads the session scope; it
   * is deliberately not handed the resolution, so every surface reads the same
   * one source.
   */
  onResolved?: (scope: { divisionIds: string[]; contestIds: string[]; splitLevels: LevelKey[] }) => void;
  /**
   * The street resolved to a point, so the map can re-centre. Fires only on an
   * UNAMBIGUOUS street — an ambiguous one has no single point, and inventing a
   * midpoint between two municipalities would put a pin in neither.
   */
  onPoint?: (point: { lat: number; lng: number }) => void;
  /** BAL-38: the reader accepted the offer to view the ZIP it resolves in. */
  onSwitchZip?: (zip: string) => void;
  /** The reader asked to go back to the whole zip. */
  onCleared?: () => void;
  /** Copy for the collapsed control. Each surface names its own affordance. */
  trigger?: string;
  /** Render expanded from the start — the who-governs pill opens straight in. */
  startOpen?: boolean;
  /**
   * Extra class on the OPEN FORM's wrapper so a surface can place it.
   *
   * **BAL-23 (2026-08-25) — this used to be applied to the collapsed trigger
   * TOO, and that is what broke the ballot's narrow-it flow.**
   *
   * The ballot page passed `ballot-top-pill`, which is exactly right for the
   * collapsed control — it IS a pill — and is a catastrophe on the open form:
   * `display: inline-flex; align-items: center; min-height: 40px; padding: 0
   * 16px; border-radius: 999px`. One prop reaching both slots turned the
   * form's three blocks into flex items in a row, so *What street do you live
   * on?* was squeezed to its minimum-content width and wrapped one word per
   * line, the promise paragraph overflowed to the right, and the whole thing
   * sat inside a 40px pill it could never fit — inside a `display: flex`
   * container it was also sharing with the *Moving here?* pill. The author's
   * `17-44-49` is that, and his words are *very ugly, convoluted, a disaster.*
   *
   * A collapsed control and an expanded form are different shapes and always
   * were; the prop that placed them was not. `triggerClassName` places the
   * control, this places the form, and neither can reach the other.
   */
  className?: string;
  /**
   * Extra class on the COLLAPSED TRIGGER's wrapper. See `className` above —
   * a pill class belongs here and only here.
   */
  triggerClassName?: string;
}

type Phase = "IDLE" | "ASKING" | "WORKING" | "NEEDS_NUMBER" | "SETTLED" | "FAILED";

export function AddressPrompt({
  zip,
  onResolved,
  onPoint,
  onCleared,
  onSwitchZip,
  trigger = "Add your address",
  startOpen = false,
  className,
  triggerClassName,
}: AddressPromptProps) {
  const [phase, setPhase] = useState<Phase>(startOpen ? "ASKING" : "IDLE");
  const [street, setStreet] = useState("");
  /**
   * The house number lives here and only here, for exactly as long as the
   * request does. It is cleared in the `finally`, whatever the request returned.
   */
  const [houseNumber, setHouseNumber] = useState("");
  const [resolution, setResolution] = useState<AddressResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** BAL-38: the ZIP this address DOES resolve in, when it resolves elsewhere. */
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const streetRef = useRef<HTMLInputElement | null>(null);
  const numberRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (phase === "ASKING") streetRef.current?.focus();
    if (phase === "NEEDS_NUMBER") numberRef.current?.focus();
  }, [phase]);

  /*
   * RULING 74 — an address, once given, is never asked for twice. A reader who
   * answered on any surface this session has answered here. Only for THIS zip:
   * an address resolved in 07866 says nothing about 03255.
   */
  useEffect(() => {
    const held = sessionAddressFor(zip);
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
        /*
         * ── BAL-38 ── **AN ADDRESS THAT RESOLVES SOMEWHERE ELSE IS NOT AN
         * ADDRESS WE COULD NOT PLACE.** (2026-08-31.)
         *
         * The owner: out-of-zip addresses were rejected rather than redirected.
         * The geocoder constrains its query to the ZIP on screen, so an address
         * one ZIP over failed exactly like a bad one — and the reader was told
         * we could not place it, which was true, about us, and concealed that
         * we had placed it fine somewhere else.
         *
         * The sentence still reports OUR failure first, because that is what
         * happened here: this ballot could not use the address. The offer sits
         * after it, and nothing switches without a tap — a reader looking at
         * one ZIP's ballot who is silently moved to another has had their
         * question changed for them.
         */
        /*
         * ── WGH-22 / OWN-address ── **A BLIND PROBE THAT MISSED IS NOT A
         * STREET THAT DOES NOT EXIST.** (Session C, 2026-08-31.)
         *
         * With no house number the resolver probes a FIXED ladder of sample
         * numbers — 1, 50, 200, 800 — against the Census range for the street.
         * A street whose range excludes all four returns zero points and comes
         * back FAILED. That is a fact about OUR four guesses, not about the
         * street: the owner's own road is numbered 10701-10899, so every probe
         * missed and the product told him it could not place a road the Census
         * places on the first try with a real number.
         *
         * Telling a reader their street could not be placed is asserting an
         * absence from our own empty result, which `CLAUDE.md` forbids by
         * name. The honest move is the question we already have a field for.
         * The promise below the form said a number is wanted only when the
         * street crosses a boundary; it now says the other reason too, so the
         * copy and the resolver agree.
         *
         * Only a number that was SUPPLIED and still failed is a real failure,
         * and that path is unchanged.
         */
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

      /*
       * Partial ambiguity resolves partially: whatever IS confirmed is written
       * and announced now, before the house-number question is asked. The
       * caller drops the hedge on those rows immediately.
       */
      writeSessionAddress({
        zip,
        contestIds,
        divisionIds,
        splitLevels,
        streetLabel: street.trim(),
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
        <button type="button" className="address-prompt-trigger" data-pearl={triggerClassName?.split(/\s+/).includes("ballot-top-pill") || undefined} onClick={() => setPhase("ASKING")}>
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
          /* Item 9.5 — what IS settled is settled now, and says so, before the
             extra question is asked. Nothing waits on the ambiguous level. */
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
          {/* Declining stays the effortless default — friction-rule exception 2.
              Skipping leaves every confirmed level confirmed. */}
          <button
            type="button"
            className="address-prompt-skip"
            onClick={() => {
              /* Nothing was settled when the street never placed, so skipping
                 here returns the honest failure rather than a SETTLED card
                 that would read "Set to <street>." about an address we do not
                 have. */
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
      {/*
        ── BAL-38 ── The switch, offered and never taken automatically.

        A reader looking at one ZIP's ballot who is silently moved to another
        has had their question changed for them. `onSwitchZip` is the caller's,
        because this component knows an address and not how the surface around
        it navigates.
      */}
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
      <p className="address-prompt-ask">What street do you live on?</p>
      <div className="address-prompt-fields">
        <input
          ref={streetRef}
          type="text"
          value={street}
          placeholder="Street"
          aria-label="Street"
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
      {/*
        ── BAL-38 ── The switch, offered and never taken automatically.

        A reader looking at one ZIP's ballot who is silently moved to another
        has had their question changed for them. `onSwitchZip` is the caller's,
        because this component knows an address and not how the surface around
        it navigates.
      */}
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
      {/*
        The rewritten promise (item 9.8). The old one was absolute — "never a
        house number" — on the same screen as a form asking for one. This says
        what is accurate, and a reader whose street genuinely splits will find
        it was told the truth in advance.
      */}
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
