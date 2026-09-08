"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateLong } from "@/lib/text/format-date";
import { createPortal } from "react-dom";
import { Camera, Download, ListChecks, Trash2, X } from "lucide-react";

import { useStoredTheme } from "@/hooks/use-stored-theme";
import { clearAllPicks, type StoredPick } from "@/lib/ballot/picks";
import {
  derivedToSuppress,
  type PickableContest,
} from "@/lib/ballot/pick-tally";
import { PRODUCT_NAME } from "@/lib/brand";
import styles from "./picks-card.module.css";

/**
 * The picks card (session item 5, wall clock 2026-08-14 second session,
 * author-approved): the reader's OWN ballot, screenshottable. The
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

const CARD_MIN_WIDTH = 320;
const CARD_MAX_WIDTH = 680;
const SCALE = 2;
const PAD = 28;

/**
 * **THE CARD FOLLOWS THE THEME** — F01 12.2, 2026-08-19, the author.
 *
 * *"I'm in the light version and it's shown as dark, and it needs to follow
 * whatever I've selected, whether I've selected light or dark."*
 *
 * The old single palette was a DELIBERATE choice with a stated reason — "the
 * card leaves the app, so it must stand alone" — and the author has overruled
 * it. He is right about the thing that matters: a reader in light mode presses
 * a button and gets a dark rectangle, which reads as a bug long before anyone
 * reasons about where the image will end up.
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
  glow: string;
  rule: string;
  muted: string;
  paper: string;
  accent: string;
};

const PALETTES: Record<"dark" | "light", CardPalette> = {
  dark: {
    bg: "#101418",
    glow: "#252c33",
    rule: "#2a3138",
    muted: "#8a949e",
    paper: "#f2f4f6",
    accent: "#ffb000",
  },
  light: {
    bg: "#fbfaf7",
    glow: "#ece9e2",
    rule: "#dcd8d0",
    muted: "#6b7280",
    paper: "#14181c",
    // Darkened from the dark palette's amber: #ffb000 on near-white fails
    // contrast outright, and the label above it is the card's own name.
    accent: "#8a5a00",
  },
};

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
  width: number,
  fontFamily: string,
): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const inner = width - PAD * 2;
  const font = fontFamily || "system-ui, sans-serif";

  // Measure pass: same fonts as the draw pass.
  type Block = { title: string[]; choices: string[] };
  const blocks: Block[] = picks.map((pick) => {
    ctx.font = `600 13px ${font}`;
    const title = wrapLines(ctx, pick.contestTitle, inner);
    ctx.font = `650 18px ${font}`;
    const choices = wrapLines(
      ctx,
      pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", "),
      inner,
    );
    return { title, choices };
  });

  ctx.font = `500 12px ${font}`;
  const intro = wrapLines(
    ctx,
    "My own list, saved only in this browser on this device.",
    inner,
  );
  const footer = wrapLines(ctx, `My picks — made with ${PRODUCT_NAME}, ${madeOn}`, inner);
  const headerRuleY = PAD + 46 + intro.length * 18;
  const headerH = headerRuleY + 20;
  const footerH = 30 + footer.length * 17;
  const blockH = (b: Block) =>
    b.title.length * 18 + b.choices.length * 24 + 22;
  const height =
    headerH + blocks.reduce((n, b) => n + blockH(b), 0) + footerH + PAD;

  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  const lumen = ctx.createRadialGradient(
    width / 2,
    height,
    0,
    width / 2,
    height,
    Math.max(width, height) * 0.78,
  );
  lumen.addColorStop(0, colors.glow);
  lumen.addColorStop(0.7, colors.bg);
  ctx.fillStyle = lumen;
  ctx.fillRect(0, 0, width, height);

  // Header.
  ctx.fillStyle = colors.accent;
  ctx.font = `700 20px ${font}`;
  ctx.fillText("My picks", PAD, PAD + 18);
  ctx.fillStyle = colors.muted;
  ctx.font = `500 12px ${font}`;
  let introY = PAD + 42;
  for (const line of intro) {
    ctx.fillText(line, PAD, introY);
    introY += 18;
  }
  ctx.strokeStyle = colors.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, headerRuleY);
  ctx.lineTo(width - PAD, headerRuleY);
  ctx.stroke();

  // Contest blocks.
  let y = headerH + 16;
  for (const block of blocks) {
    ctx.fillStyle = colors.muted;
    ctx.font = `600 13px ${font}`;
    for (const line of block.title) {
      ctx.fillText(line, PAD, y);
      y += 18;
    }
    ctx.fillStyle = colors.paper;
    ctx.font = `650 18px ${font}`;
    for (const line of block.choices) {
      ctx.fillText(line, PAD, y + 5);
      y += 24;
    }
    y += 22;
  }

  // Footer — the app name and the date, nothing evaluative.
  ctx.strokeStyle = colors.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 4);
  ctx.lineTo(width - PAD, y - 4);
  ctx.stroke();
  ctx.fillStyle = colors.muted;
  ctx.font = `500 12px ${font}`;
  y += 17;
  for (const line of footer) {
    ctx.fillText(line, PAD, y);
    y += 17;
  }

  const horizon = ctx.createLinearGradient(width * 0.15, 0, width * 0.85, 0);
  horizon.addColorStop(0, "rgba(255,255,255,0)");
  horizon.addColorStop(0.5, colors.accent);
  horizon.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = horizon;
  ctx.fillRect(width * 0.15, height - 2, width * 0.7, 1);
  ctx.globalAlpha = 1;

  return canvas.toDataURL("image/png");
}

function viewportCardWidth(): number {
  if (typeof window === "undefined") return CARD_MIN_WIDTH;
  return Math.min(
    CARD_MAX_WIDTH,
    Math.max(CARD_MIN_WIDTH, Math.floor(window.innerWidth - 48)),
  );
}

function pngBlob(dataUrl: string): Blob {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = window.atob(payload);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
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
  const [cardWidth, setCardWidth] = useState(CARD_MIN_WIDTH);
  const [screenshotMessage, setScreenshotMessage] = useState<string | null>(null);
  const cardDialogRef = useRef<HTMLDivElement>(null);
  const cardOpenerRef = useRef<HTMLElement | null>(null);

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
     * against the author's "August 24th, 2026" — so it was close enough to look
     * right and different enough to be a separate convention. That is the
     * duplicate-implementation shape RULING 103 names: a sweep for the numeric
     * form would never have found it.
     *
     * `en-CA` gives the local calendar date as `YYYY-MM-DD`, which is what the
     * one formatter takes.
     */
    const today = new Date().toLocaleDateString("en-CA");
    const fontFamily = window.getComputedStyle(document.body).fontFamily;
    return drawCard(
      picks,
      formatDateLong(today) ?? today,
      PALETTES[theme],
      cardWidth,
      fontFamily,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCard, picksKey, theme, cardWidth]);

  const openCard = () => {
    cardOpenerRef.current = document.activeElement as HTMLElement | null;
    setCardWidth(viewportCardWidth());
    setScreenshotMessage(null);
    setShowCard(true);
  };

  useEffect(() => {
    if (!showCard || !cardDialogRef.current) return;
    const dialog = cardDialogRef.current;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
    const controls = focusable();
    controls[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      cardOpenerRef.current?.focus();
    };
  }, [showCard]);

  const copyScreenshot = async () => {
    if (!cardUrl) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Image clipboard unavailable");
      }
      const image = pngBlob(cardUrl);
      await navigator.clipboard.write([
        new ClipboardItem({ [image.type]: image }),
      ]);
      setScreenshotMessage(
        "Card copied as an image. Paste it wherever you keep screenshots.",
      );
    } catch {
      setScreenshotMessage(
        "Use your device’s screenshot shortcut while this card is open.",
      );
    }
  };

  return (
    <div className="mt-3">
      <div className={styles.summaryActions}>
        <button
          type="button"
          onClick={openCard}
          className={`${styles.pill} ${styles.primaryPill}`}
        >
          <ListChecks aria-hidden="true" />
          Create my card
        </button>
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className={`${styles.pill} ${styles.clearPill}`}
        >
          <Trash2 aria-hidden="true" />
          Clear my picks
        </button>
      </div>

      <button
        type="button"
        onClick={openCard}
        className={styles.floatingPill}
        aria-haspopup="dialog"
        aria-expanded={showCard}
        data-your-picks-floating
      >
        <ListChecks aria-hidden="true" />
        Your Picks
      </button>

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
              Item 6 (2026-08-15) — the author's order, and it is SUBTRACTION.

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
              <p className="text-[0.9375rem] font-semibold leading-snug text-paper">
                Really clear every pick on this device?
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
                  className="cursor-pointer rounded-md border border-[var(--danger)] px-4 py-2 text-[0.8125rem] font-semibold text-danger transition-colors hover:bg-[var(--danger)]/10"
                >
                  Clear
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmingClear(false)}
                  className="cursor-pointer rounded-md border border-[var(--panel-border)] px-4 py-2 text-[0.8125rem] font-semibold text-paper transition-colors hover:border-paper"
                >
                  Keep
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/*
        F01 12.1 (2026-08-19, the author): *"The 'Create my card' thing is ugly.
        What I would like it to do is pop up as if it's its own phone kind of
        screenshot, rounded at the edges, so that I can still see the
        background. It should be like I'm taking a screenshot of what's going on
        right now."*

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
            className={styles.overlay}
            ref={cardDialogRef}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCard(false);
            }}
          >
            {/* Light enough that the page reads THROUGH it — the point is that
                the reader can still see what they were looking at. */}
            <div
              aria-hidden="true"
              className={styles.backdrop}
              onClick={() => setShowCard(false)}
            />

            <div className={styles.modalFrame}>
              <div className={styles.preview}>
                {/* A plain <img> inside the frame, so a long-press or a
                    screenshot works exactly as the reader expects. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardUrl}
                  alt="My picks card — your own choices, drawn on this device"
                  className={styles.cardImage}
                />
              </div>

              <div className={styles.cardActions} aria-label="Card actions">
                <a
                  href={cardUrl}
                  download="my-picks.png"
                  className={`${styles.pill} ${styles.primaryPill}`}
                >
                  <Download aria-hidden="true" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={copyScreenshot}
                  className={styles.pill}
                >
                  <Camera aria-hidden="true" />
                  Screenshot
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setShowCard(false)}
                  className={styles.pill}
                >
                  <X aria-hidden="true" />
                  Close
                </button>
              </div>
              <p
                className={styles.deviceLine}
                role="status"
                aria-live="polite"
              >
                {screenshotMessage ??
                  "Drawn on your device. Download or copy the image without sending it to us."}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
