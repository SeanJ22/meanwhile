"use client";

import { useMemo, useState } from "react";
import { formatDateLong } from "@/lib/text/format-date";
import { createPortal } from "react-dom";

import { readDesignToken } from "@/lib/design/read-token";
import { useStoredTheme } from "@/hooks/use-stored-theme";
import { clearAllPicks, type StoredPick } from "@/lib/ballot/picks";
import {
  derivedToSuppress,
  type PickableContest,
} from "@/lib/ballot/pick-tally";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The picks card (session item 5, wall clock 2026-08-14 second session):
 * the reader's OWN ballot, screenshottable. The
 * tester's use case verbatim — build picks on the couch, screenshot one
 * card, carry it into the booth.
 *
 * HARD CONSTRAINTS, from the brief: the reader's device-local picks
 * ONLY. No aggregates, no reactions, no totals, no app commentary, no
 * candidate photos. The card carries the app name and "My picks — made
 * with <PRODUCT_NAME>, [date]" and nothing evaluative. It is the
 * reader's artifact, not the app's opinion. The name is the constant,
 * never a literal: B01's interim rename (2026-08-17) moved it once and
 * is expected to move it again.
 *
 * Nothing about the picks store changes: the card is drawn onto a
 * <canvas> from localStorage entirely in the browser — creating or
 * downloading it transmits nothing.
 */

const WIDTH = 360;
const SCALE = 3; // crisp on a phone screen
const PAD = 24;

/**
 * **THE CARD FOLLOWS THE THEME** — F01 12.2, 2026-08-19.
 *
 * In light mode the card rendered dark; it follows whichever theme the reader
 * selected, light or dark.
 *
 * The old single palette was a DELIBERATE choice with a stated reason — "the
 * card leaves the app, so it must stand alone" — and it is now replaced, for
 * the thing that matters: a reader in light mode presses a button and gets a
 * dark rectangle, which reads as a bug long before anyone reasons about where
 * the image will end up.
 *
 * The old reason is not thrown away, it is answered: BOTH palettes stand alone.
 * The card is drawn on a `<canvas>`, so it cannot inherit a CSS variable and
 * has to carry literal values either way; what changes is that there are now
 * two sets and the reader's own choice picks between them.
 *
 * ## The class audit 12.2 asks for
 *
 * *"Class-wide: audit for any other surface that ignores the theme."* Swept
 * every hard-coded hex in `app/`, `components/` and `lib/`. Three kinds, and
 * only one was a defect:
 *
 *  1. **This file** — the defect, fixed here.
 *  2. `components/calendar/calendar-marks.tsx` — the Apple, Google and Outlook
 *     logos. Third-party marks are fixed by their owners and MUST NOT follow
 *     our theme; recolouring a trademark is not theme support.
 *  3. `components/map/state-focus-overlay.tsx` — already switches on `theme`.
 *
 * No other surface ignores the reader's choice.
 */
type CardPalette = {
  bg: string;
  rule: string;
  muted: string;
  paper: string;
  accent: string;
};

function cardPalette(): CardPalette {
  return { bg: readDesignToken("--bg"), rule: readDesignToken("--panel-border"),
    muted: readDesignToken("--text-muted"), paper: readDesignToken("--text"), accent: readDesignToken("--signal") };
}

