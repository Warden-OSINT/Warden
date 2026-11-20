'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { cancelScan, requestScan } from '@/app/(dashboard)/actions';
import type { ScanSummary } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { formatDateTime } from './format';
import { scanDisplayStatus } from './scan-status';

// El worker procesa el escaneo fuera de la web: mientras siga activo se refresca la página.
const POLL_MS = 4000;

export function ScanControls({
  companyId,
  lastScan,
  disabled,
}: {
  companyId: string;
  lastScan: ScanSummary | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, startCancel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = lastScan?.status === 'queued' || lastScan?.status === 'running';
  const shown = lastScan && scanDisplayStatus(lastScan.status, lastScan.sourceFailures);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [active, router]);

  function onScan() {
    setError(null);
    startTransition(async () => {
      const result = await requestScan(companyId);
      if (result.error) setError(result.error);
    });
  }

  function onCancel() {
    if (!lastScan || !window.confirm('¿Detener el escaneo? Sus resultados parciales no se guardan.')) return;
    setError(null);
    startCancel(async () => {
      const result = await cancelScan(lastScan.id);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className={styles.scanControls}>
      {lastScan && shown && !active && (
        <span className={styles.muted} title={lastScan.errorMessage ?? undefined}>
          Último escaneo{' '}
          <span className={styles.pill} style={{ color: shown.color }}>
            {shown.label}
          </span>{' '}
          {formatDateTime(lastScan.finishedAt ?? lastScan.createdAt)}
        </span>
      )}
      {lastScan && active && <ScanProgress scan={lastScan} />}
      {active ? (
        <button type="button" className={styles.buttonGhost} onClick={onCancel} disabled={cancelling}>
          {cancelling ? 'Cancelando…' : 'Cancelar escaneo'}
        </button>
      ) : (
        <button type="button" className={styles.button} onClick={onScan} disabled={disabled || pending}>
          {pending ? 'Solicitando…' : 'Escanear ahora'}
        </button>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

/** "Consultando crt.sh · 3 de 6 fuentes · 1 min 20 s", con el tiempo actualizado cada segundo. */
function ScanProgress({ scan }: { scan: ScanSummary }) {
  const elapsed = useElapsed(scan.startedAt ?? scan.createdAt);
  const { currentSource, done, total } = scan.progress;
  const parts =
    scan.status === 'queued'
      ? ['En cola: esperando al worker']
      : [
          currentSource ? `Consultando ${currentSource}` : 'Preparando',
          total ? `${Math.min(done, total)} de ${total} fuentes` : null,
        ];
  return (
    <span className={styles.muted} role="status" aria-live="polite">
      <span className={styles.pill} style={{ color: 'var(--accent)' }}>
        <span className={styles.spinner} aria-hidden /> {scan.status === 'queued' ? 'En cola' : 'En curso'}
      </span>{' '}
      {[...parts.filter(Boolean), elapsed].join(' · ')}
    </span>
  );
}

function useElapsed(since: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
