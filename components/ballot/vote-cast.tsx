"use client";

import { useState, useSyncExternalStore } from "react";

import {
  getStoredReaction,
  NOT_COUNTED_LINE,
  rememberReaction,
  submitReaction,
  subscribeReactions,
  type ReactionSubmitOutcome,
  type ReactionViewContext,
} from "@/lib/reactions/client";
import {
  FREE_TEXT_MAX_CHARS,
  FREE_TEXT_THREAT_NOTICE,
  SCALE_V4_VOTE_CAST,
  VOTE_CAST_NONE,
  voteCastTargetId,
} from "@/lib/signal/reactions";
import { captureEvent } from "@/lib/events/client";
import styles from "./vote-cast.module.css";

/**
 * "How did you vote? Tell us why.", asked once a contest's polls have closed. It runs through the same
 * reactions system as "Would you vote for them?": a pick is a YES on `<contest>@<option>`, tapping the
 * pick again is a NO that deletes it. The answer shows only from this device's own record, no total is
 * ever rendered, and the typed reason is held on this device until it is sent.
 */

const draftKey = (contestId: string) => `wtp.vote-cast-draft:${contestId}`;

function readDraft(contestId: string): string {
  try { return window.localStorage.getItem(draftKey(contestId)) ?? ""; } catch { return ""; }
}


function writeDraft(contestId: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(draftKey(contestId), text);
    else window.localStorage.removeItem(draftKey(contestId));
  } catch { /* storage unavailable: the box still works for this visit */ }
}

interface VoteCastOption {
  id: string;
  label: string;
  /** The ids this candidate carried on the earlier "Would you vote for them?" question. */
  beforeIds?: readonly string[];
}

export function VoteCastBox({ contestId, options, context }: {
  contestId: string;
  options: readonly VoteCastOption[];
  kind: "candidates" | "measure";
  context: ReactionViewContext | null;
}) {
  const choices: readonly VoteCastOption[] = [...options, { id: VOTE_CAST_NONE, label: "Didn't vote on this" }];
  const target = (optionId: string) => voteCastTargetId(contestId, optionId);

  const selected = useSyncExternalStore(
    subscribeReactions,
    () => choices.find(option => getStoredReaction("VOTE_CAST", target(option.id)) === "YES")?.id ?? "",
    () => "",
  );
  const earlier = useSyncExternalStore(
    subscribeReactions,
    () => options.find(option => getStoredReaction("CANDIDATE", option.id, option.beforeIds) === "YES")?.label ?? "",
    () => "",
  );

  /* The held draft reads through the same hydration-safe path; `typed` takes over from the first keystroke. */
  const held = useSyncExternalStore(subscribeReactions, () => readDraft(contestId), () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? held;
  const [sent, setSent] = useState(false);
  const [outcome, setOutcome] = useState<ReactionSubmitOutcome | null>(null);

  const pick = async (optionId: string) => {
    setSent(false);
    if (selected === optionId) {
      setOutcome(await submitReaction("VOTE_CAST", target(optionId), "NO", context));
      return;
    }
    captureEvent({ type: "REACTION", cardId: `VOTE_CAST:${target(optionId)}`, cardKind: "VOTE_CAST", reaction: "YES" });
    /* The server drops the earlier answer when this one lands; the device record follows at once. */
    if (selected) rememberReaction("VOTE_CAST", target(selected), "NO");
    setOutcome(await submitReaction("VOTE_CAST", target(optionId), "YES", context));
  };

  const send = async () => {
    const result = await submitReaction("VOTE_CAST", target(selected), "YES", context, text.trim() || null);
    setOutcome(result);
    if (result === "COUNTED") {
      writeDraft(contestId, "");
      setTyped("");
      setSent(true);
    }
  };

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <p className={styles.title}>{SCALE_V4_VOTE_CAST.question}</p>
        {earlier && <p className={styles.reminder}>Before the election you said Yes to {earlier}.</p>}
      </div>
      <div className={styles.options} role="group" aria-label={SCALE_V4_VOTE_CAST.question}>
        {choices.map(option => (
          <button key={option.id} type="button" className={styles.option} aria-pressed={selected === option.id}
            onClick={() => void pick(option.id)}>{option.label}</button>
        ))}
      </div>
      {selected && (
        <>
          <textarea className={styles.why} rows={3} maxLength={FREE_TEXT_MAX_CHARS} value={text}
            placeholder="Tell us why (optional)" aria-label="Tell us why (optional)"
            onChange={event => { setTyped(event.target.value); setSent(false); writeDraft(contestId, event.target.value); }} />
          <p className={styles.note}>{FREE_TEXT_THREAT_NOTICE}</p>
          <div className={styles.foot}>
            <span className={styles.note}>{sent ? "Sent." : "Saved on this device until you send it."}</span>
            <button type="button" className={styles.send} disabled={!text.trim()} onClick={() => void send()}>Send</button>
          </div>
        </>
      )}
      {outcome === "NOT_COUNTED" && <p className={styles.note}>{NOT_COUNTED_LINE}</p>}
    </div>
  );
}
