#!/usr/bin/env bash
###############################################################################
# Reader last-mile FULL REPROOF — the one-command orchestrator (was hand-run).
#
# WHY THIS EXISTS: a functional reader-path change (anything the reader closure
# receipt fingerprints — reader code, civic-data write-plane, identity joins,
# CSS) invalidates docs/evidence/reader-last-mile-final-closure-receipt.json, so
# `tests/reader-last-mile-census.test.ts` (a required gate) goes red. Only the
# VF-FULL reproof renews it. There was NO orchestrator; the last one
# (scripts/refresh-reader-renewal.mts) was deleted and only did the --renew-
# holdings delta. This is that missing script, assembled from a verified hand
# run on 2026-09-20. Runbook prose lives in the comments here on purpose.
#
# WHAT IT TOUCHES: it READS production (read-only) throughout. The PRODUCTION
# execution authority pins DATABASE_URL to the read-only production Neon handle
# (endpoint/database/schema/role identity must match the authority artifact),
# so census/prepare/finalize and ~15 executors all read prod via the `readonly`
# role. There is no offline/REHEARSAL path post-cutover. The model key MUST be
# absent or the Ask proofs (which assert answer===null) fail.
#
# PREREQUISITES (do these first; this script does NOT do them):
#   1. Commit your change. The tree must be at the exact head you want proven.
#   2. Mint a fresh PRODUCTION execution authority bound to THIS head:
#        node --experimental-strip-types scripts/reader-execution-authority-evidence.mts \
#          --phase=PRODUCTION \
#          --provider-metadata=docs/evidence/reader-last-mile-production-provider-metadata.json \
#          --import-receipt=docs/evidence/reader-last-mile-production-import-receipt.json
#      run in a CLEAN env with ONLY WTP_READER_EXECUTION_AUTHORITY_DATABASE_URL_READONLY
#      set (it refuses if any other var holds a postgres URL, or NODE_OPTIONS/
#      NODE_PATH/NEON_API_* are set), a CLEAN git tree, and a FRESH provider-
#      metadata (observedAt within 6h; regenerate it from a live Neon branch
#      readback — schemaVersion 1, source NEON_API_BRANCH_READBACK). The
#      generator won't overwrite an existing authority/provider-metadata with
#      different bytes, so `git rm` the stale ones first and commit.
#   3. `pnpm install` (worktrees have no node_modules).
#
# AFTER a green receipt: commit the evidence, then
#   `pnpm regen --run-pure && pnpm status:ledger && pnpm regen --write`, then
#   `pnpm gates`. Post-merge, `pnpm reader:production-closure` re-establishes the
#   PRODUCTION phase against the live deploy.
#
# GOTCHAS baked in below:
#   - bodies.mts renders components IN-PROCESS and imports a .module.css, which
#     bare `node --import tsx` cannot load — it uses the test loader, which stubs
#     .css/.tsx/.json and the @/ alias. Every browser executor renders via the
#     server instead, so they keep tsx.
#   - production drift is expected: the standing runner promotes new meetings
#     past the frozen import. `requireReaderProofMeetingsProjection` accepts
#     GAINS (NOT_RECORDED -> PROMOTED) and forbids LOSSES (RULING 290 history
#     note); it logs every accepted partition. A store read can blip under
#     pooler pressure, so each executor retries once.
###############################################################################
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ENV_FILE="${WTP_ENV_FILE:-/c/Users/seanj/dev/we-the-people/.env.local}"
export READER_EXECUTION_AUTHORITY_EVIDENCE="docs/evidence/reader-last-mile-production-authority.json"
export DATABASE_URL="$(grep -m1 '^WTP_PRODUCTION_DATABASE_URL_READONLY=' "$ENV_FILE" | sed -E 's/^[^=]+=//; s/^["'\'']//; s/["'\'']$//')"
export READER_FINAL_PREPARED_CENSUS="../reader-last-mile-final-prepared-census.json"
export READER_PROOF_SOURCES="../reader-last-mile-final-proof-sources.json"
export SHOOT_BASE_URL="http://localhost:3210"
export COMMIT_REF="$(git rev-parse HEAD)"
unset ANTHROPIC_API_KEY
# Node 24's Happy-Eyeballs gives each address 250 ms; where IPv6 to Neon is
# unreachable and IPv4 connects run near that (seen 2026-09-22: p50 159-256 ms,
# max 457), all-slow attempts fail as AggregateError ETIMEDOUT. Widen the per-
# address attempt; appended so any existing NODE_OPTIONS survives. Environment
# only: no fingerprinted file, no evidence, no assertion changes.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--network-family-autoselection-attempt-timeout=2500"
[ -n "$DATABASE_URL" ] || { echo "no WTP_PRODUCTION_DATABASE_URL_READONLY in $ENV_FILE"; exit 1; }
LOG=".scratch/reproof-step.log"; mkdir -p .scratch
mask() { sed -E 's#postgres(ql)?://[^ "]*#postgres://<redacted>#g'; }

