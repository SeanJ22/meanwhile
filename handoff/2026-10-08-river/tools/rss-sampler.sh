#!/bin/bash
# Usage: rss-sampler.sh <worktree> <out>: every 2 s, the RSS of each node process whose working directory is the worktree.
W=$1; OUT=$2; : > $OUT
while true; do
  for p in $(pgrep -x node); do
    cwd=$(readlink /proc/$p/cwd 2>/dev/null) || continue
    [[ "$cwd" == "$W"* ]] || continue
    rss=$(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null) || continue
    args=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-160)
    echo "$(date +%s) $p $rss $args" >> $OUT
  done
  sleep 2
done
