import styles from '@/components/dashboard/dashboard.module.css';
import { ReportList } from '@/components/reports/report-list';
import { loadReports } from '@/lib/reports';

// Lee Supabase en cada request: cada escaneo calificado agrega un reporte.
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const state = await loadReports();

  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Reportes</h1>
        <p className={styles.notice}>
          {state.kind === 'no-company'
            ? 'Registra primero la empresa a evaluar desde el Dashboard.'
            : 'Inicia sesión para ver los reportes: sin sesión no hay datos que consultar.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.pageTitle}>Reportes</h1>
        <p className={styles.subtitle}>
          {state.company.name} · {state.company.primaryDomain}
        </p>
      </div>
      <ReportList reports={state.reports} />
    </div>
  );
}