function cardFont(rung: "caption" | "heading", weight = ""): string {
  return `${weight} ${readDesignToken(`--text-${rung}`)} system-ui, sans-serif`.trim();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCard(
  picks: StoredPick[],
  madeOn: string,
  colors: CardPalette,
): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const inner = WIDTH - PAD * 2;

  // Measure pass: same fonts as the draw pass.
  type Block = { title: string[]; choices: string[] };
  ctx.font = cardFont("caption");
  const blocks: Block[] = picks.map((pick) => {
    ctx.font = cardFont("caption");
    const title = wrapLines(ctx, pick.contestTitle, inner);
    ctx.font = cardFont("heading", "600");
    const choices = wrapLines(
      ctx,
      pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", "),
      inner,
    );
    return { title, choices };
  });

  const headerH = 58;
  const footerH = 46;
  const blockH = (b: Block) =>
    b.title.length * 15 + b.choices.length * 20 + 18;
  const height =
    headerH + blocks.reduce((n, b) => n + blockH(b), 0) + footerH + PAD;

  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header.
  ctx.fillStyle = colors.accent;
  ctx.font = cardFont("caption", "600");
  ctx.fillText("MY PICKS", PAD, PAD + 10);
  ctx.fillStyle = colors.muted;
  ctx.font = cardFont("caption");
  ctx.fillText("This is my own list — written by me, not the app.", PAD, PAD + 26);
  ctx.strokeStyle = colors.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, headerH);
  ctx.lineTo(WIDTH - PAD, headerH);
  ctx.stroke();

  // Contest blocks.
  let y = headerH + 22;
  for (const block of blocks) {
    ctx.fillStyle = colors.muted;
    ctx.font = cardFont("caption");
    for (const line of block.title) {
      ctx.fillText(line, PAD, y);
      y += 15;
    }
    ctx.fillStyle = colors.paper;
    ctx.font = cardFont("heading", "600");
    for (const line of block.choices) {
      ctx.fillText(line, PAD, y + 3);
      y += 20;
    }
    y += 18;
  }

  // Footer — the app name and the date, nothing evaluative.
  ctx.strokeStyle = colors.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 4);
  ctx.lineTo(WIDTH - PAD, y - 4);
  ctx.stroke();
  ctx.fillStyle = colors.muted;
  ctx.font = cardFont("caption");
  ctx.fillText(`My picks — made with ${PRODUCT_NAME}, ${madeOn}`, PAD, y + 14);

  return canvas.toDataURL("image/png");
}

