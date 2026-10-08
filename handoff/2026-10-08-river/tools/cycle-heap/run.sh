#!/bin/bash
# Usage: run.sh <worktree> <label> <heapMB> [cycles] [port]
# Fresh private databases, the model-lane stub, and staged runner cycles with the model lane ON (stub key, never a real model).
set -u
S=${SCRATCH:?set SCRATCH to your scratch directory}
CH=$S/ch; W=$1; L=$2; HEAP=$3; CYC=${4:-1}; PORT=${5:-54341}
OUT=$CH/run-$L; rm -rf "$OUT"; mkdir -p "$OUT"
"$S/localprod/rundb.sh" "$L" > "$OUT/rundb.log" 2>&1
node "$CH/stub.mjs" "$PORT" "$CH/plans.json" "$OUT/stub.ndjson" > "$OUT/stub.out" 2>&1 & STUB=$!
cd "$W" || exit 2
rm -rf .runtime .mirror data/control-plane/vault data/control-plane/shadow-runs
"$S/rss-sampler.sh" "$W" "$OUT/rss.log" & SP=$!
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/started"
(
  source "$S/localprod/env-run.sh" "$L"
  unset WTP_ASSET_STORE ANTHROPIC_API_KEY ANTHROPIC_BASE_URL WTP_RUNTIME_MODE
  export WTP_WORKERS_ANTHROPIC_API_KEY=sk-ant-local-stub-not-a-key BRAVE_SEARCH_API_KEY=local-stub EXA_API_KEY=local-stub
  export CH_STUB_URL="http://127.0.0.1:$PORT" CH_HTTP_CACHE="$CH/httpcache" CH_OUT="$OUT" CH_PROFILE="${CH_PROFILE:-1}" CH_SNAPSHOT="${CH_SNAPSHOT:-0}"
  export NODE_OPTIONS="$NODE_OPTIONS --import=$CH/harness.mjs --max-old-space-size=$HEAP --diagnostic-dir=$OUT"
  export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
  case "$WTP_CONTROL_PLANE_DATABASE_URL" in *localprod.test/cp_$L*) ;; *) echo "refusing: not a private copy"; exit 2;; esac
  timeout 7200 node scripts/pilot-runtime-launch.mjs --cycles="$CYC" --interval=1 > "$OUT/runner.log" 2>&1
  echo "RUNNER exit $?" >> "$OUT/runner.log"
)
kill $SP $STUB 2>/dev/null
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/finished"
echo "RUN $L done"
