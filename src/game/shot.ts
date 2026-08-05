import { GREEN_MAX, GREEN_MIN, OPTIMAL_RELEASE, TOLERANCE } from './config';
import type { BallType, ShotResult, ShotTiming } from '../types';

export type RandomSource = () => number;

export function timingForMeter(meter: number): ShotTiming {
  if (meter >= GREEN_MIN && meter <= GREEN_MAX) return 'green';
  return meter < OPTIMAL_RELEASE ? 'early' : 'late';
}

export function probabilityForMeter(meter: number): number {
  if (meter >= GREEN_MIN && meter <= GREEN_MAX) return 1;

  const edgeDistance = meter < GREEN_MIN ? GREEN_MIN - meter : meter - GREEN_MAX;
  if (edgeDistance > TOLERANCE) return 0;

  return 0.8 - (edgeDistance / TOLERANCE) * 0.7;
}

export function evaluateShot(
  rawMeter: number,
  ballType: BallType,
  random: RandomSource = Math.random,
): ShotResult {
  const meter = Math.min(Math.max(rawMeter, 0), 1.08);
  const timing = timingForMeter(meter);
  const green = timing === 'green';
  const probability = probabilityForMeter(meter);
  const made = green || random() < probability;

  return {
    timing,
    meter,
    error: Math.abs(meter - OPTIMAL_RELEASE),
    probability,
    made,
    green,
    points: made ? (ballType === 'money' ? 2 : 1) : 0,
  };
}
