import { readFile } from "node:fs/promises";
import { installDoorRecords } from "../../lib/doors/meeting-doors.ts";
import { isDoorRecord, type DoorRecord } from "../../lib/doors/registry.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../../lib/control-plane/repository/pg-store.ts";
import type { RetainedSourceResponse } from "../../lib/civic-data/retained-meeting-bytes.ts";
import { installMeetingClock, type MeetingClock } from "../../lib/civic-data/contracts.ts";
import { validateRetainedSourceResponse } from "./retained-source-replay.ts";

/** Source children read only their registered body door, including on ordinary routine invocations. */
export async function readHeldMeetingChildInput(argv: readonly string[], doorId: string): Promise<{ door: DoorRecord; initialResponse?: RetainedSourceResponse }> {
  const file = argv.find(arg => arg.startsWith("--prepared-file="))?.slice("--prepared-file=".length);
  let door: DoorRecord | null = null;
  let initialResponse: RetainedSourceResponse | undefined;
  if (file) {
    const prepared = JSON.parse(await readFile(file, "utf8")) as {
      doorRecord?: DoorRecord;
      initialResponse?: Omit<RetainedSourceResponse, "bytes"> & { base64: string };
      meetingClock?: MeetingClock;
    };
    door = prepared.doorRecord ?? null;
    if (prepared.meetingClock) {
      const clock = prepared.meetingClock;
      if (![clock.windowMs, clock.hotEveryMs, clock.baseEveryMs].every(value => Number.isFinite(value) && value > 0) ||
        clock.windowMs < 7 * 86_400_000 || clock.hotEveryMs > 3_600_000 || clock.baseEveryMs > 12 * 3_600_000) throw new Error("HELD_MEETING_ADMIN_CLOCK_INVALID");
      installMeetingClock(clock);
    }
    if (prepared.initialResponse) {
      initialResponse = { ...prepared.initialResponse, bytes: new Uint8Array(Buffer.from(prepared.initialResponse.base64, "base64")) };
      validateRetainedSourceResponse(initialResponse);
    }
  } else {
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("HELD_MEETING_DOOR_STORE_UNAVAILABLE");
    const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
    door = (await repos.doors.read(doorId))?.value ?? null;
  }
  if (!door || !isDoorRecord(door) || door.doorId !== doorId || door.bodyIds.length !== 1) throw new Error(`HELD_MEETING_DOOR_NOT_ONE_BODY:${doorId}`);
  installDoorRecords([door], "the routine outcome child's own held door");
  return { door, ...(initialResponse ? { initialResponse } : {}) };
}