# run LABEL -- CMD... ; retries only a classified store outage. When the log shows this host
# could not reach the store, that is transient infrastructure, not a proof result:
# wait and re-ask, up to STORE_RETRY_MAX attempts STORE_RETRY_WAIT_MS apart. An
# immediate retry lands in the same outage window (seen 2026-09-22: intermittent
# host-to-Neon "fetch failed" on both databases for minutes at a time). The
# executor re-runs whole, so every assertion must still hold; only timing changes.
STORE_RETRY_MAX="${STORE_RETRY_MAX:-6}"; STORE_RETRY_WAIT_MS="${STORE_RETRY_WAIT_MS:-90000}"
STORE_UNREACHABLE='We could not ask the store|STORE_READ_FAILED|Error connecting to database'
run() { local label="$1"; shift; local e attempt=0
  while :; do attempt=$((attempt + 1)); echo "=== $label (attempt $attempt) ==="; "$@" >"$LOG" 2>&1; e=$?
    tail -3 "$LOG" | mask; [ "$e" -eq 0 ] && { echo ok; return 0; }; echo "attempt $attempt exit $e"
    # Keep every failed attempt whole: the next attempt overwrites $LOG, and a
    # retry that passes must not erase why the first one failed.
    local kept="${LOG%.log}.$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '_').attempt$attempt.log"
    cp "$LOG" "$kept" 2>/dev/null && echo "failed attempt log kept: $kept"
    if grep -qE "$STORE_UNREACHABLE" "$LOG" && [ "$attempt" -lt "$STORE_RETRY_MAX" ]; then
      echo "store unreachable from this host — re-asking in $((STORE_RETRY_WAIT_MS / 1000))s"
      node -e "setTimeout(() => {}, $STORE_RETRY_WAIT_MS)"; continue
    fi
    break
  done
  echo "!!! FAILED $label — tail:"; tail -25 "$LOG" | mask; exit "$e"; }
# proof OUTPUT_OR_EMPTY SCRIPT [LOADER]  (LOADER defaults to tsx; use "test" for in-process CSS renders)
tsx="node --import tsx"; testldr="node --experimental-strip-types --import ./scripts/register-test-loader.mjs"
proof() { local out="$1" script="$2" ldr="${3:-tsx}"; local cmd; [ "$ldr" = test ] && cmd="$testldr" || cmd="$tsx"
  if [ -n "$out" ]; then READER_PROOF_OUTPUT="$out" run "$(basename "$script") -> $(basename "$out")" $cmd "$script"
  else run "$(basename "$script")" $cmd "$script"; fi; }

