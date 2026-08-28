#!/usr/bin/env bash
# Create a workstream worktree off a baseline, with a node_modules junction.
# RULING 190: worktrees are one of the parallel mechanisms; the junction is what
# makes a fresh worktree able to run the gate set without a second install.
set -e
name="$1"; branch="$2"; base="${3:-main}"
root="C:/Users/seanj/dev/we-the-people"
git -C "$root" worktree add "C:/Users/seanj/dev/wtp-wt/$name" -b "$branch" "$base" 2>&1 | tail -1
cmd //c "mklink /J C:\Users\seanj\dev\wtp-wt\$name\node_modules C:\Users\seanj\dev\we-the-people\node_modules" >/dev/null
echo "ready: C:/Users/seanj/dev/wtp-wt/$name on $branch from $base"
