"use client";

import { useMemo, useState } from "react";

import { clearAllPicks, type StoredPick } from "@/lib/ballot/picks";

/**
 * The picks card (session item 5, wall clock 2026-08-14 second session,
 * author-approved): the reader's OWN ballot, screenshottable. The
 * tester's use case verbatim — build picks on the couch, screenshot one
 * card, carry it into the booth.
 *
 * HARD CONSTRAINTS, from the brief: the reader's device-local picks
 * ONLY. No aggregates, no reactions, no totals, no app commentary, no
 * candidate photos. The card carries the app name and "My picks — made
 * with We the People, [date]" and nothing evaluative. It is the
 * reader's artifact, not the app's opinion.
 *
 * Nothing about the picks store changes: the card is drawn onto a
 * <canvas> from localStorage entirely in the browser — creating or
 * downloading it transmits nothing.
 */

const WIDTH = 360;
const SCALE = 3; // crisp on a phone screen
const PAD = 24;

const COLORS = {
  // One deliberate look, independent of app theme — the card leaves the
  // app, so it must stand alone.
  bg: "#101418",
  rule: "#2a3138",
  muted: "#8a949e",
  paper: "#f2f4f6",
  accent: "#ffb000",
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

function drawCard(picks: StoredPick[], madeOn: string): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const inner = WIDTH - PAD * 2;

  // Measure pass: same fonts as the draw pass.
  type Block = { title: string[]; choices: string[] };
  ctx.font = "11px ui-monospace, monospace";
  const blocks: Block[] = picks.map((pick) => {
    ctx.font = "11px ui-monospace, monospace";
    const title = wrapLines(ctx, pick.contestTitle, inner);
    ctx.font = "600 15px system-ui, sans-serif";
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

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header.
  ctx.fillStyle = COLORS.accent;
  ctx.font = "600 11px ui-monospace, monospace";
  ctx.fillText("MY PICKS", PAD, PAD + 10);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("This is my own list — written by me, not the app.", PAD, PAD + 26);
  ctx.strokeStyle = COLORS.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, headerH);
  ctx.lineTo(WIDTH - PAD, headerH);
  ctx.stroke();

  // Contest blocks.
  let y = headerH + 22;
  for (const block of blocks) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "11px ui-monospace, monospace";
    for (const line of block.title) {
      ctx.fillText(line, PAD, y);
      y += 15;
    }
    ctx.fillStyle = COLORS.paper;
    ctx.font = "600 15px system-ui, sans-serif";
    for (const line of block.choices) {
      ctx.fillText(line, PAD, y + 3);
      y += 20;
    }
    y += 18;
  }

  // Footer — the app name and the date, nothing evaluative.
  ctx.strokeStyle = COLORS.rule;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 4);
  ctx.lineTo(WIDTH - PAD, y - 4);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`My picks — made with We the People, ${madeOn}`, PAD, y + 14);

  return canvas.toDataURL("image/png");
}

export function PicksCardControls({ picks }: { picks: StoredPick[] }) {
  const [showCard, setShowCard] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Derived, never stored: the card re-draws from the CURRENT picks on
  // every change while open, so a stale card never sits behind a fresh
  // list. The picks serialization is the dependency the list identity
  // can't provide.
  const picksKey = JSON.stringify(picks);
  const cardUrl = useMemo(() => {
    if (!showCard || picks.length === 0) return null;
    return drawCard(
      picks,
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCard, picksKey]);

  return (
    <div className="mt-2.5">
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem]">
        <button
          type="button"
          onClick={() => setShowCard(true)}
          className="cursor-pointer text-signal underline decoration-dotted hover:no-underline"
        >
          Create my card
        </button>
        {confirmingClear ? (
          <span className="text-paper-dim">
            Really clear every pick on this device?{" "}
            <button
              type="button"
              onClick={() => {
                clearAllPicks();
                setConfirmingClear(false);
                setShowCard(false);
              }}
              className="cursor-pointer text-signal underline decoration-dotted"
            >
              Clear
            </button>{" "}
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className="cursor-pointer text-muted underline decoration-dotted"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="cursor-pointer text-muted underline decoration-dotted hover:text-paper"
          >
            Clear my picks
          </button>
        )}
      </p>

      {cardUrl && (
        <div className="mt-3">
          {/* The card itself — a plain <img>, so a long-press or
              screenshot works exactly as the reader expects. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt="My picks card — your own choices, drawn on this device"
            className="w-full max-w-[360px] rounded border border-[var(--panel-border)]"
          />
          <p className="mt-1.5 text-[0.75rem]">
            <a
              href={cardUrl}
              download="my-picks.png"
              className="text-signal underline decoration-dotted hover:no-underline"
            >
              Download as image
            </a>{" "}
            <span className="text-muted">
              — or just screenshot it. Drawn on your device; nothing is sent
              anywhere.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
