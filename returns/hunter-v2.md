# Returned: hunter-v2

lane: hunter-v2
owner: hunter-v2
writer: the hunter-v2 lane
check: cleanliness
ready: no step ids 6d52165579c6abc7b0e19ab73bc73551e2519176
river: d9107da58a23f9d38b60d300552af7e9d2509561
at: 2026-10-15T04:44:12Z
state: returned
fix_subject: fix:72887165
fix: River · stream/hunter-v2 — cleanliness failed for hunter-v2: Cleanliness findings on H-01 (6d5216557, folded as 56ab8f78a). Fix in your next READY:

## Failure

```
Cleanliness findings on H-01 (6d5216557, folded as 56ab8f78a). Fix in your next READY:
Exports nothing outside their own file imports (unexport, or delete if unused in the file too):
   lib/control-plane/bulk-hunts/zip-state.ts:11 ZipShard tests=0
   lib/control-plane/expansion/dispatch-work.ts:358 packetRequirements tests=0
   lib/control-plane/scheduler/providers/hunt-packets.ts:7 HUNT_PACKETS_PROVIDER_ID tests=0
   lib/control-plane/scheduler/scout-executor.ts:260 HunterContext tests=0
   lib/control-plane/scheduler/scout-executor.ts:270 HunterExecutorDeps tests=0
   lib/control-plane/scheduler/scout-executor.ts:289 HUNTER_MAX_TURNS tests=0
   lib/control-plane/scheduler/scout-tools.ts:172 HUNTER_TOOL_SPECS tests=3
   lib/control-plane/scheduler/scout-tools.ts:383 focusedText tests=0
   lib/hunt/exa-agent.ts:16 EXA_AGENT_OUTPUT_SCHEMA tests=0
   lib/hunt/exa-agent.ts:38 ExaAgentFinding tests=0
   lib/hunt/exa-agent.ts:46 ExaAgentRun tests=0
   lib/hunt/exa-lane.ts:16 EXA_AGENT_MODEL tests=0
   lib/hunt/packet-read.ts:11 HeldReader tests=0
   lib/hunt/packet-read.ts:37 PacketPreview tests=0
   lib/hunt/packet.ts:52 huntableItem tests=1
   lib/hunt/packet.ts:161 PacketCostRates tests=0
   lib/hunt/place-words.ts:8 PlaceWords tests=0
   lib/hunt/place-words.ts:13 NamedPlace tests=1
   lib/hunt/place-words.ts:27 nameSlug tests=0
   lib/hunt/place-words.ts:30 readNamedPlaces tests=0
   lib/hunt/place-words.ts:58 PlaceWordsDeps tests=1
   lib/hunt/place-words.ts:65 defaultPlaceWordsDeps tests=0
   lib/hunt/runtime.ts:37 lastPacketJob tests=0
   lib/hunt/runtime.ts:41 lastJobOf tests=0
   lib/hunt/runtime.ts:45 orderedAtOf tests=0
Doc comments over two lines (cut to two lines max, why only):
-- commented-out code / history words / long doc comments
   5-line doc comment: lib/control-plane/scheduler/scout-tools.ts
   4-line doc comment: lib/hunt/brief.ts
   4-line doc comment: lib/hunt/exa-agent.ts
   4-line doc comment: lib/hunt/exa-lane.ts
   5-line doc comment: lib/hunt/packet-due.ts
   4-line doc comment: lib/hunt/packet-plan.ts
```

## Repair

Fix on stream/hunter-v2 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