echo "### 1. BUILD (COMMIT_REF=$COMMIT_REF)"
# The build receipt (stage 5) hashes THIS build's log. Nothing else wrote it,
# so every run until 2026-09-24 hashed whatever stale file sat at that path
# (a 2026-09-19 log in one checkout). Remove it first: a missing log is a
# refusal, never an old one.
export READER_BUILD_LOG="../reader-final-build.log"; rm -f "$READER_BUILD_LOG"
run "pnpm build" bash -c 'pnpm build 2>&1 | tee "$0"; exit "${PIPESTATUS[0]}"' "$READER_BUILD_LOG"   # postbuild's reader-trace-check ignores the receipt, so a stale closure does not block the build

echo "### 2. PIN the run's meeting versions, then PREPARE + census projection"
# ONE version per meeting partition for the whole run (lib/meetings/proof-pin.ts).
# The standing runner promotes routine meeting versions for as long as the run
# lasts (Newbury NH arrives in bursts every 1.5-2 h). When the render read one
# version at its start and /api/agenda served the next, every 03255 case failed
# on the listing group's `collectedAt`. The pin is captured once, from the strict
# proven read, BEFORE prepare. Every later process then reads that version of
# each partition, and so does the proof server started below, which inherits this
# environment. Each pinned read is still proven: the pin chooses the version and
# the proof still has to pass. A deployed build never admits the pin.
# A RESUMED run must re-export the SAME pin file and must not recapture: it
# keeps the versions its reused evidence was proven on.
READER_PROOF_MEETING_PIN_FILE="../reader-last-mile-meeting-pin.json"
rm -f "$READER_PROOF_MEETING_PIN_FILE"
run "meeting pin" env -u READER_PROOF_MEETING_PIN $tsx scripts/reader-proof-meeting-pin.mts "$READER_PROOF_MEETING_PIN_FILE"
export READER_PROOF_MEETING_PIN="$READER_PROOF_MEETING_PIN_FILE"
run "finalize --prepare" $tsx scripts/reader-last-mile-finalize.mts --prepare
run "census --project"   $tsx scripts/reader-last-mile-census.mts --project --render-components

echo "### 3. non-browser producers (prod DB, no server)"
proof docs/evidence/reader-last-mile-final-ask-exhaustive.json         docs/evidence/reader-last-mile-ask-exhaustive.mts
proof docs/evidence/reader-last-mile-final-ballot-ask.json             docs/evidence/reader-last-mile-ballot-ask.mts
proof docs/evidence/reader-last-mile-final-federal-money-ask.json      docs/evidence/reader-last-mile-federal-money-ask.mts
proof docs/evidence/reader-last-mile-final-key-votes-ask.json          docs/evidence/reader-last-mile-key-votes-ask.mts
proof docs/evidence/reader-last-mile-final-meetings-ask.json           docs/evidence/reader-last-mile-meetings-ask.mts
proof docs/evidence/reader-last-mile-final-meeting-knowledge-ask.json  docs/evidence/reader-last-mile-meeting-knowledge-ask.mts
proof docs/evidence/reader-last-mile-final-money-ask.json              docs/evidence/reader-last-mile-money-ask.mts
proof docs/evidence/reader-last-mile-final-candidate-profiles-ask.json scripts/reader-last-mile-candidate-profiles-ask.mts
proof "" docs/evidence/reader-last-mile-officials-ask.mts
proof "" docs/evidence/reader-last-mile-ask-route-proof.mts
proof "" scripts/reader-last-mile-voting-sites.mts
proof "" docs/evidence/reader-last-mile-candidate-corpus-map.mts
proof "" docs/evidence/reader-last-mile-bodies.mts test   # in-process component render -> needs the CSS-stubbing loader
proof "" docs/evidence/reader-last-mile-witness-requirements.mts

echo "### 4. server on :3210"
$tsx --version >/dev/null 2>&1 || true
pnpm exec next start -p 3210 >../reader-next-start.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
# Poll /api/build until it serves this exact head (node timers, never shell sleep).
node -e 'const H=process.argv[1],d=Date.now()+120000;(async()=>{while(Date.now()<d){try{const r=await fetch("http://localhost:3210/api/build");if(r.ok&&(await r.json()).commit===H){console.log("server ready commit="+H);process.exit(0)}}catch{}await new Promise(r=>setTimeout(r,3000))}console.error("server /api/build poll timed out");process.exit(1)})()' "$COMMIT_REF" || { echo "server did not come up at head $COMMIT_REF"; exit 1; }

