"use client";
import { useV6 } from './context.tsx';
import type { ScoreboardView } from './model.ts';
/** Now subscribes to the compact hourly reading through the screen's single live subscription. */
export function useKeeperScoreboard():ScoreboardView|null {
  return useV6().data.scoreboard.data;
}
