import { describe, expect, it } from 'vitest';
import { GREEN_MAX, GREEN_MIN, TOLERANCE } from './config';
import { evaluateShot, probabilityForMeter, timingForMeter } from './shot';

describe('shot timing', () => {
  it('treats both green-zone boundaries as perfect releases', () => {
    expect(timingForMeter(GREEN_MIN)).toBe('green');
    expect(timingForMeter(GREEN_MAX)).toBe('green');
  });

  it('guarantees green releases regardless of random input', () => {
    expect(evaluateShot(0.78, 'normal', () => 0.999).made).toBe(true);
    expect(evaluateShot(0.78, 'money', () => 0.999)).toMatchObject({ made: true, points: 2 });
  });

  it('labels releases on either side of the window', () => {
    expect(timingForMeter(0.4)).toBe('early');
    expect(timingForMeter(0.95)).toBe('late');
  });

  it('decays from 80% at the edge to 10% at the tolerance boundary', () => {
    expect(probabilityForMeter(GREEN_MIN - 0.00001)).toBeCloseTo(0.8, 3);
    expect(probabilityForMeter(GREEN_MAX + TOLERANCE)).toBeCloseTo(0.1, 5);
    expect(probabilityForMeter(GREEN_MAX + TOLERANCE + 0.001)).toBe(0);
  });

  it('uses an injected random source for non-green results', () => {
    const probability = probabilityForMeter(0.7);
    expect(evaluateShot(0.7, 'normal', () => probability - 0.01).made).toBe(true);
    expect(evaluateShot(0.7, 'normal', () => probability + 0.01).made).toBe(false);
  });
});
