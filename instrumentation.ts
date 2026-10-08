/**
 * Runs once when a server instance starts. Every Reader and Admin page reads meeting doors (which boards are live,
 * which partitions make up the meetings, which bodies publish no history), and those come only from the published
 * door registry: the instance installs them before it serves, and reads them again in the background as they age.
 */
const FIRST_READ_BOUND_MS = 8_000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureMeetingDoors, MEETING_DOORS_REFRESH_MS } = await import("@/lib/doors/meeting-doors");
  const first = ensureMeetingDoors().then((ready) => {
    if (!ready.ready) console.warn(`READER_MEETING_DOORS_UNREAD: ${ready.reason}`);
  });
  // A slow store must not hold the instance closed; the read goes on and installs the doors when it answers.
  await Promise.race([first, new Promise((resolve) => setTimeout(resolve, FIRST_READ_BOUND_MS).unref())]);
  setInterval(() => void ensureMeetingDoors(), MEETING_DOORS_REFRESH_MS).unref();
}
