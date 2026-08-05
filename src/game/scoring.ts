import { TOTAL_SHOTS } from './config';
import type { BallType, RoundStats, ShotResult, SpotId } from '../types';

export function ballTypeForShot(shotsTaken: number): BallType {
  return (shotsTaken + 1) % 5 === 0 ? 'money' : 'normal';
}

export function createRoundStats(spot: SpotId): RoundStats {
  return {
    spot,
    shots: 0,
    makes: 0,
    moneyMakes: 0,
    score: 0,
    greens: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function applyShot(stats: RoundStats, result: ShotResult, ballType: BallType): RoundStats {
  const streak = result.made ? stats.streak + 1 : 0;
  return {
    ...stats,
    shots: Math.min(stats.shots + 1, TOTAL_SHOTS),
    makes: stats.makes + Number(result.made),
    moneyMakes: stats.moneyMakes + Number(result.made && ballType === 'money'),
    score: stats.score + result.points,
    greens: stats.greens + Number(result.green),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
  };
}

export function accuracy(stats: RoundStats): number {
  return stats.shots === 0 ? 0 : stats.makes / stats.shots;
}
