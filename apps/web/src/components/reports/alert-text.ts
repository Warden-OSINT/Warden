import type { ReportAlert } from '@/lib/reports';

export function alertText(a: ReportAlert): string {
  return a.type === 'threshold_crossed'
    ? `Nota ${a.newGrade} por debajo del umbral${a.previousGrade ? ` (antes ${a.previousGrade})` : ''}`
    : `La nota bajó de ${a.previousGrade ?? '—'} a ${a.newGrade}`;
}
