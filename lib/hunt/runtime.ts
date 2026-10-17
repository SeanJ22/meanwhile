import { indexReportedFinding } from "../control-plane/box.ts";
import { readSetting } from "../control-plane/settings.ts";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import { FRESHNESS_PROJECT } from "../control-plane/scheduler/durable.ts";
import { readFieldManual, writeFieldManual, newFieldManualEntry, type FieldManualEntry } from "../control-plane/field-manual.ts";
import { blankRecordClass, scoutFieldManualQuery } from "../control-plane/scheduler/field-manual-scout.ts";
import { hunterExecutor, type ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../control-plane/scheduler/scout-tools.ts";
import type { DeclaredExecutor } from "../control-plane/scheduler/dispatch.ts";
import type { ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { RouteTask } from "../control-plane/route-task.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { DISCOVERY_SEARCH_ROLE, type CostEntry } from "../control-plane/cost.ts";
import { readRolePlaybook } from "../control-plane/playbooks.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { ABSENCE_MAX_HOLD_DEFAULT_DAYS, ABSENCE_MAX_HOLD_SETTING } from "../control-plane/scheduler/absence-hold.ts";
import { listDoors } from "../doors/registry.ts";
import { durableResearchTools, type ResearchRuntimeTools } from "../control-plane/workers/durable-research-tools.ts";
import type { ScoutToolContext } from "../control-plane/scheduler/scout-contract.ts";
import { huntBrief, type HuntRole } from "./brief.ts";
import { blankDigest, packetDue, triedSteps, type LastPacketJob, type PacketDue, type ShutDoorNote } from "./packet-due.ts";
import { blankFingerprint, HUNT_PACKET_ROUTE_ID, huntPacketObligationId, reportableSubjects, type HuntPacket } from "./packet.ts";
import { readGovernmentPackets } from "./packet-read.ts";
import { stateOfDivision } from "./packet-plan.ts";
import type { HuntSearch, SearchCharge } from "./search.ts";
import { foldAskGapObservations, readAskGapObservations, type AskedGap } from "../control-plane/ask-gap-observations.ts";

const NOTE_LIMIT = 12;

async function lastPacketJob(repos: Pick<ControlPlaneRepositories, "scoutResults">, governmentId: string): Promise<ScoutResult | null> {
  return (await repos.scoutResults.readRecent(huntPacketObligationId(governmentId), 1))[0] ?? null;
}

const lastJobOf = (result: ScoutResult | null): LastPacketJob | null =>
  result?.blankFingerprint ? { recordedAt: result.recordedAt, blankFingerprint: result.blankFingerprint, blankDigests: result.blankDigests ?? [] } : null;

const orderedAtOf = (assignments: readonly { readonly at: string }[] | undefined): string | null =>
  (assignments ?? []).reduce<string | null>((newest, mark) => newest === null || mark.at > newest ? mark.at : newest, null);

export async function shutDoorsOf(repos: Pick<ControlPlaneRepositories, "doors">, governmentId: string): Promise<ShutDoorNote[]> {
  const { doors } = await listDoors(repos.doors);
  return doors.filter(door => door.status === "SHUT" && door.ocdId === governmentId).map(door => ({ doorId: door.doorId, shutSince: door.shutSince,
    evidence: `${door.shutReason ?? "no reason was recorded"}; it reads ${door.hosts.join(", ") || "no recorded host"}` }));
}

export async function deadEndWaitMs(repos: Pick<ControlPlaneRepositories, "adminConfig">): Promise<number> {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const days = readSetting(row !== null && isAdminConfig(row.value) ? row.value : null, ABSENCE_MAX_HOLD_SETTING, ABSENCE_MAX_HOLD_DEFAULT_DAYS);
  return days * 86_400_000;
}

export function huntSearchCost(input: { readonly charge: SearchCharge; readonly attemptId: string; readonly workItemId: string;
  readonly routeTaskId: string; readonly governmentId: string; readonly assignmentKeys: readonly string[]; readonly recordedAt: string }): CostEntry {
  return {
    attemptId: input.attemptId, workItemId: input.workItemId, routeTaskId: input.routeTaskId, routeId: HUNT_PACKET_ROUTE_ID,
    source: input.charge.host, jurisdiction: input.governmentId, project: FRESHNESS_PROJECT,
    role: DISCOVERY_SEARCH_ROLE, model: null, obligationId: huntPacketObligationId(input.governmentId),
    ...(input.assignmentKeys.length ? { assignmentKeys: [...input.assignmentKeys] } : {}),
    cost: { inputTokens: null, outputTokens: null, usd: input.charge.usd, durationMs: null, bytesFetched: input.charge.bytes, requestCount: 1,
      cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null,
      uncachedInputTokens: null, batch: false },
    recordedAt: input.recordedAt,
  };
}

const recordClassesOf = (fields: readonly string[]): string[] =>
  [...new Set(fields.map(blankRecordClass).filter((value): value is string => value !== null))];

export function huntLearnings(result: ScoutResult, packet: Pick<HuntPacket, "governmentId" | "label">): FieldManualEntry[] {
  const state = stateOfDivision(packet.governmentId).toLowerCase();
  const byPage = new Map<string, string[]>();
  for (const finding of result.findings) if (finding.sourceUrl && finding.field) byPage.set(finding.sourceUrl, [...byPage.get(finding.sourceUrl) ?? [], finding.field]);
  return [
    ...[...byPage].map(([url, fields]) => newFieldManualEntry("hunt", `${packet.governmentId}|${url}`, {
      role: "SCOUT", kind: "SOURCE_PAGE", title: new URL(url).host, url, outcome: "YIELDED", states: [state], ocdIds: [packet.governmentId], recordClasses: recordClassesOf(fields),
      summary: `${[...new Set(fields)].join(", ")} for ${packet.label} found on this page`, observedAt: result.recordedAt })),
    ...(result.unfilled ?? []).map(blank => newFieldManualEntry("hunt", `${packet.governmentId}|${blank.subjectId}|${blank.field}`, {
      role: "SCOUT", kind: "DEAD_END", title: `${blank.field} for ${packet.label}`, outcome: "ZERO", states: [state], ocdIds: [packet.governmentId],
      recordClasses: recordClassesOf([blank.field]),
      summary: `Tried: ${blank.tried}. Would unlock: ${blank.unlock}`.replace(/\s+/g, " ").slice(0, 300), observedAt: result.recordedAt })),
  ];
}

export async function readAskedGaps(repos: Pick<ControlPlaneRepositories, "askGapObservations">, now: string): Promise<readonly AskedGap[]> {
  const reading = await readAskGapObservations(repos.askGapObservations);
  if ("unreadable" in reading) throw new Error(`the questions Ask could not answer could not be read (${reading.unreadable})`);
  return [...foldAskGapObservations(reading.rows, now).asked.values()];
}

export async function duePackets(repos: Pick<ControlPlaneRepositories, "scoutResults" | "doors" | "adminConfig" | "askGapObservations">,
  rows: readonly { readonly governmentId: string; readonly assignments?: readonly { readonly at: string }[] }[], now: string,
  read: typeof readGovernmentPackets = readGovernmentPackets): Promise<Map<string, PacketDue>> {
  const packets = await read(rows.map(row => row.governmentId), now, await readAskedGaps(repos, now));
  const maxWaitMs = await deadEndWaitMs(repos);
  const out = new Map<string, PacketDue>();
  for (const row of rows) {
    const packet = packets.get(row.governmentId);
    if (packet === undefined) { out.set(row.governmentId, { due: false, why: "its owed list could not be read" }); continue; }
    const [last, doors] = await Promise.all([lastPacketJob(repos, row.governmentId), shutDoorsOf(repos, row.governmentId)]);
    out.set(row.governmentId, packetDue({ packet, last: lastJobOf(last), orderedAt: orderedAtOf(row.assignments), shutDoors: doors, now, maxWaitMs }));
  }
  return out;
}

export interface HunterRuntimeInput {
  readonly repos: ControlPlaneRepositories;
  readonly root: string;
  readonly now: () => string;
  readonly tools: ResearchRuntimeTools;
  readonly transport: ModelTransport;
  readonly transportFor?: (taskId: string) => ModelTransport;
  readonly refusedBeforeSending?: (error: unknown) => boolean;
  readonly search?: HuntSearch;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly readHeldArtifact?: ScoutToolContext["readHeldArtifact"];
  readonly readPackets?: typeof readGovernmentPackets;
}

export async function hunterFor(input: HunterRuntimeInput, item: WorkItem, task: RouteTask): Promise<DeclaredExecutor> {
  const governmentId = item.subject;
  const last = await lastPacketJob(input.repos, governmentId);
  const doors = await shutDoorsOf(input.repos, governmentId).catch(() => [] as ShutDoorNote[]);
  const maxWaitMs = await deadEndWaitMs(input.repos);
  const read = input.readPackets ?? readGovernmentPackets;
  const packetNow = async (): Promise<HuntPacket | null> =>
    (await read([governmentId], input.now(), await readAskedGaps(input.repos, input.now()))).get(governmentId) ?? null;
  const opening = await packetNow();
  const owner = (await input.repos.obligations.read(huntPacketObligationId(governmentId)))?.value;
  const assignmentKeys = [...new Set((owner?.assignments ?? []).map(mark => mark.assignmentKey))];
  const due = opening === null ? null : packetDue({ packet: opening, last: lastJobOf(last), orderedAt: orderedAtOf(owner?.assignments), shutDoors: doors, now: input.now(), maxWaitMs });
  const role: HuntRole = due?.due ? due.role : last ? "DETECTIVE" : "HUNTER";
  let packet: HuntPacket | null = null;
  return hunterExecutor({
    role,
    playbookFor: hunterRole => readRolePlaybook(input.repos, hunterRole),
    transport: input.transport,
    ...(input.transportFor ? { transportFor: input.transportFor } : {}),
    ...(input.refusedBeforeSending ? { refusedBeforeSending: input.refusedBeforeSending } : {}),
    now: input.now,
    toolkitFor: ctx => buildScoutToolkit({ ...ctx, root: input.root, ...(input.environment ? { sourceApi: { env: input.environment } } : {}) }),
    contextFor: async (row, job) => {
      packet = await packetNow();
      if (packet === null || packet.blanks.length === 0) return null;
      const query=scoutFieldManualQuery({subjectId:governmentId,divisions:[governmentId],
        recordClasses:recordClassesOf(packet.blanks.map(blank=>blank.checklistId)),limit:NOTE_LIMIT});
      const notes=(await readFieldManual(input.repos,query)).projection.lines;
      const tried = role === "DETECTIVE" ? triedSteps({ steps: last?.rungs ?? [], unfilled: last?.unfilled ?? [], shutDoors: doors }) : [];
      const bound = durableResearchTools(input.tools, { project: item.project, attemptId: job.attemptId, workItemId: item.id, routeTaskId: task.id, subjectId: governmentId });
      const reportPacket = packet;
      return {
        brief: huntBrief(reportPacket, { role, tried, notes }),
        reason: `${role === "DETECTIVE" ? "Detective" : "Hunter"} for ${reportPacket.label}: ${reportPacket.blanks.length} open blank(s)${due && due.due ? `; ${due.why}` : ""}`,
        blanks: reportPacket.blanks.length,
        handed: { artifactIds: [] },
        tools: {
          vault: bound.vault, vaultBytes: bound.vaultBytes, spaceOut: bound.spaceOut,
          ...(bound.browse ? { browse: bound.browse } : {}), ...(bound.openBytes ? { openBytes: bound.openBytes } : {}),
          ...(input.readHeldArtifact ? { readHeldArtifact: input.readHeldArtifact } : {}),
          held: reportPacket.held,
          ...(input.search ? { search: input.search } : {}),
          chargeSearch: async charge => {
            await recordCost(input.repos, huntSearchCost({ charge, attemptId: job.attemptId, workItemId: item.id, routeTaskId: task.id,
              governmentId, assignmentKeys, recordedAt: input.now() }), input.now());
          },
          reportFinding: {
            subjects: reportableSubjects(reportPacket),
            write: async finding => ({ boxId: (await indexReportedFinding(input.repos.boxFindings, { workItemId: item.id, attemptId: job.attemptId,
              obligationId: huntPacketObligationId(governmentId), missionPart: null, finding }, input.now())).id }),
          },
        },
      };
    },
    onResult: async result => {
      const given = packet;
      const recorded: ScoutResult = given === null ? result : { ...result, obligationId: huntPacketObligationId(governmentId),
        blankFingerprint: blankFingerprint(given), blankDigests: given.blanks.map(blankDigest) };
      await input.repos.scoutResults.append(recorded.obligationId, recorded.attemptId, recorded, recorded.recordedAt);
      if (given !== null) await writeFieldManual(input.repos, huntLearnings(recorded, given), recorded.recordedAt).catch(() => undefined);
      return recorded;
    },
  });
}
