import type { ScanSourceStatus, ScanStatus } from '@warden/shared';

// Etiquetas compartidas por el dashboard y la página de escaneos (server y client).

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  completed: 'Completado',
  failed: 'Falló',
  cancelled: 'Cancelado',
};

export const SCAN_STATUS_COLORS: Record<ScanStatus, string> = {
  queued: 'var(--muted)',
  running: 'var(--accent)',
  completed: 'var(--grade-a)',
  failed: 'var(--grade-f)',
  cancelled: 'var(--muted)',
};

export const SOURCE_RUN_LABELS: Record<ScanSourceStatus, string> = {
  ok: 'Correcta',
  failed: 'Falló',
  skipped: 'Omitida',
  blocked: 'Bloqueada',
};

export const SOURCE_RUN_COLORS: Record<ScanSourceStatus, string> = {
  ok: 'var(--grade-a)',
  failed: 'var(--grade-f)',
  skipped: 'var(--muted)',
  blocked: 'var(--grade-f)',
};

/**
 * Estado a mostrar: un escaneo "completado" con fuentes fallidas se marca "Con fallos";
 * en verde ocultaría que no hubo datos.
 */
export function scanDisplayStatus(status: ScanStatus, sourceFailures: boolean): { label: string; color: string } {
  if (status === 'completed' && sourceFailures) return { label: 'Con fallos', color: 'var(--grade-c)' };
  return { label: SCAN_STATUS_LABELS[status], color: SCAN_STATUS_COLORS[status] };
}
