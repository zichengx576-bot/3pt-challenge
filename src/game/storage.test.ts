import { describe, expect, it } from 'vitest';
import { createRoundStats } from './scoring';
import { emptyRecords, loadRecords, STORAGE_KEY, updateRecord } from './storage';

describe('record persistence', () => {
  it('falls back to empty records for corrupted JSON', () => {
    const storage = { getItem: () => '{broken' };
    expect(loadRecords(storage)).toEqual(emptyRecords());
  });

  it('falls back to empty records for a different schema version', () => {
    const storage = { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify({ version: 2, spots: {} }) : null };
    expect(loadRecords(storage)).toEqual(emptyRecords());
  });

  it('keeps the best value for each metric and each spot', () => {
    const records = emptyRecords();
    const stats = {
      ...createRoundStats('left-corner'),
      shots: 25,
      makes: 18,
      score: 22,
      greens: 7,
      bestStreak: 5,
    };
    const updated = updateRecord(records, stats);
    expect(updated.spots['left-corner']).toEqual({ score: 22, accuracy: 0.72, greens: 7, streak: 5 });
    expect(updated.spots.top.score).toBe(0);
  });
});
