import styles from '@/components/dashboard/dashboard.module.css';
import { FindingsTable } from '@/components/findings/findings-table';
import { loadFindings } from '@/lib/findings';

// Lee Supabase en cada request: el worker y el triage cambian los hallazgos.
export const dynamic = 'force-dynamic';

export default async function FindingsPage() {
  const state = await loadFindings();

  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Hallazgos</h1>
        <p className={styles.notice}>
          {state.kind === 'no-company'
            ? 'Registra primero la empresa a evaluar desde el Dashboard.'
            : 'Inicia sesión para ver los hallazgos: sin sesión no hay datos que consultar.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.pageTitle}>Hallazgos</h1>
        <p className={styles.subtitle}>
          {state.company.name} · {state.company.primaryDomain} · haz clic en un hallazgo para ver su evidencia y
          clasificarlo
        </p>
      </div>
      <FindingsTable findings={state.findings} />
    </div>
  );
}