echo "### 5. browser/HTTP executors (need the server)"
proof docs/evidence/reader-last-mile-final-routes.json         scripts/reader-last-mile-routes.mts
proof docs/evidence/reader-last-mile-final-meeting-routes.json docs/evidence/reader-last-mile-meeting-routes.mts
proof docs/evidence/reader-last-mile-final-agenda.json         scripts/reader-last-mile-agenda.mts
proof docs/evidence/reader-last-mile-final-ballot.json         scripts/reader-last-mile-ballot.mts   # before positions & final-render
proof docs/evidence/reader-last-mile-final-portraits.json      scripts/reader-last-mile-portraits.mts
proof docs/evidence/reader-last-mile-final-build-receipt.json  scripts/reader-last-mile-build-receipt.mts
proof "" scripts/reader-last-mile-final-delta-routes.mts
proof "" scripts/reader-last-mile-positions.mts
proof "" scripts/reader-last-mile-civic.mts
proof "" scripts/reader-last-mile-render.mts
READER_RENDER_FOCUS=federal-money run "render.mts (federal-money)" $tsx scripts/reader-last-mile-render.mts
proof "" scripts/reader-last-mile-final-render.mts

echo "### 6. witness chain"
run "witnesses.mts" $tsx scripts/reader-last-mile-witnesses.mts
READER_BALLOT_EVIDENCE=docs/evidence/reader-last-mile-final-ballot.json run "root-witnesses.mts (surface-witnesses)" $tsx docs/evidence/reader-last-mile-root-witnesses.mts

echo "### 7. finalize --full-reproof (writes the closure receipt)"
run "finalize --full-reproof" $tsx scripts/reader-last-mile-finalize.mts --full-reproof

# NOTE ON PACKAGING — finalize (stage 7) is the terminal packing step.
# `finalize --full-reproof` writes the closure receipt AND losslessly packs the
# two large artifacts (reader-last-mile-final-closure.json and
# -final-delta-components.json) to .json.gz + .json.pack.json, deleting their
# plain JSON. Every other frozen target stays committed as plain .json, and
# readReaderEvidence prefers the plain, so their .json.gz are vestigial (already
# drifted on main; never read). Do NOT run reader-last-mile-package-final.mts on
# the real tree: packReaderEvidence gzips-and-unlinkSyncs each target, which would
# DELETE the ~19 committed plain targets. That generator is exercised only by
# tests/reader-last-mile-generator-paths.test.ts in a throwaway temp dir, and the
# frozen-21 manifest reader-last-mile-final-pack.json is a legacy artifact nothing
# consumes. The proof of a renewed closure is the census gate, below.

echo "### 8. VERIFY the required reader gate (the actual proof of a renewed closure)"
# CLEAN ENV IS MANDATORY: the census gate seeds the registry from BOOTSTRAP with
# an in-memory store; a live DATABASE_URL (exported above for the executors)
# pollutes that path and fails with STORE_UNREACHABLE. Unset the prod handles.
env -u DATABASE_URL -u READER_EXECUTION_AUTHORITY_EVIDENCE -u READER_FINAL_PREPARED_CENSUS -u READER_PROOF_SOURCES -u READER_PROOF_MEETING_PIN \
  node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  tests/reader-last-mile-census.test.ts >"$LOG" 2>&1
e=$?; tail -12 "$LOG" | mask
[ "$e" -eq 0 ] && echo "### DONE — reader closure renewed; tests/reader-last-mile-census.test.ts is GREEN." \
  || { echo "!!! census gate RED (exit $e)"; exit "$e"; }
