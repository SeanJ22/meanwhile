import { resolve } from "node:path";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { ballotInputStamp } from "./ballot-input.ts";
import { requireBallotState, type BallotState } from "./state-scopes.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { registeredVotingSourceDoors } from "../ballot/voting-source-publication.ts";
import type { VotingSourceDoor } from "../ballot/voting-source-types.ts";
import { readJsonFile } from "../ops/json-file.ts";

type Repositories = Pick<ControlPlaneRepositories, "doors" | "ownerDigests">;
export interface RoutineInput {
  readonly taskId: string;
  readonly inputStamp: string;
  readonly at: string;
}

export function routineInputState(taskId: string): BallotState | null {
  const state = /^(?:registration-([a-z]{2})|voting-sites:([A-Z]{2}))$/.exec(taskId);
  return state ? requireBallotState(state[1] ?? state[2]) : null;
}

/** Hash only this state's door definitions, excluding the registry's health and read timestamps. */
export async function routineInputStamp(root: string, taskId: string, repos: Pick<Repositories, "doors">): Promise<string | null> {
  const state = routineInputState(taskId);
  if (!state) return null;
  if (taskId.startsWith("registration-")) return ballotInputStamp(resolve(root, "data/derived/registration"), state);
  const inputs: Record<string, unknown> = {};
  for (const file of ["voting-source-doors.json", "voting-legacy-doors.json"]) {
    const doors: VotingSourceDoor[] = [];
    await readJsonFile(resolve(root, "data/reference", file), { streamArray: path => path.length === 0,
      onRow: (_path, row) => { const door = row as VotingSourceDoor; if (door.scope.state === state) doors.push(door); } });
    inputs[file] = doors.sort((a, b) => a.id.localeCompare(b.id));
  }
  inputs.cp_doors = (await registeredVotingSourceDoors(repos.doors, state)).sort((a, b) => a.id.localeCompare(b.id));
  return `content:${canonicalCivicDataHash(inputs)}`;
}

const logKey = (taskId: string) => `routine-input:${taskId}`;

export async function readRoutineInput(repos: Pick<Repositories, "ownerDigests">, taskId: string): Promise<RoutineInput | null> {
  const key = logKey(taskId);
  const rows = await repos.ownerDigests.readLatest([key], { routineInput: ["taskId", "inputStamp", "at"] });
  const input = (rows.get(key) as { routineInput?: RoutineInput } | undefined)?.routineInput;
  return input?.taskId === taskId && typeof input.inputStamp === "string" && Number.isFinite(Date.parse(input.at)) ? input : null;
}

export function routineInputChanged(inputStamp: string | null, prior: RoutineInput | null): boolean {
  return inputStamp !== null && inputStamp !== prior?.inputStamp;
}

/** The existing publication history keeps the input consumed by an actual source attempt. */
export async function recordRoutineInput(repos: Pick<Repositories, "ownerDigests">, input: RoutineInput,
  context: { readonly cycleId: string; readonly testedSha: string | null }): Promise<void> {
  const digestId = `${context.cycleId}:${logKey(input.taskId)}`;
  await repos.ownerDigests.append(logKey(input.taskId), digestId, {
    formatVersion: 1, digestId, writtenAt: input.at, testedSha: context.testedSha, cycleOk: null,
    headline: "Source input processed", lines: [], routineInput: input,
  }, input.at);
}
