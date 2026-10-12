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
 * The reader's own picks drawn onto a `<canvas>` in the browser for a
 * screenshot. Device-local picks only: no aggregates, reactions, photos or
 * commentary. Creating or downloading it transmits nothing.
 */

const WIDTH = 360;
const SCALE = 3; // crisp on a phone screen
const PAD = 24;

/** Literal colors, because a canvas cannot read CSS variables; one set per theme. */
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
   * What is resolved on screen now, so the clear can suppress derived picks.
   * Defaulted so a caller without ballot context gets an explicit-only clear.
   */
  pickable?: PickableContest[];
  yesTargets?: ReadonlySet<string>;
  cleared?: Record<string, string[]>;
}) {
  const [showCard, setShowCard] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // The card re-draws from the current picks and theme while open.
  const { theme } = useStoredTheme();

  const picksKey = JSON.stringify(picks);
  const cardUrl = useMemo(() => {
    if (!showCard || picks.length === 0) return null;
    /* `en-CA` gives the local date as `YYYY-MM-DD`, which the formatter takes. */
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

      {/* Portaled to <body> so no ancestor transform can trap the overlay. */}
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
            <div className="panel relative w-full max-w-sm p-5">
              <p className="t-heading font-semibold leading-snug text-paper">
                Really clear every pick?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    /*
                     * Suppression is resolved against no explicit picks, since
                     * they are about to be removed; otherwise a contest with both
                     * would re-derive its Yes in the same render.
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

      {/* Portaled overlay; scrim, Escape and an explicit control all close it. */}
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
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
              onClick={() => setShowCard(false)}
            />

            <div className="relative flex max-h-full w-full max-w-[320px] flex-col items-center">
              <div className="picks-phone">
                {/* A plain <img> so long-press and screenshot work. */}
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
