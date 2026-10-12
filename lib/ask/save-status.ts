/** Saving and answering are independent outcomes of the same request. */
export type AskSaveStatus = "SAVED" | "QUEUED" | "FAILED" | "PAUSED";
export const ASK_SAVE_STATUS_HEADER = "x-wtp-ask-save-status";

export function askSaveNotice(headers: Pick<Headers, "get">): string | null {
  const status = headers.get(ASK_SAVE_STATUS_HEADER);
  if (status === "SAVED" || status === "QUEUED") return null;
  if (status === "PAUSED") return "Saving questions is paused. Your answer is still available.";
  // A failed acknowledgement, older server, or missing receipt cannot prove
  // whether the write committed. Keep the answer and state that uncertainty.
  return "We couldn't confirm that this question was saved. Your answer is still available.";
}
