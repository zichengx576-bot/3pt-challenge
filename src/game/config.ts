import type { SpotDefinition, SpotId } from '../types';

export const TOTAL_SHOTS = 25;
export const METER_DURATION_MS = 900;
export const OPTIMAL_RELEASE = 0.78;
export const GREEN_MIN = 0.75;
export const GREEN_MAX = 0.81;
export const TOLERANCE = 0.18;

export const SPOTS: SpotDefinition[] = [
  { id: 'left-corner', label: '左底角', shortLabel: '左底角', x: -6.7, z: 0.7 },
  { id: 'left-wing', label: '左侧 45°', shortLabel: '左 45°', x: -5.15, z: 3.65 },
  { id: 'top', label: '弧顶', shortLabel: '弧顶', x: 0, z: 6.25 },
  { id: 'right-wing', label: '右侧 45°', shortLabel: '右 45°', x: 5.15, z: 3.65 },
  { id: 'right-corner', label: '右底角', shortLabel: '右底角', x: 6.7, z: 0.7 },
];

export const SPOT_MAP = Object.fromEntries(SPOTS.map((spot) => [spot.id, spot])) as Record<SpotId, SpotDefinition>;
