export type SpotId = 'left-corner' | 'left-wing' | 'top' | 'right-wing' | 'right-corner';

export type BallType = 'normal' | 'money';
export type ShotTiming = 'green' | 'early' | 'late';
export type GameState =
  | 'selecting'
  | 'countdown'
  | 'ready'
  | 'charging'
  | 'flight'
  | 'feedback'
  | 'complete';

export interface ShotResult {
  timing: ShotTiming;
  meter: number;
  error: number;
  probability: number;
  made: boolean;
  green: boolean;
  points: number;
}

export interface RoundStats {
  spot: SpotId;
  shots: number;
  makes: number;
  moneyMakes: number;
  score: number;
  greens: number;
  streak: number;
  bestStreak: number;
}

export interface BestRecord {
  score: number;
  accuracy: number;
  greens: number;
  streak: number;
}

export interface PersistedRecords {
  version: 1;
  spots: Record<SpotId, BestRecord>;
}

export interface SpotDefinition {
  id: SpotId;
  label: string;
  shortLabel: string;
  x: number;
  z: number;
}
