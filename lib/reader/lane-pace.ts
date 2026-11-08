import { processNeonBytes } from "../db/transfer-by-caller.ts";

/** Everything the database meter has counted in this process, requests and responses of both databases: a paced lane owes the time exactly these bytes take. */
export const databaseBytesSpent = (): number => processNeonBytes().reduce((sum, hour) => sum + hour.bytes.reader + hour.bytes["control-plane"] + (hour.sent?.reader.bytes ?? 0) + (hour.sent?.["control-plane"].bytes ?? 0), 0);

/** The time a lane owes for the bytes it moved at its allowance an hour; 5% over what the meter counts is owed, for the hour's edges and a go that runs past it. */
export const owedMsFor = (bytes: number, bytesPerHour: number): number => Math.ceil(bytes * 1.05 / bytesPerHour * 3_600_000);

/** Work that ignores the turn's end cannot hold the turn open past it. */
export const untilEnd = <T,>(end: AbortSignal | undefined, work: Promise<T>): Promise<T> => end ? Promise.race([work, new Promise<never>((_, reject) => {
  if (end.aborted) reject(end.reason); else end.addEventListener("abort", () => reject(end.reason), { once: true }); })]) : work;
