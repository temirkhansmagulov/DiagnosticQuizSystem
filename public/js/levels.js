// Mirrors the level thresholds in lib/mastery.js for values computed client-side (class averages).
const LEVELS = [
  { min: 0.8, status: 'mastered', label: 'Mastered' },
  { min: 0.6, status: 'proficient', label: 'Proficient' },
  { min: 0.4, status: 'developing', label: 'Developing' },
  { min: -1, status: 'needs-work', label: 'Needs work' },
];
export function levelOf(m) {
  if (m === null || m === undefined) return { status: 'not-assessed', label: 'Not assessed' };
  return LEVELS.find((l) => m >= l.min);
}
