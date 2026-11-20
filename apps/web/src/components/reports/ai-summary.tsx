'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { requestReport } from '@/app/(dashboard)/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { InfoTip } from '@/components/info-tip';
import type { ReportAi } from '@/lib/reports';
import own from './reports.module.css';

// El worker genera el resumen fuera de la web: mientras esté pendiente se refresca la página.
const POLL_MS = 4000;

export function AiSummary({ scoreId, ai }: { scoreId: string; ai: ReportAi | null }) {
  const router = useRouter();
  const [requesting, startRequest] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pending = ai?.status === 'pending';

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [pending, router]);

  function request() {
    setError(null);
    startRequest(async () => {
      const result = await requestReport(scoreId);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  const hasSummary = Boolean(ai?.summary) && ai?.status !== 'pending';

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>
            <InfoTip tip="Resumen redactado por un modelo de IA a partir de la nota y los hallazgos. Nunca se envían secretos, correos ni evidencia cruda. Revísalo antes de compartirlo: la IA puede equivocarse.">
              Resumen ejecutivo
            </InfoTip>
          </h2>
          <p className={styles.cardHint}>
            {hasSummary && ai?.generatedAt
              ? `Generado con IA (${ai.model ?? 'modelo desconocido'}) · ${formatDateTime(ai.generatedAt)} · borrador sin revisión humana`
              : 'Generado con IA a partir de datos redactados'}
          </p>
        </div>
        {!pending && (
          <button type="button" className={`${styles.buttonGhost} ${own.noPrint}`} onClick={request} disabled={requesting}>
            {requesting ? 'Solicitando…' : hasSummary || ai?.status === 'failed' ? 'Regenerar' : 'Generar resumen'}
          </button>
        )}
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {pending ? (
        <p className={own.aiPlaceholder} role="status">
          <span className={styles.spinner} aria-hidden /> Generando el resumen… suele tardar menos de un minuto.
        </p>
      ) : ai?.status === 'failed' ? (
        <p className={own.aiPlaceholder} style={{ color: 'var(--grade-f)' }}>
          No se pudo generar el resumen: {ai.error ?? 'error desconocido'}
        </p>
      ) : hasSummary && ai ? (
        <div className={own.aiBody}>
          <p className={own.aiText}>{ai.summary}</p>
          {ai.keyRisks.length > 0 && (
            <div>
              <h3 className={own.aiHeading}>Riesgos principales</h3>
              <ul className={own.aiList}>
                {ai.keyRisks.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          )}
          {ai.recommendations.length > 0 && (
            <div>
              <h3 className={own.aiHeading}>Recomendaciones</h3>
              <ol className={own.aiList}>
                {ai.recommendations.map((r) => <li key={r}>{r}</li>)}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className={own.aiPlaceholder}>Este reporte aún no tiene resumen. Pulsa “Generar resumen” para crearlo.</p>
      )}
    </section>
  );
}
