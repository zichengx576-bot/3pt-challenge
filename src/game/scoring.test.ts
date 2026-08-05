import { describe, expect, it } from 'vitest';
import { applyShot, ballTypeForShot, createRoundStats } from './scoring';
import { evaluateShot } from './shot';

describe('round scoring', () => {
  it('marks every fifth shot as a money ball', () => {
    expect(Array.from({ length: 10 }, (_, index) => ballTypeForShot(index))).toEqual([
      'normal', 'normal', 'normal', 'normal', 'money',
      'normal', 'normal', 'normal', 'normal', 'money',
    ]);
  });

  it('awards one point for normal makes and two for money-ball makes', () => {
    let stats = createRoundStats('top');
    stats = applyShot(stats, evaluateShot(0.78, 'normal'), 'normal');
    stats = applyShot(stats, evaluateShot(0.78, 'money'), 'money');
    expect(stats).toMatchObject({ shots: 2, makes: 2, moneyMakes: 1, score: 3, streak: 2, bestStreak: 2 });
  });

  it('resets current streak on a miss while retaining the best streak', () => {
    let stats = createRoundStats('right-wing');
    stats = applyShot(stats, evaluateShot(0.78, 'normal'), 'normal');
    stats = applyShot(stats, evaluateShot(0.2, 'normal', () => 1), 'normal');
    expect(stats.streak).toBe(0);
    expect(stats.bestStreak).toBe(1);
  });

  it('never advances the shot count past 25', () => {
    let stats = createRoundStats('top');
    for (let index = 0; index < 27; index += 1) {
      stats = applyShot(stats, evaluateShot(0.78, 'normal'), 'normal');
    }
    expect(stats.shots).toBe(25);
  });
});
