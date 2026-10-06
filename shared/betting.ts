import type { ClassId } from './types';

export interface ArenaContender { id: string; name: string; classId: ClassId; level: number; kills: number; deaths: number; odds: number; }
export interface ArenaMarket { id: string; startsAt: number; phase: 'open' | 'live'; contenders: ArenaContender[]; }
export interface ArenaBet { id: string; matchId: string; playerId: string; playerName: string; stake: number; odds: number; payout: number; status: 'active' | 'won' | 'lost' | 'refunded'; placedAt: number; }
export interface BettingView { markets: ArenaMarket[]; bets: ArenaBet[]; bookmakerNearby: boolean; inCombat?: boolean; spectating?: string; startsAt?: number; }
export interface BetWin { id: string; amount: number; celebrate: boolean; }
export type BettingAction = { kind: 'bet'; matchId: string; playerId: string; stake: number } | { kind: 'watch'; matchId: string } | { kind: 'exit' };

/** Bayesian smoothing keeps new characters from dominating the market with a single kill. */
export function arenaOdds(players: Pick<ArenaContender, 'level' | 'kills' | 'deaths'>[]): number[] {
  const strengths = players.map(p => (1 + Math.log1p(p.level) * .7) * Math.pow((p.kills + 5) / (p.deaths + 5), .35));
  const total = strengths.reduce((a, b) => a + b, 0);
  return strengths.map(s => Math.round(100 / (Math.max(.12, Math.min(.88, s / total)) * 1.06)) / 100);
}
