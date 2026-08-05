import { SPOTS } from './config';
import { accuracy } from './scoring';
import type { BestRecord, PersistedRecords, RoundStats, SpotId } from '../types';

export const STORAGE_KEY = 'three-point-challenge:records';

const EMPTY_RECORD: BestRecord = { score: 0, accuracy: 0, greens: 0, streak: 0 };

export function emptyRecords(): PersistedRecords {
  return {
    version: 1,
    spots: Object.fromEntries(SPOTS.map(({ id }) => [id, { ...EMPTY_RECORD }])) as Record<SpotId, BestRecord>,
  };
}

function isRecord(value: unknown): value is PersistedRecords {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedRecords>;
  return candidate.version === 1 && Boolean(candidate.spots);
}

export function loadRecords(storage: Pick<Storage, 'getItem'> = localStorage): PersistedRecords {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyRecords();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyRecords();

    const fallback = emptyRecords();
    for (const { id } of SPOTS) {
      const source = parsed.spots[id];
      if (!source) continue;
      fallback.spots[id] = {
        score: Number.isFinite(source.score) ? source.score : 0,
        accuracy: Number.isFinite(source.accuracy) ? source.accuracy : 0,
        greens: Number.isFinite(source.greens) ? source.greens : 0,
        streak: Number.isFinite(source.streak) ? source.streak : 0,
      };
    }
    return fallback;
  } catch {
    return emptyRecords();
  }
}

export function updateRecord(records: PersistedRecords, stats: RoundStats): PersistedRecords {
  const current = records.spots[stats.spot];
  const next: BestRecord = {
    score: Math.max(current.score, stats.score),
    accuracy: Math.max(current.accuracy, accuracy(stats)),
    greens: Math.max(current.greens, stats.greens),
    streak: Math.max(current.streak, stats.bestStreak),
  };

  return { ...records, spots: { ...records.spots, [stats.spot]: next } };
}

export function saveRecords(records: PersistedRecords, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Private mode and storage quotas should not block the game loop.
  }
}