export function PicksCardControls({
  picks,
  pickable = [],
  yesTargets = new Set<string>(),
  cleared = {},
}: {
  picks: StoredPick[];
  /**
   * F01-continued item 9. The clear has to reach DERIVED picks, and a
   * derived pick exists nowhere to be deleted — it is recomputed at render
   * from the device's own Yes answers. So the confirm records what is
   * resolved on screen right now as suppressed, and these three props are
   * what "right now" is made of. Defaulted so a caller with no ballot
   * context still gets the old explicit-only clear rather than a crash.
   */
  pickable?: PickableContest[];
  yesTargets?: ReadonlySet<string>;
  cleared?: Record<string, string[]>;
}) {
  const [showCard, setShowCard] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Derived, never stored: the card re-draws from the CURRENT picks on
  // every change while open, so a stale card never sits behind a fresh
  // list. The picks serialization is the dependency the list identity
  // can't provide.
  // F01 12.2: the reader's own choice decides the card's palette. Before
  // hydration `restored` is false and the snapshot answers dark, which is the
  // safe way round — the card is not drawn until the reader presses the button,
  // which cannot happen before hydration.
  const { theme } = useStoredTheme();

  const picksKey = JSON.stringify(picks);
  const cardUrl = useMemo(() => {
    if (!showCard || picks.length === 0) return null;
    /*
     * **BC-12 (2026-08-24): the THIRD date-format implementation, consolidated.**
     *
     * It spelled the month out already and stopped there — "August 24, 2026"
     * against the house "August 24th, 2026" — so it was close enough to look
     * right and different enough to be a separate convention. That is the
     * duplicate-implementation shape RULING 103 names: a sweep for the numeric
     * form would never have found it.
     *
     * `en-CA` gives the local calendar date as `YYYY-MM-DD`, which is what the
     * one formatter takes.
     */
    const today = new Date().toLocaleDateString("en-CA");
    return drawCard(picks, formatDateLong(today) ?? today, cardPalette());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCard, picksKey, theme]);

  return (
    <div className="mt-2.5">
      <p className="flex flex-wrap gap-x-3 gap-y-1 t-detail">
        <button
          type="button"
          onClick={() => setShowCard(true)}
          className="cursor-pointer text-signal underline decoration-dotted hover:no-underline"
        >
          Create my card
        </button>
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className="cursor-pointer text-muted underline decoration-dotted hover:text-paper"
        >
          Clear my picks
        </button>
      </p>

      {/* Item 8 (design pass): a real confirmation dialog — same question
          the inline line asked, in the app's dialog language. Portaled to
          <body> so no ancestor transform can trap the overlay. */}
      {confirmingClear &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Clear my picks"
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-black/45 backdrop-blur-sm"
              onClick={() => setConfirmingClear(false)}
            />
            {/*
              Item 6 (2026-08-15) — and it is SUBTRACTION.

              The second sentence used to read "your picks were never sent
              anywhere, so there is nothing to clear elsewhere." Half of that
              is true: the picks themselves are device-local. The other half
              quietly wasn't — the taps that created them joined anonymous
              local totals, exactly as the capture disclosure says they do,
              and those totals cannot be un-joined by this button. A reader
              who reads that sentence and clicks Clear believes something
              about this product that is not so.

              The fix is not a longer, more careful sentence. It is no
              sentence: the dialog asks its question, and the data story
              stays where it already lives and is already true — the one-time
              notice at the point of capture, and "What this site collects".
              A dialog is not the place to re-explain the business model, and
              a half-truth is worse than a link.
            */}
            <div className="panel relative w-full max-w-sm p-5">
              <p className="t-heading font-semibold leading-snug text-paper">
                Really clear every pick?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    /*
                     * F01-continued item 9. `clearAllPicks()` alone emptied
                     * the explicit file and left every derived pick standing
                     * on the page below — the card went, the picks did not,
                     * and a control that reads as a delete was not one.
                     *
                     * The suppression is resolved against NO explicit picks,
                     * because this call is about to remove them: a contest
                     * holding both a tapped pick and a Yes would otherwise
                     * resolve EXPLICIT, escape suppression, and re-derive the
                     * Yes in the same render. That is what shipped in the
                     * first draft of this fix and what the four-zip walk
                     * caught.
                     */
                    clearAllPicks(derivedToSuppress(pickable, yesTargets, cleared));
                    setConfirmingClear(false);
                    setShowCard(false);
                  }}
                  className="cursor-pointer rounded-md border border-[var(--danger)] px-4 py-2 t-body font-semibold text-danger transition-colors hover:bg-[var(--danger)]/10"
                >
                  Clear
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmingClear(false)}
                  className="cursor-pointer rounded-md border border-[var(--panel-border)] px-4 py-2 t-body font-semibold text-paper transition-colors hover:border-paper"
                >
                  Keep
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/*
        F01 12.1 (2026-08-19): "Create my card" should pop up as its own
        phone-style screenshot, rounded at the edges, with the background
        still visible — like taking a screenshot of what is on screen now.

        It used to render inline, in the page flow, as a bare rectangle under
        two links — the thing itself, unframed, with no sense that it was a
        picture the reader was about to take out of the app.

        It is now a PORTALED overlay: the live page stays visible behind a light
        scrim, and the card sits inside a phone-shaped frame — rounded corners,
        a device bezel, the shadow that lifts it off what is behind. The reader
        is looking at a screenshot of their own screen, which is exactly the
        thing they are about to make.

        Portaled to `<body>` for the same reason the clear dialog is: an
        ancestor transform would trap a fixed overlay. Dismissal follows the
        product's rule — the scrim closes it, Escape closes it, and there is an
        explicit control, because a gesture nobody discovers is not an exit.
      */}
      {cardUrl &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="My picks card"
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCard(false);
            }}
          >
            {/* Light enough that the page reads THROUGH it — the point is that
                the reader can still see what they were looking at. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
              onClick={() => setShowCard(false)}
            />

            <div className="relative flex max-h-full w-full max-w-[320px] flex-col items-center">
              <div className="picks-phone">
                {/* A plain <img> inside the frame, so a long-press or a
                    screenshot works exactly as the reader expects. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardUrl}
                  alt="My picks card — your own choices"
                  className="picks-phone-shot"
                />
              </div>

              <p className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-center t-detail">
                <a
                  href={cardUrl}
                  download="my-picks.png"
                  className="text-signal underline decoration-dotted hover:no-underline"
                >
                  Download as image
                </a>
                <button
                  type="button"
                  onClick={() => setShowCard(false)}
                  className="cursor-pointer text-muted underline decoration-dotted hover:text-paper"
                >
                  Close
                </button>
              </p>
              <p className="mt-1 text-center t-caption leading-relaxed text-muted">
                Or just screenshot it.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
