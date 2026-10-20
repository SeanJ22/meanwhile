/**
 * An outcome child reads its own door: it rebuilds the same outcome contracts
 * from the registry and installs the door hosts. It never writes a door.
 */
import { refreshOutcomePartitions, outcomePartitionForDoor, type OutcomePartitionContract } from "../civic-data/outcome-partitions.ts";
import { installDoorHosts } from "../civic-data/source-authority.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { listDoors, type DoorRepository } from "./registry.ts";
import { meetingDoorHosts } from "./rows.ts";

export async function loadOutcomePartitionForDoor(doorId: string, repo?: DoorRepository): Promise<OutcomePartitionContract> {
  let doors: Awaited<ReturnType<typeof listDoors>>["doors"];
  if (repo !== undefined) doors = (await listDoors(repo)).doors;
  else {
    const url = controlPlaneUrlFromEnv();
    if (url === null) throw new Error("OUTCOME_DOOR_REGISTRY_UNREACHABLE: no control-plane connection is configured");
    doors = (await listDoors((await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })).doors)).doors;
  }
  const refreshed = refreshOutcomePartitions(doors);
  if (!refreshed.refreshed) throw new Error(`OUTCOME_DOOR_NOT_BUILT: ${refreshed.reason}`);
  installDoorHosts(meetingDoorHosts(doors));
  const partition = outcomePartitionForDoor(doorId);
  if (partition === null) throw new Error(`OUTCOME_DOOR_NOT_FOUND: ${doorId} is no longer an open door that holds outcomes`);
  return partition;
}
